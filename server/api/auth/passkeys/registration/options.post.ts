import { defineEventHandler } from 'h3'
import { getRequestOrigin, mapPasskeyError, requireSession } from '../../../../utils/auth/passkey-http'
import { createPasskeyRegistrationOptions } from '../../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = requireSession(event, database)
  try {
    return await createPasskeyRegistrationOptions(database, {
      userId: session.userId,
      session,
      origin: getRequestOrigin(event)
    })
  } catch (error) {
    mapPasskeyError(error)
  }
})
