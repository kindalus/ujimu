import { getHeader, type H3Event } from 'h3'

/**
 * Resolves the client IP for rate-limiting purposes. Proxy headers are attacker-controlled unless
 * a trusted proxy sanitizes them, so they are only honoured when UJIMU_TRUST_PROXY_HEADERS is set.
 */
export function resolveTrustedClientIp(event: H3Event): string | undefined {
  if (process.env.UJIMU_TRUST_PROXY_HEADERS === 'true') {
    const direct = getHeader(event, 'x-real-ip')
    if (direct) return direct

    const forwarded = getHeader(event, 'x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0]?.trim()
  }

  return event.node?.req.socket.remoteAddress
}
