import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import visitHandler from '../server/api/analytics/visit.post'
import adminQuestionAnalyticsHandler from '../server/api/admin/analytics/questions.get'
import adminQuestionReviewHandler from '../server/api/admin/analytics/questions/[fingerprint]/review.post'
import adminQuestionActionHandler from '../server/api/admin/analytics/questions/[eventId]/action.post'
import adminQuestionRetryHandler from '../server/api/admin/analytics/questions/[eventId]/retry.post'
import adminVisitorsHandler from '../server/api/admin/analytics/visitors.get'
import historyDeleteHandler from '../server/api/history/[conversationId].delete'
import { createSessionToken } from '../server/utils/auth/session'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import type { ChatEngineRunner, ChatStreamEvent } from '../server/utils/chat/types'
import { initializeDatabase } from '../server/utils/db'
import { runDueBackgroundJobs } from '../server/utils/jobs/background'
import { recordQuestionAnalyticsEvent } from '../server/utils/analytics/questions'
import { lookupRetrievalHints, storeRetrievalHints } from '../server/utils/chat/retrieval-cache'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getSpecialistById, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('question analytics and content gaps acceptance', () => {
  it('records visible answered question outcomes and ignores failed streams', async () => {
    const { dataDir, specialtiesRoot, database } = await createTempAnalyticsData()
    await createTempSpecialist('iva', dataDir)
    await createIngestedSource(specialtiesRoot, 'iva')
    await createTempSpecialist('empty', dataDir)

    await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: '  O que diz o Artigo 1.º?  ', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner: fakeRunner(['Resposta fundamentada.'], ['wiki/iva.md', 'wiki/deducoes.md']),
          analytics: {
            database,
            visitorId: 'visitor-a',
            now: new Date('2026-05-16T12:00:00.000Z')
          }
        }
      )
    )

    await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'empty', question: 'Existe uma regra sem fontes?', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner: insufficientContextRunner(['Não consigo responder com o contexto actual.']),
          analytics: {
            database,
            visitorId: 'visitor-a',
            now: new Date('2026-05-16T12:05:00.000Z')
          }
        }
      )
    )

    await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Pergunta que falha', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner: failingStreamRunner(),
          analytics: {
            database,
            visitorId: 'visitor-a',
            now: new Date('2026-05-16T12:10:00.000Z')
          }
        }
      )
    )

    const rows = readQuestionAnalyticsRows(database)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      specialist_id: 'iva',
      outcome: 'answered',
      question_text: 'O que diz o Artigo 1.º?',
      normalized_question: 'o que diz o artigo 1',
      user_timezone: 'Africa/Luanda',
      visitor_id: 'visitor-a',
      user_id: null,
      conversation_id: null,
      user_message_id: null,
      consulted_document_count: 2
    })
    expect(rows[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[1]).toMatchObject({
      specialist_id: 'empty',
      outcome: 'insufficient_context',
      question_text: 'Existe uma regra sem fontes?',
      normalized_question: 'existe uma regra sem fontes',
      consulted_document_count: 0
    })
    expect(JSON.stringify(rows)).not.toContain('Resposta fundamentada')
    database.close()
  })

  it('does not turn a completed response into a stream error when analytics fails', async () => {
    const { dataDir, specialtiesRoot, database } = await createTempAnalyticsData()
    await createTempSpecialist('iva', dataDir)
    await createIngestedSource(specialtiesRoot, 'iva')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failingDatabase = {
      prepare() {
        throw new Error('question text must not be logged')
      }
    } as unknown as DatabaseSync

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Pergunta privada' },
        {
          specialtiesRoot,
          runner: fakeRunner(['Resposta concluída.']),
          analytics: { database: failingDatabase }
        }
      )
    )
    await waitForTelemetry()

    expect(events).toContainEqual({ type: 'done', grounded: true })
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(log).toHaveBeenCalledWith('[ujimu] telemetry task failed', {
      code: 'CHAT_TELEMETRY_WRITE_FAILED'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('Pergunta privada')
    log.mockRestore()
    database.close()
  })

  it('returns exact then similar wiki hints and lazily expires them without storing answers', async () => {
    const { dataDir, specialtiesRoot, database } = await createTempAnalyticsData()
    await createTempSpecialist('iva', dataDir)
    await createIngestedSource(specialtiesRoot, 'iva')
    const now = new Date('2026-09-01T10:00:00.000Z')
    const event = recordQuestionAnalyticsEvent(database, {
      specialistId: 'iva',
      outcome: 'answered',
      question: 'Qual é o prazo para entregar declaração mensal de IVA?',
      occurredAt: now
    })!
    storeRetrievalHints(database, {
      sourceEventId: event.id,
      wikiPaths: ['wiki/prazos.md', 'wiki/iva.md', 'wiki/prazos.md', '../secret.md'],
      now
    })

    expect(lookupRetrievalHints(database, {
      specialistId: 'iva',
      question: 'Qual é o prazo para entregar declaração mensal de IVA?',
      now
    })).toEqual({ wikiPaths: ['wiki/iva.md', 'wiki/prazos.md'], match: 'exact', score: 1 })

    expect(lookupRetrievalHints(database, {
      specialistId: 'iva',
      question: 'Qual é o prazo para entrega da declaração mensal de IVA?',
      now
    })).toMatchObject({ wikiPaths: ['wiki/iva.md', 'wiki/prazos.md'], match: 'similar' })

    expect(lookupRetrievalHints(database, {
      specialistId: 'iva',
      question: 'Como calcular direitos aduaneiros?',
      now
    })).toBeUndefined()
    const hintColumns = database.prepare('PRAGMA table_info(question_retrieval_hints)').all()
      .map((column: any) => column.name)
    expect(hintColumns).not.toContain('answer')
    expect(hintColumns).not.toContain('normalized_question')
    expect(hintColumns).not.toContain('question_text')
    expect(hintColumns).not.toContain('fingerprint')

    let runnerHints: unknown
    await collectChatEvents(await createChatEventStreamFromBody(
      { specialistId: 'iva', question: event.questionText },
      {
        specialtiesRoot,
        analytics: { database, now },
        runner: {
          async run(input) {
            runnerHints = input.retrievalHints
            return { grounded: true, citations: [], deltas: toAsyncDeltas(['Resposta.']) }
          }
        }
      }
    ))
    await waitForTelemetry()
    expect(runnerHints).toEqual({ wikiPaths: ['wiki/iva.md', 'wiki/prazos.md'], match: 'exact', score: 1 })

    expect(lookupRetrievalHints(database, {
      specialistId: 'iva',
      question: event.questionText,
      now: new Date('2026-09-08T10:00:00.001Z')
    })).toBeUndefined()
    expect(database.prepare('SELECT COUNT(*) AS count FROM question_retrieval_hints').get()).toEqual({ count: 0 })
    database.close()
  })

  it('keeps edited-question analytics but removes readable analytics when the conversation is deleted', async () => {
    const { dataDir, specialtiesRoot, database } = await createTempAnalyticsData()
    seedUser(database, 'user-a', ['user@example.com'])
    await createTempSpecialist('iva', dataDir)
    await createIngestedSource(specialtiesRoot, 'iva')

    const firstEvents = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Pergunta original', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner: fakeRunner(['Resposta original.']),
          history: {
            database,
            subject: { type: 'registered', id: 'user-a' },
            now: new Date('2026-05-16T12:00:00.000Z')
          },
          analytics: {
            database,
            visitorId: 'visitor-a',
            userId: 'user-a',
            now: new Date('2026-05-16T12:00:00.000Z')
          }
        }
      )
    )
    const firstHistory = findHistoryEvent(firstEvents)

    await collectChatEvents(
      await createChatEventStreamFromBody(
        {
          specialistId: 'iva',
          conversationId: firstHistory.conversationId,
          replaceFromMessageId: firstHistory.userMessageId,
          question: 'Pergunta editada'
        },
        {
          specialtiesRoot,
          runner: fakeRunner(['Resposta editada.']),
          history: {
            database,
            subject: { type: 'registered', id: 'user-a' },
            now: new Date('2026-05-16T12:10:00.000Z')
          },
          analytics: {
            database,
            visitorId: 'visitor-a',
            userId: 'user-a',
            now: new Date('2026-05-16T12:10:00.000Z')
          }
        }
      )
    )

    await waitForTelemetry()
    expect(readQuestionAnalyticsRows(database).map((row) => row.question_text)).toEqual([
      'Pergunta original',
      'Pergunta editada'
    ])
    database.close()

    const fetchAnalytics = createAnalyticsFetch(dataDir, 'admin@example.com')
    const deleted = await fetchAnalytics(
      new Request(`http://local/api/history/${firstHistory.conversationId}`, {
        method: 'DELETE',
        headers: sessionHeaders('user-a')
      })
    )
    expect(deleted.status).toBe(200)

    const afterDelete = await openAnalyticsDatabase(dataDir)
    expect(readQuestionAnalyticsRows(afterDelete)).toEqual([])
    afterDelete.close()
  })

  it('lists repeated content-gap candidates and hides reviewed candidates until renewed recurrence', async () => {
    const { dataDir, database } = await createTempAnalyticsData()
    seedUser(database, 'admin-user', ['admin@example.com'])
    const fingerprint = fingerprintFor('como deduzir iva')
    insertQuestionAnalyticsEvent(database, {
      id: 'event-1',
      specialistId: 'iva',
      fingerprint,
      normalizedQuestion: 'como deduzir iva',
      questionText: 'Como deduzir IVA?',
      outcome: 'answered',
      occurredAt: new Date().toISOString()
    })
    insertQuestionAnalyticsEvent(database, {
      id: 'event-2',
      specialistId: 'iva',
      fingerprint,
      normalizedQuestion: 'como deduzir iva',
      questionText: 'Como posso deduzir IVA?',
      outcome: 'insufficient_context',
      occurredAt: new Date().toISOString()
    })
    database.close()

    const fetchAnalytics = createAnalyticsFetch(dataDir, 'admin@example.com')
    const listed = await fetchAnalytics(
      new Request('http://local/api/admin/analytics/questions?specialistId=iva', {
        headers: sessionHeaders('admin-user')
      })
    )
    expect(listed.status).toBe(200)
    const listedBody = await listed.json() as { candidates: Array<Record<string, unknown>>; recentQuestions: unknown[] }
    expect(listedBody.candidates).toEqual([
      expect.objectContaining({
        specialistId: 'iva',
        fingerprint,
        latestQuestion: 'Como posso deduzir IVA?',
        countLast30Days: 2,
        totalCount: 2,
        insufficientContextCount: 1,
        reviewedAt: null
      })
    ])
    expect(listedBody.recentQuestions).toEqual([
      expect.objectContaining({ questionText: 'Como posso deduzir IVA?', outcome: 'insufficient_context' }),
      expect.objectContaining({ questionText: 'Como deduzir IVA?', outcome: 'answered' })
    ])

    const reviewed = await fetchAnalytics(
      jsonRequest(`http://local/api/admin/analytics/questions/${fingerprint}/review`, {
        method: 'POST',
        headers: sessionHeaders('admin-user'),
        body: { specialistId: 'iva' }
      })
    )
    expect(reviewed.status).toBe(200)

    const hidden = await fetchAnalytics(
      new Request('http://local/api/admin/analytics/questions?specialistId=iva', {
        headers: sessionHeaders('admin-user')
      })
    )
    await expect(hidden.json()).resolves.toMatchObject({ candidates: [] })

    await waitForClockTick()
    const afterReviewDatabase = await openAnalyticsDatabase(dataDir)
    insertQuestionAnalyticsEvent(afterReviewDatabase, {
      id: 'event-3',
      specialistId: 'iva',
      fingerprint,
      normalizedQuestion: 'como deduzir iva',
      questionText: 'Como deduzir IVA agora?',
      outcome: 'answered',
      occurredAt: new Date().toISOString()
    })
    insertQuestionAnalyticsEvent(afterReviewDatabase, {
      id: 'event-4',
      specialistId: 'iva',
      fingerprint,
      normalizedQuestion: 'como deduzir iva',
      questionText: 'Como deduzir IVA de novo?',
      outcome: 'answered',
      occurredAt: new Date().toISOString()
    })
    afterReviewDatabase.close()

    const resurfaced = await fetchAnalytics(
      new Request('http://local/api/admin/analytics/questions?specialistId=iva', {
        headers: sessionHeaders('admin-user')
      })
    )
    const resurfacedBody = await resurfaced.json() as { candidates: Array<Record<string, unknown>> }
    expect(resurfacedBody.candidates).toEqual([
      expect.objectContaining({
        fingerprint,
        countLast30Days: 4,
        countSinceReview: 2,
        latestQuestion: 'Como deduzir IVA de novo?'
      })
    ])
  })

  it('lists and curates eligible multi-source events with final decisions and retry', async () => {
    const { dataDir, database } = await createTempAnalyticsData()
    seedUser(database, 'admin-user', ['admin@example.com'])
    seedUser(database, 'regular-user', ['user@example.com'])
    await createTempSpecialist('iva', dataDir)
    const derivedEvent = recordQuestionAnalyticsEvent(database, {
      specialistId: 'iva', outcome: 'answered', question: 'Comparar quatro regras?', consultedDocumentCount: 4
    })!
    const ignoredEvent = recordQuestionAnalyticsEvent(database, {
      specialistId: 'iva', outcome: 'answered', question: 'Comparar cinco regras?', consultedDocumentCount: 5
    })!
    recordQuestionAnalyticsEvent(database, {
      specialistId: 'iva', outcome: 'answered', question: 'Só três regras?', consultedDocumentCount: 3
    })
    recordQuestionAnalyticsEvent(database, {
      specialistId: 'iva', outcome: 'insufficient_context', question: 'Lacuna com muitas leituras?', consultedDocumentCount: 8
    })
    database.close()
    const fetchAnalytics = createAnalyticsFetch(dataDir, 'admin@example.com')

    const denied = await fetchAnalytics(jsonRequest(
      `http://local/api/admin/analytics/questions/${derivedEvent.id}/action`,
      { method: 'POST', headers: sessionHeaders('regular-user'), body: { decision: 'derived' } }
    ))
    expect(denied.status).toBe(403)

    const initial = await fetchAnalytics(new Request(
      'http://local/api/admin/analytics/questions?specialistId=iva',
      { headers: sessionHeaders('admin-user') }
    ))
    const initialBody = await initial.json() as { multiSourceQuestions: Array<Record<string, any>> }
    expect(initialBody.multiSourceQuestions.map((question) => question.id).sort()).toEqual([
      derivedEvent.id, ignoredEvent.id
    ].sort())
    expect(initialBody.multiSourceQuestions.every((question) => question.decision === null)).toBe(true)

    const ignored = await fetchAnalytics(jsonRequest(
      `http://local/api/admin/analytics/questions/${ignoredEvent.id}/action`,
      { method: 'POST', headers: sessionHeaders('admin-user'), body: { decision: 'ignored' } }
    ))
    expect(ignored.status).toBe(200)
    await expect(ignored.json()).resolves.toMatchObject({ action: { decision: 'ignored' }, job: null })

    const derived = await fetchAnalytics(jsonRequest(
      `http://local/api/admin/analytics/questions/${derivedEvent.id}/action`,
      { method: 'POST', headers: sessionHeaders('admin-user'), body: { decision: 'derived' } }
    ))
    expect(derived.status).toBe(202)
    const derivedBody = await derived.json() as { job: { id: string; status: string } }
    expect(derivedBody.job).toMatchObject({ status: 'queued' })

    const repeated = await fetchAnalytics(jsonRequest(
      `http://local/api/admin/analytics/questions/${derivedEvent.id}/action`,
      { method: 'POST', headers: sessionHeaders('admin-user'), body: { decision: 'derived' } }
    ))
    expect(repeated.status).toBe(202)
    await expect(repeated.json()).resolves.toMatchObject({ job: { id: derivedBody.job.id } })

    const opposite = await fetchAnalytics(jsonRequest(
      `http://local/api/admin/analytics/questions/${derivedEvent.id}/action`,
      { method: 'POST', headers: sessionHeaders('admin-user'), body: { decision: 'ignored' } }
    ))
    expect(opposite.status).toBe(409)

    const workerDatabase = await openAnalyticsDatabase(dataDir)
    await runDueBackgroundJobs({
      database: workerDatabase,
      derivationRunner: { async run() { throw new Error('provider secret') } }
    })
    workerDatabase.close()

    const failed = await fetchAnalytics(new Request(
      'http://local/api/admin/analytics/questions?specialistId=iva',
      { headers: sessionHeaders('admin-user') }
    ))
    const failedBody = await failed.json() as { multiSourceQuestions: Array<Record<string, any>> }
    expect(failedBody.multiSourceQuestions.find((question) => question.id === derivedEvent.id)).toMatchObject({
      decision: 'derived',
      job: { id: derivedBody.job.id, status: 'failed', errorMessage: 'Derivation job failed.' }
    })

    const retry = await fetchAnalytics(new Request(
      `http://local/api/admin/analytics/questions/${derivedEvent.id}/retry`,
      { method: 'POST', headers: sessionHeaders('admin-user') }
    ))
    expect(retry.status).toBe(202)
    await expect(retry.json()).resolves.toMatchObject({ job: { id: derivedBody.job.id, status: 'queued' } })
  })

  it('records first-party visits and reports distinct monthly visitors to admins', async () => {
    const { dataDir, database } = await createTempAnalyticsData()
    seedUser(database, 'admin-user', ['admin@example.com'])
    seedUser(database, 'registered-user', ['user@example.com'])
    database.close()
    const fetchAnalytics = createAnalyticsFetch(dataDir, 'admin@example.com')

    const anonymousVisit = await fetchAnalytics(new Request('http://local/api/analytics/visit', { method: 'POST' }))
    expect(anonymousVisit.status).toBe(200)
    const visitorCookie = anonymousVisit.headers.get('set-cookie')?.split(';')[0]
    expect(visitorCookie).toMatch(/^ujimu_visitor_id=/)

    const repeatedAnonymousVisit = await fetchAnalytics(
      new Request('http://local/api/analytics/visit', {
        method: 'POST',
        headers: visitorCookie ? { cookie: visitorCookie } : undefined
      })
    )
    expect(repeatedAnonymousVisit.status).toBe(200)

    const linkedHeaders = sessionHeaders('registered-user')
    if (visitorCookie) linkedHeaders.set('cookie', `${linkedHeaders.get('cookie')}; ${visitorCookie}`)
    const linkedVisit = await fetchAnalytics(new Request('http://local/api/analytics/visit', {
      method: 'POST', headers: linkedHeaders
    }))
    expect(linkedVisit.status).toBe(200)

    const secondCookieSameAccount = await fetchAnalytics(new Request('http://local/api/analytics/visit', {
      method: 'POST', headers: sessionHeaders('registered-user')
    }))
    expect(secondCookieSameAccount.status).toBe(200)

    await fetchAnalytics(new Request('http://local/api/analytics/visit', { method: 'POST' }))
    await fetchAnalytics(new Request('http://local/api/analytics/visit', { method: 'POST' }))

    const month = new Date().toISOString().slice(0, 7)
    const visitors = await fetchAnalytics(
      new Request(`http://local/api/admin/analytics/visitors?month=${month}`, {
        headers: sessionHeaders('admin-user')
      })
    )
    expect(visitors.status).toBe(200)
    await expect(visitors.json()).resolves.toMatchObject({ month, distinctVisitors: 3 })
  })

  it('collapses repeat visits so an unauthenticated caller cannot grow the table without bound', async () => {
    const { dataDir } = await createTempAnalyticsData()
    const fetchAnalytics = createAnalyticsFetch(dataDir, 'admin@example.com')

    const first = await fetchAnalytics(new Request('http://local/api/analytics/visit', { method: 'POST' }))
    const visitorCookie = first.headers.get('set-cookie')?.split(';')[0]

    for (let attempt = 0; attempt < 25; attempt += 1) {
      await fetchAnalytics(new Request('http://local/api/analytics/visit', {
        method: 'POST',
        headers: visitorCookie ? { cookie: visitorCookie } : undefined
      }))
    }

    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    const rows = database.prepare('SELECT COUNT(*) AS count FROM visitor_events').get() as { count: number }
    database.close()

    expect(rows.count).toBe(1)
  })

  it('ignores a forged visitor cookie instead of storing it', async () => {
    const { dataDir } = await createTempAnalyticsData()
    const fetchAnalytics = createAnalyticsFetch(dataDir, 'admin@example.com')

    await fetchAnalytics(new Request('http://local/api/analytics/visit', {
      method: 'POST',
      headers: { cookie: 'ujimu_visitor_id=not-a-uuid-just-attacker-text' }
    }))

    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    const row = database.prepare('SELECT visitor_id FROM visitor_events').get() as { visitor_id: string }
    database.close()

    expect(row.visitor_id).not.toBe('not-a-uuid-just-attacker-text')
    expect(row.visitor_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

async function createTempAnalyticsData(): Promise<{
  dataDir: string
  specialtiesRoot: string
  database: DatabaseSync
}> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-analytics-'))
  const database = await openAnalyticsDatabase(dataDir)
  return { dataDir, specialtiesRoot: join(dataDir, 'specialties'), database }
}

async function openAnalyticsDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

function seedUser(database: DatabaseSync, userId: string, contacts: string[]): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-05-16T12:00:00.000Z')
  contacts.forEach((contact, index) => {
    database
      .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        `${userId}-identity-${index}`,
        userId,
        contact.startsWith('+') ? 'phone' : 'email',
        contact,
        new Date(Date.UTC(2026, 4, 16, 12, index)).toISOString()
      )
  })
}

