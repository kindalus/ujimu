import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import { serializeChatEvent } from '../server/utils/chat/ndjson'
import { buildChatPrompt } from '../server/utils/chat/pi-runner'
import type { ChatEngineRunner, ChatRunnerStreamEvent, ChatStreamEvent } from '../server/utils/chat/types'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('specialist chat streaming and citations acceptance', () => {
  it('serializes chat events as newline-delimited JSON', () => {
    expect(serializeChatEvent({ type: 'delta', text: 'Olá' })).toBe(
      '{"type":"delta","text":"Olá"}\n'
    )
  })

  it('rejects invalid chat requests before a stream starts', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')

    await expect(
      createChatEventStreamFromBody(
        { specialistId: 'iva', question: '   ' },
        { specialtiesRoot, runner: fakeRunner() }
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CHAT_REQUEST' })

    await expect(
      createChatEventStreamFromBody(
        { specialistId: 'missing', question: 'O que diz o Artigo 1.º?' },
        { specialtiesRoot, runner: fakeRunner() }
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'SPECIALIST_NOT_FOUND' })
  })

  it('does not block answers when citations are required but no usable evidence exists', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    const calls: string[] = []

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Posso deduzir este IVA?' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: fakeRunner(() => {
            calls.push('called')
          })
        }
      )
    )

    expect(calls).toEqual(['called'])
    expect(joinDeltas(events)).toContain('Resposta fundamentada.')
    expect(events.some((event) => event.type === 'citation')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('does not block uncited answers when the specialist does not require citations', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva', { citationsRequired: false })
    const calls: string[] = []

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Escreve uma convocatória.' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: {
            async run() {
              calls.push('called')
              return {
                grounded: true,
                citations: [],
                deltas: toAsyncDeltas(['Convocatória sem citações obrigatórias.'])
              }
            }
          }
        }
      )
    )

    expect(calls).toEqual(['called'])
    expect(joinDeltas(events)).toBe('Convocatória sem citações obrigatórias.')
    expect(events.some((event) => event.type === 'citation')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('streams grounded runner deltas and renders citations at the end', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot)
    const receivedQuestions: string[] = []

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: '  O que diz o Artigo 1.º?  ' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: fakeRunner(async function* (input) {
            receivedQuestions.push(input.question)
            yield* ['O Artigo 1.º ', 'define o âmbito do imposto.']
          })
        }
      )
    )

    expect(receivedQuestions).toEqual(['O que diz o Artigo 1.º?'])
    expect(events.map((event) => event.type)).toEqual(['delta', 'delta', 'citation', 'done'])
    expect(events[2]).toEqual({
      type: 'citation',
      citation: {
        sourceTitle: 'Código do IVA',
        sourceFile: 'raw/codigo-iva.original.md',
        articleRefs: ['Artigo 1.º']
      }
    })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('uses the source title as citation detail when an ingested non-article source has no article refs', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot, {
      articleRefs: []
    })

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Qual é o valor do projecto?' },
        { specialtiesRoot, piChatEnabled: true, runner: fakeRunner() }
      )
    )

    expect(events.map((event) => event.type)).toEqual(['delta', 'citation', 'done'])
    expect(events[1]).toEqual({
      type: 'citation',
      citation: {
        sourceTitle: 'Código do IVA',
        sourceFile: 'raw/codigo-iva.original.md',
        articleRefs: ['Código do IVA']
      }
    })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('accepts narrower article refs from any validated citation record for the same source file', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot, {
      citations: [
        { sourceTitle: 'IPP', articleRefs: ['IPP Artigo 109.º'] },
        { sourceTitle: 'Texto da Pauta', articleRefs: ['Capítulos 1 a 97'] }
      ]
    })

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'Classifica whey isolada.' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: {
            async run() {
              return {
                grounded: false,
                citations: [],
                deltas: toAsyncDeltas([]),
                events: toAsyncEvents([
                  {
                    type: 'citation',
                    citation: { sourceTitle: 'Pauta Aduaneira', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 109.º'] }
                  },
                  { type: 'delta', text: 'Resposta com fonte validada.' },
                  { type: 'done', grounded: true }
                ])
              }
            }
          }
        }
      )
    )

    expect(joinDeltas(events)).toContain('Resposta com fonte validada.')
    expect(events.some((event) => event.type === 'citation')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('does not reject live runner citations that are not backed by ingestion evidence', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot)

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: {
            async run() {
              return {
                grounded: false,
                citations: [],
                deltas: toAsyncDeltas([]),
                events: toAsyncEvents([
                  {
                    type: 'citation',
                    citation: { sourceTitle: 'Consolidação das Leis do Trabalho', sourceFile: 'raw/clt-brasil.md', articleRefs: ['Artigo 58.º'] }
                  },
                  { type: 'delta', text: 'Resposta com fonte inventada.' },
                  { type: 'done', grounded: true }
                ])
              }
            }
          }
        }
      )
    )

    expect(joinDeltas(events)).toContain('Resposta com fonte inventada.')
    expect(events.some((event) => event.type === 'citation')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('drops malformed live runner citations without blocking the answer', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: {
            async run() {
              return {
                grounded: false,
                citations: [],
                deltas: toAsyncDeltas([]),
                events: toAsyncEvents([
                  { type: 'citation', citation: { sourceTitle: 'Fonte sem artigos', articleRefs: [] } as any },
                  { type: 'citation', citation: undefined as any },
                  { type: 'delta', text: 'Resposta sem citação mostrada.' },
                  { type: 'done', grounded: true }
                ])
              }
            }
          }
        }
      )
    )

    expect(joinDeltas(events)).toContain('Resposta sem citação mostrada.')
    expect(events.some((event) => event.type === 'citation')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('streams live runner events and renders any valid citation at the end', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot)

    const stream = await createChatEventStreamFromBody(
      { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
      {
        specialtiesRoot,
        piChatEnabled: true,
        runner: {
          async run(input) {
            return {
              grounded: false,
              citations: [],
              deltas: toAsyncDeltas([]),
              events: toAsyncEvents([
                { type: 'status', message: 'A consultar as fontes desta especialidade…' },
                { type: 'citation', citation: input.citationEvidence[0] },
                { type: 'delta', text: 'O Artigo 1.º ' },
                { type: 'delta', text: 'define o âmbito.' },
                { type: 'done', grounded: true }
              ])
            }
          }
        }
      }
    )
    const iterator = stream[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      value: { type: 'status', message: 'A consultar as fontes desta especialidade…' },
      done: false
    })
    await expect(iterator.next()).resolves.toEqual({ value: { type: 'delta', text: 'O Artigo 1.º ' }, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: { type: 'delta', text: 'define o âmbito.' }, done: false })
    await expect(iterator.next()).resolves.toEqual({
      value: {
        type: 'citation',
        citation: {
          sourceTitle: 'Código do IVA',
          sourceFile: 'raw/codigo-iva.original.md',
          articleRefs: ['Artigo 1.º']
        }
      },
      done: false
    })
    await expect(iterator.next()).resolves.toEqual({ value: { type: 'done', grounded: true }, done: false })
  })

  it('passes optional runner token metrics through the chat stream before completion', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot)

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: {
            async run(input) {
              return {
                grounded: false,
                citations: [],
                deltas: toAsyncDeltas([]),
                events: toAsyncEvents([
                  { type: 'citation', citation: input.citationEvidence[0] },
                  { type: 'delta', text: 'Resposta com métricas.' },
                  { type: 'metrics', totalTokens: 1248 },
                  { type: 'done', grounded: true }
                ])
              }
            }
          }
        }
      )
    )

    expect(events.map((event) => event.type)).toEqual(['delta', 'citation', 'metrics', 'done'])
    expect(events[2]).toEqual({ type: 'metrics', totalTokens: 1248 })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('streams a grounded engine result even when citations are missing', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot)

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: {
            async run() {
              return {
                grounded: true,
                citations: [],
                deltas: toAsyncDeltas(['Resposta sem fonte.'])
              }
            }
          }
        }
      )
    )

    expect(joinDeltas(events)).toContain('Resposta sem fonte.')
    expect(events.some((event) => event.type === 'citation')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('streams a service-unavailable assistant response when Pi chat is disabled', async () => {
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource((await import('../server/utils/specialists/registry')).getSpecialistById, specialtiesRoot)

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
        { specialtiesRoot, piChatEnabled: false }
      )
    )

    expect(joinDeltas(events)).toContain('temporariamente indisponível')
    expect(events.at(-1)).toEqual({ type: 'done', grounded: false })
  })

  it('builds a Pi chat prompt with optional citations and no specialist persona', () => {
    const specialist = createPromptTestSpecialist('Use the customs classification output format.')
    const citationEvidence = [{ sourceTitle: 'Pauta Aduaneira', sourceFile: 'raw/pauta.md', articleRefs: ['ARTIGO 1.º'] }]

    const firstPrompt = buildChatPrompt({
      specialist,
      question: 'Classifica este produto.',
      citationEvidence
    })
    const followUpPrompt = buildChatPrompt({
      specialist,
      question: 'E qual é o direito de importação?',
      citationEvidence,
      conversationContext: [
        { role: 'user', content: 'Classifica este produto.' },
        { role: 'assistant', content: 'Resposta anterior.' }
      ]
    })

    expect(firstPrompt).toContain('Answer the user question using this specialist workspace.')
    expect(firstPrompt).toContain('The current working directory is the specialist root. Use the available tools normally.')
    expect(firstPrompt).toContain('Known citation metadata, if useful:')
    expect(firstPrompt).toContain('{"sourceTitle":"Pauta Aduaneira","sourceFile":"raw/pauta.md","articleRefs":["ARTIGO 1.º"]}')
    expect(firstPrompt).toContain('{"type":"citations"')
    expect(firstPrompt).toContain('User question:\nClassifica este produto.')
    expect(firstPrompt).not.toContain('Selected specialist')
    expect(firstPrompt).not.toContain('Use the customs classification output format.')
    expect(followUpPrompt).not.toContain('Use the customs classification output format.')
    expect(followUpPrompt).toContain('Conversation context:\nUSER: Classifica este produto.')
  })
})

