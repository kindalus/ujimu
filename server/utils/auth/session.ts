import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie, type H3Event } from 'h3'
import type { DatabaseSync } from 'node:sqlite'

export const SESSION_COOKIE_NAME = 'ujimu_session'
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30

export type SessionAuthMethod = 'otp' | 'passkey' | 'unknown'

export interface SessionClaims {
  userId: string
  issuedAt: Date
  expiresAt: Date
  authMethod: SessionAuthMethod
  epoch: number
}

export interface SessionOptions {
  now?: Date
  sessionSecret?: string
  authMethod?: Exclude<SessionAuthMethod, 'unknown'>
  epoch?: number
}

export interface SessionCookieOptions extends SessionOptions {
  isProduction?: boolean
}

let generatedSessionSecret: string | undefined

export function createSessionToken(userId: string, options: SessionOptions = {}): string {
  const now = options.now ?? new Date()
  const issuedAt = Math.floor(now.getTime() / 1000)
  const expiresAt = issuedAt + SESSION_DURATION_SECONDS
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: userId,
    iat: issuedAt,
    exp: expiresAt,
    typ: 'session',
    epc: options.epoch ?? 0,
    ...(options.authMethod ? { authMethod: options.authMethod } : {})
  }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = sign(`${encodedHeader}.${encodedPayload}`, resolveSessionSecret(options.sessionSecret))

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

export function verifySessionToken(
  token: string | undefined,
  options: SessionOptions = {}
): SessionClaims | undefined {
  if (!token) return undefined

  const parts = token.split('.')
  if (parts.length !== 3) return undefined

  const [encodedHeader, encodedPayload, signature] = parts
  if (!encodedHeader || !encodedPayload || !signature) return undefined

  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, resolveSessionSecret(options.sessionSecret))
  if (!timingSafeEqualString(signature, expectedSignature)) return undefined

  const payload = parseJson(base64UrlDecode(encodedPayload)) as Partial<{
    sub: string
    iat: number
    exp: number
    typ: string
    epc: number
    authMethod: SessionAuthMethod
  }> | undefined
  if (!payload || payload.typ !== 'session' || !payload.sub || !payload.iat || !payload.exp) {
    return undefined
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (payload.exp <= nowSeconds) {
    return undefined
  }

  return {
    userId: payload.sub,
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
    authMethod: payload.authMethod === 'otp' || payload.authMethod === 'passkey'
      ? payload.authMethod
      : 'unknown',
    epoch: typeof payload.epc === 'number' ? payload.epc : 0
  }
}

/**
 * A valid signature is not enough: the token also has to carry the user's current session epoch.
 * Logging out (or removing a passkey) bumps that epoch, which is what makes older tokens stop
 * working instead of staying valid until they expire.
 */
export function readSessionFromEvent(
  event: H3Event,
  database: DatabaseSync,
  options: SessionOptions = {}
): SessionClaims | undefined {
  const claims = verifySessionToken(getCookie(event, SESSION_COOKIE_NAME), options)
  if (!claims) return undefined

  // Users with no stored row have no revocations to honour; callers that need a real user still
  // check separately. Anything else must match the epoch the token was minted with.
  return claims.epoch === (readSessionEpoch(database, claims.userId) ?? 0) ? claims : undefined
}

export function readSessionEpoch(database: DatabaseSync, userId: string): number | undefined {
  const row = database
    .prepare('SELECT session_epoch FROM users WHERE id = ?')
    .get(userId) as { session_epoch: number } | undefined

  return row?.session_epoch
}

export function revokeUserSessions(database: DatabaseSync, userId: string): void {
  database.prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?').run(userId)
}

export function setSessionCookie(event: H3Event, token: string, options: SessionCookieOptions = {}): void {
  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: options.isProduction ?? process.env.NODE_ENV === 'production',
    maxAge: SESSION_DURATION_SECONDS,
    path: '/'
  })
}

export function resolveSessionSecret(explicitSecret?: string): string {
  if (explicitSecret) return explicitSecret
  if (process.env.UJIMU_SESSION_SECRET) return process.env.UJIMU_SESSION_SECRET
  generatedSessionSecret ??= randomBytes(32).toString('hex')
  return generatedSessionSecret
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
