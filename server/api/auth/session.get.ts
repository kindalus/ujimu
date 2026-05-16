import { defineEventHandler } from 'h3'
import { getPublicSessionUser } from '../../utils/auth/otp'
import { getPasskeyReadiness } from '../../utils/auth/passkeys'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const session = readSessionFromEvent(event)
  const passkeys = getPasskeyReadiness(process.env)
  if (!session) {
    return { authenticated: false, passkeys }
  }

  const database = await initializeDatabase()
  try {
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
  } finally {
    database.close()
  }
})
