import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import adminSessionHandler from '../server/api/admin/session.get'
import adminSpecialistsListHandler from '../server/api/admin/specialists/index.get'
import adminSpecialistsCreateHandler from '../server/api/admin/specialists/index.post'
import adminSpecialistPatchHandler from '../server/api/admin/specialists/[id].patch'
import adminSpecialistDeleteHandler from '../server/api/admin/specialists/[id].delete'
import adminRawUploadHandler from '../server/api/admin/specialists/[id]/raw.post'
import adminSourcesReloadHandler from '../server/api/admin/specialists/[id]/sources/reload.post'
import adminIngestionRunHandler from '../server/api/admin/specialists/[id]/ingestion/run.post'
import { createSessionToken } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import { getConversation, persistCompletedHistoryTurn } from '../server/utils/history/repository'
import { createSpecialist } from '../server/utils/specialists/manager'
import {
  getPublicSpecialists,
  getSpecialistById,
  resetSpecialistRegistryForTests
} from '../server/utils/specialists/registry'

describe('admin specialist management acceptance', () => {
  it('authorizes admins from all verified OTP identities and denies anonymous or non-admin users', async () => {
    const { dataDir } = await createTempAdminData()
    await seedUser(dataDir, {
      userId: 'admin-user',
      contacts: ['owner@example.com', '+244923000000']
    })
    await seedUser(dataDir, { userId: 'regular-user', contacts: ['regular@example.com'] })
    const fetchAdmin = createAdminFetch(dataDir, '+244923000000')

    const anonymousList = await fetchAdmin(new Request('http://local/api/admin/specialists'))
    expect(anonymousList.status).toBe(401)

    const nonAdminList = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists', {
        headers: sessionHeaders('regular-user')
      })
    )
    expect(nonAdminList.status).toBe(403)

    const adminSession = await fetchAdmin(
      new Request('http://local/api/admin/session', {
        headers: sessionHeaders('admin-user')
      })
    )
    await expect(adminSession.json()).resolves.toMatchObject({
      authenticated: true,
      admin: true,
      user: { id: 'admin-user', displayContact: 'owner@example.com' }
    })

    const emptyAllowlistFetch = createAdminFetch(dataDir, '')
    const emptyAllowlistSession = await emptyAllowlistFetch(
      new Request('http://local/api/admin/session', {
        headers: sessionHeaders('admin-user')
      })
    )
    await expect(emptyAllowlistSession.json()).resolves.toMatchObject({
      authenticated: true,
      admin: false
    })
  })

  it('creates and edits specialists through the admin API and records safe audit events', async () => {
    const { dataDir, specialtiesRoot } = await createTempAdminData()
    await seedUser(dataDir, { userId: 'admin-user', contacts: ['admin@example.com'] })
    const fetchAdmin = createAdminFetch(dataDir, 'admin@example.com')

    const created = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists', {
        method: 'POST',
        headers: sessionHeaders('admin-user'),
        body: {
          id: 'iva',
          name: 'Legislação de IVA',
          description: 'Especialista sobre legislação de IVA.',
          wiki_type: 'legislation-regulatory',
          system_prompt: 'Answer only from this specialist wiki.',
          citations_required: true,
          streaming_enabled: true
        }
      })
    )
    expect(created.status).toBe(201)
    await expect(readFile(join(specialtiesRoot, 'iva', 'specialist.yaml'), 'utf8')).resolves.toContain(
      'id: iva'
    )

    const duplicate = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists', {
        method: 'POST',
        headers: sessionHeaders('admin-user'),
        body: {
          id: 'iva',
          name: 'Duplicado',
          description: 'Não deve criar.',
          wiki_type: 'legislation-regulatory',
          system_prompt: 'Prompt.',
          citations_required: true,
          streaming_enabled: true
        }
      })
    )
    expect(duplicate.status).toBe(409)

    const updated = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists/iva', {
        method: 'PATCH',
        headers: sessionHeaders('admin-user'),
        body: {
          name: 'IVA actualizado',
          description: 'Descrição actualizada.',
          system_prompt: 'Use apenas a wiki de IVA.',
          citations_required: true,
          streaming_enabled: false
        }
      })
    )
    expect(updated.status).toBe(200)
    const updatedBody = await updated.json() as { specialist: { name: string; streaming_enabled: boolean } }
    expect(updatedBody.specialist).toMatchObject({ name: 'IVA actualizado', streaming_enabled: false })

    const immutableEdit = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists/iva', {
        method: 'PATCH',
        headers: sessionHeaders('admin-user'),
        body: { wiki_type: 'custom-domain' }
      })
    )
    expect(immutableEdit.status).toBe(400)

    const listed = await fetchAdmin(
      new Request('http://local/api/admin/specialists', {
        headers: sessionHeaders('admin-user')
      })
    )
    const listedBody = await listed.json() as { specialists: Array<{ id: string; system_prompt: string; sources: unknown[] }> }
    expect(listedBody.specialists[0]).toMatchObject({
      id: 'iva',
      system_prompt: 'Use apenas a wiki de IVA.',
      sources: []
    })
    expect(await getPublicSpecialists({ specialtiesRoot })).toEqual([
      expect.objectContaining({ id: 'iva', name: 'IVA actualizado', streaming_enabled: false })
    ])

    const audit = await readAuditEvents(dataDir)
    expect(audit.map((event) => event.action)).toEqual(['specialist_created', 'specialist_updated'])
    expect(audit[1].metadata_json).toContain('changed_fields')
    expect(audit[1].metadata_json).not.toContain('Answer only from this specialist wiki.')
  })

  it('uploads raw sources, reloads pending state, rejects unsafe uploads, and skips disabled ingestion safely', async () => {
    const { dataDir } = await createTempAdminData()
    await seedUser(dataDir, { userId: 'admin-user', contacts: ['admin@example.com'] })
    await createSpecialist(validSpecialist('iva'), { dataDir })
    const fetchAdmin = createAdminFetch(dataDir, 'admin@example.com')

    const upload = await fetchAdmin(
      uploadRequest('http://local/api/admin/specialists/iva/raw', 'codigo-iva.md', '# Código do IVA\n\nArtigo 1.º')
    )
    expect(upload.status).toBe(201)
    const uploadBody = await upload.json() as { stored: { relativePath: string }; replaced: boolean; source: { raw_path: string; status: string } }
    expect(uploadBody).toMatchObject({
      stored: { relativePath: 'codigo-iva.original.md' },
      replaced: false,
      source: { raw_path: 'codigo-iva.original.md', status: 'pending' }
    })

    const replacement = await fetchAdmin(
      uploadRequest('http://local/api/admin/specialists/iva/raw', 'codigo-iva.md', '# Código do IVA\n\nArtigo 2.º')
    )
    expect(replacement.status).toBe(200)
    const replacementBody = await replacement.json() as {
      stored: { relativePath: string }
      replaced: boolean
      source: { raw_path: string; status: string; previous_checksum?: string; replaced_at?: string }
    }
    expect(replacementBody).toMatchObject({
      stored: { relativePath: 'codigo-iva.original.md' },
      replaced: true,
      source: { raw_path: 'codigo-iva.original.md', status: 'pending' }
    })
    expect(replacementBody.source.previous_checksum).toMatch(/^sha256:/)
    expect(replacementBody.source.replaced_at).toBeTruthy()

    const unsafe = await fetchAdmin(
      uploadRequest('http://local/api/admin/specialists/iva/raw', '../escape.md', '# Mau')
    )
    expect(unsafe.status).toBe(400)

    const unsupported = await fetchAdmin(
      uploadRequest('http://local/api/admin/specialists/iva/raw', 'malware.exe', 'binário')
    )
    expect(unsupported.status).toBe(400)

    const reloaded = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists/iva/sources/reload', {
        method: 'POST',
        headers: sessionHeaders('admin-user')
      })
    )
    expect(reloaded.status).toBe(200)
    await expect(reloaded.json()).resolves.toMatchObject({
      sources: [expect.objectContaining({ raw_path: 'codigo-iva.original.md', status: 'pending', article_refs: ['Artigo 2.º'] })]
    })

    const disabledIngestion = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists/iva/ingestion/run', {
        method: 'POST',
        headers: sessionHeaders('admin-user')
      })
    )
    expect(disabledIngestion.status).toBe(409)
    await expect(disabledIngestion.json()).resolves.toMatchObject({
      error: {
        code: 'PI_INGESTION_DISABLED',
        message: 'A ingestão automática não está activa neste ambiente.'
      }
    })

    const audit = await readAuditEvents(dataDir)
    expect(audit.map((event) => event.action)).toEqual([
      'raw_source_uploaded',
      'raw_source_replaced',
      'sources_reloaded',
      'ingestion_skipped_disabled'
    ])
    expect(audit[0].metadata_json).toContain('codigo-iva.original.md')
    expect(audit[0].metadata_json).not.toContain('Artigo 1.º')
    expect(audit[1].metadata_json).toContain('codigo-iva.original.md')
    expect(audit[1].metadata_json).not.toContain('Artigo 2.º')
  })

  it('deletes specialists as product deletion while moving the directory to trash and deleting history', async () => {
    const { dataDir, specialtiesRoot } = await createTempAdminData()
    await seedUser(dataDir, { userId: 'admin-user', contacts: ['admin@example.com'] })
    await seedUser(dataDir, { userId: 'customer-user', contacts: ['customer@example.com'] })
    await createSpecialist(validSpecialist('iva'), { dataDir })
    const database = await openAdminDatabase(dataDir)
    const saved = await persistCompletedHistoryTurn(database, {
      userId: 'customer-user',
      specialistId: 'iva',
      specialistName: 'Legislação de IVA',
      question: 'Pergunta',
      answer: 'Resposta',
      grounded: true,
      citations: [],
      now: new Date('2026-05-16T12:00:00.000Z')
    })
    database.close()
    const fetchAdmin = createAdminFetch(dataDir, 'admin@example.com')

    const badConfirmation = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists/iva', {
        method: 'DELETE',
        headers: sessionHeaders('admin-user'),
        body: { confirmationId: 'errado' }
      })
    )
    expect(badConfirmation.status).toBe(400)
    await expect(stat(join(specialtiesRoot, 'iva'))).resolves.toMatchObject({ isDirectory: expect.any(Function) })

    const deleted = await fetchAdmin(
      jsonRequest('http://local/api/admin/specialists/iva', {
        method: 'DELETE',
        headers: sessionHeaders('admin-user'),
        body: { confirmationId: 'iva' }
      })
    )
    expect(deleted.status).toBe(200)

    await expect(stat(join(specialtiesRoot, 'iva'))).rejects.toMatchObject({ code: 'ENOENT' })
    const trashed = await readdir(join(dataDir, 'trash', 'specialties'))
    expect(trashed).toHaveLength(1)
    expect(trashed[0]).toMatch(/_iva$/)
    await expect(stat(join(dataDir, 'trash', 'specialties', trashed[0], 'specialist.yaml'))).resolves.toMatchObject({
      isFile: expect.any(Function)
    })
    expect(await getSpecialistById('iva', { specialtiesRoot })).toBeUndefined()
    expect(await getPublicSpecialists({ specialtiesRoot })).toEqual([])

    const afterDeleteDb = await openAdminDatabase(dataDir)
    expect(getConversation(afterDeleteDb, { userId: 'customer-user', conversationId: saved.conversationId })).toBeUndefined()
    afterDeleteDb.close()

    const audit = await readAuditEvents(dataDir)
    expect(audit.map((event) => event.action)).toContain('specialist_deleted')
  })
})

