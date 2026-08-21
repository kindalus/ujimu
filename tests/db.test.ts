import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '../server/utils/db'

describe('initializeDatabase', () => {
  it('creates the db directory and SQLite file under the configured data directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-db-'))
    const dbPath = join(dataDir, 'db', 'ujimu.sqlite')

    const database = await initializeDatabase({ dataDir, dbPath })
    database.close()

    await expect(stat(join(dataDir, 'db'))).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(stat(dbPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('creates and records the initial schema migration', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-db-'))
    const dbPath = join(dataDir, 'db', 'ujimu.sqlite')

    const database = await initializeDatabase({ dataDir, dbPath })
    const rows = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: string }>
    database.close()

    expect(rows).toEqual([
      { version: '0001_initial_schema' },
      { version: '0002_request_events' },
      { version: '0003_auth_otp' },
      { version: '0004_conversation_history' },
      { version: '0005_admin_audit_events' },
      { version: '0006_question_analytics' },
      { version: '0007_billing_subscriptions' },
      { version: '0008_passkeys' },
      { version: '0009_background_jobs' },
      { version: '0010_corporate_accounts' },
      { version: '0011_company_quota_subject' },
      { version: '0012_company_admin_audit_events' },
      { version: '0013_specialist_initialization_jobs' },
      { version: '0014_otp_request_throttling' },
      { version: '0015_user_session_epoch' },
      { version: '0016_visitor_events_daily_dedupe' },
      { version: '0017_anonymous_quota_attribution' }
    ])
  })

  it('can be initialised repeatedly without duplicating migrations', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-db-'))
    const dbPath = join(dataDir, 'db', 'ujimu.sqlite')

    const first = await initializeDatabase({ dataDir, dbPath })
    first.close()

    const second = await initializeDatabase({ dataDir, dbPath })
    const count = second
      .prepare('SELECT COUNT(*) as count FROM schema_migrations')
      .get() as { count: number }
    second.close()

    expect(count.count).toBe(17)
  })

  it('opens connections in WAL mode with a busy timeout so writers never block readers', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-db-'))
    const dbPath = join(dataDir, 'db', 'ujimu.sqlite')

    const database = await initializeDatabase({ dataDir, dbPath })
    const journalMode = database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    const busyTimeout = database.prepare('PRAGMA busy_timeout').get() as { timeout: number }
    const synchronous = database.prepare('PRAGMA synchronous').get() as { synchronous: number }
    database.close()

    expect(journalMode.journal_mode).toBe('wal')
    expect(busyTimeout.timeout).toBe(5000)
    expect(synchronous.synchronous).toBe(1)
  })

  it('reuses one shared connection when no explicit path is given, and isolates explicit ones', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-db-'))
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousDbPath = process.env.UJIMU_DB_PATH
    process.env.UJIMU_DATA_DIR = dataDir
    delete process.env.UJIMU_DB_PATH

    try {
      const first = await initializeDatabase()
      const second = await initializeDatabase()
      expect(second).toBe(first)

      const explicit = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
      expect(explicit).not.toBe(first)
      explicit.close()

      // Closing an explicitly opened connection must not disturb the shared one.
      expect(await initializeDatabase()).toBe(first)
      expect(first.prepare('SELECT COUNT(*) as count FROM schema_migrations').get()).toMatchObject({ count: 17 })
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_DB_PATH', previousDbPath)
    }
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
