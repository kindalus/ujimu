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
  subscribedWeeklyLimit?: number
}

export interface EvaluateQuotaWithFallbackInput {
  primary: EvaluateQuotaInput
  fallback?: EvaluateQuotaInput
}

export type QuotaFallbackDecision =
  | { allowed: true; consumedSubject: Pick<QuotaSubject, 'type' | 'id'> }
  | { allowed: false; error: QuotaExceededPayload }

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; error: QuotaExceededPayload }

export interface QuotaUsage {
  exempt: false
  subjectType: QuotaSubject['type']
  daily: { limit: number; used: number; resetAt: string } | null
  weekly: { limit: number; used: number; resetAt: string }
}

const QUOTA_EXCEEDED_MESSAGE = 'Atingiu o limite de perguntas gratuitas. Crie uma conta para continuar.'

export function evaluateAndRecordQuota(
  database: DatabaseSync,
  input: EvaluateQuotaInput
): QuotaDecision {
  const occurredAt = input.occurredAt ?? new Date()
  const timezone = normalizeTimezone(input.userTimezone)
  const windows = resolveQuotaWindows(occurredAt, timezone)
  const policy = resolveQuotaPolicy(
    { subjectType: input.subject.type },
    {
      subscribedWeeklyLimit: input.subscribedWeeklyLimit,
      companySeats: input.subject.type === 'company' ? input.subject.seats : undefined
    }
  )

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

export function evaluateAndRecordQuotaWithFallback(
  database: DatabaseSync,
  input: EvaluateQuotaWithFallbackInput
): QuotaFallbackDecision {
  const primary = evaluateAndRecordQuota(database, input.primary)
  if (primary.allowed) {
    return { allowed: true, consumedSubject: toConsumedSubject(input.primary.subject) }
  }

  if (input.fallback) {
    const fallback = evaluateAndRecordQuota(database, input.fallback)
    if (fallback.allowed) {
      return { allowed: true, consumedSubject: toConsumedSubject(input.fallback.subject) }
    }
    return { allowed: false, error: fallback.error }
  }

  return { allowed: false, error: primary.error }
}

export function assertQuotaAllowed(database: DatabaseSync, input: EvaluateQuotaInput): void {
  const decision = evaluateAndRecordQuota(database, input)

  if (!decision.allowed) {
    throw new QuotaExceededError(decision.error)
  }
}

export function assertQuotaAllowedWithFallback(database: DatabaseSync, input: EvaluateQuotaWithFallbackInput): void {
  const decision = evaluateAndRecordQuotaWithFallback(database, input)

  if (!decision.allowed) {
    throw new QuotaExceededError(decision.error)
  }
}

export function getQuotaUsage(
  database: DatabaseSync,
  input: {
    subject: QuotaSubject
    occurredAt?: Date
    userTimezone?: string
    subscribedWeeklyLimit?: number
  }
): QuotaUsage {
  const occurredAt = input.occurredAt ?? new Date()
  const timezone = normalizeTimezone(input.userTimezone)
  const windows = resolveQuotaWindows(occurredAt, timezone)
  const policy = resolveQuotaPolicy(
    { subjectType: input.subject.type },
    {
      subscribedWeeklyLimit: input.subscribedWeeklyLimit,
      companySeats: input.subject.type === 'company' ? input.subject.seats : undefined
    }
  )

  return {
    exempt: false,
    subjectType: input.subject.type,
    daily: policy.dailyLimit === null ? null : {
      limit: policy.dailyLimit,
      used: countEvents(database, input.subject, windows.daily.startAtUtc, windows.daily.resetAtUtc),
      resetAt: windows.daily.resetAtUtc.toISOString()
    },
    weekly: {
      limit: policy.weeklyLimit,
      used: countEvents(database, input.subject, windows.weekly.startAtUtc, windows.weekly.resetAtUtc),
      resetAt: windows.weekly.resetAtUtc.toISOString()
    }
  }
}

export function attributeAnonymousQuotaUsage(
  database: DatabaseSync,
  input: { anonymousId: string; userId: string; attributedAt?: Date }
): number {
  const result = database.prepare(`
    INSERT OR IGNORE INTO request_event_user_attributions (
      request_event_id,
      user_id,
      attributed_at
    )
    SELECT id, ?, ?
    FROM request_events
    WHERE subject_type = 'anonymous' AND subject_id = ?
  `).run(input.userId, (input.attributedAt ?? new Date()).toISOString(), input.anonymousId)
  return Number(result.changes)
}

export function getCompanyQuotaUsage(
  database: DatabaseSync,
  input: { companyId: string; occurredAt?: Date; userTimezone?: string; subscribedWeeklyLimit?: number }
): {
  subject: { type: 'company'; id: string }
  weekly: { limit: number; used: number; resetAt: string }
} {
  const subscription = database
    .prepare('SELECT seats FROM corporate_subscriptions WHERE company_id = ?')
    .get(input.companyId) as { seats: number } | undefined
  const subject: QuotaSubject = { type: 'company', id: input.companyId, seats: subscription?.seats ?? 0 }
  const occurredAt = input.occurredAt ?? new Date()
  const timezone = normalizeTimezone(input.userTimezone)
  const windows = resolveQuotaWindows(occurredAt, timezone)
  const policy = resolveQuotaPolicy(
    { subjectType: 'company' },
    { subscribedWeeklyLimit: input.subscribedWeeklyLimit, companySeats: subject.seats }
  )

  return {
    subject: { type: 'company', id: input.companyId },
    weekly: {
      limit: policy.weeklyLimit,
      used: countEvents(database, subject, windows.weekly.startAtUtc, windows.weekly.resetAtUtc),
      resetAt: windows.weekly.resetAtUtc.toISOString()
    }
  }
}

export function getRequestEventCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM request_events').get() as { count: number }
  return row.count
}

function countEvents(
  database: DatabaseSync,
  subject: Pick<QuotaSubject, 'type' | 'id'>,
  startAtUtc: Date,
  resetAtUtc: Date
): number {
  const includesAttributedAnonymous = subject.type === 'registered' || subject.type === 'subscribed'
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM request_events
      WHERE counted = 1
        AND occurred_at_utc >= ?
        AND occurred_at_utc < ?
        AND (
          (subject_type = ? AND subject_id = ?)
          OR (
            ? = 1
            AND subject_type = 'anonymous'
            AND EXISTS (
              SELECT 1
              FROM request_event_user_attributions
              WHERE request_event_id = request_events.id AND user_id = ?
            )
          )
        )
    `)
    .get(
      startAtUtc.toISOString(),
      resetAtUtc.toISOString(),
      subject.type,
      subject.id,
      includesAttributedAnonymous ? 1 : 0,
      subject.id
    ) as { count: number }

  return row.count
}

function toConsumedSubject(subject: QuotaSubject): Pick<QuotaSubject, 'type' | 'id'> {
  return { type: subject.type, id: subject.id }
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
