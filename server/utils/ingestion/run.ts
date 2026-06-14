import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { scanSpecialistRawSources } from './detect'
import { createPiSdkIngestionRunner, PiIngestionError, type PiBatchIngestionResult, type PiIngestionRunner } from './pi-runner'
import { editSpecialist } from '../specialists/manager'
import { writeIngestionState } from './state'
import type { IngestionManifest, IngestionManifestSourceSuccess, IngestionSourceRecord, IngestionState } from './types'
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
  const ingestion = source.ingestion
  if (!ingestion) {
    return source.status === 'pending' || source.status === 'failed'
  }

  if (ingestion.status === 'pending' || ingestion.status === 'failed') {
    return isMarkdownReady(source)
  }

  if (ingestion.status === 'processing') {
    const updatedAt = ingestion.updated_at ?? source.updated_at
    return isMarkdownReady(source) && Number.isFinite(Date.parse(updatedAt)) && now.getTime() - Date.parse(updatedAt) > staleCutoffMs
  }

  return false
}

function isMarkdownReady(source: IngestionSourceRecord): boolean {
  return source.conversion?.status === 'converted' || source.conversion?.status === 'not_required' || !source.conversion
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
  await validateManifest(specialist, sources, manifest)
  const now = new Date()
  const successfulByRawPath = new Map(manifest.ingested.map((entry) => [entry.raw_path, entry]))
  const failedByRawPath = new Map(manifest.failed.map((entry) => [entry.raw_path, entry]))
  let successful = 0

  for (const source of sources) {
    const successEntry = successfulByRawPath.get(source.raw_path)
    if (successEntry) {
      markIngestedFromManifest(source, successEntry, now)
      successful += 1
      continue
    }

    const failureEntry = failedByRawPath.get(source.raw_path)!
    markFailed(source, failureEntry.error_code, failureEntry.error_message, now)
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
): Promise<void> {
  if (!manifest || manifest.version !== 1 || manifest.specialist_id !== specialist.id) {
    throw invalidManifest('Manifest version or specialist id is invalid.')
  }
  if (!Array.isArray(manifest.ingested) || !Array.isArray(manifest.failed)) {
    throw invalidManifest('Manifest ingested and failed fields must be arrays.')
  }

  const expected = new Map(sources.map((source) => [source.raw_path, source]))
  const seen = new Set<string>()

  for (const entry of manifest.ingested) {
    const source = expected.get(entry.raw_path)
    if (!source) throw invalidManifest(`Manifest references unknown source ${entry.raw_path}.`)
    if (seen.has(entry.raw_path)) throw invalidManifest(`Manifest references source ${entry.raw_path} more than once.`)
    seen.add(entry.raw_path)
    validateSuccessEntry(source, entry)
    for (const page of entry.wiki_pages) {
      await assertWikiPageExists(specialist.paths.wiki, page)
    }
  }

  for (const entry of manifest.failed) {
    const source = expected.get(entry.raw_path)
    if (!source) throw invalidManifest(`Manifest references unknown failed source ${entry.raw_path}.`)
    if (seen.has(entry.raw_path)) throw invalidManifest(`Manifest references source ${entry.raw_path} more than once.`)
    seen.add(entry.raw_path)
    if (!entry.error_code?.trim() || !entry.error_message?.trim()) {
      throw invalidManifest(`Failed source ${entry.raw_path} is missing an error code or message.`)
    }
  }

  for (const source of sources) {
    if (!seen.has(source.raw_path)) {
      throw invalidManifest(`Manifest does not mention pending source ${source.raw_path}.`)
    }
  }
}

function validateSuccessEntry(source: IngestionSourceRecord, entry: IngestionManifestSourceSuccess): void {
  const expectedSourcePath = source.ingestion?.source_path ?? source.raw_path
  if (entry.source_path !== expectedSourcePath) {
    throw invalidManifest(`Manifest source_path for ${source.raw_path} does not match ${expectedSourcePath}.`)
  }
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

async function assertWikiPageExists(wikiRoot: string, page: string): Promise<void> {
  const pagePath = join(wikiRoot, page)
  const pageStat = await stat(pagePath).catch(() => undefined)
  if (!pageStat?.isFile()) {
    throw invalidManifest(`Manifest references missing wiki page ${page}.`)
  }
}

function isSafeRelativeWikiPage(page: string): boolean {
  const normalized = normalize(page).split(sep).join('/')
  return page.trim().length > 0 && !isAbsolute(page) && !normalized.startsWith('../') && normalized !== '..' && normalized.toLowerCase().endsWith('.md')
}

function invalidManifest(message: string): PiIngestionError {
  return new PiIngestionError('INGESTION_MANIFEST_INVALID', message)
}

function markIngestedFromManifest(
  source: IngestionSourceRecord,
  entry: IngestionManifestSourceSuccess,
  ingestedAt = new Date()
): void {
  const now = ingestedAt.toISOString()
  source.status = 'ingested'
  source.error_code = undefined
  source.error_message = undefined
  source.ingested_at = now
  source.updated_at = now
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
  source.ingestion = {
    status: 'processing',
    source_path: source.ingestion?.source_path ?? source.raw_path,
    updated_at: now
  }
}

function markIngested(source: IngestionSourceRecord): void {
  const now = new Date().toISOString()
  source.status = 'ingested'
  source.error_code = undefined
  source.error_message = undefined
  source.ingested_at = now
  source.updated_at = now
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
  source.ingestion = {
    ...source.ingestion!,
    status: 'failed',
    updated_at: now,
    error_code: errorCode,
    error_message: errorMessage
  }
}
