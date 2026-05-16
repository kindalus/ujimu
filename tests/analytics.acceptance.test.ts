import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import visitHandler from '../server/api/analytics/visit.post'
import adminQuestionAnalyticsHandler from '../server/api/admin/analytics/questions.get'
import adminQuestionReviewHandler from '../server/api/admin/analytics/questions/[fingerprint]/review.post'
import adminVisitorsHandler from '../server/api/admin/analytics/visitors.get'
import historyDeleteHandler from '../server/api/history/[conversationId].delete'
import { createSessionToken } from '../server/utils/auth/session'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import type { ChatEngineRunner, ChatStreamEvent } from '../server/utils/chat/types'
import { initializeDatabase } from '../server/utils/db'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getSpecialistById, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('question analytics and content gaps acceptance', () => {
  it('records only visible answered and insufficient-context question outcomes', async () => {
    const { dataDir, specialtiesRoot, database } = await createTempAnalyticsData()
    await createTempSpecialist('iva', dataDir)
    await createIngestedSource(specialtiesRoot, 'iva')
    await createTempSpecialist('empty', dataDir)

    await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: '  O que diz o Artigo 1.º?  ', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner: fakeRunner(['Resposta fundamentada.']),
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
          runner: fakeRunner(['Nunca deve ser chamada.']),
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
      user_message_id: null
    })
    expect(rows[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[1]).toMatchObject({
      specialist_id: 'empty',
      outcome: 'insufficient_context',
      question_text: 'Existe uma regra sem fontes?',
      normalized_question: 'existe uma regra sem fontes'
    })
    expect(JSON.stringify(rows)).not.toContain('Resposta fundamentada')
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

    const registeredVisit = await fetchAnalytics(
      new Request('http://local/api/analytics/visit', {
        method: 'POST',
        headers: sessionHeaders('registered-user')
      })
    )
    expect(registeredVisit.status).toBe(200)

    const month = new Date().toISOString().slice(0, 7)
    const visitors = await fetchAnalytics(
      new Request(`http://local/api/admin/analytics/visitors?month=${month}`, {
        headers: sessionHeaders('admin-user')
      })
    )
    expect(visitors.status).toBe(200)
    await expect(visitors.json()).resolves.toMatchObject({ month, distinctVisitors: 2 })
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
  state.sources[`${specialistId}-fonte.md`].status = 'ingested'
  state.sources[`${specialistId}-fonte.md`].ingested_at = '2026-05-16T00:00:00.000Z'
  await writeIngestionState(specialist.paths.ingestState, state)
}

function fakeRunner(deltas: string[]): ChatEngineRunner {
  return {
    async run(input) {
      return {
        grounded: true,
        citations: [input.citationEvidence[0]],
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
        visitor_id, user_id, conversation_id, user_message_id, occurred_at
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
  router.post('/api/admin/analytics/questions/:fingerprint/review', adminQuestionReviewHandler)
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
      sessionSecret: 'analytics-test-secret',
      now: new Date('2026-05-16T12:00:00.000Z')
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
