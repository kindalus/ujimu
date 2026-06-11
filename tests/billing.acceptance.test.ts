import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import billingStatusHandler from '../server/api/billing/status.get'
import billingCheckoutHandler from '../server/api/billing/checkout.post'
import corporateCheckoutHandler from '../server/api/billing/corporate/checkout.post'
import billingWebhookHandler from '../server/api/billing/webhooks/[provider].post'
import { createSessionToken } from '../server/utils/auth/session'
import {
  createBillingCheckout,
  getBillingStatus,
  getTrustedBillingProviderEventCount,
  processBillingWebhookEvent,
  resolveQuotaSubjectWithSubscription
} from '../server/utils/billing/subscriptions'
import { initializeDatabase } from '../server/utils/db'

describe('subscriptions, payments, and advertising acceptance', () => {
  it('lets only registered users create provider-valid quarterly checkouts for 50,000.00 AOA', async () => {
    const { dataDir } = await createTempBillingData()
    await seedUser(dataDir, 'billing-user')
    const fetchBilling = createBillingFetch(dataDir, { webhookSecret: 'billing-secret' })

    const anonymousCheckout = await fetchBilling(
      jsonRequest('http://local/api/billing/checkout', {
        method: 'POST',
        body: { provider: 'appy_pay', method: 'multicaixa_reference' }
      })
    )
    expect(anonymousCheckout.status).toBe(401)

    const invalidMethod = await fetchBilling(
      jsonRequest('http://local/api/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders('billing-user'),
        body: { provider: 'appy_pay', method: 'visa' }
      })
    )
    expect(invalidMethod.status).toBe(400)

    const appyPayCheckout = await fetchBilling(
      jsonRequest('http://local/api/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders('billing-user'),
        body: { provider: 'appy_pay', method: 'multicaixa_reference' }
      })
    )
    expect(appyPayCheckout.status).toBe(201)
    await expect(appyPayCheckout.json()).resolves.toMatchObject({
      checkout: {
        provider: 'appy_pay',
        method: 'multicaixa_reference',
        status: 'pending',
        amount: { value: '50000.00', currency: 'AOA' }
      }
    })

    const stripeCheckout = await fetchBilling(
      jsonRequest('http://local/api/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders('billing-user'),
        body: { provider: 'stripe', method: 'visa' }
      })
    )
    expect(stripeCheckout.status).toBe(201)
    await expect(stripeCheckout.json()).resolves.toMatchObject({
      checkout: { provider: 'stripe', method: 'visa', status: 'pending' }
    })

    const status = await fetchBilling(
      new Request('http://local/api/billing/status', { headers: sessionHeaders('billing-user') })
    )
    await expect(status.json()).resolves.toMatchObject({
      authenticated: true,
      subscribed: false,
      ads: { visible: true }
    })
  })

  it('confirms payments only through a secret-protected idempotent webhook and hides ads for active subscribers', async () => {
    const { dataDir } = await createTempBillingData()
    await seedUser(dataDir, 'billing-user')
    const fetchBilling = createBillingFetch(dataDir, { webhookSecret: 'billing-secret' })

    const checkoutResponse = await fetchBilling(
      jsonRequest('http://local/api/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders('billing-user'),
        body: { provider: 'appy_pay', method: 'qr_code' }
      })
    )
    const checkoutBody = (await checkoutResponse.json()) as { checkout: { id: string } }

    const missingSecretFetch = createBillingFetch(dataDir, { webhookSecret: undefined })
    const missingSecret = await missingSecretFetch(
      webhookRequest('http://local/api/billing/webhooks/appy_pay', {
        eventId: 'evt-missing-secret',
        paymentId: checkoutBody.checkout.id,
        status: 'confirmed',
        secret: 'billing-secret'
      })
    )
    expect(missingSecret.status).toBe(503)

    const wrongSecret = await fetchBilling(
      webhookRequest('http://local/api/billing/webhooks/appy_pay', {
        eventId: 'evt-wrong-secret',
        paymentId: checkoutBody.checkout.id,
        status: 'confirmed',
        secret: 'wrong-secret'
      })
    )
    expect(wrongSecret.status).toBe(401)
    expect(await readTrustedProviderEventCount(dataDir)).toBe(0)

    const confirmed = await fetchBilling(
      webhookRequest('http://local/api/billing/webhooks/appy_pay', {
        eventId: 'evt-confirmed',
        paymentId: checkoutBody.checkout.id,
        status: 'confirmed',
        secret: 'billing-secret'
      })
    )
    expect(confirmed.status).toBe(200)
    const confirmedBody = (await confirmed.json()) as { result: string; subscription: { active: boolean; expiresAt: string } }
    expect(confirmedBody).toMatchObject({ result: 'confirmed', subscription: { active: true } })

    const duplicate = await fetchBilling(
      webhookRequest('http://local/api/billing/webhooks/appy_pay', {
        eventId: 'evt-confirmed',
        paymentId: checkoutBody.checkout.id,
        status: 'confirmed',
        secret: 'billing-secret'
      })
    )
    await expect(duplicate.json()).resolves.toMatchObject({
      result: 'duplicate',
      subscription: { expiresAt: confirmedBody.subscription.expiresAt }
    })

    const repeatedPayment = await fetchBilling(
      webhookRequest('http://local/api/billing/webhooks/appy_pay', {
        eventId: 'evt-same-payment-new-event',
        paymentId: checkoutBody.checkout.id,
        status: 'confirmed',
        secret: 'billing-secret'
      })
    )
    await expect(repeatedPayment.json()).resolves.toMatchObject({
      result: 'already_confirmed',
      subscription: { expiresAt: confirmedBody.subscription.expiresAt }
    })

    const activeStatus = await fetchBilling(
      new Request('http://local/api/billing/status', { headers: sessionHeaders('billing-user') })
    )
    await expect(activeStatus.json()).resolves.toMatchObject({
      authenticated: true,
      subscribed: true,
      ads: { visible: false }
    })
    expect(await readTrustedProviderEventCount(dataDir)).toBe(2)
  })

  it('creates simulated corporate checkouts, activates companies immediately, and enriches billing status', async () => {
    const { dataDir } = await createTempBillingData()
    await seedUser(dataDir, 'buyer-user')
    await seedUserEmail(dataDir, 'buyer-user', 'buyer@example.com')
    await seedUser(dataDir, 'member-user')
    await seedUserEmail(dataDir, 'member-user', 'member@example.com')
    const fetchBilling = createBillingFetch(dataDir, { webhookSecret: 'billing-secret' })

    const anonymous = await fetchBilling(
      jsonRequest('http://local/api/billing/corporate/checkout', {
        method: 'POST',
        body: corporateCheckoutPayload()
      })
    )
    expect(anonymous.status).toBe(401)

    const created = await fetchBilling(
      jsonRequest('http://local/api/billing/corporate/checkout', {
        method: 'POST',
        headers: sessionHeaders('buyer-user'),
        body: corporateCheckoutPayload()
      })
    )
    expect(created.status).toBe(201)
    const createdBody = await created.json() as {
      checkout: { status: string; amount: { value: string; currency: string } }
      company: { id: string; nif: string }
      subscription: { active: boolean; seats: number; expiresAt: string }
      memberships: Array<{ email: string; role: string; userId: string | null }>
    }
    expect(createdBody).toMatchObject({
      checkout: { status: 'confirmed', amount: { value: '350000.00', currency: 'AOA' } },
      company: { nif: '5001234567' },
      subscription: { active: true, seats: 10 },
      memberships: expect.arrayContaining([
        expect.objectContaining({ email: 'buyer@example.com', role: 'admin', userId: 'buyer-user' }),
        expect.objectContaining({ email: 'ops@example.com', role: 'admin', userId: null }),
        expect.objectContaining({ email: 'member@example.com', role: 'member', userId: 'member-user' })
      ])
    })

    const status = await fetchBilling(
      new Request('http://local/api/billing/status', { headers: sessionHeaders('buyer-user') })
    )
    await expect(status.json()).resolves.toMatchObject({
      authenticated: true,
      subscribed: false,
      corporate: {
        subscribed: true,
        companies: [expect.objectContaining({ id: createdBody.company.id, role: 'admin', seats: 10, active: true })]
      },
      ads: { visible: false }
    })

    const renewed = await fetchBilling(
      jsonRequest('http://local/api/billing/corporate/checkout', {
        method: 'POST',
        headers: sessionHeaders('buyer-user'),
        body: { ...corporateCheckoutPayload(), seats: 12 }
      })
    )
    expect(renewed.status).toBe(201)
    const renewedBody = await renewed.json() as { company: { id: string }; subscription: { seats: number; expiresAt: string } }
    expect(renewedBody.company.id).toBe(createdBody.company.id)
    expect(renewedBody.subscription.seats).toBe(12)
    expect(new Date(renewedBody.subscription.expiresAt).getTime()).toBeGreaterThan(new Date(createdBody.subscription.expiresAt).getTime())

    const tooManyMembers = await fetchBilling(
      jsonRequest('http://local/api/billing/corporate/checkout', {
        method: 'POST',
        headers: sessionHeaders('buyer-user'),
        body: {
          ...corporateCheckoutPayload(),
          seats: 10,
          memberEmails: Array.from({ length: 11 }, (_, index) => `extra${index}@example.com`)
        }
      })
    )
    expect(tooManyMembers.status).toBe(400)
  })

  it('stacks renewals, expires without grace, warns near expiry, and resolves subscribed quota subjects', async () => {
    const database = await createTempDatabase()
    seedUserInDatabase(database, 'billing-user')
    const now = new Date('2026-05-16T12:00:00.000Z')

    const firstCheckout = createBillingCheckout(database, {
      userId: 'billing-user',
      provider: 'stripe',
      method: 'visa',
      now
    })
    const firstConfirmation = processBillingWebhookEvent(database, {
      provider: 'stripe',
      eventId: 'evt-first',
      paymentId: firstCheckout.id,
      status: 'confirmed',
      receivedAt: now
    })
    expect(firstConfirmation.subscription?.expiresAt).toBe('2026-08-16T12:00:00.000Z')

    const duplicateConfirmation = processBillingWebhookEvent(database, {
      provider: 'stripe',
      eventId: 'evt-first',
      paymentId: firstCheckout.id,
      status: 'confirmed',
      receivedAt: now
    })
    expect(duplicateConfirmation.result).toBe('duplicate')
    expect(duplicateConfirmation.subscription?.expiresAt).toBe('2026-08-16T12:00:00.000Z')

    const renewalCheckout = createBillingCheckout(database, {
      userId: 'billing-user',
      provider: 'stripe',
      method: 'visa',
      now: new Date('2026-06-16T12:00:00.000Z')
    })
    const renewal = processBillingWebhookEvent(database, {
      provider: 'stripe',
      eventId: 'evt-renewal',
      paymentId: renewalCheckout.id,
      status: 'confirmed',
      receivedAt: new Date('2026-06-16T12:00:00.000Z')
    })
    expect(renewal.subscription?.expiresAt).toBe('2026-11-16T12:00:00.000Z')

    const nearExpiry = getBillingStatus(database, {
      userId: 'billing-user',
      now: new Date('2026-11-10T12:00:00.000Z')
    })
    expect(nearExpiry).toMatchObject({
      authenticated: true,
      subscribed: true,
      ads: { visible: false },
      expiryWarning: { expiresAt: '2026-11-16T12:00:00.000Z' }
    })

    expect(
      resolveQuotaSubjectWithSubscription(database, { type: 'registered', id: 'billing-user' }, {
        now: new Date('2026-11-10T12:00:00.000Z')
      })
    ).toEqual({ type: 'subscribed', id: 'billing-user' })

    const atExpiry = getBillingStatus(database, {
      userId: 'billing-user',
      now: new Date('2026-11-16T12:00:00.000Z')
    })
    expect(atExpiry).toMatchObject({
      authenticated: true,
      subscribed: false,
      ads: { visible: true },
      expiryWarning: null
    })
    expect(
      resolveQuotaSubjectWithSubscription(database, { type: 'registered', id: 'billing-user' }, {
        now: new Date('2026-11-16T12:00:00.000Z')
      })
    ).toEqual({ type: 'registered', id: 'billing-user' })

    database.close()
  })
})

