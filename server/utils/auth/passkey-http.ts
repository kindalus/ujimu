import { createError, getRequestHeader, readBody, type H3Event } from 'h3'
import type { DatabaseSync } from 'node:sqlite'
import { resolveVisitorIdentity } from '../analytics/visitors'
import { resolveTrustedClientIp } from '../security/client-ip'
import { readSessionFromEvent } from './session'
import { normalizePasskeyRateLimitSubject, PasskeyError, resolvePasskeyConfig, type PasskeyRateLimitSubject } from './passkeys'

export function mapPasskeyError(error: unknown): never {
  if (error instanceof PasskeyError) {
    throw createError({
      statusCode: error.statusCode,
      statusMessage: error.message,
      data: { code: error.code }
    })
  }

  throw error
}

export async function readPasskeyJsonBody(event: H3Event): Promise<Record<string, unknown>> {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid passkey request', data: { code: 'INVALID_PASSKEY_REQUEST' } })
  }

  const body = await readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid passkey request', data: { code: 'INVALID_PASSKEY_REQUEST' } })
  })

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid passkey request', data: { code: 'INVALID_PASSKEY_REQUEST' } })
  }

  return body as Record<string, unknown>
}

export function requireSession(event: H3Event, database: DatabaseSync) {
  const session = readSessionFromEvent(event, database)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  return session
}

export function getRequestOrigin(event: H3Event): string {
  const origin = getRequestHeader(event, 'origin')
  if (origin) return origin

  const referer = getRequestHeader(event, 'referer')
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {
      return ''
    }
  }

  return ''
}

export function assertPasskeyMutationOrigin(event: H3Event): void {
  const config = resolvePasskeyConfig(process.env)
  const origin = getRequestOrigin(event)
  const isProduction = process.env.NODE_ENV === 'production'

  if (origin !== config.origin && (isProduction || origin)) {
    throw new PasskeyError('INVALID_PASSKEY_REQUEST', 'Invalid passkey origin.', 400)
  }
}

export function resolvePasskeySubject(event: H3Event): PasskeyRateLimitSubject {
  const visitor = resolveVisitorIdentity(event)
  return normalizePasskeyRateLimitSubject({
    visitorId: visitor.visitorId,
    ip: resolveTrustedClientIp(event)
  })
}