function createPromptTestSpecialist(systemPrompt: string): SpecialistRuntime {
  return {
    id: 'pauta-aduaneira',
    name: 'Pauta Aduaneira',
    description: 'Classifica produtos conforme a pauta aduaneira.',
    wiki_type: 'legislation-regulatory',
    system_prompt: systemPrompt,
    citations_required: true,
    streaming_enabled: true,
    status: 'active',
    company_id: null,
    paths: {
      root: '/tmp/pauta-aduaneira',
      config: '/tmp/pauta-aduaneira/specialist.yaml',
      raw: '/tmp/pauta-aduaneira/raw',
      converted: '/tmp/pauta-aduaneira/converted',
      wiki: '/tmp/pauta-aduaneira/wiki',
      ingest: '/tmp/pauta-aduaneira/ingest',
      ingestState: '/tmp/pauta-aduaneira/ingest/state.json'
    }
  }
}

async function createTempSpecialist(id: string, options: { citationsRequired?: boolean } = {}): Promise<{
  specialist: SpecialistRuntime
  specialtiesRoot: string
}> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-chat-'))
  const specialtiesRoot = join(dataDir, 'specialties')

  const specialist = await createSpecialist(
    {
      id,
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      system_prompt: 'Answer only from this specialist wiki.',
      citations_required: options.citationsRequired ?? true,
      streaming_enabled: true
    },
    { specialtiesRoot }
  )

  return { specialist, specialtiesRoot }
}

