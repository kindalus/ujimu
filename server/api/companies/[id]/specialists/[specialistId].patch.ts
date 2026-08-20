import { createError, defineEventHandler, getRouterParam } from 'h3'
import { readRequiredJsonBody, requireAuthenticatedUser } from '../../../../utils/companies/http'
import {
  recordCompanyAdminAuditEvent,
  requireCompanyAdminSpecialist,
  toCompanySpecialistPayload,
  updateCompanySpecialistPrompt
} from '../../../../utils/companies/specialists'
import { initializeDatabase } from '../../../../utils/db'
import { SpecialistConfigError } from '../../../../utils/specialists/schema'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const userId = requireAuthenticatedUser(event, database)
  const companyId = getRouterParam(event, 'id')
  const specialistId = getRouterParam(event, 'specialistId')
  if (!companyId || !specialistId) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found', data: { code: 'SPECIALIST_NOT_FOUND' } })
  }

  const body = parsePromptPatchBody(await readRequiredJsonBody(event))
  try {
    const { specialist } = await requireCompanyAdminSpecialist(database, { userId, companyId, specialistId })
    const updated = await updateCompanySpecialistPrompt(specialist, body.system_prompt)
    recordCompanyAdminAuditEvent(database, {
      companyId,
      actorUserId: userId,
      specialistId,
      action: 'specialist_prompt_updated',
      metadata: { changed_fields: ['system_prompt'] }
    })
    return { specialist: await toCompanySpecialistPayload(updated) }
  } catch (error) {
    if (error instanceof SpecialistConfigError) {
      throw createError({ statusCode: 400, statusMessage: error.message, data: { code: error.code } })
    }
    throw error
  }
})

function parsePromptPatchBody(body: unknown): { system_prompt: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid specialist payload' })
  }

  const entries = Object.entries(body as Record<string, unknown>)
  if (entries.length !== 1 || entries[0]?.[0] !== 'system_prompt') {
    throw createError({ statusCode: 400, statusMessage: 'Only system_prompt can be changed' })
  }

  const systemPrompt = entries[0][1]
  if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid system_prompt' })
  }

  return { system_prompt: systemPrompt }
}
