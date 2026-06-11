import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAuthenticatedUser } from '../../../../utils/companies/http'
import { requireCompanyAdminSpecialist, toCompanySpecialistPayload } from '../../../../utils/companies/specialists'
import { initializeDatabase } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const userId = requireAuthenticatedUser(event)
  const companyId = getRouterParam(event, 'id')
  const specialistId = getRouterParam(event, 'specialistId')
  if (!companyId || !specialistId) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found', data: { code: 'SPECIALIST_NOT_FOUND' } })
  }

  const database = await initializeDatabase()
  try {
    const { specialist } = await requireCompanyAdminSpecialist(database, { userId, companyId, specialistId })
    return { specialist: await toCompanySpecialistPayload(specialist) }
  } finally {
    database.close()
  }
})
