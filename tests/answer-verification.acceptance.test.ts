import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  enqueueDerivedAnswerVerification,
  markAnswerVerificationRunning,
  quarantineAttributedDerivedPages,
  readAnswerVerification,
  readQuarantinedDerivedPaths,
  type AnswerVerificationBaseline,
  type AnswerVerificationExecutionResult
} from '../server/utils/analytics/answer-verification'
import { recordQuestionAnalyticsEvent } from '../server/utils/analytics/questions'
import { initializeDatabase } from '../server/utils/db'
import {
  enqueueSpecialistDerivationJob,
  runDueBackgroundJobs
} from '../server/utils/jobs/background'
import {
  buildSourceOnlyAnswerPrompt,
  parseAlignmentJudgement,
  parseNegativeAttribution
} from '../server/utils/analytics/answer-verification-runner'
import { lookupRetrievalHints, storeRetrievalHints } from '../server/utils/chat/retrieval-cache'
import { isAnswerVerificationReadPathAllowed } from '../server/utils/pi/file-policy'

const NOT_SAMPLED_EVENT_ID = '00000000-0000-4000-8000-000000000000'
const SAMPLED_EVENT_ID = '00000000-0000-4000-8000-000000000001'
const SECOND_NOT_SAMPLED_EVENT_ID = '00000000-0000-4000-8000-000000000002'

