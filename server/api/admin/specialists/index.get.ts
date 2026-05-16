import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/admin/guards'
import { toAdminSpecialistPayload } from '../../../utils/admin/specialists'
import { initializeDatabase } from '../../../utils/db'
import { getSpecialistRegistry } from '../../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    requireAdmin(database, event)
    const snapshot = await getSpecialistRegistry()
    return {
      specialists: await Promise.all(snapshot.specialists.map(toAdminSpecialistPayload)),
      errors: snapshot.errors
    }
  } finally {
    database.close()
  }
})
