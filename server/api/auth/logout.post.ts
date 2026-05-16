import { deleteCookie, defineEventHandler } from 'h3'
import { SESSION_COOKIE_NAME } from '../../utils/auth/session'

export default defineEventHandler((event) => {
  deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' })
  return { authenticated: false }
})
