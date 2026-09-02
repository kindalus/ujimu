import { createError, defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import {
  decideQuestionDerivation,
  DerivationActionError,
  type DerivationDecision
} from '../../../../../utils/analytics/derivation'
import { requireAdmin } from '../../../../../utils/admin/guards'
import { initializeDatabase } from '../../../../../utils/db'
import { BackgroundJobConflictError, scheduleDueBackgroundJobs } from '../../../../../utils/jobs/background'
import { getSpecialistById } from '../../../../../utils/specialists/registry'

const EVENT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const admin = requireAdmin(database, event)
  const eventId = readEventId(getRouterParam(event, 'eventId') ?? getRouterParam(event, 'id'))
  const body = await readBody(event, { strict: true }).catch(() => undefined)
  const decision = readDecision(body)
  const specialistId = readEventSpecialistId(database, eventId)
  if (!specialistId || !(await getSpecialistById(specialistId))) {
    throw createError({ statusCode: 404, message: 'A pergunta ou especialidade já não existe.', data: { code: 'QUESTION_EVENT_NOT_FOUND' } })
  }

  try {
    const action = decideQuestionDerivation(database, {
      eventId,
      decision,
      adminUserId: admin.user.id,
      adminContact: admin.adminContact
    })
    if (action.decision === 'derived') {
      scheduleDueBackgroundJobs()
      setResponseStatus(event, 202)
    }
    return {
      action: {
        eventId: action.eventId,
        specialistId: action.specialistId,
        decision: action.decision,
        decidedAt: action.decidedAt
      },
      job: action.jobId ? readPublicJob(database, action.jobId) : null
    }
  } catch (error) {
    throw toHttpError(error)
  }
})

function readEventId(value: string | undefined): string {
  const eventId = value?.trim() ?? ''
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw createError({ statusCode: 400, message: 'Identificador de pergunta inválido.', data: { code: 'INVALID_EVENT_ID' } })
  }
  return eventId
}

function readDecision(body: unknown): DerivationDecision {
  const decision = body && typeof body === 'object' && 'decision' in body
    ? (body as { decision?: unknown }).decision
    : undefined
  if (decision !== 'ignored' && decision !== 'derived') {
    throw createError({ statusCode: 400, message: 'A decisão tem de ser ignored ou derived.', data: { code: 'INVALID_DERIVATION_DECISION' } })
  }
  return decision
}

function readEventSpecialistId(database: Awaited<ReturnType<typeof initializeDatabase>>, eventId: string): string | undefined {
  const row = database.prepare('SELECT specialist_id FROM question_analytics_events WHERE id = ?').get(eventId) as { specialist_id: string } | undefined
  return row?.specialist_id
}

function readPublicJob(database: Awaited<ReturnType<typeof initializeDatabase>>, jobId: string) {
  return database.prepare(`
    SELECT id, status, last_error_code AS errorCode, last_error_message AS errorMessage
    FROM background_jobs WHERE id = ?
  `).get(jobId)
}

function toHttpError(error: unknown) {
  if (error instanceof DerivationActionError) {
    const statusCode = error.code === 'QUESTION_EVENT_NOT_FOUND' ? 404
      : error.code === 'DERIVATION_DECISION_CONFLICT' ? 409
        : 400
    const message = error.code === 'QUESTION_EVENT_NOT_FOUND'
      ? 'A pergunta já não existe.'
      : error.code === 'QUESTION_EVENT_INELIGIBLE'
        ? 'A pergunta não é elegível para curadoria multi-fonte.'
        : 'Esta pergunta já tem uma decisão final diferente.'
    return createError({ statusCode, message, data: { code: error.code } })
  }
  if (error instanceof BackgroundJobConflictError) {
    return createError({ statusCode: 409, message: 'A especialidade já tem uma tarefa activa.', data: { code: 'BACKGROUND_JOB_CONFLICT' } })
  }
  return error
}
