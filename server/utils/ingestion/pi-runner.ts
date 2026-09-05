import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUjimuPiSession } from '../pi/session'
import type { AgentSessionLogCloseStatus } from '../agents/logs'
import { createPdfOcrCoverageTracker, PdfOcrCoverageError } from './pdf-ocr-coverage'
import type { SpecialistRuntime } from '../specialists/schema'
import type { IngestionManifest, IngestionSourceRecord } from './types'

export interface PiIngestionResult {
  summary?: string
}

export interface PiBatchIngestionResult {
  manifest: IngestionManifest
}

const WIKI_CONVERGENCE_INSTRUCTIONS = `Before finishing, bring wiki/ to convergence:
- Review the complete wiki for inconsistencies and incoherences, including OKF compliance, source lineage, broken or missing links, orphan pages, duplicates, stale claims, contradictions, and cross-page coherence.
- Fix every issue that the available sources resolve unambiguously. During this phase, modify only files under wiki/, including wiki/index.md and wiki/log.md.
- Preserve and clearly represent legitimate conflicts between sources. Never invent a resolution or hide uncertainty to make the wiki appear consistent.
- Do not modify unrelated raw/ or converted/ files. In batch mode, record source or conversion problems outside the current batch, and issues that require human confirmation, in the relevant failed[] or warnings. In single-source mode, explain them clearly in the final response.
- Repeat the review-and-fix cycle until one complete pass finds no new fixable issue. A documented legitimate conflict or human-confirmation blocker is not a fixable issue and does not prevent convergence.
- In batch mode, write the final manifest only after this clean pass.`

export interface PiIngestionRunner {
  ingestSource(
    specialist: SpecialistRuntime,
    source: IngestionSourceRecord
  ): Promise<PiIngestionResult | void>
  ingestSources?(
    specialist: SpecialistRuntime,
    sources: IngestionSourceRecord[]
  ): Promise<PiBatchIngestionResult | IngestionManifest | void>
}

export class PiIngestionError extends Error {
  constructor(
    public readonly code:
      | 'PI_EXECUTION_FAILED'
      | 'WIKI_OUTPUT_MISSING'
      | 'INGESTION_MANIFEST_MISSING'
      | 'INGESTION_MANIFEST_INVALID'
      | 'INGESTION_ALL_SOURCES_FAILED'
      | 'PDF_OCR_COVERAGE_INCOMPLETE'
      | 'PDF_OCR_VISUAL_REVIEW_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'PiIngestionError'
  }
}

export function createPiSdkIngestionRunner(): PiIngestionRunner {
  return {
    async ingestSource(specialist, source) {
      const result = await runPiSdkBatchIngestion(specialist, [source])
      return { summary: `Pi ingested ${countManifestSuccesses(result.manifest)} source(s).` }
    },
    async ingestSources(specialist, sources) {
      return runPiSdkBatchIngestion(specialist, sources)
    }
  }
}

function countManifestSuccesses(manifest: IngestionManifest): number {
  return manifest.version === 2 ? manifest.processed.length : manifest.ingested.length
}

async function runPiSdkBatchIngestion(
  specialist: SpecialistRuntime,
  sources: IngestionSourceRecord[]
): Promise<PiBatchIngestionResult> {
  const cwd = specialist.paths.root
  await mkdir(join(cwd, '.ujimu'), { recursive: true })
  const pdfOcrCoverage = createPdfOcrCoverageTracker({
    cwd,
    expectedPdfPaths: sources
      .filter(source => source.raw_path.toLowerCase().endsWith('.pdf'))
      .map(source => `raw/${source.raw_path}`)
  })
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    pdfOcrCoverage,
    agentLog: { specialistId: specialist.id }
  })

  let finalText = ''
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'
  const readPathsByToolCall = new Map<string, string>()
  const unsubscribe = session.subscribe?.((event: any) => {
    if (event?.type === 'tool_execution_start' && event.toolName === 'read') {
      if (typeof event.toolCallId === 'string' && typeof event.args?.path === 'string') {
        readPathsByToolCall.set(event.toolCallId, event.args.path)
      }
      return
    }
    if (event?.type === 'tool_execution_end' && event.toolName === 'read') {
      const path = readPathsByToolCall.get(event.toolCallId)
      readPathsByToolCall.delete(event.toolCallId)
      if (!event.isError && path) pdfOcrCoverage.recordSuccessfulRead(path)
      return
    }
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      finalText += event.assistantMessageEvent.delta
    }
  })

  try {
    await session.prompt(buildBatchIngestionPrompt(specialist))
    const fileManifest = await readManifestFile(cwd)
    const finalManifest = parseManifestFromText(finalText)
    if (JSON.stringify(fileManifest) !== JSON.stringify(finalManifest)) {
      throw new PiIngestionError('INGESTION_MANIFEST_INVALID', 'Pi ingestion final manifest does not match .ujimu/ingestion-manifest.json.')
    }
    if (fileManifest.version !== 2) {
      throw new PiIngestionError('INGESTION_MANIFEST_INVALID', 'Visual OCR requires an ingestion manifest version 2.')
    }
    pdfOcrCoverage.validateManifest(fileManifest)
    return { manifest: fileManifest }
  } catch (error) {
    logStatus = 'failed'
    if (error instanceof PiIngestionError) {
      throw error
    }
    if (error instanceof PdfOcrCoverageError) {
      throw new PiIngestionError(
        error.code === 'PDF_OCR_VISUAL_REVIEW_FAILED'
          ? 'PDF_OCR_VISUAL_REVIEW_FAILED'
          : 'PDF_OCR_COVERAGE_INCOMPLETE',
        error.message
      )
    }

    throw new PiIngestionError(
      'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi ingestion failed.'
    )
  } finally {
    unsubscribe?.()
    session.dispose()
    await agentLog?.close(logStatus)
  }
}

