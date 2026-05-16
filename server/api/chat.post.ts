import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readBody,
  sendIterable,
  setResponseHeaders,
  setResponseStatus
} from 'h3'
import { createChatEventStreamForSpecialist } from '../utils/chat/engine'
import { serializeChatEvent } from '../utils/chat/ndjson'
import { ChatRequestError, specialistNotFound, validateChatRequestBody } from '../utils/chat/request'
import { initializeDatabase } from '../utils/db'
import { QuotaExceededError } from '../utils/quota/errors'
import { resolveQuotaSubject } from '../utils/quota/identity'
import { getSpecialistById } from '../utils/specialists/registry'

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
    const specialist = await getSpecialistById(input.specialistId)

    if (!specialist) {
      throw specialistNotFound(input.specialistId)
    }

    const subject = resolveQuotaSubject(event)

    const stream = await createChatEventStreamForSpecialist(specialist, input, {
      quota: {
        database,
        subject
      }
    })

    database.close()

    setResponseHeaders(event, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    })

    return sendIterable(event, stream, { serializer: serializeChatEvent })
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
