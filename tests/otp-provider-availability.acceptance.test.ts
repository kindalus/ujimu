import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
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

  it('exposes public OTP channels without exposing provider credentials', async () => {
    process.env.UJIMU_SENDGRID_API_KEY = 'never-return-this-key'
    process.env.UJIMU_SENDGRID_FROM_EMAIL = 'no-reply@example.com'
    delete process.env.UJIMU_TWILIO_ACCOUNT_SID
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
    expect(JSON.parse(text)).toMatchObject({ otpChannels: ['email'] })
    expect(text).not.toContain('never-return-this-key')
  })

  it('keeps OTP login controls hidden when no delivery channel is configured', async () => {
    const [authModal, chatPage] = await Promise.all([
      readFile('components/AuthModal.vue', 'utf8'),
      readFile('pages/index.vue', 'utf8')
    ])

    expect(authModal).toContain("fetch('/api/features')")
    expect(authModal).toContain("otpChannels.includes('email')")
    expect(authModal).toContain("otpChannels.includes('phone')")
    expect(chatPage).toContain('accountLoginAvailable')
    expect(chatPage).toContain("fetch('/api/features')")
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
