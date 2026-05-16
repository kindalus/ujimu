import type { SpecialistRuntime } from '../specialists/schema'

export interface ChatCitation {
  sourceTitle: string
  sourceFile?: string
  articleRefs: string[]
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | { type: 'done'; grounded: boolean }
  | { type: 'error'; code: string; message: string }

export interface ChatRunnerInput {
  specialist: SpecialistRuntime
  question: string
  clientTimezone?: string
  citationEvidence: ChatCitation[]
}

export interface ChatEngineRun {
  grounded: boolean
  citations: ChatCitation[]
  deltas: AsyncIterable<string>
}

export interface ChatEngineRunner {
  run(input: ChatRunnerInput): Promise<ChatEngineRun>
}
