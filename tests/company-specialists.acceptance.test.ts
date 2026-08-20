import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import companySpecialistsListHandler from '../server/api/companies/[id]/specialists/index.get'
import companySpecialistDetailHandler from '../server/api/companies/[id]/specialists/[specialistId].get'
import companySpecialistPatchHandler from '../server/api/companies/[id]/specialists/[specialistId].patch'
import companySpecialistRawHandler from '../server/api/companies/[id]/specialists/[specialistId]/raw.post'
import { createSessionToken } from '../server/utils/auth/session'
import { createCompany, replaceCompanyMemberships, upsertCorporateSubscription } from '../server/utils/companies/repository'
import { initializeDatabase } from '../server/utils/db'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getSpecialistById, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

const SESSION_SECRET = 'company-specialists-test-secret'

describe('corporate specialist management API acceptance', () => {
  it('lets company admins manage only their company specialists without triggering ingestion', async () => {
    const { dataDir, specialtiesRoot, companyId, otherCompanyId } = await seedCompanySpecialistScenario()
    const fetchApp = createCompanySpecialistFetch(dataDir)

    const anonymous = await fetchApp(new Request(`http://local/api/companies/${companyId}/specialists`))
    expect(anonymous.status).toBe(401)

    const memberList = await fetchApp(new Request(`http://local/api/companies/${companyId}/specialists`, {
      headers: sessionHeaders('member-user')
    }))
    expect(memberList.status).toBe(403)

    const list = await fetchApp(new Request(`http://local/api/companies/${companyId}/specialists`, {
      headers: sessionHeaders('company-admin')
    }))
    expect(list.status).toBe(200)
    const listBody = await list.json() as { specialists: Array<Record<string, unknown>> }
    expect(listBody.specialists).toEqual([expect.objectContaining({ id: 'iva', system_prompt: 'Initial corporate prompt.' })])
    expect(listBody.specialists[0]).not.toHaveProperty('company_id')
    expect(listBody.specialists.map((specialist) => specialist.id)).not.toContain('publico')
    expect(listBody.specialists.map((specialist) => specialist.id)).not.toContain('aduaneiro')

    const wrongCompany = await fetchApp(new Request(`http://local/api/companies/${companyId}/specialists/aduaneiro`, {
      headers: sessionHeaders('company-admin')
    }))
    expect(wrongCompany.status).toBe(404)

    const otherCompanyAdmin = await fetchApp(new Request(`http://local/api/companies/${companyId}/specialists/iva`, {
      headers: sessionHeaders('other-admin')
    }))
    expect(otherCompanyAdmin.status).toBe(404)

    const invalidPatch = await fetchApp(jsonRequest(`http://local/api/companies/${companyId}/specialists/iva`, {
      method: 'PATCH',
      headers: sessionHeaders('company-admin'),
      body: { name: 'Não permitido' }
    }))
    expect(invalidPatch.status).toBe(400)

    const patched = await fetchApp(jsonRequest(`http://local/api/companies/${companyId}/specialists/iva`, {
      method: 'PATCH',
      headers: sessionHeaders('company-admin'),
      body: { system_prompt: 'Prompt corporativo actualizado.' }
    }))
    expect(patched.status).toBe(200)
    await expect(patched.json()).resolves.toMatchObject({
      specialist: { id: 'iva', system_prompt: 'Prompt corporativo actualizado.' }
    })
    await expect(readFile(join(specialtiesRoot, 'iva', 'specialist.yaml'), 'utf8')).resolves.toContain('Prompt corporativo actualizado.')

    const upload = await fetchApp(uploadRequest(`http://local/api/companies/${companyId}/specialists/iva/raw`, 'fonte.md', '# Fonte\n\nArtigo 1.º', 'company-admin'))
    expect(upload.status).toBe(201)
    await expect(upload.json()).resolves.toMatchObject({
      stored: { relativePath: 'fonte.original.md' },
      replaced: false,
      source: { raw_path: 'fonte.original.md', status: 'pending' }
    })

    const replacement = await fetchApp(uploadRequest(`http://local/api/companies/${companyId}/specialists/iva/raw`, 'fonte.md', '# Fonte\n\nArtigo 2.º', 'company-admin'))
    expect(replacement.status).toBe(200)
    await expect(replacement.json()).resolves.toMatchObject({
      stored: { relativePath: 'fonte.original.md' },
      replaced: true,
      source: { raw_path: 'fonte.original.md', status: 'pending' }
    })

    const database = await openDatabase(dataDir)
    expect(readBackgroundJobCount(database)).toBe(0)
    expect(readCompanyAuditEvents(database)).toEqual([
      expect.objectContaining({ action: 'specialist_prompt_updated', company_id: companyId, specialist_id: 'iva' }),
      expect.objectContaining({ action: 'raw_source_uploaded', company_id: companyId, specialist_id: 'iva' }),
      expect.objectContaining({ action: 'raw_source_replaced', company_id: companyId, specialist_id: 'iva' })
    ])
    database.close()

    const otherSpecialist = await getSpecialistById('aduaneiro', { specialtiesRoot })
    expect(otherSpecialist?.company_id).toBe(otherCompanyId)
  })
})

