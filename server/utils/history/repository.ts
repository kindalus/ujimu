import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ChatCitation } from '../chat/types'

export type HistoryMessageRole = 'user' | 'assistant'
export type ConversationTitleStatus = 'generated' | 'pending'

export interface ConversationTitleInput {
  specialistName: string
  question: string
  answer: string
}

export interface ConversationTitleRunner {
  generateTitle(input: ConversationTitleInput): Promise<string>
}

export interface PersistCompletedHistoryTurnInput {
  userId: string
  specialistId: string
  specialistName: string
  conversationId?: string
  createConversationIfMissing?: boolean
  replaceFromMessageId?: string
  userPiEntryId?: string
  assistantPiEntryId?: string
  question: string
  answer: string
  grounded: boolean
  citations: ChatCitation[]
  now?: Date
  titleRunner?: ConversationTitleRunner
  generatedTitle?: string
  titleTimeoutMs?: number
}

export interface PersistedHistoryTurn {
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  title: string
  titleStatus: ConversationTitleStatus
}

export interface ConversationSummary {
  id: string
  userId: string
  specialistId: string
  title: string
  titleStatus: ConversationTitleStatus
  createdAt: string
  updatedAt: string
}

export interface HistoryMessage {
  id: string
  role: HistoryMessageRole
  content: string
  grounded?: boolean
  createdAt: string
  citations: ChatCitation[]
}

export interface HistoryConversation extends ConversationSummary {
  messages: HistoryMessage[]
}

export interface ConversationContextMessage {
  id: string
  role: HistoryMessageRole
  content: string
}

export interface PiConversationMessage extends ConversationContextMessage {
  piEntryId?: string
}

const DEFAULT_TITLE_TIMEOUT_MS = 5000
const DEFAULT_HISTORY_LIMIT = 20
const FIRST_CONTEXT_MESSAGES = 5
const LAST_CONTEXT_MESSAGES = 10