describe('derived answer verification sampling and baseline acceptance', () => {
  it('forces one first-revision check, then applies a stable ten-percent event sample', async () => {
    const fixture = await createFixture()
    const firstEvent = insertEvent(fixture.database, NOT_SAMPLED_EVENT_ID)
    const first = await enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: firstEvent.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta entregue.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })

    expect(first).toMatchObject({ sampleReason: 'first_revision', status: 'queued' })
    expect(first?.derivedPages).toEqual([{
      path: 'wiki/derived/resposta.md',
      revisionSha256: sha256('# Resposta derivada\n')
    }])

    await expect(enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: firstEvent.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta entregue.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })).resolves.toEqual(first)

    const whilePending = insertEvent(fixture.database, SECOND_NOT_SAMPLED_EVENT_ID)
    await expect(enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: whilePending.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Outra resposta.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })).resolves.toBeUndefined()

    fixture.database.prepare(`
      UPDATE derived_page_quality
      SET status = 'verified', verification_id = NULL
      WHERE specialist_id = 'iva' AND wiki_path = 'wiki/derived/resposta.md'
    `).run()

    const sampled = insertEvent(fixture.database, SAMPLED_EVENT_ID)
    await expect(enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: sampled.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta sorteada.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })).resolves.toMatchObject({ sampleReason: 'random', status: 'pending' })

    const notSampled = insertEvent(fixture.database, SECOND_NOT_SAMPLED_EVENT_ID + '-new')
    await expect(enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: notSampled.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta fora da amostra.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })).resolves.toBeUndefined()

    await expect(enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: insertEvent(fixture.database, 'event-without-derived').id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta comum.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/articles/artigo-1.md']
    })).resolves.toBeUndefined()
    fixture.database.close()
  })

  it('keeps a selected verification pending behind another specialist job and runs it next', async () => {
    const fixture = await createFixture()
    const blockingEvent = insertEvent(fixture.database, 'blocking-event')
    enqueueSpecialistDerivationJob(fixture.database, {
      specialistId: 'iva',
      eventId: blockingEvent.id,
      targetPath: 'wiki/derived/blocking.md',
      requestedByUserId: 'admin',
      requestedByContact: 'admin@example.com'
    })
    const event = insertEvent(fixture.database, NOT_SAMPLED_EVENT_ID)
    const verification = await enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: event.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta privada.',
      originalCitations: [],
      conversationContext: [{ role: 'user', content: 'Contexto anterior.' }],
      consultedDocuments: ['wiki/derived/resposta.md']
    })
    expect(verification).toMatchObject({ status: 'pending', jobId: null })

    await runDueBackgroundJobs({
      database: fixture.database,
      derivationRunner: { async run() {} }
    })
    expect(readAnswerVerification(fixture.database, verification!.id)).toMatchObject({ status: 'queued' })

    const seen: unknown[] = []
    const baseline: AnswerVerificationBaseline = {
      answer: 'Resposta sem derived.',
      citations: [],
      consultedDocuments: ['wiki/articles/artigo-1.md']
    }
    const result: AnswerVerificationExecutionResult = {
      baseline,
      judgement: { level: 'FIEL', reason: 'Mesma resposta.', confidence: 'high' }
    }
    await runDueBackgroundJobs({
      database: fixture.database,
      answerVerificationRunner: {
        async run(job) {
          seen.push(job)
          return result
        }
      }
    })

    expect(seen).toEqual([expect.objectContaining({
      verificationId: verification!.id,
      specialistId: 'iva',
      sourceEventId: event.id
    })])
    expect(readAnswerVerification(fixture.database, verification!.id)).toMatchObject({
      status: 'succeeded',
      baseline: null,
      originalAnswer: null,
      judgement: result.judgement
    })
    fixture.database.close()
  })

  it('quarantines an attributed page before its repair starts', async () => {
    const fixture = await createFixture()
    const event = insertEvent(fixture.database, NOT_SAMPLED_EVENT_ID)
    const verification = await enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: event.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta derivada.', originalCitations: [], conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })
    markAnswerVerificationRunning(fixture.database, verification!.id)
    quarantineAttributedDerivedPages(fixture.database, {
      verificationId: verification!.id,
      baseline: { answer: 'Controlo.', citations: [], consultedDocuments: [] },
      judgement: { level: 'NAO_ALINHADO', reason: 'Contradição.', confidence: 'high' },
      attribution: {
        negativeDerivedPaths: ['wiki/derived/resposta.md'], reason: 'A derived prejudicou a resposta.'
      }
    })

    expect(readQuarantinedDerivedPaths(fixture.database, 'iva')).toEqual(['wiki/derived/resposta.md'])
    expect(readAnswerVerification(fixture.database, verification!.id)).toMatchObject({
      status: 'running', negativeDerivedPaths: ['wiki/derived/resposta.md']
    })

    fixture.database.prepare('DELETE FROM question_analytics_events WHERE id = ?').run(event.id)
    expect(readAnswerVerification(fixture.database, verification!.id)).toBeUndefined()
    expect(readQuarantinedDerivedPaths(fixture.database, 'iva')).toEqual(['wiki/derived/resposta.md'])
    expect(fixture.database.prepare('SELECT status FROM background_jobs WHERE id = ?').get(verification!.jobId)).toEqual({
      status: 'cancelled'
    })
    fixture.database.close()
  })

  it('clears quarantine only after an accepted repair revision', async () => {
    const fixture = await createFixture()
    const event = insertEvent(fixture.database, NOT_SAMPLED_EVENT_ID)
    const verification = await enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: event.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta derivada.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })
    await runDueBackgroundJobs({
      database: fixture.database,
      answerVerificationRunner: {
        async run(): Promise<AnswerVerificationExecutionResult> {
          return {
            baseline: { answer: 'Controlo.', citations: [], consultedDocuments: [] },
            judgement: { level: 'NAO_ALINHADO', reason: 'Contradição.', confidence: 'high' },
            attribution: {
              negativeDerivedPaths: ['wiki/derived/resposta.md'], reason: 'A derived prejudicou a resposta.'
            },
            repair: {
              status: 'accepted',
              revisions: [{ path: 'wiki/derived/resposta.md', revisionSha256: 'sha256:repaired' }]
            }
          }
        }
      }
    })

    expect(readAnswerVerification(fixture.database, verification!.id)).toMatchObject({
      status: 'succeeded', originalAnswer: null, baseline: null
    })
    expect(readQuarantinedDerivedPaths(fixture.database, 'iva')).toEqual([])
    expect(fixture.database.prepare(`
      SELECT revision_sha256, status FROM derived_page_quality
      WHERE specialist_id = 'iva' AND wiki_path = 'wiki/derived/resposta.md'
    `).get()).toEqual({ revision_sha256: 'sha256:repaired', status: 'verified' })
    fixture.database.close()
  })

  it('keeps a harmful page quarantined when repair needs an administrator source', async () => {
    const fixture = await createFixture()
    const event = insertEvent(fixture.database, NOT_SAMPLED_EVENT_ID)
    const verification = await enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: event.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta derivada.', originalCitations: [], conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })
    await runDueBackgroundJobs({
      database: fixture.database,
      answerVerificationRunner: {
        async run(): Promise<AnswerVerificationExecutionResult> {
          return {
            baseline: { answer: 'Sem contexto.', citations: [], consultedDocuments: [] },
            judgement: { level: 'POUCO_ALINHADO', reason: 'Falta evidência.', confidence: 'high' },
            attribution: {
              negativeDerivedPaths: ['wiki/derived/resposta.md'], reason: 'A derived excede a fonte.'
            },
            repair: { status: 'needs_admin_source', reason: 'Falta o diploma oficial.' }
          }
        }
      }
    })

    expect(readAnswerVerification(fixture.database, verification!.id)).toMatchObject({
      status: 'needs_admin_source', originalAnswer: null, baseline: null,
      repairReason: 'Falta o diploma oficial.'
    })
    expect(readQuarantinedDerivedPaths(fixture.database, 'iva')).toEqual(['wiki/derived/resposta.md'])
    fixture.database.close()
  })

  it('rejects attribution paths that were not consulted without quarantining them', async () => {
    const fixture = await createFixture()
    const event = insertEvent(fixture.database, NOT_SAMPLED_EVENT_ID)
    const verification = await enqueueDerivedAnswerVerification(fixture.database, {
      sourceEventId: event.id,
      specialistRoot: fixture.root,
      originalAnswer: 'Resposta derivada.',
      originalCitations: [],
      conversationContext: [],
      consultedDocuments: ['wiki/derived/resposta.md']
    })
    const runner = {
      async run(): Promise<AnswerVerificationExecutionResult> {
        return {
          baseline: { answer: 'Controlo.', citations: [], consultedDocuments: [] },
          judgement: { level: 'NAO_ALINHADO' as const, reason: 'Contradição.', confidence: 'high' as const },
          attribution: {
            negativeDerivedPaths: ['wiki/derived/inventada.md'],
            reason: 'Path hostil.'
          }
        }
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runDueBackgroundJobs({ database: fixture.database, answerVerificationRunner: runner })
    }

    expect(readAnswerVerification(fixture.database, verification!.id)).toMatchObject({ status: 'failed' })
    expect(readQuarantinedDerivedPaths(fixture.database, 'iva')).toEqual([])
    fixture.database.close()
  })

  it('filters quarantined derived paths from matching retrieval hints', async () => {
    const fixture = await createFixture()
    const event = insertEvent(fixture.database, 'hint-event')
    storeRetrievalHints(fixture.database, {
      sourceEventId: event.id,
      wikiPaths: ['wiki/derived/resposta.md', 'wiki/articles/artigo-1.md']
    })
    fixture.database.prepare(`
      INSERT INTO derived_page_quality (
        specialist_id, wiki_path, revision_sha256, status, verification_id, updated_at
      ) VALUES ('iva', 'wiki/derived/resposta.md', 'sha256:test', 'quarantined', NULL, ?)
    `).run(new Date().toISOString())

    expect(lookupRetrievalHints(fixture.database, {
      specialistId: 'iva',
      question: event.questionText,
      blockedWikiPaths: readQuarantinedDerivedPaths(fixture.database, 'iva')
    })).toEqual({ wikiPaths: ['wiki/articles/artigo-1.md'], match: 'exact', score: 1 })
    fixture.database.close()
  })

  it('validates bounded five-level judgements and allowlisted attribution output', () => {
    expect(parseAlignmentJudgement('{"level":"MUITO_ALINHADO","reason":"Diferença de estilo.","confidence":"medium"}')).toEqual({
      level: 'MUITO_ALINHADO', reason: 'Diferença de estilo.', confidence: 'medium'
    })
    expect(() => parseAlignmentJudgement('{"level":"PERFEITO","reason":"x","confidence":"high"}')).toThrow()
    expect(parseNegativeAttribution(
      '{"negativeDerivedPaths":["wiki/derived/resposta.md"],"reason":"Omissão."}',
      ['wiki/derived/resposta.md']
    )).toEqual({ negativeDerivedPaths: ['wiki/derived/resposta.md'], reason: 'Omissão.' })
    expect(() => parseNegativeAttribution(
      '{"negativeDerivedPaths":["wiki/derived/inventada.md"],"reason":"x"}',
      ['wiki/derived/resposta.md']
    )).toThrow()
  })

  it('builds the independent prompt without leaking the delivered answer', () => {
    const prompt = buildSourceOnlyAnswerPrompt({
      question: 'Quanto se ganha por hora extra?',
      citationEvidence: [],
      retrievalHints: {
        wikiPaths: ['wiki/derived/resposta.md', 'wiki/articles/artigo-188.md'],
        match: 'exact',
        score: 1
      },
      conversationContext: [{ role: 'user', content: 'O meu salário-base é 100 000 Kz.' }]
    })

    expect(prompt).toContain('Quanto se ganha por hora extra?')
    expect(prompt).toContain('wiki/articles/artigo-188.md')
    expect(prompt).not.toContain('wiki/derived/resposta.md')
    expect(prompt).not.toContain('Resposta entregue')
    expect(prompt).toContain('O meu salário-base é 100 000 Kz.')
  })

  it('blocks direct, traversal, and symlink reads of derived pages for the baseline task', async () => {
    const fixture = await createFixture()
    const outside = await mkdtemp(join(tmpdir(), 'ujimu-verification-outside-'))
    await writeFile(join(outside, 'outside.md'), '# Outside\n')
    await symlink(join(fixture.root, 'wiki', 'derived'), join(fixture.root, 'wiki', 'derived-alias'))
    await symlink(join(outside, 'outside.md'), join(fixture.root, 'wiki', 'escaped.md'))

    await expect(isAnswerVerificationReadPathAllowed(fixture.root, 'AGENTS.md')).resolves.toBe(true)
    await expect(isAnswerVerificationReadPathAllowed(fixture.root, 'wiki/articles/artigo-1.md')).resolves.toBe(true)
    await expect(isAnswerVerificationReadPathAllowed(fixture.root, 'wiki/derived/resposta.md')).resolves.toBe(false)
    await expect(isAnswerVerificationReadPathAllowed(fixture.root, 'wiki/derived-alias/resposta.md')).resolves.toBe(false)
    await expect(isAnswerVerificationReadPathAllowed(fixture.root, 'wiki/escaped.md')).resolves.toBe(false)
    await expect(isAnswerVerificationReadPathAllowed(fixture.root, '../outside.md')).resolves.toBe(false)
    fixture.database.close()
  })
})

async function createFixture(): Promise<{ root: string; database: DatabaseSync }> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-answer-verification-'))
  await mkdir(join(root, 'wiki', 'derived'), { recursive: true })
  await mkdir(join(root, 'wiki', 'articles'), { recursive: true })
  await mkdir(join(root, 'converted'), { recursive: true })
  await writeFile(join(root, 'AGENTS.md'), '# Specialist\n')
  await writeFile(join(root, 'wiki', 'derived', 'resposta.md'), '# Resposta derivada\n')
  await writeFile(join(root, 'wiki', 'articles', 'artigo-1.md'), '# Artigo 1\n')
  const database = await initializeDatabase({ dbPath: join(root, 'ujimu.sqlite') })
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('admin', '2026-09-07T00:00:00.000Z')
  return { root, database }
}

function insertEvent(database: DatabaseSync, id: string) {
  const event = recordQuestionAnalyticsEvent(database, {
    specialistId: 'iva',
    outcome: 'answered',
    question: `Pergunta ${id}`,
    consultedDocumentCount: 1
  })!
  database.prepare('UPDATE question_analytics_events SET id = ? WHERE id = ?').run(id, event.id)
  return { ...event, id }
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
