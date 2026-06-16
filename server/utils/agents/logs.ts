import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveAppConfig } from '../config'

export type AgentSessionLogTask = 'initialization' | 'conversion' | 'ingestion'
export type AgentSessionLogCloseStatus = 'succeeded' | 'failed' | 'aborted' | 'disposed'

export interface CreateAgentSessionLoggerOptions {
  dataDir?: string
  specialistDir?: string
  specialistId: string
  task: AgentSessionLogTask
  now?: Date
}

export interface AgentSessionLogger {
  path: string
  writeSessionCreated(context: Record<string, unknown>): void
  writeEvent(event: unknown): void
  close(status: AgentSessionLogCloseStatus): Promise<void>
}

export interface AgentSessionLogSummary {
  file_name: string
  relative_path: string
  path: string
  task: AgentSessionLogTask
  started_at: string
}

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'auth',
  'cookie',
  'jwt',
  'key',
  'password',
  'secret',
  'session',
  'token'
]
const MAX_LOG_TEXT_LENGTH = 20_000

interface AgentSessionLogState {
  assistantText: string
}

interface FormatSafeObjectOptions {
  includeContent?: boolean
}

export async function createAgentSessionLogger(
  options: CreateAgentSessionLoggerOptions
): Promise<AgentSessionLogger> {
  const startedAt = options.now ?? new Date()
  const specialistDir = options.specialistDir ?? getDefaultSpecialistDir(options.dataDir, options.specialistId)
  const directory = getAgentSessionLogDirectory(specialistDir)
  const logPath = getAgentSessionLogPath(specialistDir, options.specialistId, options.task, startedAt)
  let pendingWrite: Promise<void> = Promise.resolve()
  let writeError: unknown
  const state: AgentSessionLogState = { assistantText: '' }

  await mkdir(directory, { recursive: true })
  await writeFile(
    logPath,
    formatSessionHeader({
      startedAt: startedAt.toISOString(),
      specialistId: options.specialistId,
      task: options.task
    }),
    'utf8'
  )

  function enqueue(fragment: string): void {
    pendingWrite = pendingWrite
      .then(() => appendFile(logPath, fragment, 'utf8'))
      .catch((error) => {
        writeError ??= error
      })
  }

  return {
    path: logPath,
    writeSessionCreated(context) {
      enqueue(formatSessionConfiguration(context))
    },
    writeEvent(event) {
      for (const entry of formatAgentSessionEvent(event, state)) {
        enqueue(entry)
      }
    },
    async close(status) {
      for (const entry of flushAssistantText(state)) {
        enqueue(entry)
      }
      enqueue(formatClosed(status))
      await pendingWrite
      if (writeError) {
        throw writeError
      }
    }
  }
}

function getDefaultSpecialistDir(dataDir: string | undefined, specialistId: string): string {
  return join(dataDir ?? resolveAppConfig().dataDir, 'specialties', toSafePathSegment(specialistId))
}

export function getAgentSessionLogDirectory(specialistDir: string): string {
  return join(specialistDir, 'logs')
}

export function getAgentSessionLogPath(
  specialistDir: string,
  specialistId: string,
  task: AgentSessionLogTask,
  date: Date = new Date()
): string {
  const timestamp = toIsoSafeTimestamp(date)
  return join(getAgentSessionLogDirectory(specialistDir), `${timestamp}-${toSafePathSegment(specialistId)}-${task}.md`)
}

export function toIsoSafeTimestamp(date: Date): string {
  return date.toISOString().replace(/:/gu, '-').replace('.', '-')
}

export async function listAgentSessionLogs(specialistDir: string, specialistId: string): Promise<AgentSessionLogSummary[]> {
  const directory = getAgentSessionLogDirectory(specialistDir)
  const safeSpecialistId = toSafePathSegment(specialistId)
  const pattern = new RegExp(`^(.+Z)-${escapeRegExp(safeSpecialistId)}-(initialization|conversion|ingestion)\\.(md|log)$`, 'u')
  let fileNames: string[] = []

  try {
    fileNames = await readdir(directory)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }

  return fileNames
    .flatMap((fileName): AgentSessionLogSummary[] => {
      const match = pattern.exec(fileName)
      if (!match) return []

      const startedAt = fromIsoSafeTimestamp(match[1])
      if (!startedAt) return []

      return [{
        file_name: fileName,
        relative_path: `logs/${fileName}`,
        path: join(directory, fileName),
        task: match[2] as AgentSessionLogTask,
        started_at: startedAt
      }]
    })
    .sort((left, right) => right.started_at.localeCompare(left.started_at))
}

function formatSessionHeader(input: { startedAt: string; specialistId: string; task: AgentSessionLogTask }): string {
  return [
    '# Ujimu agent session log',
    '',
    `**Started:** \`${sanitizeLogText(input.startedAt)}\``,
    `**Specialist:** \`${sanitizeLogText(input.specialistId)}\``,
    `**Task:** \`${input.task}\``,
    '',
    '---',
    ''
  ].join('\n')
}

