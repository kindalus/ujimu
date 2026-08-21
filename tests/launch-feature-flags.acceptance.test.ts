import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, eventHandler, toWebHandler } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveQuotaSubjectWithSubscription } from '../server/utils/billing/subscriptions'
import {
  createCompany,
  replaceCompanyMemberships,
  setActiveCompanyForUser,
  upsertCorporateSubscription
} from '../server/utils/companies/repository'
import { initializeDatabase } from '../server/utils/db'
import { resolveSpecialistAccessSubjectFromUser } from '../server/utils/specialists/access'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('launch feature flags acceptance', () => {
  it('defaults subscriptions and companies off and exposes explicit true values publicly', async () => {
    delete process.env.UJIMU_SUBSCRIPTIONS_ENABLED
    delete process.env.UJIMU_COMPANIES_ENABLED
    const handler = (await import('../server/api/features.get')).default

    const disabled = await fetchHandler(handler, '/api/features')
    await expect(disabled.json()).resolves.toMatchObject({
      subscriptionsEnabled: false,
      companiesEnabled: false
    })

    process.env.UJIMU_SUBSCRIPTIONS_ENABLED = 'true'
    process.env.UJIMU_COMPANIES_ENABLED = 'true'
    const enabled = await fetchHandler(handler, '/api/features')
    await expect(enabled.json()).resolves.toMatchObject({
      subscriptionsEnabled: true,
      companiesEnabled: true
    })
  })

  it('returns 404 for disabled subscription and company pages and APIs without blocking unrelated routes', async () => {
    delete process.env.UJIMU_SUBSCRIPTIONS_ENABLED
    delete process.env.UJIMU_COMPANIES_ENABLED
    const featureMiddleware = await import('../server/middleware/feature-flags').catch(() => undefined)
    expect(featureMiddleware?.default).toBeTypeOf('function')
    if (!featureMiddleware?.default) return

    const fetch = middlewareFetch(featureMiddleware.default)
    for (const path of [
      '/subscription',
      '/api/billing/status',
      '/companies',
      '/companies/company-1',
      '/api/companies',
      '/api/admin/companies',
      '/api/billing/corporate/checkout'
    ]) {
      expect((await fetch(new Request(`http://local${path}`))).status, path).toBe(404)
    }
    expect((await fetch(new Request('http://local/api/features'))).status).toBe(200)

    process.env.UJIMU_SUBSCRIPTIONS_ENABLED = 'true'
    process.env.UJIMU_COMPANIES_ENABLED = 'true'
    for (const path of ['/subscription', '/api/billing/status', '/companies', '/api/companies']) {
      expect((await fetch(new Request(`http://local${path}`))).status, path).toBe(200)
    }
  })

  it('preserves existing subscription and company behaviour only when the corresponding flag is true', async () => {
    const database = await createFlagDatabase()
    seedIndividualSubscription(database)
    const companyId = seedCompany(database)

    expect(resolveQuotaSubjectWithSubscription(
      database,
      { type: 'registered', id: 'user-1' },
      { now: new Date('2026-08-21T12:00:00.000Z'), env: {} }
    )).toEqual({ type: 'registered', id: 'user-1' })
    expect(resolveQuotaSubjectWithSubscription(
      database,
      { type: 'registered', id: 'user-1' },
      { now: new Date('2026-08-21T12:00:00.000Z'), env: { UJIMU_SUBSCRIPTIONS_ENABLED: 'true' } }
    )).toEqual({ type: 'subscribed', id: 'user-1' })

    expect(resolveSpecialistAccessSubjectFromUser(database, 'user-1', { env: {} })).toMatchObject({
      type: 'user',
      activeCompanyId: null
    })
    expect(resolveSpecialistAccessSubjectFromUser(database, 'user-1', {
      env: { UJIMU_COMPANIES_ENABLED: 'true' }
    })).toMatchObject({ type: 'user', activeCompanyId: companyId })
    database.close()
  })

  it('hides subscription, company, and upgrade controls when their flags are disabled', async () => {
    const [drawer, chat, profile, adminList, adminDetail] = await Promise.all([
      readFile('components/AppDrawer.vue', 'utf8'),
      readFile('pages/index.vue', 'utf8'),
      readFile('pages/account/profile.vue', 'utf8'),
      readFile('pages/admin/specialists/index.vue', 'utf8'),
      readFile('pages/admin/specialists/[id].vue', 'utf8')
    ])

    expect(drawer).toContain('subscriptionsEnabled')
    expect(chat).toContain(':subscriptions-enabled="subscriptionsEnabled"')
    expect(profile).toContain('companiesEnabled')
    expect(profile).toContain('subscriptionsEnabled')
    expect(adminList).toContain('companiesEnabled')
    expect(adminDetail).toContain('companiesEnabled')
  })
})

async function fetchHandler(handler: Parameters<typeof eventHandler>[0], path: string): Promise<Response> {
  const app = createApp()
  app.use(eventHandler(handler))
  return toWebHandler(app)(new Request(`http://local${path}`))
}

function middlewareFetch(middleware: Parameters<typeof eventHandler>[0]): (request: Request) => Promise<Response> {
  const app = createApp()
  app.use(eventHandler(middleware))
  app.use(eventHandler(() => ({ ok: true })))
  return toWebHandler(app)
}

async function createFlagDatabase(): Promise<DatabaseSync> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-launch-flags-'))
  const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-1', '2026-08-21T10:00:00.000Z')
  database.prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run('identity-1', 'user-1', 'email', 'user@example.com', '2026-08-21T10:00:00.000Z')
  return database
}

function seedIndividualSubscription(database: DatabaseSync): void {
  database.prepare(`
    INSERT INTO billing_payments (
      id, user_id, provider, method, plan_id, amount_cents, currency, status,
      provider_reference, checkout_url, created_at, confirmed_at
    ) VALUES (?, ?, 'appy_pay', 'multicaixa_reference', 'quarterly-public', 5000000, 'AOA', 'confirmed', ?, NULL, ?, ?)
  `).run('payment-1', 'user-1', 'provider-ref-1', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z')
  database.prepare(`
    INSERT INTO billing_subscriptions (
      id, user_id, plan_id, current_period_start, current_period_end,
      created_at, updated_at, last_payment_id
    ) VALUES (?, ?, 'quarterly-public', ?, ?, ?, ?, ?)
  `).run(
    'subscription-1',
    'user-1',
    '2026-08-20T10:00:00.000Z',
    '2026-12-20T10:00:00.000Z',
    '2026-08-20T10:00:00.000Z',
    '2026-08-20T10:00:00.000Z',
    'payment-1'
  )
}

function seedCompany(database: DatabaseSync): string {
  const company = createCompany(database, {
    nif: '5000000000',
    name: 'Empresa Flag',
    phone: '+244923000000',
    address: 'Luanda'
  })
  upsertCorporateSubscription(database, {
    companyId: company.id,
    seats: 2,
    currentPeriodStart: '2026-08-20T10:00:00.000Z',
    currentPeriodEnd: '2026-12-20T10:00:00.000Z'
  })
  replaceCompanyMemberships(database, {
    companyId: company.id,
    admins: ['user@example.com'],
    members: []
  })
  setActiveCompanyForUser(database, { userId: 'user-1', companyId: company.id })
  return company.id
}
