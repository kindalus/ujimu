import type { DatabaseSync } from 'node:sqlite'
import type { SessionClaims } from '../auth/session'

export const RECENT_OTP_WINDOW_MS = 15 * 60 * 1000

export interface ProfileContact {
  id: string
  channel: 'email' | 'phone'
  contact: string
  primary: boolean
  verifiedAt: string
}

export class ProfileValidationError extends Error {}
export class ProfileContactNotFoundError extends Error {}
export class ProfileContactConflictError extends Error {}
export class RecentOtpRequiredError extends Error {}

export function getDisplayName(database: DatabaseSync, userId: string): string | null {
  const row = database.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as
    | { display_name: string | null }
    | undefined
  return row?.display_name ?? null
}

export function updateDisplayName(database: DatabaseSync, userId: string, value: unknown): string | null {
  if (typeof value !== 'string') throw new ProfileValidationError('Nome inválido.')
  const displayName = value.trim()
  if (displayName.length > 100 || /[\u0000-\u001f\u007f<>]/.test(displayName)) {
    throw new ProfileValidationError('Nome inválido.')
  }

  const stored = displayName || null
  database.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(stored, userId)
  return stored
}

export function listProfileContacts(database: DatabaseSync, userId: string): ProfileContact[] {
  return database.prepare(`
    SELECT id, channel, contact, is_primary, verified_at
    FROM user_identities
    WHERE user_id = ?
    ORDER BY is_primary DESC, verified_at ASC, id ASC
  `).all(userId).map((row) => {
    const contact = row as {
      id: string
      channel: 'email' | 'phone'
      contact: string
      is_primary: number
      verified_at: string
    }
    return {
      id: contact.id,
      channel: contact.channel,
      contact: contact.contact,
      primary: contact.is_primary === 1,
      verifiedAt: contact.verified_at
    }
  })
}

export function assertRecentOtp(session: SessionClaims, now = new Date()): void {
  if (session.authMethod !== 'otp' || now.getTime() - session.issuedAt.getTime() > RECENT_OTP_WINDOW_MS) {
    throw new RecentOtpRequiredError('É necessário confirmar um código OTP recente.')
  }
}

export function makePrimaryContact(database: DatabaseSync, userId: string, identityId: string): ProfileContact[] {
  assertOwnedContact(database, userId, identityId)
  database.exec('BEGIN')
  try {
    database.prepare('UPDATE user_identities SET is_primary = 0 WHERE user_id = ?').run(userId)
    database.prepare('UPDATE user_identities SET is_primary = 1 WHERE id = ? AND user_id = ?').run(identityId, userId)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return listProfileContacts(database, userId)
}

export function removeContact(database: DatabaseSync, userId: string, identityId: string): ProfileContact[] {
  const contact = assertOwnedContact(database, userId, identityId)
  if (contact.is_primary === 1) {
    throw new ProfileContactConflictError('Escolha primeiro outro contacto principal.')
  }
  const count = database.prepare('SELECT COUNT(*) AS count FROM user_identities WHERE user_id = ?').get(userId) as { count: number }
  if (count.count <= 1) {
    throw new ProfileContactConflictError('Não é possível remover o último contacto verificado.')
  }
  database.prepare('DELETE FROM user_identities WHERE id = ? AND user_id = ?').run(identityId, userId)
  return listProfileContacts(database, userId)
}

function assertOwnedContact(
  database: DatabaseSync,
  userId: string,
  identityId: string
): { is_primary: number } {
  const contact = database.prepare(`
    SELECT is_primary FROM user_identities WHERE id = ? AND user_id = ?
  `).get(identityId, userId) as { is_primary: number } | undefined
  if (!contact) throw new ProfileContactNotFoundError('Contacto não encontrado.')
  return contact
}