function formatSessionConfiguration(context: Record<string, unknown>): string {
  return [
    '## Session configuration',
    '',
    formatJsonFence(formatSafeObject(context)),
    ''
  ].join('\n')
}

function formatAgentSessionEvent(event: unknown, state: AgentSessionLogState): string[] {
  const timestamp = new Date().toISOString()
  const typedEvent = isRecord(event) ? event : undefined
  const type = typeof typedEvent?.type === 'string' ? typedEvent.type : 'unknown_event'

  if (type === 'message_update') {
    const assistantMessageEvent = isRecord(typedEvent?.assistantMessageEvent)
      ? typedEvent.assistantMessageEvent
      : undefined
    const assistantEventType = typeof assistantMessageEvent?.type === 'string'
      ? assistantMessageEvent.type
      : 'unknown'

    if (assistantEventType === 'text_delta') {
      state.assistantText += String(assistantMessageEvent?.delta ?? '')
      return []
    }

    if (assistantEventType === 'text_end') {
      const text = typeof assistantMessageEvent?.content === 'string'
        ? assistantMessageEvent.content
        : state.assistantText
      state.assistantText = text
      return []
    }

    if (assistantEventType.startsWith('thinking') || assistantEventType.startsWith('toolcall')) {
      return []
    }

    return assistantEventType === 'error'
      ? [formatGenericEventMarkdown('assistant_error', assistantMessageEvent, timestamp)]
      : []
  }

  if (type === 'message_end') {
    const messageText = extractAssistantMessageText(typedEvent?.message)
    if (messageText) state.assistantText = messageText
    return flushAssistantText(state, timestamp)
  }

  if (type === 'tool_execution_start') {
    return [formatToolCallMarkdown(typedEvent, timestamp)]
  }

  if (type === 'tool_execution_update') {
    return []
  }

  if (type === 'tool_execution_end') {
    return [formatToolResultMarkdown(typedEvent, timestamp)]
  }

  if (isLifecycleEvent(type)) {
    return isHighSignalLifecycleEvent(type) ? [formatGenericEventMarkdown(type, undefined, timestamp)] : []
  }

  return [formatGenericEventMarkdown(type, typedEvent ?? event, timestamp)]
}

function flushAssistantText(state: AgentSessionLogState, timestamp = new Date().toISOString()): string[] {
  const text = state.assistantText
  state.assistantText = ''
  return text.trim().length > 0
    ? [[
        '## Assistant response',
        '',
        `**At:** \`${timestamp}\``,
        '',
        sanitizeLogText(text),
        ''
      ].join('\n')]
    : []
}

function formatToolCallMarkdown(event: Record<string, unknown> | undefined, timestamp: string): string {
  const toolName = sanitizeLogText(String(event?.toolName ?? 'unknown'))
  const args = isRecord(event?.args) ? event.args : {}
  const title = toolCallTitle(toolName, args)
  const content = typeof args.content === 'string' ? sanitizeLogText(args.content) : undefined
  const path = typeof args.path === 'string' ? displayPath(args.path) : undefined
  const parts = [`## ${timestamp} — ${title}`, '']

  if (path) parts.push(`**Path:** \`${path}\``, '')
  if (typeof args.pattern === 'string') parts.push(`**Pattern:** \`${sanitizeLogText(args.pattern)}\``, '')
  if (typeof args.limit === 'number') parts.push(`**Limit:** \`${args.limit}\``, '')

  if (content !== undefined) {
    parts.push(formatCodeFence(content, languageForPath(path)), '')
  }

  parts.push(formatToolMetadata(toolName, event, args), '')
  return parts.join('\n')
}

function formatToolResultMarkdown(event: Record<string, unknown> | undefined, timestamp: string): string {
  const toolName = sanitizeLogText(String(event?.toolName ?? 'unknown'))
  const outcome = event?.isError ? 'failed' : 'succeeded'
  const resultText = sanitizeLogText(extractToolResultText(event?.result))
  const parts = [`## ${timestamp} — Tool result: \`${toolName}\` ${outcome}`, '']

  if (resultText) {
    if (!event?.isError && resultText.startsWith('Successfully ')) {
      parts.push(`✅ ${resultText}`, '')
    } else if (event?.isError) {
      parts.push(formatCodeFence(resultText, 'text'), '')
    } else {
      parts.push(formatCodeFence(resultText, 'text'), '')
    }
  }

  parts.push(formatToolMetadata(toolName, event, undefined), '')
  return parts.join('\n')
}

function toolCallTitle(toolName: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? displayPath(args.path) : undefined
  if (toolName === 'write' && path) return `Write \`${path}\``
  if (toolName === 'edit' && path) return `Edit \`${path}\``
  if (toolName === 'find') return 'Find files'
  if (toolName === 'grep') return 'Search files'
  return `Tool call: \`${toolName}\``
}

