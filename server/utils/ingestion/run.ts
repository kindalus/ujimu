import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { scanSpecialistRawSources, toConvertedMarkdownPath } from './detect'
import { createPiSdkIngestionRunner, PiIngestionError, type PiBatchIngestionResult, type PiIngestionRunner } from './pi-runner'
import { editSpecialist } from '../specialists/manager'
import { writeIngestionState } from './state'
import type {
  AgentOwnedIngestionManifestSourceFailure,
  AgentOwnedIngestionManifestSourceSuccess,
  IngestionCitationState,
  IngestionManifest,
  IngestionManifestSourceFailure,
  IngestionManifestSourceSuccess,
  IngestionSourceRecord,
  IngestionState,
  LlmWikiConversionStatus
} from './types'
import { resolveStaleProcessingMinutes } from './conversion'

export interface RunPendingIngestionOptions {
  piIngestionEnabled?: boolean
  runner?: PiIngestionRunner
  timeoutMs?: number
  staleProcessingMinutes?: number
}

export class PiIngestionDisabledError extends Error {
  public readonly code = 'PI_INGESTION_DISABLED'

  constructor() {
    super('Pi ingestion is disabled. Set UJIMU_PI_INGESTION_ENABLED=true to run ingestion.')
    this.name = 'PiIngestionDisabledError'
  }
}

interface ValidatedManifestSuccess {
  raw_path: string
  source_path: string
  converted_path?: string
  converted_sha256?: string
  conversion_status?: LlmWikiConversionStatus
  wiki_pages: string[]
  citations: IngestionCitationState[]
  warnings?: string[]
}

interface ValidatedManifestFailure {
  raw_path: string
  source_path?: string
  converted_path?: string
  conversion_status?: LlmWikiConversionStatus
  stage?: 'conversion' | 'ingestion'
  error_code: string
  error_message: string
}

interface ValidatedManifest {
  successes: ValidatedManifestSuccess[]
  failures: ValidatedManifestFailure[]
}

const AUTO_INGEST_CONVERSION_STATUSES = new Set<LlmWikiConversionStatus>(['full', 'ocr-full', 'lossy', 'passthrough'])
const ALL_CONVERSION_STATUSES = new Set<LlmWikiConversionStatus>([
  'full',
  'partial',
  'lossy',
  'ocr-full',
  'ocr-partial',
  'summary-only',
  'metadata-only',
  'passthrough',
  'failed'
])

export async function runPendingIngestion(
  specialist: SpecialistRuntime,
  options: RunPendingIngestionOptions = {}
): Promise<IngestionState> {
  const state = await scanSpecialistRawSources(specialist)
  const staleCutoffMs = resolveStaleProcessingMinutes(options.staleProcessingMinutes) * 60 * 1000
  const now = new Date()
  if (!(await hasWikiMarkdownFiles(specialist.paths.wiki))) {
    markIngestedSourcesWithMissingWikiOutput(state, now)
  }
  const pendingSources = Object.values(state.sources)
    .filter((source) => shouldRunIngestion(source, now, staleCutoffMs))
    .sort((left, right) => left.raw_path.localeCompare(right.raw_path))

  if (pendingSources.length === 0) {
    await writeIngestionState(specialist.paths.ingestState, state)
    return state
  }

  if (!isPiIngestionEnabled(options.piIngestionEnabled)) {
    throw new PiIngestionDisabledError()
  }

  await mkdir(specialist.paths.converted, { recursive: true })
  const runner = options.runner ?? createPiSdkIngestionRunner()

  if (hasBatchIngestion(runner)) {
    await processBatch({ specialist, state, sources: pendingSources, runner, timeoutMs: options.timeoutMs })
  } else {
    for (const source of pendingSources) {
      await processSource({ specialist, state, source, runner, timeoutMs: options.timeoutMs })
    }
  }

  await writeIngestionState(specialist.paths.ingestState, state)
  return state
}

function isPiIngestionEnabled(option: boolean | undefined): boolean {
  return option ?? process.env.UJIMU_PI_INGESTION_ENABLED === 'true'
}

