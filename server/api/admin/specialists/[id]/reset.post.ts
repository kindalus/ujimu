import { createError, defineEventHandler, getRequestHeader, getRouterParam, readBody, setResponseStatus } from 'h3'
import { recordAdminAuditEvent } from '../../../../utils/admin/audit'
import { requireAdmin } from '../../../../utils/admin/guards'
import { initializeDatabase } from '../../../../utils/db'
import {
  BackgroundJobConflictError,
  enqueueSpecialistHardResetJob,
  scheduleDueBackgroundJobs
} from '../../../../utils/jobs/background'
import { editSpecialist } from '../../../../utils/specialists/manager'
import { getSpecialistById } from '../../../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const admin = requireAdmin(database, event)
  const specialistId = getRouterParam(event, 'id')
  if (!specialistId || !(await getSpecialistById(specialistId))) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }

  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid reset request' })
  }
  const body = await readBody(event, { strict: true }).catch(() => undefined)
  const confirmationId = readConfirmationId(body)
  if (confirmationId !== specialistId) {
    throw createError({ statusCode: 400, statusMessage: 'Specialist confirmation does not match' })
  }

  try {
    const job = enqueueSpecialistHardResetJob(database, {
      specialistId,
      requestedByUserId: admin.user.id,
      requestedByContact: admin.adminContact
    })
    await editSpecialist(specialistId, { status: 'initializing' })
    recordAdminAuditEvent(database, {
      admin,
      action: 'specialist_hard_reset_requested',
      specialistId,
      metadata: { job_id: job.id }
    })
    scheduleDueBackgroundJobs()
    setResponseStatus(event, 202)
    return { job }
  } catch (error) {
    if (error instanceof BackgroundJobConflictError) {
      throw createError({ statusCode: 409, statusMessage: error.message, data: { code: 'SPECIALIST_JOB_ACTIVE' } })
    }
    throw error
  }
})

function readConfirmationId(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid reset payload' })
  }
  const confirmationId = (body as { confirmationId?: unknown }).confirmationId
  if (typeof confirmationId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid reset payload' })
  }
  return confirmationId
}
