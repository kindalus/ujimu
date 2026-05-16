import { defineEventHandler } from 'h3'

// Files in server/routes are exposed without the /api prefix.
// Source: https://nuxt.com/docs/4.x/guide/directory-structure/server#server-routes
export default defineEventHandler(() => ({ ok: true, service: 'ujimu' }))
