import { createUjimuPiSession } from '../pi/session'
import type { ChatCitation, ChatEngineRunner, ChatRunnerInput, ChatRunnerStreamEvent } from './types'

const SERVICE_UNAVAILABLE_MESSAGE =
  'O serviço de resposta está temporariamente indisponível. Tente novamente dentro de alguns minutos.'

export function isPiChatEnabled(option: boolean | undefined): boolean {
  return option ?? process.env.UJIMU_PI_CHAT_ENABLED === 'true'
}

export function createDefaultChatRunner(piChatEnabled: boolean): ChatEngineRunner {
  return piChatEnabled ? createPiChatRunner() : createUnavailableChatRunner()
}

export function createUnavailableChatRunner(message = SERVICE_UNAVAILABLE_MESSAGE): ChatEngineRunner {
  return {
    async run() {
      return {
        grounded: false,
        citations: [],
        deltas: toAsyncDeltas([message])
      }
    }
  }
}

export function createPiChatRunner(): ChatEngineRunner {
  return {
    async run(input) {
      return {
        grounded: false,
        citations: [],
        deltas: toAsyncDeltas([]),
        events: runPiChatStream(input)
      }
    }
  }
}

async function* runPiChatStream(input: ChatRunnerInput): AsyncIterable<ChatRunnerStreamEvent> {
  yield { type: 'status', message: 'A consultar as fontes desta especialidade…' }

  const cwd = input.specialist.paths.root
  const { session } = await createUjimuPiSession({
    cwd,
    task: 'chat',
    ...(input.piSessionManager ? { sessionManager: input.piSessionManager } : {})
  })

  const queue = new AsyncEventQueue<ChatRunnerStreamEvent>()
  let rawAssistantText = ''
  let finalAssistantText = ''
  let finalTotalTokens: number | undefined
  let promptFinished = false
  let sawTerminalEvent = false
  let emittedAssistantOutput = false
  let assistantFailure: Error | undefined
  let pendingDoneEvent: Extract<ChatRunnerStreamEvent, { type: 'done' }> | undefined

  const parser = createPiOutputParser((event) => {
    if (event.type === 'done') {
      sawTerminalEvent = true
      pendingDoneEvent = event
      return
    }

    emittedAssistantOutput = true
    queue.push(event)
  })

  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const delta = typeof event.assistantMessageEvent.delta === 'string' ? event.assistantMessageEvent.delta : ''
      rawAssistantText += delta
      parser.push(delta)
      return
    }

    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_end') {
      if (typeof event.assistantMessageEvent.content === 'string') {
        finalAssistantText = event.assistantMessageEvent.content
      }
      return
    }

    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'done') {
      finalTotalTokens = extractTotalTokens(event.assistantMessageEvent.message) ?? finalTotalTokens
      return
    }

    if (event?.type === 'message_end') {
      if (event.message?.role !== 'assistant') return
      assistantFailure = extractAssistantFailure(event.message)
      finalAssistantText = extractAssistantText(event.message) || finalAssistantText
      finalTotalTokens = extractTotalTokens(event.message) ?? finalTotalTokens
      return
    }

    if (event?.type === 'agent_end') {
      assistantFailure = extractLatestAssistantFailure(event.messages)
      finalAssistantText = extractLatestAssistantText(event.messages) || finalAssistantText
      finalTotalTokens = extractLatestAssistantTotalTokens(event.messages) ?? finalTotalTokens
    }
  })

  void session.prompt(buildChatPrompt(input))
    .then(() => {
      if (assistantFailure) throw assistantFailure

      if (!rawAssistantText && finalAssistantText) {
        parser.push(finalAssistantText)
      }
      parser.flush()

      const assistantText = finalAssistantText || rawAssistantText
      if (!emittedAssistantOutput && assistantText.trim().length > 0) {
        queue.push({ type: 'delta', text: assistantText })
        emittedAssistantOutput = true
      }

      if (finalTotalTokens) {
        queue.push({ type: 'metrics', totalTokens: finalTotalTokens })
      }

      if (pendingDoneEvent) {
        queue.push(pendingDoneEvent)
      } else if (!sawTerminalEvent) {
        queue.push({ type: 'done', grounded: emittedAssistantOutput })
      }
      queue.close()
    })
    .catch((error: unknown) => {
      queue.fail(error instanceof Error ? error : new Error('Pi chat failed.'))
    })
    .finally(() => {
      promptFinished = true
    })

  try {
    yield* queue
  } finally {
    unsubscribe?.()
    if (!promptFinished) {
      await session.abort().catch(() => undefined)
    }
    session.dispose()
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }> = []
  private closed = false
  private error: unknown

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true })
    }
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.error = error
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close()
        return { value: undefined, done: true }
      }
    }
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      return Promise.resolve({ value: this.values.shift()!, done: false })
    }
    if (this.error) {
      return Promise.reject(this.error)
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }
}

