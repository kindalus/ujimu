import { createError, defineEventHandler } from 'h3'
import { getRequestOrigin, mapPasskeyError, resolvePasskeySubject } from '../../../../utils/auth/passkey-http'
import { createPasskeyAuthenticationOptions } from '../../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../../utils/db'
import { getOtpDeliveryCapabilities } from '../../../../utils/notifications/provider'

export default defineEventHandler(async (event) => {
  if (getOtpDeliveryCapabilities().otpChannels.length === 0) {
    throw createError({ statusCode: 503, statusMessage: 'Account login unavailable' })
  }
  const database = await initializeDatabase()
  try {
    return await createPasskeyAuthenticationOptions(database, {
      origin: getRequestOrigin(event),
      subject: resolvePasskeySubject(event)
    })
  } catch (error) {
    mapPasskeyError(error)
  }
})
