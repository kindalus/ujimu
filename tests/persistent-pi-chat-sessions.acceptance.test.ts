import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createChatEventStreamForSpecialist } from '../server/utils/chat/engine'
import type { ChatEngineRunner, ChatStreamEvent } from '../server/utils/chat/types'
import { initializeDatabase } from '../server/utils/db'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'
import {
  ChatConversationBusyError,
  ChatConversationExpiredError,
  ChatConversationUnauthorizedError,
  cleanupExpiredChatSessions,
  deleteChatSession,
  openChatSessionTurn,
  reconcilePendingChatSessions,
  resolveChatSessionDirectory
} from '../server/utils/chat/session-store'

const SECRET = 'persistent-chat-session-test-secret-with-32-bytes'
const SPECIALIST_ID = 'iva'
const BASE_TIME = new Date('2026-08-21T10:00:00.000Z')

describe('persistent Pi chat sessions acceptance', () => {
  it('emits a committed anonymous conversation identifier and uses it on the next HTTP stream', async () => {
    const fixture = await createFixture()
    const contexts: string[] = []
    const specialist = testSpecialist(fixture.specialistDir)
    const runner = persistentFakeRunner(contexts)

    const firstEvents = await collectEvents(await createChatEventStreamForSpecialist(
      specialist,
      { specialistId: SPECIALIST_ID, question: 'primeira pergunta' },
      {
        runner,
        piChatEnabled: true,
        persistentChatSessions: true,
        chatSessionDataDir: fixture.dataDir,
        chatSessionSecret: SECRET,
        chatSessionNow: BASE_TIME
      }
    ))
    const conversation = firstEvents.find((event) => event.type === 'conversation')
    expect(firstEvents.map((event) => event.type)).toEqual(['delta', 'conversation', 'done'])
    expect(conversation).toMatchObject({ type: 'conversation', conversationId: expect.any(String) })

    const conversationId = conversation && conversation.type === 'conversation' ? conversation.conversationId : ''
    const secondEvents = await collectEvents(await createChatEventStreamForSpecialist(
      specialist,
      { specialistId: SPECIALIST_ID, question: 'segunda pergunta', conversationId },
      {
        runner,
        piChatEnabled: true,
        persistentChatSessions: true,
        chatSessionDataDir: fixture.dataDir,
        chatSessionSecret: SECRET,
        chatSessionNow: new Date(BASE_TIME.getTime() + 1_000)
      }
    ))

    expect(secondEvents.map((event) => event.type)).toEqual(['delta', 'conversation', 'done'])
    expect(contexts[1]).toContain('primeira pergunta')
    expect(contexts[1]).toContain('resposta: primeira pergunta')
  })

  it('persists registered Pi entry mappings before emitting history and conversation events', async () => {
    const fixture = await createFixture()
    const database = await initializeDatabase({ dbPath: join(fixture.dataDir, 'db', 'ujimu.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', BASE_TIME.toISOString())
    const contexts: string[] = []
    const runner = persistentFakeRunner(contexts)

    try {
      const firstEvents = await collectEvents(await createChatEventStreamForSpecialist(
        testSpecialist(fixture.specialistDir),
        { specialistId: SPECIALIST_ID, question: 'pergunta registada' },
        {
          runner,
          piChatEnabled: true,
          persistentChatSessions: true,
          chatSessionDataDir: fixture.dataDir,
          chatSessionSecret: SECRET,
          chatSessionNow: BASE_TIME,
          history: { database, subject: { type: 'registered', id: 'user-a' }, now: BASE_TIME }
        }
      ))

      expect(firstEvents.map((event) => event.type)).toEqual(['delta', 'history', 'conversation', 'done'])
      const history = firstEvents.find((event) => event.type === 'history')
      const conversation = firstEvents.find((event) => event.type === 'conversation')
      expect(history && history.type === 'history' ? history.conversationId : '').toBe(
        conversation && conversation.type === 'conversation' ? conversation.conversationId : 'missing'
      )
      expect(database.prepare(`
        SELECT role, pi_entry_id
        FROM conversation_messages
        ORDER BY message_order
      `).all()).toEqual([
        { role: 'user', pi_entry_id: expect.any(String) },
        { role: 'assistant', pi_entry_id: expect.any(String) }
      ])
    } finally {
      database.close()
    }
  })

  it('edits a live registered session through its Pi branch and removes the replaced continuation', async () => {
    const fixture = await createFixture()
    const database = await initializeDatabase({ dbPath: join(fixture.dataDir, 'db', 'ujimu.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', BASE_TIME.toISOString())
    const specialist = testSpecialist(fixture.specialistDir)
    const runner = persistentFakeRunner([])
    const common = {
      runner,
      piChatEnabled: true,
      persistentChatSessions: true,
      chatSessionDataDir: fixture.dataDir,
      chatSessionSecret: SECRET
    }

    try {
      const first = await collectEvents(await createChatEventStreamForSpecialist(
        specialist,
        { specialistId: SPECIALIST_ID, question: 'pergunta mantida' },
        { ...common, history: { database, subject: { type: 'registered', id: 'user-a' }, now: BASE_TIME } }
      ))
      const firstHistory = first.find((event) => event.type === 'history')
      const conversationId = firstHistory && firstHistory.type === 'history' ? firstHistory.conversationId : ''

      const second = await collectEvents(await createChatEventStreamForSpecialist(
        specialist,
        { specialistId: SPECIALIST_ID, question: 'SENTINELA_CONTINUACAO_SUBSTITUIDA', conversationId },
        { ...common, history: { database, subject: { type: 'registered', id: 'user-a' }, now: new Date(BASE_TIME.getTime() + 1_000) } }
      ))
      const secondHistory = second.find((event) => event.type === 'history')
      const replaceFromMessageId = secondHistory && secondHistory.type === 'history' ? secondHistory.userMessageId : ''

      await collectEvents(await createChatEventStreamForSpecialist(
        specialist,
        {
          specialistId: SPECIALIST_ID,
          question: 'pergunta corrigida',
          conversationId,
          replaceFromMessageId
        },
        { ...common, history: { database, subject: { type: 'registered', id: 'user-a' }, now: new Date(BASE_TIME.getTime() + 2_000) } }
      ))

      const databaseText = JSON.stringify(database.prepare(`
        SELECT content FROM conversation_messages WHERE conversation_id = ? ORDER BY message_order
      `).all(conversationId))
      const sessionText = await readDirectoryText(resolveChatSessionDirectory({
        dataDir: fixture.dataDir,
        identityType: 'registered',
        specialistId: SPECIALIST_ID,
        internalConversationId: conversationId
      }))
      expect(databaseText).toContain('pergunta mantida')
      expect(databaseText).toContain('pergunta corrigida')
      expect(databaseText).not.toContain('SENTINELA_CONTINUACAO_SUBSTITUIDA')
      expect(sessionText).not.toContain('SENTINELA_CONTINUACAO_SUBSTITUIDA')
    } finally {
      database.close()
    }
  })

  it('regenerates the last registered response from before its question and replaces SQLite only on commit', async () => {
    const fixture = await createFixture()
    const database = await initializeDatabase({ dbPath: join(fixture.dataDir, 'db', 'ujimu.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', BASE_TIME.toISOString())
    const contexts: string[] = []
    let run = 0
    const runner: ChatEngineRunner = {
      async run(input) {
        contexts.push(JSON.stringify(input.piSessionManager?.buildSessionContext() ?? {}))
        run += 1
        appendPiTurn(input.piSessionManager, input.question, `resposta ${run}`)
        return { grounded: true, citations: [], deltas: (async function* () { yield `resposta ${run}` })() }
      }
    }
    const common = {
      runner, piChatEnabled: true, persistentChatSessions: true,
      chatSessionDataDir: fixture.dataDir, chatSessionSecret: SECRET,
      history: { database, subject: { type: 'registered' as const, id: 'user-a' }, now: BASE_TIME }
    }

    try {
      const first = await collectEvents(await createChatEventStreamForSpecialist(
        testSpecialist(fixture.specialistDir),
        { specialistId: SPECIALIST_ID, question: 'pergunta igual' },
        common
      ))
      const history = first.find((event) => event.type === 'history')
      const conversationId = history?.type === 'history' ? history.conversationId : ''

      await collectEvents(await createChatEventStreamForSpecialist(
        testSpecialist(fixture.specialistDir),
        { specialistId: SPECIALIST_ID, conversationId, question: 'pergunta igual', regenerateLast: true },
        common
      ))

      expect(contexts[1]).not.toContain('resposta 1')
      expect(database.prepare('SELECT role, content FROM conversation_messages ORDER BY message_order').all()).toEqual([
        { role: 'user', content: 'pergunta igual' },
        { role: 'assistant', content: 'resposta 2' }
      ])
    } finally {
      database.close()
    }
  })

  it('regenerates an anonymous response by branching before its latest question', async () => {
    const fixture = await createFixture()
    const contexts: string[] = []
    let run = 0
    const runner: ChatEngineRunner = {
      async run(input) {
        contexts.push(JSON.stringify(input.piSessionManager?.buildSessionContext() ?? {}))
        run += 1
        appendPiTurn(input.piSessionManager, input.question, `resposta anónima ${run}`)
        return { grounded: true, citations: [], deltas: (async function* () { yield `resposta anónima ${run}` })() }
      }
    }
    const common = {
      runner, piChatEnabled: true, persistentChatSessions: true,
      chatSessionDataDir: fixture.dataDir, chatSessionSecret: SECRET, chatSessionNow: BASE_TIME
    }
    const first = await collectEvents(await createChatEventStreamForSpecialist(
      testSpecialist(fixture.specialistDir),
      { specialistId: SPECIALIST_ID, question: 'pergunta anónima' }, common
    ))
    const event = first.find((candidate) => candidate.type === 'conversation')
    const conversationId = event?.type === 'conversation' ? event.conversationId : ''

    await collectEvents(await createChatEventStreamForSpecialist(
      testSpecialist(fixture.specialistDir),
      { specialistId: SPECIALIST_ID, conversationId, question: 'pergunta anónima', regenerateLast: true }, common
    ))

    expect(contexts[1]).not.toContain('resposta anónima 1')
  })

  it('rejects a concurrent HTTP turn before consuming a second quota event', async () => {
    const fixture = await createFixture()
    const database = await initializeDatabase({ dbPath: join(fixture.dataDir, 'db', 'ujimu.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', BASE_TIME.toISOString())
    const specialist = testSpecialist(fixture.specialistDir)
    const runner = persistentFakeRunner([])
    const base = {
      runner,
      piChatEnabled: true,
      persistentChatSessions: true,
      chatSessionDataDir: fixture.dataDir,
      chatSessionSecret: SECRET,
      history: { database, subject: { type: 'registered' as const, id: 'user-a' }, now: BASE_TIME }
    }

    try {
      const initial = await collectEvents(await createChatEventStreamForSpecialist(
        specialist,
        { specialistId: SPECIALIST_ID, question: 'inicial' },
        base
      ))
      const history = initial.find((event) => event.type === 'history')
      const conversationId = history && history.type === 'history' ? history.conversationId : ''
      const first = await createChatEventStreamForSpecialist(
        specialist,
        { specialistId: SPECIALIST_ID, question: 'pedido aceite', conversationId, clientTimezone: 'UTC' },
        { ...base, quota: { database, subject: { type: 'registered', id: 'user-a' }, occurredAt: BASE_TIME } }
      )

      await expect(createChatEventStreamForSpecialist(
        specialist,
        { specialistId: SPECIALIST_ID, question: 'pedido concorrente', conversationId, clientTimezone: 'UTC' },
        { ...base, quota: { database, subject: { type: 'registered', id: 'user-a' }, occurredAt: BASE_TIME } }
      )).rejects.toMatchObject({ statusCode: 409, code: 'CONVERSATION_BUSY' })

      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM request_events WHERE subject_id = 'user-a'
      `).get()).toMatchObject({ count: 1 })
      await collectEvents(first)
    } finally {
      database.close()
    }
  })

  it('continues one anonymous Pi session with an opaque signed identifier', async () => {
    const fixture = await createFixture()
    const first = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'anonymous' },
      now: BASE_TIME,
      secret: SECRET
    })

    await first.beginTurn()
    appendPiTurn(first.manager, 'primeira pergunta', 'resposta da primeira pergunta')
    const firstCommit = await first.commit({ now: BASE_TIME })
    first.release()

    expect(firstCommit.conversationId).not.toMatch(/[\\/]/u)
    expect(firstCommit.conversationId).not.toBe(first.internalConversationId)

    const second = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'anonymous' },
      conversationId: firstCommit.conversationId,
      now: new Date(BASE_TIME.getTime() + 60_000),
      secret: SECRET
    })

    expect(JSON.stringify(second.manager.buildSessionContext())).toContain('primeira pergunta')
    expect(JSON.stringify(second.manager.buildSessionContext())).toContain('resposta da primeira pergunta')
    await second.rollback()
    second.release()
  })

  it('fails closed for a forged anonymous identifier or the wrong specialist', async () => {
    const fixture = await createFixture()
    const turn = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'anonymous' },
      now: BASE_TIME,
      secret: SECRET
    })
    await turn.beginTurn()
    appendPiTurn(turn.manager, 'segredo da conversa A', 'resposta A')
    const committed = await turn.commit({ now: BASE_TIME })
    turn.release()

    await expect(openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'anonymous' },
      conversationId: `${committed.conversationId}forjado`,
      now: BASE_TIME,
      secret: SECRET
    })).rejects.toBeInstanceOf(ChatConversationUnauthorizedError)

    await expect(openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: 'laboral',
      identity: { type: 'anonymous' },
      conversationId: committed.conversationId,
      now: BASE_TIME,
      secret: SECRET
    })).rejects.toBeInstanceOf(ChatConversationUnauthorizedError)
  })

  it('rejects a concurrent turn before either manager can write', async () => {
    const fixture = await createFixture()
    const first = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: BASE_TIME,
      secret: SECRET
    })

    await expect(openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: BASE_TIME,
      secret: SECRET
    })).rejects.toBeInstanceOf(ChatConversationBusyError)

    await first.rollback()
    first.release()
  })

  it('reconciles a pending journal after restart from the SQLite entry-pair decision', async () => {
    const fixture = await createFixture()
    const pending = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: BASE_TIME,
      secret: SECRET
    })
    await pending.beginTurn()
    const ids = appendPiTurn(pending.manager, 'turno confirmado no SQLite', 'resposta confirmada no SQLite')
    await pending.captureCompletedEntryIds({ now: BASE_TIME })
    pending.release()

    await expect(reconcilePendingChatSessions({
      dataDir: fixture.dataDir,
      isPersistedEntryPair: (candidate) => candidate.userPiEntryId === ids.userPiEntryId
        && candidate.assistantPiEntryId === ids.assistantPiEntryId
    })).resolves.toEqual({ reconciled: 1 })

    const recovered = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: new Date(BASE_TIME.getTime() + 1_000),
      secret: SECRET
    })
    expect(JSON.stringify(recovered.manager.buildSessionContext())).toContain('turno confirmado no SQLite')
    await recovered.rollback()
    recovered.release()

    const abandoned = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: new Date(BASE_TIME.getTime() + 2_000),
      secret: SECRET
    })
    await abandoned.beginTurn()
    appendPiTurn(abandoned.manager, 'SENTINELA_JORNAL_SEM_SQLITE', 'deve reverter')
    await abandoned.captureCompletedEntryIds()
    abandoned.release()

    const rolledBack = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: new Date(BASE_TIME.getTime() + 3_000),
      secret: SECRET,
      isPersistedEntryPair: () => false
    })
    expect(JSON.stringify(rolledBack.manager.buildSessionContext())).not.toContain('SENTINELA_JORNAL_SEM_SQLITE')
    await rolledBack.rollback()
    rolledBack.release()
  })

  it('rolls back an incomplete append-only turn to its checkpoint', async () => {
    const fixture = await createFixture()
    const initial = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: BASE_TIME,
      secret: SECRET
    })
    await initial.beginTurn()
    appendPiTurn(initial.manager, 'conteúdo confirmado', 'resposta confirmada')
    await initial.commit({ now: BASE_TIME })
    initial.release()

    const failed = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: new Date(BASE_TIME.getTime() + 1_000),
      secret: SECRET
    })
    await failed.beginTurn()
    appendPiTurn(failed.manager, 'SENTINELA_TURNO_FALHADO', 'não deve sobreviver')
    await failed.rollback()
    failed.release()

    const sessionDir = resolveChatSessionDirectory({
      dataDir: fixture.dataDir,
      identityType: 'registered',
      specialistId: SPECIALIST_ID,
      internalConversationId: 'conversation-a'
    })
    expect(await readDirectoryText(sessionDir)).toContain('conteúdo confirmado')
    expect(await readDirectoryText(sessionDir)).not.toContain('SENTINELA_TURNO_FALHADO')
  })

  it('expires access exactly at 24 hours and 30 days, then removes files during cleanup', async () => {
    const fixture = await createFixture()
    const anonymous = await committedTurn(fixture, { type: 'anonymous' }, undefined, 'anónimo')
    const registered = await committedTurn(fixture, { type: 'registered', userId: 'user-a' }, 'conversation-a', 'registado')

    await expect(openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'anonymous' },
      conversationId: anonymous.conversationId,
      now: new Date(BASE_TIME.getTime() + 24 * 60 * 60 * 1000),
      secret: SECRET
    })).rejects.toBeInstanceOf(ChatConversationExpiredError)

    const resumed = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: registered.conversationId,
      now: new Date(BASE_TIME.getTime() + 30 * 24 * 60 * 60 * 1000),
      secret: SECRET,
      rehydrationMessages: [
        { id: 'message-1', role: 'user', content: 'histórico SQLite' },
        { id: 'message-2', role: 'assistant', content: 'resposta SQLite' }
      ]
    })
    expect(resumed.reconstructed).toBe(true)
    expect(JSON.stringify(resumed.manager.buildSessionContext())).toContain('histórico SQLite')
    await resumed.beginTurn()
    appendPiTurn(resumed.manager, 'SENTINELA_FALHA_APOS_RECONSTRUCAO', 'não deve persistir')
    await resumed.rollback()
    resumed.release()

    const reconstructedAgain = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: registered.conversationId,
      now: new Date(BASE_TIME.getTime() + 30 * 24 * 60 * 60 * 1000 + 1_000),
      secret: SECRET,
      rehydrationMessages: [
        { id: 'message-1', role: 'user', content: 'histórico SQLite' },
        { id: 'message-2', role: 'assistant', content: 'resposta SQLite' }
      ]
    })
    expect(JSON.stringify(reconstructedAgain.manager.buildSessionContext())).toContain('histórico SQLite')
    expect(JSON.stringify(reconstructedAgain.manager.buildSessionContext())).not.toContain('SENTINELA_FALHA_APOS_RECONSTRUCAO')
    await reconstructedAgain.rollback()
    reconstructedAgain.release()

    const cleanup = await cleanupExpiredChatSessions({
      dataDir: fixture.dataDir,
      now: new Date(BASE_TIME.getTime() + 31 * 24 * 60 * 60 * 1000)
    })
    expect(cleanup.removed).toBeGreaterThanOrEqual(1)
    await expect(stat(resolveChatSessionDirectory({
      dataDir: fixture.dataDir,
      identityType: 'anonymous',
      specialistId: SPECIALIST_ID,
      internalConversationId: anonymous.internalConversationId
    }))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('extracts only the active Pi branch when editing a live registered conversation', async () => {
    const fixture = await createFixture()
    const first = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: BASE_TIME,
      secret: SECRET
    })
    await first.beginTurn()
    const firstIds = appendPiTurn(first.manager, 'pergunta mantida', 'resposta mantida')
    await first.commit({ now: BASE_TIME })
    first.release()

    const second = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      now: new Date(BASE_TIME.getTime() + 1_000),
      secret: SECRET
    })
    await second.beginTurn()
    const replacedIds = appendPiTurn(second.manager, 'SENTINELA_PERGUNTA_SUBSTITUIDA', 'SENTINELA_RESPOSTA_POSTERIOR')
    await second.commit({ now: new Date(BASE_TIME.getTime() + 1_000) })
    second.release()

    const edit = await openChatSessionTurn({
      dataDir: fixture.dataDir,
      cwd: fixture.specialistDir,
      specialistId: SPECIALIST_ID,
      identity: { type: 'registered', userId: 'user-a' },
      conversationId: 'conversation-a',
      replaceFromPiEntryId: replacedIds.userPiEntryId,
      now: new Date(BASE_TIME.getTime() + 2_000),
      secret: SECRET
    })
    await edit.beginTurn()
    appendPiTurn(edit.manager, 'pergunta corrigida', 'resposta corrigida')
    await edit.commit({ now: new Date(BASE_TIME.getTime() + 2_000) })
    edit.release()

    const sessionDir = resolveChatSessionDirectory({
      dataDir: fixture.dataDir,
      identityType: 'registered',
      specialistId: SPECIALIST_ID,
      internalConversationId: 'conversation-a'
    })
    const files = await readdir(sessionDir)
    const stored = await readDirectoryText(sessionDir)
    expect(files.filter((name) => name.endsWith('.jsonl'))).toHaveLength(1)
    expect(stored).toContain(firstIds.userPiEntryId)
    expect(stored).toContain('pergunta corrigida')
    expect(stored).not.toContain('SENTINELA_PERGUNTA_SUBSTITUIDA')
    expect(stored).not.toContain('SENTINELA_RESPOSTA_POSTERIOR')
    expect(files.some((name) => name.includes('pending') || name.includes('staged'))).toBe(false)
  })

  it('deletes the registered JSONL immediately with the conversation', async () => {
    const fixture = await createFixture()
    await committedTurn(fixture, { type: 'registered', userId: 'user-a' }, 'conversation-a', 'eliminar')
    const sessionDir = resolveChatSessionDirectory({
      dataDir: fixture.dataDir,
      identityType: 'registered',
      specialistId: SPECIALIST_ID,
      internalConversationId: 'conversation-a'
    })

    await deleteChatSession({
      dataDir: fixture.dataDir,
      identityType: 'registered',
      specialistId: SPECIALIST_ID,
      internalConversationId: 'conversation-a'
    })

    await expect(stat(sessionDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the anonymous conversation identifier only in page memory', async () => {
    const source = await readFile(join(process.cwd(), 'pages/index.vue'), 'utf8')
    expect(source).toContain("type: 'conversation'")
    expect(source).toContain('activeConversationId.value = event.conversationId')
    expect(source).not.toMatch(/localStorage\.(?:getItem|setItem).*conversation/iu)
    expect(source).not.toMatch(/sessionStorage\.(?:getItem|setItem).*conversation/iu)
  })
})

async function createFixture(): Promise<{ dataDir: string; specialistDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-persistent-chat-'))
  const dataDir = join(root, 'data')
  const specialistDir = join(root, 'specialists', SPECIALIST_ID)
  await mkdir(specialistDir, { recursive: true })
  await writeFile(join(specialistDir, 'AGENTS.md'), '# Specialist\n')
  return { dataDir, specialistDir }
}

function appendPiTurn(manager: any, question: string, answer: string): {
  userPiEntryId: string
  assistantPiEntryId: string
} {
  const userPiEntryId = manager.appendMessage({ role: 'user', content: question, timestamp: Date.now() })
  const assistantPiEntryId = manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: answer }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now()
  })
  return { userPiEntryId, assistantPiEntryId }
}

async function committedTurn(
  fixture: { dataDir: string; specialistDir: string },
  identity: { type: 'anonymous' } | { type: 'registered'; userId: string },
  conversationId: string | undefined,
  marker: string
): Promise<{ conversationId: string; internalConversationId: string }> {
  const turn = await openChatSessionTurn({
    dataDir: fixture.dataDir,
    cwd: fixture.specialistDir,
    specialistId: SPECIALIST_ID,
    identity,
    ...(conversationId ? { conversationId } : {}),
    now: BASE_TIME,
    secret: SECRET
  })
  await turn.beginTurn()
  appendPiTurn(turn.manager, `pergunta ${marker}`, `resposta ${marker}`)
  const committed = await turn.commit({ now: BASE_TIME })
  const internalConversationId = turn.internalConversationId
  turn.release()
  return { conversationId: committed.conversationId, internalConversationId }
}

function testSpecialist(root: string): SpecialistRuntime {
  return {
    id: SPECIALIST_ID,
    name: 'IVA',
    description: 'IVA',
    wiki_type: 'legislation-regulatory',
    system_prompt: '',
    citations_required: true,
    streaming_enabled: true,
    status: 'active',
    company_id: null,
    seo: { title: '', description: '', introduction: '', topics: [], limitations: '', call_to_action: '' },
    paths: {
      root,
      config: join(root, 'specialist.yaml'),
      raw: join(root, 'raw'),
      converted: join(root, 'converted'),
      wiki: join(root, 'wiki'),
      ingest: join(root, 'ingest'),
      ingestState: join(root, 'ingest', 'state.json')
    }
  }
}

function persistentFakeRunner(contexts: string[]): ChatEngineRunner {
  return {
    async run(input) {
      contexts.push(JSON.stringify(input.piSessionManager?.buildSessionContext() ?? {}))
      appendPiTurn(input.piSessionManager, input.question, `resposta: ${input.question}`)
      return {
        grounded: true,
        citations: [],
        deltas: (async function* () { yield `resposta: ${input.question}` })()
      }
    }
  }
}

async function collectEvents(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

async function readDirectoryText(directory: string): Promise<string> {
  const names = await readdir(directory)
  const chunks = await Promise.all(names.map(async (name) => {
    const path = join(directory, name)
    const details = await stat(path)
    return details.isFile() ? readFile(path, 'utf8') : ''
  }))
  return chunks.join('\n')
}
