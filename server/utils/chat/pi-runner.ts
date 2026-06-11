import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUjimuFileTools, createUjimuPiSession } from '../pi/session'
import type { ChatCitation, ChatEngineRun, ChatEngineRunner, ChatRunnerInput, ChatRunnerStreamEvent } from './types'

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
        events: runPiChatStreamWithFallback(input, resolvePiChatTimeoutMs())
      }
    }
  }
}

async function* runPiChatStreamWithFallback(
  input: ChatRunnerInput,
  timeoutMs: number
): AsyncIterable<ChatRunnerStreamEvent> {
  let emittedDelta = false

  try {
    for await (const event of runPiChatStream(input, timeoutMs)) {
      if (event.type === 'delta') {
        emittedDelta = true
      }
      yield event
    }
  } catch {
    if (emittedDelta) {
      throw new Error('Pi chat stream failed after answer output started.')
    }

    // Fall back to a deterministic wiki-only answer. The fallback never uses raw files
    // or model knowledge; it only quotes/summarizes already-ingested wiki markdown.
    yield { type: 'status', message: 'A preparar uma resposta a partir do wiki disponível…' }
    yield* chatRunToEvents(await createWikiExtractiveRun(input))
  }
}

async function* runPiChatStream(
  input: ChatRunnerInput,
  timeoutMs: number
): AsyncIterable<ChatRunnerStreamEvent> {
  yield { type: 'status', message: 'A consultar as fontes desta especialidade…' }

  const cwd = input.specialist.paths.root
  const { session } = await createUjimuPiSession({
    cwd,
    task: 'chat',
    tools: await createUjimuFileTools(cwd, ['read', 'grep', 'find', 'ls']),
    fileSystemPolicy: {
      root: cwd,
      read: { directories: ['wiki'] },
      write: { directories: [] },
      list: { directories: ['wiki'] }
    },
    appendSystemPromptOverride: () => [
      'You are the Ujimu consultation agent for one selected specialist.',
      'Answer only from files under wiki/. Do not use raw/ as answer-time source material.',
      'If wiki/ does not support the answer, say that the current context is insufficient.',
      'Every substantive answer must be grounded and cited with backend-allowed citations.',
      'Emit structured NDJSON only. Do not emit Markdown outside NDJSON event payloads.'
    ]
  })

  const queue = new AsyncEventQueue<ChatRunnerStreamEvent>()
  const parser = createPiNdjsonParser((event) => queue.push(event))
  let promptFinished = false
  let sawDone = false
  let timeout: NodeJS.Timeout | undefined

  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      parser.push(event.assistantMessageEvent.delta)
    }
  })

  parser.onDone = () => {
    sawDone = true
  }

  timeout = setTimeout(() => {
    void session.abort().catch(() => undefined)
    queue.fail(new Error(`Pi chat exceeded ${timeoutMs}ms.`))
  }, timeoutMs)

  void session.prompt(buildChatPrompt(input))
    .then(() => {
      parser.flush()
      if (!sawDone) {
        queue.push({ type: 'done', grounded: false })
      }
      queue.close()
    })
    .catch((error: unknown) => {
      queue.fail(error instanceof Error ? error : new Error('Pi chat failed.'))
    })
    .finally(() => {
      promptFinished = true
      if (timeout) clearTimeout(timeout)
    })

  try {
    yield* queue
  } finally {
    unsubscribe?.()
    if (!promptFinished) {
      await session.abort().catch(() => undefined)
    }
    session.dispose()
    if (timeout) clearTimeout(timeout)
  }
}

