import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { createSessionToken, readSessionEpoch } from './session'
import type { NotificationProvider, OtpDeliveryChannel } from '../notifications/provider'
import { NotificationProviderConfigurationError } from '../notifications/provider'

export type OtpChannel = OtpDeliveryChannel

export const GENERIC_OTP_REQUEST_MESSAGE = 'Se o contacto estiver correcto, enviaremos um código de acesso.'
export const GENERIC_OTP_FAILURE_MESSAGE = 'Código inválido ou expirado.'
export const OTP_DELIVERY_FAILURE_MESSAGE = 'Não foi possível enviar o código neste momento. Tente novamente mais tarde.'
export const OTP_RATE_LIMIT_MESSAGE = 'Demasiados pedidos de código. Aguarde alguns minutos antes de tentar de novo.'

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5

/**
 * Per-challenge attempts alone cannot stop brute force, because every new request starts a fresh
 * challenge with a zeroed counter. These windows bound requests and cumulative failures instead.
 */
export const OTP_CONTACT_REQUEST_LIMIT = 3
export const OTP_CONTACT_REQUEST_WINDOW_MS = 15 * 60 * 1000
export const OTP_IP_REQUEST_LIMIT = 10
export const OTP_IP_REQUEST_WINDOW_MS = 60 * 60 * 1000
export const OTP_CONTACT_FAILURE_LIMIT = 10
export const OTP_CONTACT_FAILURE_WINDOW_MS = 60 * 60 * 1000
const OTP_RETENTION_MS = 24 * 60 * 60 * 1000

let generatedOtpPepper: string | undefined

export interface OtpRequestInput {
  channel: OtpChannel
  contact: string
}

export interface OtpVerifyInput extends OtpRequestInput {
  code: string
}

export interface RequestOtpOptions {
  provider: NotificationProvider
  now?: Date
  generateCode?: () => string
  pepper?: string
  requestIp?: string
}

export interface VerifyOtpOptions {
  now?: Date
  pepper?: string
  sessionSecret?: string
  currentUserId?: string
}

export interface AuthenticatedUser {
  id: string
  displayContact: string
}

export interface VerifyOtpResult {
  user: AuthenticatedUser
  sessionToken: string
}

export class OtpValidationError extends Error {
  public readonly statusCode = 400
  public readonly code = 'INVALID_OTP_REQUEST'

  constructor(message = 'Pedido inválido.') {
    super(message)
    this.name = 'OtpValidationError'
  }
}

export class OtpVerificationError extends Error {
  public readonly statusCode = 400
  public readonly code = 'INVALID_OTP_CODE'

  constructor() {
    super(GENERIC_OTP_FAILURE_MESSAGE)
    this.name = 'OtpVerificationError'
  }
}

export class OtpRateLimitError extends Error {
  public readonly statusCode = 429
  public readonly code = 'OTP_RATE_LIMITED'

  constructor(message = OTP_RATE_LIMIT_MESSAGE) {
    super(message)
    this.name = 'OtpRateLimitError'
  }
}

export class OtpDeliveryError extends Error {
  public readonly statusCode = 503
  public readonly code = 'OTP_DELIVERY_FAILED'

  constructor(message = OTP_DELIVERY_FAILURE_MESSAGE) {
    super(message)
    this.name = 'OtpDeliveryError'
  }
}