function createPiOutputParser(enqueue: (event: ChatRunnerStreamEvent) => void): {
  push(chunk: string): void
  flush(): void
} {
  let buffer = ''
  let textMode: 'plain' | 'structured' | undefined
  let primaryText = ''
  let deferredText = ''

  const enqueueText = (mode: 'plain' | 'structured', text: string) => {
    if (!textMode) {
      if (!text.trim()) return
      textMode = mode
    }

    if (mode === textMode) {
      primaryText += text
      enqueue({ type: 'delta', text })
      return
    }

    deferredText += text
  }

  return {
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        parsePiOutputLine(line, true, enqueue, enqueueText)
      }
    },
    flush() {
      if (buffer.length > 0) {
        parsePiOutputLine(buffer, false, enqueue, enqueueText)
      }
      if (
        deferredText.trim() &&
        normalizeOutputText(deferredText) !== normalizeOutputText(primaryText)
      ) {
        enqueue({ type: 'delta', text: deferredText })
      }
      buffer = ''
    }
  }
}

function parsePiOutputLine(
  line: string,
  hadTrailingNewline: boolean,
  enqueue: (event: ChatRunnerStreamEvent) => void,
  enqueueText: (mode: 'plain' | 'structured', text: string) => void
): void {
  const trimmed = line.trim()
  if (!trimmed) {
    if (hadTrailingNewline || line.length > 0) enqueueText('plain', hadTrailingNewline ? `${line}\n` : line)
    return
  }

  const event = parseJsonLine(trimmed)
  if (!event || typeof event !== 'object') {
    if (/^[\[{]/u.test(trimmed)) return
    enqueueText('plain', hadTrailingNewline ? `${line}\n` : line)
    return
  }

  if (event.type === 'citations' && Array.isArray(event.citations)) {
    for (const citation of event.citations.filter(isCitationLike)) {
      enqueue({ type: 'citation', citation })
    }
    return
  }

  if (event.type === 'citation' && isCitationLike(event.citation)) {
    enqueue({ type: 'citation', citation: event.citation })
    return
  }

  if (event.type === 'delta' && typeof event.text === 'string') {
    enqueueText('structured', event.text)
    return
  }

  if (event.type === 'metrics') {
    const totalTokens = typeof event.totalTokens === 'number' && Number.isFinite(event.totalTokens) && event.totalTokens > 0
      ? Math.trunc(event.totalTokens)
      : undefined
    if (totalTokens) {
      enqueue({ type: 'metrics', totalTokens })
    }
    return
  }

  if (event.type === 'done') {
    enqueue({ type: 'done', grounded: event.grounded !== false })
  }
}

function normalizeOutputText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ')
}

export function buildChatPrompt(input: ChatRunnerInput): string {
  return `Answer the user question using this specialist workspace.

The current working directory is the specialist root. Use the available tools normally.
If you include machine-readable citations, emit them as JSON lines in one of these optional shapes:
{"type":"citations","citations":[{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}]}
{"type":"citation","citation":{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}}
Otherwise answer in plain text; missing or malformed citations will simply be omitted by Ujimu.

Known citation metadata, if useful:
${formatCitationEvidence(input.citationEvidence)}

User question:
${input.question}

Conversation context:
${formatConversationContext(input.conversationContext)}
`
}

function formatCitationEvidence(citations: ChatRunnerInput['citationEvidence']): string {
  if (citations.length === 0) {
    return '(none)'
  }

  return citations.map((citation) => JSON.stringify(citation)).join('\n')
}

function formatConversationContext(context: ChatRunnerInput['conversationContext']): string {
  if (!context || context.length === 0) {
    return '(none)'
  }

  return context
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n')
}

function parseJsonLine(line: string): any | undefined {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function extractAssistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractLatestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if ((message as { role?: unknown })?.role === 'assistant') {
      const text = extractAssistantText(message)
      if (text) return text
    }
  }

  return ''
}

function extractAssistantFailure(message: unknown): Error | undefined {
  const assistant = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown }
  if (assistant?.role !== 'assistant' || assistant.stopReason !== 'error') return undefined
  return new Error(typeof assistant.errorMessage === 'string' ? assistant.errorMessage : 'Pi assistant failed.')
}

function extractLatestAssistantFailure(messages: unknown): Error | undefined {
  if (!Array.isArray(messages)) return undefined

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if ((messages[index] as { role?: unknown })?.role === 'assistant') {
      return extractAssistantFailure(messages[index])
    }
  }

  return undefined
}

function extractTotalTokens(message: unknown): number | undefined {
  const totalTokens = (message as { usage?: { totalTokens?: unknown } })?.usage?.totalTokens
  if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens <= 0) return undefined
  return Math.trunc(totalTokens)
}

function extractLatestAssistantTotalTokens(messages: unknown): number | undefined {
  if (!Array.isArray(messages)) return undefined

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if ((message as { role?: unknown })?.role === 'assistant') {
      const totalTokens = extractTotalTokens(message)
      if (totalTokens) return totalTokens
    }
  }

  return undefined
}

function isCitationLike(value: unknown): value is ChatCitation {
  if (!value || typeof value !== 'object') return false
  const citation = value as ChatCitation
  return (
    typeof citation.sourceTitle === 'string' &&
    (citation.sourceFile === undefined || typeof citation.sourceFile === 'string') &&
    Array.isArray(citation.articleRefs)
  )
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}
