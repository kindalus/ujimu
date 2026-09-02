import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  buildDerivationPrompt,
  decideQuestionDerivation,
  retryQuestionDerivation
} from '../server/utils/analytics/derivation'
import { recordQuestionAnalyticsEvent } from '../server/utils/analytics/questions'
import { initializeDatabase } from '../server/utils/db'
import { runDueBackgroundJobs } from '../server/utils/jobs/background'

describe('derivation job contract acceptance', () => {
  it('creates one final decision, deterministic target, and injectable job', async () => {
    const database = await createDatabase()
    seedAdmin(database)
    const event = recordEvent(database, 'answered', 4)
    const now = new Date('2026-09-01T12:00:00.000Z')

    const first = decideQuestionDerivation(database, {
      eventId: event.id,
      decision: 'derived',
      adminUserId: 'admin',
      adminContact: 'admin@example.com',
      now
    })
    const repeated = decideQuestionDerivation(database, {
      eventId: event.id,
      decision: 'derived',
      adminUserId: 'admin',
      adminContact: 'admin@example.com',
      now
    })

    expect(repeated).toEqual(first)
    expect(first.targetPath).toMatch(/^wiki\/derived\/qual-e-o-prazo-para-entregar-declaracao-mensal-de-iva-[a-z0-9]{8}\.md$/)
    expect(database.prepare('SELECT COUNT(*) AS count FROM question_derivation_actions').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE type = 'specialist_derivation'").get()).toEqual({ count: 1 })
    expect(() => decideQuestionDerivation(database, {
      eventId: event.id,
      decision: 'ignored',
      adminUserId: 'admin',
      adminContact: 'admin@example.com'
    })).toThrow(expect.objectContaining({ code: 'DERIVATION_DECISION_CONFLICT' }))

    const seen: unknown[] = []
    const result = await runDueBackgroundJobs({
      database,
      now,
      derivationRunner: { async run(job) { seen.push(job) } }
    })
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    expect(seen).toEqual([{
      id: first.jobId,
      specialistId: 'iva',
      eventId: event.id,
      targetPath: first.targetPath
    }])
    database.close()
  })

  it('rejects ineligible events and keeps ignored events job-free', async () => {
    const database = await createDatabase()
    seedAdmin(database)
    const insufficient = recordEvent(database, 'insufficient_context', 8)
    const tooFew = recordEvent(database, 'answered', 3)
    const eligible = recordEvent(database, 'answered', 5)

    for (const eventId of [insufficient.id, tooFew.id]) {
      expect(() => decideQuestionDerivation(database, {
        eventId,
        decision: 'derived',
        adminUserId: 'admin',
        adminContact: 'admin@example.com'
      })).toThrow(expect.objectContaining({ code: 'QUESTION_EVENT_INELIGIBLE' }))
    }

    const ignored = decideQuestionDerivation(database, {
      eventId: eligible.id,
      decision: 'ignored',
      adminUserId: 'admin',
      adminContact: 'admin@example.com'
    })
    expect(ignored).toMatchObject({ decision: 'ignored', jobId: null, targetPath: null })
    expect(database.prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE type = 'specialist_derivation'").get()).toEqual({ count: 0 })
    database.close()
  })

  it('sanitizes failures and retries the same job, event, and target', async () => {
    const database = await createDatabase()
    seedAdmin(database)
    const event = recordEvent(database, 'answered', 4)
    const action = decideQuestionDerivation(database, {
      eventId: event.id,
      decision: 'derived',
      adminUserId: 'admin',
      adminContact: 'admin@example.com'
    })

    await runDueBackgroundJobs({
      database,
      derivationRunner: { async run() { throw new Error('private question and provider detail') } }
    })
    expect(database.prepare('SELECT status, last_error_message FROM background_jobs WHERE id = ?').get(action.jobId)).toEqual({
      status: 'failed',
      last_error_message: 'Derivation job failed.'
    })

    const retried = retryQuestionDerivation(database, { eventId: event.id })
    expect(retried).toMatchObject({
      id: action.jobId,
      status: 'queued',
      derivation_event_id: event.id,
      derivation_target_path: action.targetPath
    })
    const succeeded = await runDueBackgroundJobs({
      database,
      derivationRunner: { async run() {} }
    })
    expect(succeeded).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM question_derivation_actions WHERE event_id = ?').get(event.id)).toEqual({ count: 1 })
    database.close()
  })

  it('builds a narrow prompt without prior answers or conversation history', () => {
    const prompt = buildDerivationPrompt({
      eventId: 'event-1',
      targetPath: 'wiki/derived/prazo-event1.md',
      question: 'Qual é o prazo?'
    })
    expect(prompt).toContain('Question:\nQual é o prazo?')
    expect(prompt).toContain('create exactly wiki/derived/prazo-event1.md')
    expect(prompt).toContain('update only wiki/index.md and wiki/log.md')
    expect(prompt).toContain('Do not include conversation history or any prior answer')
    expect(prompt).not.toContain('Resposta anterior')
  })
})

async function createDatabase(): Promise<DatabaseSync> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-derivation-job-'))
  return initializeDatabase({ dbPath: join(dataDir, 'ujimu.sqlite') })
}

function seedAdmin(database: DatabaseSync): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('admin', '2026-09-01T00:00:00.000Z')
}

function recordEvent(
  database: DatabaseSync,
  outcome: 'answered' | 'insufficient_context',
  consultedDocumentCount: number
) {
  return recordQuestionAnalyticsEvent(database, {
    specialistId: 'iva',
    outcome,
    question: 'Qual é o prazo para entregar declaração mensal de IVA?',
    consultedDocumentCount
  })!
}