function shouldRunIngestion(source: IngestionSourceRecord, now: Date, staleCutoffMs: number): boolean {
  if (source.status === 'ingested' || source.ingestion?.status === 'ingested') {
    return false
  }

  if (
    source.status === 'pending' ||
    source.status === 'failed' ||
    source.ingestion?.status === 'pending' ||
    source.ingestion?.status === 'failed' ||
    source.conversion?.status === 'pending' ||
    source.conversion?.status === 'failed'
  ) {
    return true
  }

  if (source.ingestion?.status === 'processing' || source.conversion?.status === 'processing' || source.status === 'processing') {
    const updatedAt = source.ingestion?.updated_at ?? source.conversion?.updated_at ?? source.updated_at
    return Number.isFinite(Date.parse(updatedAt)) && now.getTime() - Date.parse(updatedAt) > staleCutoffMs
  }

  return false
}

async function processBatch(input: {
  specialist: SpecialistRuntime
  state: IngestionState
  sources: IngestionSourceRecord[]
  runner: PiIngestionRunner & { ingestSources: NonNullable<PiIngestionRunner['ingestSources']> }
  timeoutMs?: number
}): Promise<void> {
  const { specialist, state, sources, runner, timeoutMs } = input
  const originalSources = new Map(sources.map((source) => [source.raw_path, cloneSource(source)]))

  for (const source of sources) {
    markProcessing(source)
  }
  await writeIngestionState(specialist.paths.ingestState, state)

  let result: PiBatchIngestionResult | IngestionManifest | void
  try {
    result = await runner.ingestSources(specialist, sources, { timeoutMs })
    const manifest = resolveBatchManifest(result)
    if (!manifest) {
      throw new PiIngestionError('INGESTION_MANIFEST_MISSING', 'Pi ingestion did not return an ingestion manifest.')
    }
    await applyValidatedManifest(specialist, state, sources, manifest)
  } catch (error) {
    if (error instanceof PiIngestionError && error.code === 'INGESTION_MANIFEST_INVALID') {
      restoreOriginalSources(state, originalSources)
      await writeIngestionState(specialist.paths.ingestState, state)
    }
    throw error
  }
}

async function processSource(input: {
  specialist: SpecialistRuntime
  state: IngestionState
  source: IngestionSourceRecord
  runner: PiIngestionRunner
  timeoutMs?: number
}): Promise<void> {
  const { specialist, state, source, runner, timeoutMs } = input

  markProcessing(source)
  await writeIngestionState(specialist.paths.ingestState, state)

  try {
    await runner.ingestSource(specialist, source, { timeoutMs })
    if (!(await hasWikiMarkdownFiles(specialist.paths.wiki))) {
      throw new PiIngestionError(
        'WIKI_OUTPUT_MISSING',
        'Pi ingestion completed without creating wiki Markdown files.'
      )
    }
    markIngested(source)
  } catch (error) {
    markFailed(
      source,
      error instanceof PiIngestionError ? error.code : 'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi ingestion failed.'
    )
  }

  await writeIngestionState(specialist.paths.ingestState, state)
}

function hasBatchIngestion(
  runner: PiIngestionRunner
): runner is PiIngestionRunner & { ingestSources: NonNullable<PiIngestionRunner['ingestSources']> } {
  return typeof runner.ingestSources === 'function'
}

function resolveBatchManifest(result: PiBatchIngestionResult | IngestionManifest | void): IngestionManifest | undefined {
  if (!result) return undefined
  if ('manifest' in result) return result.manifest
  return result
}

async function applyValidatedManifest(
  specialist: SpecialistRuntime,
  state: IngestionState,
  sources: IngestionSourceRecord[],
  manifest: IngestionManifest
): Promise<void> {
  const validated = await validateManifest(specialist, sources, manifest)
  const now = new Date()
  const successfulByRawPath = new Map(validated.successes.map((entry) => [entry.raw_path, entry]))
  const failedByRawPath = new Map(validated.failures.map((entry) => [entry.raw_path, entry]))
  let successful = 0

  for (const source of sources) {
    const successEntry = successfulByRawPath.get(source.raw_path)
    if (successEntry) {
      markIngestedFromManifest(source, successEntry, now)
      successful += 1
      continue
    }

    const failureEntry = failedByRawPath.get(source.raw_path)!
    markFailedFromManifest(source, failureEntry, now)
  }

  if (successful > 0 && specialist.status !== 'active' && specialist.status !== 'suspended') {
    const specialtiesRoot = dirname(specialist.paths.root)
    await editSpecialist(specialist.id, { status: 'active' }, { specialtiesRoot })
  }
}

