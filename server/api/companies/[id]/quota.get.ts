import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAuthenticatedUser, requireCompanyAdmin } from '../../../utils/companies/http'
import { initializeDatabase } from '../../../utils/db'
import { getCompanyQuotaUsage } from '../../../utils/quota/usage'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const userId = requireAuthenticatedUser(event, database)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found' })
  }

  requireCompanyAdmin(database, userId, companyId)
  return getCompanyQuotaUsage(database, { companyId })
})
