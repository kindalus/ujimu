import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getPublicSessionUser } from './otp'
import { createSessionToken, type SessionClaims } from './session'
import {
  bytesToBase64Url,
  createSimpleWebAuthnAdapter,
  type PasskeyWebAuthnAdapter
} from './passkey-adapter'

export type PasskeyErrorCode =
  | 'PASSKEYS_DISABLED'
  | 'PASSKEYS_NOT_CONFIGURED'
  | 'INVALID_PASSKEY_REQUEST'
  | 'PASSKEY_AUTHENTICATION_FAILED'
  | 'RECENT_AUTH_REQUIRED'
  | 'PASSKEY_ALREADY_REGISTERED'
  | 'PASSKEY_RATE_LIMITED'
  | 'PASSKEY_NOT_FOUND'
  | 'PASSKEY_LIMIT_EXCEEDED'

export interface PasskeyConfig {
  enabled: boolean
  rpID: string
  rpName: string
  origin: string
}

export interface PublicPasskeyCredential {
  id: string
  createdAt: string
  lastUsedAt: string | null
  transports: string[]
}

export interface PasskeyRateLimitSubject {
  type: 'visitor' | 'ip' | 'unknown'
  id: string
}

export interface PasskeyServiceOptions {
  adapter?: PasskeyWebAuthnAdapter
  env?: Record<string, string | undefined>
  now?: Date
}

export interface PasskeyAuthenticationOptions extends PasskeyServiceOptions {
  sessionSecret?: string
}

interface PasskeyCredentialRow {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  transports_json: string
  created_at: string
  last_used_at: string | null
  deleted_at: string | null
  deleted_by_user_id: string | null
}

interface PasskeyChallengeRow {
  id: string
  challenge: string
  purpose: 'registration' | 'authentication'
  user_id: string | null
  expires_at: string
  consumed_at: string | null
}

const DEFAULT_DEV_RP_ID = 'localhost'
const DEFAULT_DEV_RP_NAME = 'Ujimu'
const DEFAULT_DEV_ORIGIN = 'http://localhost:3000'
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const RECENT_OTP_WINDOW_MS = 15 * 60 * 1000
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000
const OPTION_LIMIT = 20
const VERIFY_FAILURE_LIMIT = 10
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const MAX_ACTIVE_PASSKEYS = 20

export class PasskeyError extends Error {
  constructor(
    public readonly code: PasskeyErrorCode,
    message: string,
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'PasskeyError'
  }
}

export function resolvePasskeyConfig(
  env: Record<string, string | undefined> = process.env
): PasskeyConfig {
  const enabled = env.UJIMU_PASSKEYS_ENABLED === 'true'
  const isProduction = env.NODE_ENV === 'production'

  if (!enabled) {
    throw new PasskeyError('PASSKEYS_DISABLED', 'Passkeys are disabled.', 404)
  }

  const rpID = env.UJIMU_PASSKEY_RP_ID || (isProduction ? '' : DEFAULT_DEV_RP_ID)
  const rpName = env.UJIMU_PASSKEY_RP_NAME || (isProduction ? '' : DEFAULT_DEV_RP_NAME)
  const origin = env.UJIMU_PASSKEY_ORIGIN || (isProduction ? '' : DEFAULT_DEV_ORIGIN)

  if (!rpID || !rpName || !origin) {
    throw new PasskeyError('PASSKEYS_NOT_CONFIGURED', 'Passkeys are not configured.', 503)
  }

  return { enabled, rpID, rpName, origin }
}

export function getPasskeyReadiness(
  env: Record<string, string | undefined> = process.env
): { passkeysEnabled: boolean; passkeysConfigured: boolean } {
  const passkeysEnabled = env.UJIMU_PASSKEYS_ENABLED === 'true'
  if (!passkeysEnabled) return { passkeysEnabled, passkeysConfigured: false }

  try {
    resolvePasskeyConfig(env)
    return { passkeysEnabled, passkeysConfigured: true }
  } catch {
    return { passkeysEnabled, passkeysConfigured: false }
  }
}

