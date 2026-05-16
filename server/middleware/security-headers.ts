import { defineEventHandler, setResponseHeaders } from 'h3'
import { SECURITY_HEADERS } from '../utils/security/headers'

// Nuxt automatically runs files in server/middleware before server routes.
// Source: https://nuxt.com/docs/4.x/guide/directory-structure/server#server-middleware
export default defineEventHandler((event) => {
  setResponseHeaders(event, SECURITY_HEADERS)
})
