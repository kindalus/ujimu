import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { IngestionManifest, IngestionSourceRecord } from '../server/utils/ingestion/types'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const createUjimuPiSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/pi/session', () => ({
  createUjimuPiSession: createUjimuPiSessionMock
}))

describe('Pi ingestion prompt acceptance', () => {
  it('asks Pi to convert, ingest, and repair the wiki until a clean convergence pass', async () => {
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

    await createPiSdkIngestionRunner().ingestSources!(specialist, [source])

    expect(prompts).toEqual([`Use the llm-wiki skill to process pending Ujimu specialist sources in batch/no-discussion mode.

Follow the llm-wiki contract exactly:
- Convert raw sources from raw/ into converted/ before ingesting.
- Ingest only from converted/ into wiki/.
- Never modify, rename, or delete files in raw/.
- Keep wiki/ OKF-compliant and update its index and log.
- For Markdown and text passthrough, use copy_raw_to_converted with an agent-authored frontmatter prefix; never reproduce source bytes in model output.
- Use sha256_file for source_sha256 and converted_sha256; never invent hashes.

Read AGENTS.md and ingest/state.json to identify pending or retryable sources. Do not ask follow-up questions.

Mandatory PDF visual OCR workflow:
- Before writing anything in converted/ or wiki/, process every pending PDF with prepare_pdf_ocr.
- For each page from 1 through pageCount, call render_pdf_ocr_page, read its OCR text, overview and every overlapping 300 DPI tile, and compare all visible content.
- Resolve OCR inconsistencies only from the page images. Preserve all legible wording, headings, articles, tables, notes, stamps, and visible structure; never guess unreadable characters.
- Pages may contain two or more text columns. Detect visible column boundaries and reconstruct the reading order top-to-bottom within each column, then left-to-right unless the source clearly indicates another order. Never interleave lines from separate columns.
- After reviewing each page, call confirm_pdf_ocr_page with confirmed, corrected, or illegible. For confirmed or corrected pages, append the complete reviewed page Markdown in order to draft.md inside that PDF's OCR workspace; do not rely on retaining every page in model context.
- If any page is illegible, do not convert or ingest that PDF. Put it in failed[] with error_code PDF_OCR_VISUAL_REVIEW_FAILED.
- Only after every PDF page is confirmed or corrected, call publish_pdf_ocr_markdown to atomically move the reviewed draft into converted/. Never write PDF conversions directly to converted/. Then ingest only that published Markdown into wiki/.

Before finishing, bring wiki/ to convergence:
- Review the complete wiki for inconsistencies and incoherences, including OKF compliance, source lineage, broken or missing links, orphan pages, duplicates, stale claims, contradictions, and cross-page coherence.
- Fix every issue that the available sources resolve unambiguously. During this phase, modify only files under wiki/, including wiki/index.md and wiki/log.md.
- Preserve and clearly represent legitimate conflicts between sources. Never invent a resolution or hide uncertainty to make the wiki appear consistent.
- Do not modify unrelated raw/ or converted/ files. In batch mode, record source or conversion problems outside the current batch, and issues that require human confirmation, in the relevant failed[] or warnings. In single-source mode, explain them clearly in the final response.
- Repeat the review-and-fix cycle until one complete pass finds no new fixable issue. A documented legitimate conflict or human-confirmation blocker is not a fixable issue and does not prevent convergence.
- In batch mode, write the final manifest only after this clean pass.

Write a complete Ujimu ingestion manifest to .ujimu/ingestion-manifest.json and repeat the same JSON as your final response.

.ujimu/ingestion-manifest.json specification:
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
    expect(prompts[0]).toContain('copy_raw_to_converted with an agent-authored frontmatter prefix')
    expect(prompts[0]).toContain('sha256_file for source_sha256 and converted_sha256')
    expect(prompts[0]).toContain('prepare_pdf_ocr')
    expect(prompts[0]).toContain('render_pdf_ocr_page')
    expect(prompts[0]).toContain('confirm_pdf_ocr_page')
    expect(prompts[0]).toContain('publish_pdf_ocr_markdown')
    expect(prompts[0]).toContain('overview and every overlapping 300 DPI tile')
    expect(prompts[0]).toContain('Pages may contain two or more text columns')
    expect(prompts[0]).toContain('Never interleave lines from separate columns')
    expect(prompts[0]).toContain('draft.md inside that PDF\'s OCR workspace')
    expect(prompts[0]).toContain('PDF_OCR_VISUAL_REVIEW_FAILED')

    const sessionOptions = createUjimuPiSessionMock.mock.calls[0][0]
    expect(sessionOptions).toMatchObject({
      cwd: specialist.paths.root,
      task: 'ingestion',
      pdfOcrCoverage: expect.objectContaining({ assertPublishable: expect.any(Function) })
    })
    expect(sessionOptions).not.toHaveProperty('appendSystemPromptOverride')
    expect(sessionOptions).not.toHaveProperty('fileSystemPolicy')
    expect(sessionOptions).not.toHaveProperty('tools')
  })

  it('rejects a PDF manifest when no page coverage was recorded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-ingestion-ocr-gate-'))
    const specialist = specialistRuntimeFixture(root)
    await mkdir(specialist.paths.raw, { recursive: true })
    await mkdir(specialist.paths.converted, { recursive: true })
    await mkdir(specialist.paths.wiki, { recursive: true })
    await mkdir(specialist.paths.ingest, { recursive: true })
    await writeFile(join(specialist.paths.raw, 'source.pdf'), '%PDF-1.7')
    const source = { ...sourceRecordFixture(), raw_path: 'source.pdf' }
    const manifest: IngestionManifest = {
      version: 2,
      specialist_id: specialist.id,
      processed: [{
        raw_path: 'source.pdf',
        source_path: 'source.pdf.md',
        converted_path: 'source.pdf.md',
        source_sha256: source.checksum,
        converted_sha256: 'sha256:converted',
        conversion_status: 'full',
        wiki_pages: ['source.md'],
        citations: [],
        warnings: []
      }],
      failed: []
    }
    let subscriber: ((event: unknown) => void) | undefined
    createUjimuPiSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {
          await writeFile(join(root, '.ujimu', 'ingestion-manifest.json'), JSON.stringify(manifest))
          subscriber?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: JSON.stringify(manifest) }
          })
        }),
        subscribe: vi.fn((callback: (event: unknown) => void) => {
          subscriber = callback
          return () => { subscriber = undefined }
        }),
        dispose: vi.fn()
      }
    })

    const { createPiSdkIngestionRunner } = await import('../server/utils/ingestion/pi-runner')
    await expect(createPiSdkIngestionRunner().ingestSources!(specialist, [source]))
      .rejects.toMatchObject({ code: 'PDF_OCR_COVERAGE_INCOMPLETE' })
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
    seo: { title: '', description: '', introduction: '', topics: [], limitations: '', call_to_action: '' },
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