async function createIngestedSource(
  getSpecialistById: (id: string, options: { specialtiesRoot: string }) => Promise<SpecialistRuntime | undefined>,
  specialtiesRoot: string,
  options: {
    articleRefs?: string[]
    citations?: Array<{ sourceTitle: string; articleRefs: string[] }>
  } = {}
): Promise<void> {
  const specialist = await getSpecialistById('iva', { specialtiesRoot })
  if (!specialist) {
    throw new Error('Expected specialist to exist')
  }

  await storeRawSource(specialist, {
    fileName: 'codigo-iva.md',
    content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
  })

  const state = await scanSpecialistRawSources(specialist)
  state.sources['codigo-iva.original.md'].status = 'ingested'
  state.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
  state.sources['codigo-iva.original.md'].article_refs = options.articleRefs ?? ['Artigo 1.º']
  state.sources['codigo-iva.original.md'].ingestion!.citations = options.citations
    ? options.citations.map((citation) => ({
        source_file: 'raw/codigo-iva.original.md',
        source_title: citation.sourceTitle,
        article_refs: citation.articleRefs
      }))
    : [{
        source_file: 'raw/codigo-iva.original.md',
        source_title: 'Código do IVA',
        article_refs: state.sources['codigo-iva.original.md'].article_refs.length > 0
          ? state.sources['codigo-iva.original.md'].article_refs
          : ['Código do IVA']
      }]
  state.sources['codigo-iva.original.md'].ingestion!.manifest_validated_at = '2026-05-16T00:00:00.000Z'
  state.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
  await writeIngestionState(specialist.paths.ingestState, state)
}

function fakeRunner(
  deltas?: (input: Parameters<ChatEngineRunner['run']>[0]) => AsyncIterable<string> | void
): ChatEngineRunner {
  return {
    async run(input) {
      const answerDeltas = deltas?.(input) ?? toAsyncDeltas(['Resposta fundamentada.'])

      return {
        grounded: true,
        citations: [input.citationEvidence[0]],
        deltas: answerDeltas
      }
    }
  }
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}

async function* toAsyncEvents(events: ChatRunnerStreamEvent[]): AsyncIterable<ChatRunnerStreamEvent> {
  for (const event of events) {
    yield event
  }
}

async function collectChatEvents(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []

  for await (const event of events) {
    collected.push(event)
  }

  return collected
}

function joinDeltas(events: ChatStreamEvent[]): string {
  return events
    .filter((event): event is Extract<ChatStreamEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('')
}
