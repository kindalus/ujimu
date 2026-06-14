import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { IngestionManifest, IngestionSourceRecord } from '../server/utils/ingestion/types'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const createUjimuFileToolsMock = vi.hoisted(() => vi.fn(async (_cwd: string, tools: string[]) => tools))
const createUjimuPiSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/pi/session', () => ({
  createUjimuFileTools: createUjimuFileToolsMock,
  createUjimuPiSession: createUjimuPiSessionMock
}))

describe('Pi ingestion prompt acceptance', () => {
  it('asks Pi to ingest pending Markdown from raw without listing sources in the prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-ingestion-prompt-'))
    const specialist = specialistRuntimeFixture(root)
    await mkdir(specialist.paths.raw, { recursive: true })
    await mkdir(specialist.paths.wiki, { recursive: true })
    await mkdir(specialist.paths.ingest, { recursive: true })
    await writeFile(join(specialist.paths.ingest, 'state.json'), '{"version":1,"sources":{}}')

    const source = sourceRecordFixture()
    const manifest: IngestionManifest = {
      version: 1,
      specialist_id: specialist.id,
      ingested: [{
        raw_path: source.raw_path,
        source_path: source.ingestion!.source_path,
        wiki_pages: ['codigo-iva.md'],
        citations: [{ source_file: `raw/${source.raw_path}`, source_title: source.title, article_refs: source.article_refs }],
        warnings: []
      }],
      failed: []
    }
    const prompts: string[] = []
    let subscriber: ((event: unknown) => void) | undefined

    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
          await writeFile(join(specialist.paths.root, '.ujimu', 'ingestion-manifest.json'), JSON.stringify(manifest))
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: JSON.stringify(manifest) }
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
      },
      agentLog: { close: vi.fn(async () => undefined) }
    })

    const { createPiSdkIngestionRunner } = await import('../server/utils/ingestion/pi-runner')

    await createPiSdkIngestionRunner().ingestSources!(specialist, [source], { timeoutMs: 1000 })

    expect(prompts).toEqual([`Ingest all markdown files from raw that have not been ingested yet.

Write a complete ingestion manifest to /data/.ujimu/ingestion-manifest.json and repeat the same JSON as your final response.

/data/.ujimu/ingestion-manifest.json specification:
{
  "version": 1,
  "specialist_id": "iva",
  "ingested": [
    {
      "raw_path": "source.original.md",
      "source_path": "source.original.md",
      "wiki_pages": ["relative-page.md"],
      "citations": [
        { "source_file": "raw/source.original.md", "source_title": "Source title", "article_refs": ["Artigo 1.º"] }
      ],
      "warnings": []
    }
  ],
  "failed": [
    { "raw_path": "failed.md", "source_path": "failed.md", "error_code": "ERROR_CODE", "error_message": "Human readable failure" }
  ]
}
`])
    expect(prompts[0]).not.toContain(source.raw_path)
    expect(prompts[0]).not.toContain(source.checksum)

    const sessionOptions = createUjimuPiSessionMock.mock.calls[0][0]
    expect(sessionOptions).not.toHaveProperty('appendSystemPromptOverride')
    expect(sessionOptions.fileSystemPolicy).toEqual({
      root: specialist.paths.root,
      read: { directories: ['wiki', 'raw'], files: ['AGENTS.md', 'ingest/state.json'] },
      write: { directories: ['wiki'], files: ['.ujimu/ingestion-manifest.json'] },
      list: { directories: ['wiki', 'raw'], virtualRootEntries: ['AGENTS.md', 'wiki', 'raw'] }
    })
  })
})

function specialistRuntimeFixture(root: string): SpecialistRuntime {
  return {
    id: 'iva',
    name: 'Legislação de IVA',
    description: 'Especialista sobre legislação de IVA.',
    wiki_type: 'legislation-regulatory',
    system_prompt: '',
    citations_required: true,
    streaming_enabled: true,
    status: 'active',
    company_id: null,
    paths: {
      root,
      config: join(root, 'specialist.yaml'),
      raw: join(root, 'raw'),
      wiki: join(root, 'wiki'),
      ingest: join(root, 'ingest'),
      ingestState: join(root, 'ingest', 'state.json')
    }
  }
}

function sourceRecordFixture(): IngestionSourceRecord {
  return {
    source_id: 'codigo-iva.original.md#sha256:original',
    specialist_id: 'iva',
    raw_path: 'codigo-iva.original.md',
    checksum: 'sha256:original',
    status: 'pending',
    title: 'Código do IVA',
    article_refs: ['Artigo 1.º'],
    conversion: {
      status: 'not_required',
      markdown_path: 'codigo-iva.original.md',
      markdown_checksum: 'sha256:original'
    },
    ingestion: {
      status: 'pending',
      source_path: 'codigo-iva.original.md'
    },
    detected_at: '2026-06-13T00:00:00.000Z',
    updated_at: '2026-06-13T00:00:00.000Z'
  }
}
