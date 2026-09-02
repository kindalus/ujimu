import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { DerivationActionError, retryQuestionDerivation } from '../../../../../utils/analytics/derivation'
import { requireAdmin } from '../../../../../utils/admin/guards'
import { initializeDatabase } from '../../../../../utils/db'
import { scheduleDueBackgroundJobs } from '../../../../../utils/jobs/background'

const EVENT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  requireAdmin(database, event)
  const eventId = (getRouterParam(event, 'eventId') ?? getRouterParam(event, 'id'))?.trim() ?? ''
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw createError({ statusCode: 400, message: 'Identificador de pergunta inválido.', data: { code: 'INVALID_EVENT_ID' } })
  }

  try {
    const job = retryQuestionDerivation(database, { eventId })
    scheduleDueBackgroundJobs()
    setResponseStatus(event, 202)
    return {
      job: {
        id: job.id,
        status: job.status,
        errorCode: job.last_error_code,
        errorMessage: job.last_error_message
      }
    }
  } catch (error) {
    if (error instanceof DerivationActionError) {
      throw createError({ statusCode: 409, message: 'A derivação não está em estado de repetição.', data: { code: error.code } })
    }
    throw error
  }
})
