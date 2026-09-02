import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeTimezone } from '../quota/time'

export type QuestionAnalyticsOutcome = 'answered' | 'insufficient_context'

export interface RecordQuestionAnalyticsInput {
  specialistId: string
  outcome: QuestionAnalyticsOutcome
  question: string
  userTimezone?: string
  visitorId?: string
  userId?: string
  conversationId?: string
  userMessageId?: string
  consultedDocumentCount?: number
  occurredAt?: Date
}

export interface QuestionAnalyticsEvent {
  id: string
  specialistId: string
  outcome: QuestionAnalyticsOutcome
  questionText: string
  normalizedQuestion: string
  fingerprint: string
  occurredAt: string
  userTimezone: string
  visitorId: string | null
  userId: string | null
  conversationId: string | null
  userMessageId: string | null
  consultedDocumentCount: number
}

export interface QuestionAnalyticsCandidate {
  specialistId: string
  fingerprint: string
  normalizedQuestion: string
  latestQuestion: string
  countLast30Days: number
  countSinceReview: number
  totalCount: number
  insufficientContextCount: number
  firstOccurredAt: string
  lastOccurredAt: string
  reviewedAt: string | null
}

export interface RecentQuestionAnalyticsEvent {
  id: string
  specialistId: string
  outcome: QuestionAnalyticsOutcome
  questionText: string
  normalizedQuestion: string
  fingerprint: string
  occurredAt: string
  userTimezone: string
  consultedDocumentCount: number
}

export interface ListQuestionAnalyticsInput {
  specialistId: string
  now?: Date
  threshold?: number
  recentLimit?: number
}

export interface MultiSourceQuestionEvent {
  id: string
  specialistId: string
  questionText: string
  occurredAt: string
  consultedDocumentCount: number
  decision: 'ignored' | 'derived' | null
  job: {
    id: string
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    errorCode: string | null
    errorMessage: string | null
  } | null
}

export interface QuestionAnalyticsList {
  candidates: QuestionAnalyticsCandidate[]
  recentQuestions: RecentQuestionAnalyticsEvent[]
  multiSourceQuestions: MultiSourceQuestionEvent[]
}

export interface MarkQuestionCandidateReviewedInput {
  specialistId: string
  fingerprint: string
  adminUserId: string
  adminContact: string
  now?: Date
}

export interface ReviewedQuestionCandidate {
  specialistId: string
  fingerprint: string
  reviewedAt: string
}