export async function createPasskeyRegistrationOptions(
  database: DatabaseSync,
  input: {
    userId: string
    session: SessionClaims
    origin: string
  },
  options: PasskeyServiceOptions = {}
): Promise<{ options: Record<string, unknown> }> {
  const now = options.now ?? new Date()
  const config = assertConfigAndOrigin(input.origin, options.env)
  requireRecentOtpSession(input.session, input.userId, now)
  cleanupOldPasskeyRows(database, now)

  const activeCredentials = readActiveCredentials(database, input.userId)
  if (activeCredentials.length >= MAX_ACTIVE_PASSKEYS) {
    throw new PasskeyError('PASSKEY_LIMIT_EXCEEDED', 'Too many passkeys.', 409)
  }

  const adapter = options.adapter ?? createSimpleWebAuthnAdapter()
  const user = getPublicSessionUser(database, input.userId)
  const generated = await adapter.generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    rp: { id: config.rpID, name: config.rpName },
    userName: user?.displayContact ?? input.userId,
    userID: Uint8Array.from(Buffer.from(input.userId, 'utf8')),
    attestation: 'none',
    excludeCredentials: activeCredentials.map((credential) => ({
      id: credential.credential_id,
      transports: parseTransports(credential.transports_json)
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    }
  })

  insertChallenge(database, {
    challenge: generated.challenge,
    purpose: 'registration',
    userId: input.userId,
    now
  })

  return { options: generated.options as Record<string, unknown> }
}

export async function verifyPasskeyRegistration(
  database: DatabaseSync,
  input: {
    userId: string
    session: SessionClaims
    origin: string
    response: Record<string, unknown>
  },
  options: PasskeyServiceOptions = {}
): Promise<{ credential: PublicPasskeyCredential }> {
  const now = options.now ?? new Date()
  const config = assertConfigAndOrigin(input.origin, options.env)
  requireRecentOtpSession(input.session, input.userId, now)
  cleanupOldPasskeyRows(database, now)

  const challenge = extractChallenge(input.response)
  const challengeRow = consumeChallenge(database, {
    challenge,
    purpose: 'registration',
    userId: input.userId,
    now
  })
  if (!challengeRow) {
    throw authFailed()
  }

  const adapter = options.adapter ?? createSimpleWebAuthnAdapter()
  const verification = await adapter.verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID
  }).catch(() => undefined)

  if (!verification?.verified) {
    throw authFailed()
  }

  const credentialId = verification.credential.credentialId
  const publicKey = serializePublicKey(verification.credential.publicKey)
  const transports = verification.credential.transports ?? []
  const existing = readCredentialByRawId(database, credentialId)

  if (existing?.deleted_at && existing.user_id === input.userId) {
    database
      .prepare(`
        UPDATE passkey_credentials
        SET public_key = ?, counter = ?, transports_json = ?, deleted_at = NULL,
            deleted_by_user_id = NULL, created_at = ?, last_used_at = NULL
        WHERE id = ?
      `)
      .run(publicKey, verification.credential.counter, JSON.stringify(transports), now.toISOString(), existing.id)
    return { credential: toPublicCredential({ ...existing, public_key: publicKey, counter: verification.credential.counter, transports_json: JSON.stringify(transports), created_at: now.toISOString(), last_used_at: null, deleted_at: null }) }
  }

  if (existing) {
    throw new PasskeyError('PASSKEY_ALREADY_REGISTERED', 'Passkey is already registered.', 409)
  }

  const credential: PasskeyCredentialRow = {
    id: randomUUID(),
    user_id: input.userId,
    credential_id: credentialId,
    public_key: publicKey,
    counter: verification.credential.counter,
    transports_json: JSON.stringify(transports),
    created_at: now.toISOString(),
    last_used_at: null,
    deleted_at: null,
    deleted_by_user_id: null
  }
  database
    .prepare(`
      INSERT INTO passkey_credentials (
        id, user_id, credential_id, public_key, counter, transports_json,
        created_at, last_used_at, deleted_at, deleted_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `)
    .run(
      credential.id,
      credential.user_id,
      credential.credential_id,
      credential.public_key,
      credential.counter,
      credential.transports_json,
      credential.created_at
    )

  return { credential: toPublicCredential(credential) }
}

