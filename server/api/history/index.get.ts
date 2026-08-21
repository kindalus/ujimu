import { createError, defineEventHandler, getQuery } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'
import { listConversations } from '../../utils/history/repository'
import { canUseSpecialist, resolveSpecialistAccessSubjectFromUser } from '../../utils/specialists/access'
import { getSpecialistById } from '../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const specialistId = readSpecialistId(getQuery(event).specialistId)

  const specialist = await getSpecialistById(specialistId)
  if (!specialist || !canUseSpecialist(specialist, resolveSpecialistAccessSubjectFromUser(database, session.userId, { env: process.env }))) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }

  return {
    conversations: listConversations(database, {
      userId: session.userId,
      specialistId
    })
  }
})

function readSpecialistId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'specialistId is required' })
  }

  return value.trim()
}
