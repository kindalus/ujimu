import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import historyListHandler from '../server/api/history/index.get'
import historyGetHandler from '../server/api/history/[conversationId].get'
import historyDeleteHandler from '../server/api/history/[conversationId].delete'
import { createSessionToken } from '../server/utils/auth/session'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import type { ChatCitation, ChatEngineRunner } from '../server/utils/chat/types'
import { initializeDatabase } from '../server/utils/db'
import {
  buildConversationContext,
  deleteConversation,
  getConversation,
  listConversations,
  persistCompletedHistoryTurn
} from '../server/utils/history/repository'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('conversation history and editing acceptance', () => {
  it('enforces authentication and ownership for history HTTP endpoints', async () => {
    const { dataDir, database } = await createTempDatabase()
    insertUser(database, 'user-a')
    insertUser(database, 'user-b')
    const saved = await persistCompletedHistoryTurn(database, completedTurn({ userId: 'user-a' }))
    database.close()

    const fetchHistory = createHistoryFetch(dataDir)

    const anonymous = await fetchHistory(new Request('http://local/api/history?specialistId=iva'))
    expect(anonymous.status).toBe(401)

    const otherUserToken = createSessionToken('user-b', {
      sessionSecret: 'history-test-secret',
      now: new Date('2026-05-16T12:00:00.000Z')
    })
    const crossUser = await fetchHistory(
      new Request(`http://local/api/history/${saved.conversationId}`, {
        headers: { cookie: `ujimu_session=${otherUserToken}` }
      })
    )
    expect(crossUser.status).toBe(404)

    const missing = await fetchHistory(
      new Request('http://local/api/history/missing-conversation', {
        headers: { cookie: `ujimu_session=${otherUserToken}` }
      })
    )
    expect(missing.status).toBe(404)
  })

  it('lists at most 20 latest conversations per specialist and restores citation snapshots', async () => {
    const { database } = await createTempDatabase()
    insertUser(database, 'user-a')
    insertUser(database, 'user-b')

    for (let index = 0; index < 25; index += 1) {
      await persistCompletedHistoryTurn(
        database,
        completedTurn({
          userId: 'user-a',
          specialistId: 'iva',
          question: `Pergunta IVA ${index}`,
          answer: `Resposta IVA ${index}`,
          now: new Date(Date.UTC(2026, 4, 16, 12, index))
        })
      )
    }
    await persistCompletedHistoryTurn(database, completedTurn({ userId: 'user-a', specialistId: 'customs' }))
    await persistCompletedHistoryTurn(database, completedTurn({ userId: 'user-b', specialistId: 'iva' }))

    const conversations = listConversations(database, { userId: 'user-a', specialistId: 'iva' })

    expect(conversations).toHaveLength(20)
    expect(conversations.map((conversation) => conversation.specialistId)).toEqual(Array(20).fill('iva'))
    expect(conversations[0].updatedAt).toBe('2026-05-16T12:24:00.000Z')
    expect(conversations.at(-1)?.updatedAt).toBe('2026-05-16T12:05:00.000Z')

    const restored = getConversation(database, {
      userId: 'user-a',
      conversationId: conversations[0].id
    })
    expect(restored?.messages).toHaveLength(2)
    expect(restored?.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Resposta IVA 24',
      citations: [citationSnapshot]
    })

    deleteConversation(database, { userId: 'user-a', conversationId: conversations[0].id })
    expect(getConversation(database, { userId: 'user-a', conversationId: conversations[0].id })).toBeUndefined()
    expect(getConversation(database, { userId: 'user-b', conversationId: conversations[1].id })).toBeUndefined()
    database.close()
  })

  it('persists authenticated chat after streaming, emits history before done, and stores an AI title', async () => {
    const { database } = await createTempDatabase()
    insertUser(database, 'user-a')
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource(specialtiesRoot)
    const titleRunner = {
      generateTitle: vi.fn(async () => 'Dedução de IVA em facturas')
    }

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Posso deduzir este IVA?', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner: fakeRunner(['A dedução depende das regras aplicáveis.']),
          history: {
            database,
            subject: { type: 'registered', id: 'user-a' },
            titleRunner,
            now: new Date('2026-05-16T12:00:00.000Z')
          }
        }
      )
    )

    expect(events.map((event) => event.type)).toEqual(['delta', 'citation', 'history', 'done'])
    const historyEvent = findHistoryEvent(events)
    expect(historyEvent).toMatchObject({
      title: 'Dedução de IVA em facturas',
      titleStatus: 'generated'
    })
    expect(events.findIndex((event) => event.type === 'history')).toBeLessThan(
      events.findIndex((event) => event.type === 'done')
    )
    expect(titleRunner.generateTitle).toHaveBeenCalledWith({
      specialistName: 'Legislação de IVA',
      question: 'Posso deduzir este IVA?',
      answer: 'A dedução depende das regras aplicáveis.'
    })

    const restored = getConversation(database, {
      userId: 'user-a',
      conversationId: historyEvent.conversationId
    })
    expect(restored).toMatchObject({
      title: 'Dedução de IVA em facturas',
      titleStatus: 'generated',
      specialistId: 'iva'
    })
    expect(restored?.messages.map((message) => message.id)).toEqual([
      historyEvent.userMessageId,
      historyEvent.assistantMessageId
    ])
    database.close()
  })

  it('keeps a pending temporary title when title generation is unavailable', async () => {
    const { database } = await createTempDatabase()
    insertUser(database, 'user-a')

    const saved = await persistCompletedHistoryTurn(
      database,
      completedTurn({
        userId: 'user-a',
        question: 'Qual é a taxa aplicável?',
        titleRunner: {
          generateTitle: vi.fn(async () => {
            throw new Error('title provider unavailable')
          })
        }
      })
    )

    expect(saved.title).toBe('Qual é a taxa aplicável?')
    expect(saved.titleStatus).toBe('pending')
    database.close()
  })

  it('replaces an edited user question only after a complete replacement response exists', async () => {
    const { database } = await createTempDatabase()
    insertUser(database, 'user-a')
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource(specialtiesRoot)

    const first = await persistCompletedHistoryTurn(
      database,
      completedTurn({ userId: 'user-a', question: 'Pergunta 1', answer: 'Resposta 1' })
    )
    const second = await persistCompletedHistoryTurn(
      database,
      completedTurn({
        userId: 'user-a',
        conversationId: first.conversationId,
        question: 'Pergunta 2 original',
        answer: 'Resposta 2 original'
      })
    )
    await persistCompletedHistoryTurn(
      database,
      completedTurn({
        userId: 'user-a',
        conversationId: first.conversationId,
        question: 'Pergunta 3 apagada',
        answer: 'Resposta 3 apagada'
      })
    )

    await collectChatEvents(
      await createChatEventStreamFromBody(
        {
          specialistId: 'iva',
          conversationId: first.conversationId,
          replaceFromMessageId: second.userMessageId,
          question: 'Pergunta 2 editada'
        },
        {
          specialtiesRoot,
          runner: fakeRunner(['Resposta 2 nova']),
          history: {
            database,
            subject: { type: 'registered', id: 'user-a' },
            now: new Date('2026-05-16T12:30:00.000Z')
          }
        }
      )
    )

    const edited = getConversation(database, { userId: 'user-a', conversationId: first.conversationId })
    expect(edited?.messages.map((message) => message.content)).toEqual([
      'Pergunta 1',
      'Resposta 1',
      'Pergunta 2 editada',
      'Resposta 2 nova'
    ])
    expect(edited?.messages[2]?.id).not.toBe(second.userMessageId)
    expect(edited?.messages.map((message) => message.content)).not.toContain('Pergunta 3 apagada')

    const beforeFailure = edited?.messages.map((message) => ({ id: message.id, content: message.content }))
    await collectChatEvents(
      await createChatEventStreamFromBody(
        {
          specialistId: 'iva',
          conversationId: first.conversationId,
          replaceFromMessageId: edited?.messages[2]?.id,
          question: 'Pergunta que falha'
        },
        {
          specialtiesRoot,
          runner: failingStreamRunner(),
          history: {
            database,
            subject: { type: 'registered', id: 'user-a' },
            now: new Date('2026-05-16T12:35:00.000Z')
          }
        }
      )
    )

    const afterFailure = getConversation(database, { userId: 'user-a', conversationId: first.conversationId })
    expect(afterFailure?.messages.map((message) => ({ id: message.id, content: message.content }))).toEqual(
      beforeFailure
    )
    database.close()
  })

  it('sends first 5 plus last 10 prior messages as non-grounding continuation context', async () => {
    const { database } = await createTempDatabase()
    insertUser(database, 'user-a')
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource(specialtiesRoot)

    let conversationId = ''
    for (let turn = 1; turn <= 9; turn += 1) {
      const saved = await persistCompletedHistoryTurn(
        database,
        completedTurn({
          userId: 'user-a',
          conversationId: conversationId || undefined,
          question: `Q${turn}`,
          answer: `A${turn}`,
          now: new Date(Date.UTC(2026, 4, 16, 12, turn))
        })
      )
      conversationId = saved.conversationId
    }

    expect(buildConversationContext(database, { userId: 'user-a', conversationId }).map((message) => message.content)).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'Q5',
      'A5',
      'Q6',
      'A6',
      'Q7',
      'A7',
      'Q8',
      'A8',
      'Q9',
      'A9'
    ])

    const receivedContexts: unknown[] = []
    await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', conversationId, question: 'E no caso anterior?' },
        {
          specialtiesRoot,
          runner: {
            async run(input) {
              receivedContexts.push((input as { conversationContext?: unknown }).conversationContext)
              return {
                grounded: true,
                citations: [input.citationEvidence[0]],
                deltas: toAsyncDeltas(['Resposta contextual.'])
              }
            }
          },
          history: {
            database,
            subject: { type: 'registered', id: 'user-a' },
            now: new Date('2026-05-16T13:00:00.000Z')
          }
        }
      )
    )

    expect((receivedContexts[0] as Array<{ content: string }>).map((message) => message.content)).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'Q5',
      'A5',
      'Q6',
      'A6',
      'Q7',
      'A7',
      'Q8',
      'A8',
      'Q9',
      'A9'
    ])
    database.close()
  })
})

