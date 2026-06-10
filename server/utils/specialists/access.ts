import type { DatabaseSync } from 'node:sqlite'
import type { H3Event } from 'h3'
import { readSessionFromEvent } from '../auth/session'
import { normalizeEmail, type SpecialistRuntime } from './schema'

export type SpecialistAccessSubject =
  | { type: 'anonymous' }
  | { type: 'user'; userId: string; verifiedEmails: string[] }

export function canUseSpecialist(specialist: SpecialistRuntime, subject: SpecialistAccessSubject): boolean {
  if (specialist.status === 'suspended') {
    return false
  }

  if (specialist.allowed_emails.length === 0) {
    return true
  }

  if (subject.type !== 'user') {
    return false
  }

  const allowed = new Set(specialist.allowed_emails.map(normalizeEmail))
  return subject.verifiedEmails.some((email) => allowed.has(normalizeEmail(email)))
}

export function filterAccessibleSpecialists(
  specialists: SpecialistRuntime[],
  subject: SpecialistAccessSubject
): SpecialistRuntime[] {
  return specialists.filter((specialist) => canUseSpecialist(specialist, subject))
}

export function resolveSpecialistAccessSubject(database: DatabaseSync, event: H3Event): SpecialistAccessSubject {
  const session = readSessionFromEvent(event)
  if (!session) {
    return { type: 'anonymous' }
  }

  const verifiedEmails = getVerifiedEmailContactsForUser(database, session.userId)
  if (verifiedEmails.length === 0 && !userExists(database, session.userId)) {
    return { type: 'anonymous' }
  }

  return {
    type: 'user',
    userId: session.userId,
    verifiedEmails
  }
}

export function resolveSpecialistAccessSubjectFromUser(
  database: DatabaseSync | undefined,
  userId: string | undefined
): SpecialistAccessSubject {
  if (!database || !userId) {
    return { type: 'anonymous' }
  }

  return {
    type: 'user',
    userId,
    verifiedEmails: getVerifiedEmailContactsForUser(database, userId)
  }
}

export function getVerifiedEmailContactsForUser(database: DatabaseSync, userId: string): string[] {
  return database
    .prepare(`
      SELECT contact
      FROM user_identities
      WHERE user_id = ? AND channel = 'email'
      ORDER BY verified_at ASC
    `)
    .all(userId)
    .map((row) => normalizeEmail((row as { contact: string }).contact))
}

function userExists(database: DatabaseSync, userId: string): boolean {
  return Boolean(database.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(userId))
}
