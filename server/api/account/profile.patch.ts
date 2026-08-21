import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { ProfileValidationError, updateDisplayName } from '../../utils/account/profile'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  if (!(getRequestHeader(event, 'content-type') ?? '').toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, message: 'Pedido inválido.' })
  }
  const body = await readBody(event, { strict: true }).catch(() => undefined)
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'displayName')) {
    throw createError({ statusCode: 400, message: 'Pedido inválido.' })
  }

  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) throw createError({ statusCode: 401, message: 'Autenticação necessária.' })

  try {
    return { displayName: updateDisplayName(database, session.userId, (body as { displayName?: unknown }).displayName) }
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    throw error
  }
})
