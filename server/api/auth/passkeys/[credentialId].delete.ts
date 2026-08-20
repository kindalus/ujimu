import { createError, defineEventHandler, getRouterParam } from 'h3'
import { assertPasskeyMutationOrigin, mapPasskeyError, requireSession } from '../../../utils/auth/passkey-http'
import { deletePasskeyCredential } from '../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = requireSession(event, database)
  const credentialId = getRouterParam(event, 'credentialId')?.trim()
  if (!credentialId) {
    throw createError({ statusCode: 404, statusMessage: 'Passkey not found' })
  }

  try {
    assertPasskeyMutationOrigin(event)
    return deletePasskeyCredential(database, { userId: session.userId, credentialId })
  } catch (error) {
    mapPasskeyError(error)
  }
})