async function createWikiExtractiveRun(input: ChatRunnerInput): Promise<ChatEngineRun> {
  const citation = input.citationEvidence[0]
  if (!citation) {
    return {
      grounded: false,
      citations: [],
      deltas: toAsyncDeltas(['Ainda não tenho fontes suficientes nesta especialidade para responder com segurança.'])
    }
  }

  const pages = await readWikiPages(input.specialist.paths.wiki)
  const snippets = selectRelevantSnippets(pages, input.question)
  if (snippets.length === 0) {
    return {
      grounded: false,
      citations: [],
      deltas: toAsyncDeltas(['Ainda não tenho fontes suficientes nesta especialidade para responder com segurança.'])
    }
  }

  const answer = [
    'Com base no wiki desta especialidade:',
    '',
    ...snippets.map((snippet) => `- ${snippet}`)
  ].join('\n')

  return {
    grounded: true,
    citations: [citation],
    deltas: toAsyncDeltas([answer])
  }
}

async function* chatRunToEvents(run: ChatEngineRun): AsyncIterable<ChatRunnerStreamEvent> {
  if (run.grounded) {
    for (const citation of run.citations) {
      yield { type: 'citation', citation }
    }
  }

  for await (const text of run.deltas) {
    yield { type: 'delta', text }
  }

  yield { type: 'done', grounded: run.grounded }
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

function createPiNdjsonParser(enqueue: (event: ChatRunnerStreamEvent) => void): {
  push(chunk: string): void
  flush(): void
  onDone?: () => void
} {
  let buffer = ''
  const parser = {
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        parsePiNdjsonLine(line, enqueue, parser)
      }
    },
    flush() {
      if (buffer.trim()) {
        parsePiNdjsonLine(buffer, enqueue, parser)
      }
      buffer = ''
    },
    onDone: undefined as (() => void) | undefined
  }

  return parser
}

function parsePiNdjsonLine(
  line: string,
  enqueue: (event: ChatRunnerStreamEvent) => void,
  parser: { onDone?: () => void }
): void {
  const event = parseJsonLine(line.trim())
  if (!event || typeof event !== 'object') return

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
    enqueue({ type: 'delta', text: event.text })
    return
  }

  if (event.type === 'done') {
    parser.onDone?.()
    enqueue({ type: 'done', grounded: event.grounded === true })
  }
}

interface WikiPageContent {
  path: string
  content: string
}

async function readWikiPages(root: string, relativeRoot = ''): Promise<WikiPageContent[]> {
  const entries = await readdir(join(root, relativeRoot), { withFileTypes: true }).catch(() => [])
  const pages: WikiPageContent[] = []

  for (const entry of entries) {
    const relativePath = join(relativeRoot, entry.name)
    const absolutePath = join(root, relativePath)
    if (entry.isDirectory()) {
      pages.push(...await readWikiPages(root, relativePath))
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const content = await readFile(absolutePath, 'utf8').catch(() => '')
      if (content.trim().length > 0) {
        pages.push({ path: relativePath, content })
      }
    }
  }

  return pages
}

function selectRelevantSnippets(pages: WikiPageContent[], question: string): string[] {
  const queryTerms = tokenize(question)
  const candidates = pages
    .filter((page) => !/(^|\/)index\.md$/u.test(page.path) && !/(^|\/)log\.md$/u.test(page.path))
    .flatMap((page) => splitWikiSections(page.content).map((section) => ({ page, section })))
    .map(({ page, section }) => {
      const block = normalizeSnippet(section)
      return { block, score: scoreSnippet(`${page.path} ${section}`, queryTerms) + scorePagePath(page.path, queryTerms) }
    })
    .filter((candidate) => isUsefulSnippet(candidate.block) && candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.block.length - left.block.length)

  const selected: string[] = []
  for (const candidate of candidates) {
    if (selected.some((snippet) => snippet.includes(candidate.block) || candidate.block.includes(snippet))) continue
    selected.push(candidate.block)
    if (selected.length >= 3) break
  }

  return selected
}

function splitWikiSections(content: string): string[] {
  const sections: string[] = []
  let current: string[] = []

  for (const line of content.split(/\r?\n/u)) {
    if (/^#{1,6}\s+/u.test(line) && current.length > 0) {
      sections.push(current.join('\n'))
      current = [line]
      continue
    }

    current.push(line)
  }

  if (current.length > 0) {
    sections.push(current.join('\n'))
  }

  return sections
}