async function createTempBillingData(): Promise<{ dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-billing-'))
  return { dataDir }
}

async function createTempDatabase(): Promise<DatabaseSync> {
  const { dataDir } = await createTempBillingData()
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function openBillingDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function seedUser(dataDir: string, userId: string): Promise<void> {
  const database = await openBillingDatabase(dataDir)
  seedUserInDatabase(database, userId)
  database.close()
}

async function seedUserEmail(dataDir: string, userId: string, email: string): Promise<void> {
  const database = await openBillingDatabase(dataDir)
  database
    .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run(`${userId}-${email}`, userId, 'email', email, '2026-05-16T12:00:00.000Z')
  database.close()
}

function seedUserInDatabase(database: DatabaseSync, userId: string): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-05-16T12:00:00.000Z')
}

function createBillingFetch(
  dataDir: string,
  options: { webhookSecret: string | undefined }
): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/billing/status', billingStatusHandler)
  router.post('/api/billing/checkout', billingCheckoutHandler)
  router.post('/api/billing/corporate/checkout', corporateCheckoutHandler)
  router.post('/api/billing/webhooks/:provider', billingWebhookHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousWebhookSecret = process.env.UJIMU_BILLING_WEBHOOK_SECRET
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'billing-test-session-secret'
    restoreEnv('UJIMU_BILLING_WEBHOOK_SECRET', options.webhookSecret)

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_BILLING_WEBHOOK_SECRET', previousWebhookSecret)
    }
  }
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'billing-test-session-secret',
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

function corporateCheckoutPayload() {
  return {
    company: {
      nif: '5001234567',
      name: 'Empresa Exemplo',
      phone: '+244923000000',
      address: 'Rua Principal, Luanda'
    },
    seats: 10,
    adminEmails: ['ops@example.com'],
    memberEmails: ['member@example.com']
  }
}

function webhookRequest(
  url: string,
  input: { eventId: string; paymentId: string; status: 'confirmed'; secret: string }
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-ujimu-billing-secret': input.secret
  })
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ eventId: input.eventId, paymentId: input.paymentId, status: input.status })
  })
}

async function readTrustedProviderEventCount(dataDir: string): Promise<number> {
  const database = await openBillingDatabase(dataDir)
  const count = getTrustedBillingProviderEventCount(database)
  database.close()
  return count
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
