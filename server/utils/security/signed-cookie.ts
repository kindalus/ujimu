import { createHmac, timingSafeEqual } from 'node:crypto'
import { resolveSessionSecret } from '../auth/session'

/**
 * Cookies that identify a quota subject are authority, not just a hint, so their contents have to
 * be attributable to this server. Values are stored as `<value>.<hmac>` and anything that does not
 * verify is treated as absent rather than trusted.
 */
export function signCookieValue(value: string, secret?: string): string {
  return `${value}.${signature(value, secret)}`
}

export function readSignedCookieValue(raw: string | undefined, secret?: string): string | undefined {
  const candidate = raw?.trim()
  if (!candidate) return undefined

  const separator = candidate.lastIndexOf('.')
  if (separator <= 0) return undefined

  const value = candidate.slice(0, separator)
  const provided = candidate.slice(separator + 1)

  return matches(provided, signature(value, secret)) ? value : undefined
}

function signature(value: string, secret?: string): string {
  return createHmac('sha256', resolveSessionSecret(secret)).update(value).digest('base64url')
}

function matches(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
