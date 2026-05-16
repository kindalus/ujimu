import { defineEventHandler } from 'h3'
import { requireSession } from '../../../utils/auth/passkey-http'
import { listPasskeyCredentials } from '../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const database = await initializeDatabase()
  try {
    return {
      passkeys: listPasskeyCredentials(database, { userId: session.userId })
    }
  } finally {
    database.close()
  }
})