export async function createPasskeyAuthenticationOptions(
  database: DatabaseSync,
  input: {
    origin: string
    subject: PasskeyRateLimitSubject
  },
  options: PasskeyServiceOptions = {}
): Promise<{ options: Record<string, unknown> }> {
  const now = options.now ?? new Date()
  const config = assertConfigAndOrigin(input.origin, options.env)
  cleanupOldPasskeyRows(database, now)
  assertOptionsRateLimit(database, input.subject, now)

  const adapter = options.adapter ?? createSimpleWebAuthnAdapter()
  const generated = await adapter.generateAuthenticationOptions({
    rpID: config.rpID,
    rpId: config.rpID,
    userVerification: 'preferred'
  })
  insertChallenge(database, {
    challenge: generated.challenge,
    purpose: 'authentication',
    now
  })
  recordAttempt(database, input.subject, 'options', true, undefined, now)

  return { options: generated.options as Record<string, unknown> }
}

export async function verifyPasskeyAuthentication(
  database: DatabaseSync,
  input: {
    origin: string
    subject: PasskeyRateLimitSubject
    response: Record<string, unknown>
  },
  options: PasskeyAuthenticationOptions = {}
): Promise<{ sessionToken: string; user: { id: string; displayContact: string } }> {
  const now = options.now ?? new Date()
  const config = assertConfigAndOrigin(input.origin, options.env)
  cleanupOldPasskeyRows(database, now)
  assertVerifyRateLimit(database, input.subject, now)

  const challenge = extractChallenge(input.response)
  const challengeRow = consumeChallenge(database, {
    challenge,
    purpose: 'authentication',
    now
  })
  if (!challengeRow) {
    recordAttempt(database, input.subject, 'verify', false, 'challenge', now)
    throw authFailed()
  }

  const credentialId = extractCredentialId(input.response)
  const credential = readActiveCredentialByRawId(database, credentialId)
  if (!credential) {
    recordAttempt(database, input.subject, 'verify', false, 'credential', now)
    throw authFailed()
  }

  const adapter = options.adapter ?? createSimpleWebAuthnAdapter()
  const verification = await adapter.verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    credential: {
      id: credential.credential_id,
      publicKey: credential.public_key,
      counter: credential.counter,
      transports: parseTransports(credential.transports_json)
    }
  }).catch(() => undefined)

  if (!verification?.verified) {
    recordAttempt(database, input.subject, 'verify', false, 'assertion', now)
    throw authFailed()
  }

  if (credential.counter > 0 && verification.newCounter > 0 && verification.newCounter <= credential.counter) {
    recordAttempt(database, input.subject, 'verify', false, 'counter', now)
    throw authFailed()
  }

  database
    .prepare('UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE id = ?')
    .run(verification.newCounter, now.toISOString(), credential.id)
  recordAttempt(database, input.subject, 'verify', true, undefined, now)

  const user = getPublicSessionUser(database, credential.user_id) ?? {
    id: credential.user_id,
    displayContact: credential.user_id
  }
  return {
    user,
    sessionToken: createSessionToken(credential.user_id, {
      now,
      sessionSecret: options.sessionSecret,
      authMethod: 'passkey'
    })
  }
}

export function listPasskeyCredentials(
  database: DatabaseSync,
  input: { userId: string }
): PublicPasskeyCredential[] {
  return readActiveCredentials(database, input.userId).map(toPublicCredential)
}

