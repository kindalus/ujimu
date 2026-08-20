import { defineEventHandler } from 'h3'
import { getActiveCompanyForUser, setActiveCompanyForUser } from '../../utils/companies/repository'
import { mapCompanyError, readRequiredJsonBody, requireAuthenticatedUser } from '../../utils/companies/http'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const userId = requireAuthenticatedUser(event, database)
  const body = await readRequiredJsonBody(event)
  const companyId = parseCompanyId(body)

  try {
    setActiveCompanyForUser(database, { userId, companyId })
    return { activeCompany: getActiveCompanyForUser(database, userId) }
  } catch (error) {
    mapCompanyError(error)
  }
})

function parseCompanyId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('companyId' in body)) {
    return null
  }
  const value = (body as { companyId: unknown }).companyId
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  return value.trim() || null
}
