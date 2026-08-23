import type { DatabaseSync } from 'node:sqlite'
import type { SpecialistPathOptions } from '../specialists/paths'
import type { SpecialistRuntime } from '../specialists/schema'
import { canUseSpecialist, resolveSpecialistAccessSubjectFromUser } from '../specialists/access'
import { getSpecialistById } from '../specialists/registry'
import type { QuotaSubject } from '../quota/policy'
import { assertQuotaAllowedWithFallback } from '../quota/usage'
import { recordQuestionAnalyticsEvent, type QuestionAnalyticsOutcome } from '../analytics/questions'
import {
  buildConversationContext,
  getConversationSummary,
  getEditableMessagePiEntryId,
  hasConversationPiEntryPair,
  listConversationMessagesForPi,
  persistCompletedHistoryTurn,
  updateConversationPiEntryMappings,
  type ConversationTitleRunner
} from '../history/repository'
import { normalizeChatCitation } from './citations'
import { getCitationEvidence } from './context'
import { createDefaultChatRunner, isPiChatEnabled } from './pi-runner'
import {
  ChatConversationBusyError,
  ChatConversationExpiredError,
  ChatConversationUnauthorizedError,
  openChatSessionTurn,
  type ChatSessionTurn
} from './session-store'
import {
  ChatRequestError,
  specialistNotFound,
  validateChatRequestBody,
  type ValidatedChatRequest
} from './request'
import type {
  ChatCitation,
  ChatConversationContextMessage,
  ChatEngineRunner,
  ChatRunnerStreamEvent,
  ChatStreamEvent
} from './types'

const STREAM_ERROR_MESSAGE =
  'Ocorreu um erro ao preparar a resposta. Tente novamente dentro de alguns minutos.'

export interface ChatQuotaOptions {
  database: DatabaseSync
  subject: QuotaSubject
  fallbackSubject?: QuotaSubject
  occurredAt?: Date
}

export interface ChatHistoryOptions {
  database: DatabaseSync
  subject: QuotaSubject
  now?: Date
  titleRunner?: ConversationTitleRunner
  titleTimeoutMs?: number
}

export interface ChatAnalyticsOptions {
  database: DatabaseSync
  visitorId?: string
  userId?: string
  now?: Date
}

export interface CreateChatEventStreamOptions extends SpecialistPathOptions {
  runner?: ChatEngineRunner
  piChatEnabled?: boolean
  quota?: ChatQuotaOptions
  history?: ChatHistoryOptions
  analytics?: ChatAnalyticsOptions
  persistentChatSessions?: boolean
  chatSessionDataDir?: string
  chatSessionSecret?: string
  chatSessionNow?: Date
}

export async function createChatEventStreamFromBody(
  body: unknown,
  options: CreateChatEventStreamOptions = {}
): Promise<AsyncIterable<ChatStreamEvent>> {
  const input = validateChatRequestBody(body)
  return createChatEventStream(input, options)
}

export async function createChatEventStream(
  input: ValidatedChatRequest,
  options: CreateChatEventStreamOptions = {}
): Promise<AsyncIterable<ChatStreamEvent>> {
  const specialistId = resolveSpecialistIdForRequest(input, options)
  const specialist = await getSpecialistById(specialistId, options)

  if (!specialist) {
    throw specialistNotFound(specialistId)
  }

  const accessDatabase = options.history?.database ?? options.quota?.database
  const accessUserId = resolveHistoryUserId(options.history)
    ?? (options.quota?.subject.type === 'anonymous' ? undefined : options.quota?.subject.id)
  const accessSubject = resolveSpecialistAccessSubjectFromUser(accessDatabase, accessUserId, { env: process.env })
  if (!canUseSpecialist(specialist, accessSubject)) {
    throw specialistNotFound(specialistId)
  }

  return createChatEventStreamForSpecialist(specialist, input, options)
}

