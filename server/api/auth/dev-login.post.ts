import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { devLogin, DevLoginError } from '../../utils/auth/dev-login'
import type { OtpChannel } from '../../utils/auth/otp'
import { getPasskeyReadiness } from '../../utils/auth/passkeys'
import { completeLogin } from '../../utils/auth/login'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid development login request' })
  }

  const body = await readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid development login request' })
  })
  const database = await initializeDatabase()

  try {
    const result = devLogin(database, parseDevLoginBody(body))
    completeLogin(event, database, { userId: result.user.id, sessionToken: result.sessionToken })

    return {
      authenticated: true,
      user: {
        id: result.user.id,
        displayContact: result.user.displayContact
      },
      authMethod: 'unknown',
      recentOtpAuthenticated: false,
      passkeys: getPasskeyReadiness(process.env)
    }
  } catch (error) {
    if (error instanceof DevLoginError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
        data: { code: error.code }
      })
    }

    throw error
  }
})

function parseDevLoginBody(body: unknown): { channel: OtpChannel; contact: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DevLoginError(400, 'INVALID_DEV_AUTH_REQUEST', 'Invalid development authentication request.')
  }

  const channel = (body as { channel?: unknown }).channel
  const contact = (body as { contact?: unknown }).contact

  if ((channel !== 'email' && channel !== 'phone') || typeof contact !== 'string') {
    throw new DevLoginError(400, 'INVALID_DEV_AUTH_REQUEST', 'Invalid development authentication request.')
  }

  return { channel, contact }
}
