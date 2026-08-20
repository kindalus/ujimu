import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import adminSessionHandler from '../server/api/admin/session.get'
import devLoginStatusHandler from '../server/api/auth/dev-login.get'
import devLoginHandler from '../server/api/auth/dev-login.post'
import logoutHandler from '../server/api/auth/logout.post'
import { SESSION_COOKIE_NAME, verifySessionToken } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'

describe('development-only authentication acceptance', () => {
  it('logs in an allowlisted development contact and preserves admin authorization through UJIMU_ADMIN_CONTACTS', async () => {
    const dataDir = await createTempDataDir()
    const fetchDev = createDevAuthFetch(dataDir, {
      NODE_ENV: 'development',
      UJIMU_DEV_AUTH_ENABLED: 'true',
      UJIMU_DEV_USER_CONTACTS: 'ADMIN@Dev.Local, +244 923 000 000',
      UJIMU_ADMIN_CONTACTS: 'admin@dev.local'
    })

    const status = await fetchDev(new Request('http://local/api/auth/dev-login'))
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ enabled: true })

    const response = await fetchDev(jsonRequest('http://local/api/auth/dev-login', {
      method: 'POST',
      body: { channel: 'email', contact: ' ADMIN@DEV.LOCAL ' }
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      authenticated: boolean
      authMethod: string
      recentOtpAuthenticated: boolean
      user: { id: string; displayContact: string }
    }
    expect(payload).toMatchObject({
      authenticated: true,
      authMethod: 'unknown',
      recentOtpAuthenticated: false,
      user: { displayContact: 'admin@dev.local' }
    })

    const sessionCookie = readSessionCookie(response)
    expect(sessionCookie).toBeTruthy()
    expect(verifySessionToken(sessionCookie, { sessionSecret: 'dev-auth-test-secret' })).toMatchObject({
      userId: payload.user.id,
      authMethod: 'unknown'
    })

    const adminSession = await fetchDev(new Request('http://local/api/admin/session', {
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` })
    }))
    expect(adminSession.status).toBe(200)
    expect(await adminSession.json()).toMatchObject({ authenticated: true, admin: true })

    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    expect(readIdentityContacts(database, payload.user.id)).toEqual(['admin@dev.local'])
    database.close()
  })

  it('allows an allowlisted development phone contact without making that contact an admin unless admin allowlisted', async () => {
    const dataDir = await createTempDataDir()
    const fetchDev = createDevAuthFetch(dataDir, {
      NODE_ENV: 'development',
      UJIMU_DEV_AUTH_ENABLED: 'true',
      UJIMU_DEV_USER_CONTACTS: '+244 923 000 000',
      UJIMU_ADMIN_CONTACTS: 'admin@dev.local'
    })

    const response = await fetchDev(jsonRequest('http://local/api/auth/dev-login', {
      method: 'POST',
      body: { channel: 'phone', contact: '+244 923 000 000' }
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as { user: { displayContact: string } }
    expect(payload.user.displayContact).toBe('+244923000000')

    const adminSession = await fetchDev(new Request('http://local/api/admin/session', {
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${readSessionCookie(response)}` })
    }))
    expect(await adminSession.json()).toMatchObject({ authenticated: true, admin: false })
  })

  it('rejects contacts outside the development allowlist', async () => {
    const dataDir = await createTempDataDir()
    const fetchDev = createDevAuthFetch(dataDir, {
      NODE_ENV: 'development',
      UJIMU_DEV_AUTH_ENABLED: 'true',
      UJIMU_DEV_USER_CONTACTS: 'admin@dev.local'
    })

    const response = await fetchDev(jsonRequest('http://local/api/auth/dev-login', {
      method: 'POST',
      body: { channel: 'email', contact: 'other@dev.local' }
    }))

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('is disabled unless explicitly enabled and is always blocked in production', async () => {
    const disabledDataDir = await createTempDataDir()
    const disabledFetch = createDevAuthFetch(disabledDataDir, {
      NODE_ENV: 'development',
      UJIMU_DEV_USER_CONTACTS: 'admin@dev.local'
    })

    const disabledStatus = await disabledFetch(new Request('http://local/api/auth/dev-login'))
    expect(await disabledStatus.json()).toEqual({ enabled: false })

    const disabledPost = await disabledFetch(jsonRequest('http://local/api/auth/dev-login', {
      method: 'POST',
      body: { channel: 'email', contact: 'admin@dev.local' }
    }))
    expect(disabledPost.status).toBe(404)

    const productionDataDir = await createTempDataDir()
    const productionFetch = createDevAuthFetch(productionDataDir, {
      NODE_ENV: 'production',
      UJIMU_DEV_AUTH_ENABLED: 'true',
      UJIMU_DEV_USER_CONTACTS: 'admin@dev.local'
    })

    const productionStatus = await productionFetch(new Request('http://local/api/auth/dev-login'))
    expect(await productionStatus.json()).toEqual({ enabled: false })

    const productionPost = await productionFetch(jsonRequest('http://local/api/auth/dev-login', {
      method: 'POST',
      body: { channel: 'email', contact: 'admin@dev.local' }
    }))
    expect(productionPost.status).toBe(404)
    expect(productionPost.headers.get('set-cookie')).toBeNull()
  })

  it('stops honouring a session token after logout, even though the token itself is still unexpired', async () => {
    const dataDir = await createTempDataDir()
    const fetchDev = createDevAuthFetch(dataDir, {
      NODE_ENV: 'development',
      UJIMU_DEV_AUTH_ENABLED: 'true',
      UJIMU_DEV_USER_CONTACTS: 'admin@dev.local',
      UJIMU_ADMIN_CONTACTS: 'admin@dev.local'
    })

    const login = await fetchDev(jsonRequest('http://local/api/auth/dev-login', {
      method: 'POST',
      body: { channel: 'email', contact: 'admin@dev.local' }
    }))
    const sessionCookie = readSessionCookie(login)
    const cookieHeader = new Headers({ cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` })

    await expect(
      fetchDev(new Request('http://local/api/admin/session', { headers: cookieHeader })).then((r) => r.json())
    ).resolves.toMatchObject({ authenticated: true })

    const loggedOut = await fetchDev(new Request('http://local/api/auth/logout', {
      method: 'POST',
      headers: cookieHeader
    }))
    expect(loggedOut.status).toBe(200)

    // The token's signature and expiry are both still fine; only the server-side epoch changed.
    expect(verifySessionToken(sessionCookie, { sessionSecret: 'dev-auth-test-secret' })).toMatchObject({ epoch: 0 })

    await expect(
      fetchDev(new Request('http://local/api/admin/session', { headers: cookieHeader })).then((r) => r.json())
    ).resolves.toMatchObject({ authenticated: false, admin: false })
  })
})

async function createTempDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ujimu-dev-auth-'))
}

function createDevAuthFetch(dataDir: string, env: Record<string, string | undefined>): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/auth/dev-login', devLoginStatusHandler)
  router.post('/api/auth/dev-login', devLoginHandler)
  router.get('/api/admin/session', adminSessionHandler)
  router.post('/api/auth/logout', logoutHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => withEnv({
    UJIMU_DATA_DIR: dataDir,
    UJIMU_DB_PATH: join(dataDir, 'db', 'ujimu.sqlite'),
    UJIMU_SESSION_SECRET: 'dev-auth-test-secret',
    UJIMU_DEV_AUTH_ENABLED: undefined,
    UJIMU_DEV_USER_CONTACTS: undefined,
    UJIMU_ADMIN_CONTACTS: undefined,
    ...env
  }, () => fetch(request))
}

async function withEnv<T>(env: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await action()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function jsonRequest(url: string, options: { method?: string; body?: unknown } = {}): Request {
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function readSessionCookie(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  return header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1] ?? ''
}

function readIdentityContacts(database: DatabaseSync, userId: string): string[] {
  return database
    .prepare('SELECT contact FROM user_identities WHERE user_id = ? ORDER BY contact')
    .all(userId)
    .map((row) => (row as { contact: string }).contact)
}