export async function createChatEventStreamForSpecialist(
  specialist: SpecialistRuntime,
  input: ValidatedChatRequest,
  options: CreateChatEventStreamOptions = {}
): Promise<AsyncIterable<ChatStreamEvent>> {
  const historyUserId = resolveHistoryUserId(options.history)
  const piChatEnabled = isPiChatEnabled(options.piChatEnabled)
  const persistentChatSessions = options.persistentChatSessions ?? !options.runner
  const chatSession = persistentChatSessions && piChatEnabled
    ? await preparePersistentChatSession(specialist, input, options, historyUserId)
    : undefined

  try {
    if (options.quota) {
      assertQuotaAllowedWithFallback(options.quota.database, {
        primary: {
          subject: options.quota.subject,
          specialistId: specialist.id,
          userTimezone: input.clientTimezone,
          occurredAt: options.quota.occurredAt
        },
        fallback: options.quota.fallbackSubject
          ? {
              subject: options.quota.fallbackSubject,
              specialistId: specialist.id,
              userTimezone: input.clientTimezone,
              occurredAt: options.quota.occurredAt
            }
          : undefined
      })
    }

    if (chatSession && historyUserId && chatSession.rehydratedMappings.length > 0) {
      updateConversationPiEntryMappings(options.history!.database, {
        userId: historyUserId,
        conversationId: chatSession.internalConversationId,
        mappings: chatSession.rehydratedMappings
      })
    }

    const conversationContext = !chatSession && historyUserId
      ? buildRunnerConversationContext(options.history?.database, {
          userId: historyUserId,
          conversationId: input.conversationId,
          beforeMessageId: input.replaceFromMessageId
        })
      : undefined
    const historyPersistence = historyUserId
      ? {
          database: options.history!.database,
          userId: historyUserId,
          specialistId: specialist.id,
          specialistName: specialist.name,
          conversationId: chatSession?.internalConversationId ?? input.conversationId,
          createConversationIfMissing: Boolean(chatSession && !input.conversationId),
          replaceFromMessageId: input.replaceFromMessageId,
          question: input.question,
          titleRunner: options.history!.titleRunner,
          titleTimeoutMs: options.history!.titleTimeoutMs,
          now: options.history!.now
        }
      : undefined

    const citationEvidence = await getCitationEvidence(specialist)
    await chatSession?.beginTurn()

    const runner = options.runner ?? createDefaultChatRunner(piChatEnabled)
    const runnerInput = {
      specialist,
      question: input.question,
      ...(input.clientTimezone ? { clientTimezone: input.clientTimezone } : {}),
      citationEvidence,
      ...(conversationContext && conversationContext.length > 0 ? { conversationContext } : {}),
      ...(chatSession ? { piSessionManager: chatSession.manager } : {})
    }

    return streamChatWithRunner({
      runner,
      runnerInput,
      history: historyPersistence,
      chatSession,
      answeredAnalytics: buildAnalyticsPersistence('answered')
    })
  } catch (error) {
    await chatSession?.rollback().catch(() => undefined)
    chatSession?.release()
    throw error
  }

  function buildAnalyticsPersistence(outcome: QuestionAnalyticsOutcome): StreamAnalyticsPersistence | undefined {
    if (!options.analytics) return undefined

    return {
      database: options.analytics.database,
      specialistId: specialist.id,
      outcome,
      question: input.question,
      userTimezone: input.clientTimezone,
      visitorId: options.analytics.visitorId,
      userId: options.analytics.userId,
      now: options.analytics.now
    }
  }
}

