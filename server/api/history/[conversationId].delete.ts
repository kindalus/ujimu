import { createError, defineEventHandler, getRouterParam } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'
import { deleteConversation } from '../../utils/history/repository'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const conversationId = readConversationId(getRouterParam(event, 'conversationId'))

  const deleted = deleteConversation(database, {
    userId: session.userId,
    conversationId
  })

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  return { deleted: true }
})

function readConversationId(value: string | undefined): string {
  if (!value?.trim()) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  return value.trim()
}
