export type IngestionSourceStatus = 'pending' | 'processing' | 'ingested' | 'failed'

export interface IngestionSourceRecord {
  source_id: string
  specialist_id: string
  raw_path: string
  checksum: string
  status: IngestionSourceStatus
  title: string
  article_refs: string[]
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
}
