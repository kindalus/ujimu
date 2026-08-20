import { createError, defineEventHandler, getQuery } from 'h3'
import { AnalyticsVisitorError, countDistinctMonthlyVisitors, normalizeMonth } from '../../../utils/analytics/visitors'
import { requireAdmin } from '../../../utils/admin/guards'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    requireAdmin(database, event)
    const query = getQuery(event)
    const month = normalizeMonth(typeof query.month === 'string' ? query.month : undefined)
    return countDistinctMonthlyVisitors(database, month)
  } catch (error) {
    if (error instanceof AnalyticsVisitorError) {
      throw createError({ statusCode: 400, statusMessage: error.message, data: { code: error.code } })
    }

    throw error
  }
})