export async function persistCompletedHistoryTurn(
  database: DatabaseSync,
  input: PersistCompletedHistoryTurnInput
): Promise<PersistedHistoryTurn> {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const existingConversation = input.conversationId
    ? getConversationSummary(database, { userId: input.userId, conversationId: input.conversationId })
    : undefined

  if (input.conversationId && !existingConversation && !input.createConversationIfMissing) {
    throw new HistoryRepositoryError('Conversation was not found.', 'HISTORY_NOT_FOUND')
  }

  if (input.replaceFromMessageId && !input.conversationId) {
    throw new HistoryRepositoryError('replaceFromMessageId requires conversationId.', 'INVALID_HISTORY_REQUEST')
  }

  const titleDecision = existingConversation
    ? { title: existingConversation.title, titleStatus: existingConversation.titleStatus }
    : await resolveInitialTitle(input)

  const conversationId = existingConversation?.id ?? input.conversationId ?? randomUUID()
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()

  database.exec('BEGIN')
  try {
    if (!existingConversation) {
      database
        .prepare(`
          INSERT INTO conversations (id, user_id, specialist_id, title, title_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          conversationId,
          input.userId,
          input.specialistId,
          titleDecision.title,
          titleDecision.titleStatus,
          nowIso,
          nowIso
        )
    }

    let nextOrder = readNextMessageOrder(database, conversationId)

    if (input.replaceFromMessageId) {
      const replacementOrder = readEditableMessageOrder(database, {
        conversationId,
        messageId: input.replaceFromMessageId
      })
      deleteMessagesAtOrAfter(database, { conversationId, messageOrder: replacementOrder })
      nextOrder = replacementOrder
    }

    insertMessage(database, {
      id: userMessageId,
      conversationId,
      role: 'user',
      content: input.question,
      messageOrder: nextOrder,
      grounded: undefined,
      piEntryId: input.userPiEntryId,
      createdAt: nowIso
    })
    insertMessage(database, {
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: input.answer,
      messageOrder: nextOrder + 1,
      grounded: input.grounded,
      piEntryId: input.assistantPiEntryId,
      createdAt: nowIso
    })
    insertCitations(database, assistantMessageId, input.citations)

    database
      .prepare('UPDATE conversations SET updated_at = ?, title = ?, title_status = ? WHERE id = ?')
      .run(nowIso, titleDecision.title, titleDecision.titleStatus, conversationId)

    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return {
    conversationId,
    userMessageId,
    assistantMessageId,
    title: titleDecision.title,
    titleStatus: titleDecision.titleStatus
  }
}

export function listConversations(
  database: DatabaseSync,
  input: { userId: string; specialistId: string; limit?: number }
): ConversationSummary[] {
  return database
    .prepare(`
      SELECT id, user_id, specialist_id, title, title_status, created_at, updated_at
      FROM conversations
      WHERE user_id = ? AND specialist_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `)
    .all(input.userId, input.specialistId, input.limit ?? DEFAULT_HISTORY_LIMIT)
    .map(mapConversationSummary)
}

export function getConversation(
  database: DatabaseSync,
  input: { userId: string; conversationId: string }
): HistoryConversation | undefined {
  const summary = getConversationSummary(database, input)
  if (!summary) return undefined

  const messages = database
    .prepare(`
      SELECT id, role, content, grounded, created_at
      FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY message_order ASC
    `)
    .all(summary.id)
    .map((row) => mapHistoryMessage(database, row as unknown as ConversationMessageRow))

  return { ...summary, messages }
}

export function getConversationSummary(
  database: DatabaseSync,
  input: { userId: string; conversationId: string }
): ConversationSummary | undefined {
  const row = database
    .prepare(`
      SELECT id, user_id, specialist_id, title, title_status, created_at, updated_at
      FROM conversations
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `)
    .get(input.conversationId, input.userId) as ConversationRow | undefined

  return row ? mapConversationSummary(row) : undefined
}

export function deleteConversation(
  database: DatabaseSync,
  input: { userId: string; conversationId: string }
): boolean {
  const result = database
    .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
    .run(input.conversationId, input.userId)
  return result.changes > 0
}

export function deleteConversationsForSpecialist(database: DatabaseSync, specialistId: string): void {
  database.prepare('DELETE FROM conversations WHERE specialist_id = ?').run(specialistId)
}

export function listConversationMessagesForPi(
  database: DatabaseSync,
  input: { userId: string; conversationId: string; beforeMessageId?: string }
): PiConversationMessage[] {
  const summary = getConversationSummary(database, input)
  if (!summary) return []

  const beforeOrder = input.beforeMessageId
    ? readMessageOrder(database, { conversationId: summary.id, messageId: input.beforeMessageId })
    : undefined

  return (database
    .prepare(`
      SELECT id, role, content, pi_entry_id
      FROM conversation_messages
      WHERE conversation_id = ?
        AND (? IS NULL OR message_order < ?)
      ORDER BY message_order ASC
    `)
    .all(summary.id, beforeOrder ?? null, beforeOrder ?? null) as Array<{
      id: string
      role: HistoryMessageRole
      content: string
      pi_entry_id: string | null
    }>).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      ...(row.pi_entry_id ? { piEntryId: row.pi_entry_id } : {})
    }))
}

export function getLastCompletedTurnForRegeneration(
  database: DatabaseSync,
  input: { userId: string; conversationId: string }
): { userMessageId: string; userPiEntryId?: string; question: string } | undefined {
  const summary = getConversationSummary(database, input)
  if (!summary) return undefined
  const rows = database.prepare(`
    SELECT id, role, content, pi_entry_id
    FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY message_order DESC
    LIMIT 2
  `).all(summary.id) as Array<{
    id: string
    role: HistoryMessageRole
    content: string
    pi_entry_id: string | null
  }>
  const [assistant, user] = rows
  if (assistant?.role !== 'assistant' || user?.role !== 'user') return undefined
  return {
    userMessageId: user.id,
    question: user.content,
    ...(user.pi_entry_id ? { userPiEntryId: user.pi_entry_id } : {})
  }
}

export function getEditableMessagePiEntryId(
  database: DatabaseSync,
  input: { userId: string; conversationId: string; messageId: string }
): string | undefined {
  const summary = getConversationSummary(database, input)
  if (!summary) return undefined
  const row = database
    .prepare(`
      SELECT pi_entry_id
      FROM conversation_messages
      WHERE conversation_id = ? AND id = ? AND role = 'user'
      LIMIT 1
    `)
    .get(summary.id, input.messageId) as { pi_entry_id: string | null } | undefined
  return row?.pi_entry_id ?? undefined
}

export function updateConversationPiEntryMappings(
  database: DatabaseSync,
  input: {
    userId: string
    conversationId: string
    mappings: Array<{ messageId: string; piEntryId: string }>
  }
): void {
  const summary = getConversationSummary(database, input)
  if (!summary) throw new HistoryRepositoryError('Conversation was not found.', 'HISTORY_NOT_FOUND')
  const update = database.prepare(`
    UPDATE conversation_messages
    SET pi_entry_id = ?
    WHERE id = ? AND conversation_id = ?
  `)
  database.exec('BEGIN')
  try {
    for (const mapping of input.mappings) {
      update.run(mapping.piEntryId, mapping.messageId, summary.id)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function hasConversationPiEntryPair(
  database: DatabaseSync,
  input: {
    userId: string
    conversationId: string
    userPiEntryId: string
    assistantPiEntryId: string
  }
): boolean {
  const summary = getConversationSummary(database, input)
  return summary
    ? hasConversationPiEntryPairById(database, { ...input, conversationId: summary.id })
    : false
}

export function hasConversationPiEntryPairById(
  database: DatabaseSync,
  input: {
    conversationId: string
    userPiEntryId: string
    assistantPiEntryId: string
  }
): boolean {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM conversation_messages
      WHERE conversation_id = ? AND pi_entry_id IN (?, ?)
    `)
    .get(input.conversationId, input.userPiEntryId, input.assistantPiEntryId) as { count: number }
  return row.count === 2
}

export function buildConversationContext(
  database: DatabaseSync,
  input: { userId: string; conversationId: string; beforeMessageId?: string }
): ConversationContextMessage[] {
  const summary = getConversationSummary(database, input)
  if (!summary) return []

  const beforeOrder = input.beforeMessageId
    ? readMessageOrder(database, { conversationId: summary.id, messageId: input.beforeMessageId })
    : undefined
  const rows = database
    .prepare(`
      SELECT id, role, content
      FROM conversation_messages
      WHERE conversation_id = ?
        AND (? IS NULL OR message_order < ?)
      ORDER BY message_order ASC
    `)
    .all(summary.id, beforeOrder ?? null, beforeOrder ?? null) as Array<{
      id: string
      role: HistoryMessageRole
      content: string
    }>

  const selected = new Map<string, { id: string; role: HistoryMessageRole; content: string }>()
  for (const row of rows.slice(0, FIRST_CONTEXT_MESSAGES)) {
    selected.set(row.id, row)
  }
  for (const row of rows.slice(-LAST_CONTEXT_MESSAGES)) {
    selected.set(row.id, row)
  }

  return rows.filter((row) => selected.has(row.id)).map((row) => ({ ...row }))
}

export class HistoryRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: 'HISTORY_NOT_FOUND' | 'INVALID_HISTORY_REQUEST'
  ) {
    super(message)
    this.name = 'HistoryRepositoryError'
  }
}

