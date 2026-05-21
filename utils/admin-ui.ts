export interface AdminSessionResponse {
  authenticated: boolean
  admin: boolean
  user?: {
    id: string
    displayContact: string
  }
}

export interface IngestionSource {
  raw_path: string
  status: 'pending' | 'processing' | 'ingested' | 'failed' | 'blocked'
  title: string
  article_refs: string[]
  conversion?: {
    status: 'not_required' | 'pending' | 'processing' | 'converted' | 'failed'
    markdown_path: string
    error_message?: string
  }
  ingestion?: {
    status: 'blocked' | 'pending' | 'processing' | 'ingested' | 'failed'
    source_path: string
    skipped_reason?: string
    error_message?: string
  }
  error_code?: string
  error_message?: string
}

export interface AdminSpecialist {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  citations_required: boolean
  streaming_enabled: boolean
  sources: IngestionSource[]
}

export interface AdminSpecialistsResponse {
  specialists: AdminSpecialist[]
}

export interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
  message?: string
  statusMessage?: string
}

export type AdminBadgeColor = 'primary' | 'neutral' | 'success' | 'warning' | 'error'

export function createEmptySpecialistForm() {
  return {
    id: '',
    name: '',
    description: '',
    wiki_type: 'legislation-regulatory',
    system_prompt: '',
    citations_required: true,
    streaming_enabled: true
  }
}

export async function readAdminApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload
    return payload.error?.message || payload.statusMessage || payload.message || 'Operação rejeitada.'
  } catch {
    return 'Operação rejeitada.'
  }
}

export function pipelineStatusColor(status: string): AdminBadgeColor {
  if (['ingested', 'converted', 'not_required'].includes(status)) return 'success'
  if (['pending', 'processing', 'blocked'].includes(status)) return 'warning'
  if (status === 'failed') return 'error'
  return 'neutral'
}
