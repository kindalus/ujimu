export const LLM_WIKI_PRESETS = [
  'research-project',
  'book-companion',
  'personal-journal-backed',
  'business-team-knowledge',
  'help-desk-faq-customer-support',
  'engineering-internal-technical-documentation',
  'legislation-regulatory',
  'custom-domain'
] as const

export const SPECIALIST_STATUSES = ['initializing', 'awaiting_sources', 'ingesting', 'active', 'suspended', 'failed'] as const

export type LlmWikiPreset = (typeof LLM_WIKI_PRESETS)[number]
export type SpecialistStatus = (typeof SPECIALIST_STATUSES)[number]

export interface SpecialistConfig {
  id: string
  name: string
  description: string
  wiki_type: LlmWikiPreset
  system_prompt?: string
  citations_required: boolean
  streaming_enabled: boolean
  status?: SpecialistStatus
  company_id?: string | null
}

export interface NormalizedSpecialistConfig extends SpecialistConfig {
  system_prompt: string
  status: SpecialistStatus
  company_id: string | null
}

export interface SpecialistRuntime extends NormalizedSpecialistConfig {
  paths: {
    root: string
    config: string
    raw: string
    converted: string
    wiki: string
    ingest: string
    ingestState: string
  }
}

export type PublicSpecialist = Pick<
  NormalizedSpecialistConfig,
  'id' | 'name' | 'description' | 'wiki_type' | 'citations_required' | 'streaming_enabled'
>

export interface SpecialistLoadError {
  code:
    | 'INVALID_DIRECTORY_ID'
    | 'MISSING_CONFIG'
    | 'INVALID_YAML'
    | 'INVALID_CONFIG'
    | 'INVALID_WIKI_TYPE'
    | 'INVALID_STATUS'
    | 'ID_DIRECTORY_MISMATCH'
    | 'MISSING_REQUIRED_DIRECTORY'
  specialistId: string
  path: string
  message: string
}

export const SPECIALIST_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function assertValidSpecialistId(id: string): void {
  if (!SPECIALIST_ID_PATTERN.test(id)) {
    throw new SpecialistConfigError(
      'INVALID_DIRECTORY_ID',
      `Specialist id "${id}" must be a lowercase slug.`
    )
  }
}

export function validateSpecialistConfig(input: unknown, directoryId: string): NormalizedSpecialistConfig {
  if (!isRecord(input)) {
    throw new SpecialistConfigError('INVALID_CONFIG', 'Specialist config must be a YAML mapping.')
  }

  const id = readString(input, 'id')
  assertValidSpecialistId(id)

  if (id !== directoryId) {
    throw new SpecialistConfigError(
      'ID_DIRECTORY_MISMATCH',
      `Specialist id "${id}" must match directory "${directoryId}".`
    )
  }

  const wikiType = readString(input, 'wiki_type')
  if (!isLlmWikiPreset(wikiType)) {
    throw new SpecialistConfigError(
      'INVALID_WIKI_TYPE',
      `Unsupported LLM Wiki preset "${wikiType}".`
    )
  }

  return {
    id,
    name: readString(input, 'name'),
    description: readString(input, 'description'),
    wiki_type: wikiType,
    system_prompt: readOptionalString(input, 'system_prompt'),
    citations_required: readBoolean(input, 'citations_required'),
    streaming_enabled: readBoolean(input, 'streaming_enabled'),
    status: readOptionalStatus(input.status),
    company_id: readOptionalCompanyId(input.company_id)
  }
}

export function toPublicSpecialist(specialist: SpecialistRuntime | NormalizedSpecialistConfig): PublicSpecialist {
  return {
    id: specialist.id,
    name: specialist.name,
    description: specialist.description,
    wiki_type: specialist.wiki_type,
    citations_required: specialist.citations_required,
    streaming_enabled: specialist.streaming_enabled
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export class SpecialistConfigError extends Error {
  constructor(
    public readonly code: SpecialistLoadError['code'],
    message: string
  ) {
    super(message)
    this.name = 'SpecialistConfigError'
  }
}

function readOptionalStatus(value: unknown): SpecialistStatus {
  if (value === undefined || value === null) {
    return 'active'
  }

  if (!SPECIALIST_STATUSES.includes(value as SpecialistStatus)) {
    throw new SpecialistConfigError('INVALID_STATUS', `Specialist status must be one of: ${SPECIALIST_STATUSES.join(', ')}.`)
  }

  return value as SpecialistStatus
}

function readOptionalCompanyId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SpecialistConfigError('INVALID_CONFIG', 'company_id must be a string when provided.')
  }
  return value.trim()
}

function isLlmWikiPreset(value: string): value is LlmWikiPreset {
  return LLM_WIKI_PRESETS.includes(value as LlmWikiPreset)
}

function readString(record: Record<string, unknown>, key: keyof SpecialistConfig): string {
  const value = record[key]

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SpecialistConfigError('INVALID_CONFIG', `Missing or invalid string field "${key}".`)
  }

  return value
}

function readOptionalString(record: Record<string, unknown>, key: keyof SpecialistConfig): string {
  const value = record[key]
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value !== 'string') {
    throw new SpecialistConfigError('INVALID_CONFIG', `Invalid string field "${key}".`)
  }
  return value
}

function readBoolean(record: Record<string, unknown>, key: keyof SpecialistConfig): boolean {
  const value = record[key]

  if (typeof value !== 'boolean') {
    throw new SpecialistConfigError('INVALID_CONFIG', `Missing or invalid boolean field "${key}".`)
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