export function deletePasskeyCredential(
  database: DatabaseSync,
  input: { userId: string; credentialId: string; now?: Date }
): { deleted: true } {
  const now = input.now ?? new Date()
  const result = database
    .prepare(`
      UPDATE passkey_credentials
      SET deleted_at = ?, deleted_by_user_id = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `)
    .run(now.toISOString(), input.userId, input.credentialId, input.userId)

  if (result.changes === 0) {
    throw new PasskeyError('PASSKEY_NOT_FOUND', 'Passkey was not found.', 404)
  }

  return { deleted: true }
}

export function normalizePasskeyRateLimitSubject(input: {
  visitorId?: string
  ip?: string
}): PasskeyRateLimitSubject {
  if (input.visitorId?.trim()) {
    return { type: 'visitor', id: input.visitorId.trim() }
  }

  if (input.ip?.trim()) {
    return { type: 'ip', id: createHash('sha256').update(input.ip.trim()).digest('hex') }
  }

  return { type: 'unknown', id: 'unknown' }
}

function requireRecentOtpSession(session: SessionClaims, userId: string, now: Date): void {
  if (
    session.userId !== userId ||
    session.authMethod !== 'otp' ||
    now.getTime() - session.issuedAt.getTime() > RECENT_OTP_WINDOW_MS
  ) {
    throw new PasskeyError('RECENT_AUTH_REQUIRED', 'Recent OTP authentication is required.', 403)
  }
}

function assertConfigAndOrigin(origin: string, env: Record<string, string | undefined> | undefined): PasskeyConfig {
  const config = resolvePasskeyConfig(env)
  if (origin !== config.origin) {
    throw new PasskeyError('INVALID_PASSKEY_REQUEST', 'Invalid passkey origin.', 400)
  }
  return config
}

function insertChallenge(
  database: DatabaseSync,
  input: { challenge: string; purpose: 'registration' | 'authentication'; userId?: string; now: Date }
): void {
  database
    .prepare(`
      INSERT INTO passkey_challenges (
        id, challenge, purpose, user_id, created_at, expires_at, consumed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, '{}')
    `)
    .run(
      randomUUID(),
      input.challenge,
      input.purpose,
      input.userId ?? null,
      input.now.toISOString(),
      new Date(input.now.getTime() + CHALLENGE_TTL_MS).toISOString()
    )
}