async function createTempSpecialist(id: string, dataDir: string): Promise<SpecialistRuntime> {
  return createSpecialist(
    {
      id,
      name: `Especialidade ${id}`,
      description: `Especialista ${id}.`,
      wiki_type: 'legislation-regulatory',
      system_prompt: 'Answer only from this specialist wiki.',
      citations_required: true,
      streaming_enabled: true
    },
    { dataDir }
  )
}

async function createIngestedSource(specialtiesRoot: string, specialistId: string): Promise<void> {
  const specialist = await getSpecialistById(specialistId, { specialtiesRoot })
  if (!specialist) throw new Error(`Expected ${specialistId} specialist to exist`)

  await storeRawSource(specialist, {
    fileName: `${specialistId}-fonte.md`,
    content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
  })
  const state = await scanSpecialistRawSources(specialist)
  state.sources[`${specialistId}-fonte.original.md`].status = 'ingested'
  state.sources[`${specialistId}-fonte.original.md`].ingestion!.status = 'ingested'
  state.sources[`${specialistId}-fonte.original.md`].ingestion!.citations = [{
    source_file: `raw/${specialistId}-fonte.original.md`,
    source_title: 'Código do IVA',
    article_refs: ['Artigo 1.º']
  }]
  state.sources[`${specialistId}-fonte.original.md`].ingestion!.manifest_validated_at = '2026-05-16T00:00:00.000Z'
  state.sources[`${specialistId}-fonte.original.md`].ingested_at = '2026-05-16T00:00:00.000Z'
  await writeIngestionState(specialist.paths.ingestState, state)
}

