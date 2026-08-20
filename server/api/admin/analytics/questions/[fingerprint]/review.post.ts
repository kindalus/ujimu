import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { markQuestionCandidateReviewed } from '../../../../../utils/analytics/questions'
import { requireAdmin } from '../../../../../utils/admin/guards'
import { initializeDatabase } from '../../../../../utils/db'

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const admin = requireAdmin(database, event)
  const fingerprint = readFingerprint(getRouterParam(event, 'fingerprint'))
  const body = await readBody(event, { strict: true }).catch(() => undefined)
  const specialistId = readSpecialistId(body)
  const reviewed = markQuestionCandidateReviewed(database, {
    specialistId,
    fingerprint,
    adminUserId: admin.user.id,
    adminContact: admin.adminContact
  })

  return { reviewed: true, candidate: reviewed }
})

function readFingerprint(value: string | undefined): string {
  const fingerprint = value?.trim() ?? ''
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid question fingerprint', data: { code: 'INVALID_FINGERPRINT' } })
  }

  return fingerprint
}

function readSpecialistId(body: unknown): string {
  if (!body || typeof body !== 'object' || !('specialistId' in body)) {
    throw createError({ statusCode: 400, statusMessage: 'specialistId is required', data: { code: 'INVALID_SPECIALIST_ID' } })
  }

  const specialistId = String((body as { specialistId: unknown }).specialistId).trim()
  if (!specialistId) {
    throw createError({ statusCode: 400, statusMessage: 'specialistId is required', data: { code: 'INVALID_SPECIALIST_ID' } })
  }

  return specialistId
}
