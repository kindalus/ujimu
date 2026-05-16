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
      { version: '0006_question_analytics' }
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

    expect(count.count).toBe(6)
  })
})
