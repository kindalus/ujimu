import { describe, expect, it, vi } from 'vitest'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const createUjimuFileToolsMock = vi.hoisted(() => vi.fn(async (_cwd: string, tools: string[]) => tools))
const createUjimuPiSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/pi/session', () => ({
  createUjimuFileTools: createUjimuFileToolsMock,
  createUjimuPiSession: createUjimuPiSessionMock
}))

describe('specialist initialization prompt acceptance', () => {
  it('sends the initialization prompt with required files and chat protocol', async () => {
    const prompts: string[] = []
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      },
      agentLog: { close: vi.fn(async () => undefined) }
    })

    const { createPiSdkSpecialistInitializationRunner } = await import('../server/utils/specialists/initialization')
    const specialist = specialistRuntimeFixture()

    await createPiSdkSpecialistInitializationRunner().initializeSpecialist(specialist, { timeoutMs: 1000 })

    const sessionOptions = createUjimuPiSessionMock.mock.calls[0][0]
    expect(sessionOptions.cwd).toBe(specialist.paths.root)
    expect(sessionOptions.fileSystemPolicy).toEqual({
      root: specialist.paths.root,
      read: { directories: ['.'] },
      write: { directories: ['wiki'], files: ['AGENTS.md'] },
      list: { directories: ['.'] }
    })
    expect(sessionOptions).not.toHaveProperty('appendSystemPromptOverride')
    expect(prompts[0]).toBe(`Initialize a new Ujimu specialist LLM Wiki workspace. Use the information below to create the wiki structure. Choose sensible wiki conventions from the selected LLM Wiki preset, but do not invent source facts or legal content. Include the chat response protocol below in AGENTS.md so consultation chat sessions can follow it later.

Specialist:
- id: perito-fintech
- name: Perito Fintech
- description: Especialista em regulação fintech angolana.
- wiki type: legislation-regulatory

The backend has already created raw/, converted/, wiki/, and ingest/. Respect the llm-wiki contract raw/ -> converted/ -> wiki/.

Create these required files:
- AGENTS.md
- wiki/index.md
- wiki/log.md

---
Assume the following persona:
You are a Ujimu specialist consultation assistant. Answer as a careful domain specialist, using only this specialist wiki as your source of truth. If the wiki does not contain enough evidence, say that the current context is insufficient instead of guessing.
---

Chat response protocol:
This protocol applies only when answering user consultation questions, not during wiki initialization or source ingestion.

1. Emit NDJSON only: one JSON object per line, no code fence, no prose outside JSON.
2. When the wiki supports the answer, emit one citations event before any answer chunk:
   {"type":"citations","citations":[{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}]}
3. Then emit answer chunks:
   {"type":"delta","text":"..."}
4. If the wiki does not contain enough evidence, emit only answer chunks explaining that the current context is insufficient; do not guess and do not emit citations.
`)
  })

  it('writes the specialist system prompt as a one-time initialization persona before the chat protocol', async () => {
    const prompts: string[] = []
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn()
      },
      agentLog: { close: vi.fn(async () => undefined) }
    })

    const { createPiSdkSpecialistInitializationRunner } = await import('../server/utils/specialists/initialization')
    const specialist = specialistRuntimeFixture('Responder como consultor fiscal angolano.')

    await createPiSdkSpecialistInitializationRunner().initializeSpecialist(specialist, { timeoutMs: 1000 })

    expect(prompts[0]).toContain(`---
Assume the following persona:
Responder como consultor fiscal angolano.
---

Chat response protocol:`)
  })
})

function specialistRuntimeFixture(systemPrompt = ''): SpecialistRuntime {
  return {
    id: 'perito-fintech',
    name: 'Perito Fintech',
    description: 'Especialista em regulação fintech angolana.',
    wiki_type: 'legislation-regulatory',
    system_prompt: systemPrompt,
    citations_required: true,
    streaming_enabled: true,
    status: 'initializing',
    company_id: null,
    paths: {
      root: '/tmp/ujimu/specialties/perito-fintech',
      config: '/tmp/ujimu/specialties/perito-fintech/specialist.yaml',
      raw: '/tmp/ujimu/specialties/perito-fintech/raw',
      converted: '/tmp/ujimu/specialties/perito-fintech/converted',
      wiki: '/tmp/ujimu/specialties/perito-fintech/wiki',
      ingest: '/tmp/ujimu/specialties/perito-fintech/ingest',
      ingestState: '/tmp/ujimu/specialties/perito-fintech/ingest/state.json'
    }
  }
}