function fakeRunner(deltas: string[], consultedDocuments?: string[]): ChatEngineRunner {
  return {
    async run(input) {
      return {
        grounded: true,
        citations: [input.citationEvidence[0]],
        deltas: toAsyncDeltas(deltas),
        consultedDocuments
      }
    }
  }
}

function insufficientContextRunner(deltas: string[]): ChatEngineRunner {
  return {
    async run() {
      return {
        grounded: false,
        outcome: 'insufficient_context',
        citations: [],
        deltas: toAsyncDeltas(deltas)
      }
    }
  }
}

function failingStreamRunner(): ChatEngineRunner {
  return {
    async run(input) {
      return {
        grounded: true,
        citations: [input.citationEvidence[0]],
        deltas: failingDeltas()
      }
    }
  }
}

async function* failingDeltas(): AsyncIterable<string> {
  yield 'Resposta parcial.'
  throw new Error('stream failed')
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) yield delta
}

async function collectChatEvents(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function findHistoryEvent(events: ChatStreamEvent[]): Extract<ChatStreamEvent, { type: 'history' }> {
  const event = events.find((item): item is Extract<ChatStreamEvent, { type: 'history' }> => item.type === 'history')
  if (!event) throw new Error('Expected history event')
  return event
}

function readQuestionAnalyticsRows(database: DatabaseSync): Array<Record<string, unknown>> {
  return database
    .prepare(`
      SELECT specialist_id, outcome, question_text, normalized_question, fingerprint, user_timezone,
        visitor_id, user_id, conversation_id, user_message_id, consulted_document_count, occurred_at
      FROM question_analytics_events
      ORDER BY occurred_at, id
    `)
    .all() as Array<Record<string, unknown>>
}

function insertQuestionAnalyticsEvent(
  database: DatabaseSync,
  input: {
    id: string
    specialistId: string
    fingerprint: string
    normalizedQuestion: string
    questionText: string
    outcome: 'answered' | 'insufficient_context'
    occurredAt: string
  }
): void {
  database
    .prepare(`
      INSERT INTO question_analytics_events (
        id, specialist_id, outcome, question_text, normalized_question, fingerprint,
        occurred_at, user_timezone, visitor_id, user_id, conversation_id, user_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.id,
      input.specialistId,
      input.outcome,
      input.questionText,
      input.normalizedQuestion,
      input.fingerprint,
      input.occurredAt,
      'Africa/Luanda',
      'visitor-a',
      null,
      null,
      null
    )
}

function createAnalyticsFetch(dataDir: string, adminContacts: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.post('/api/analytics/visit', visitHandler)
  router.get('/api/admin/analytics/questions', adminQuestionAnalyticsHandler)
  router.post('/api/admin/analytics/questions/:id/review', adminQuestionReviewHandler)
  router.post('/api/admin/analytics/questions/:id/action', adminQuestionActionHandler)
  router.post('/api/admin/analytics/questions/:id/retry', adminQuestionRetryHandler)
  router.get('/api/admin/analytics/visitors', adminVisitorsHandler)
  router.delete('/api/history/:conversationId', historyDeleteHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'analytics-test-secret'
    process.env.UJIMU_ADMIN_CONTACTS = adminContacts

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_ADMIN_CONTACTS', previousAdminContacts)
    }
  }
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'analytics-test-secret'
    })}`
  })
}

function jsonRequest(
  url: string,
  options: { method?: string; headers?: Headers; body?: unknown } = {}
): Request {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function fingerprintFor(normalizedQuestion: string): string {
  return createHash('sha256').update(normalizedQuestion).digest('hex')
}

async function waitForClockTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForTelemetry(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
