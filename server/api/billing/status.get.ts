import { defineEventHandler } from 'h3'
import { readSessionFromEvent } from '../../utils/auth/session'
import { getBillingStatus } from '../../utils/billing/subscriptions'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()

  const session = readSessionFromEvent(event, database)
  return getBillingStatus(database, { userId: session?.userId })
})
