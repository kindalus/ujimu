import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ChatCitation, ChatConversationContextMessage } from '../chat/types'
import {
  BackgroundJobConflictError,
  enqueueAnswerVerificationBackgroundJob,
  type AnswerVerificationJob,
  type BackgroundJobRecord
} from '../jobs/background'

export type AnswerVerificationStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'needs_admin_source'

export interface DerivedPageRevision {
  path: string
  revisionSha256: string
}

export interface AnswerVerificationBaseline {
  answer: string
  citations: ChatCitation[]
  consultedDocuments: string[]
}

export type AnswerAlignmentLevel =
  | 'FIEL'
  | 'MUITO_ALINHADO'
  | 'ALINHADO'
  | 'POUCO_ALINHADO'
  | 'NAO_ALINHADO'

export interface AnswerAlignmentJudgement {
  level: AnswerAlignmentLevel
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

export interface NegativeDerivedAttribution {
  negativeDerivedPaths: string[]
  reason: string
}

export type DerivedRepairOutcome =
  | { status: 'accepted'; revisions: DerivedPageRevision[] }
  | { status: 'needs_admin_source'; reason: string }

export interface AnswerVerificationExecutionResult {
  baseline: AnswerVerificationBaseline
  judgement: AnswerAlignmentJudgement
  attribution?: NegativeDerivedAttribution
  repair?: DerivedRepairOutcome
}

export interface AnswerVerificationRecord {
  id: string
  sourceEventId: string
  specialistId: string
  status: AnswerVerificationStatus
  sampleReason: 'first_revision' | 'random'
  originalAnswer: string | null
  originalCitations: ChatCitation[]
  conversationContext: ChatConversationContextMessage[]
  derivedPages: DerivedPageRevision[]
  baseline: AnswerVerificationBaseline | null
  controlDocuments: string[]
  judgement: AnswerAlignmentJudgement | null
  negativeDerivedPaths: string[]
  attributionReason: string | null
  repairReason: string | null
  jobId: string | null
  createdAt: string
  updatedAt: string
}

export async function enqueueDerivedAnswerVerification(
  database: DatabaseSync,
  input: {
    sourceEventId: string
    specialistRoot: string
    originalAnswer: string
    originalCitations: ChatCitation[]
    conversationContext: ChatConversationContextMessage[]
    consultedDocuments: string[]
    now?: Date
  }
): Promise<AnswerVerificationRecord | undefined> {
  const existing = readAnswerVerificationByEvent(database, input.sourceEventId)
  if (existing) return existing

  const derivedPages = await readDerivedPageRevisions(input.specialistRoot, input.consultedDocuments)
  if (derivedPages.length === 0) return undefined

  const event = database.prepare(`
    SELECT specialist_id, outcome
    FROM question_analytics_events
    WHERE id = ?
  `).get(input.sourceEventId) as { specialist_id: string; outcome: string } | undefined
  if (!event || event.outcome !== 'answered') return undefined

  const quality = readPageQuality(database, event.specialist_id, derivedPages.map((page) => page.path))
  const firstRevision = derivedPages.some((page) => quality.get(page.path)?.revision_sha256 !== page.revisionSha256)
  const quarantinedPath = derivedPages.some((page) => quality.get(page.path)?.status === 'quarantined')
  if (quarantinedPath) return undefined
  const pendingCurrentRevision = derivedPages.some((page) => {
    const record = quality.get(page.path)
    return record?.revision_sha256 === page.revisionSha256 && record.status === 'pending'
  })
  if (!firstRevision && (pendingCurrentRevision || !isTenPercentSample(input.sourceEventId))) return undefined

  const now = (input.now ?? new Date()).toISOString()
  const id = randomUUID()
  database.exec('BEGIN IMMEDIATE')
  try {
    const repeated = readAnswerVerificationByEvent(database, input.sourceEventId)
    if (repeated) {
      database.exec('COMMIT')
      return repeated
    }

    database.prepare(`
      INSERT INTO answer_verifications (
        id, event_id, specialist_id, status, sample_reason,
        original_answer, original_citations_json, conversation_context_json,
        derived_pages_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceEventId,
      event.specialist_id,
      firstRevision ? 'first_revision' : 'random',
      input.originalAnswer,
      JSON.stringify(input.originalCitations),
      JSON.stringify(input.conversationContext),
      JSON.stringify(derivedPages),
      now,
      now
    )

    const upsertQuality = database.prepare(`
      INSERT INTO derived_page_quality (
        specialist_id, wiki_path, revision_sha256, status, verification_id, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?)
      ON CONFLICT (specialist_id, wiki_path) DO UPDATE SET
        revision_sha256 = excluded.revision_sha256,
        status = 'pending',
        verification_id = excluded.verification_id,
        updated_at = excluded.updated_at
    `)
    for (const page of derivedPages) {
      upsertQuality.run(event.specialist_id, page.path, page.revisionSha256, id, now)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    const repeated = readAnswerVerificationByEvent(database, input.sourceEventId)
    if (repeated) return repeated
    throw error
  }

  promotePendingAnswerVerificationJobs(database, { now: input.now })
  return readAnswerVerification(database, id)
}

export function promotePendingAnswerVerificationJobs(
  database: DatabaseSync,
  input: { now?: Date } = {}
): BackgroundJobRecord[] {
  const pending = database.prepare(`
    SELECT verifications.id, verifications.specialist_id
    FROM answer_verifications AS verifications
    WHERE verifications.status = 'pending'
      AND verifications.job_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM background_jobs
        WHERE background_jobs.specialist_id = verifications.specialist_id
          AND background_jobs.status IN ('queued', 'running')
      )
    ORDER BY verifications.created_at, verifications.id
  `).all() as Array<{ id: string; specialist_id: string }>
  const claimedSpecialists = new Set<string>()
  const jobs: BackgroundJobRecord[] = []

  for (const verification of pending) {
    if (claimedSpecialists.has(verification.specialist_id)) continue
    try {
      const job = enqueueAnswerVerificationBackgroundJob(database, {
        specialistId: verification.specialist_id,
        verificationId: verification.id,
        ...(input.now ? { now: input.now } : {})
      })
      database.prepare(`
        UPDATE answer_verifications
        SET status = 'queued', job_id = ?, updated_at = ?
        WHERE id = ? AND status = 'pending' AND job_id IS NULL
      `).run(job.id, (input.now ?? new Date()).toISOString(), verification.id)
      claimedSpecialists.add(verification.specialist_id)
      jobs.push(job)
    } catch (error) {
      if (!(error instanceof BackgroundJobConflictError)) throw error
    }
  }
  return jobs
}

export function readAnswerVerification(
  database: DatabaseSync,
  verificationId: string
): AnswerVerificationRecord | undefined {
  const row = database.prepare('SELECT * FROM answer_verifications WHERE id = ?').get(verificationId)
  return row ? mapVerificationRow(row) : undefined
}

export function readAnswerVerificationJob(
  database: DatabaseSync,
  jobId: string
): AnswerVerificationJob | undefined {
  const row = database.prepare(`
    SELECT verifications.id, verifications.event_id, verifications.specialist_id
    FROM answer_verifications AS verifications
    WHERE verifications.job_id = ?
  `).get(jobId) as { id: string; event_id: string; specialist_id: string } | undefined
  return row ? {
    id: jobId,
    verificationId: row.id,
    sourceEventId: row.event_id,
    specialistId: row.specialist_id
  } : undefined
}

export function markAnswerVerificationRunning(database: DatabaseSync, verificationId: string, now = new Date()): void {
  database.prepare(`
    UPDATE answer_verifications
    SET status = 'running', updated_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(now.toISOString(), verificationId)
}

export function quarantineAttributedDerivedPages(
  database: DatabaseSync,
  input: {
    verificationId: string
    baseline: AnswerVerificationBaseline
    judgement: AnswerAlignmentJudgement
    attribution: NegativeDerivedAttribution
    now?: Date
  }
): void {
  const verification = readAnswerVerification(database, input.verificationId)
  if (!verification || verification.status !== 'running') {
    throw new Error('Answer verification is not running.')
  }
  assertExecutionResult(
    { baseline: input.baseline, judgement: input.judgement, attribution: input.attribution },
    verification.derivedPages.map((page) => page.path),
    false
  )
  const negativePaths = [...new Set(input.attribution.negativeDerivedPaths)].sort()
  if (negativePaths.length === 0) return
  const negative = new Set(negativePaths)
  const now = (input.now ?? new Date()).toISOString()

  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(`
      UPDATE answer_verifications
      SET baseline_answer = ?, baseline_citations_json = ?, baseline_documents_json = ?,
        alignment_level = ?, alignment_reason = ?, alignment_confidence = ?,
        negative_derived_pages_json = ?, attribution_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(
      input.baseline.answer,
      JSON.stringify(input.baseline.citations),
      JSON.stringify(input.baseline.consultedDocuments),
      input.judgement.level,
      input.judgement.reason,
      input.judgement.confidence,
      JSON.stringify(negativePaths),
      input.attribution.reason,
      now,
      input.verificationId
    )
    for (const page of verification.derivedPages) {
      database.prepare(`
        UPDATE derived_page_quality
        SET status = ?, updated_at = ?
        WHERE specialist_id = ? AND wiki_path = ?
          AND revision_sha256 = ? AND verification_id = ?
      `).run(
        negative.has(page.path) ? 'quarantined' : 'review_required',
        now,
        verification.specialistId,
        page.path,
        page.revisionSha256,
        verification.id
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function completeAnswerVerification(
  database: DatabaseSync,
  input: { verificationId: string; result: AnswerVerificationExecutionResult; now?: Date }
): void {
  const verification = readAnswerVerification(database, input.verificationId)
  if (!verification || verification.status !== 'running') {
    throw new Error('Answer verification is not running.')
  }
  assertExecutionResult(input.result, verification.derivedPages.map((page) => page.path))

  const now = (input.now ?? new Date()).toISOString()
  const favourable = input.result.judgement.level === 'FIEL' || input.result.judgement.level === 'MUITO_ALINHADO'
  const negativePaths = [...new Set(input.result.attribution?.negativeDerivedPaths ?? [])].sort()
  const acceptedRepair = input.result.repair?.status === 'accepted' ? input.result.repair : undefined
  const needsAdminSource = input.result.repair?.status === 'needs_admin_source'
  const finalStatus: AnswerVerificationStatus = needsAdminSource ? 'needs_admin_source' : 'succeeded'

  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(`
      UPDATE answer_verifications
      SET status = ?, baseline_answer = ?, baseline_citations_json = ?,
        baseline_documents_json = ?, alignment_level = ?, alignment_reason = ?,
        alignment_confidence = ?, negative_derived_pages_json = ?, attribution_reason = ?,
        repair_reason = ?, original_answer = NULL, original_citations_json = NULL,
        conversation_context_json = NULL, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(
      finalStatus,
      null,
      null,
      JSON.stringify(input.result.baseline.consultedDocuments),
      input.result.judgement.level,
      input.result.judgement.reason,
      input.result.judgement.confidence,
      JSON.stringify(negativePaths),
      input.result.attribution?.reason ?? null,
      input.result.repair?.status === 'needs_admin_source' ? input.result.repair.reason : null,
      now,
      now,
      input.verificationId
    )

    const negative = new Set(negativePaths)
    const acceptedRevisions = new Map(acceptedRepair?.revisions.map((page) => [page.path, page.revisionSha256]) ?? [])
    for (const page of verification.derivedPages) {
      const acceptedRevision = acceptedRevisions.get(page.path)
      const status = acceptedRevision
        ? 'verified'
        : negative.has(page.path)
          ? 'quarantined'
          : favourable
            ? 'verified'
            : 'review_required'
      database.prepare(`
        UPDATE derived_page_quality
        SET status = ?, revision_sha256 = ?, updated_at = ?
        WHERE specialist_id = ? AND wiki_path = ?
          AND revision_sha256 = ? AND verification_id = ?
      `).run(
        status,
        acceptedRevision ?? page.revisionSha256,
        now,
        verification.specialistId,
        page.path,
        page.revisionSha256,
        verification.id
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function readQuarantinedDerivedPaths(database: DatabaseSync, specialistId: string): string[] {
  return (database.prepare(`
    SELECT wiki_path
    FROM derived_page_quality
    WHERE specialist_id = ? AND status = 'quarantined'
    ORDER BY wiki_path
  `).all(specialistId) as Array<{ wiki_path: string }>).map((row) => row.wiki_path)
}

export function markAnswerVerificationRetryQueued(
  database: DatabaseSync,
  input: { verificationId: string; code: string; now?: Date }
): void {
  database.prepare(`
    UPDATE answer_verifications
    SET status = 'queued', last_error_code = ?, last_error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.code.slice(0, 80),
    'Answer verification attempt failed and will be retried.',
    (input.now ?? new Date()).toISOString(),
    input.verificationId
  )
}

export function markAnswerVerificationFailed(
  database: DatabaseSync,
  input: { verificationId: string; code: string; now?: Date }
): void {
  const now = (input.now ?? new Date()).toISOString()
  database.prepare(`
    UPDATE answer_verifications
    SET status = 'failed', last_error_code = ?, last_error_message = ?,
      original_answer = NULL, original_citations_json = NULL,
      conversation_context_json = NULL, baseline_answer = NULL,
      baseline_citations_json = NULL, updated_at = ?, completed_at = ?
    WHERE id = ?
  `).run(input.code.slice(0, 80), 'Answer verification failed.', now, now, input.verificationId)
  database.prepare(`
    UPDATE derived_page_quality
    SET status = 'review_required', updated_at = ?
    WHERE verification_id = ? AND status = 'pending'
  `).run(now, input.verificationId)
}

export function deleteAnswerVerificationForSpecialist(database: DatabaseSync, specialistId: string): void {
  database.prepare('DELETE FROM derived_page_quality WHERE specialist_id = ?').run(specialistId)
  database.prepare('DELETE FROM answer_verifications WHERE specialist_id = ?').run(specialistId)
}

async function readDerivedPageRevisions(rootPath: string, paths: string[]): Promise<DerivedPageRevision[]> {
  const root = await realpath(rootPath)
  const derived = await realpath(resolve(root, 'wiki', 'derived')).catch(() => '')
  if (!derived) return []

  const revisions: DerivedPageRevision[] = []
  for (const wikiPath of [...new Set(paths)].sort()) {
    if (!isDerivedWikiMarkdownPath(wikiPath)) continue
    const requested = await realpath(resolve(root, wikiPath)).catch(() => '')
    if (!requested || !isWithin(derived, requested) || !(await stat(requested)).isFile()) continue
    const relativePath = relative(root, requested).split(sep).join('/')
    const content = await readFile(requested)
    revisions.push({
      path: relativePath,
      revisionSha256: `sha256:${createHash('sha256').update(content).digest('hex')}`
    })
  }
  return revisions
}

function readAnswerVerificationByEvent(
  database: DatabaseSync,
  sourceEventId: string
): AnswerVerificationRecord | undefined {
  const row = database.prepare('SELECT * FROM answer_verifications WHERE event_id = ?').get(sourceEventId)
  return row ? mapVerificationRow(row) : undefined
}

function readPageQuality(
  database: DatabaseSync,
  specialistId: string,
  paths: string[]
): Map<string, { revision_sha256: string; status: string }> {
  const statement = database.prepare(`
    SELECT revision_sha256, status
    FROM derived_page_quality
    WHERE specialist_id = ? AND wiki_path = ?
  `)
  return new Map(paths.flatMap((path) => {
    const row = statement.get(specialistId, path) as { revision_sha256: string; status: string } | undefined
    return row ? [[path, row] as const] : []
  }))
}

function mapVerificationRow(value: unknown): AnswerVerificationRecord {
  const row = value as Record<string, any>
  const baseline = typeof row.baseline_answer === 'string' ? {
    answer: row.baseline_answer,
    citations: parseJsonArray<ChatCitation>(row.baseline_citations_json),
    consultedDocuments: parseJsonArray<string>(row.baseline_documents_json)
  } : null
  return {
    id: row.id,
    sourceEventId: row.event_id,
    specialistId: row.specialist_id,
    status: row.status,
    sampleReason: row.sample_reason,
    originalAnswer: row.original_answer,
    originalCitations: parseJsonArray<ChatCitation>(row.original_citations_json),
    conversationContext: parseJsonArray<ChatConversationContextMessage>(row.conversation_context_json),
    derivedPages: parseJsonArray<DerivedPageRevision>(row.derived_pages_json),
    baseline,
    controlDocuments: parseJsonArray<string>(row.baseline_documents_json),
    judgement: isAlignmentLevel(row.alignment_level) && isConfidence(row.alignment_confidence) && typeof row.alignment_reason === 'string'
      ? { level: row.alignment_level, reason: row.alignment_reason, confidence: row.alignment_confidence }
      : null,
    negativeDerivedPaths: parseJsonArray<string>(row.negative_derived_pages_json),
    attributionReason: typeof row.attribution_reason === 'string' ? row.attribution_reason : null,
    repairReason: typeof row.repair_reason === 'string' ? row.repair_reason : null,
    jobId: row.job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function assertExecutionResult(
  result: AnswerVerificationExecutionResult,
  allowedDerivedPaths: string[],
  requireRepair = true
): void {
  if (!isAlignmentLevel(result.judgement?.level) || !isConfidence(result.judgement?.confidence)) {
    throw new Error('Answer verification judgement is invalid.')
  }
  if (!isBoundedText(result.judgement.reason)) {
    throw new Error('Answer verification judgement reason is invalid.')
  }
  const requiresAttribution = ['ALINHADO', 'POUCO_ALINHADO', 'NAO_ALINHADO'].includes(result.judgement.level)
  if (requiresAttribution !== Boolean(result.attribution)) {
    throw new Error('Answer verification attribution is invalid for its judgement.')
  }
  if (result.attribution) {
    if (!isBoundedText(result.attribution.reason)) throw new Error('Answer verification attribution reason is invalid.')
    const allowed = new Set(allowedDerivedPaths)
    if (
      !Array.isArray(result.attribution.negativeDerivedPaths) ||
      result.attribution.negativeDerivedPaths.some((path) => typeof path !== 'string' || !allowed.has(path))
    ) {
      throw new Error('Answer verification attribution path is invalid.')
    }
  }
  const negativePaths = [...new Set(result.attribution?.negativeDerivedPaths ?? [])].sort()
  if (requireRepair && negativePaths.length > 0 && !result.repair) {
    throw new Error('Negative derived attribution requires a repair outcome.')
  }
  if (result.repair && negativePaths.length === 0) {
    throw new Error('Answer verification repair has no negative derived page.')
  }
  if (result.repair?.status === 'accepted') {
    const repairedPaths = [...new Set(result.repair.revisions.map((page) => page.path))].sort()
    if (
      repairedPaths.length !== negativePaths.length ||
      repairedPaths.some((path, index) => path !== negativePaths[index]) ||
      result.repair.revisions.some((page) => !isBoundedText(page.revisionSha256))
    ) {
      throw new Error('Accepted derived repair revisions are invalid.')
    }
  }
  if (result.repair?.status === 'needs_admin_source' && !isBoundedText(result.repair.reason)) {
    throw new Error('Derived repair missing-source reason is invalid.')
  }
}

function isAlignmentLevel(value: unknown): value is AnswerAlignmentLevel {
  return ['FIEL', 'MUITO_ALINHADO', 'ALINHADO', 'POUCO_ALINHADO', 'NAO_ALINHADO'].includes(String(value))
}

function isConfidence(value: unknown): value is AnswerAlignmentJudgement['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low'
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isTenPercentSample(eventId: string): boolean {
  const bucket = createHash('sha256').update(eventId).digest().readUInt32BE(0) / 0x1_0000_0000
  return bucket < 0.1
}

function isDerivedWikiMarkdownPath(path: string): boolean {
  const segments = path.split('/')
  return path.startsWith('wiki/derived/') && path.toLowerCase().endsWith('.md') &&
    !path.includes('\0') && segments.every((segment) => segment !== '.' && segment !== '..')
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}
