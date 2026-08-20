import { defineEventHandler } from 'h3'
import { getRequestOrigin, mapPasskeyError, readPasskeyJsonBody, resolvePasskeySubject } from '../../../../utils/auth/passkey-http'
import { setSessionCookie } from '../../../../utils/auth/session'
import { verifyPasskeyAuthentication } from '../../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readPasskeyJsonBody(event)
  const database = await initializeDatabase()
  try {
    const result = await verifyPasskeyAuthentication(database, {
      origin: getRequestOrigin(event),
      subject: resolvePasskeySubject(event),
      response: body
    })
    setSessionCookie(event, result.sessionToken)
    return {
      authenticated: true,
      user: result.user
    }
  } catch (error) {
    mapPasskeyError(error)
  }
})
