import { createError, defineEventHandler, getRouterParam } from 'h3'
import {
  assertRecentOtp,
  makePrimaryContact,
  ProfileContactNotFoundError,
  RecentOtpRequiredError
} from '../../../../utils/account/profile'
import { readSessionFromEvent } from '../../../../utils/auth/session'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) throw createError({ statusCode: 401, message: 'Autenticação necessária.' })
  const identityId = getRouterParam(event, 'id')
  if (!identityId) throw createError({ statusCode: 400, message: 'Contacto inválido.' })

  try {
    assertRecentOtp(session)
    return { contacts: makePrimaryContact(database, session.userId, identityId) }
  } catch (error) {
    if (error instanceof RecentOtpRequiredError) {
      throw createError({ statusCode: 403, message: error.message, data: { code: 'RECENT_OTP_REQUIRED' } })
    }
    if (error instanceof ProfileContactNotFoundError) {
      throw createError({ statusCode: 404, message: error.message })
    }
    throw error
  }
})
