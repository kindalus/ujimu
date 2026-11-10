import type { SpecialistRuntime } from '../specialists/schema'
import type { RetrievalHints } from './retrieval-cache'
import type { WikiExcerpts } from './wiki-excerpts'

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
  | {
      type: 'done'
      grounded: boolean
      outcome?: ChatAnswerOutcome
      /** Wiki pages the answer drew on: excerpt pages plus files read. */
      consultedDocuments?: string[]
      /** Wiki files read during the answer; equal to consultedDocuments when absent. */
      readDocuments?: string[]
    }

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
  wikiExcerpts?: WikiExcerpts
  blockedWikiPaths?: string[]
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