const citationSnapshot: ChatCitation = {
  sourceTitle: 'Código do IVA',
  sourceFile: 'raw/codigo-iva.original.md',
  articleRefs: ['Artigo 1.º']
}

async function createTempDatabase(): Promise<{ dataDir: string; database: DatabaseSync }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-history-db-'))
  const dbPath = join(dataDir, 'db', 'ujimu.sqlite')
  const database = await initializeDatabase({ dataDir, dbPath })
  return { dataDir, database }
}

function createHistoryFetch(dataDir: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/history', historyListHandler)
  router.get('/api/history/:conversationId', historyGetHandler)
  router.delete('/api/history/:conversationId', historyDeleteHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'history-test-secret'

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
    }
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function insertUser(database: DatabaseSync, userId: string): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-05-16T12:00:00.000Z')
}

function completedTurn(overrides: Partial<Parameters<typeof persistCompletedHistoryTurn>[1]> = {}): Parameters<typeof persistCompletedHistoryTurn>[1] {
  return {
    userId: 'user-a',
    specialistId: 'iva',
    specialistName: 'Legislação de IVA',
    question: 'Pergunta de teste',
    answer: 'Resposta de teste',
    grounded: true,
    citations: [citationSnapshot],
    now: new Date('2026-05-16T12:00:00.000Z'),
    ...overrides
  }
}

