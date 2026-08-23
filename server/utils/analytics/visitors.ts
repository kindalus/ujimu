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
// The cookie is client-supplied and lands in visitor_events, so only accept ids we could have minted.
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveVisitorIdentity(event: H3Event): ResolvedVisitorIdentity {
  const existing = getCookie(event, VISITOR_COOKIE_NAME)?.trim()
  if (existing && VISITOR_ID_PATTERN.test(existing)) {
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

/**
 * One row per visitor per day. The endpoint is unauthenticated, so without this a client could
 * grow the table (and the SQLite file that also holds sessions) without bound. Monthly reporting
 * counts distinct visitors, so collapsing repeat visits does not change what admins see.
 */
export function recordVisit(database: DatabaseSync, input: RecordVisitInput): void {
  const occurredAt = input.occurredAt ?? new Date()
  const timestamp = occurredAt.toISOString()
  database
    .prepare(`
      INSERT INTO visitor_events (id, visitor_id, user_id, occurred_at, month, day)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `)
    .run(
      randomUUID(),
      input.visitorId,
      input.userId?.trim() || null,
      timestamp,
      monthFromDate(occurredAt),
      timestamp.slice(0, 10)
    )
}

export function countDistinctMonthlyVisitors(database: DatabaseSync, month: string): MonthlyVisitorCount {
  const normalizedMonth = normalizeMonth(month)
  const row = database
    .prepare(`
      WITH visitor_links AS (
        SELECT visitor_id, (
          SELECT linked.user_id
          FROM visitor_events AS linked
          WHERE linked.visitor_id = visitors.visitor_id
            AND linked.user_id IS NOT NULL
            AND linked.user_id != ''
          ORDER BY linked.occurred_at DESC, linked.id DESC
          LIMIT 1
        ) AS linked_user_id
        FROM visitor_events AS visitors
        GROUP BY visitor_id
      )
      SELECT COUNT(DISTINCT CASE
        WHEN links.linked_user_id IS NOT NULL THEN 'user:' || links.linked_user_id
        ELSE 'visitor:' || events.visitor_id
      END) AS count
      FROM visitor_events AS events
      JOIN visitor_links AS links ON links.visitor_id = events.visitor_id
      WHERE events.month = ?
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
