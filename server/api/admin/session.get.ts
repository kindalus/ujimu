import { defineEventHandler } from 'h3'
import { getAdminSession } from '../../utils/admin/guards'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const session = getAdminSession(database, event)
    return {
      authenticated: session.authenticated,
      admin: session.admin,
      ...(session.user ? { user: session.user } : {})
    }
  } finally {
    database.close()
  }
})
