import { createError, defineEventHandler, getQuery } from 'h3'
import { listQuestionAnalytics } from '../../../utils/analytics/questions'
import { requireAdmin } from '../../../utils/admin/guards'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    requireAdmin(database, event)
    const query = getQuery(event)
    const specialistId = typeof query.specialistId === 'string' ? query.specialistId.trim() : ''
    if (!specialistId) {
      throw createError({ statusCode: 400, statusMessage: 'specialistId is required', data: { code: 'INVALID_SPECIALIST_ID' } })
    }

    return listQuestionAnalytics(database, { specialistId })
  } finally {
    database.close()
  }
})
