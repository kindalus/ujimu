import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readBody,
  sendIterable,
  setResponseHeaders
} from 'h3'
import { createChatEventStreamFromBody } from '../utils/chat/engine'
import { serializeChatEvent } from '../utils/chat/ndjson'
import { ChatRequestError } from '../utils/chat/request'

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

  try {
    const stream = await createChatEventStreamFromBody(body)

    setResponseHeaders(event, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    })

    return sendIterable(event, stream, { serializer: serializeChatEvent })
  } catch (error) {
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
