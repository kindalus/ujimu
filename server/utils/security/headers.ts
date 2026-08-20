export const SECURITY_HEADERS: Record<string, string> = createSecurityHeaders()

export function createSecurityHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    ...(env.NODE_ENV === 'production' ? [] : ["worker-src 'self' blob:"]),
    "form-action 'self'"
  ].join('; ')

  return {
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': csp,
    // Only in production: sending HSTS over plain http during local development would pin
    // localhost to https in the browser and break the dev server.
    ...(env.NODE_ENV === 'production'
      ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' }
      : {})
  }
}
