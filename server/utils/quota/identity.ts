import { randomUUID } from 'node:crypto'
import { getCookie, setCookie, type H3Event } from 'h3'
import { SESSION_COOKIE_NAME, verifySessionToken } from '../auth/session'
import type { QuotaSubject } from './policy'

export const ANONYMOUS_QUOTA_COOKIE_NAME = 'ujimu_anon_id'
export const ANONYMOUS_QUOTA_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180

export interface AnonymousQuotaCookieToSet {
  name: typeof ANONYMOUS_QUOTA_COOKIE_NAME
  value: string
  options: {
    httpOnly: true
    sameSite: 'lax'
    secure: boolean
    maxAge: number
    path: '/'
  }
}

export interface ResolveAnonymousIdentityOptions {
  generateId?: () => string
  isProduction?: boolean
}

export interface ResolvedAnonymousIdentity {
  subject: QuotaSubject
  cookieToSet?: AnonymousQuotaCookieToSet
}

export interface ResolveQuotaSubjectFromCookiesInput {
  sessionCookie?: string
  anonymousCookie?: string
  sessionSecret?: string
}

export function resolveQuotaSubject(
  event: H3Event,
  options: ResolveAnonymousIdentityOptions = {}
): QuotaSubject {
  const subject = resolveQuotaSubjectFromCookies({
    sessionCookie: getCookie(event, SESSION_COOKIE_NAME),
    anonymousCookie: getCookie(event, ANONYMOUS_QUOTA_COOKIE_NAME)
  })

  if (subject.type === 'registered') {
    return subject
  }

  const identity = resolveAnonymousIdentity(getCookie(event, ANONYMOUS_QUOTA_COOKIE_NAME), options)
  if (identity.cookieToSet) {
    setCookie(event, identity.cookieToSet.name, identity.cookieToSet.value, identity.cookieToSet.options)
  }

  return identity.subject
}

export function resolveQuotaSubjectFromCookies(
  input: ResolveQuotaSubjectFromCookiesInput,
  anonymousOptions: ResolveAnonymousIdentityOptions = {}
): QuotaSubject {
  const session = verifySessionToken(input.sessionCookie, { sessionSecret: input.sessionSecret })
  if (session) {
    return { type: 'registered', id: session.userId }
  }

  return resolveAnonymousIdentity(input.anonymousCookie, anonymousOptions).subject
}

export function resolveAnonymousIdentity(
  existingCookie: string | undefined,
  options: ResolveAnonymousIdentityOptions = {}
): ResolvedAnonymousIdentity {
  const existingId = existingCookie?.trim()

  if (existingId) {
    return {
      subject: { type: 'anonymous', id: existingId }
    }
  }

  const id = (options.generateId ?? randomUUID)()

  return {
    subject: { type: 'anonymous', id },
    cookieToSet: {
      name: ANONYMOUS_QUOTA_COOKIE_NAME,
      value: id,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.isProduction ?? process.env.NODE_ENV === 'production',
        maxAge: ANONYMOUS_QUOTA_COOKIE_MAX_AGE_SECONDS,
        path: '/'
      }
    }
  }
}
