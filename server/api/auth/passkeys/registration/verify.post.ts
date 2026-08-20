import { defineEventHandler, setResponseStatus } from 'h3'
import { getRequestOrigin, mapPasskeyError, readPasskeyJsonBody, requireSession } from '../../../../utils/auth/passkey-http'
import { verifyPasskeyRegistration } from '../../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = requireSession(event, database)
  const body = await readPasskeyJsonBody(event)
  try {
    const result = await verifyPasskeyRegistration(database, {
      userId: session.userId,
      session,
      origin: getRequestOrigin(event),
      response: body
    })
    setResponseStatus(event, 201)
    return result
  } catch (error) {
    mapPasskeyError(error)
  }
})
