import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSessionLogCloseStatus } from '../agents/logs'
import { createDocxToMarkdownTool } from '../pi/docx-to-markdown-tool'
import { createUjimuPiSession } from '../pi/session'
import type { SpecialistRuntime } from '../specialists/schema'
import { scanSpecialistRawSources } from './detect'
import { extractArticleRefs, inferSourceTitle } from './metadata'
import { writeIngestionState } from './state'
import type { IngestionSourceRecord, IngestionState } from './types'

export interface PiConversionRunner {
  convertSource(
    specialist: SpecialistRuntime,
    source: IngestionSourceRecord
  ): Promise<void>
}

export interface RunPendingConversionsOptions {
  piConversionEnabled?: boolean
  runner?: PiConversionRunner
  maxMarkdownBytes?: number
  staleProcessingMinutes?: number
}

export interface ConversionRunResult {
  converted: number
  failed: number
  skipped: number
  sources: IngestionSourceRecord[]
}

export class PiConversionDisabledError extends Error {
  public readonly code = 'PI_CONVERSION_DISABLED'

  constructor() {
    super('Pi conversion is disabled. Set UJIMU_PI_CONVERSION_ENABLED=true to run conversion.')
    this.name = 'PiConversionDisabledError'
  }
}

export class PiConversionError extends Error {
  constructor(
    public readonly code: 'CONVERSION_FAILED' | 'CONVERSION_OUTPUT_TOO_SMALL' | 'CONVERSION_OUTPUT_TOO_LARGE' | 'PDF_CONVERSION_REQUIRES_INGESTION',
    message: string
  ) {
    super(message)
    this.name = 'PiConversionError'
  }
}

export async function runPendingConversions(
  specialist: SpecialistRuntime,
  options: RunPendingConversionsOptions = {}
): Promise<ConversionRunResult> {
  const state = await scanSpecialistRawSources(specialist)
  const staleCutoffMs = resolveStaleProcessingMinutes(options.staleProcessingMinutes) * 60 * 1000
  const now = new Date()
  const candidates = Object.values(state.sources)
    .filter((source) => shouldRunConversion(source, now, staleCutoffMs))
    .sort((left, right) => left.raw_path.localeCompare(right.raw_path))

  let skipped = Object.values(state.sources).length - candidates.length
  let converted = 0
  let failed = 0

  if (candidates.length === 0) {
    return { converted, failed, skipped, sources: sortedSources(state) }
  }

  if (!isPiConversionEnabled(options.piConversionEnabled)) {
    throw new PiConversionDisabledError()
  }

  const runner = options.runner ?? createPiSdkConversionRunner()

  for (const source of candidates) {
    markConversionProcessing(source)
    await writeIngestionState(specialist.paths.ingestState, state)

    try {
      await runner.convertSource(specialist, source)
      await validateConvertedMarkdown(specialist, source, resolveMaxMarkdownBytes(options.maxMarkdownBytes))
      markConverted(source)
      converted += 1
    } catch (error) {
      markConversionFailed(source, toConversionErrorCode(error), error instanceof Error ? error.message : 'Conversion failed.')
      failed += 1
    }

    await writeIngestionState(specialist.paths.ingestState, state)
  }

  return { converted, failed, skipped, sources: sortedSources(state) }
}

export function createPiSdkConversionRunner(): PiConversionRunner {
  return {
    async convertSource(specialist, source) {
      await runPiSdkConversion(specialist, source)
    }
  }
}

async function runPiSdkConversion(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord
): Promise<void> {
  if (/\.pdf$/i.test(source.raw_path)) {
    throw new PiConversionError(
      'PDF_CONVERSION_REQUIRES_INGESTION',
      'PDF conversion requires the normal visual OCR ingestion workflow.'
    )
  }

  if (/\.docx$/i.test(source.raw_path)) {
    const tool = createDocxToMarkdownTool({ cwd: specialist.paths.root })
    await tool.execute('docx-conversion', { docxPath: `raw/${source.raw_path}` })
    return
  }

  const cwd = specialist.paths.root
  const markdownPath = source.conversion?.markdown_path ?? `${source.raw_path}.md`
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'conversion',
    modelEnvPrefix: 'UJIMU_PI_CONVERSION',
    agentLog: { specialistId: specialist.id }
  })

  let logStatus: AgentSessionLogCloseStatus = 'succeeded'

  try {
    await session.prompt(buildConversionPrompt(specialist, source))
  } catch (error) {
    logStatus = 'failed'
    if (error instanceof PiConversionError) {
      throw error
    }

    throw new PiConversionError('CONVERSION_FAILED', error instanceof Error ? error.message : 'Pi conversion failed.')
  } finally {
    session.dispose()
    await agentLog?.close(logStatus)
  }
}

function buildConversionPrompt(_specialist: SpecialistRuntime, source: IngestionSourceRecord): string {
  const markdownPath = source.conversion?.markdown_path ?? `${source.raw_path}.md`
  const inputPath = `raw/${source.raw_path}`
  const outputPath = `raw/${markdownPath}`

  return `Convert exactly one uploaded source into Markdown.

Source:
- input: ${inputPath}
- output: ${outputPath}
- original checksum: ${source.checksum}

Rules:
1. Read ${inputPath} and write only ${outputPath}.
2. Preserve the source faithfully in its original language. Do not summarize, omit, modernize, translate, or invent content.
3. For CSV, write a Markdown table with all rows and columns.
4. For XLSX, write each sheet as a Markdown heading followed by faithful Markdown tables. If the available tools cannot read the workbook, fail clearly instead of inventing content.
5. For HTML/HTM, preserve headings, paragraphs, links, lists, and tables as Markdown.
6. For TXT, preserve text structure and article references.
7. Do not modify wiki/ or any file other than ${outputPath}.
8. End after the Markdown file has been written.
`
}

