export type IngestionSourceStatus = 'pending' | 'processing' | 'ingested' | 'failed' | 'blocked'

export type ConversionStatus = 'not_required' | 'pending' | 'processing' | 'converted' | 'failed'
export type LlmWikiConversionStatus =
  | 'full'
  | 'partial'
  | 'lossy'
  | 'ocr-full'
  | 'ocr-partial'
  | 'summary-only'
  | 'metadata-only'
  | 'passthrough'
  | 'failed'
export type PipelineIngestionStatus = 'blocked' | 'pending' | 'processing' | 'ingested' | 'failed'

export interface SourceConversionState {
  status: ConversionStatus
  markdown_path: string
  markdown_checksum?: string
  converted_at?: string
  updated_at?: string
  conversion_status?: LlmWikiConversionStatus
  conversion_method?: string
  warnings?: string[]
  error_code?: string
  error_message?: string
}

export interface IngestionCitationState {
  source_file: string
  source_title: string
  article_refs: string[]
}

export interface SourceIngestionState {
  status: PipelineIngestionStatus
  source_path: string
  ingested_at?: string
  updated_at?: string
  skipped_reason?: string
  error_code?: string
  error_message?: string
  wiki_pages?: string[]
  citations?: IngestionCitationState[]
  warnings?: string[]
  manifest_validated_at?: string
}

export interface IngestionSourceRecord {
  source_id: string
  specialist_id: string
  raw_path: string
  checksum: string
  status: IngestionSourceStatus
  title: string
  article_refs: string[]
  conversion?: SourceConversionState
  ingestion?: SourceIngestionState
  previous_checksum?: string
  replaced_at?: string
  error_code?: string
  error_message?: string
  detected_at: string
  updated_at: string
  ingested_at?: string
}

export interface IngestionState {
  version: 1
  sources: Record<string, IngestionSourceRecord>
}

export interface IngestionManifestSourceSuccess {
  raw_path: string
  source_path: string
  wiki_pages: string[]
  citations: IngestionCitationState[]
  warnings?: string[]
}

export interface IngestionManifestSourceFailure {
  raw_path: string
  source_path?: string
  error_code: string
  error_message: string
}

export interface IngestionManifestV1 {
  version: 1
  specialist_id: string
  ingested: IngestionManifestSourceSuccess[]
  failed: IngestionManifestSourceFailure[]
}

export interface AgentOwnedIngestionManifestSourceSuccess extends IngestionManifestSourceSuccess {
  converted_path: string
  source_sha256: string
  converted_sha256: string
  conversion_status: LlmWikiConversionStatus
}

export interface AgentOwnedIngestionManifestSourceFailure extends IngestionManifestSourceFailure {
  stage?: 'conversion' | 'ingestion'
  converted_path?: string
  conversion_status?: LlmWikiConversionStatus
}

export interface IngestionManifestV2 {
  version: 2
  specialist_id: string
  processed: AgentOwnedIngestionManifestSourceSuccess[]
  failed: AgentOwnedIngestionManifestSourceFailure[]
}

export type IngestionManifest = IngestionManifestV1 | IngestionManifestV2

export interface StoredRawSource {
  relativePath: string
  absolutePath: string
  replaced: boolean
}
