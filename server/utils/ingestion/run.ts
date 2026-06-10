import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { scanSpecialistRawSources } from './detect'
import { createPiSdkIngestionRunner, PiIngestionError, type PiIngestionRunner } from './pi-runner'
import { writeIngestionState } from './state'
import type { IngestionSourceRecord, IngestionState } from './types'
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

  for (const source of pendingSources) {
    await processSource({ specialist, state, source, runner, timeoutMs: options.timeoutMs })
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