async function validateManifest(
  specialist: SpecialistRuntime,
  sources: IngestionSourceRecord[],
  manifest: IngestionManifest
): Promise<ValidatedManifest> {
  if (!manifest || manifest.specialist_id !== specialist.id) {
    throw invalidManifest('Manifest specialist id is invalid.')
  }

  if (manifest.version === 2) {
    return validateManifestV2(specialist, sources, manifest.processed, manifest.failed)
  }

  if (manifest.version === 1) {
    return validateManifestV1(specialist, sources, manifest.ingested, manifest.failed)
  }

  throw invalidManifest('Manifest version is invalid.')
}

async function validateManifestV2(
  specialist: SpecialistRuntime,
  sources: IngestionSourceRecord[],
  successes: AgentOwnedIngestionManifestSourceSuccess[],
  failures: AgentOwnedIngestionManifestSourceFailure[]
): Promise<ValidatedManifest> {
  if (!Array.isArray(successes) || !Array.isArray(failures)) {
    throw invalidManifest('Manifest processed and failed fields must be arrays.')
  }

  const expected = new Map(sources.map((source) => [source.raw_path, source]))
  const seen = new Set<string>()
  const validatedSuccesses: ValidatedManifestSuccess[] = []
  const validatedFailures: ValidatedManifestFailure[] = []

  for (const entry of successes) {
    const source = expected.get(entry.raw_path)
    if (!source) throw invalidManifest(`Manifest references unknown source ${entry.raw_path}.`)
    assertSeenOnce(seen, entry.raw_path)
    await validateSuccessEntryV2(specialist, source, entry)
    validatedSuccesses.push(entry)
  }

  for (const entry of failures) {
    const source = expected.get(entry.raw_path)
    if (!source) throw invalidManifest(`Manifest references unknown failed source ${entry.raw_path}.`)
    assertSeenOnce(seen, entry.raw_path)
    validateFailureEntry(entry)
    validatedFailures.push(entry)
  }

  assertAllSourcesMentioned(sources, seen)
  return { successes: validatedSuccesses, failures: validatedFailures }
}

async function validateManifestV1(
  specialist: SpecialistRuntime,
  sources: IngestionSourceRecord[],
  successes: IngestionManifestSourceSuccess[],
  failures: IngestionManifestSourceFailure[]
): Promise<ValidatedManifest> {
  if (!Array.isArray(successes) || !Array.isArray(failures)) {
    throw invalidManifest('Manifest ingested and failed fields must be arrays.')
  }

  const expected = new Map(sources.map((source) => [source.raw_path, source]))
  const seen = new Set<string>()
  const validatedSuccesses: ValidatedManifestSuccess[] = []
  const validatedFailures: ValidatedManifestFailure[] = []

  for (const entry of successes) {
    const source = expected.get(entry.raw_path)
    if (!source) throw invalidManifest(`Manifest references unknown source ${entry.raw_path}.`)
    assertSeenOnce(seen, entry.raw_path)
    validateSuccessEntryV1(source, entry)
    for (const page of entry.wiki_pages) {
      await assertWikiPageExists(specialist.paths.wiki, page)
    }
    validatedSuccesses.push(entry)
  }

  for (const entry of failures) {
    const source = expected.get(entry.raw_path)
    if (!source) throw invalidManifest(`Manifest references unknown failed source ${entry.raw_path}.`)
    assertSeenOnce(seen, entry.raw_path)
    validateFailureEntry(entry)
    validatedFailures.push(entry)
  }

  assertAllSourcesMentioned(sources, seen)
  return { successes: validatedSuccesses, failures: validatedFailures }
}

