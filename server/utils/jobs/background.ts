import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { recordAdminAuditEvent } from '../admin/audit'
import { deleteChatSessionsForSpecialist } from '../chat/session-store'
import { resolveAppConfig } from '../config'
import { initializeDatabase } from '../db'
import type { PiConversionRunner } from '../ingestion/conversion'
import type { PiIngestionRunner } from '../ingestion/pi-runner'
import { scanSpecialistRawSources } from '../ingestion/detect'
import { runPendingIngestion } from '../ingestion/run'
import { assertSpecialistInitializedWorkspace, createPiSdkSpecialistInitializationRunner, type SpecialistInitializationRunner } from '../specialists/initialization'
import { loadSpecialistsFromDisk } from '../specialists/loader'
import { editSpecialist, resetSpecialistWorkspace, rollbackSpecialistCreation } from '../specialists/manager'

export type BackgroundJobType = 'specialist_initialization' | 'specialist_ingestion' | 'specialist_hard_reset' | 'specialist_derivation'
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
  requested_by_user_id: string | null
  requested_by_contact: string | null
  derivation_event_id: string | null
  derivation_target_path: string | null
}

export interface DerivationJob {
  id: string
  specialistId: string
  eventId: string
  targetPath: string
}

export interface DerivationJobRunner {
  run(job: DerivationJob): Promise<void>
}

