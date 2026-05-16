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
  },
  {
    version: '0004_conversation_history',
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        specialist_id TEXT NOT NULL,
        title TEXT NOT NULL,
        title_status TEXT NOT NULL CHECK (title_status IN ('generated', 'pending')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_specialist_updated
        ON conversations (user_id, specialist_id, updated_at);

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        message_order INTEGER NOT NULL,
        grounded INTEGER CHECK (grounded IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (conversation_id, message_order)
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_order
        ON conversation_messages (conversation_id, message_order);

      CREATE TABLE IF NOT EXISTS message_citations (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        source_file TEXT,
        source_title TEXT NOT NULL,
        article_refs_json TEXT NOT NULL,
        shown_order INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_citations_message_order
        ON message_citations (message_id, shown_order);
    `
  },
  {
    version: '0005_admin_audit_events',
    sql: `
      CREATE TABLE IF NOT EXISTS admin_audit_events (
        id TEXT PRIMARY KEY,
        admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        admin_contact TEXT NOT NULL,
        action TEXT NOT NULL,
        specialist_id TEXT,
        occurred_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_time
        ON admin_audit_events (occurred_at);

      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_specialist
        ON admin_audit_events (specialist_id, occurred_at);
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
