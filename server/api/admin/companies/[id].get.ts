import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getAdminCompanyDetailPayload } from '../../../utils/admin/companies'
import { requireAdmin } from '../../../utils/admin/guards'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
  }

  const database = await initializeDatabase()
  try {
    requireAdmin(database, event)
    const payload = await getAdminCompanyDetailPayload(database, companyId)
    if (!payload) {
      throw createError({ statusCode: 404, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
    }
    return payload
  } finally {
    database.close()
  }
})