export interface RunDueBackgroundJobsOptions {
  database: DatabaseSync
  dataDir?: string
  piConversionEnabled?: boolean
  piIngestionEnabled?: boolean
  conversionRunner?: PiConversionRunner
  initializationRunner?: SpecialistInitializationRunner
  derivationRunner?: DerivationJobRunner
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

export function enqueueSpecialistDerivationJob(
  database: DatabaseSync,
  input: {
    specialistId: string
    eventId: string
    targetPath: string
    requestedByUserId: string
    requestedByContact: string
    now?: Date
  }
): BackgroundJobRecord {
  return enqueueSpecialistJob(database, {
    specialistId: input.specialistId,
    type: 'specialist_derivation',
    requestedByUserId: input.requestedByUserId,
    requestedByContact: input.requestedByContact,
    derivationEventId: input.eventId,
    derivationTargetPath: input.targetPath,
    ...(input.now ? { now: input.now } : {})
  })
}

export function enqueueSpecialistHardResetJob(
  database: DatabaseSync,
  input: { specialistId: string; requestedByUserId: string; requestedByContact: string; now?: Date }
): BackgroundJobRecord {
  return enqueueSpecialistJob(database, {
    specialistId: input.specialistId,
    type: 'specialist_hard_reset',
    requestedByUserId: input.requestedByUserId,
    requestedByContact: input.requestedByContact,
    ...(input.now ? { now: input.now } : {})
  })
}

export class BackgroundJobConflictError extends Error {
  constructor() {
    super('Specialist already has an active background job.')
    this.name = 'BackgroundJobConflictError'
  }
}

function enqueueSpecialistJob(
  database: DatabaseSync,
  input: {
    specialistId: string
    type: BackgroundJobType
    now?: Date
    requestedByUserId?: string
    requestedByContact?: string
    derivationEventId?: string
    derivationTargetPath?: string
  }
): BackgroundJobRecord {
  const active = findActiveSpecialistJob(database, input.specialistId)
  if (active) {
    if (active.type === input.type && input.type !== 'specialist_hard_reset' &&
      (input.type !== 'specialist_derivation' || active.derivation_event_id === input.derivationEventId)) return active
    throw new BackgroundJobConflictError()
  }

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
    completed_at: null,
    requested_by_user_id: input.requestedByUserId ?? null,
    requested_by_contact: input.requestedByContact ?? null,
    derivation_event_id: input.derivationEventId ?? null,
    derivation_target_path: input.derivationTargetPath ?? null
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
          completed_at,
          requested_by_user_id,
          requested_by_contact,
          derivation_event_id,
          derivation_target_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        job.completed_at,
        job.requested_by_user_id,
        job.requested_by_contact,
        job.derivation_event_id,
        job.derivation_target_path
      )
  } catch (error) {
    const activeAfterConflict = findActiveSpecialistJob(database, input.specialistId)
    if (activeAfterConflict && activeAfterConflict.type === input.type && input.type !== 'specialist_hard_reset' &&
      (input.type !== 'specialist_derivation' || activeAfterConflict.derivation_event_id === input.derivationEventId)) return activeAfterConflict
    if (activeAfterConflict) throw new BackgroundJobConflictError()
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
      recordHardResetAudit(options.database, locked, 'completed')
      result.succeeded += 1
    } catch (error) {
      markJobFailed(options.database, locked, error, new Date())
      recordHardResetAudit(options.database, locked, 'failed', error)
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
  specialistId: string
): BackgroundJobRecord | undefined {
  return database
    .prepare(`
      SELECT *
      FROM background_jobs
      WHERE specialist_id = ?
        AND status IN ('queued', 'running')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `)
    .get(specialistId) as BackgroundJobRecord | undefined
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
  if (job.type === 'specialist_hard_reset') {
    await runSpecialistHardResetJob(job, options)
    return
  }
  if (job.type === 'specialist_derivation') {
    if (!job.derivation_event_id || !job.derivation_target_path) {
      throw createJobError('DERIVATION_JOB_INVALID', 'Derivation job is incomplete.')
    }
    const derivationRunner = options.derivationRunner ??
      (await import('../analytics/derivation-runner')).createPiDerivationJobRunner({
        database: options.database,
        dataDir: options.dataDir
      })
    await derivationRunner.run({
      id: job.id,
      specialistId: job.specialist_id,
      eventId: job.derivation_event_id,
      targetPath: job.derivation_target_path
    })
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

async function runSpecialistHardResetJob(
  job: BackgroundJobRecord,
  options: RunDueBackgroundJobsOptions
): Promise<void> {
  const dataDir = options.dataDir ?? resolveAppConfig().dataDir
  try {
    await editSpecialist(job.specialist_id, { status: 'initializing' }, { dataDir })
    await deleteChatSessionsForSpecialist({ dataDir, specialistId: job.specialist_id })
    purgeSpecialistAssociatedData(options.database, job.specialist_id)
    const specialist = await resetSpecialistWorkspace(job.specialist_id, { dataDir })
    await (options.initializationRunner ?? createPiSdkSpecialistInitializationRunner()).initializeSpecialist(specialist)
    await assertSpecialistInitializedWorkspace(specialist)
    await scanSpecialistRawSources(specialist)
    await editSpecialist(specialist.id, { status: 'awaiting_sources' }, { dataDir })
  } catch (error) {
    await editSpecialist(job.specialist_id, { status: 'failed' }, { dataDir }).catch(() => undefined)
    throw error
  }
}

function purgeSpecialistAssociatedData(database: DatabaseSync, specialistId: string): void {
  database.exec('BEGIN')
  try {
    database.prepare('DELETE FROM question_analytics_reviews WHERE specialist_id = ?').run(specialistId)
    database.prepare('DELETE FROM question_analytics_events WHERE specialist_id = ?').run(specialistId)
    database.prepare('DELETE FROM conversations WHERE specialist_id = ?').run(specialistId)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
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

  await runPendingIngestion(specialist, {
    piIngestionEnabled: options.piIngestionEnabled,
    ...(options.runner ? { runner: options.runner } : {})
  })
}

function recordHardResetAudit(
  database: DatabaseSync,
  job: BackgroundJobRecord,
  outcome: 'completed' | 'failed',
  error?: unknown
): void {
  if (job.type !== 'specialist_hard_reset' || !job.requested_by_user_id || !job.requested_by_contact) return
  recordAdminAuditEvent(database, {
    admin: {
      adminContact: job.requested_by_contact,
      user: { id: job.requested_by_user_id, displayContact: job.requested_by_contact }
    },
    action: outcome === 'completed' ? 'specialist_hard_reset_completed' : 'specialist_hard_reset_failed',
    specialistId: job.specialist_id,
    metadata: {
      job_id: job.id,
      ...(error ? { error_code: resolveErrorCode(error) } : {})
    }
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

function markJobFailed(database: DatabaseSync, job: BackgroundJobRecord, error: unknown, failedAt: Date): void {
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
    .run(
      resolveErrorCode(error),
      job.type === 'specialist_derivation' ? 'Derivation job failed.' : sanitizeErrorMessage(error),
      now,
      now,
      job.id
    )
}

async function rollbackSpecialistInitialization(dataDir: string, specialistId: string): Promise<void> {
  await rollbackSpecialistCreation(specialistId, { dataDir })
}

async function runScheduledBackgroundJobs(dataDir: string | undefined): Promise<void> {
  const database = await initializeDatabase()
  await runDueBackgroundJobs({
    database,
    ...(dataDir ? { dataDir } : {}),
    piConversionEnabled: process.env.UJIMU_PI_CONVERSION_ENABLED === 'true',
    piIngestionEnabled: process.env.UJIMU_PI_INGESTION_ENABLED === 'true'
  })
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
