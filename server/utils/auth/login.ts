import type { DatabaseSync } from 'node:sqlite'
import type { H3Event } from 'h3'
import { isAdminUser } from '../admin/guards'
import { readExistingAnonymousQuotaSubject } from '../quota/identity'
import { attributeAnonymousQuotaUsage } from '../quota/usage'
import { setSessionCookie } from './session'

export function completeLogin(
  event: H3Event,
  database: DatabaseSync,
  input: { userId: string; sessionToken: string }
): void {
  const anonymous = readExistingAnonymousQuotaSubject(event)
  if (anonymous && !isAdminUser(database, input.userId)) {
    attributeAnonymousQuotaUsage(database, {
      anonymousId: anonymous.id,
      userId: input.userId
    })
  }
  setSessionCookie(event, input.sessionToken)
}
