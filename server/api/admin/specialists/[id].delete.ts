import { createError, defineEventHandler, getRequestHeader, getRouterParam, readBody } from 'h3'
import { recordAdminAuditEvent } from '../../../utils/admin/audit'
import { requireAdmin } from '../../../utils/admin/guards'
import { initializeDatabase } from '../../../utils/db'
import { deleteSpecialist, SpecialistOperationError } from '../../../utils/specialists/manager'
import { SpecialistConfigError } from '../../../utils/specialists/schema'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const admin = requireAdmin(database, event)
    const specialistId = getRequiredSpecialistId(event)
    const body = await readJsonBody(event)
    const confirmationId = readConfirmationId(body)

    if (confirmationId !== specialistId) {
      throw createError({ statusCode: 400, statusMessage: 'Specialist confirmation does not match' })
    }

    const deleted = await deleteSpecialist(specialistId)
    recordAdminAuditEvent(database, {
      admin,
      action: 'specialist_deleted',
      specialistId,
      metadata: { trash_path: deleted.trashPath }
    })

    return { deleted: true, specialistId }
  } catch (error) {
    if (error instanceof SpecialistOperationError && error.code === 'SPECIALIST_NOT_FOUND') {
      throw createError({ statusCode: 404, statusMessage: error.message, data: { code: error.code } })
    }

    if (error instanceof SpecialistConfigError) {
      throw createError({ statusCode: 400, statusMessage: error.message, data: { code: error.code } })
    }

    throw error
  } finally {
    database.close()
  }
})

function getRequiredSpecialistId(event: Parameters<typeof getRouterParam>[0]): string {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }
  return id
}

async function readJsonBody(event: Parameters<typeof getRequestHeader>[0]): Promise<unknown> {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid admin request' })
  }

  return readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid admin request' })
  })
}

function readConfirmationId(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid delete payload' })
  }

  const confirmationId = (body as { confirmationId?: unknown }).confirmationId
  if (typeof confirmationId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid delete payload' })
  }

  return confirmationId
}