export async function requestOtp(
  database: DatabaseSync,
  input: OtpRequestInput,
  options: RequestOtpOptions
): Promise<{ message: string }> {
  const normalized = normalizeOtpContact(input)
  const now = options.now ?? new Date()
  const requestIpHash = options.requestIp ? hashRequestIp(options.requestIp) : undefined

  purgeExpiredOtpChallenges(database, now)
  assertRequestRateLimit(database, normalized, requestIpHash, now)

  const code = (options.generateCode ?? generateOtpCode)()
  const codeHash = hashOtpCode(code, options.pepper)
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS)
  const challengeId = randomUUID()

  database.exec('BEGIN')
  try {
    database
      .prepare(`
        UPDATE otp_challenges
        SET invalidated_at = ?
        WHERE channel = ?
          AND contact = ?
          AND used_at IS NULL
          AND invalidated_at IS NULL
      `)
      .run(now.toISOString(), normalized.channel, normalized.contact)

    database
      .prepare(`
        INSERT INTO otp_challenges (
          id,
          channel,
          contact,
          code_hash,
          created_at,
          expires_at,
          attempts,
          max_attempts,
          request_ip_hash
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        challengeId,
        normalized.channel,
        normalized.contact,
        codeHash,
        now.toISOString(),
        expiresAt.toISOString(),
        OTP_MAX_ATTEMPTS,
        requestIpHash ?? null
      )

    await options.provider.deliverOtp({
      channel: normalized.channel,
      contact: normalized.contact,
      code
    })

    database.exec('COMMIT')
    return { message: GENERIC_OTP_REQUEST_MESSAGE }
  } catch (error) {
    database.exec('ROLLBACK')

    if (error instanceof OtpValidationError) {
      throw error
    }

    if (error instanceof NotificationProviderConfigurationError) {
      throw new OtpDeliveryError()
    }

    throw new OtpDeliveryError()
  }
}

export async function verifyOtp(
  database: DatabaseSync,
  input: OtpVerifyInput,
  options: VerifyOtpOptions = {}
): Promise<VerifyOtpResult> {
  const normalized = normalizeOtpContact(input)
  const code = input.code.trim()
  if (!/^\d{6}$/.test(code)) {
    throw new OtpVerificationError()
  }

  const now = options.now ?? new Date()
  assertVerifyRateLimit(database, normalized, now)

  const challenge = getActiveChallenge(database, normalized)

  if (!challenge) {
    throw new OtpVerificationError()
  }

  if (
    new Date(challenge.expires_at).getTime() <= now.getTime() ||
    challenge.attempts >= challenge.max_attempts
  ) {
    throw new OtpVerificationError()
  }

  if (!matchesCodeHash(challenge.code_hash, hashOtpCode(code, options.pepper))) {
    database
      .prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?')
      .run(challenge.id)
    throw new OtpVerificationError()
  }

  const user = upsertVerifiedIdentity(database, normalized, options.currentUserId, now)

  database
    .prepare('UPDATE otp_challenges SET used_at = ? WHERE id = ?')
    .run(now.toISOString(), challenge.id)

  return {
    user,
    sessionToken: createSessionToken(user.id, {
      now,
      sessionSecret: options.sessionSecret,
      authMethod: 'otp',
      epoch: readSessionEpoch(database, user.id) ?? 0
    })
  }
}

export function normalizeOtpContact(input: OtpRequestInput): { channel: OtpChannel; contact: string } {
  if (input.channel === 'email') {
    const contact = input.contact.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      throw new OtpValidationError('Contacto inválido.')
    }
    return { channel: 'email', contact }
  }

  if (input.channel === 'phone') {
    const contact = input.contact.replace(/\s+/g, '')
    if (!/^\+[1-9]\d{7,14}$/.test(contact)) {
      throw new OtpValidationError('Contacto inválido.')
    }
    return { channel: 'phone', contact }
  }

  throw new OtpValidationError('Canal inválido.')
}

export function getActiveOtpChallengeCount(database: DatabaseSync, input: OtpRequestInput): number {
  const normalized = normalizeOtpContact(input)
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM otp_challenges
      WHERE channel = ?
        AND contact = ?
        AND used_at IS NULL
        AND invalidated_at IS NULL
    `)
    .get(normalized.channel, normalized.contact) as { count: number }
  return row.count
}

export function getPublicSessionUser(database: DatabaseSync, userId: string): AuthenticatedUser | undefined {
  const row = database
    .prepare(`
      SELECT users.id AS id, user_identities.contact AS displayContact
      FROM users
      JOIN user_identities ON user_identities.user_id = users.id
      WHERE users.id = ?
      ORDER BY user_identities.verified_at ASC
      LIMIT 1
    `)
    .get(userId) as { id: string; displayContact: string } | undefined

  return row ? { id: row.id, displayContact: row.displayContact } : undefined
}

