import type { DatabaseSync } from 'node:sqlite'
import type { H3Event } from 'h3'
import { readSessionFromEvent } from '../auth/session'
import { getActiveCompanyForUser } from '../companies/repository'
import type { SpecialistRuntime } from './schema'

export type SpecialistAccessSubject =
  | { type: 'anonymous' }
  | { type: 'user'; userId: string; activeCompanyId: string | null }

export function canUseSpecialist(specialist: SpecialistRuntime, subject: SpecialistAccessSubject): boolean {
  if (specialist.status !== 'active') {
    return false
  }

  if (!specialist.company_id) {
    return true
  }

  return subject.type === 'user' && subject.activeCompanyId === specialist.company_id
}

export function filterAccessibleSpecialists(
  specialists: SpecialistRuntime[],
  subject: SpecialistAccessSubject
): SpecialistRuntime[] {
  return specialists.filter((specialist) => canUseSpecialist(specialist, subject))
}

export function resolveSpecialistAccessSubject(database: DatabaseSync, event: H3Event): SpecialistAccessSubject {
  const session = readSessionFromEvent(event, database)
  if (!session || !userExists(database, session.userId)) {
    return { type: 'anonymous' }
  }

  return resolveSpecialistAccessSubjectFromUser(database, session.userId)
}

export function resolveSpecialistAccessSubjectFromUser(
  database: DatabaseSync | undefined,
  userId: string | undefined
): SpecialistAccessSubject {
  if (!database || !userId || !userExists(database, userId)) {
    return { type: 'anonymous' }
  }

  const activeCompany = getActiveCompanyForUser(database, userId)
  return {
    type: 'user',
    userId,
    activeCompanyId: activeCompany?.active ? activeCompany.id : null
  }
}

function userExists(database: DatabaseSync, userId: string): boolean {
  return Boolean(database.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(userId))
}
