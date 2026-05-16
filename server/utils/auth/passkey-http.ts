import { createError, getHeader, getRequestHeader, readBody, type H3Event } from 'h3'
import { resolveVisitorIdentity } from '../analytics/visitors'
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

export function requireSession(event: H3Event) {
  const session = readSessionFromEvent(event)
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
  const ip = getDirectIp(event)
  return normalizePasskeyRateLimitSubject({ visitorId: visitor.visitorId, ip })
}

function getDirectIp(event: H3Event): string | undefined {
  const direct = getHeader(event, 'x-real-ip')
  if (direct && process.env.UJIMU_TRUST_PROXY_HEADERS === 'true') return direct

  const forwarded = getHeader(event, 'x-forwarded-for')
  if (forwarded && process.env.UJIMU_TRUST_PROXY_HEADERS === 'true') {
    return forwarded.split(',')[0]?.trim()
  }

  return event.node?.req.socket.remoteAddress
}
