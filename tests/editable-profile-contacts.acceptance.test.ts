import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler, type EventHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import profileGetHandler from '../server/api/account/profile.get'
import profilePatchHandler from '../server/api/account/profile.patch'
import contactDeleteHandler from '../server/api/account/contacts/[id].delete'
import contactPrimaryHandler from '../server/api/account/contacts/[id]/primary.put'
import otpVerifyHandler from '../server/api/auth/otp/verify.post'
import sessionHandler from '../server/api/auth/session.get'
import { requestOtp } from '../server/utils/auth/otp'
import { createSessionToken, SESSION_COOKIE_NAME } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import type { NotificationProvider } from '../server/utils/notifications/provider'

const originalEnv = { ...process.env }
const sessionSecret = 'editable-profile-session-secret'
const otpPepper = 'editable-profile-otp-pepper'

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('editable profile and verified contacts acceptance', () => {
  it('returns contact metadata and persists a validated display name', async () => {
    const context = await createContext('profile-name')
    const user = seedUser(context.database, [
      { channel: 'email', contact: 'owner@example.com', primary: true },
      { channel: 'phone', contact: '+244923000000', primary: false }
    ])
    context.database.close()
    const cookie = sessionCookie(user.id, 'otp')

    let response = await callHandler(profileGetHandler, '/api/account/profile', 'GET', undefined, cookie)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      user: { id: user.id, displayName: null, displayContact: 'owner@example.com' },
      contacts: [
        { channel: 'email', contact: 'owner@example.com', primary: true },
        { channel: 'phone', contact: '+244923000000', primary: false }
      ]
    })

    response = await callHandler(profilePatchHandler, '/api/account/profile', 'PATCH', { displayName: '  Ana Manuel  ' }, cookie)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ displayName: 'Ana Manuel' })

    response = await callHandler(profileGetHandler, '/api/account/profile', 'GET', undefined, cookie)
    await expect(response.json()).resolves.toMatchObject({ user: { displayName: 'Ana Manuel' } })
    response = await callHandler(sessionHandler, '/api/auth/session', 'GET', undefined, cookie)
    await expect(response.json()).resolves.toMatchObject({ user: { displayName: 'Ana Manuel' } })

    let invalid = await callHandler(profilePatchHandler, '/api/account/profile', 'PATCH', { displayName: '<b>Ana</b>' }, cookie)
    expect(invalid.status).toBe(400)
    invalid = await callHandler(profilePatchHandler, '/api/account/profile', 'PATCH', { displayName: 'a'.repeat(101) }, cookie)
    expect(invalid.status).toBe(400)
    const cleared = await callHandler(profilePatchHandler, '/api/account/profile', 'PATCH', { displayName: '   ' }, cookie)
    expect(cleared.status).toBe(200)
    await expect(cleared.json()).resolves.toEqual({ displayName: null })
  })

  it('links an OTP-approved contact to the signed-in account and refuses another account contact', async () => {
    const context = await createContext('contact-link')
    const owner = seedUser(context.database, [{ channel: 'email', contact: 'owner@example.com', primary: true }])
    seedUser(context.database, [{ channel: 'email', contact: 'taken@example.com', primary: true }])
    await seedOtpChallenge(context.database, 'phone', '+244923000000', '123456')
    await seedOtpChallenge(context.database, 'email', 'taken@example.com', '654321')
    context.database.close()

    let response = await callHandler(otpVerifyHandler, '/api/auth/otp/verify', 'POST', {
      channel: 'phone', contact: '+244923000000', code: '123456'
    }, sessionCookie(owner.id, 'passkey'))
    expect(response.status).toBe(200)

    response = await callHandler(profileGetHandler, '/api/account/profile', 'GET', undefined, responseCookie(response))
    await expect(response.json()).resolves.toMatchObject({
      user: { id: owner.id, displayContact: 'owner@example.com' },
      contacts: expect.arrayContaining([
        expect.objectContaining({ contact: '+244923000000', primary: false })
      ])
    })

    const conflict = await callHandler(otpVerifyHandler, '/api/auth/otp/verify', 'POST', {
      channel: 'email', contact: 'taken@example.com', code: '654321'
    }, sessionCookie(owner.id, 'passkey'))
    expect(conflict.status).toBe(409)
    expect(conflict.headers.getSetCookie()).toEqual([])
    const unchanged = await callHandler(profileGetHandler, '/api/account/profile', 'GET', undefined, sessionCookie(owner.id, 'passkey'))
    expect((await unchanged.json()).contacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ contact: 'taken@example.com' })
    ]))
  })

  it('requires recent OTP and safeguards the primary and last contacts', async () => {
    const context = await createContext('contact-guards')
    const user = seedUser(context.database, [
      { channel: 'email', contact: 'owner@example.com', primary: true },
      { channel: 'phone', contact: '+244923000000', primary: false }
    ])
    const other = seedUser(context.database, [{ channel: 'email', contact: 'other@example.com', primary: true }])
    context.database.close()

    const stale = sessionCookie(user.id, 'otp', new Date(Date.now() - 16 * 60 * 1000))
    let response = await callHandler(
      contactPrimaryHandler,
      `/api/account/contacts/${user.identities[1]!.id}/primary`,
      'PUT',
      undefined,
      stale
    )
    expect(response.status).toBe(403)

    const recent = sessionCookie(user.id, 'otp')
    response = await callHandler(
      contactPrimaryHandler,
      `/api/account/contacts/${user.identities[1]!.id}/primary`,
      'PUT',
      undefined,
      recent
    )
    expect(response.status).toBe(200)

    const cannotDeletePrimary = await callHandler(
      contactDeleteHandler,
      `/api/account/contacts/${user.identities[1]!.id}`,
      'DELETE',
      undefined,
      recent
    )
    expect(cannotDeletePrimary.status).toBe(409)

    response = await callHandler(
      contactDeleteHandler,
      `/api/account/contacts/${user.identities[0]!.id}`,
      'DELETE',
      undefined,
      recent
    )
    expect(response.status).toBe(200)

    const cannotDeleteLast = await callHandler(
      contactDeleteHandler,
      `/api/account/contacts/${user.identities[1]!.id}`,
      'DELETE',
      undefined,
      recent
    )
    expect(cannotDeleteLast.status).toBe(409)

    const cannotChangeOtherUser = await callHandler(
      contactPrimaryHandler,
      `/api/account/contacts/${other.identities[0]!.id}/primary`,
      'PUT',
      undefined,
      recent
    )
    expect(cannotChangeOtherUser.status).toBe(404)
  })

  it('renders editable name and verified-contact controls in the profile page', async () => {
    const source = await readFile('pages/account/profile.vue', 'utf8')

    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain('Adicionar contacto')
    expect(source).toContain('Tornar principal')
    expect(source).toContain('Remover')
    expect(source).toContain('recentOtpAuthenticated')
    expect(source).not.toContain('placeholder="O seu nome" readonly')
  })
})

