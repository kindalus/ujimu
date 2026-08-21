import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken, verifySessionToken } from '../server/utils/auth/session'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe('configured OTP provider availability acceptance', () => {
  it('reports SendGrid email and Twilio SMS independently from complete configuration', async () => {
    const notifications = await import('../server/utils/notifications/provider') as Record<string, unknown>
    expect(notifications.getOtpDeliveryCapabilities).toBeTypeOf('function')
    const getCapabilities = notifications.getOtpDeliveryCapabilities as (env: Record<string, string | undefined>) => { otpChannels: string[] }

    expect(getCapabilities({
      NODE_ENV: 'production',
      UJIMU_SENDGRID_API_KEY: 'sendgrid-key',
      UJIMU_SENDGRID_FROM_EMAIL: 'no-reply@example.com'
    })).toEqual({ otpChannels: ['email'] })
    expect(getCapabilities({
      NODE_ENV: 'production',
      UJIMU_TWILIO_ACCOUNT_SID: 'AC123',
      UJIMU_TWILIO_AUTH_TOKEN: 'twilio-token',
      UJIMU_TWILIO_FROM_PHONE: '+15551234567'
    })).toEqual({ otpChannels: ['phone'] })
    expect(getCapabilities({
      NODE_ENV: 'production',
      UJIMU_SENDGRID_API_KEY: 'sendgrid-key'
    })).toEqual({ otpChannels: [] })
    expect(getCapabilities({
      NODE_ENV: 'production',
      UJIMU_AUTH_FAKE_DELIVERY_ENABLED: 'true'
    })).toEqual({ otpChannels: [] })
    expect(getCapabilities({
      NODE_ENV: 'development',
      UJIMU_AUTH_FAKE_DELIVERY_ENABLED: 'true'
    })).toEqual({ otpChannels: ['email', 'phone'] })
  })

  it('uses one fail-closed provider selector and exposes only SMS for complete Verify configuration', async () => {
    const { getOtpDeliveryCapabilities } = await import('../server/utils/notifications/provider')
    const verifyEnv = {
      NODE_ENV: 'production',
      UJIMU_OTP_PROVIDER: 'twilio-verify',
      UJIMU_TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      UJIMU_TWILIO_AUTH_TOKEN: 'twilio-token',
      UJIMU_TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
      UJIMU_SENDGRID_API_KEY: 'ignored-sendgrid-key',
      UJIMU_SENDGRID_FROM_EMAIL: 'ignored@example.com',
      UJIMU_TWILIO_FROM_PHONE: '+15551234567'
    }

    expect(getOtpDeliveryCapabilities(verifyEnv)).toEqual({ otpChannels: ['phone'] })
    expect(getOtpDeliveryCapabilities({ ...verifyEnv, UJIMU_TWILIO_VERIFY_SERVICE_SID: '' })).toEqual({ otpChannels: [] })
    expect(getOtpDeliveryCapabilities({ ...verifyEnv, UJIMU_OTP_PROVIDER: 'disabled' })).toEqual({ otpChannels: [] })
    expect(getOtpDeliveryCapabilities({ ...verifyEnv, UJIMU_OTP_PROVIDER: 'typo' })).toEqual({ otpChannels: [] })
  })

  it('starts a phone verification through the configured Twilio Verify Service SID', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-request-'))
    configureVerifyEnv(dataDir)
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ status: 'pending' }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const handler = (await import('../server/api/auth/otp/request.post')).default
    const response = await postJson(handler, '/api/auth/otp/request', {
      channel: 'phone',
      contact: '+244 923 456 789'
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://verify.twilio.com/v2/Services/VA${'b'.repeat(32)}/Verifications`)
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Basic ${Buffer.from(`AC${'a'.repeat(32)}:twilio-token`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      }
    })
    expect(Object.fromEntries(new URLSearchParams(String(options?.body)))).toEqual({
      To: '+244923456789',
      Channel: 'sms'
    })
    expect(String(options?.body)).not.toContain('From')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('creates an administrator session only after Twilio Verify approves the code', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-approved-'))
    configureVerifyEnv(dataDir)
    process.env.UJIMU_ADMIN_CONTACTS = '+244923456789'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approved' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const requestHandler = (await import('../server/api/auth/otp/request.post')).default
    const verifyHandler = (await import('../server/api/auth/otp/verify.post')).default
    expect((await postJson(requestHandler, '/api/auth/otp/request', {
      channel: 'phone', contact: '+244923456789'
    })).status).toBe(200)

    const verifyResponse = await postJson(verifyHandler, '/api/auth/otp/verify', {
      channel: 'phone', contact: '+244923456789', code: '123456'
    })
    expect(verifyResponse.status).toBe(200)
    expect(await verifyResponse.json()).toMatchObject({
      authenticated: true,
      user: { displayContact: '+244923456789' }
    })
    const sessionCookie = verifyResponse.headers.get('set-cookie')
    expect(sessionCookie).toContain('ujimu_session=')

    const adminHandler = (await import('../server/api/admin/session.get')).default
    const adminApp = createApp()
    const adminRouter = createRouter()
    adminRouter.get('/api/admin/session', adminHandler)
    adminApp.use(adminRouter)
    const adminResponse = await toWebHandler(adminApp)(new Request('http://local/api/admin/session', {
      headers: { cookie: sessionCookie!.split(';', 1)[0]! }
    }))
    expect(await adminResponse.json()).toMatchObject({ authenticated: true, admin: true })

    const [url, options] = fetchMock.mock.calls[1]!
    expect(url).toBe(`https://verify.twilio.com/v2/Services/VA${'b'.repeat(32)}/VerificationCheck`)
    expect(Object.fromEntries(new URLSearchParams(String(options?.body)))).toEqual({
      To: '+244923456789',
      Code: '123456'
    })
  })

  it('rejects non-approved Verify checks without creating a session', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-rejected-'))
    configureVerifyEnv(dataDir)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const requestHandler = (await import('../server/api/auth/otp/request.post')).default
    const verifyHandler = (await import('../server/api/auth/otp/verify.post')).default
    await postJson(requestHandler, '/api/auth/otp/request', { channel: 'phone', contact: '+244923456789' })
    const response = await postJson(verifyHandler, '/api/auth/otp/verify', {
      channel: 'phone', contact: '+244923456789', code: '000000'
    })
    const text = await response.text()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(400)
    expect(text).toContain('Código inválido ou expirado.')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('treats an expired Twilio verification as an invalid code', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-expired-'))
    configureVerifyEnv(dataDir)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 201 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const requestHandler = (await import('../server/api/auth/otp/request.post')).default
    const verifyHandler = (await import('../server/api/auth/otp/verify.post')).default
    await postJson(requestHandler, '/api/auth/otp/request', { channel: 'phone', contact: '+244923456789' })
    const response = await postJson(verifyHandler, '/api/auth/otp/verify', {
      channel: 'phone', contact: '+244923456789', code: '123456'
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Código inválido ou expirado.')
  })

  it('returns generic errors for malformed Verify responses', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-errors-'))
    configureVerifyEnv(dataDir)
    const fetchMock = vi.fn(async () => new Response('provider-secret-detail', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const handler = (await import('../server/api/auth/otp/request.post')).default
    const response = await postJson(handler, '/api/auth/otp/request', {
      channel: 'phone', contact: '+244923456789'
    })
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).toContain('OTP_DELIVERY_FAILED')
    expect(text).not.toContain('provider-secret-detail')
  })

  it('returns a generic provider error when a Verify check has an unknown status', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-check-errors-'))
    configureVerifyEnv(dataDir)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'provider-secret-status' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const requestHandler = (await import('../server/api/auth/otp/request.post')).default
    const verifyHandler = (await import('../server/api/auth/otp/verify.post')).default
    await postJson(requestHandler, '/api/auth/otp/request', { channel: 'phone', contact: '+244923456789' })
    const response = await postJson(verifyHandler, '/api/auth/otp/verify', {
      channel: 'phone', contact: '+244923456789', code: '123456'
    })
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).toContain('OTP_DELIVERY_FAILED')
    expect(text).not.toContain('provider-secret-status')
  })

  it('returns a generic provider error when the Verify request times out', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-verify-timeout-'))
    configureVerifyEnv(dataDir)
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => { throw new DOMException('timed out', 'TimeoutError') })
    vi.stubGlobal('fetch', fetchMock)

    const handler = (await import('../server/api/auth/otp/request.post')).default
    const response = await postJson(handler, '/api/auth/otp/request', {
      channel: 'phone', contact: '+244923456789'
    })

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('OTP_DELIVERY_FAILED')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends email OTP through the documented SendGrid Mail Send request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 202 }))
    const notifications = await import('../server/utils/notifications/provider')
    const provider = notifications.createNotificationProviderFromEnv({
      NODE_ENV: 'production',
      UJIMU_SENDGRID_API_KEY: 'sendgrid-key',
      UJIMU_SENDGRID_FROM_EMAIL: 'no-reply@example.com',
      UJIMU_SENDGRID_FROM_NAME: 'Ujimu Angola'
    }, { fetch: fetchMock })

    await provider.deliverOtp({ channel: 'email', contact: 'user@example.com', code: '123456' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: 'Bearer sendgrid-key',
        'content-type': 'application/json'
      }
    })
    expect(JSON.parse(String(options?.body))).toEqual({
      personalizations: [{ to: [{ email: 'user@example.com' }] }],
      from: { email: 'no-reply@example.com', name: 'Ujimu Angola' },
      subject: 'Código de acesso Ujimu',
      content: [{ type: 'text/plain', value: 'O seu código de acesso Ujimu é 123456. Expira em 10 minutos.' }]
    })
  })

  it('sends phone OTP through the documented Twilio Messages request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 201 }))
    const notifications = await import('../server/utils/notifications/provider')
    const provider = notifications.createNotificationProviderFromEnv({
      NODE_ENV: 'production',
      UJIMU_TWILIO_ACCOUNT_SID: 'AC123',
      UJIMU_TWILIO_AUTH_TOKEN: 'twilio-token',
      UJIMU_TWILIO_FROM_PHONE: '+15551234567'
    }, { fetch: fetchMock })

    await provider.deliverOtp({ channel: 'phone', contact: '+244923456789', code: '654321' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Basic ${Buffer.from('AC123:twilio-token').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      }
    })
    expect(Object.fromEntries(new URLSearchParams(String(options?.body)))).toEqual({
      To: '+244923456789',
      From: '+15551234567',
      Body: 'O seu código de acesso Ujimu é 654321. Expira em 10 minutos.'
    })
  })

  it('does not expose provider response bodies when delivery fails', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('provider-secret-detail', { status: 401 }))
    const notifications = await import('../server/utils/notifications/provider')
    const provider = notifications.createNotificationProviderFromEnv({
      NODE_ENV: 'production',
      UJIMU_SENDGRID_API_KEY: 'sendgrid-key',
      UJIMU_SENDGRID_FROM_EMAIL: 'no-reply@example.com'
    }, { fetch: fetchMock })

    await expect(provider.deliverOtp({ channel: 'email', contact: 'user@example.com', code: '123456' }))
      .rejects.toMatchObject({ code: 'NOTIFICATION_PROVIDER_DELIVERY_FAILED', message: 'OTP delivery failed.' })
  })

  it('exposes Verify SMS publicly without exposing provider credentials', async () => {
    process.env.NODE_ENV = 'production'
    process.env.UJIMU_OTP_PROVIDER = 'twilio-verify'
    process.env.UJIMU_TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`
    process.env.UJIMU_TWILIO_AUTH_TOKEN = 'never-return-this-token'
    process.env.UJIMU_TWILIO_VERIFY_SERVICE_SID = `VA${'b'.repeat(32)}`
    const features = await import('../server/api/features.get').catch(() => undefined)
    expect(features?.default).toBeTypeOf('function')
    if (!features?.default) return

    const app = createApp()
    const router = createRouter()
    router.get('/api/features', features.default)
    app.use(router)
    const response = await toWebHandler(app)(new Request('http://local/api/features'))
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(text)).toMatchObject({ otpChannels: ['phone'] })
    expect(text).not.toContain('never-return-this-token')
    expect(text).not.toContain(`VA${'b'.repeat(32)}`)
  })

  it('keeps OTP login controls hidden when no delivery channel is configured', async () => {
    const [authModal, chatPage, routeChrome] = await Promise.all([
      readFile('components/AuthModal.vue', 'utf8'),
      readFile('pages/index.vue', 'utf8'),
      readFile('components/MockRouteChrome.vue', 'utf8')
    ])

    expect(authModal).toContain("fetch('/api/features')")
    expect(authModal).toContain("otpChannels.includes('email')")
    expect(authModal).toContain("otpChannels.includes('phone')")
    expect(chatPage).toContain('accountLoginAvailable')
    expect(chatPage).toContain("fetch('/api/features')")
    expect(chatPage).toContain('<span v-else-if="isAuthenticated" class="avatar"')
    expect(routeChrome).toContain('<span v-else-if="authSession.authenticated" class="avatar"')
  })

  it('preserves already valid account sessions when no OTP channel is configured', () => {
    const token = createSessionToken('existing-user', {
      sessionSecret: 'existing-session-secret',
      now: new Date('2026-08-21T12:00:00.000Z')
    })
    expect(verifySessionToken(token, {
      sessionSecret: 'existing-session-secret',
      now: new Date('2026-08-22T12:00:00.000Z')
    })).toMatchObject({ userId: 'existing-user' })
  })

  it('blocks passkey login when no OTP delivery channel is configured', async () => {
    process.env.NODE_ENV = 'production'
    process.env.UJIMU_PASSKEYS_ENABLED = 'true'
    process.env.UJIMU_PASSKEY_RP_ID = 'example.com'
    process.env.UJIMU_PASSKEY_RP_NAME = 'Ujimu'
    process.env.UJIMU_PASSKEY_ORIGIN = 'https://example.com'
    delete process.env.UJIMU_SENDGRID_API_KEY
    delete process.env.UJIMU_SENDGRID_FROM_EMAIL
    delete process.env.UJIMU_TWILIO_ACCOUNT_SID
    delete process.env.UJIMU_TWILIO_AUTH_TOKEN
    delete process.env.UJIMU_TWILIO_FROM_PHONE
    const handler = (await import('../server/api/auth/passkeys/authentication/options.post')).default
    const app = createApp()
    const router = createRouter()
    router.post('/api/auth/passkeys/authentication/options', handler)
    app.use(router)

    const response = await toWebHandler(app)(new Request('https://example.com/api/auth/passkeys/authentication/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }))
    expect(response.status).toBe(503)
  })

  it('rejects new OTP requests without configured channels while preserving the database', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-no-otp-provider-'))
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.NODE_ENV = 'production'
    delete process.env.UJIMU_SENDGRID_API_KEY
    delete process.env.UJIMU_SENDGRID_FROM_EMAIL
    delete process.env.UJIMU_TWILIO_ACCOUNT_SID
    delete process.env.UJIMU_TWILIO_AUTH_TOKEN
    delete process.env.UJIMU_TWILIO_FROM_PHONE

    const handler = (await import('../server/api/auth/otp/request.post')).default
    const app = createApp()
    const router = createRouter()
    router.post('/api/auth/otp/request', handler)
    app.use(router)
    const response = await toWebHandler(app)(new Request('http://local/api/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'email', contact: 'user@example.com' })
    }))

    expect(response.status).toBe(503)
  })
})

function configureVerifyEnv(dataDir: string): void {
  process.env.NODE_ENV = 'production'
  process.env.UJIMU_DATA_DIR = dataDir
  process.env.UJIMU_DB_PATH = join(dataDir, 'db', 'ujimu.sqlite')
  process.env.UJIMU_OTP_PROVIDER = 'twilio-verify'
  process.env.UJIMU_TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`
  process.env.UJIMU_TWILIO_AUTH_TOKEN = 'twilio-token'
  process.env.UJIMU_TWILIO_VERIFY_SERVICE_SID = `VA${'b'.repeat(32)}`
  process.env.UJIMU_SESSION_SECRET = 'test-session-secret'
  process.env.UJIMU_OTP_PEPPER = 'test-otp-pepper'
}

async function postJson(
  handler: Parameters<ReturnType<typeof createRouter>['post']>[1],
  path: string,
  body: unknown
): Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.post(path, handler)
  app.use(router)
  return toWebHandler(app)(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }))
}
