import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import profileHandler from '../server/api/account/profile.get'
import activeCompanyHandler from '../server/api/account/active-company.put'
import companiesListHandler from '../server/api/companies/index.get'
import companyDetailHandler from '../server/api/companies/[id].get'
import companyPatchHandler from '../server/api/companies/[id].patch'
import companyQuotaHandler from '../server/api/companies/[id]/quota.get'
import companyMembersHandler from '../server/api/companies/[id]/members.put'
import { createSessionToken } from '../server/utils/auth/session'
import { createCompany, replaceCompanyMemberships, upsertCorporateSubscription } from '../server/utils/companies/repository'
import { initializeDatabase } from '../server/utils/db'

describe('company profile and management acceptance', () => {
  it('lets users view profile, select active company, and lets company admins manage data and members', async () => {
    const { dataDir, companyId } = await seedCompanyScenario()
    const fetchCompany = createCompanyFetch(dataDir)

    const anonymousCompanies = await fetchCompany(new Request('http://local/api/companies'))
    expect(anonymousCompanies.status).toBe(401)

    const profile = await fetchCompany(new Request('http://local/api/account/profile', {
      headers: sessionHeaders('buyer-user')
    }))
    await expect(profile.json()).resolves.toMatchObject({
      authenticated: true,
      verifiedEmails: ['buyer@example.com'],
      companies: [expect.objectContaining({ id: companyId, role: 'admin', active: true })],
      activeCompany: null
    })

    const selected = await fetchCompany(jsonRequest('http://local/api/account/active-company', {
      method: 'PUT',
      headers: sessionHeaders('buyer-user'),
      body: { companyId }
    }))
    expect(selected.status).toBe(200)
    await expect(selected.json()).resolves.toMatchObject({ activeCompany: { id: companyId, role: 'admin' } })

    const companies = await fetchCompany(new Request('http://local/api/companies', {
      headers: sessionHeaders('member-user')
    }))
    await expect(companies.json()).resolves.toMatchObject({
      companies: [expect.objectContaining({ id: companyId, role: 'member' })]
    })

    const memberPatch = await fetchCompany(jsonRequest(`http://local/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: sessionHeaders('member-user'),
      body: { name: 'Nome proibido' }
    }))
    expect(memberPatch.status).toBe(403)

    const memberQuota = await fetchCompany(new Request(`http://local/api/companies/${companyId}/quota`, {
      headers: sessionHeaders('member-user')
    }))
    expect(memberQuota.status).toBe(403)

    const adminQuota = await fetchCompany(new Request(`http://local/api/companies/${companyId}/quota`, {
      headers: sessionHeaders('buyer-user')
    }))
    expect(adminQuota.status).toBe(200)
    await expect(adminQuota.json()).resolves.toMatchObject({
      subject: { type: 'company', id: companyId },
      weekly: { used: 0, limit: 50000 }
    })

    const updated = await fetchCompany(jsonRequest(`http://local/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: sessionHeaders('buyer-user'),
      body: { nif: '5001234567', name: 'Empresa Actualizada', phone: '+244923999999', address: 'Nova morada' }
    }))
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ company: { id: companyId, name: 'Empresa Actualizada' } })

    const members = await fetchCompany(jsonRequest(`http://local/api/companies/${companyId}/members`, {
      method: 'PUT',
      headers: sessionHeaders('buyer-user'),
      body: { admins: ['buyer@example.com', 'ops@example.com'], members: ['member@example.com'] }
    }))
    expect(members.status).toBe(200)
    await expect(members.json()).resolves.toMatchObject({
      memberships: expect.arrayContaining([
        expect.objectContaining({ email: 'buyer@example.com', role: 'admin' }),
        expect.objectContaining({ email: 'ops@example.com', role: 'admin' }),
        expect.objectContaining({ email: 'member@example.com', role: 'member' })
      ])
    })

    const detail = await fetchCompany(new Request(`http://local/api/companies/${companyId}`, {
      headers: sessionHeaders('buyer-user')
    }))
    await expect(detail.json()).resolves.toMatchObject({
      company: { id: companyId, name: 'Empresa Actualizada' },
      role: 'admin',
      memberships: expect.arrayContaining([expect.objectContaining({ email: 'ops@example.com' })])
    })

    const cleared = await fetchCompany(jsonRequest('http://local/api/account/active-company', {
      method: 'PUT',
      headers: sessionHeaders('buyer-user'),
      body: { companyId: null }
    }))
    await expect(cleared.json()).resolves.toMatchObject({ activeCompany: null })
  })
})

async function seedCompanyScenario(): Promise<{ dataDir: string; companyId: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-company-management-'))
  const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
  seedUser(database, 'buyer-user', 'buyer@example.com')
  seedUser(database, 'member-user', 'member@example.com')
  const company = createCompany(database, {
    nif: '5001234567',
    name: 'Empresa Exemplo',
    phone: '+244923000000',
    address: 'Rua Principal'
  })
  upsertCorporateSubscription(database, {
    companyId: company.id,
    seats: 10,
    currentPeriodStart: '2026-06-10T10:00:00.000Z',
    currentPeriodEnd: '2026-09-10T10:00:00.000Z'
  })
  replaceCompanyMemberships(database, {
    companyId: company.id,
    admins: ['buyer@example.com'],
    members: ['member@example.com']
  })
  database.close()
  return { dataDir, companyId: company.id }
}

function createCompanyFetch(dataDir: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/account/profile', profileHandler)
  router.put('/api/account/active-company', activeCompanyHandler)
  router.get('/api/companies', companiesListHandler)
  router.get('/api/companies/:id', companyDetailHandler)
  router.get('/api/companies/:id/quota', companyQuotaHandler)
  router.patch('/api/companies/:id', companyPatchHandler)
  router.put('/api/companies/:id/members', companyMembersHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousCompaniesEnabled = process.env.UJIMU_COMPANIES_ENABLED
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'company-test-session-secret'
    process.env.UJIMU_COMPANIES_ENABLED = 'true'
    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_COMPANIES_ENABLED', previousCompaniesEnabled)
    }
  }
}

function seedUser(database: Awaited<ReturnType<typeof initializeDatabase>>, userId: string, email: string): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-06-10T10:00:00.000Z')
  database
    .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run(`${userId}-email`, userId, 'email', email, '2026-06-10T10:00:00.000Z')
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'company-test-session-secret'
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
