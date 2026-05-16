import { defineEventHandler } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import { initializeDatabase } from '../../utils/db'
import { recordVisit, resolveVisitorIdentity } from '../../utils/analytics/visitors'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const visitor = resolveVisitorIdentity(event)
    const session = readSessionFromEvent(event)
    recordVisit(database, {
      visitorId: visitor.visitorId,
      ...(session ? { userId: session.userId } : {})
    })

    return { visited: true }
  } finally {
    database.close()
  }
})
