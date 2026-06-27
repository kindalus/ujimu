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
  it('asks Pi to convert raw sources through converted before ingestion without listing sources in the prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-ingestion-prompt-'))
    const specialist = specialistRuntimeFixture(root)
    await mkdir(specialist.paths.raw, { recursive: true })
    await mkdir(specialist.paths.converted, { recursive: true })
    await mkdir(specialist.paths.wiki, { recursive: true })
    await mkdir(specialist.paths.ingest, { recursive: true })
    await writeFile(join(specialist.paths.ingest, 'state.json'), '{"version":1,"sources":{}}')

    const source = sourceRecordFixture()
    const manifest: IngestionManifest = {
      version: 2,
      specialist_id: specialist.id,
      processed: [{
        raw_path: source.raw_path,
        source_path: source.ingestion!.source_path,
        converted_path: source.conversion!.markdown_path,
        source_sha256: source.checksum,
        converted_sha256: 'sha256:converted',
        conversion_status: 'passthrough',
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

    expect(prompts).toEqual([`Use the llm-wiki skill to process pending Ujimu specialist sources in batch/no-discussion mode.

Follow the llm-wiki contract exactly:
- Convert raw sources from /data/raw into /data/converted before ingesting.
- Ingest only from /data/converted into /data/wiki.
- Never modify, rename, or delete files in /data/raw.
- Keep /data/wiki OKF-compliant and update its index and log.

Read /data/AGENTS.md and /data/ingest/state.json to identify pending or retryable sources. Do not ask follow-up questions.

Write a complete Ujimu ingestion manifest to /data/.ujimu/ingestion-manifest.json and repeat the same JSON as your final response.

/data/.ujimu/ingestion-manifest.json specification:
{
  "version": 2,
  "specialist_id": "iva",
  "processed": [
    {
      "raw_path": "source.pdf",
      "source_path": "source.pdf.md",
      "converted_path": "source.pdf.md",
      "source_sha256": "sha256:...",
      "converted_sha256": "sha256:...",
      "conversion_status": "full",
      "wiki_pages": ["relative-page.md"],
      "citations": [
        { "source_file": "raw/source.pdf", "source_title": "Source title", "article_refs": ["Artigo 1.º"] }
      ],
      "warnings": []
    }
  ],
  "failed": [
    { "raw_path": "failed.pdf", "stage": "conversion", "converted_path": "failed.pdf.md", "conversion_status": "failed", "error_code": "ERROR_CODE", "error_message": "Human readable failure" }
  ]
}

Only include conversion_status values allowed by the llm-wiki skill. Put sources that require user confirmation before ingestion in failed[] with a clear error_message instead of processed[].
`])
    expect(prompts[0]).not.toContain(source.raw_path)
    expect(prompts[0]).not.toContain(source.checksum)

    const sessionOptions = createUjimuPiSessionMock.mock.calls[0][0]
    expect(sessionOptions).not.toHaveProperty('appendSystemPromptOverride')
    expect(sessionOptions.fileSystemPolicy).toEqual({
      root: specialist.paths.root,
      read: { directories: ['wiki', 'raw', 'converted'], files: ['AGENTS.md', 'ingest/state.json'] },
      write: { directories: ['wiki', 'converted'], files: ['.ujimu/ingestion-manifest.json'] },
      list: { directories: ['wiki', 'raw', 'converted'], virtualRootEntries: ['AGENTS.md', 'wiki', 'raw', 'converted'] }
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
      converted: join(root, 'converted'),
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
      status: 'pending',
      markdown_path: 'codigo-iva.original.md.md'
    },
    ingestion: {
      status: 'pending',
      source_path: 'codigo-iva.original.md.md'
    },
    detected_at: '2026-06-13T00:00:00.000Z',
    updated_at: '2026-06-13T00:00:00.000Z'
  }
}
