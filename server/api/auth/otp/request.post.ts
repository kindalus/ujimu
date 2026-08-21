import { createError, defineEventHandler, getRequestHeader, readBody, setResponseStatus } from 'h3'
import { OtpDeliveryError, OtpRateLimitError, OtpValidationError, requestOtp } from '../../../utils/auth/otp'
import { initializeDatabase } from '../../../utils/db'
import { createNotificationProviderFromEnv, getOtpDeliveryCapabilities } from '../../../utils/notifications/provider'
import { resolveTrustedClientIp } from '../../../utils/security/client-ip'

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
    const input = parseOtpRequestBody(body)
    if (!getOtpDeliveryCapabilities().otpChannels.includes(input.channel)) {
      throw new OtpDeliveryError()
    }
    const requestIp = resolveTrustedClientIp(event)
    return await requestOtp(database, input, {
      provider: createNotificationProviderFromEnv(),
      ...(requestIp ? { requestIp } : {})
    })
  } catch (error) {
    if (error instanceof OtpRateLimitError) {
      setResponseStatus(event, 429)
      return { error: { code: error.code, message: error.message } }
    }

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
