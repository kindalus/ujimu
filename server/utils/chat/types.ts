import type { SpecialistRuntime } from '../specialists/schema'

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

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | ChatHistoryEvent
  | { type: 'done'; grounded: boolean }
  | { type: 'error'; code: string; message: string }

export interface ChatConversationContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRunnerInput {
  specialist: SpecialistRuntime
  question: string
  clientTimezone?: string
  citationEvidence: ChatCitation[]
  conversationContext?: ChatConversationContextMessage[]
}

export interface ChatEngineRun {
  grounded: boolean
  citations: ChatCitation[]
  deltas: AsyncIterable<string>
}

export interface ChatEngineRunner {
  run(input: ChatRunnerInput): Promise<ChatEngineRun>
}