function isUsefulSnippet(snippet: string): boolean {
  if (snippet.length < 60) return false
  if (snippet.toLowerCase().startsWith('source file:')) return false
  if (/source file:|citation ref:/iu.test(snippet)) return false
  if (/^links\s+/iu.test(snippet)) return false
  if (/^(\[[^\]]+\]\([^\)]+\)\s*)+$/u.test(snippet)) return false
  if (/^from value proposition to scalable business model$/iu.test(snippet)) return false
  return true
}

function scorePagePath(path: string, queryTerms: Set<string>): number {
  const normalizedPath = path.toLowerCase()
  let score = 0
  const boosts: Array<[string[], string, number]> = [
    [['proposta', 'valor', 'cliente', 'problema', 'solucao'], 'value-proposition', 12],
    [['canvas', 'blocos', 'receita', 'custos'], 'business-model-canvas', 14],
    [['modelo', 'negocio', 'business'], 'business-model-canvas', 8],
    [['mvp', 'validacao', 'validar', 'testar', 'pivot', 'aprendizagem'], 'validation-mvp-learning', 14],
    [['escala', 'escalar', 'crescimento', 'growth', 'product', 'market'], 'scaling-product-market-fit-growth', 24]
  ]

  for (const [terms, pathPart, boost] of boosts) {
    if (terms.some((term) => queryTerms.has(term)) && normalizedPath.includes(pathPart)) {
      score += boost
    }
  }

  return score
}

function normalizeSnippet(block: string): string {
  return block
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/^[-*]\s+/gmu, '')
    .replace(/^\d+\.\s+/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function scoreSnippet(snippet: string, queryTerms: Set<string>): number {
  const terms = tokenize(snippet)
  let score = 0
  for (const term of queryTerms) {
    if (terms.has(term)) score += term.length > 5 ? 2 : 1
  }
  return score
}

function tokenize(value: string): Set<string> {
  const stopwords = new Set([
    'a', 'ao', 'as', 'com', 'da', 'de', 'do', 'dos', 'e', 'em', 'entre', 'o', 'os', 'para', 'por',
    'qual', 'quais', 'quando', 'como', 'que', 'uma', 'um', 'the', 'and', 'for', 'with', 'from'
  ])

  return new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter((term) => !stopwords.has(term)) ?? []
  )
}

function resolvePiChatTimeoutMs(): number {
  const configured = Number.parseInt(process.env.UJIMU_PI_CHAT_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : 30_000
}

function buildChatPrompt(input: ChatRunnerInput): string {
  return `Answer the user's question for the selected Ujimu specialist.

Specialist:
- id: ${input.specialist.id}
- name: ${input.specialist.name}

User question:
${input.question}

Conversation context:
${formatConversationContext(input.conversationContext)}

Backend citation allowlist (the only citations you may emit):
${JSON.stringify(input.citationEvidence, null, 2)}

Rules:
1. Use only wiki/ files to answer. You may use read, grep, find, and ls only inside this specialist directory.
2. Do not answer from general model knowledge or raw/ files.
3. Before any answer text, emit exactly one citations event if the wiki supports the answer:
   {"type":"citations","citations":[{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}]}
4. Every citation sourceFile and at least one articleRefs value must match the backend allowlist exactly.
5. Then emit answer chunks as NDJSON delta events:
   {"type":"delta","text":"..."}
6. End with {"type":"done","grounded":true}.
7. If the wiki does not support the answer, emit only:
   {"type":"delta","text":"Ainda não tenho fontes suficientes nesta especialidade para responder com segurança."}
   {"type":"done","grounded":false}
8. If you cannot comply with the citation protocol, emit {"type":"done","grounded":false}.
9. Output NDJSON only: one JSON object per line, no code fence, no prose outside JSON.
`
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

function isCitationLike(value: unknown): value is ChatCitation {
  if (!value || typeof value !== 'object') return false
  const citation = value as ChatCitation
  return typeof citation.sourceTitle === 'string' && Array.isArray(citation.articleRefs)
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}