function shouldRunConversion(source: IngestionSourceRecord, now: Date, staleCutoffMs: number): boolean {
  if (/\.(md|markdown)$/i.test(source.raw_path)) {
    return false
  }

  const status = source.conversion?.status
  if (status === 'pending' || status === 'failed') {
    return true
  }

  if (status === 'processing') {
    const updatedAt = source.conversion?.updated_at ?? source.updated_at
    return Number.isFinite(Date.parse(updatedAt)) && now.getTime() - Date.parse(updatedAt) > staleCutoffMs
  }

  return false
}

function markConversionProcessing(source: IngestionSourceRecord): void {
  const now = new Date().toISOString()
  source.status = 'processing'
  source.error_code = undefined
  source.error_message = undefined
  source.updated_at = now
  source.conversion = {
    status: 'processing',
    markdown_path: source.conversion?.markdown_path ?? `${source.raw_path}.md`,
    updated_at: now
  }
  source.ingestion = {
    status: 'blocked',
    source_path: source.ingestion?.source_path ?? source.conversion.markdown_path,
    skipped_reason: 'conversion_pending',
    updated_at: now
  }
}

async function validateConvertedMarkdown(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord,
  maxMarkdownBytes: number
): Promise<void> {
  const markdownPath = source.conversion?.markdown_path
  if (!markdownPath) {
    throw new PiConversionError('CONVERSION_FAILED', 'Conversion did not declare a Markdown target.')
  }

  const absolutePath = join(specialist.paths.raw, markdownPath)
  const fileStat = await stat(absolutePath).catch(() => undefined)
  if (!fileStat?.isFile()) {
    throw new PiConversionError('CONVERSION_FAILED', `Converted Markdown was not created at raw/${markdownPath}.`)
  }
  if (fileStat.size > maxMarkdownBytes) {
    throw new PiConversionError('CONVERSION_OUTPUT_TOO_LARGE', `Converted Markdown exceeds ${maxMarkdownBytes} bytes.`)
  }

  const content = await readFile(absolutePath)
  const text = content.toString('utf8')
  if (text.replace(/\s/g, '').length < 20) {
    throw new PiConversionError('CONVERSION_OUTPUT_TOO_SMALL', 'Converted Markdown is too small to ingest safely.')
  }

  const articleRefs = extractArticleRefs(text)
  if (articleRefs.length > 0) {
    source.article_refs = articleRefs
  }
  if (!source.title.trim() || source.title === source.raw_path.replace(/[-_]+/g, ' ').replace(/\.\w+$/u, '').trim()) {
    source.title = inferSourceTitle(source.raw_path, text)
  }
  source.conversion!.markdown_checksum = toChecksum(content)
}

function markConverted(source: IngestionSourceRecord): void {
  const now = new Date().toISOString()
  source.status = 'pending'
  source.error_code = undefined
  source.error_message = undefined
  source.updated_at = now
  source.conversion = {
    ...source.conversion!,
    status: 'converted',
    converted_at: now,
    updated_at: now,
    error_code: undefined,
    error_message: undefined
  }
  source.ingestion = {
    status: 'pending',
    source_path: source.conversion.markdown_path,
    updated_at: now,
    error_code: undefined,
    error_message: undefined,
    skipped_reason: undefined
  }
}

function markConversionFailed(source: IngestionSourceRecord, errorCode: string, errorMessage: string): void {
  const now = new Date().toISOString()
  source.status = 'blocked'
  source.error_code = errorCode
  source.error_message = errorMessage
  source.updated_at = now
  source.conversion = {
    ...source.conversion!,
    status: 'failed',
    updated_at: now,
    error_code: errorCode,
    error_message: errorMessage
  }
  source.ingestion = {
    status: 'blocked',
    source_path: source.ingestion?.source_path ?? source.conversion.markdown_path,
    skipped_reason: 'conversion_failed',
    updated_at: now
  }
}

function toConversionErrorCode(error: unknown): string {
  return error instanceof PiConversionError ? error.code : 'CONVERSION_FAILED'
}


function isPiConversionEnabled(option: boolean | undefined): boolean {
  return option ?? process.env.UJIMU_PI_CONVERSION_ENABLED === 'true'
}

function resolveMaxMarkdownBytes(option: number | undefined): number {
  const configured = option ?? Number.parseInt(process.env.UJIMU_PI_CONVERSION_MAX_MARKDOWN_BYTES ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : 1024 * 1024
}

export function resolveStaleProcessingMinutes(option: number | undefined): number {
  const configured = option ?? Number.parseInt(process.env.UJIMU_PI_PIPELINE_STALE_PROCESSING_MINUTES ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : 30
}

function sortedSources(state: IngestionState): IngestionSourceRecord[] {
  return Object.values(state.sources).sort((left, right) => left.raw_path.localeCompare(right.raw_path))
}

function toChecksum(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
