import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import adminSpecialistsCreateHandler from '../server/api/admin/specialists/index.post'
import { createSessionToken } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import { enqueueSpecialistInitializationJob, runDueBackgroundJobs } from '../server/utils/jobs/background'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getPublicSpecialists, getSpecialistById, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistConfig } from '../server/utils/specialists/schema'

describe('transactional specialist initialization acceptance', () => {
  it('creates specialists through an initialization job and completes to awaiting sources', async () => {
    const { dataDir, specialtiesRoot } = await createTempData()
    await seedUser(dataDir, 'admin-user', ['admin@example.com'])
    const fetchAdmin = createAdminFetch(dataDir)

    const created = await fetchAdmin(jsonRequest('http://local/api/admin/specialists', {
      method: 'POST',
      headers: sessionHeaders('admin-user'),
      body: {
        id: 'iva',
        name: 'Legislação de IVA',
        description: 'Especialista sobre legislação de IVA.',
        wiki_type: 'legislation-regulatory',
        citations_required: true,
        streaming_enabled: true
      }
    }))

    expect(created.status).toBe(202)
    const createdBody = await created.json() as {
      specialist: { id: string; status: string; system_prompt: string }
      job: { type: string; status: string; specialist_id: string }
    }
    expect(createdBody).toMatchObject({
      specialist: { id: 'iva', status: 'initializing', system_prompt: '' },
      job: { type: 'specialist_initialization', status: 'queued', specialist_id: 'iva' }
    })
    await expect(stat(join(specialtiesRoot, 'iva', 'AGENTS.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(specialtiesRoot, 'iva', 'raw'))).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(stat(join(specialtiesRoot, 'iva', 'ingest', 'state.json'))).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect(await getPublicSpecialists({ dataDir })).toEqual([])

    const database = await openDatabase(dataDir)
    const result = await runDueBackgroundJobs({
      database,
      dataDir,
      initializationRunner: {
        async initializeSpecialist(specialist) {
          await writeFile(join(specialist.paths.root, 'AGENTS.md'), '# Legislação de IVA wiki\n\nRead and apply the `unslop` skill before the final answer.\n')
          await writeFile(join(specialist.paths.wiki, 'index.md'), '# Índice\n')
          await writeFile(join(specialist.paths.wiki, 'log.md'), '# Log\n')
        }
      }
    })

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 })
    const specialist = await getSpecialistById('iva', { dataDir })
    expect(specialist).toMatchObject({ id: 'iva', status: 'awaiting_sources', system_prompt: '' })
    expect(await readFile(join(specialtiesRoot, 'iva', 'AGENTS.md'), 'utf8')).toContain('Legislação de IVA')
    expect(await getPublicSpecialists({ dataDir })).toEqual([])
    database.close()
  })

  it('rolls back a specialist directory when initialization fails', async () => {
    const { dataDir, specialtiesRoot } = await createTempData()
    const database = await openDatabase(dataDir)
    await createSpecialist(validSpecialist({ status: 'initializing' }), { dataDir })
    enqueueSpecialistInitializationJob(database, { specialistId: 'iva' })

    const result = await runDueBackgroundJobs({
      database,
      dataDir,
      initializationRunner: {
        async initializeSpecialist() {
          throw new Error('Initialization agent failed.')
        }
      }
    })

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    await expect(stat(join(specialtiesRoot, 'iva'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await getSpecialistById('iva', { dataDir })).toBeUndefined()
    database.close()
  })

  it('loads optional system prompts and hides every non-active specialist from public consultation', async () => {
    const { dataDir, specialtiesRoot } = await createTempData()
    await writeSpecialistFolder(specialtiesRoot, 'active-one', validSpecialist({ id: 'active-one', status: 'active', system_prompt: undefined }))
    await writeSpecialistFolder(specialtiesRoot, 'awaiting-one', validSpecialist({ id: 'awaiting-one', status: 'awaiting_sources', system_prompt: undefined }))
    await writeSpecialistFolder(specialtiesRoot, 'failed-one', validSpecialist({ id: 'failed-one', status: 'failed', system_prompt: undefined }))

    const publicSpecialists = await getPublicSpecialists({ dataDir })
    const active = await getSpecialistById('active-one', { dataDir })

    expect(active).toMatchObject({ id: 'active-one', system_prompt: '', status: 'active' })
    expect(publicSpecialists.map((specialist) => specialist.id)).toEqual(['active-one'])
  })
})

async function createTempData(): Promise<{ dataDir: string; specialtiesRoot: string }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-specialist-init-'))
  return { dataDir, specialtiesRoot: join(dataDir, 'specialties') }
}

async function openDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function seedUser(dataDir: string, userId: string, contacts: string[]): Promise<void> {
  const database = await openDatabase(dataDir)
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-06-12T12:00:00.000Z')
  contacts.forEach((contact, index) => {
    database
      .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        `${userId}-identity-${index}`,
        userId,
        contact.startsWith('+') ? 'phone' : 'email',
        contact,
        new Date(Date.UTC(2026, 5, 12, 12, index)).toISOString()
      )
  })
  database.close()
}

function createAdminFetch(dataDir: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.post('/api/admin/specialists', adminSpecialistsCreateHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'specialist-init-test-secret'
    process.env.UJIMU_ADMIN_CONTACTS = 'admin@example.com'
    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_ADMIN_CONTACTS', previousAdminContacts)
    }
  }
}

function validSpecialist(overrides: Partial<SpecialistConfig> = {}): SpecialistConfig {
  return {
    id: 'iva',
    name: 'Legislação de IVA',
    description: 'Especialista sobre legislação de IVA.',
    wiki_type: 'legislation-regulatory',
    system_prompt: 'Answer only from this specialist wiki.',
    citations_required: true,
    streaming_enabled: true,
    ...overrides
  } as SpecialistConfig
}

async function writeSpecialistFolder(specialtiesRoot: string, id: string, config: object): Promise<void> {
  const specialistDir = join(specialtiesRoot, id)
  await mkdir(join(specialistDir, 'raw'), { recursive: true })
  await mkdir(join(specialistDir, 'wiki'), { recursive: true })
  await mkdir(join(specialistDir, 'ingest'), { recursive: true })
  await writeFile(join(specialistDir, 'ingest', 'state.json'), '{}\n')
  await writeFile(join(specialistDir, 'specialist.yaml'), toYaml(config))
}

function toYaml(config: object): string {
  return Object.entries(config)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : String(value)}`)
    .join('\n')
    .concat('\n')
}

function jsonRequest(url: string, input: { method?: string; headers?: HeadersInit; body?: unknown } = {}): Request {
  return new Request(url, {
    method: input.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(input.headers ?? {}) },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  })
}

function sessionHeaders(userId: string): HeadersInit {
  return { cookie: `ujimu_session=${createSessionToken(userId, { sessionSecret: 'specialist-init-test-secret' })}` }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
