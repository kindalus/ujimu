import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { resolveAppConfig } from '../config'
import { initializeDatabase } from '../db'
import { runPendingConversions, type PiConversionRunner } from '../ingestion/conversion'
import type { PiIngestionRunner } from '../ingestion/pi-runner'
import { runPendingIngestion } from '../ingestion/run'
import { assertSpecialistInitializedWorkspace, createPiSdkSpecialistInitializationRunner, type SpecialistInitializationRunner } from '../specialists/initialization'
import { loadSpecialistsFromDisk } from '../specialists/loader'
import { editSpecialist, rollbackSpecialistCreation } from '../specialists/manager'

export type BackgroundJobType = 'specialist_initialization' | 'specialist_ingestion'
export type BackgroundJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface BackgroundJobRecord {
  id: string
  type: BackgroundJobType
  specialist_id: string
  status: BackgroundJobStatus
  attempts: number
  max_attempts: number
  locked_at: string | null
  locked_by: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface RunDueBackgroundJobsOptions {
  database: DatabaseSync
  dataDir?: string
  piConversionEnabled?: boolean
  piIngestionEnabled?: boolean
  conversionRunner?: PiConversionRunner
  initializationRunner?: SpecialistInitializationRunner
  runner?: PiIngestionRunner
  now?: Date
  limit?: number
  workerId?: string
  staleRunningMinutes?: number
}

export interface RunDueBackgroundJobsResult {
  processed: number
  succeeded: number
  failed: number
}

let backgroundRunScheduled = false

export function enqueueSpecialistInitializationJob(
  database: DatabaseSync,
  input: { specialistId: string; now?: Date }
): BackgroundJobRecord {
  return enqueueSpecialistJob(database, { ...input, type: 'specialist_initialization' })
}

export function enqueueSpecialistIngestionJob(
  database: DatabaseSync,
  input: { specialistId: string; now?: Date }
): BackgroundJobRecord {
  return enqueueSpecialistJob(database, { ...input, type: 'specialist_ingestion' })
}

function enqueueSpecialistJob(
  database: DatabaseSync,
  input: { specialistId: string; type: BackgroundJobType; now?: Date }
): BackgroundJobRecord {
  const existing = findActiveSpecialistJob(database, input.specialistId, input.type)
  if (existing) return existing

  const now = (input.now ?? new Date()).toISOString()
  const job: BackgroundJobRecord = {
    id: randomUUID(),
    type: input.type,
    specialist_id: input.specialistId,
    status: 'queued',
    attempts: 0,
    max_attempts: 3,
    locked_at: null,
    locked_by: null,
    last_error_code: null,
    last_error_message: null,
    created_at: now,
    updated_at: now,
    completed_at: null
  }

  try {
    database
      .prepare(`
        INSERT INTO background_jobs (
          id,
          type,
          specialist_id,
          status,
          attempts,
          max_attempts,
          locked_at,
          locked_by,
          last_error_code,
          last_error_message,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        job.id,
        job.type,
        job.specialist_id,
        job.status,
        job.attempts,
        job.max_attempts,
        job.locked_at,
        job.locked_by,
        job.last_error_code,
        job.last_error_message,
        job.created_at,
        job.updated_at,
        job.completed_at
      )
  } catch (error) {
    const active = findActiveSpecialistJob(database, input.specialistId, input.type)
    if (active) return active
    throw error
  }

  return job
}

export async function runDueBackgroundJobs(
  options: RunDueBackgroundJobsOptions
): Promise<RunDueBackgroundJobsResult> {
  const now = options.now ?? new Date()
  const workerId = options.workerId ?? defaultWorkerId()
  const jobs = findDueJobs(options.database, {
    now,
    limit: options.limit ?? 10,
    staleRunningMinutes: options.staleRunningMinutes ?? 10
  })
  const result: RunDueBackgroundJobsResult = { processed: 0, succeeded: 0, failed: 0 }

  for (const job of jobs) {
    const locked = lockJob(options.database, job.id, { now, workerId })
    if (!locked) continue

    result.processed += 1
    try {
      await runBackgroundJob(locked, options)
      markJobSucceeded(options.database, locked.id, new Date())
      result.succeeded += 1
    } catch (error) {
      markJobFailed(options.database, locked.id, error, new Date())
      result.failed += 1
    }
  }

  return result
}

export function scheduleDueBackgroundJobs(options: { dataDir?: string; env?: Record<string, string | undefined> } = {}): void {
  const env = options.env ?? process.env
  if (env.NODE_ENV === 'test' || env.VITEST) return
  if (backgroundRunScheduled) return

  backgroundRunScheduled = true
  const timer = setTimeout(() => {
    backgroundRunScheduled = false
    void runScheduledBackgroundJobs(options.dataDir).catch(() => undefined)
  }, 0)
  timer.unref?.()
}

function findActiveSpecialistJob(
  database: DatabaseSync,
  specialistId: string,
  type: BackgroundJobType
): BackgroundJobRecord | undefined {
  return database
    .prepare(`
      SELECT *
      FROM background_jobs
      WHERE type = ?
        AND specialist_id = ?
        AND status IN ('queued', 'running')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `)
    .get(type, specialistId) as BackgroundJobRecord | undefined
}

function findDueJobs(
  database: DatabaseSync,
  input: { now: Date; limit: number; staleRunningMinutes: number }
): BackgroundJobRecord[] {
  const staleBefore = new Date(input.now.getTime() - input.staleRunningMinutes * 60 * 1000).toISOString()
  return database
    .prepare(`
      SELECT *
      FROM background_jobs
      WHERE status = 'queued'
        OR (status = 'running' AND locked_at IS NOT NULL AND locked_at < ?)
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `)
    .all(staleBefore, input.limit) as unknown as BackgroundJobRecord[]
}

function lockJob(
  database: DatabaseSync,
  jobId: string,
  input: { now: Date; workerId: string }
): BackgroundJobRecord | undefined {
  database
    .prepare(`
      UPDATE background_jobs
      SET status = 'running',
          attempts = attempts + 1,
          locked_at = ?,
          locked_by = ?,
          updated_at = ?,
          last_error_code = NULL,
          last_error_message = NULL
      WHERE id = ?
        AND status IN ('queued', 'running')
    `)
    .run(input.now.toISOString(), input.workerId, input.now.toISOString(), jobId)

  const locked = database
    .prepare('SELECT * FROM background_jobs WHERE id = ?')
    .get(jobId) as BackgroundJobRecord | undefined

  return locked?.status === 'running' && locked.locked_by === input.workerId ? locked : undefined
}

async function runBackgroundJob(
  job: BackgroundJobRecord,
  options: RunDueBackgroundJobsOptions
): Promise<void> {
  if (job.type === 'specialist_initialization') {
    await runSpecialistInitializationJob(job, options)
    return
  }

  await runSpecialistIngestionJob(job, options)
}

async function runSpecialistInitializationJob(
  job: BackgroundJobRecord,
  options: RunDueBackgroundJobsOptions
): Promise<void> {
  const dataDir = options.dataDir ?? resolveAppConfig().dataDir
  const snapshot = await loadSpecialistsFromDisk({ dataDir })
  const specialist = snapshot.specialists.find((item) => item.id === job.specialist_id)
  if (!specialist) {
    throw createJobError('SPECIALIST_NOT_FOUND', `Specialist "${job.specialist_id}" was not found.`)
  }

  try {
    await (options.initializationRunner ?? createPiSdkSpecialistInitializationRunner()).initializeSpecialist(specialist)
    await assertSpecialistInitializedWorkspace(specialist)
    await editSpecialist(specialist.id, { status: 'awaiting_sources' }, { dataDir })
  } catch (error) {
    await rollbackSpecialistInitialization(dataDir, specialist.id)
    throw error
  }
}

async function runSpecialistIngestionJob(
  job: BackgroundJobRecord,
  options: RunDueBackgroundJobsOptions
): Promise<void> {
  const dataDir = options.dataDir ?? resolveAppConfig().dataDir
  const snapshot = await loadSpecialistsFromDisk({ dataDir })
  const specialist = snapshot.specialists.find((item) => item.id === job.specialist_id)
  if (!specialist) {
    throw createJobError('SPECIALIST_NOT_FOUND', `Specialist "${job.specialist_id}" was not found.`)
  }

  await runPendingConversions(specialist, {
    piConversionEnabled: options.piConversionEnabled,
    ...(options.conversionRunner ? { runner: options.conversionRunner } : {})
  })

  await runPendingIngestion(specialist, {
    piIngestionEnabled: options.piIngestionEnabled,
    ...(options.runner ? { runner: options.runner } : {})
  })
}

function markJobSucceeded(database: DatabaseSync, jobId: string, completedAt: Date): void {
  const now = completedAt.toISOString()
  database
    .prepare(`
      UPDATE background_jobs
      SET status = 'succeeded',
          locked_at = NULL,
          locked_by = NULL,
          last_error_code = NULL,
          last_error_message = NULL,
          updated_at = ?,
          completed_at = ?
      WHERE id = ?
    `)
    .run(now, now, jobId)
}

function markJobFailed(database: DatabaseSync, jobId: string, error: unknown, failedAt: Date): void {
  const now = failedAt.toISOString()
  database
    .prepare(`
      UPDATE background_jobs
      SET status = 'failed',
          locked_at = NULL,
          locked_by = NULL,
          last_error_code = ?,
          last_error_message = ?,
          updated_at = ?,
          completed_at = ?
      WHERE id = ?
    `)
    .run(resolveErrorCode(error), sanitizeErrorMessage(error), now, now, jobId)
}

async function rollbackSpecialistInitialization(dataDir: string, specialistId: string): Promise<void> {
  await rollbackSpecialistCreation(specialistId, { dataDir })
}

async function runScheduledBackgroundJobs(dataDir: string | undefined): Promise<void> {
  const database = await initializeDatabase()
  try {
    await runDueBackgroundJobs({
      database,
      ...(dataDir ? { dataDir } : {}),
      piConversionEnabled: process.env.UJIMU_PI_CONVERSION_ENABLED === 'true',
      piIngestionEnabled: process.env.UJIMU_PI_INGESTION_ENABLED === 'true'
    })
  } finally {
    database.close()
  }
}

function createJobError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 80)
  }

  return 'JOB_FAILED'
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Background job failed.'
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

function defaultWorkerId(): string {
  return `ujimu-${process.pid}-${hostname()}`
}
