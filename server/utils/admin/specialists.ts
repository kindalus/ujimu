import { extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { SpecialistRuntime, SpecialistStatus } from '../specialists/schema'
import { readIngestionState } from '../ingestion/state'
import { listAgentSessionLogs, type AgentSessionLogSummary } from '../agents/logs'
import { resolveAppConfig } from '../config'
import type { IngestionSourceRecord } from '../ingestion/types'

const ALLOWED_RAW_SOURCE_EXTENSIONS = new Set([
  '.pdf',
  '.txt',
  '.docx',
  '.html',
  '.htm',
  '.csv',
  '.xlsx',
  '.md',
  '.markdown'
])

const GENERATED_MARKDOWN_SUFFIXES = ['.pdf.md', '.txt.md', '.docx.md', '.html.md', '.htm.md', '.csv.md', '.xlsx.md']

const COMPATIBLE_UPLOAD_CONTENT_TYPES: Record<string, Set<string>> = {
  '.pdf': new Set(['application/pdf']),
  '.txt': new Set(['text/plain', 'application/octet-stream']),
  '.md': new Set(['text/markdown', 'text/plain', 'application/octet-stream']),
  '.markdown': new Set(['text/markdown', 'text/plain', 'application/octet-stream']),
  '.html': new Set(['text/html', 'application/xhtml+xml', 'application/octet-stream']),
  '.htm': new Set(['text/html', 'application/xhtml+xml', 'application/octet-stream']),
  '.csv': new Set(['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']),
  '.docx': new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']),
  '.xlsx': new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
}

export interface AdminSpecialistPayload {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  citations_required: boolean
  streaming_enabled: boolean
  status: SpecialistStatus
  company_id: string | null
  sources: IngestionSourceRecord[]
  agent_logs: AgentSessionLogSummary[]
}

export interface AdminFailedInitializationPayload {
  job_id: string
  specialist_id: string
  error_code: string | null
  error_message: string | null
  failed_at: string
  agent_logs: AgentSessionLogSummary[]
}

export interface SourceStatusCounts {
  pending: number
  processing: number
  ingested: number
  failed: number
  blocked: number
}

export async function toAdminSpecialistPayload(
  specialist: SpecialistRuntime
): Promise<AdminSpecialistPayload> {
  return {
    id: specialist.id,
    name: specialist.name,
    description: specialist.description,
    wiki_type: specialist.wiki_type,
    system_prompt: specialist.system_prompt,
    citations_required: specialist.citations_required,
    streaming_enabled: specialist.streaming_enabled,
    status: specialist.status,
    company_id: specialist.company_id,
    sources: await readSpecialistSources(specialist),
    agent_logs: await listAgentSessionLogs(specialist.paths.root, specialist.id)
  }
}

export async function listFailedInitializationPayloads(
  database: DatabaseSync,
  options: { limit?: number } = {}
): Promise<AdminFailedInitializationPayload[]> {
  const dataDir = resolveAppConfig().dataDir
  const rows = database
    .prepare(`
      SELECT id, specialist_id, last_error_code, last_error_message, completed_at, updated_at
      FROM background_jobs
      WHERE type = 'specialist_initialization'
        AND status = 'failed'
      ORDER BY COALESCE(completed_at, updated_at) DESC
      LIMIT ?
    `)
    .all(options.limit ?? 10) as Array<{
      id: string
      specialist_id: string
      last_error_code: string | null
      last_error_message: string | null
      completed_at: string | null
      updated_at: string
    }>

  return Promise.all(rows.map(async (row) => ({
    job_id: row.id,
    specialist_id: row.specialist_id,
    error_code: row.last_error_code,
    error_message: row.last_error_message,
    failed_at: row.completed_at ?? row.updated_at,
    agent_logs: await listAgentSessionLogs(join(dataDir, 'specialties', row.specialist_id), row.specialist_id)
  })))
}

export function canUploadRawSources(status: SpecialistStatus): boolean {
  return status === 'awaiting_sources' || status === 'active' || status === 'suspended'
}

export async function readSpecialistSources(
  specialist: SpecialistRuntime
): Promise<IngestionSourceRecord[]> {
  const state = await readIngestionState(specialist.paths.ingestState)
  return Object.values(state.sources).sort((left, right) => left.raw_path.localeCompare(right.raw_path))
}

export function countSources(sources: IngestionSourceRecord[]): SourceStatusCounts {
  return sources.reduce<SourceStatusCounts>(
    (counts, source) => {
      counts[source.status] += 1
      return counts
    },
    { pending: 0, processing: 0, ingested: 0, failed: 0, blocked: 0 }
  )
}

export function isAllowedRawSourceFileName(fileName: string): boolean {
  return ALLOWED_RAW_SOURCE_EXTENSIONS.has(extname(fileName).toLowerCase()) && !isGeneratedMarkdownArtifactName(fileName)
}

export function isCompatibleRawSourceContentType(fileName: string, contentType: string | undefined): boolean {
  // An omitted content type used to pass the check, which let a client skip it entirely.
  const normalizedContentType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (!normalizedContentType) {
    return false
  }

  return COMPATIBLE_UPLOAD_CONTENT_TYPES[extname(fileName).toLowerCase()]?.has(normalizedContentType) ?? false
}

export function isGeneratedMarkdownArtifactName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase()
  return GENERATED_MARKDOWN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}
