import { defineEventHandler } from 'h3'
import { getPublicSessionUser } from '../../utils/auth/otp'
import { readSessionFromEvent } from '../../utils/auth/session'
import { getActiveCompanyForUser, listUserCompanies } from '../../utils/companies/repository'
import { initializeDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) {
    return { authenticated: false, verifiedEmails: [], companies: [], activeCompany: null }
  }

  const user = getPublicSessionUser(database, session.userId)
  if (!user) {
    return { authenticated: false, verifiedEmails: [], companies: [], activeCompany: null }
  }

  return {
    authenticated: true,
    user,
    verifiedEmails: getVerifiedEmails(database, session.userId),
    companies: listUserCompanies(database, session.userId),
    activeCompany: getActiveCompanyForUser(database, session.userId)
  }
})

function getVerifiedEmails(database: Awaited<ReturnType<typeof initializeDatabase>>, userId: string): string[] {
  return database
    .prepare("SELECT contact FROM user_identities WHERE user_id = ? AND channel = 'email' ORDER BY verified_at ASC")
    .all(userId)
    .map((row) => (row as { contact: string }).contact.trim().toLowerCase())
}