async function seedCompanySpecialistScenario(): Promise<{ dataDir: string; specialtiesRoot: string; companyId: string; otherCompanyId: string }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-company-specialists-'))
  const specialtiesRoot = join(dataDir, 'specialties')
  const database = await openDatabase(dataDir)
  seedUser(database, 'company-admin', 'company-admin@example.com')
  seedUser(database, 'member-user', 'member@example.com')
  seedUser(database, 'other-admin', 'other-admin@example.com')
  const company = createCompany(database, {
    nif: '5007770001',
    name: 'Empresa Fontes',
    phone: '+244923000000',
    address: 'Rua Principal'
  })
  const otherCompany = createCompany(database, {
    nif: '5007770002',
    name: 'Outra Empresa',
    phone: '+244923000001',
    address: 'Rua Secundária'
  })
  upsertCorporateSubscription(database, {
    companyId: company.id,
    seats: 10,
    currentPeriodStart: '2026-06-10T10:00:00.000Z',
    currentPeriodEnd: '2026-09-10T10:00:00.000Z'
  })
  upsertCorporateSubscription(database, {
    companyId: otherCompany.id,
    seats: 10,
    currentPeriodStart: '2026-06-10T10:00:00.000Z',
    currentPeriodEnd: '2026-09-10T10:00:00.000Z'
  })
  replaceCompanyMemberships(database, {
    companyId: company.id,
    admins: ['company-admin@example.com'],
    members: ['member@example.com']
  })
  replaceCompanyMemberships(database, {
    companyId: otherCompany.id,
    admins: ['other-admin@example.com'],
    members: []
  })
  database.close()

  await createSpecialist(validSpecialist('iva', { companyId: company.id, systemPrompt: 'Initial corporate prompt.' }), { dataDir })
  await createSpecialist(validSpecialist('aduaneiro', { companyId: otherCompany.id }), { dataDir })
  await createSpecialist(validSpecialist('publico'), { dataDir })

  return { dataDir, specialtiesRoot, companyId: company.id, otherCompanyId: otherCompany.id }
}

function createCompanySpecialistFetch(dataDir: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/companies/:id/specialists', companySpecialistsListHandler)
  router.get('/api/companies/:id/specialists/:specialistId', companySpecialistDetailHandler)
  router.patch('/api/companies/:id/specialists/:specialistId', companySpecialistPatchHandler)
  router.post('/api/companies/:id/specialists/:specialistId/raw', companySpecialistRawHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = SESSION_SECRET
    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
    }
  }
}

async function openDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

function seedUser(database: DatabaseSync, userId: string, email: string): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-06-10T10:00:00.000Z')
  database
    .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run(`${userId}-email`, userId, 'email', email, '2026-06-10T10:00:00.000Z')
}

function validSpecialist(id: string, options: { companyId?: string; systemPrompt?: string } = {}) {
  return {
    id,
    name: `Especialista ${id}`,
    description: 'Especialista corporativo.',
    wiki_type: 'legislation-regulatory' as const,
    system_prompt: options.systemPrompt ?? 'Answer only from this specialist wiki.',
    citations_required: true,
    streaming_enabled: true,
    ...(options.companyId ? { company_id: options.companyId } : {})
  }
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: SESSION_SECRET
    })}`
  })
}

function jsonRequest(url: string, options: { method?: string; headers?: Headers; body?: unknown } = {}): Request {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function uploadRequest(url: string, fileName: string, content: string, userId: string): Request {
  const form = new FormData()
  form.set('file', new Blob([content], { type: 'text/markdown' }), fileName)
  return new Request(url, {
    method: 'POST',
    headers: sessionHeaders(userId),
    body: form
  })
}

function readBackgroundJobCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM background_jobs').get() as { count: number }
  return row.count
}

function readCompanyAuditEvents(database: DatabaseSync): Array<{ action: string; company_id: string; specialist_id: string; metadata_json: string }> {
  return database
    .prepare('SELECT action, company_id, specialist_id, metadata_json FROM company_admin_audit_events ORDER BY occurred_at, id')
    .all() as Array<{ action: string; company_id: string; specialist_id: string; metadata_json: string }>
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
