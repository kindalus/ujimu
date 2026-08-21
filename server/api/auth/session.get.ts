import { defineEventHandler, getQuery } from 'h3'
import { isAdminUser } from '../../utils/admin/guards'
import { getPublicSessionUser } from '../../utils/auth/otp'
import { getPasskeyReadiness } from '../../utils/auth/passkeys'
import { readSessionFromEvent } from '../../utils/auth/session'
import { resolveQuotaSubjectWithSubscription } from '../../utils/billing/subscriptions'
import { getActiveCompanyForUser } from '../../utils/companies/repository'
import { initializeDatabase } from '../../utils/db'
import { resolveLaunchFeatures } from '../../utils/features'
import { resolveAnonymousQuotaSubject } from '../../utils/quota/identity'
import type { QuotaSubject } from '../../utils/quota/policy'
import { getQuotaUsage } from '../../utils/quota/usage'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  const passkeys = getPasskeyReadiness(process.env)
  const user = session ? getPublicSessionUser(database, session.userId) : undefined
  const admin = Boolean(session && user && isAdminUser(database, session.userId))
  const query = getQuery(event)
  const timezone = typeof query.timezone === 'string' ? query.timezone : undefined
  const baseSubject: QuotaSubject = session && user
    ? { type: 'registered', id: session.userId }
    : resolveAnonymousQuotaSubject(event)
  const subject = resolveSessionQuotaSubject(database, baseSubject, admin)
  const quota = admin
    ? { exempt: true as const, subjectType: 'admin' as const, daily: null, weekly: null }
    : getQuotaUsage(database, { subject, userTimezone: timezone })

  if (!session || !user) {
    return { authenticated: false, admin: false, quota, passkeys }
  }

  return {
    authenticated: true,
    admin,
    quota,
    user,
    authMethod: session.authMethod,
    recentOtpAuthenticated: session.authMethod === 'otp' && Date.now() - session.issuedAt.getTime() <= 15 * 60 * 1000,
    passkeys
  }
})

function resolveSessionQuotaSubject(
  database: Awaited<ReturnType<typeof initializeDatabase>>,
  baseSubject: QuotaSubject,
  admin: boolean
): QuotaSubject {
  const subject = resolveQuotaSubjectWithSubscription(database, baseSubject, { env: process.env })
  const features = resolveLaunchFeatures(process.env)
  if (admin || !features.companiesEnabled || subject.type === 'anonymous') return subject

  const activeCompany = getActiveCompanyForUser(database, subject.id)
  return activeCompany?.active
    ? { type: 'company', id: activeCompany.id, seats: activeCompany.seats }
    : subject
}