async function readManifestFile(cwd: string): Promise<IngestionManifest> {
  const manifestPath = join(cwd, '.ujimu', 'ingestion-manifest.json')
  const raw = await readFile(manifestPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new PiIngestionError('INGESTION_MANIFEST_MISSING', 'Pi ingestion did not write .ujimu/ingestion-manifest.json.')
    }
    throw error
  })
  return parseManifestJson(raw)
}

function parseManifestFromText(text: string): IngestionManifest {
  const trimmed = text.trim()
  const jsonBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim()
  if (jsonBlock) {
    return parseManifestJson(jsonBlock)
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new PiIngestionError('INGESTION_MANIFEST_MISSING', 'Pi ingestion final response did not include a JSON manifest.')
  }

  return parseManifestJson(trimmed.slice(start, end + 1))
}

function parseManifestJson(value: string): IngestionManifest {
  try {
    return JSON.parse(value) as IngestionManifest
  } catch (error) {
    throw new PiIngestionError(
      'INGESTION_MANIFEST_INVALID',
      error instanceof Error ? error.message : 'Invalid ingestion manifest JSON.'
    )
  }
}

function buildBatchIngestionPrompt(specialist: SpecialistRuntime): string {
  return `Use the llm-wiki skill to process pending Ujimu specialist sources in batch/no-discussion mode.

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

${WIKI_CONVERGENCE_INSTRUCTIONS}

Write a complete Ujimu ingestion manifest to .ujimu/ingestion-manifest.json and repeat the same JSON as your final response.

.ujimu/ingestion-manifest.json specification:
{
  "version": 2,
  "specialist_id": "${specialist.id}",
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
`
}

async function runPiSdkIngestion(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord
): Promise<PiIngestionResult> {
  const cwd = specialist.paths.root
  const markdownPath = source.ingestion?.source_path ?? source.raw_path
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    agentLog: { specialistId: specialist.id }
  })

  const prompt = buildIngestionPrompt(specialist, source)
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'

  try {
    await session.prompt(prompt)
    return { summary: `Pi ingested ${source.ingestion?.source_path ?? source.raw_path}` }
  } catch (error) {
    logStatus = 'failed'
    if (error instanceof PiIngestionError) {
      throw error
    }

    throw new PiIngestionError(
      'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi ingestion failed.'
    )
  } finally {
    session.dispose()
    await agentLog?.close(logStatus)
  }
}

function buildIngestionPrompt(specialist: SpecialistRuntime, source: IngestionSourceRecord): string {
  const markdownPath = source.ingestion?.source_path ?? source.raw_path

  return `Use the llm-wiki skill to convert and ingest exactly one specialist source.

Specialist:
- id: ${specialist.id}
- name: ${specialist.name}
- wiki type: ${specialist.wiki_type}

Source:
- original raw path for citations: raw/${source.raw_path}
- converted Markdown path: converted/${markdownPath}
- title: ${source.title}
- original checksum: ${source.checksum}
- article references detected by the app: ${source.article_refs.join(', ') || '(none)'}

Instructions:
1. Convert raw/${source.raw_path} to converted/${markdownPath} before ingestion.
2. Ingest only from converted/${markdownPath}; do not ingest directly from raw/.
3. Do not modify, rename, or delete anything under raw/.
4. Maintain the wiki/ directory using the specialist schema and OKF rules.
5. Preserve traceability from wiki pages to raw/${source.raw_path} and converted/${markdownPath}.
6. Update wiki/index.md and wiki/log.md if present, or create them if missing.
7. If this is a reingestion, reconcile existing wiki pages instead of creating duplicate source pages.
8. If you cannot convert or ingest the source from the available context, explain the failure clearly.

${WIKI_CONVERGENCE_INSTRUCTIONS}
`
}
