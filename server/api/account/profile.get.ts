import { defineEventHandler } from 'h3'
import { listProfileContacts } from '../../utils/account/profile'
import { getPublicSessionUser } from '../../utils/auth/otp'
import { readSessionFromEvent } from '../../utils/auth/session'
import { getActiveCompanyForUser, listUserCompanies } from '../../utils/companies/repository'
import { initializeDatabase } from '../../utils/db'
import { resolveLaunchFeatures } from '../../utils/features'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const session = readSessionFromEvent(event, database)
  if (!session) {
    return { authenticated: false, contacts: [], verifiedEmails: [], companies: [], activeCompany: null }
  }

  const user = getPublicSessionUser(database, session.userId)
  if (!user) {
    return { authenticated: false, contacts: [], verifiedEmails: [], companies: [], activeCompany: null }
  }

  const companiesEnabled = resolveLaunchFeatures(process.env).companiesEnabled
  const contacts = listProfileContacts(database, session.userId)
  return {
    authenticated: true,
    user,
    contacts,
    verifiedEmails: contacts.filter((contact) => contact.channel === 'email').map((contact) => contact.contact),
    companies: companiesEnabled ? listUserCompanies(database, session.userId) : [],
    activeCompany: companiesEnabled ? getActiveCompanyForUser(database, session.userId) : null
  }
})
