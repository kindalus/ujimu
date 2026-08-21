import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { createSessionToken, readSessionEpoch } from './session'
import { getPublicSessionUser, normalizeOtpContact, type AuthenticatedUser, type OtpChannel } from './otp'

export interface DevLoginInput {
  channel: OtpChannel
  contact: string
}

export interface DevLoginOptions {
  env?: Record<string, string | undefined>
  now?: Date
  sessionSecret?: string
}

export interface DevLoginResult {
  user: AuthenticatedUser
  sessionToken: string
}

export class DevLoginError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404,
    public readonly code: 'DEV_AUTH_DISABLED' | 'DEV_AUTH_CONTACT_NOT_ALLOWED' | 'INVALID_DEV_AUTH_REQUEST',
    message: string
  ) {
    super(message)
    this.name = 'DevLoginError'
  }
}

export function isDevAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    env.UJIMU_DEV_AUTH_ENABLED === 'true' &&
    parseDevUserContacts(env.UJIMU_DEV_USER_CONTACTS).size > 0
  )
}

export function devLogin(
  database: DatabaseSync,
  input: DevLoginInput,
  options: DevLoginOptions = {}
): DevLoginResult {
  const env = options.env ?? process.env
  if (!isDevAuthEnabled(env)) {
    throw new DevLoginError(404, 'DEV_AUTH_DISABLED', 'Development authentication is not available.')
  }

  let normalized: { channel: OtpChannel; contact: string }
  try {
    normalized = normalizeOtpContact(input)
  } catch {
    throw new DevLoginError(400, 'INVALID_DEV_AUTH_REQUEST', 'Invalid development authentication request.')
  }

  const allowedContacts = parseDevUserContacts(env.UJIMU_DEV_USER_CONTACTS)
  if (!allowedContacts.has(toContactKey(normalized))) {
    throw new DevLoginError(403, 'DEV_AUTH_CONTACT_NOT_ALLOWED', 'Development contact is not allowed.')
  }

  const now = options.now ?? new Date()
  const user = upsertDevIdentity(database, normalized, now)

  return {
    user: getPublicSessionUser(database, user.id) ?? user,
    sessionToken: createSessionToken(user.id, {
      now,
      sessionSecret: options.sessionSecret,
      epoch: readSessionEpoch(database, user.id) ?? 0
    })
  }
}

export function parseDevUserContacts(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((contact) => normalizeAllowlistedContact(contact))
      .filter((contact): contact is string => Boolean(contact))
  )
}

function normalizeAllowlistedContact(contact: string): string | undefined {
  const trimmed = contact.trim()
  if (!trimmed) return undefined

  for (const channel of ['email', 'phone'] as const) {
    try {
      return toContactKey(normalizeOtpContact({ channel, contact: trimmed }))
    } catch {
      // Try the next supported contact shape.
    }
  }

  return undefined
}

function toContactKey(contact: { channel: OtpChannel; contact: string }): string {
  return `${contact.channel}:${contact.contact}`
}

function upsertDevIdentity(
  database: DatabaseSync,
  input: { channel: OtpChannel; contact: string },
  now: Date
): AuthenticatedUser {
  const existing = database
    .prepare('SELECT user_id FROM user_identities WHERE channel = ? AND contact = ?')
    .get(input.channel, input.contact) as { user_id: string } | undefined

  const userId = existing?.user_id ?? createUser(database, now)

  if (!existing) {
    database
      .prepare(`
        INSERT INTO user_identities (id, user_id, channel, contact, verified_at, is_primary)
        VALUES (?, ?, ?, ?, ?, 1)
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