async function resolveInitialTitle(input: PersistCompletedHistoryTurnInput): Promise<{
  title: string
  titleStatus: ConversationTitleStatus
}> {
  const generatedTitle = normalizeGeneratedTitle(input.generatedTitle ?? '')
  if (generatedTitle) {
    return { title: generatedTitle, titleStatus: 'generated' }
  }

  if (!input.titleRunner) {
    return { title: temporaryTitle(input.question), titleStatus: 'pending' }
  }

  try {
    const title = await withTimeout(
      input.titleRunner.generateTitle({
        specialistName: input.specialistName,
        question: input.question,
        answer: input.answer
      }),
      input.titleTimeoutMs ?? DEFAULT_TITLE_TIMEOUT_MS
    )
    const normalized = normalizeGeneratedTitle(title)
    if (normalized) {
      return { title: normalized, titleStatus: 'generated' }
    }
  } catch {
    // Fall through to pending temporary title.
  }

  return { title: temporaryTitle(input.question), titleStatus: 'pending' }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Title generation timed out.')), Math.max(0, timeoutMs))
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function temporaryTitle(question: string): string {
  return normalizeGeneratedTitle(question) || 'Nova conversa'
}

function normalizeGeneratedTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function readNextMessageOrder(database: DatabaseSync, conversationId: string): number {
  const row = database
    .prepare('SELECT COALESCE(MAX(message_order), -1) + 1 AS next_order FROM conversation_messages WHERE conversation_id = ?')
    .get(conversationId) as { next_order: number }
  return row.next_order
}

function readEditableMessageOrder(
  database: DatabaseSync,
  input: { conversationId: string; messageId: string }
): number {
  const row = database
    .prepare(`
      SELECT message_order
      FROM conversation_messages
      WHERE conversation_id = ? AND id = ? AND role = 'user'
      LIMIT 1
    `)
    .get(input.conversationId, input.messageId) as { message_order: number } | undefined

  if (!row) {
    throw new HistoryRepositoryError('Editable user message was not found.', 'HISTORY_NOT_FOUND')
  }

  return row.message_order
}

function readMessageOrder(
  database: DatabaseSync,
  input: { conversationId: string; messageId: string }
): number | undefined {
  const row = database
    .prepare('SELECT message_order FROM conversation_messages WHERE conversation_id = ? AND id = ? LIMIT 1')
    .get(input.conversationId, input.messageId) as { message_order: number } | undefined
  return row?.message_order
}

function deleteMessagesAtOrAfter(
  database: DatabaseSync,
  input: { conversationId: string; messageOrder: number }
): void {
  database
    .prepare('DELETE FROM conversation_messages WHERE conversation_id = ? AND message_order >= ?')
    .run(input.conversationId, input.messageOrder)
}

function insertMessage(
  database: DatabaseSync,
  input: {
    id: string
    conversationId: string
    role: HistoryMessageRole
    content: string
    messageOrder: number
    grounded: boolean | undefined
    piEntryId?: string
    createdAt: string
  }
): void {
  database
    .prepare(`
      INSERT INTO conversation_messages (
        id,
        conversation_id,
        role,
        content,
        message_order,
        grounded,
        pi_entry_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.id,
      input.conversationId,
      input.role,
      input.content,
      input.messageOrder,
      input.grounded === undefined ? null : input.grounded ? 1 : 0,
      input.piEntryId ?? null,
      input.createdAt
    )
}

function insertCitations(database: DatabaseSync, messageId: string, citations: ChatCitation[]): void {
  const insert = database.prepare(`
    INSERT INTO message_citations (
      id,
      message_id,
      source_file,
      source_title,
      article_refs_json,
      shown_order
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)

  citations.forEach((citation, index) => {
    insert.run(
      randomUUID(),
      messageId,
      citation.sourceFile ?? null,
      citation.sourceTitle,
      JSON.stringify(citation.articleRefs),
      index
    )
  })
}

function mapConversationSummary(row: unknown): ConversationSummary {
  const typed = row as ConversationRow
  return {
    id: typed.id,
    userId: typed.user_id,
    specialistId: typed.specialist_id,
    title: typed.title,
    titleStatus: typed.title_status as ConversationTitleStatus,
    createdAt: typed.created_at,
    updatedAt: typed.updated_at
  }
}

function mapHistoryMessage(database: DatabaseSync, row: ConversationMessageRow): HistoryMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.grounded === null ? {} : { grounded: row.grounded === 1 }),
    createdAt: row.created_at,
    citations: readMessageCitations(database, row.id)
  }
}

function readMessageCitations(database: DatabaseSync, messageId: string): ChatCitation[] {
  return database
    .prepare(`
      SELECT source_file, source_title, article_refs_json
      FROM message_citations
      WHERE message_id = ?
      ORDER BY shown_order ASC
    `)
    .all(messageId)
    .map((row) => {
      const typed = row as unknown as CitationRow
      return {
        sourceTitle: typed.source_title,
        ...(typed.source_file ? { sourceFile: typed.source_file } : {}),
        articleRefs: parseArticleRefs(typed.article_refs_json)
      }
    })
}

function parseArticleRefs(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // Ignore malformed citation snapshots.
  }

  return []
}

interface ConversationRow {
  id: string
  user_id: string
  specialist_id: string
  title: string
  title_status: string
  created_at: string
  updated_at: string
}

interface ConversationMessageRow {
  id: string
  role: HistoryMessageRole
  content: string
  grounded: 0 | 1 | null
  created_at: string
}

interface CitationRow {
  source_file: string | null
  source_title: string
  article_refs_json: string
}
