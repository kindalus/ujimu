import { createError, defineEventHandler, getRequestHeader, readBody, setResponseStatus } from 'h3'
import { readSessionFromEvent } from '../../../utils/auth/session'
import { BillingValidationError, createCorporateBillingCheckout } from '../../../utils/billing/subscriptions'
import { initializeDatabase } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const session = readSessionFromEvent(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
      data: { code: 'AUTHENTICATION_REQUIRED' }
    })
  }

  const body = await readJsonBody(event)
  const input = parseCorporateCheckoutBody(body)
  const database = await initializeDatabase()

  try {
    const checkout = createCorporateBillingCheckout(database, {
      userId: session.userId,
      ...input
    })
    setResponseStatus(event, 201)
    return checkout
  } catch (error) {
    if (error instanceof BillingValidationError) {
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
    throw createError({ statusCode: 400, statusMessage: 'Invalid corporate billing request' })
  }

  return readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid corporate billing request' })
  })
}

function parseCorporateCheckoutBody(body: unknown): {
  company: { nif: string; name: string; phone: string; address: string }
  seats: number
  adminEmails: string[]
  memberEmails: string[]
} {
  if (!isRecord(body) || !isRecord(body.company)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid corporate billing payload' })
  }

  const company = body.company
  return {
    company: {
      nif: readString(company.nif),
      name: readString(company.name),
      phone: readString(company.phone),
      address: readString(company.address)
    },
    seats: readPositiveInteger(body.seats),
    adminEmails: readStringArray(body.adminEmails),
    memberEmails: readStringArray(body.memberEmails)
  }
}

function readString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid corporate billing payload' })
  }
  return value.trim()
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid corporate billing payload' })
  }
  return value
}

function readStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid corporate billing payload' })
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
