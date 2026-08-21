import { defineEventHandler, getRequestURL, setHeader } from 'h3'

const noIndexPrefixes = ['/api', '/admin', '/account', '/companies', '/subscription']

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (noIndexPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
})
