import { extname } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { readIngestionState } from '../ingestion/state'
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
  status: 'active' | 'suspended'
  allowed_emails: string[]
  sources: IngestionSourceRecord[]
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
    allowed_emails: specialist.allowed_emails,
    sources: await readSpecialistSources(specialist)
  }
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
  const normalizedContentType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (!normalizedContentType) {
    return true
  }

  return COMPATIBLE_UPLOAD_CONTENT_TYPES[extname(fileName).toLowerCase()]?.has(normalizedContentType) ?? false
}

export function isGeneratedMarkdownArtifactName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase()
  return GENERATED_MARKDOWN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}
