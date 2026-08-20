import { defineEventHandler } from 'h3'
import { getPublicSessionUser } from '../../utils/auth/otp'
import { getPasskeyReadiness } from '../../utils/auth/passkeys'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  const passkeys = getPasskeyReadiness(process.env)
  if (!session) {
    return { authenticated: false, passkeys }
  }

  const user = getPublicSessionUser(database, session.userId)
  if (!user) {
    return { authenticated: false, passkeys }
  }

  return {
    authenticated: true,
    user,
    authMethod: session.authMethod,
    recentOtpAuthenticated: session.authMethod === 'otp' && Date.now() - session.issuedAt.getTime() <= 15 * 60 * 1000,
    passkeys
  }
})
