import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCitation } from '../server/utils/chat/types'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const createUjimuFileToolsMock = vi.hoisted(() => vi.fn(async (_cwd: string, tools: string[]) => tools))
const createUjimuPiSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/pi/session', () => ({
  createUjimuFileTools: createUjimuFileToolsMock,
  createUjimuPiSession: createUjimuPiSessionMock
}))

describe('Pi chat runtime prompt acceptance', () => {
  beforeEach(() => {
    createUjimuFileToolsMock.mockClear()
    createUjimuPiSessionMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the specialist wiki workspace without injecting specialist metadata, allowlists, or extra system prompt', async () => {
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
    expect(sessionOptions.cwd).toBe('/tmp/ujimu/specialties/iva')
    expect(sessionOptions.fileSystemPolicy).toEqual({
      root: '/tmp/ujimu/specialties/iva',
      read: { directories: ['wiki', 'raw'], files: ['AGENTS.md'] },
      write: { directories: [] },
      list: { directories: ['wiki', 'raw'], virtualRootEntries: ['AGENTS.md', 'wiki', 'raw'] }
    })
    expect(sessionOptions).not.toHaveProperty('appendSystemPromptOverride')
    expect(prompts[0]).toBe(`Answer the user question using this specialist workspace.

User question:
O que diz o Artigo 1.º?

Conversation context:
(none)
`)
    expect(prompts[0]).not.toContain('Backend citation allowlist')
    expect(prompts[0]).not.toContain('Selected specialist')
    expect(prompts[0]).not.toContain('Technical protocol')
    expect(prompts[0]).not.toContain('/data')
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

    expect(events).toContainEqual({ type: 'delta', text: '**Assunto:** Convocatória\n\nExmo. Senhor,' })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('keeps an active Pi chat alive when session events continue before the idle timeout', async () => {
    vi.useFakeTimers()
    const previousTimeout = process.env.UJIMU_PI_CHAT_TIMEOUT_MS
    process.env.UJIMU_PI_CHAT_TIMEOUT_MS = '50'

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
      restoreEnv('UJIMU_PI_CHAT_TIMEOUT_MS', previousTimeout)
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

function specialistRuntimeFixture(options: { citationsRequired?: boolean } = {}): SpecialistRuntime {
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
      root: '/tmp/ujimu/specialties/iva',
      config: '/tmp/ujimu/specialties/iva/specialist.yaml',
      raw: '/tmp/ujimu/specialties/iva/raw',
      wiki: '/tmp/ujimu/specialties/iva/wiki',
      ingest: '/tmp/ujimu/specialties/iva/ingest',
      ingestState: '/tmp/ujimu/specialties/iva/ingest/state.json'
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
