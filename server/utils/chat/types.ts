import type { SpecialistRuntime } from '../specialists/schema'
import type { RetrievalHints } from './retrieval-cache'

export interface ChatCitation {
  sourceTitle: string
  sourceFile?: string
  articleRefs: string[]
}

export interface ChatHistoryEvent {
  type: 'history'
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  title: string
  titleStatus: 'generated' | 'pending'
}

export type ChatAnswerOutcome = 'answered' | 'insufficient_context'

export interface ChatMetricsEvent {
  type: 'metrics'
  totalTokens?: number
}

export interface ChatConversationEvent {
  type: 'conversation'
  conversationId: string
}

export type ChatStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'heartbeat' }
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | ChatMetricsEvent
  | ChatConversationEvent
  | ChatHistoryEvent
  | { type: 'done'; grounded: boolean }
  | { type: 'error'; code: string; message: string }

export type ChatRunnerStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'heartbeat' }
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | { type: 'title'; title: string }
  | ChatMetricsEvent
  | { type: 'done'; grounded: boolean; outcome?: ChatAnswerOutcome; consultedDocuments?: string[] }

export interface ChatConversationContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRunnerInput {
  specialist: SpecialistRuntime
  question: string
  clientTimezone?: string
  citationEvidence: ChatCitation[]
  retrievalHints?: RetrievalHints
  conversationContext?: ChatConversationContextMessage[]
  piSessionManager?: any
}

export interface ChatEngineRun {
  grounded: boolean
  citations: ChatCitation[]
  deltas: AsyncIterable<string>
  events?: AsyncIterable<ChatRunnerStreamEvent>
  outcome?: ChatAnswerOutcome
  consultedDocuments?: string[]
  title?: string
}

export interface ChatEngineRunner {
  run(input: ChatRunnerInput): Promise<ChatEngineRun>
}
