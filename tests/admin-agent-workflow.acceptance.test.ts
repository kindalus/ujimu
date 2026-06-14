import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import adminSpecialistsListHandler from '../server/api/admin/specialists/index.get'
import adminRawUploadHandler from '../server/api/admin/specialists/[id]/raw.post'
import { createSessionToken } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

describe('admin agent workflow progress and recovery acceptance', () => {
  it('blocks source upload until initialization has completed', async () => {
    const { dataDir, specialtiesRoot } = await createTempData()
    await seedAdmin(dataDir)
    await createSpecialist(validSpecialist({ status: 'initializing' }), { dataDir })
    const fetchAdmin = createAdminFetch(dataDir)

    const blocked = await fetchAdmin(uploadRequest('http://local/api/admin/specialists/iva/raw', 'codigo-iva.md', '# Código do IVA'))
    expect(blocked.status).toBe(409)
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: 'SPECIALIST_NOT_READY_FOR_UPLOAD' }
    })
    await expect(stat(join(specialtiesRoot, 'iva', 'raw', 'codigo-iva.original.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await createSpecialist(validSpecialist({ id: 'laboral', status: 'awaiting_sources' }), { dataDir })
    const allowed = await fetchAdmin(uploadRequest('http://local/api/admin/specialists/laboral/raw', 'lei.md', '# Lei\n\nArtigo 1.º'))
    expect(allowed.status).toBe(201)
  })

  it('returns global agent logs in the admin specialist payload', async () => {
    const { dataDir } = await createTempData()
    await seedAdmin(dataDir)
    await createSpecialist(validSpecialist({ status: 'awaiting_sources' }), { dataDir })
    await mkdir(join(dataDir, 'logs', 'agents'), { recursive: true })
    await writeFile(
      join(dataDir, 'logs', 'agents', '2026-06-12T10-20-30-123Z-iva-ingestion.md'),
      '# Ujimu agent session log\n',
      'utf8'
    )
    await writeFile(
      join(dataDir, 'logs', 'agents', '2026-06-12T11-20-30-123Z-falhou-initialization.md'),
      '# Ujimu agent session log\n',
      'utf8'
    )
    const database = await openDatabase(dataDir)
    database.prepare(`
      INSERT INTO background_jobs (
        id, type, specialist_id, status, attempts, max_attempts, locked_at, locked_by,
        last_error_code, last_error_message, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'failed-init-job',
      'specialist_initialization',
      'falhou',
      'failed',
      1,
      3,
      null,
      null,
      'WIKI_INITIALIZATION_OUTPUT_MISSING',
      'Specialist initialization did not create required file log.md.',
      '2026-06-12T11:20:30.123Z',
      '2026-06-12T11:21:30.123Z',
      '2026-06-12T11:21:30.123Z'
    )
    database.close()
    const fetchAdmin = createAdminFetch(dataDir)

    const response = await fetchAdmin(new Request('http://local/api/admin/specialists', { headers: sessionHeaders('admin-user') }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      specialists: [expect.objectContaining({
        id: 'iva',
        agent_logs: [expect.objectContaining({
          file_name: '2026-06-12T10-20-30-123Z-iva-ingestion.md',
          task: 'ingestion',
          started_at: '2026-06-12T10:20:30.123Z'
        })]
      })],
      failed_initializations: [expect.objectContaining({
        job_id: 'failed-init-job',
        specialist_id: 'falhou',
        error_code: 'WIKI_INITIALIZATION_OUTPUT_MISSING',
        error_message: 'Specialist initialization did not create required file log.md.',
        agent_logs: [expect.objectContaining({ file_name: '2026-06-12T11-20-30-123Z-falhou-initialization.md' })]
      })]
    })
  })

  it('documents workflow states, upload gating, logs, and retry controls in the admin detail page', async () => {
    const page = await readFile('pages/admin/specialists/[id].vue', 'utf8')

    expect(page).toContain('canUploadSources')
    expect(page).toContain('Inicialização da wiki em curso')
    expect(page).toContain('Registos do agente')
    expect(page).toContain('Tentar novamente')
    expect(page).toContain('Falhas de inicialização recentes')
    expect(page).toContain('failedInitializations')
    expect(page).toContain('agent_logs')
  })
})

async function createTempData(): Promise<{ dataDir: string; specialtiesRoot: string }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-admin-agent-workflow-'))
  return { dataDir, specialtiesRoot: join(dataDir, 'specialties') }
}

async function seedAdmin(dataDir: string): Promise<void> {
  const database = await openDatabase(dataDir)
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('admin-user', '2026-06-12T12:00:00.000Z')
  database
    .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run('admin-user-identity', 'admin-user', 'email', 'admin@example.com', '2026-06-12T12:00:00.000Z')
  database.close()
}

async function openDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

function createAdminFetch(dataDir: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/admin/specialists', adminSpecialistsListHandler)
  router.post('/api/admin/specialists/:id/raw', adminRawUploadHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'admin-agent-workflow-secret'
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

function validSpecialist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'iva',
    name: 'Legislação de IVA',
    description: 'Especialista sobre legislação de IVA.',
    wiki_type: 'legislation-regulatory',
    citations_required: true,
    streaming_enabled: true,
    ...overrides
  } as never
}

function uploadRequest(url: string, fileName: string, content: string): Request {
  const form = new FormData()
  form.set('file', new File([content], fileName, { type: 'text/markdown' }))
  return new Request(url, {
    method: 'POST',
    headers: sessionHeaders('admin-user'),
    body: form
  })
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, { sessionSecret: 'admin-agent-workflow-secret' })}`
  })
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
