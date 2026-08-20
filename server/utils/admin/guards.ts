import type { DatabaseSync } from 'node:sqlite'
import { createError, type H3Event } from 'h3'
import { getPublicSessionUser, type AuthenticatedUser } from '../auth/otp'
import { readSessionFromEvent } from '../auth/session'

export interface AdminSessionInfo {
  authenticated: boolean
  admin: boolean
  user?: AuthenticatedUser
  adminContact?: string
}

export interface RequiredAdminSession {
  user: AuthenticatedUser
  adminContact: string
}

export function getAdminSession(database: DatabaseSync, event: H3Event): AdminSessionInfo {
  const session = readSessionFromEvent(event, database)
  if (!session) {
    return { authenticated: false, admin: false }
  }

  const user = getPublicSessionUser(database, session.userId)
  if (!user) {
    return { authenticated: false, admin: false }
  }

  const verifiedContacts = getVerifiedContactsForUser(database, user.id)
  const adminContacts = parseAdminContacts(process.env.UJIMU_ADMIN_CONTACTS)
  const adminContact = verifiedContacts.find((contact) => adminContacts.has(normalizeAdminContact(contact)))

  return {
    authenticated: true,
    admin: Boolean(adminContact),
    user,
    ...(adminContact ? { adminContact } : {})
  }
}

export function requireAdmin(database: DatabaseSync, event: H3Event): RequiredAdminSession {
  const session = getAdminSession(database, event)

  if (!session.authenticated || !session.user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  if (!session.admin || !session.adminContact) {
    throw createError({ statusCode: 403, statusMessage: 'Admin permission required' })
  }

  return {
    user: session.user,
    adminContact: session.adminContact
  }
}

export function getVerifiedContactsForUser(database: DatabaseSync, userId: string): string[] {
  return database
    .prepare('SELECT contact FROM user_identities WHERE user_id = ? ORDER BY verified_at ASC')
    .all(userId)
    .map((row) => normalizeAdminContact((row as { contact: string }).contact))
}

export function parseAdminContacts(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(normalizeAdminContact)
      .filter((contact) => contact.length > 0)
  )
}

function normalizeAdminContact(contact: string): string {
  const trimmed = contact.trim()
  if (trimmed.startsWith('+')) {
    return trimmed.replace(/\s+/g, '')
  }

  return trimmed.toLowerCase()
}
