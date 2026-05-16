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
