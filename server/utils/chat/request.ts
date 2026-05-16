export interface ValidatedChatRequest {
  specialistId: string
  question: string
  clientTimezone?: string
  conversationId?: string
  replaceFromMessageId?: string
}

export type ChatRequestErrorCode = 'INVALID_CHAT_REQUEST' | 'SPECIALIST_NOT_FOUND' | 'HISTORY_NOT_FOUND'

export class ChatRequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 404,
    public readonly code: ChatRequestErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ChatRequestError'
  }
}

export function validateChatRequestBody(body: unknown): ValidatedChatRequest {
  if (!isRecord(body)) {
    throw invalidRequest('Request body must be an object.')
  }

  const specialistId = readRequiredString(body.specialistId, 'specialistId')
  const question = readRequiredString(body.question, 'question')

  if (question.length > 4000) {
    throw invalidRequest('Question must be at most 4000 characters long.')
  }

  const clientTimezone = readOptionalString(body.clientTimezone, 'clientTimezone')
  const conversationId = readOptionalString(body.conversationId, 'conversationId', 200)
  const replaceFromMessageId = readOptionalString(body.replaceFromMessageId, 'replaceFromMessageId', 200)

  if (replaceFromMessageId && !conversationId) {
    throw invalidRequest('replaceFromMessageId requires conversationId.')
  }

  return {
    specialistId,
    question,
    ...(clientTimezone ? { clientTimezone } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(replaceFromMessageId ? { replaceFromMessageId } : {})
  }
}

export function specialistNotFound(specialistId: string): ChatRequestError {
  return new ChatRequestError(404, 'SPECIALIST_NOT_FOUND', `Specialist "${specialistId}" was not found.`)
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw invalidRequest(`${fieldName} must be a string.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw invalidRequest(`${fieldName} is required.`)
  }

  return trimmed
}

function readOptionalString(value: unknown, fieldName: string, maxLength = 100): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw invalidRequest(`${fieldName} must be a string.`)
  }

  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw invalidRequest(`${fieldName} must be at most ${maxLength} characters long.`)
  }

  return trimmed || undefined
}

function invalidRequest(message: string): ChatRequestError {
  return new ChatRequestError(400, 'INVALID_CHAT_REQUEST', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