const MAX_QUESTION_TEXT_LENGTH = 2000
const CONTENT_GAP_THRESHOLD = 2
const RECENT_QUESTION_LIMIT = 20
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export function recordQuestionAnalyticsEvent(
  database: DatabaseSync,
  input: RecordQuestionAnalyticsInput
): QuestionAnalyticsEvent | undefined {
  const questionText = normalizeRawQuestionText(input.question)
  if (!questionText) return undefined

  const normalizedQuestion = normalizeQuestionForAnalytics(questionText)
  if (!normalizedQuestion) return undefined

  const event: QuestionAnalyticsEvent = {
    id: randomUUID(),
    specialistId: input.specialistId,
    outcome: input.outcome,
    questionText,
    normalizedQuestion,
    fingerprint: fingerprintQuestion(normalizedQuestion),
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    userTimezone: normalizeTimezone(input.userTimezone),
    visitorId: input.visitorId?.trim() || null,
    userId: input.userId?.trim() || null,
    conversationId: input.conversationId?.trim() || null,
    userMessageId: input.userMessageId?.trim() || null,
    consultedDocumentCount: normalizeConsultedDocumentCount(input.consultedDocumentCount)
  }

  database
    .prepare(`
      INSERT INTO question_analytics_events (
        id,
        specialist_id,
        outcome,
        question_text,
        normalized_question,
        fingerprint,
        occurred_at,
        user_timezone,
        visitor_id,
        user_id,
        conversation_id,
        user_message_id,
        consulted_document_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      event.id,
      event.specialistId,
      event.outcome,
      event.questionText,
      event.normalizedQuestion,
      event.fingerprint,
      event.occurredAt,
      event.userTimezone,
      event.visitorId,
      event.userId,
      event.conversationId,
      event.userMessageId,
      event.consultedDocumentCount
    )

  return event
}

export function listQuestionAnalytics(
  database: DatabaseSync,
  input: ListQuestionAnalyticsInput
): QuestionAnalyticsList {
  const threshold = input.threshold ?? CONTENT_GAP_THRESHOLD
  const now = input.now ?? new Date()
  const cutoffIso = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
  const events = database
    .prepare(`
      SELECT id, specialist_id, outcome, question_text, normalized_question, fingerprint,
        occurred_at, user_timezone, consulted_document_count
      FROM question_analytics_events
      WHERE specialist_id = ?
      ORDER BY occurred_at DESC, id DESC
    `)
    .all(input.specialistId)
    .map(mapQuestionAnalyticsRow)

  const reviews = readReviews(database, input.specialistId)
  const grouped = new Map<string, RecentQuestionAnalyticsEvent[]>()
  for (const event of events) {
    const group = grouped.get(event.fingerprint) ?? []
    group.push(event)
    grouped.set(event.fingerprint, group)
  }

  const candidates = [...grouped.entries()]
    .map(([fingerprint, group]) => buildCandidate(input.specialistId, fingerprint, group, reviews.get(fingerprint) ?? null, cutoffIso))
    .filter((candidate): candidate is QuestionAnalyticsCandidate => Boolean(candidate))
    .filter((candidate) => candidate.countLast30Days >= threshold && candidate.countSinceReview >= threshold)
    .sort((left, right) => {
      const insufficientDelta = right.insufficientContextCount - left.insufficientContextCount
      if (insufficientDelta !== 0) return insufficientDelta
      const countDelta = right.countLast30Days - left.countLast30Days
      if (countDelta !== 0) return countDelta
      return right.lastOccurredAt.localeCompare(left.lastOccurredAt)
    })

  return {
    candidates,
    recentQuestions: events.slice(0, input.recentLimit ?? RECENT_QUESTION_LIMIT),
    multiSourceQuestions: listMultiSourceQuestions(database, input.specialistId)
  }
}

export function listMultiSourceQuestions(
  database: DatabaseSync,
  specialistId: string,
  limit = 50
): MultiSourceQuestionEvent[] {
  const rows = database.prepare(`
    SELECT events.id, events.specialist_id, events.question_text, events.occurred_at,
      events.consulted_document_count, actions.decision, actions.job_id,
      jobs.status AS job_status, jobs.last_error_code, jobs.last_error_message
    FROM question_analytics_events AS events
    LEFT JOIN question_derivation_actions AS actions ON actions.event_id = events.id
    LEFT JOIN background_jobs AS jobs ON jobs.id = actions.job_id
    WHERE events.specialist_id = ?
      AND events.outcome = 'answered'
      AND events.consulted_document_count > 3
    ORDER BY events.occurred_at DESC, events.id DESC
    LIMIT ?
  `).all(specialistId, limit) as unknown as Array<{
    id: string
    specialist_id: string
    question_text: string
    occurred_at: string
    consulted_document_count: number
    decision: 'ignored' | 'derived' | null
    job_id: string | null
    job_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null
    last_error_code: string | null
    last_error_message: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    specialistId: row.specialist_id,
    questionText: row.question_text,
    occurredAt: row.occurred_at,
    consultedDocumentCount: row.consulted_document_count,
    decision: row.decision,
    job: row.job_id && row.job_status ? {
      id: row.job_id,
      status: row.job_status,
      errorCode: row.last_error_code,
      errorMessage: row.last_error_message
    } : null
  }))
}

export function markQuestionCandidateReviewed(
  database: DatabaseSync,
  input: MarkQuestionCandidateReviewedInput
): ReviewedQuestionCandidate {
  const reviewedAt = (input.now ?? new Date()).toISOString()
  database
    .prepare(`
      INSERT INTO question_analytics_reviews (
        specialist_id,
        fingerprint,
        reviewed_at,
        reviewed_by_user_id,
        reviewed_by_contact
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (specialist_id, fingerprint) DO UPDATE SET
        reviewed_at = excluded.reviewed_at,
        reviewed_by_user_id = excluded.reviewed_by_user_id,
        reviewed_by_contact = excluded.reviewed_by_contact
    `)
    .run(input.specialistId, input.fingerprint, reviewedAt, input.adminUserId, input.adminContact)

  return {
    specialistId: input.specialistId,
    fingerprint: input.fingerprint,
    reviewedAt
  }
}

export function deleteQuestionAnalyticsForSpecialist(database: DatabaseSync, specialistId: string): void {
  database.prepare('DELETE FROM question_analytics_events WHERE specialist_id = ?').run(specialistId)
  database.prepare('DELETE FROM question_analytics_reviews WHERE specialist_id = ?').run(specialistId)
}

export function normalizeQuestionForAnalytics(question: string): string {
  return question
    .replace(/[ºª]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprintQuestion(normalizedQuestion: string): string {
  return createHash('sha256').update(normalizedQuestion).digest('hex')
}

function normalizeConsultedDocumentCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0
  return Math.trunc(value)
}

function normalizeRawQuestionText(question: string): string {
  return question.trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION_TEXT_LENGTH).trim()
}

function readReviews(database: DatabaseSync, specialistId: string): Map<string, string> {
  const rows = database
    .prepare('SELECT fingerprint, reviewed_at FROM question_analytics_reviews WHERE specialist_id = ?')
    .all(specialistId) as Array<{ fingerprint: string; reviewed_at: string }>

  return new Map(rows.map((row) => [row.fingerprint, row.reviewed_at]))
}

function buildCandidate(
  specialistId: string,
  fingerprint: string,
  eventsDesc: RecentQuestionAnalyticsEvent[],
  reviewedAt: string | null,
  cutoffIso: string
): QuestionAnalyticsCandidate | undefined {
  const eventsLast30 = eventsDesc.filter((event) => event.occurredAt >= cutoffIso)
  if (eventsLast30.length === 0) return undefined

  const eventsSinceReview = reviewedAt
    ? eventsLast30.filter((event) => event.occurredAt > reviewedAt)
    : eventsLast30
  const oldestEvent = eventsDesc.at(-1)
  const latestEvent = eventsDesc[0]
  if (!oldestEvent || !latestEvent) return undefined

  return {
    specialistId,
    fingerprint,
    normalizedQuestion: latestEvent.normalizedQuestion,
    latestQuestion: latestEvent.questionText,
    countLast30Days: eventsLast30.length,
    countSinceReview: eventsSinceReview.length,
    totalCount: eventsDesc.length,
    insufficientContextCount: eventsLast30.filter((event) => event.outcome === 'insufficient_context').length,
    firstOccurredAt: oldestEvent.occurredAt,
    lastOccurredAt: latestEvent.occurredAt,
    reviewedAt
  }
}

function mapQuestionAnalyticsRow(row: unknown): RecentQuestionAnalyticsEvent {
  const event = row as {
    id: string
    specialist_id: string
    outcome: QuestionAnalyticsOutcome
    question_text: string
    normalized_question: string
    fingerprint: string
    occurred_at: string
    user_timezone: string
    consulted_document_count: number
  }

  return {
    id: event.id,
    specialistId: event.specialist_id,
    outcome: event.outcome,
    questionText: event.question_text,
    normalizedQuestion: event.normalized_question,
    fingerprint: event.fingerprint,
    occurredAt: event.occurred_at,
    userTimezone: event.user_timezone,
    consultedDocumentCount: event.consulted_document_count
  }
}
