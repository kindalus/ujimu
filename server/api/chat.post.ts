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
import { initializeDatabase } from '../utils/db'
import { QuotaExceededError } from '../utils/quota/errors'
import { resolveQuotaSubject } from '../utils/quota/identity'

export default defineEventHandler(async (event) => {
  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid chat request',
      data: { code: 'INVALID_CHAT_REQUEST' }
    })
  }

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
    const subject = resolveQuotaSubjectWithSubscription(database, baseSubject)
    const visitor = resolveVisitorIdentity(event)

    const stream = await createChatEventStream(input, {
      quota: {
        database,
        subject
      },
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

    return sendIterable(event, closeDatabaseAfterStream(stream, database), { serializer: serializeChatEvent })
  } catch (error) {
    database.close()

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

async function* closeDatabaseAfterStream(
  stream: AsyncIterable<ChatStreamEvent>,
  database: DatabaseSync
): AsyncIterable<ChatStreamEvent> {
  try {
    yield* stream
  } finally {
    database.close()
  }
}
