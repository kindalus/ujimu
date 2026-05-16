import type { SpecialistPathOptions } from '../specialists/paths'
import type { SpecialistRuntime } from '../specialists/schema'
import { getSpecialistById } from '../specialists/registry'
import { normalizeChatCitation } from './citations'
import { getCitationEvidence } from './context'
import { createDefaultChatRunner, isPiChatEnabled } from './pi-runner'
import {
  specialistNotFound,
  validateChatRequestBody,
  type ValidatedChatRequest
} from './request'
import type { ChatCitation, ChatEngineRunner, ChatStreamEvent } from './types'

const INSUFFICIENT_EVIDENCE_MESSAGE =
  'Ainda não tenho fontes oficiais suficientes nesta especialidade para responder com segurança. Para poder responder, será necessário acrescentar uma fonte oficial relevante, por exemplo o diploma, regulamento, instrução administrativa ou artigo aplicável à pergunta.'

const MISSING_CITATIONS_MESSAGE =
  'Não consigo apresentar uma resposta com fontes suficientes para esta pergunta. Para responder com segurança, preciso de uma fonte oficial citável, como o diploma, regulamento, instrução administrativa ou artigo aplicável.'

const STREAM_ERROR_MESSAGE =
  'Ocorreu um erro ao preparar a resposta. Tente novamente dentro de alguns minutos.'

export interface CreateChatEventStreamOptions extends SpecialistPathOptions {
  runner?: ChatEngineRunner
  piChatEnabled?: boolean
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
  const specialist = await getSpecialistById(input.specialistId, options)

  if (!specialist) {
    throw specialistNotFound(input.specialistId)
  }

  return createChatEventStreamForSpecialist(specialist, input, options)
}

export async function createChatEventStreamForSpecialist(
  specialist: SpecialistRuntime,
  input: ValidatedChatRequest,
  options: CreateChatEventStreamOptions = {}
): Promise<AsyncIterable<ChatStreamEvent>> {
  const citationEvidence = await getCitationEvidence(specialist)

  if (citationEvidence.length === 0) {
    return fallbackStream(INSUFFICIENT_EVIDENCE_MESSAGE)
  }

  const runner = options.runner ?? createDefaultChatRunner(isPiChatEnabled(options.piChatEnabled))
  const result = await runner.run({
    specialist,
    question: input.question,
    ...(input.clientTimezone ? { clientTimezone: input.clientTimezone } : {}),
    citationEvidence
  })
  const citations = normalizeCitations(result.citations)

  if (result.grounded && citations.length === 0) {
    return fallbackStream(MISSING_CITATIONS_MESSAGE)
  }

  return streamRunnerResult({
    grounded: result.grounded,
    citations: result.grounded ? citations : [],
    deltas: result.deltas
  })
}

function normalizeCitations(citations: ChatCitation[]): ChatCitation[] {
  return citations
    .map(normalizeChatCitation)
    .filter((citation): citation is ChatCitation => Boolean(citation))
}

function fallbackStream(message: string): AsyncIterable<ChatStreamEvent> {
  return streamRunnerResult({
    grounded: false,
    citations: [],
    deltas: toAsyncDeltas([message])
  })
}

async function* streamRunnerResult(input: {
  grounded: boolean
  citations: ChatCitation[]
  deltas: AsyncIterable<string>
}): AsyncIterable<ChatStreamEvent> {
  try {
    for await (const text of input.deltas) {
      if (text.length > 0) {
        yield { type: 'delta', text }
      }
    }

    for (const citation of input.citations) {
      yield { type: 'citation', citation }
    }

    yield { type: 'done', grounded: input.grounded }
  } catch {
    yield { type: 'error', code: 'CHAT_STREAM_FAILED', message: STREAM_ERROR_MESSAGE }
    yield { type: 'done', grounded: false }
  }
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}