async function createTempSpecialist(id: string): Promise<{
  specialist: SpecialistRuntime
  specialtiesRoot: string
}> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-history-specialist-'))
  const specialtiesRoot = join(dataDir, 'specialties')

  const specialist = await createSpecialist(
    {
      id,
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      system_prompt: 'Answer only from this specialist wiki.',
      citations_required: true,
      streaming_enabled: true
    },
    { specialtiesRoot }
  )

  return { specialist, specialtiesRoot }
}

async function createIngestedSource(specialtiesRoot: string): Promise<void> {
  const { getSpecialistById } = await import('../server/utils/specialists/registry')
  const specialist = await getSpecialistById('iva', { specialtiesRoot })
  if (!specialist) {
    throw new Error('Expected specialist to exist')
  }

  await storeRawSource(specialist, {
    fileName: 'codigo-iva.md',
    content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
  })

  const state = await scanSpecialistRawSources(specialist)
  state.sources['codigo-iva.original.md'].status = 'ingested'
  state.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
  state.sources['codigo-iva.original.md'].ingestion!.citations = [{
    source_file: 'raw/codigo-iva.original.md',
    source_title: 'Código do IVA',
    article_refs: ['Artigo 1.º']
  }]
  state.sources['codigo-iva.original.md'].ingestion!.manifest_validated_at = '2026-05-16T00:00:00.000Z'
  state.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
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

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}

async function* failingDeltas(): AsyncIterable<string> {
  yield 'Resposta parcial.'
  throw new Error('stream failed')
}

async function collectChatEvents(events: AsyncIterable<unknown>): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const collected: Array<{ type: string; [key: string]: unknown }> = []

  for await (const event of events) {
    collected.push(event as { type: string; [key: string]: unknown })
  }

  return collected
}

function findHistoryEvent(events: Array<{ type: string; [key: string]: unknown }>): {
  type: 'history'
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  title: string
  titleStatus: string
} {
  const event = events.find((candidate) => candidate.type === 'history')
  if (!event) {
    throw new Error('Expected history event')
  }
  return event as ReturnType<typeof findHistoryEvent>
}
