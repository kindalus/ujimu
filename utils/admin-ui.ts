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
  previous_checksum?: string
  replaced_at?: string
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
  status: 'active' | 'suspended'
  allowed_emails: string[]
  sources: IngestionSource[]
}

export interface AdminSpecialistsResponse {
  specialists: AdminSpecialist[]
}

export interface SourceStatusCounts {
  pending: number
  processing: number
  ingested: number
  failed: number
  blocked: number
}

export interface IngestionRunResponse {
  sources: IngestionSource[]
  counts?: SourceStatusCounts
}

export interface MonthlyVisitorsResponse {
  month: string
  distinctVisitors: number
}

export interface ContentGapCandidate {
  specialistId: string
  fingerprint: string
  normalizedQuestion: string
  latestQuestion: string
  countLast30Days: number
  countSinceReview: number
  totalCount: number
  insufficientContextCount: number
  firstOccurredAt: string
  lastOccurredAt: string
  reviewedAt: string | null
}

export interface RecentQuestionAnalytics {
  id: string
  specialistId: string
  outcome: 'answered' | 'insufficient_context'
  questionText: string
  normalizedQuestion: string
  fingerprint: string
  occurredAt: string
  userTimezone: string
}

export interface QuestionAnalyticsResponse {
  candidates: ContentGapCandidate[]
  recentQuestions: RecentQuestionAnalytics[]
}

export interface AdminReadinessResponse {
  ok: boolean
  checks: {
    database: boolean
    dataDirectoryWritable: boolean
    operationalLogsWritable: boolean
    migrationsApplied: number
    billingWebhookSecretConfigured: boolean
    sessionSecretConfigured: boolean
    otpPepperConfigured: boolean
    passkeysEnabled: boolean
    passkeysConfigured: boolean
  }
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

export const DEFAULT_SPECIALIST_SYSTEM_PROMPT = 'Responda apenas com base na wiki desta especialidade e cite sempre as fontes relevantes.'

export function createEmptySpecialistForm() {
  return {
    id: '',
    name: '',
    description: '',
    wiki_type: 'legislation-regulatory',
    system_prompt: DEFAULT_SPECIALIST_SYSTEM_PROMPT,
    citations_required: true,
    streaming_enabled: true,
    status: 'active' as const,
    allowed_emails: ''
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

export function booleanStatusColor(value: boolean | undefined): AdminBadgeColor {
  if (value === true) return 'success'
  if (value === false) return 'error'
  return 'neutral'
}
