import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAuthenticatedUser, requireCompanyAdmin } from '../../../../utils/companies/http'
import { listCompanySpecialistPayloads } from '../../../../utils/companies/specialists'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const userId = requireAuthenticatedUser(event, database)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
  }

  requireCompanyAdmin(database, userId, companyId)
  return { specialists: await listCompanySpecialistPayloads(companyId) }
})
