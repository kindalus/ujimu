import { extname } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { readIngestionState } from '../ingestion/state'
import type { IngestionSourceRecord } from '../ingestion/types'

const ALLOWED_RAW_SOURCE_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.pdf'])

export interface AdminSpecialistPayload {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  citations_required: boolean
  streaming_enabled: boolean
  sources: IngestionSourceRecord[]
}

export interface SourceStatusCounts {
  pending: number
  processing: number
  ingested: number
  failed: number
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
    { pending: 0, processing: 0, ingested: 0, failed: 0 }
  )
}

export function isAllowedRawSourceFileName(fileName: string): boolean {
  return ALLOWED_RAW_SOURCE_EXTENSIONS.has(extname(fileName).toLowerCase())
}
