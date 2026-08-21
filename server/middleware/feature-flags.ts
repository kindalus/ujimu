import { createError, defineEventHandler, getRequestURL } from 'h3'
import { resolveLaunchFeatures } from '../utils/features'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const features = resolveLaunchFeatures(process.env)

  if (!features.companiesEnabled && isCompanyPath(path)) {
    throw notFound()
  }

  if (!features.subscriptionsEnabled && isSubscriptionPath(path)) {
    throw notFound()
  }
})

function isSubscriptionPath(path: string): boolean {
  return matchesSegment(path, '/subscription') || matchesSegment(path, '/api/billing')
}

function isCompanyPath(path: string): boolean {
  return matchesSegment(path, '/companies') ||
    matchesSegment(path, '/admin/companies') ||
    matchesSegment(path, '/api/companies') ||
    matchesSegment(path, '/api/admin/companies') ||
    matchesSegment(path, '/api/account/active-company') ||
    matchesSegment(path, '/api/billing/corporate')
}

function matchesSegment(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

function notFound(): ReturnType<typeof createError> {
  return createError({ statusCode: 404, statusMessage: 'Not found' })
}
