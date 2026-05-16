import { timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getRequestHeader, getRouterParam, readBody } from 'h3'
import {
  BillingValidationError,
  parseBillingProvider,
  processBillingWebhookEvent,
  type BillingPaymentStatus
} from '../../../utils/billing/subscriptions'
import { initializeDatabase } from '../../../utils/db'

const BILLING_WEBHOOK_SECRET_HEADER = 'x-ujimu-billing-secret'

export default defineEventHandler(async (event) => {
  assertWebhookSecret(event)

  const provider = parseBillingProvider(getRouterParam(event, 'provider'))
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing provider' })
  }

  const body = await readJsonBody(event)
  const input = parseWebhookBody(body)
  const database = await initializeDatabase()

  try {
    return processBillingWebhookEvent(database, {
      provider,
      eventId: input.eventId,
      paymentId: input.paymentId,
      status: input.status
    })
  } catch (error) {
    if (error instanceof BillingValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message, data: { code: error.code } })
    }

    throw error
  } finally {
    database.close()
  }
})

function assertWebhookSecret(event: Parameters<typeof getRequestHeader>[0]): void {
  const expectedSecret = process.env.UJIMU_BILLING_WEBHOOK_SECRET
  if (!expectedSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Billing webhook secret is not configured',
      data: { code: 'BILLING_WEBHOOK_SECRET_MISSING' }
    })
  }

  const providedSecret = getRequestHeader(event, BILLING_WEBHOOK_SECRET_HEADER)
  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid billing webhook secret',
      data: { code: 'INVALID_BILLING_WEBHOOK_SECRET' }
    })
  }
}

async function readJsonBody(event: Parameters<typeof getRequestHeader>[0]): Promise<unknown> {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing webhook request' })
  }

  return readBody(event, { strict: true }).catch(() => {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing webhook request' })
  })
}

function parseWebhookBody(body: unknown): {
  eventId: string
  paymentId: string
  status: BillingPaymentStatus
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing webhook payload' })
  }

  const record = body as Record<string, unknown>
  if (typeof record.eventId !== 'string' || typeof record.paymentId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing webhook payload' })
  }

  if (record.status !== 'confirmed' && record.status !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid billing webhook payload' })
  }

  return {
    eventId: record.eventId,
    paymentId: record.paymentId,
    status: record.status
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
