export type IngestionSourceStatus = 'pending' | 'processing' | 'ingested' | 'failed' | 'blocked'

export type ConversionStatus = 'not_required' | 'pending' | 'processing' | 'converted' | 'failed'
export type PipelineIngestionStatus = 'blocked' | 'pending' | 'processing' | 'ingested' | 'failed'

export interface SourceConversionState {
  status: ConversionStatus
  markdown_path: string
  markdown_checksum?: string
  converted_at?: string
  updated_at?: string
  error_code?: string
  error_message?: string
}

export interface SourceIngestionState {
  status: PipelineIngestionStatus
  source_path: string
  ingested_at?: string
  updated_at?: string
  skipped_reason?: string
  error_code?: string
  error_message?: string
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

export interface StoredRawSource {
  relativePath: string
  absolutePath: string
  replaced: boolean
}
