import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readBody,
  setResponseStatus
} from 'h3'
import { getPublicSessionUser, OtpDeliveryError, OtpRateLimitError, OtpValidationError, OtpVerificationError, verifyOtp } from '../../../utils/auth/otp'
import { completeLogin } from '../../../utils/auth/login'
import { readSessionFromEvent } from '../../../utils/auth/session'
import { initializeDatabase } from '../../../utils/db'
import { createNotificationProviderFromEnv, getOtpDeliveryCapabilities } from '../../../utils/notifications/provider'

export default defineEventHandler(async (event) => {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OTP verification' })
  }

  const body = await readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OTP verification' })
  })
  const database = await initializeDatabase()

  try {
    const input = parseOtpVerifyBody(body)
    if (!getOtpDeliveryCapabilities().otpChannels.includes(input.channel)) {
      throw new OtpDeliveryError()
    }
    const currentSession = readSessionFromEvent(event, database)
    const provider = createNotificationProviderFromEnv()
    const result = await verifyOtp(database, input, {
      currentUserId: currentSession?.userId,
      ...(provider.verifyOtp ? { verifyCode: provider.verifyOtp.bind(provider) } : {})
    })
    completeLogin(event, database, { userId: result.user.id, sessionToken: result.sessionToken })
    const publicUser = getPublicSessionUser(database, result.user.id) ?? result.user

    return {
      authenticated: true,
      user: {
        id: publicUser.id,
        displayContact: publicUser.displayContact
      }
    }
  } catch (error) {
    if (error instanceof OtpRateLimitError) {
      throw createError({
        statusCode: 429,
        statusMessage: error.message,
        data: { code: error.code }
      })
    }

    if (error instanceof OtpValidationError || error instanceof OtpVerificationError) {
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

function parseOtpVerifyBody(body: unknown): {
  channel: 'email' | 'phone'
  contact: string
  code: string
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OtpValidationError()
  }

  const channel = (body as { channel?: unknown }).channel
  const contact = (body as { contact?: unknown }).contact
  const code = (body as { code?: unknown }).code

  if ((channel !== 'email' && channel !== 'phone') || typeof contact !== 'string' || typeof code !== 'string') {
    throw new OtpValidationError()
  }

  return { channel, contact, code }
}
