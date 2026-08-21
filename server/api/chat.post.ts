import type { DatabaseSync } from 'node:sqlite'
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readBody,
  sendIterable,
  setResponseHeaders,
  setResponseStatus
} from 'h3'
import { resolveVisitorIdentity } from '../utils/analytics/visitors'
import { createChatEventStream } from '../utils/chat/engine'
import { serializeChatEvent } from '../utils/chat/ndjson'
import type { ChatStreamEvent } from '../utils/chat/types'
import { ChatRequestError, validateChatRequestBody } from '../utils/chat/request'
import { resolveQuotaSubjectWithSubscription } from '../utils/billing/subscriptions'
import { getAdminSession } from '../utils/admin/guards'
import { getActiveCompanyForUser } from '../utils/companies/repository'
import { initializeDatabase } from '../utils/db'
import { resolveLaunchFeatures } from '../utils/features'
import { QuotaExceededError } from '../utils/quota/errors'
import { resolveQuotaSubject } from '../utils/quota/identity'
import { assertMaxRequestBytes, MAX_JSON_BODY_BYTES } from '../utils/security/request-guards'

export default defineEventHandler(async (event) => {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid chat request',
      data: { code: 'INVALID_CHAT_REQUEST' }
    })
  }

  assertMaxRequestBytes(event, MAX_JSON_BODY_BYTES)

  const body = await readBody(event, { strict: true }).catch(() => {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid chat request',
      data: { code: 'INVALID_CHAT_REQUEST' }
    })
  })

  const database = await initializeDatabase()

  try {
    const input = validateChatRequestBody(body)
    const baseSubject = resolveQuotaSubject(event)
    const features = resolveLaunchFeatures(process.env)
    const subject = resolveQuotaSubjectWithSubscription(database, baseSubject, { env: process.env })
    const adminSession = getAdminSession(database, event)
    const corporateSubject = !features.companiesEnabled || subject.type === 'anonymous' || adminSession.admin
      ? null
      : resolveActiveCompanyQuotaSubject(database, subject.id)
    const visitor = resolveVisitorIdentity(event)

    const stream = await createChatEventStream(input, {
      ...(adminSession.admin ? {} : {
        quota: {
          database,
          subject: corporateSubject ?? subject,
          fallbackSubject: corporateSubject ? subject : undefined
        }
      }),
      history: {
        database,
        subject
      },
      analytics: {
        database,
        visitorId: visitor.visitorId,
        ...(subject.type === 'anonymous' ? {} : { userId: subject.id })
      }
    })

    setResponseHeaders(event, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    })

    return sendIterable(event, stream, { serializer: serializeChatEvent })
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      setResponseStatus(event, 429)
      return { error: error.payload }
    }

    if (error instanceof ChatRequestError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
        data: { code: error.code }
      })
    }

    throw error
  }
})

function resolveActiveCompanyQuotaSubject(database: DatabaseSync, userId: string): { type: 'company'; id: string; seats: number } | null {
  const activeCompany = getActiveCompanyForUser(database, userId)
  if (!activeCompany?.active) return null
  return { type: 'company', id: activeCompany.id, seats: activeCompany.seats }
}
