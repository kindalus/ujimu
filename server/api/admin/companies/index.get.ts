import { defineEventHandler } from 'h3'
import { listAdminCompaniesPayload } from '../../../utils/admin/companies'
import { requireAdmin } from '../../../utils/admin/guards'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    requireAdmin(database, event)
    return { companies: await listAdminCompaniesPayload(database) }
  } finally {
    database.close()
  }
})
