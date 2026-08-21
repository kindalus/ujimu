import { deleteQuestionAnalyticsForSpecialist } from '../analytics/questions'
import { initializeDatabase } from '../db'
import { deleteConversationsForSpecialist } from './repository'
import { deleteChatSessionsForSpecialist } from '../chat/session-store'

export async function deleteConversationHistoryForSpecialist(specialistId: string): Promise<void> {
  const database = await initializeDatabase()
  await deleteChatSessionsForSpecialist({ specialistId })
  deleteConversationsForSpecialist(database, specialistId)
  deleteQuestionAnalyticsForSpecialist(database, specialistId)
}