function formatToolMetadata(
  toolName: string,
  event: Record<string, unknown> | undefined,
  args: Record<string, unknown> | undefined
): string {
  const metadata: Record<string, unknown> = { tool: toolName }
  if (typeof event?.toolCallId === 'string') metadata.toolCallId = sanitizeLogText(event.toolCallId)
  if (args) metadata.args = formatSafeObject(args)

  return [
    '<details>',
    '<summary>Tool metadata</summary>',
    '',
    formatJsonFence(metadata),
    '',
    '</details>'
  ].join('\n')
}

function formatGenericEventMarkdown(label: string, details?: unknown, timestamp = new Date().toISOString()): string {
  const safeLabel = sanitizeLogText(label)
  const parts = [`## ${timestamp} — Event: \`${safeLabel}\``, '']
  if (details !== undefined && details !== '') {
    parts.push(formatJsonFence(formatSafeObject(details)), '')
  }
  return parts.join('\n')
}

function formatClosed(status: AgentSessionLogCloseStatus): string {
  const icon = status === 'succeeded' ? '✅' : status === 'failed' ? '❌' : status === 'aborted' ? '⚠️' : 'ℹ️'
  return [
    '## Closed',
    '',
    `${icon} \`${status}\``,
    ''
  ].join('\n')
}

function formatJsonFence(value: unknown): string {
  return formatCodeFence(JSON.stringify(value, null, 2), 'json')
}

function formatCodeFence(content: string, language = 'text'): string {
  const fence = content.includes('```') ? '````' : '```'
  return `${fence}${language}\n${content}\n${fence}`
}

function languageForPath(path: string | undefined): string {
  const normalized = path?.toLowerCase() ?? ''
  if (normalized.endsWith('.md')) return 'markdown'
  if (normalized.endsWith('.json')) return 'json'
  if (normalized.endsWith('.yml') || normalized.endsWith('.yaml')) return 'yaml'
  if (normalized.endsWith('.ts')) return 'typescript'
  if (normalized.endsWith('.vue')) return 'vue'
  return 'text'
}

function displayPath(path: string): string {
  return sanitizeLogText(path.replace(/^\/data\/?/u, '')) || '/data'
}

function extractToolResultText(value: unknown): string {
  if (!isRecord(value)) return ''
  return extractTextContent(value.content)
}

function formatSafeObject(value: unknown, options: FormatSafeObjectOptions = {}, depth = 0): unknown {
  if (depth > 6) {
    return '[max-depth]'
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return sanitizeLogText(value)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => formatSafeObject(item, options, depth + 1))
  }

  if (isRecord(value)) {
    const formatted: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value).slice(0, 50)) {
      if (isSensitiveKey(key)) {
        formatted[key] = '[redacted]'
        continue
      }

      if (key === 'messages' || key === 'message' || (!options.includeContent && (key === 'result' || key === 'content'))) {
        formatted[key] = '[omitted]'
        continue
      }

      formatted[key] = formatSafeObject(nestedValue, options, depth + 1)
    }
    return formatted
  }

  return undefined
}

function sanitizeLogText(value: string): string {
  const sanitized = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/giu, '[redacted-token]')
    .replace(/\b(?:sk|pk|rk|or)-[A-Za-z0-9_-]{8,}\b/giu, '[redacted-key]')
    .replace(/\+\d{8,15}\b/gu, '[redacted-number]')

  return sanitized.length > MAX_LOG_TEXT_LENGTH
    ? `${sanitized.slice(0, MAX_LOG_TEXT_LENGTH)}\n[truncated ${sanitized.length - MAX_LOG_TEXT_LENGTH} chars]`
    : sanitized
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function extractAssistantMessageText(value: unknown): string {
  if (!isRecord(value)) return ''
  if (value.role !== 'assistant') return ''
  return extractTextContent(value.content)
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value

  if (Array.isArray(value)) {
    return value.map(extractTextContent).filter(Boolean).join('')
  }

  if (!isRecord(value)) return ''

  if (typeof value.text === 'string') return value.text
  if (value.type === 'text' && typeof value.content === 'string') return value.content
  return ''
}

function isLifecycleEvent(type: string): boolean {
  return [
    'agent_start',
    'agent_end',
    'message_start',
    'message_end',
    'turn_start',
    'turn_end',
    'queue_update',
    'compaction_start',
    'compaction_end',
    'auto_retry_start',
    'auto_retry_end'
  ].includes(type)
}

function isHighSignalLifecycleEvent(type: string): boolean {
  return [
    'compaction_start',
    'compaction_end',
    'auto_retry_start',
    'auto_retry_end'
  ].includes(type)
}

function fromIsoSafeTimestamp(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/u.exec(value)
  if (!match) return undefined

  const iso = `${match[1]}:${match[2]}:${match[3]}.${match[4]}`
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso
}

function toSafePathSegment(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  return safe.length > 0 ? safe : 'unknown-specialist'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
