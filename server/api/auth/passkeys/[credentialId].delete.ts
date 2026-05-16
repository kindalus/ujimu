import { createError, defineEventHandler, getRouterParam } from 'h3'
import { assertPasskeyMutationOrigin, mapPasskeyError, requireSession } from '../../../utils/auth/passkey-http'
import { deletePasskeyCredential } from '../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const credentialId = getRouterParam(event, 'credentialId')?.trim()
  if (!credentialId) {
    throw createError({ statusCode: 404, statusMessage: 'Passkey not found' })
  }

  const database = await initializeDatabase()
  try {
    assertPasskeyMutationOrigin(event)
    return deletePasskeyCredential(database, { userId: session.userId, credentialId })
  } catch (error) {
    mapPasskeyError(error)
  } finally {
    database.close()
  }
})
