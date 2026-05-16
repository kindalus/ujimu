import { createError, defineEventHandler, getRequestHeader, readBody, setResponseStatus } from 'h3'
import { OtpDeliveryError, OtpValidationError, requestOtp } from '../../../utils/auth/otp'
import { initializeDatabase } from '../../../utils/db'
import { createNotificationProviderFromEnv } from '../../../utils/notifications/provider'

export default defineEventHandler(async (event) => {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OTP request' })
  }

  const body = await readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OTP request' })
  })
  const database = await initializeDatabase()

  try {
    return await requestOtp(database, parseOtpRequestBody(body), {
      provider: createNotificationProviderFromEnv()
    })
  } catch (error) {
    if (error instanceof OtpValidationError) {
      throw createError({
        statusCode: 400,
        statusMessage: error.message,
        data: { code: error.code }
      })
    }

    if (error instanceof OtpDeliveryError) {
      setResponseStatus(event, 503)
      return { error: { code: error.code, message: error.message } }
    }

    throw error
  } finally {
    database.close()
  }
})

function parseOtpRequestBody(body: unknown): { channel: 'email' | 'phone'; contact: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OtpValidationError()
  }

  const channel = (body as { channel?: unknown }).channel
  const contact = (body as { contact?: unknown }).contact

  if ((channel !== 'email' && channel !== 'phone') || typeof contact !== 'string') {
    throw new OtpValidationError()
  }

  return { channel, contact }
}
