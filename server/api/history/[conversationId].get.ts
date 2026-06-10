import { createError, defineEventHandler, getRouterParam } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'
import { getConversation } from '../../utils/history/repository'
import { canUseSpecialist, resolveSpecialistAccessSubjectFromUser } from '../../utils/specialists/access'
import { getSpecialistById } from '../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const session = readSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const conversationId = readConversationId(getRouterParam(event, 'conversationId'))
  const database = await initializeDatabase()

  try {
    const conversation = getConversation(database, {
      userId: session.userId,
      conversationId
    })

    if (!conversation) {
      throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    }

    const specialist = await getSpecialistById(conversation.specialistId)
    if (!specialist || !canUseSpecialist(specialist, resolveSpecialistAccessSubjectFromUser(database, session.userId))) {
      throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    }

    return { conversation }
  } finally {
    database.close()
  }
})

function readConversationId(value: string | undefined): string {
  if (!value?.trim()) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  return value.trim()
}