async function createContext(name: string): Promise<{ database: DatabaseSync }> {
  const dataDir = await mkdtemp(join(tmpdir(), `ujimu-${name}-`))
  process.env.UJIMU_DATA_DIR = dataDir
  process.env.UJIMU_DB_PATH = join(dataDir, 'db', 'ujimu.sqlite')
  process.env.UJIMU_SESSION_SECRET = sessionSecret
  process.env.UJIMU_OTP_PEPPER = otpPepper
  process.env.NODE_ENV = 'development'
  process.env.UJIMU_AUTH_FAKE_DELIVERY_ENABLED = 'true'
  return { database: await initializeDatabase({ dataDir, dbPath: process.env.UJIMU_DB_PATH }) }
}

function seedUser(
  database: DatabaseSync,
  contacts: Array<{ channel: 'email' | 'phone'; contact: string; primary: boolean }>
): { id: string; identities: Array<{ id: string }> } {
  const id = randomUUID()
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(id, new Date().toISOString())
  const identities = contacts.map((contact, index) => {
    const identityId = randomUUID()
    database.prepare(`
      INSERT INTO user_identities (id, user_id, channel, contact, verified_at, is_primary)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(identityId, id, contact.channel, contact.contact, new Date(Date.now() + index).toISOString(), contact.primary ? 1 : 0)
    return { id: identityId }
  })
  return { id, identities }
}

async function seedOtpChallenge(
  database: DatabaseSync,
  channel: 'email' | 'phone',
  contact: string,
  code: string
): Promise<void> {
  const provider: NotificationProvider = { deliverOtp: vi.fn(async () => undefined) }
  await requestOtp(database, { channel, contact }, { provider, generateCode: () => code, pepper: otpPepper })
}

function sessionCookie(userId: string, authMethod: 'otp' | 'passkey', now = new Date()): string {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(userId, { sessionSecret, authMethod, now })}`
}

function responseCookie(response: Response): string {
  const value = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!value) throw new Error('missing session cookie')
  return value.split(';', 1)[0]!
}

async function callHandler(
  handler: EventHandler,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  cookie?: string
): Promise<Response> {
  const app = createApp()
  const router = createRouter()
  const route = path.includes('/contacts/')
    ? (method === 'PUT' ? '/api/account/contacts/:id/primary' : '/api/account/contacts/:id')
    : path
  if (method === 'GET') router.get(route, handler)
  if (method === 'POST') router.post(route, handler)
  if (method === 'PATCH') router.patch(route, handler)
  if (method === 'PUT') router.put(route, handler)
  if (method === 'DELETE') router.delete(route, handler)
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
