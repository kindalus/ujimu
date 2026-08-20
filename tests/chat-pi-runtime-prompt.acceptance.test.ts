import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCitation } from '../server/utils/chat/types'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const createUjimuPiSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/pi/session', () => ({
  createUjimuPiSession: createUjimuPiSessionMock
}))

describe('Pi chat runtime prompt acceptance', () => {
  beforeEach(() => {
    createUjimuPiSessionMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the specialist root directly and lets Pi answer with optional citations', async () => {
    const prompts: string[] = []
    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              delta: [
                JSON.stringify({
                  type: 'citations',
                  citations: [{ sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }]
                }),
                JSON.stringify({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
              ].join('\n')
            }
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => {
            subscriber = undefined
          }
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      }
    })

    const { createPiChatRunner } = await import('../server/utils/chat/pi-runner')
    const run = await createPiChatRunner().run({
      specialist: specialistRuntimeFixture(),
      question: 'O que diz o Artigo 1.º?',
      citationEvidence: citationEvidenceFixture()
    })

    const events = []
    for await (const event of run.events!) {
      events.push(event)
    }

    const sessionOptions = createUjimuPiSessionMock.mock.calls[0][0]
    expect(sessionOptions).toMatchObject({ cwd: '/tmp/ujimu/specialties/iva', task: 'chat' })
    expect(sessionOptions).not.toHaveProperty('fileSystemPolicy')
    expect(sessionOptions).not.toHaveProperty('tools')
    expect(sessionOptions).not.toHaveProperty('appendSystemPromptOverride')
    expect(prompts[0]).toContain('Answer the user question using this specialist workspace.')
    expect(prompts[0]).toContain('The current working directory is the specialist root. Use the available tools normally.')
    expect(prompts[0]).toContain('missing or malformed citations will simply be omitted by Ujimu')
    expect(prompts[0]).toContain('{"sourceTitle":"Código do IVA","sourceFile":"raw/codigo-iva.original.md","articleRefs":["Artigo 1.º"]}')
    expect(prompts[0]).toContain('{"type":"citations"')
    expect(prompts[0]).toContain('User question:\nO que diz o Artigo 1.º?')
    expect(prompts[0]).not.toContain('Selected specialist')
    expect(prompts[0]).not.toContain('Specialist system prompt')
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('streams plain text when citations are required but the model emits no valid citations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-chat-fallback-'))
    await mkdir(join(root, 'wiki'), { recursive: true })
    await writeFile(join(root, 'wiki', 'duracao-tempo-trabalho.md'), `# Duração do tempo de trabalho

## Período normal

A Lei Geral do Trabalho fixa o período normal de trabalho nos termos do Artigo 95.º, com limites diários e semanais que devem ser confirmados no texto legal aplicável.
`)

    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'Resposta sem citação e fora do protocolo.' }
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => {
            subscriber = undefined
          }
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      }
    })

    const { createPiChatRunner } = await import('../server/utils/chat/pi-runner')
    const run = await createPiChatRunner().run({
      specialist: specialistRuntimeFixture({ root }),
      question: 'Qual é a duração normal do período de trabalho?',
      citationEvidence: citationEvidenceFixture()
    })

    const events = await collectRunnerEvents(run.events!)

    expect(events).not.toContainEqual(expect.objectContaining({ type: 'citation' }))
    expect(events).toContainEqual({ type: 'delta', text: 'Resposta sem citação e fora do protocolo.' })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('streams plain assistant text when citations are not required and the model does not emit NDJSON', async () => {
    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '**Assunto:** Convocatória\n\nExmo. Senhor,' }
          })
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_end', content: '**Assunto:** Convocatória\n\nExmo. Senhor,' }
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => {
            subscriber = undefined
          }
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      }
    })

    const { createPiChatRunner } = await import('../server/utils/chat/pi-runner')
    const run = await createPiChatRunner().run({
      specialist: specialistRuntimeFixture({ citationsRequired: false }),
      question: 'Escreve a convocatória.',
      citationEvidence: []
    })

    const events = []
    for await (const event of run.events!) {
      events.push(event)
    }

    expect(joinDeltas(events)).toBe('**Assunto:** Convocatória\n\nExmo. Senhor,')
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('does not abort an active Pi chat while it is producing events', async () => {
    vi.useFakeTimers()

    const abort = vi.fn(async () => undefined)
    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {
          await wait(40)
          subscriber?.({ type: 'tool_execution_end', toolName: 'grep', isError: false })
          await wait(40)
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              delta: [
                JSON.stringify({
                  type: 'citations',
                  citations: [{ sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }]
                }),
                JSON.stringify({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
              ].join('\n')
            }
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => {
            subscriber = undefined
          }
        }),
        abort,
        dispose: vi.fn()
      }
    })

    try {
      const { createPiChatRunner } = await import('../server/utils/chat/pi-runner')
      const run = await createPiChatRunner().run({
        specialist: specialistRuntimeFixture(),
        question: 'O que diz o Artigo 1.º?',
        citationEvidence: citationEvidenceFixture()
      })

      const eventsPromise = collectRunnerEvents(run.events!)
      await vi.advanceTimersByTimeAsync(90)
      const events = await eventsPromise

      expect(abort).not.toHaveBeenCalled()
      expect(events).toContainEqual({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
      expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('parses final assistant message NDJSON from agent_end when no text deltas or message_end event are emitted', async () => {
    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {
          subscriber?.({
            type: 'agent_end',
            messages: [
              { role: 'user', content: [{ type: 'text', text: 'O que diz o Artigo 1.º?' }] },
              {
                role: 'assistant',
                content: [{
                  type: 'text',
                  text: [
                    JSON.stringify({
                      type: 'citations',
                      citations: [{ sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }]
                    }),
                    JSON.stringify({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
                  ].join('\n')
                }]
              }
            ]
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => {
            subscriber = undefined
          }
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      }
    })

    const { createPiChatRunner } = await import('../server/utils/chat/pi-runner')
    const run = await createPiChatRunner().run({
      specialist: specialistRuntimeFixture(),
      question: 'O que diz o Artigo 1.º?',
      citationEvidence: citationEvidenceFixture()
    })

    const events = []
    for await (const event of run.events!) {
      events.push(event)
    }

    expect(events).toContainEqual({
      type: 'citation',
      citation: { sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }
    })
    expect(events).toContainEqual({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('parses final assistant message NDJSON when the provider does not stream text deltas', async () => {
    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {
          subscriber?.({
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [{
                type: 'text',
                text: [
                  JSON.stringify({
                    type: 'citations',
                    citations: [{ sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }]
                  }),
                  JSON.stringify({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
                ].join('\n')
              }]
            }
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => {
            subscriber = undefined
          }
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      }
    })

    const { createPiChatRunner } = await import('../server/utils/chat/pi-runner')
    const run = await createPiChatRunner().run({
      specialist: specialistRuntimeFixture(),
      question: 'O que diz o Artigo 1.º?',
      citationEvidence: citationEvidenceFixture()
    })

    const events = []
    for await (const event of run.events!) {
      events.push(event)
    }

    expect(events).toContainEqual({
      type: 'citation',
      citation: { sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }
    })
    expect(events).toContainEqual({ type: 'delta', text: 'O Artigo 1.º define o âmbito.' })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })
})

function specialistRuntimeFixture(options: { citationsRequired?: boolean; root?: string } = {}): SpecialistRuntime {
  const root = options.root ?? '/tmp/ujimu/specialties/iva'
  return {
    id: 'iva',
    name: 'Legislação de IVA',
    description: 'Especialista sobre legislação de IVA.',
    wiki_type: 'legislation-regulatory',
    system_prompt: 'Responder como consultor fiscal.',
    citations_required: options.citationsRequired ?? true,
    streaming_enabled: true,
    status: 'active',
    company_id: null,
    paths: {
      root,
      config: `${root}/specialist.yaml`,
      raw: `${root}/raw`,
      converted: `${root}/converted`,
      wiki: `${root}/wiki`,
      ingest: `${root}/ingest`,
      ingestState: `${root}/ingest/state.json`
    }
  }
}

function citationEvidenceFixture(): ChatCitation[] {
  return [{ sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo-iva.original.md', articleRefs: ['Artigo 1.º'] }]
}

async function collectRunnerEvents(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const collected: unknown[] = []
  for await (const event of events) {
    collected.push(event)
  }
  return collected
}

function joinDeltas(events: unknown[]): string {
  return events
    .filter((event): event is { type: 'delta'; text: string } =>
      Boolean(event) && typeof event === 'object' && (event as { type?: unknown }).type === 'delta'
    )
    .map((event) => event.text)
    .join('')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
