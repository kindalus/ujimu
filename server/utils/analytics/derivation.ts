import type { DatabaseSync } from 'node:sqlite'
import { enqueueSpecialistDerivationJob, type BackgroundJobRecord } from '../jobs/background'

export type DerivationDecision = 'ignored' | 'derived'

export interface DerivationAction {
  eventId: string
  specialistId: string
  decision: DerivationDecision
  targetPath: string | null
  jobId: string | null
  decidedAt: string
}

export class DerivationActionError extends Error {
  constructor(
    public readonly code: 'QUESTION_EVENT_NOT_FOUND' | 'QUESTION_EVENT_INELIGIBLE' | 'DERIVATION_DECISION_CONFLICT' | 'DERIVATION_NOT_RETRYABLE',
    message: string
  ) {
    super(message)
    this.name = 'DerivationActionError'
  }
}

export function decideQuestionDerivation(
  database: DatabaseSync,
  input: {
    eventId: string
    decision: DerivationDecision
    adminUserId: string
    adminContact: string
    now?: Date
  }
): DerivationAction {
  database.exec('BEGIN IMMEDIATE')
  try {
    const existing = readDerivationAction(database, input.eventId)
    if (existing) {
      if (existing.decision !== input.decision) {
        throw new DerivationActionError(
          'DERIVATION_DECISION_CONFLICT',
          'This question event already has a different final decision.'
        )
      }
      database.exec('COMMIT')
      return existing
    }

    const event = database.prepare(`
      SELECT id, specialist_id, outcome, normalized_question, consulted_document_count
      FROM question_analytics_events
      WHERE id = ?
    `).get(input.eventId) as {
      id: string
      specialist_id: string
      outcome: string
      normalized_question: string
      consulted_document_count: number
    } | undefined
    if (!event) {
      throw new DerivationActionError('QUESTION_EVENT_NOT_FOUND', 'Question event was not found.')
    }
    if (event.outcome !== 'answered' || event.consulted_document_count <= 3) {
      throw new DerivationActionError(
        'QUESTION_EVENT_INELIGIBLE',
        'Only answered events with more than three consulted documents can be curated.'
      )
    }

    const decidedAt = (input.now ?? new Date()).toISOString()
    let job: BackgroundJobRecord | undefined
    let targetPath: string | null = null
    if (input.decision === 'derived') {
      targetPath = buildDerivationTargetPath(event.normalized_question, event.id)
      job = enqueueSpecialistDerivationJob(database, {
        specialistId: event.specialist_id,
        eventId: event.id,
        targetPath,
        requestedByUserId: input.adminUserId,
        requestedByContact: input.adminContact,
        ...(input.now ? { now: input.now } : {})
      })
    }

    database.prepare(`
      INSERT INTO question_derivation_actions (
        event_id, specialist_id, decision, target_path, job_id,
        decided_by_user_id, decided_by_contact, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.specialist_id,
      input.decision,
      targetPath,
      job?.id ?? null,
      input.adminUserId,
      input.adminContact,
      decidedAt
    )
    database.exec('COMMIT')
    return {
      eventId: event.id,
      specialistId: event.specialist_id,
      decision: input.decision,
      targetPath,
      jobId: job?.id ?? null,
      decidedAt
    }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function retryQuestionDerivation(
  database: DatabaseSync,
  input: { eventId: string; now?: Date }
): BackgroundJobRecord {
  const job = database.prepare(`
    SELECT background_jobs.*
    FROM question_derivation_actions
    JOIN background_jobs ON background_jobs.id = question_derivation_actions.job_id
    WHERE question_derivation_actions.event_id = ?
      AND question_derivation_actions.decision = 'derived'
  `).get(input.eventId) as BackgroundJobRecord | undefined
  if (!job || job.status !== 'failed') {
    throw new DerivationActionError('DERIVATION_NOT_RETRYABLE', 'Derivation job is not failed or does not exist.')
  }

  const now = (input.now ?? new Date()).toISOString()
  database.prepare(`
    UPDATE background_jobs
    SET status = 'queued', locked_at = NULL, locked_by = NULL,
      last_error_code = NULL, last_error_message = NULL,
      updated_at = ?, completed_at = NULL
    WHERE id = ? AND status = 'failed'
  `).run(now, job.id)
  return database.prepare('SELECT * FROM background_jobs WHERE id = ?').get(job.id) as unknown as BackgroundJobRecord
}

export function buildDerivationTargetPath(normalizedQuestion: string, eventId: string): string {
  const slug = normalizedQuestion
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    .replace(/-+$/gu, '') || 'query'
  const eventSuffix = eventId.replace(/[^a-z0-9]/giu, '').slice(0, 8).toLowerCase() || 'event'
  return `wiki/derived/${slug}-${eventSuffix}.md`
}

export function buildDerivationPrompt(input: {
  eventId: string
  targetPath: string
  question: string
}): string {
  return `Use the llm-wiki Query workflow to derive one reusable synthesis for an administrator-approved question.

Event ID: ${input.eventId}
Question:
${input.question}

Read AGENTS.md, wiki/index.md, relevant wiki pages, and converted sources only when needed to integrate source detail into the wiki. Do not read raw/.
If evidence is insufficient, stop without writing.
Otherwise create exactly ${input.targetPath}, add valid OKF frontmatter including source_pages, and update only wiki/index.md and wiki/log.md.
Do not include conversation history or any prior answer. Do not write any other path.`
}

function readDerivationAction(database: DatabaseSync, eventId: string): DerivationAction | undefined {
  const row = database.prepare(`
    SELECT event_id, specialist_id, decision, target_path, job_id, decided_at
    FROM question_derivation_actions
    WHERE event_id = ?
  `).get(eventId) as {
    event_id: string
    specialist_id: string
    decision: DerivationDecision
    target_path: string | null
    job_id: string | null
    decided_at: string
  } | undefined
  return row ? {
    eventId: row.event_id,
    specialistId: row.specialist_id,
    decision: row.decision,
    targetPath: row.target_path,
    jobId: row.job_id,
    decidedAt: row.decided_at
  } : undefined
}
