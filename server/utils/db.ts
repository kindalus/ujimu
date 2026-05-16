import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveAppConfig } from './config'

export interface InitializeDatabaseOptions {
  dataDir?: string
  dbPath?: string
}

interface Migration {
  version: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    version: '0001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    version: '0002_request_events',
    sql: `
      CREATE TABLE IF NOT EXISTS request_events (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('anonymous', 'registered', 'subscribed')),
        subject_id TEXT NOT NULL,
        specialist_id TEXT NOT NULL,
        occurred_at_utc TEXT NOT NULL,
        user_timezone TEXT NOT NULL,
        counted INTEGER NOT NULL CHECK (counted IN (0, 1)),
        decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
        denial_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_request_events_subject_time
        ON request_events (subject_type, subject_id, occurred_at_utc);
    `
  },
  {
    version: '0003_auth_otp',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
        contact TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        UNIQUE (channel, contact)
      );

      CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
        ON user_identities (user_id);

      CREATE TABLE IF NOT EXISTS otp_challenges (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
        contact TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        used_at TEXT,
        invalidated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_otp_challenges_contact
        ON otp_challenges (channel, contact, created_at);
    `
  }
]

export async function initializeDatabase(options: InitializeDatabaseOptions = {}): Promise<DatabaseSync> {
  const appConfig = resolveAppConfig({ env: process.env })
  const dbPath = options.dbPath ?? appConfig.dbPath
  const dbDir = dirname(dbPath)

  await mkdir(dbDir, { recursive: true })

  const database = new DatabaseSync(dbPath)
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  applyMigrations(database)
  return database
}

function applyMigrations(database: DatabaseSync): void {
  const selectMigration = database.prepare('SELECT version FROM schema_migrations WHERE version = ?')
  const recordMigration = database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')

  for (const migration of MIGRATIONS) {
    const existing = selectMigration.get(migration.version)

    if (existing) {
      continue
    }

    database.exec('BEGIN')
    try {
      database.exec(migration.sql)
      recordMigration.run(migration.version)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
