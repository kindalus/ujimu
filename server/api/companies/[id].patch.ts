import { createError, defineEventHandler, getRouterParam } from 'h3'
import { mapCompanyError, readRequiredJsonBody, requireAuthenticatedUser, requireCompanyAdmin, toCompanyDetailPayload } from '../../utils/companies/http'
import { updateCompany } from '../../utils/companies/repository'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const userId = requireAuthenticatedUser(event)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found' })
  }

  const rawBody = await readRequiredJsonBody(event)
  const database = await initializeDatabase()
  try {
    requireCompanyAdmin(database, userId, companyId)
    const body = parseCompanyBody(rawBody)
    updateCompany(database, companyId, body)
    return toCompanyDetailPayload(requireCompanyAdmin(database, userId, companyId))
  } catch (error) {
    mapCompanyError(error)
  } finally {
    database.close()
  }
})

function parseCompanyBody(body: unknown): { nif: string; name: string; phone: string; address: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid company payload' })
  }
  const record = body as Record<string, unknown>
  return {
    nif: readString(record.nif),
    name: readString(record.name),
    phone: readString(record.phone),
    address: readString(record.address)
  }
}

function readString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid company payload' })
  }
  return value.trim()
}