async function createTempAdminData(): Promise<{ dataDir: string; specialtiesRoot: string }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-admin-'))
  return { dataDir, specialtiesRoot: join(dataDir, 'specialties') }
}

async function openAdminDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function seedUser(
  dataDir: string,
  input: { userId: string; contacts: string[] }
): Promise<void> {
  const database = await openAdminDatabase(dataDir)
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(input.userId, '2026-05-16T12:00:00.000Z')
  input.contacts.forEach((contact, index) => {
    database
      .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        `${input.userId}-identity-${index}`,
        input.userId,
        contact.startsWith('+') ? 'phone' : 'email',
        contact,
        new Date(Date.UTC(2026, 4, 16, 12, index)).toISOString()
      )
  })
  database.close()
}

function createAdminFetch(dataDir: string, adminContacts: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/admin/session', adminSessionHandler)
  router.get('/api/admin/specialists', adminSpecialistsListHandler)
  router.post('/api/admin/specialists', adminSpecialistsCreateHandler)
  router.patch('/api/admin/specialists/:id', adminSpecialistPatchHandler)
  router.delete('/api/admin/specialists/:id', adminSpecialistDeleteHandler)
  router.post('/api/admin/specialists/:id/raw', adminRawUploadHandler)
  router.post('/api/admin/specialists/:id/sources/reload', adminSourcesReloadHandler)
  router.post('/api/admin/specialists/:id/ingestion/run', adminIngestionRunHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    const previousPiEnabled = process.env.UJIMU_PI_INGESTION_ENABLED
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'admin-test-secret'
    process.env.UJIMU_ADMIN_CONTACTS = adminContacts
    delete process.env.UJIMU_PI_INGESTION_ENABLED

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_ADMIN_CONTACTS', previousAdminContacts)
      restoreEnv('UJIMU_PI_INGESTION_ENABLED', previousPiEnabled)
    }
  }
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'admin-test-secret',
      now: new Date('2026-05-16T12:00:00.000Z')
    })}`
  })
}

function jsonRequest(
  url: string,
  options: { method?: string; headers?: Headers; body?: unknown } = {}
): Request {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function uploadRequest(url: string, fileName: string, content: string): Request {
  const form = new FormData()
  form.set('file', new Blob([content], { type: 'text/plain' }), fileName)
  return new Request(url, {
    method: 'POST',
    headers: sessionHeaders('admin-user'),
    body: form
  })
}

function validSpecialist(id: string) {
  return {
    id,
    name: 'Legislação de IVA',
    description: 'Especialista sobre legislação de IVA.',
    wiki_type: 'legislation-regulatory' as const,
    system_prompt: 'Answer only from this specialist wiki.',
    citations_required: true,
    streaming_enabled: true
  }
}

async function readAuditEvents(dataDir: string): Promise<Array<{ action: string; metadata_json: string }>> {
  const database = await openAdminDatabase(dataDir)
  const rows = database
    .prepare('SELECT action, metadata_json FROM admin_audit_events ORDER BY occurred_at, id')
    .all() as Array<{ action: string; metadata_json: string }>
  database.close()
  return rows
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
