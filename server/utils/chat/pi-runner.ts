import { createUjimuFileTools, createUjimuPiSession } from '../pi/session'
import type { ChatCitation, ChatEngineRun, ChatEngineRunner, ChatRunnerInput } from './types'

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
      return runPiChat(input)
    }
  }
}

async function runPiChat(input: ChatRunnerInput): Promise<ChatEngineRun> {
  const cwd = input.specialist.paths.root
  const { session } = await createUjimuPiSession({
    cwd,
    task: 'chat',
    tools: await createUjimuFileTools(cwd, ['read', 'grep', 'find', 'ls']),
    appendSystemPromptOverride: () => [
      'You are the Ujimu consultation agent for one selected specialist.',
      'Answer only from files under wiki/. Do not use raw/ as answer-time source material.',
      'If wiki/ does not support the answer, say that the current context is insufficient.',
      'Every substantive answer must be grounded and cited with backend-allowed citations.',
      'Emit structured NDJSON only. Do not emit Markdown outside NDJSON event payloads.'
    ]
  })

  let output = ''
  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      output += event.assistantMessageEvent.delta
    }
  })

  try {
    await session.prompt(buildChatPrompt(input))
    return parseNdjsonRun(output)
  } finally {
    unsubscribe?.()
    session.dispose()
  }
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

function parseNdjsonRun(output: string): ChatEngineRun {
  const citations: ChatCitation[] = []
  const deltas: string[] = []
  let grounded = false
  let sawDone = false

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const event = parseJsonLine(line)
    if (!event || typeof event !== 'object') {
      continue
    }

    if (event.type === 'citations' && Array.isArray(event.citations)) {
      citations.push(...event.citations.filter(isCitationLike))
      continue
    }

    if (event.type === 'delta' && typeof event.text === 'string') {
      deltas.push(event.text)
      continue
    }

    if (event.type === 'done') {
      sawDone = true
      grounded = event.grounded === true
    }
  }

  if (!sawDone) {
    return {
      grounded: false,
      citations: [],
      deltas: toAsyncDeltas([SERVICE_UNAVAILABLE_MESSAGE])
    }
  }

  return {
    grounded,
    citations: grounded ? citations : [],
    deltas: toAsyncDeltas(deltas)
  }
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
