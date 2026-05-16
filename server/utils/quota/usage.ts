import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { QuotaExceededError, type QuotaExceededPayload } from './errors'
import { resolveQuotaPolicy, type QuotaSubject } from './policy'
import { normalizeTimezone, resolveQuotaWindows } from './time'

export interface EvaluateQuotaInput {
  subject: QuotaSubject
  specialistId: string
  userTimezone?: string
  occurredAt?: Date
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; error: QuotaExceededPayload }

const QUOTA_EXCEEDED_MESSAGE = 'Atingiu o limite de perguntas gratuitas. Crie uma conta para continuar.'

export function evaluateAndRecordQuota(
  database: DatabaseSync,
  input: EvaluateQuotaInput
): QuotaDecision {
  const occurredAt = input.occurredAt ?? new Date()
  const timezone = normalizeTimezone(input.userTimezone)
  const windows = resolveQuotaWindows(occurredAt, timezone)
  const policy = resolveQuotaPolicy({ subjectType: input.subject.type })

  const dailyUsed = policy.dailyLimit === null
    ? 0
    : countEvents(database, input.subject, windows.daily.startAtUtc, windows.daily.resetAtUtc)
  const weeklyUsed = countEvents(database, input.subject, windows.weekly.startAtUtc, windows.weekly.resetAtUtc)
  const limits: QuotaExceededPayload['limits'] = {}

  if (policy.dailyLimit !== null && dailyUsed >= policy.dailyLimit) {
    limits.daily = {
      limit: policy.dailyLimit,
      used: dailyUsed,
      resetAt: windows.daily.resetAtUtc.toISOString()
    }
  }

  if (weeklyUsed >= policy.weeklyLimit) {
    limits.weekly = {
      limit: policy.weeklyLimit,
      used: weeklyUsed,
      resetAt: windows.weekly.resetAtUtc.toISOString()
    }
  }

  if (limits.daily || limits.weekly) {
    recordRequestEvent(database, {
      ...input,
      userTimezone: timezone,
      occurredAt,
      counted: false,
      decision: 'denied',
      denialReason: Object.keys(limits).join('_')
    })

    return {
      allowed: false,
      error: {
        code: 'QUOTA_EXCEEDED',
        message: QUOTA_EXCEEDED_MESSAGE,
        limits
      }
    }
  }

  recordRequestEvent(database, {
    ...input,
    userTimezone: timezone,
    occurredAt,
    counted: true,
    decision: 'allowed'
  })

  return { allowed: true }
}

export function assertQuotaAllowed(database: DatabaseSync, input: EvaluateQuotaInput): void {
  const decision = evaluateAndRecordQuota(database, input)

  if (!decision.allowed) {
    throw new QuotaExceededError(decision.error)
  }
}

export function getRequestEventCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM request_events').get() as { count: number }
  return row.count
}

function countEvents(
  database: DatabaseSync,
  subject: QuotaSubject,
  startAtUtc: Date,
  resetAtUtc: Date
): number {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM request_events
      WHERE subject_type = ?
        AND subject_id = ?
        AND counted = 1
        AND occurred_at_utc >= ?
        AND occurred_at_utc < ?
    `)
    .get(subject.type, subject.id, startAtUtc.toISOString(), resetAtUtc.toISOString()) as { count: number }

  return row.count
}

function recordRequestEvent(
  database: DatabaseSync,
  input: EvaluateQuotaInput & {
    userTimezone: string
    occurredAt: Date
    counted: boolean
    decision: 'allowed' | 'denied'
    denialReason?: string
  }
): void {
  database
    .prepare(`
      INSERT INTO request_events (
        id,
        subject_type,
        subject_id,
        specialist_id,
        occurred_at_utc,
        user_timezone,
        counted,
        decision,
        denial_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.subject.type,
      input.subject.id,
      input.specialistId,
      input.occurredAt.toISOString(),
      input.userTimezone,
      input.counted ? 1 : 0,
      input.decision,
      input.denialReason ?? null
    )
}