async function validateSuccessEntryV2(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord,
  entry: AgentOwnedIngestionManifestSourceSuccess
): Promise<void> {
  const expectedSourcePath = source.ingestion?.source_path ?? source.conversion?.markdown_path ?? toConvertedMarkdownPath(source.raw_path)
  if (entry.source_path !== expectedSourcePath || entry.converted_path !== expectedSourcePath) {
    throw invalidManifest(`Manifest converted path for ${source.raw_path} does not match ${expectedSourcePath}.`)
  }
  if (entry.source_sha256 !== source.checksum) {
    throw invalidManifest(`Manifest source_sha256 for ${source.raw_path} does not match the uploaded source.`)
  }
  if (!ALL_CONVERSION_STATUSES.has(entry.conversion_status)) {
    throw invalidManifest(`Manifest conversion_status for ${source.raw_path} is invalid.`)
  }
  if (!AUTO_INGEST_CONVERSION_STATUSES.has(entry.conversion_status)) {
    throw invalidManifest(`Manifest conversion_status for ${source.raw_path} requires review before ingestion.`)
  }
  if (!isSafeRelativeMarkdownPath(entry.converted_path)) {
    throw invalidManifest(`Manifest converted_path for ${source.raw_path} is invalid.`)
  }
  const converted = await readConvertedMarkdown(specialist.paths.converted, entry.converted_path)
  if (entry.converted_sha256 !== converted.checksum) {
    throw invalidManifest(`Manifest converted_sha256 for ${source.raw_path} does not match converted/${entry.converted_path}.`)
  }
  validateConvertedFrontmatter(source, entry, converted.text)
  validateCitationAndPages(source, entry)
  for (const page of entry.wiki_pages) {
    await assertWikiPageExists(specialist.paths.wiki, page)
  }
}

function validateSuccessEntryV1(source: IngestionSourceRecord, entry: IngestionManifestSourceSuccess): void {
  const expectedSourcePath = source.ingestion?.source_path ?? source.raw_path
  if (entry.source_path !== expectedSourcePath) {
    throw invalidManifest(`Manifest source_path for ${source.raw_path} does not match ${expectedSourcePath}.`)
  }
  validateCitationAndPages(source, entry)
}

function validateCitationAndPages(source: IngestionSourceRecord, entry: Pick<IngestionManifestSourceSuccess, 'raw_path' | 'wiki_pages' | 'citations'>): void {
  if (!Array.isArray(entry.wiki_pages) || entry.wiki_pages.length === 0 || entry.wiki_pages.some((page) => !isSafeRelativeWikiPage(page))) {
    throw invalidManifest(`Manifest wiki_pages for ${source.raw_path} are invalid.`)
  }
  if (!Array.isArray(entry.citations) || entry.citations.length === 0) {
    throw invalidManifest(`Manifest citations for ${source.raw_path} are missing.`)
  }

  for (const citation of entry.citations) {
    if (citation.source_file !== `raw/${source.raw_path}`) {
      throw invalidManifest(`Manifest citation source_file for ${source.raw_path} must be raw/${source.raw_path}.`)
    }
    if (!citation.source_title?.trim()) {
      throw invalidManifest(`Manifest citation title for ${source.raw_path} is missing.`)
    }
    if (!Array.isArray(citation.article_refs) || citation.article_refs.map((ref) => ref.trim()).filter(Boolean).length === 0) {
      throw invalidManifest(`Manifest citation article_refs for ${source.raw_path} are missing.`)
    }
  }
}

function validateFailureEntry(entry: IngestionManifestSourceFailure | AgentOwnedIngestionManifestSourceFailure): void {
  if (!entry.error_code?.trim() || !entry.error_message?.trim()) {
    throw invalidManifest(`Failed source ${entry.raw_path} is missing an error code or message.`)
  }
  if ('converted_path' in entry && entry.converted_path && !isSafeRelativeMarkdownPath(entry.converted_path)) {
    throw invalidManifest(`Failed source ${entry.raw_path} has an invalid converted_path.`)
  }
  if ('conversion_status' in entry && entry.conversion_status && !ALL_CONVERSION_STATUSES.has(entry.conversion_status)) {
    throw invalidManifest(`Failed source ${entry.raw_path} has an invalid conversion_status.`)
  }
}

