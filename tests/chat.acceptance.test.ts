import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import { serializeChatEvent } from '../server/utils/chat/ndjson'
import type { ChatEngineRunner, ChatStreamEvent } from '../server/utils/chat/types'
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

  it('fails closed with a rich insufficiency response when the specialist has no usable evidence', async () => {
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

    expect(calls).toEqual([])
    expect(events[0]).toMatchObject({ type: 'delta' })
    expect(joinDeltas(events)).toContain('fontes oficiais')
    expect(joinDeltas(events)).toContain('artigo')
    expect(events.at(-1)).toEqual({ type: 'done', grounded: false })
    expect(events.some((event) => event.type === 'citation')).toBe(false)
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
        sourceFile: 'raw/codigo-iva.md',
        articleRefs: ['Artigo 1.º']
      }
    })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('converts a grounded engine result without citations into a safe fallback', async () => {
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

    expect(joinDeltas(events)).not.toContain('Resposta sem fonte')
    expect(joinDeltas(events)).toContain('fontes suficientes')
    expect(events.at(-1)).toEqual({ type: 'done', grounded: false })
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
})

async function createTempSpecialist(id: string): Promise<{
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
      citations_required: true,
      streaming_enabled: true
    },
    { specialtiesRoot }
  )

  return { specialist, specialtiesRoot }
}

async function createIngestedSource(
  getSpecialistById: (id: string, options: { specialtiesRoot: string }) => Promise<SpecialistRuntime | undefined>,
  specialtiesRoot: string
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
  state.sources['codigo-iva.md'].status = 'ingested'
  state.sources['codigo-iva.md'].ingested_at = '2026-05-16T00:00:00.000Z'
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