function consumeChallenge(
  database: DatabaseSync,
  input: { challenge: string; purpose: 'registration' | 'authentication'; userId?: string; now: Date }
): PasskeyChallengeRow | undefined {
  const row = database
    .prepare(`
      SELECT id, challenge, purpose, user_id, expires_at, consumed_at
      FROM passkey_challenges
      WHERE challenge = ? AND purpose = ?
        AND (? IS NULL OR user_id = ?)
        AND consumed_at IS NULL
      LIMIT 1
    `)
    .get(input.challenge, input.purpose, input.userId ?? null, input.userId ?? null) as PasskeyChallengeRow | undefined

  if (!row || new Date(row.expires_at).getTime() <= input.now.getTime()) {
    return undefined
  }

  database
    .prepare('UPDATE passkey_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .run(input.now.toISOString(), row.id)

  return row
}

function cleanupOldPasskeyRows(database: DatabaseSync, now: Date): void {
  const cutoff = new Date(now.getTime() - CLEANUP_AFTER_MS).toISOString()
  database.prepare('DELETE FROM passkey_challenges WHERE expires_at < ?').run(cutoff)
  database.prepare('DELETE FROM passkey_auth_attempts WHERE occurred_at < ?').run(cutoff)
}

function assertOptionsRateLimit(database: DatabaseSync, subject: PasskeyRateLimitSubject, now: Date): void {
  const count = countAttempts(database, subject, 'options', undefined, now)
  if (count >= OPTION_LIMIT) {
    throw new PasskeyError('PASSKEY_RATE_LIMITED', 'Too many passkey attempts.', 429)
  }
}

function assertVerifyRateLimit(database: DatabaseSync, subject: PasskeyRateLimitSubject, now: Date): void {
  const count = countAttempts(database, subject, 'verify', false, now)
  if (count >= VERIFY_FAILURE_LIMIT) {
    throw new PasskeyError('PASSKEY_RATE_LIMITED', 'Too many passkey attempts.', 429)
  }
}

function countAttempts(
  database: DatabaseSync,
  subject: PasskeyRateLimitSubject,
  purpose: 'options' | 'verify',
  success: boolean | undefined,
  now: Date
): number {
  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString()
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM passkey_auth_attempts
      WHERE subject_type = ? AND subject_id = ? AND purpose = ?
        AND (? IS NULL OR success = ?)
        AND occurred_at >= ?
    `)
    .get(subject.type, subject.id, purpose, success === undefined ? null : success ? 1 : 0, success === undefined ? null : success ? 1 : 0, since) as { count: number }

  return row.count
}

function recordAttempt(
  database: DatabaseSync,
  subject: PasskeyRateLimitSubject,
  purpose: 'options' | 'verify',
  success: boolean,
  failureCode: string | undefined,
  now: Date
): void {
  database
    .prepare(`
      INSERT INTO passkey_auth_attempts (
        id, subject_type, subject_id, purpose, success, failure_code, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(randomUUID(), subject.type, subject.id, purpose, success ? 1 : 0, failureCode ?? null, now.toISOString())
}

function readActiveCredentials(database: DatabaseSync, userId: string): PasskeyCredentialRow[] {
  return database
    .prepare(`
      SELECT id, user_id, credential_id, public_key, counter, transports_json,
        created_at, last_used_at, deleted_at, deleted_by_user_id
      FROM passkey_credentials
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC
    `)
    .all(userId) as unknown as PasskeyCredentialRow[]
}

function readCredentialByRawId(database: DatabaseSync, credentialId: string): PasskeyCredentialRow | undefined {
  return database
    .prepare(`
      SELECT id, user_id, credential_id, public_key, counter, transports_json,
        created_at, last_used_at, deleted_at, deleted_by_user_id
      FROM passkey_credentials
      WHERE credential_id = ?
      LIMIT 1
    `)
    .get(credentialId) as PasskeyCredentialRow | undefined
}

function readActiveCredentialByRawId(database: DatabaseSync, credentialId: string): PasskeyCredentialRow | undefined {
  const row = readCredentialByRawId(database, credentialId)
  return row && !row.deleted_at ? row : undefined
}

function toPublicCredential(row: PasskeyCredentialRow): PublicPasskeyCredential {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    transports: parseTransports(row.transports_json)
  }
}

function parseTransports(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function serializePublicKey(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : bytesToBase64Url(value)
}

function extractChallenge(response: Record<string, unknown>): string {
  if (typeof response.challenge === 'string' && response.challenge.trim()) {
    return response.challenge.trim()
  }

  const nested = response.response
  if (isRecord(nested) && typeof nested.clientDataJSON === 'string') {
    const decoded = parseClientDataJson(nested.clientDataJSON)
    if (typeof decoded?.challenge === 'string' && decoded.challenge.trim()) {
      return decoded.challenge.trim()
    }
  }

  throw new PasskeyError('INVALID_PASSKEY_REQUEST', 'Invalid passkey request.', 400)
}

function extractCredentialId(response: Record<string, unknown>): string {
  if (typeof response.credentialId === 'string' && response.credentialId.trim()) {
    return response.credentialId.trim()
  }

  if (typeof response.id === 'string' && response.id.trim()) {
    return response.id.trim()
  }

  throw new PasskeyError('INVALID_PASSKEY_REQUEST', 'Invalid passkey request.', 400)
}

function parseClientDataJson(value: string): { challenge?: string } | undefined {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { challenge?: string }
  } catch {
    return undefined
  }
}

function authFailed(): PasskeyError {
  return new PasskeyError('PASSKEY_AUTHENTICATION_FAILED', 'Passkey authentication failed.', 401)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