function validateConvertedFrontmatter(
  source: IngestionSourceRecord,
  entry: AgentOwnedIngestionManifestSourceSuccess,
  text: string
): void {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/u)?.[1]
  if (!frontmatter) {
    throw invalidManifest(`Converted source ${entry.converted_path} is missing frontmatter.`)
  }
  if (readFrontmatterValue(frontmatter, 'type') !== 'Converted Source') {
    throw invalidManifest(`Converted source ${entry.converted_path} must have type: Converted Source.`)
  }
  if (readFrontmatterValue(frontmatter, 'source_sha256') !== source.checksum) {
    throw invalidManifest(`Converted source ${entry.converted_path} has a mismatched source_sha256.`)
  }
  if (readFrontmatterValue(frontmatter, 'conversion_status') !== entry.conversion_status) {
    throw invalidManifest(`Converted source ${entry.converted_path} has a mismatched conversion_status.`)
  }
}

function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const line = frontmatter.split('\n').find((item) => item.trim().startsWith(`${key}:`))
  if (!line) return undefined
  return line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/gu, '')
}

async function readConvertedMarkdown(root: string, path: string): Promise<{ text: string; checksum: string }> {
  const absolutePath = join(root, path)
  const fileStat = await stat(absolutePath).catch(() => undefined)
  if (!fileStat?.isFile()) {
    throw invalidManifest(`Converted source ${path} does not exist.`)
  }
  const buffer = await readFile(absolutePath)
  return { text: buffer.toString('utf8'), checksum: toChecksum(buffer) }
}

async function assertWikiPageExists(wikiRoot: string, page: string): Promise<void> {
  const pagePath = join(wikiRoot, page)
  const pageStat = await stat(pagePath).catch(() => undefined)
  if (!pageStat?.isFile()) {
    throw invalidManifest(`Manifest references missing wiki page ${page}.`)
  }
}

function isSafeRelativeWikiPage(page: string): boolean {
  return isSafeRelativeMarkdownPath(page)
}

function isSafeRelativeMarkdownPath(page: string): boolean {
  const normalized = normalize(page).split(sep).join('/')
  return page.trim().length > 0 && !isAbsolute(page) && !normalized.startsWith('../') && normalized !== '..' && normalized.toLowerCase().endsWith('.md')
}

function invalidManifest(message: string): PiIngestionError {
  return new PiIngestionError('INGESTION_MANIFEST_INVALID', message)
}

function assertSeenOnce(seen: Set<string>, rawPath: string): void {
  if (seen.has(rawPath)) throw invalidManifest(`Manifest references source ${rawPath} more than once.`)
  seen.add(rawPath)
}

function assertAllSourcesMentioned(sources: IngestionSourceRecord[], seen: Set<string>): void {
  for (const source of sources) {
    if (!seen.has(source.raw_path)) {
      throw invalidManifest(`Manifest does not mention pending source ${source.raw_path}.`)
    }
  }
}

function markIngestedFromManifest(
  source: IngestionSourceRecord,
  entry: ValidatedManifestSuccess,
  ingestedAt = new Date()
): void {
  const now = ingestedAt.toISOString()
  const convertedPath = entry.converted_path ?? entry.source_path
  source.status = 'ingested'
  source.error_code = undefined
  source.error_message = undefined
  source.ingested_at = now
  source.updated_at = now
  source.conversion = {
    ...source.conversion!,
    status: 'converted',
    markdown_path: convertedPath,
    ...(entry.converted_sha256 ? { markdown_checksum: entry.converted_sha256 } : {}),
    converted_at: now,
    updated_at: now,
    ...(entry.conversion_status ? { conversion_status: entry.conversion_status } : {}),
    warnings: entry.warnings?.map((warning) => warning.trim()).filter(Boolean),
    error_code: undefined,
    error_message: undefined
  }
  source.ingestion = {
    ...source.ingestion!,
    status: 'ingested',
    source_path: entry.source_path,
    ingested_at: now,
    updated_at: now,
    error_code: undefined,
    error_message: undefined,
    skipped_reason: undefined,
    wiki_pages: entry.wiki_pages,
    citations: entry.citations.map((citation) => ({
      source_file: citation.source_file.trim(),
      source_title: citation.source_title.trim(),
      article_refs: citation.article_refs.map((articleRef) => articleRef.trim()).filter(Boolean)
    })),
    warnings: entry.warnings?.map((warning) => warning.trim()).filter(Boolean),
    manifest_validated_at: now
  }
}

