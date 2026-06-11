import { createError, defineEventHandler, getRequestHeader, readBody, setResponseStatus } from 'h3'
import { recordAdminAuditEvent } from '../../../utils/admin/audit'
import { requireAdmin } from '../../../utils/admin/guards'
import { toAdminSpecialistPayload } from '../../../utils/admin/specialists'
import { getCompany } from '../../../utils/companies/repository'
import { initializeDatabase } from '../../../utils/db'
import { createSpecialist, SpecialistOperationError } from '../../../utils/specialists/manager'
import { SpecialistConfigError, type SpecialistConfig } from '../../../utils/specialists/schema'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const admin = requireAdmin(database, event)
    const body = await readJsonBody(event)
    const input = parseSpecialistConfig(body)
    assertCompanyExistsWhenProvided(database, input.company_id)
    const specialist = await createSpecialist(input)
    recordAdminAuditEvent(database, {
      admin,
      action: 'specialist_created',
      specialistId: specialist.id,
      metadata: { wiki_type: specialist.wiki_type }
    })
    setResponseStatus(event, 201)
    return { specialist: await toAdminSpecialistPayload(specialist) }
  } catch (error) {
    if (error instanceof SpecialistOperationError && error.code === 'SPECIALIST_ALREADY_EXISTS') {
      throw createError({ statusCode: 409, statusMessage: error.message, data: { code: error.code } })
    }

    if (error instanceof SpecialistConfigError) {
      throw createError({ statusCode: 400, statusMessage: error.message, data: { code: error.code } })
    }

    throw error
  } finally {
    database.close()
  }
})

async function readJsonBody(event: Parameters<typeof getRequestHeader>[0]): Promise<unknown> {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid admin request' })
  }

  return readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid admin request' })
  })
}

function parseSpecialistConfig(body: unknown): SpecialistConfig {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid specialist payload' })
  }

  const record = body as Partial<SpecialistConfig>
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    wiki_type: record.wiki_type,
    system_prompt: record.system_prompt,
    citations_required: record.citations_required,
    streaming_enabled: record.streaming_enabled,
    status: record.status,
    company_id: record.company_id
  } as SpecialistConfig
}

function assertCompanyExistsWhenProvided(database: Awaited<ReturnType<typeof initializeDatabase>>, companyId: string | null | undefined): void {
  if (companyId && !getCompany(database, companyId)) {
    throw createError({ statusCode: 400, statusMessage: 'Company not found', data: { code: 'COMPANY_NOT_FOUND' } })
  }
}
