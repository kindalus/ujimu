import { createError, defineEventHandler, getRequestHeader, readBody, setResponseStatus } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import {
  BillingValidationError,
  createBillingCheckout,
  parseBillingPaymentMethod,
  parseBillingProvider
} from '../../utils/billing/subscriptions'
import { initializeDatabase } from '../../utils/db'

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
  const input = parseCheckoutBody(body)
  const database = await initializeDatabase()

  try {
    const checkout = createBillingCheckout(database, {
      userId: session.userId,
      provider: input.provider,
      method: input.method
    })
    setResponseStatus(event, 201)
    return { checkout }
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
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing request' })
  }

  return readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing request' })
  })
}

function parseCheckoutBody(body: unknown): { provider: NonNullable<ReturnType<typeof parseBillingProvider>>; method: NonNullable<ReturnType<typeof parseBillingPaymentMethod>> } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing payload' })
  }

  const record = body as Record<string, unknown>
  const provider = parseBillingProvider(record.provider)
  const method = parseBillingPaymentMethod(record.method)

  if (!provider || !method) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing payload' })
  }

  return { provider, method }
}
