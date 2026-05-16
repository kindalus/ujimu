import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getCookie, setCookie, type H3Event } from 'h3'

export const VISITOR_COOKIE_NAME = 'ujimu_visitor_id'
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export interface ResolvedVisitorIdentity {
  visitorId: string
  created: boolean
}

export interface RecordVisitInput {
  visitorId: string
  userId?: string
  occurredAt?: Date
}

export interface MonthlyVisitorCount {
  month: string
  distinctVisitors: number
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/

export function resolveVisitorIdentity(event: H3Event): ResolvedVisitorIdentity {
  const existing = getCookie(event, VISITOR_COOKIE_NAME)?.trim()
  if (existing) {
    return { visitorId: existing, created: false }
  }

  const visitorId = randomUUID()
  setCookie(event, VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
    path: '/'
  })

  return { visitorId, created: true }
}

export function recordVisit(database: DatabaseSync, input: RecordVisitInput): void {
  const occurredAt = input.occurredAt ?? new Date()
  database
    .prepare(`
      INSERT INTO visitor_events (id, visitor_id, user_id, occurred_at, month)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.visitorId,
      input.userId?.trim() || null,
      occurredAt.toISOString(),
      monthFromDate(occurredAt)
    )
}

export function countDistinctMonthlyVisitors(database: DatabaseSync, month: string): MonthlyVisitorCount {
  const normalizedMonth = normalizeMonth(month)
  const row = database
    .prepare(`
      SELECT COUNT(DISTINCT CASE
        WHEN user_id IS NOT NULL AND user_id != '' THEN 'user:' || user_id
        ELSE 'visitor:' || visitor_id
      END) AS count
      FROM visitor_events
      WHERE month = ?
    `)
    .get(normalizedMonth) as { count: number }

  return {
    month: normalizedMonth,
    distinctVisitors: row.count
  }
}

export function currentAnalyticsMonth(now = new Date()): string {
  return monthFromDate(now)
}

export function normalizeMonth(month: string | undefined): string {
  const candidate = month?.trim() || currentAnalyticsMonth()
  if (!MONTH_PATTERN.test(candidate)) {
    throw new AnalyticsVisitorError('Invalid analytics month.', 'INVALID_MONTH')
  }

  const [year, monthPart] = candidate.split('-').map(Number)
  if (!year || !monthPart || monthPart < 1 || monthPart > 12) {
    throw new AnalyticsVisitorError('Invalid analytics month.', 'INVALID_MONTH')
  }

  return candidate
}

export class AnalyticsVisitorError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_MONTH'
  ) {
    super(message)
    this.name = 'AnalyticsVisitorError'
  }
}

function monthFromDate(date: Date): string {
  return date.toISOString().slice(0, 7)
}
