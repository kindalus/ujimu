import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAuthenticatedUser, requireCompanyMember, toCompanyDetailPayload } from '../../utils/companies/http'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const userId = requireAuthenticatedUser(event, database)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found' })
  }

  return toCompanyDetailPayload(requireCompanyMember(database, userId, companyId))
})
