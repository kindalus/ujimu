import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAuthenticatedUser, requireCompanyMember, toCompanyDetailPayload } from '../../utils/companies/http'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const userId = requireAuthenticatedUser(event)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found' })
  }

  const database = await initializeDatabase()
  try {
    return toCompanyDetailPayload(requireCompanyMember(database, userId, companyId))
  } finally {
    database.close()
  }
})