function markFailedFromManifest(source: IngestionSourceRecord, entry: ValidatedManifestFailure, failedAt = new Date()): void {
  const now = failedAt.toISOString()
  const failedDuringConversion = entry.stage === 'conversion' || entry.conversion_status === 'failed'
  source.status = 'failed'
  source.error_code = entry.error_code
  source.error_message = entry.error_message
  source.updated_at = now
  source.conversion = {
    ...source.conversion!,
    status: failedDuringConversion ? 'failed' : 'converted',
    markdown_path: entry.converted_path ?? source.conversion?.markdown_path ?? toConvertedMarkdownPath(source.raw_path),
    ...(entry.conversion_status ? { conversion_status: entry.conversion_status } : {}),
    updated_at: now,
    ...(failedDuringConversion
      ? { error_code: entry.error_code, error_message: entry.error_message }
      : { error_code: undefined, error_message: undefined })
  }
  source.ingestion = {
    ...source.ingestion!,
    status: 'failed',
    source_path: entry.source_path ?? entry.converted_path ?? source.ingestion?.source_path ?? toConvertedMarkdownPath(source.raw_path),
    updated_at: now,
    error_code: entry.error_code,
    error_message: entry.error_message
  }
}

function cloneSource(source: IngestionSourceRecord): IngestionSourceRecord {
  return JSON.parse(JSON.stringify(source)) as IngestionSourceRecord
}

function restoreOriginalSources(state: IngestionState, originals: Map<string, IngestionSourceRecord>): void {
  for (const [rawPath, source] of originals) {
    state.sources[rawPath] = source
  }
}

async function hasWikiMarkdownFiles(root: string): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })

  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory() && await hasWikiMarkdownFiles(entryPath)) {
      return true
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      return true
    }
  }

  return false
}

function markIngestedSourcesWithMissingWikiOutput(state: IngestionState, now: Date): void {
  for (const source of Object.values(state.sources)) {
    if (source.status === 'ingested' || source.ingestion?.status === 'ingested') {
      markFailed(
        source,
        'WIKI_OUTPUT_MISSING',
        'Pi ingestion completed without creating wiki Markdown files.',
        now
      )
    }
  }
}

function markProcessing(source: IngestionSourceRecord): void {
  const now = new Date().toISOString()
  source.status = 'processing'
  source.error_code = undefined
  source.error_message = undefined
  source.updated_at = now
  source.conversion = {
    ...source.conversion!,
    status: 'processing',
    markdown_path: source.conversion?.markdown_path ?? toConvertedMarkdownPath(source.raw_path),
    updated_at: now,
    error_code: undefined,
    error_message: undefined
  }
  source.ingestion = {
    ...source.ingestion!,
    status: 'processing',
    source_path: source.ingestion?.source_path ?? source.conversion.markdown_path,
    updated_at: now,
    error_code: undefined,
    error_message: undefined
  }
}

function markIngested(source: IngestionSourceRecord): void {
  const now = new Date().toISOString()
  source.status = 'ingested'
  source.error_code = undefined
  source.error_message = undefined
  source.ingested_at = now
  source.updated_at = now
  source.conversion = {
    ...source.conversion!,
    status: 'converted',
    markdown_path: source.conversion?.markdown_path ?? toConvertedMarkdownPath(source.raw_path),
    converted_at: now,
    updated_at: now,
    error_code: undefined,
    error_message: undefined
  }
  source.ingestion = {
    ...source.ingestion!,
    status: 'ingested',
    ingested_at: now,
    updated_at: now,
    error_code: undefined,
    error_message: undefined,
    skipped_reason: undefined
  }
}

function markFailed(source: IngestionSourceRecord, errorCode: string, errorMessage: string, failedAt = new Date()): void {
  const now = failedAt.toISOString()
  source.status = 'failed'
  source.error_code = errorCode
  source.error_message = errorMessage
  source.updated_at = now
  if (source.conversion?.status === 'processing') {
    source.conversion = {
      ...source.conversion,
      status: 'failed',
      updated_at: now,
      error_code: errorCode,
      error_message: errorMessage
    }
  }
  source.ingestion = {
    ...source.ingestion!,
    status: 'failed',
    updated_at: now,
    error_code: errorCode,
    error_message: errorMessage
  }
}

function toChecksum(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
