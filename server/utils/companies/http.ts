import type { DatabaseSync } from 'node:sqlite'
import { createError, getRequestHeader, readBody, type H3Event } from 'h3'
import { readSessionFromEvent } from '../auth/session'
import {
  CompanyValidationError,
  getCompany,
  getCorporateSubscription,
  listCompanyMemberships,
  listUserCompanies,
  type CompanyMembershipRecord,
  type CompanyRecord,
  type CorporateSubscriptionRecord,
  type UserCompanyRecord
} from './repository'

export interface CompanyAccessContext {
  userId: string
  company: CompanyRecord
  userCompany: UserCompanyRecord
  subscription: CorporateSubscriptionRecord | undefined
  memberships: CompanyMembershipRecord[]
}

export function requireAuthenticatedUser(event: H3Event): string {
  const session = readSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required', data: { code: 'AUTHENTICATION_REQUIRED' } })
  }
  return session.userId
}

export function requireCompanyMember(
  database: DatabaseSync,
  userId: string,
  companyId: string
): CompanyAccessContext {
  const company = getCompany(database, companyId)
  if (!company) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
  }

  const userCompany = listUserCompanies(database, userId).find((item) => item.id === companyId)
  if (!userCompany) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
  }

  return {
    userId,
    company,
    userCompany,
    subscription: getCorporateSubscription(database, companyId),
    memberships: listCompanyMemberships(database, companyId)
  }
}

export function requireCompanyAdmin(
  database: DatabaseSync,
  userId: string,
  companyId: string
): CompanyAccessContext {
  const context = requireCompanyMember(database, userId, companyId)
  if (context.userCompany.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Company admin required', data: { code: 'COMPANY_ADMIN_REQUIRED' } })
  }
  return context
}

export async function readRequiredJsonBody(event: H3Event): Promise<unknown> {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid company request' })
  }

  return readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid company request' })
  })
}

export function toCompanyDetailPayload(context: CompanyAccessContext) {
  return {
    company: context.company,
    role: context.userCompany.role,
    subscription: context.subscription,
    memberships: context.userCompany.role === 'admin' ? context.memberships : []
  }
}

export function mapCompanyError(error: unknown): never {
  if (error instanceof CompanyValidationError) {
    const statusCode = error.code === 'USER_NOT_COMPANY_MEMBER' || error.code === 'COMPANY_ADMIN_REQUIRED' ? 403 : 400
    throw createError({ statusCode, statusMessage: error.message, data: { code: error.code } })
  }
  throw error
}
