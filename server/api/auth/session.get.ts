import { defineEventHandler } from 'h3'
import { getPublicSessionUser } from '../../utils/auth/otp'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const session = readSessionFromEvent(event)
  if (!session) {
    return { authenticated: false }
  }

  const database = await initializeDatabase()
  try {
    const user = getPublicSessionUser(database, session.userId)
    if (!user) {
      return { authenticated: false }
    }

    return {
      authenticated: true,
      user
    }
  } finally {
    database.close()
  }
})
