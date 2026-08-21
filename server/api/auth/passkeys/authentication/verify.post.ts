import { createError, defineEventHandler } from 'h3'
import { getRequestOrigin, mapPasskeyError, readPasskeyJsonBody, resolvePasskeySubject } from '../../../../utils/auth/passkey-http'
import { completeLogin } from '../../../../utils/auth/login'
import { verifyPasskeyAuthentication } from '../../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../../utils/db'
import { getOtpDeliveryCapabilities } from '../../../../utils/notifications/provider'

export default defineEventHandler(async (event) => {
  if (getOtpDeliveryCapabilities().otpChannels.length === 0) {
    throw createError({ statusCode: 503, statusMessage: 'Account login unavailable' })
  }
  const body = await readPasskeyJsonBody(event)
  const database = await initializeDatabase()
  try {
    const result = await verifyPasskeyAuthentication(database, {
      origin: getRequestOrigin(event),
      subject: resolvePasskeySubject(event),
      response: body
    })
    completeLogin(event, database, { userId: result.user.id, sessionToken: result.sessionToken })
    return {
      authenticated: true,
      user: result.user
    }
  } catch (error) {
    mapPasskeyError(error)
  }
})
