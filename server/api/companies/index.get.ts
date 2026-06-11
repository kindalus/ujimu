import { defineEventHandler } from 'h3'
import { requireAuthenticatedUser } from '../../utils/companies/http'
import { getActiveCompanyForUser, listUserCompanies } from '../../utils/companies/repository'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const userId = requireAuthenticatedUser(event)
  const database = await initializeDatabase()
  try {
    return {
      companies: listUserCompanies(database, userId),
      activeCompany: getActiveCompanyForUser(database, userId)
    }
  } finally {
    database.close()
  }
})
