import { deleteQuestionAnalyticsForSpecialist } from '../analytics/questions'
import { initializeDatabase } from '../db'
import { deleteConversationsForSpecialist } from './repository'

export async function deleteConversationHistoryForSpecialist(specialistId: string): Promise<void> {
  const database = await initializeDatabase()
  try {
    deleteConversationsForSpecialist(database, specialistId)
    deleteQuestionAnalyticsForSpecialist(database, specialistId)
  } finally {
    database.close()
  }
}
