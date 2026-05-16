import { defineEventHandler } from 'h3'
import { getRequestOrigin, mapPasskeyError, resolvePasskeySubject } from '../../../../utils/auth/passkey-http'
import { createPasskeyAuthenticationOptions } from '../../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    return await createPasskeyAuthenticationOptions(database, {
      origin: getRequestOrigin(event),
      subject: resolvePasskeySubject(event)
    })
  } catch (error) {
    mapPasskeyError(error)
  } finally {
    database.close()
  }
})