async function preparePersistentChatSession(
  specialist: SpecialistRuntime,
  input: ValidatedChatRequest,
  options: CreateChatEventStreamOptions,
  historyUserId: string | undefined
): Promise<ChatSessionTurn> {
  const database = options.history?.database
  const replaceFromPiEntryId = historyUserId && database && input.conversationId && input.replaceFromMessageId
    ? getEditableMessagePiEntryId(database, {
        userId: historyUserId,
        conversationId: input.conversationId,
        messageId: input.replaceFromMessageId
      })
    : undefined

  try {
    return await openChatSessionTurn({
      cwd: specialist.paths.root,
      ...(options.chatSessionDataDir ? { dataDir: options.chatSessionDataDir } : {}),
      ...(options.chatSessionSecret ? { secret: options.chatSessionSecret } : {}),
      ...(options.chatSessionNow ? { now: options.chatSessionNow } : {}),
      specialistId: specialist.id,
      identity: historyUserId ? { type: 'registered', userId: historyUserId } : { type: 'anonymous' },
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(replaceFromPiEntryId ? { replaceFromPiEntryId } : {}),
      ...(input.replaceFromMessageId && !replaceFromPiEntryId ? { reconstructFromHistory: true } : {}),
      ...(historyUserId && database && input.conversationId
        ? {
            loadRehydrationMessages: () => listConversationMessagesForPi(database, {
              userId: historyUserId,
              conversationId: input.conversationId!,
              beforeMessageId: input.replaceFromMessageId
            })
          }
        : {}),
      ...(historyUserId && database && input.conversationId
        ? {
            isPersistedEntryPair: (entryIds: { userPiEntryId: string; assistantPiEntryId: string }) =>
              hasConversationPiEntryPair(database, {
                userId: historyUserId,
                conversationId: input.conversationId!,
                ...entryIds
              })
          }
        : {})
    })
  } catch (error) {
    if (error instanceof ChatConversationBusyError) {
      throw new ChatRequestError(409, 'CONVERSATION_BUSY', 'Conversation already has an active request.')
    }
    if (error instanceof ChatConversationExpiredError || error instanceof ChatConversationUnauthorizedError) {
      throw new ChatRequestError(404, 'HISTORY_NOT_FOUND', 'Conversation was not found.')
    }
    throw error
  }
}

function resolveSpecialistIdForRequest(
  input: ValidatedChatRequest,
  options: CreateChatEventStreamOptions
): string {
  const userId = resolveHistoryUserId(options.history)
  if (!userId || !input.conversationId || !options.history) {
    return input.specialistId
  }

  const conversation = getConversationSummary(options.history.database, {
    userId,
    conversationId: input.conversationId
  })

  if (!conversation) {
    throw new ChatRequestError(404, 'HISTORY_NOT_FOUND', 'Conversation was not found.')
  }

  return conversation.specialistId
}

function resolveHistoryUserId(history: ChatHistoryOptions | undefined): string | undefined {
  if (!history || history.subject.type === 'anonymous') return undefined
  return history.subject.id
}

function buildRunnerConversationContext(
  database: DatabaseSync | undefined,
  input: { userId: string; conversationId?: string; beforeMessageId?: string }
): ChatConversationContextMessage[] | undefined {
  if (!database || !input.conversationId) return undefined

  return buildConversationContext(database, {
    userId: input.userId,
    conversationId: input.conversationId,
    beforeMessageId: input.beforeMessageId
  }).map((message) => ({ role: message.role, content: message.content }))
}

function normalizeCitations(citations: ChatCitation[]): ChatCitation[] {
  return citations
    .map(normalizeChatCitation)
    .filter((citation): citation is ChatCitation => Boolean(citation))
}

