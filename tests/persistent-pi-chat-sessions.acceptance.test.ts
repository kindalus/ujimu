import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  ChatConversationBusyError,
  ChatConversationExpiredError,
  ChatConversationUnauthorizedError,
  cleanupExpiredChatSessions,
  deleteChatSession,
  openChatSessionTurn,
  resolveChatSessionDirectory
} from '../server/utils/chat/session-store'

const SECRET = 'persistent-chat-session-test-secret-with-32-bytes'
const SPECIALIST_ID = 'iva'
const BASE_TIME = new Date('2026-08-21T10:00:00.000Z')

describe('persistent Pi chat sessions acceptance', () => {
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

    await expect(openChatSessionTurn({
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
    })).resolves.toMatchObject({ reconstructed: true })

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

async function readDirectoryText(directory: string): Promise<string> {
  const names = await readdir(directory)
  const chunks = await Promise.all(names.map(async (name) => {
    const path = join(directory, name)
    const details = await stat(path)
    return details.isFile() ? readFile(path, 'utf8') : ''
  }))
  return chunks.join('\n')
}
