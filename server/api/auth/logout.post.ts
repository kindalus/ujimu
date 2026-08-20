import { deleteCookie, defineEventHandler } from 'h3'
import { readSessionFromEvent, revokeUserSessions, SESSION_COOKIE_NAME } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (session) {
    revokeUserSessions(database, session.userId)
  }

  deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' })
  return { authenticated: false }
})