function getActiveChallenge(
  database: DatabaseSync,
  input: { channel: OtpChannel; contact: string }
): {
  id: string
  code_hash: string
  expires_at: string
  attempts: number
  max_attempts: number
} | undefined {
  return database
    .prepare(`
      SELECT id, code_hash, expires_at, attempts, max_attempts
      FROM otp_challenges
      WHERE channel = ?
        AND contact = ?
        AND used_at IS NULL
        AND invalidated_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(input.channel, input.contact) as {
      id: string
      code_hash: string
      expires_at: string
      attempts: number
      max_attempts: number
    } | undefined
}

function upsertVerifiedIdentity(
  database: DatabaseSync,
  input: { channel: OtpChannel; contact: string },
  currentUserId: string | undefined,
  now: Date
): AuthenticatedUser {
  const existing = database
    .prepare('SELECT user_id FROM user_identities WHERE channel = ? AND contact = ?')
    .get(input.channel, input.contact) as { user_id: string } | undefined

  const userId = existing?.user_id ?? currentUserId ?? createUser(database, now)

  if (!existing) {
    database
      .prepare(`
        INSERT INTO user_identities (id, user_id, channel, contact, verified_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), userId, input.channel, input.contact, now.toISOString())
  }

  return {
    id: userId,
    displayContact: input.contact
  }
}

function createUser(database: DatabaseSync, now: Date): string {
  const userId = randomUUID()
  database
    .prepare('INSERT INTO users (id, created_at) VALUES (?, ?)')
    .run(userId, now.toISOString())
  return userId
}

function assertRequestRateLimit(
  database: DatabaseSync,
  normalized: { channel: OtpChannel; contact: string },
  requestIpHash: string | undefined,
  now: Date
): void {
  const contactSince = new Date(now.getTime() - OTP_CONTACT_REQUEST_WINDOW_MS).toISOString()
  const contactCount = database
    .prepare('SELECT COUNT(*) AS count FROM otp_challenges WHERE channel = ? AND contact = ? AND created_at >= ?')
    .get(normalized.channel, normalized.contact, contactSince) as { count: number }

  if (contactCount.count >= OTP_CONTACT_REQUEST_LIMIT) {
    throw new OtpRateLimitError()
  }

  if (!requestIpHash) return

  const ipSince = new Date(now.getTime() - OTP_IP_REQUEST_WINDOW_MS).toISOString()
  const ipCount = database
    .prepare('SELECT COUNT(*) AS count FROM otp_challenges WHERE request_ip_hash = ? AND created_at >= ?')
    .get(requestIpHash, ipSince) as { count: number }

  if (ipCount.count >= OTP_IP_REQUEST_LIMIT) {
    throw new OtpRateLimitError()
  }
}

function assertVerifyRateLimit(
  database: DatabaseSync,
  normalized: { channel: OtpChannel; contact: string },
  now: Date
): void {
  const since = new Date(now.getTime() - OTP_CONTACT_FAILURE_WINDOW_MS).toISOString()
  const failures = database
    .prepare(`
      SELECT COALESCE(SUM(attempts), 0) AS failures
      FROM otp_challenges
      WHERE channel = ? AND contact = ? AND created_at >= ?
    `)
    .get(normalized.channel, normalized.contact, since) as { failures: number }

  if (failures.failures >= OTP_CONTACT_FAILURE_LIMIT) {
    throw new OtpRateLimitError()
  }
}

function purgeExpiredOtpChallenges(database: DatabaseSync, now: Date): void {
  database
    .prepare('DELETE FROM otp_challenges WHERE expires_at < ?')
    .run(new Date(now.getTime() - OTP_RETENTION_MS).toISOString())
}

function matchesCodeHash(stored: string, candidate: string): boolean {
  const storedBuffer = Buffer.from(stored, 'hex')
  const candidateBuffer = Buffer.from(candidate, 'hex')
  return storedBuffer.length === candidateBuffer.length && timingSafeEqual(storedBuffer, candidateBuffer)
}

function hashRequestIp(ip: string): string {
  return createHash('sha256').update(ip.trim()).digest('hex')
}

function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashOtpCode(code: string, explicitPepper?: string): string {
  return createHash('sha256')
    .update(`${resolveOtpPepper(explicitPepper)}:${code}`)
    .digest('hex')
}

function resolveOtpPepper(explicitPepper?: string): string {
  if (explicitPepper) return explicitPepper
  if (process.env.UJIMU_OTP_PEPPER) return process.env.UJIMU_OTP_PEPPER
  generatedOtpPepper ??= randomBytes(32).toString('hex')
  return generatedOtpPepper
}
