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
  updated_at?: string
  detected_at?: string
  ingested_at?: string
  conversion?: {
    status: 'not_required' | 'pending' | 'processing' | 'converted' | 'failed'
    markdown_path: string
    updated_at?: string
    ingested_at?: string
    error_message?: string
  }
  ingestion?: {
    status: 'blocked' | 'pending' | 'processing' | 'ingested' | 'failed'
    source_path: string
    updated_at?: string
    ingested_at?: string
    skipped_reason?: string
    error_message?: string
  }
  previous_checksum?: string
  replaced_at?: string
  error_code?: string
  error_message?: string
}

export interface AgentSessionLogSummary {
  file_name: string
  relative_path: string
  path: string
  task: 'initialization' | 'conversion' | 'ingestion'
  started_at: string
}

export interface AdminSpecialistSeo {
  title: string
  description: string
  introduction: string
  topics: string[]
  limitations: string
  call_to_action: string
}

export interface AdminSpecialist {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  citations_required: boolean
  streaming_enabled: boolean
  status: 'initializing' | 'awaiting_sources' | 'ingesting' | 'active' | 'suspended' | 'failed'
  company_id: string | null
  seo: AdminSpecialistSeo
  sources: IngestionSource[]
  agent_logs: AgentSessionLogSummary[]
}

export interface AdminFailedInitialization {
  job_id: string
  specialist_id: string
  error_code: string | null
  error_message: string | null
  failed_at: string
  agent_logs: AgentSessionLogSummary[]
}

export interface AdminSpecialistsResponse {
  specialists: AdminSpecialist[]
  failed_initializations?: AdminFailedInitialization[]
}

export interface AdminCompanySummary {
  id: string
  name: string
  nif: string
  active: boolean
  seats: number
}

export interface AdminCompaniesResponse {
  companies: AdminCompanySummary[]
}

export interface SourceStatusCounts {
  pending: number
  processing: number
  ingested: number
  failed: number
  blocked: number
}

export interface BackgroundJobSummary {
  id: string
  type: 'specialist_initialization' | 'specialist_ingestion'
  specialist_id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

export interface IngestionRunResponse {
  job?: BackgroundJobSummary
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
    company_id: '',
    seo: {
      title: '',
      description: '',
      introduction: '',
      topics: [] as string[],
      limitations: '',
      call_to_action: ''
    }
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
