import type { SpecialistRuntime } from '../specialists/schema'
import { isPdfSource, isTextSource, scanSpecialistRawSources } from './detect'
import { createPiSdkIngestionRunner, PiIngestionError, type PiIngestionRunner } from './pi-runner'
import { writeIngestionState } from './state'
import type { IngestionSourceRecord, IngestionState } from './types'

export interface RunPendingIngestionOptions {
  piIngestionEnabled?: boolean
  runner?: PiIngestionRunner
  timeoutMs?: number
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
  const pendingSources = Object.values(state.sources)
    .filter((source) => source.status === 'pending')
    .sort((left, right) => left.raw_path.localeCompare(right.raw_path))

  if (pendingSources.length === 0) {
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

async function processSource(input: {
  specialist: SpecialistRuntime
  state: IngestionState
  source: IngestionSourceRecord
  runner: PiIngestionRunner
  timeoutMs?: number
}): Promise<void> {
  const { specialist, state, source, runner, timeoutMs } = input

  if (isPdfSource(source.raw_path)) {
    markFailed(source, 'UNSUPPORTED_SOURCE_TYPE', 'PDF text extraction is not available in this slice.')
    await writeIngestionState(specialist.paths.ingestState, state)
    return
  }

  if (!isTextSource(source.raw_path)) {
    markFailed(source, 'UNSUPPORTED_SOURCE_TYPE', 'Source type is not supported for ingestion.')
    await writeIngestionState(specialist.paths.ingestState, state)
    return
  }

  markProcessing(source)
  await writeIngestionState(specialist.paths.ingestState, state)

  try {
    await runner.ingestSource(specialist, source, { timeoutMs })
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

function markProcessing(source: IngestionSourceRecord): void {
  source.status = 'processing'
  source.error_code = undefined
  source.error_message = undefined
  source.updated_at = new Date().toISOString()
}

function markIngested(source: IngestionSourceRecord): void {
  const now = new Date().toISOString()
  source.status = 'ingested'
  source.error_code = undefined
  source.error_message = undefined
  source.ingested_at = now
  source.updated_at = now
}

function markFailed(source: IngestionSourceRecord, errorCode: string, errorMessage: string): void {
  source.status = 'failed'
  source.error_code = errorCode
  source.error_message = errorMessage
  source.updated_at = new Date().toISOString()
}
