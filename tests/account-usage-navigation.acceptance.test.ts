import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler, type EventHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import otpVerifyHandler from '../server/api/auth/otp/verify.post'
import sessionHandler from '../server/api/auth/session.get'
import { requestOtp } from '../server/utils/auth/otp'
import { initializeDatabase } from '../server/utils/db'
import { ANONYMOUS_QUOTA_COOKIE_NAME } from '../server/utils/quota/identity'
import { evaluateAndRecordQuota } from '../server/utils/quota/usage'
import { signCookieValue } from '../server/utils/security/signed-cookie'
import type { NotificationProvider } from '../server/utils/notifications/provider'

const originalEnv = { ...process.env }
const sessionSecret = 'usage-navigation-session-secret'
const otpPepper = 'usage-navigation-otp-pepper'

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('account usage and admin navigation acceptance', () => {
  it('reports persisted anonymous quota usage through the canonical session endpoint', async () => {
    const context = await createContext('anonymous-session')
    recordAnonymousQuestion(context.database, 'anonymous-browser')
    context.database.close()

    const response = await getSession(context, anonymousCookie('anonymous-browser'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      authenticated: false,
      admin: false,
      quota: {
        exempt: false,
        daily: { limit: 10, used: 1 },
        weekly: { limit: 40, used: 1 }
      }
    })
  })

  it('attributes anonymous usage once after OTP login while preserving anonymous usage after logout', async () => {
    const context = await createContext('otp-attribution')
    recordAnonymousQuestion(context.database, 'anonymous-browser')
    await seedOtpChallenge(context.database, 'user@example.com', '123456')
    context.database.close()

    const login = await postJson(otpVerifyHandler, '/api/auth/otp/verify', {
      channel: 'email', contact: 'user@example.com', code: '123456'
    }, anonymousCookie('anonymous-browser'))
    expect(login.status).toBe(200)
    const sessionCookie = responseCookie(login, 'ujimu_session')

    const registered = await getSession(context, `${anonymousCookie('anonymous-browser')}; ${sessionCookie}`)
    await expect(registered.json()).resolves.toMatchObject({
      authenticated: true,
      admin: false,
      quota: { daily: { limit: 40, used: 1 }, weekly: { limit: 200, used: 1 } }
    })

    const anonymousAgain = await getSession(context, anonymousCookie('anonymous-browser'))
    await expect(anonymousAgain.json()).resolves.toMatchObject({
      authenticated: false,
      quota: { daily: { limit: 10, used: 1 }, weekly: { limit: 40, used: 1 } }
    })
  })

  it('does not attribute anonymous usage to administrators and reports their exemption', async () => {
    const context = await createContext('admin-exemption')
    process.env.UJIMU_ADMIN_CONTACTS = 'admin@example.com'
    recordAnonymousQuestion(context.database, 'admin-browser')
    await seedOtpChallenge(context.database, 'admin@example.com', '654321')
    context.database.close()

    const login = await postJson(otpVerifyHandler, '/api/auth/otp/verify', {
      channel: 'email', contact: 'admin@example.com', code: '654321'
    }, anonymousCookie('admin-browser'))
    expect(login.status).toBe(200)

    const session = await getSession(context, `${anonymousCookie('admin-browser')}; ${responseCookie(login, 'ujimu_session')}`)
    await expect(session.json()).resolves.toMatchObject({
      authenticated: true,
      admin: true,
      quota: { exempt: true }
    })

    const anonymousAgain = await getSession(context, anonymousCookie('admin-browser'))
    await expect(anonymousAgain.json()).resolves.toMatchObject({ quota: { daily: { used: 1 } } })
  })

  it('uses the shared login completion path for OTP, passkey, and development login', async () => {
    const sources = await Promise.all([
      readFile('server/api/auth/otp/verify.post.ts', 'utf8'),
      readFile('server/api/auth/passkeys/authentication/verify.post.ts', 'utf8'),
      readFile('server/api/auth/dev-login.post.ts', 'utf8')
    ])

    for (const source of sources) {
      expect(source).toContain('completeLogin')
    }
  })

  it('renders real quota state and admin navigation only for administrators', async () => {
    const [home, routeChrome, drawer] = await Promise.all([
      readFile('pages/index.vue', 'utf8'),
      readFile('components/MockRouteChrome.vue', 'utf8'),
      readFile('components/AppDrawer.vue', 'utf8')
    ])

    expect(home).not.toContain('0/{{ isAuthenticated ? 40 : 10 }} hoje')
    expect(routeChrome).not.toContain('0/{{ authSession.authenticated ? 40 : 10 }} hoje')
    expect(home).toContain('quotaLabel')
    expect(routeChrome).toContain('quotaLabel')
    expect(home).toContain(':is-admin="authSession.admin"')
    expect(routeChrome).toContain(':is-admin="authSession.admin"')
    expect(home).toContain("fetch(`/api/auth/session?timezone=${encodeURIComponent(clientTimezone())}`)")
    expect(home).toMatch(/fetch\('\/api\/chat'[\s\S]*void loadAuthSession\(\)/)
    expect(drawer).toContain('isAdmin?: boolean')
    expect(drawer).toContain('v-if="isAdmin"')
    expect(routeChrome).toContain('<aside v-if="authSession.admin"')
  })
})

async function createContext(name: string): Promise<{ dataDir: string; database: DatabaseSync }> {
  const dataDir = await mkdtemp(join(tmpdir(), `ujimu-${name}-`))
  process.env.UJIMU_DATA_DIR = dataDir
  process.env.UJIMU_DB_PATH = join(dataDir, 'db', 'ujimu.sqlite')
  process.env.UJIMU_SESSION_SECRET = sessionSecret
  process.env.UJIMU_OTP_PEPPER = otpPepper
  process.env.NODE_ENV = 'development'
  process.env.UJIMU_AUTH_FAKE_DELIVERY_ENABLED = 'true'
  delete process.env.UJIMU_ADMIN_CONTACTS
  return {
    dataDir,
    database: await initializeDatabase({ dataDir, dbPath: process.env.UJIMU_DB_PATH })
  }
}

function recordAnonymousQuestion(database: DatabaseSync, id: string): void {
  const result = evaluateAndRecordQuota(database, {
    subject: { type: 'anonymous', id },
    specialistId: 'iva',
    userTimezone: 'UTC',
    occurredAt: new Date()
  })
  expect(result).toEqual({ allowed: true })
}

async function seedOtpChallenge(database: DatabaseSync, contact: string, code: string): Promise<void> {
  const provider: NotificationProvider = { deliverOtp: vi.fn(async () => undefined) }
  await requestOtp(database, { channel: 'email', contact }, {
    provider,
    generateCode: () => code,
    pepper: otpPepper
  })
}

function anonymousCookie(id: string): string {
  return `${ANONYMOUS_QUOTA_COOKIE_NAME}=${signCookieValue(id, sessionSecret)}`
}

async function getSession(context: { dataDir: string }, cookie: string): Promise<Response> {
  process.env.UJIMU_DATA_DIR = context.dataDir
  process.env.UJIMU_DB_PATH = join(context.dataDir, 'db', 'ujimu.sqlite')
  return callHandler(sessionHandler, '/api/auth/session?timezone=UTC', 'GET', undefined, cookie)
}

async function postJson(handler: EventHandler, path: string, body: unknown, cookie: string): Promise<Response> {
  return callHandler(handler, path, 'POST', body, cookie)
}

async function callHandler(
  handler: EventHandler,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  cookie?: string
): Promise<Response> {
  const app = createApp()
  const router = createRouter()
  if (method === 'GET') router.get(path.split('?')[0]!, handler)
  else router.post(path, handler)
  app.use(router)
  return toWebHandler(app)(new Request(`http://local${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }))
}

function responseCookie(response: Response, name: string): string {
  const value = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))
  if (!value) throw new Error(`missing ${name} cookie`)
  return value.split(';', 1)[0]!
}
