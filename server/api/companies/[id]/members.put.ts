import { createError, defineEventHandler, getRouterParam } from 'h3'
import { mapCompanyError, readRequiredJsonBody, requireAuthenticatedUser, requireCompanyAdmin } from '../../../utils/companies/http'
import { replaceCompanyMemberships } from '../../../utils/companies/repository'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const userId = requireAuthenticatedUser(event, database)
  const companyId = getRouterParam(event, 'id')
  if (!companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found' })
  }

  const body = parseMembersBody(await readRequiredJsonBody(event))
  try {
    requireCompanyAdmin(database, userId, companyId)
    const memberships = replaceCompanyMemberships(database, {
      companyId,
      admins: body.admins,
      members: body.members
    })
    return { memberships }
  } catch (error) {
    mapCompanyError(error)
  }
})

function parseMembersBody(body: unknown): { admins: string[]; members: string[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid company members payload' })
  }
  const record = body as Record<string, unknown>
  return {
    admins: readStringArray(record.admins),
    members: readStringArray(record.members)
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid company members payload' })
  }
  return value
}
