import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveAppConfig } from '../config'

export type OperationalEventCategory = 'chat' | 'quota' | 'ingestion' | 'billing' | 'security' | 'ops'
export type OperationalEventSeverity = 'info' | 'warn' | 'error'

export interface OperationalEventInput {
  category: OperationalEventCategory
  event: string
  severity: OperationalEventSeverity
  specialistId?: string
  metadata?: Record<string, unknown>
}

export interface WriteOperationalEventOptions {
  dataDir?: string
  now?: Date
  console?: boolean
}

export interface SerializedOperationalEvent {
  ts: string
  category: OperationalEventCategory
  event: string
  severity: OperationalEventSeverity
  specialistId?: string
  metadata: Record<string, unknown>
}

const SENSITIVE_KEY_PARTS = [
  'answer',
  'content',
  'contact',
  'cookie',
  'document',
  'email',
  'jwt',
  'otp',
  'password',
  'phone',
  'question',
  'secret',
  'session',
  'token'
]

export async function writeOperationalEvent(
  input: OperationalEventInput,
  options: WriteOperationalEventOptions = {}
): Promise<SerializedOperationalEvent> {
  const now = options.now ?? new Date()
  const event = serializeOperationalEvent(input, now)
  const dataDir = options.dataDir ?? resolveAppConfig({ env: process.env }).dataDir
  const logDirectory = getOperationalLogDirectory(dataDir)
  const logPath = getOperationalLogPath(dataDir, now)
  const line = `${JSON.stringify(event)}\n`

  await mkdir(logDirectory, { recursive: true })
  await appendFile(logPath, line, 'utf8')

  const shouldWriteConsole = options.console ?? process.env.NODE_ENV !== 'test'
  if (shouldWriteConsole) {
    const method = event.severity === 'error' ? console.error : event.severity === 'warn' ? console.warn : console.info
    method(line.trim())
  }

  return event
}

export async function writeOperationalEventSafely(
  input: OperationalEventInput,
  options: WriteOperationalEventOptions = {}
): Promise<void> {
  try {
    await writeOperationalEvent(input, options)
  } catch (error) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      category: 'ops',
      event: 'operational_log_write_failed',
      severity: 'warn',
      metadata: { error: error instanceof Error ? error.name : 'unknown' }
    }))
  }
}

export function serializeOperationalEvent(input: OperationalEventInput, now: Date = new Date()): SerializedOperationalEvent {
  return {
    ts: now.toISOString(),
    category: input.category,
    event: sanitizeEventName(input.event),
    severity: input.severity,
    ...(input.specialistId ? { specialistId: input.specialistId } : {}),
    metadata: sanitizeMetadata(input.metadata ?? {})
  }
}

export function getOperationalLogDirectory(dataDir: string): string {
  return join(dataDir, 'logs', 'operational')
}

export function getOperationalLogPath(dataDir: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10)
  return join(getOperationalLogDirectory(dataDir), `operational-${day}.jsonl`)
}

function sanitizeEventName(value: string): string {
  const trimmed = value.trim().slice(0, 120)
  return trimmed.length > 0 ? trimmed : 'unknown_event'
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveKey(key)) {
      continue
    }

    const sanitizedValue = sanitizeMetadataValue(value)
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue
    }
  }

  return sanitized
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value).slice(0, 500)
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue).filter((item) => item !== undefined).slice(0, 20)
  }

  if (typeof value === 'object') {
    return sanitizeMetadata(value as Record<string, unknown>)
  }

  return undefined
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\+\d{8,15}\b/g, '[redacted-number]')
}
