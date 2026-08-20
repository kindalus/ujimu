import { createError, defineEventHandler, getRequestHeader, getRouterParam, readBody } from 'h3'
import { recordAdminAuditEvent } from '../../../utils/admin/audit'
import { requireAdmin } from '../../../utils/admin/guards'
import { toAdminSpecialistPayload } from '../../../utils/admin/specialists'
import { getCompany } from '../../../utils/companies/repository'
import { initializeDatabase } from '../../../utils/db'
import { editSpecialist, SpecialistOperationError, type EditSpecialistInput } from '../../../utils/specialists/manager'
import { getSpecialistById } from '../../../utils/specialists/registry'
import { SpecialistConfigError } from '../../../utils/specialists/schema'

const mutableFields = ['name', 'description', 'system_prompt', 'citations_required', 'streaming_enabled', 'status', 'company_id'] as const

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const admin = requireAdmin(database, event)
    const specialistId = getRequiredSpecialistId(event)
    const body = await readJsonBody(event)
    const input = parseEditInput(body)
    const existing = await getSpecialistById(specialistId)
    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
    }

    assertCompanyExistsWhenProvided(database, input.company_id)
    const changedFields = mutableFields.filter((field) => input[field] !== undefined && input[field] !== existing[field])
    const companyAssignmentChanged = input.company_id !== undefined && input.company_id !== existing.company_id
    const specialist = await editSpecialist(specialistId, input)
    recordAdminAuditEvent(database, {
      admin,
      action: companyAssignmentChanged ? 'specialist_company_assignment_updated' : 'specialist_updated',
      specialistId,
      metadata: companyAssignmentChanged
        ? {
            changed_fields: changedFields,
            previous_company_id: existing.company_id,
            company_id: specialist.company_id
          }
        : { changed_fields: changedFields }
    })

    return { specialist: await toAdminSpecialistPayload(specialist) }
  } catch (error) {
    if (error instanceof SpecialistOperationError && error.code === 'SPECIALIST_NOT_FOUND') {
      throw createError({ statusCode: 404, statusMessage: error.message, data: { code: error.code } })
    }

    if (error instanceof SpecialistConfigError) {
      throw createError({ statusCode: 400, statusMessage: error.message, data: { code: error.code } })
    }

    throw error
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

function parseEditInput(body: unknown): EditSpecialistInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid specialist payload' })
  }

  const record = body as Record<string, unknown>
  if ('id' in record || 'wiki_type' in record) {
    throw createError({ statusCode: 400, statusMessage: 'Specialist id and wiki type cannot be edited' })
  }

  const input: EditSpecialistInput = {}
  for (const field of mutableFields) {
    if (!(field in record)) continue
    const value = record[field]
    if (field === 'citations_required' || field === 'streaming_enabled') {
      if (typeof value !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: `Invalid field ${field}` })
      }
      input[field] = value
      continue
    }

    if (field === 'status') {
      if (value !== 'active' && value !== 'suspended') {
        throw createError({ statusCode: 400, statusMessage: `Invalid field ${field}` })
      }
      input.status = value
      continue
    }

    if (field === 'company_id') {
      if (value === null || value === undefined || value === '') {
        input.company_id = null
        continue
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw createError({ statusCode: 400, statusMessage: `Invalid field ${field}` })
      }
      input.company_id = value.trim()
      continue
    }

    if (typeof value !== 'string' || (field !== 'system_prompt' && value.trim().length === 0)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid field ${field}` })
    }
    input[field] = value
  }

  return input
}

function assertCompanyExistsWhenProvided(database: Awaited<ReturnType<typeof initializeDatabase>>, companyId: string | null | undefined): void {
  if (companyId && !getCompany(database, companyId)) {
    throw createError({ statusCode: 400, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
  }
}
