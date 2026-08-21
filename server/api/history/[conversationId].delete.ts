import { createError, defineEventHandler, getRouterParam } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'
import { deleteConversation, getConversationSummary } from '../../utils/history/repository'
import { ChatConversationBusyError, deleteChatSession } from '../../utils/chat/session-store'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const conversationId = readConversationId(getRouterParam(event, 'conversationId'))

  const conversation = getConversationSummary(database, {
    userId: session.userId,
    conversationId
  })
  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  try {
    await deleteChatSession({
      identityType: 'registered',
      specialistId: conversation.specialistId,
      internalConversationId: conversation.id
    })
  } catch (error) {
    if (error instanceof ChatConversationBusyError) {
      throw createError({ statusCode: 409, statusMessage: 'Conversation is busy' })
    }
    throw error
  }

  deleteConversation(database, { userId: session.userId, conversationId })
  return { deleted: true }
})

function readConversationId(value: string | undefined): string {
  if (!value?.trim()) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  return value.trim()
}