function normalizeTotalTokens(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

function streamChatWithRunner(input: {
  runner: ChatEngineRunner
  runnerInput: Parameters<ChatEngineRunner['run']>[0]
  history?: StreamHistoryPersistence
  chatSession?: ChatSessionTurn
  answeredAnalytics?: StreamAnalyticsPersistence
}): AsyncIterable<ChatStreamEvent> {
  return (async function* () {
    try {
      const result = await input.runner.run(input.runnerInput)

      if (result.events) {
        yield* streamRunnerEventResult({
          events: result.events,
          history: input.history,
          chatSession: input.chatSession,
          answeredAnalytics: input.answeredAnalytics
        })
        return
      }

      const citations = normalizeCitations(result.citations)

      yield* streamRunnerResult({
        grounded: result.grounded,
        citations: result.grounded ? citations : [],
        deltas: result.deltas,
        history: input.history,
        chatSession: input.chatSession,
        analytics: result.grounded ? input.answeredAnalytics : undefined,
        title: result.title
      })
    } finally {
      await input.chatSession?.rollback().catch(() => undefined)
      input.chatSession?.release()
    }
  })()
}

interface StreamHistoryPersistence {
  database: DatabaseSync
  userId: string
  specialistId: string
  specialistName: string
  conversationId?: string
  createConversationIfMissing?: boolean
  replaceFromMessageId?: string
  question: string
  titleRunner?: ConversationTitleRunner
  titleTimeoutMs?: number
  now?: Date
}

interface StreamAnalyticsPersistence {
  database: DatabaseSync
  specialistId: string
  outcome: QuestionAnalyticsOutcome
  question: string
  userTimezone?: string
  visitorId?: string
  userId?: string
  now?: Date
}

async function* streamRunnerEventResult(input: {
  events: AsyncIterable<ChatRunnerStreamEvent>
  history?: StreamHistoryPersistence
  chatSession?: ChatSessionTurn
  answeredAnalytics?: StreamAnalyticsPersistence
}): AsyncIterable<ChatStreamEvent> {
  let answer = ''
  const receivedCitations: ChatCitation[] = []
  let citations: ChatCitation[] = []
  let sawDone = false
  let grounded = false
  let totalTokens: number | undefined
  let title: string | undefined

  try {
    for await (const event of withHeartbeat(input.events)) {
      if (event.type === 'status' || event.type === 'heartbeat') {
        yield event
        continue
      }

      if (event.type === 'citation') {
        receivedCitations.push(event.citation)
        citations = normalizeCitations(receivedCitations)
        continue
      }

      if (event.type === 'delta') {
        answer += event.text
        yield { type: 'delta', text: event.text }
        continue
      }

      if (event.type === 'metrics') {
        totalTokens = normalizeTotalTokens(event.totalTokens) ?? totalTokens
        continue
      }

      if (event.type === 'title') {
        title = event.title
        continue
      }

      sawDone = true
      grounded = event.grounded
      break
    }

    if (!sawDone) {
      throw new Error('Runner stream ended without a done event.')
    }

    if (!grounded) {
      citations = []
    }

    yield* completeStreamResult({
      answer,
      grounded,
      citations: grounded ? citations : [],
      ...(totalTokens ? { totalTokens } : {}),
      history: input.history,
      chatSession: input.chatSession,
      analytics: grounded ? input.answeredAnalytics : undefined,
      title
    })
  } catch {
    yield { type: 'error', code: 'CHAT_STREAM_FAILED', message: STREAM_ERROR_MESSAGE }
    yield { type: 'done', grounded: false }
  }
}

async function* withHeartbeat(
  events: AsyncIterable<ChatRunnerStreamEvent>,
  intervalMs = 5_000
): AsyncIterable<ChatRunnerStreamEvent | { type: 'heartbeat' }> {
  const iterator = events[Symbol.asyncIterator]()
  let next = iterator.next()

  try {
    while (true) {
      const result = await Promise.race([
        next.then((value) => ({ type: 'next' as const, value })),
        delay(intervalMs).then(() => ({ type: 'heartbeat' as const }))
      ])

      if (result.type === 'heartbeat') {
        yield { type: 'heartbeat' }
        continue
      }

      if (result.value.done) {
        break
      }

      yield result.value.value
      next = iterator.next()
    }
  } finally {
    await iterator.return?.()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function* streamRunnerResult(input: {
  grounded: boolean
  citations: ChatCitation[]
  deltas: AsyncIterable<string>
  history?: StreamHistoryPersistence
  chatSession?: ChatSessionTurn
  analytics?: StreamAnalyticsPersistence
  title?: string
}): AsyncIterable<ChatStreamEvent> {
  let answer = ''

  try {
    for await (const text of input.deltas) {
      if (text.length > 0) {
        answer += text
        yield { type: 'delta', text }
      }
    }

    yield* completeStreamResult({
      answer,
      grounded: input.grounded,
      citations: input.citations,
      history: input.history,
      chatSession: input.chatSession,
      analytics: input.analytics,
      title: input.title
    })
  } catch {
    yield { type: 'error', code: 'CHAT_STREAM_FAILED', message: STREAM_ERROR_MESSAGE }
    yield { type: 'done', grounded: false }
  }
}

async function* completeStreamResult(input: {
  answer: string
  grounded: boolean
  citations: ChatCitation[]
  totalTokens?: number
  history?: StreamHistoryPersistence
  chatSession?: ChatSessionTurn
  analytics?: StreamAnalyticsPersistence
  title?: string
}): AsyncIterable<ChatStreamEvent> {
  for (const citation of input.citations) {
    yield { type: 'citation', citation }
  }

  let persisted: Awaited<ReturnType<typeof persistCompletedHistoryTurn>> | undefined
  const piEntryIds = input.chatSession
    ? await input.chatSession.captureCompletedEntryIds({ now: input.history?.now })
    : undefined

  if (input.history) {
    persisted = await persistCompletedHistoryTurn(input.history.database, {
      userId: input.history.userId,
      specialistId: input.history.specialistId,
      specialistName: input.history.specialistName,
      ...(input.history.conversationId ? { conversationId: input.history.conversationId } : {}),
      ...(input.history.createConversationIfMissing ? { createConversationIfMissing: true } : {}),
      ...(input.history.replaceFromMessageId ? { replaceFromMessageId: input.history.replaceFromMessageId } : {}),
      ...(piEntryIds ? {
        userPiEntryId: piEntryIds.userPiEntryId,
        assistantPiEntryId: piEntryIds.assistantPiEntryId
      } : {}),
      question: input.history.question,
      answer: input.answer,
      grounded: input.grounded,
      citations: input.citations,
      ...(input.history.now ? { now: input.history.now } : {}),
      ...(input.history.titleRunner ? { titleRunner: input.history.titleRunner } : {}),
      ...(input.title ? { generatedTitle: input.title } : {}),
      ...(input.history.titleTimeoutMs !== undefined ? { titleTimeoutMs: input.history.titleTimeoutMs } : {})
    })
  }

  const sessionCommit = input.chatSession
    ? await input.chatSession.commit({ now: input.history?.now })
    : undefined

  if (persisted) {
    yield {
      type: 'history',
      conversationId: persisted.conversationId,
      userMessageId: persisted.userMessageId,
      assistantMessageId: persisted.assistantMessageId,
      title: persisted.title,
      titleStatus: persisted.titleStatus
    }
  }

  if (sessionCommit) {
    yield { type: 'conversation', conversationId: sessionCommit.conversationId }
  }

  if (input.analytics) {
    recordQuestionAnalyticsEvent(input.analytics.database, {
      specialistId: input.analytics.specialistId,
      outcome: input.analytics.outcome,
      question: input.analytics.question,
      userTimezone: input.analytics.userTimezone,
      visitorId: input.analytics.visitorId,
      userId: input.analytics.userId,
      conversationId: persisted?.conversationId,
      userMessageId: persisted?.userMessageId,
      occurredAt: input.analytics.now
    })
  }

  const totalTokens = normalizeTotalTokens(input.totalTokens)
  if (totalTokens) {
    yield { type: 'metrics', totalTokens }
  }

  yield {
    type: 'done',
    grounded: input.grounded
  }
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}
