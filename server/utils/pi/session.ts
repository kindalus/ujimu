import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createAgentSessionLogger, type AgentSessionLogger, type AgentSessionLogTask } from '../agents/logs'
import { createChatFilePolicyExtension, createDerivationFilePolicyExtension } from './file-policy'
import { createPdfToMarkdownTool } from './pdf-to-markdown-tool'
import { ensureUjimuPiConfigDir, resolveUjimuPiBundleDir, resolveUjimuPiAgentDir } from './paths'

export type PiTaskName = AgentSessionLogTask | 'chat' | 'derivation'
export type UjimuPiToolName = 'read' | 'bash' | 'edit' | 'write' | 'grep' | 'find' | 'ls'

const UJIMU_PI_DEFAULT_TOOL_NAMES: UjimuPiToolName[] = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
const UJIMU_PI_CHAT_TOOL_NAMES: UjimuPiToolName[] = ['read', 'grep', 'find', 'ls']
const UJIMU_PI_DERIVATION_TOOL_NAMES: UjimuPiToolName[] = ['read', 'edit', 'write', 'grep', 'find', 'ls']
const UJIMU_PI_INGESTION_THINKING_LEVEL_ENV = 'UJIMU_PI_INGESTION_THINKING_LEVEL'
const UJIMU_PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type UjimuPiThinkingLevel = typeof UJIMU_PI_THINKING_LEVELS[number]

export interface CreateUjimuPiSessionOptions {
  cwd: string
  task: PiTaskName
  modelEnvPrefix?: string
  sessionManager?: any
  derivationTargetPath?: string
  agentLog?: {
    dataDir?: string
    specialistId: string
    now?: Date
  }
}

export interface CreateUjimuPiSessionResult {
  session: any
  agentLog?: AgentSessionLogger
}

export async function createUjimuPiSession(options: CreateUjimuPiSessionOptions): Promise<CreateUjimuPiSessionResult> {
  const thinkingLevel = resolveTaskThinkingLevel(options.task)
  const {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager
  } = await import('@earendil-works/pi-coding-agent')

  const configDir = await ensureUjimuPiConfigDir()
  const bundledPiDir = resolveUjimuPiBundleDir()
  const modelRuntime = await ModelRuntime.create({
    authPath: join(configDir, 'auth.json'),
    modelsPath: join(configDir, 'models.json')
  })
  const settingsManager = SettingsManager.create(options.cwd, configDir)
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: configDir,
    settingsManager,
    additionalSkillPaths: [join(bundledPiDir, 'skills')],
    additionalExtensionPaths: [join(bundledPiDir, 'extensions')],
    ...(options.task === 'chat'
      ? { extensionFactories: [createChatFilePolicyExtension(options.cwd)] }
      : options.task === 'derivation'
        ? { extensionFactories: [createDerivationFilePolicyExtension(options.cwd, requireDerivationTarget(options))] }
        : {}),
    noSkills: true
  })
  await loader.reload()

  const selectedModel = await resolveTaskModel(modelRuntime, settingsManager, options.modelEnvPrefix)
  const customTools = createUjimuCustomToolsForTask(options.task, options.cwd)
  const enabledTools = createUjimuPiEnabledToolNames(customTools, options.task)

  const result = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    tools: enabledTools,
    customTools,
    sessionManager: options.sessionManager ?? SessionManager.inMemory(options.cwd),
    settingsManager,
    modelRuntime,
    ...(selectedModel ? { model: selectedModel as any } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {})
  })

  const sessionContext = {
    task: options.task,
    cwd: options.cwd,
    configDir,
    bundledPiDir,
    tools: enabledTools,
    model: selectedModel
  }

  attachPiDebugLogger(result.session, sessionContext)

  let agentLog: AgentSessionLogger | undefined
  try {
    agentLog = await attachAgentSessionLogger(result.session, sessionContext, options)
  } catch (error) {
    result.session.dispose()
    throw error
  }

  return { ...result, ...(agentLog ? { agentLog } : {}) }
}

interface PiDebugContext {
  task: PiTaskName
  cwd: string
  configDir: string
  bundledPiDir: string
  tools: string[]
  model: unknown
}

function attachPiDebugLogger(session: any, context: PiDebugContext): void {
  if (process.env.UJIMU_PI_DEBUG_ENABLED !== 'true') {
    return
  }

  writePiDebugEvent('session_created', context)

  if (typeof session?.subscribe !== 'function') {
    writePiDebugEvent('session_subscribe_unavailable', { task: context.task })
    return
  }

  session.subscribe((event: unknown) => {
    writePiDebugEvent('session_event', event)
  })
}

async function attachAgentSessionLogger(
  session: any,
  context: PiDebugContext,
  options: CreateUjimuPiSessionOptions
): Promise<AgentSessionLogger | undefined> {
  if (!options.agentLog || !isAgentSessionLogTask(options.task)) {
    return undefined
  }

  const logger = await createAgentSessionLogger({
    dataDir: options.agentLog.dataDir,
    specialistDir: options.cwd,
    specialistId: options.agentLog.specialistId,
    task: options.task,
    now: options.agentLog.now
  })

  logger.writeSessionCreated({
    task: context.task,
    tools: context.tools,
    model: context.model ? 'configured' : 'default'
  })

  if (typeof session?.subscribe !== 'function') {
    logger.writeEvent({ type: 'session_subscribe_unavailable' })
    return logger
  }

  const unsubscribe = session.subscribe((event: unknown) => {
    logger.writeEvent(event)
  })

  return {
    path: logger.path,
    writeSessionCreated: (event) => logger.writeSessionCreated(event),
    writeEvent: (event) => logger.writeEvent(event),
    close: async (status) => {
      unsubscribe?.()
      await logger.close(status)
    }
  }
}

function isAgentSessionLogTask(task: PiTaskName): task is AgentSessionLogTask {
  return task === 'initialization' || task === 'conversion' || task === 'ingestion'
}

function writePiDebugEvent(event: string, payload: unknown): void {
  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    event: `ujimu_pi_debug_${event}`,
    payload: sanitizeDebugPayload(payload)
  }))
}

function sanitizeDebugPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[max-depth]'
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value).slice(0, 4000)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDebugPayload(item, depth + 1))
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveDebugKey(key)) {
        sanitized[key] = '[redacted]'
        continue
      }
      sanitized[key] = sanitizeDebugPayload(nestedValue, depth + 1)
    }
    return sanitized
  }

  return undefined
}

function isSensitiveDebugKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return ['authorization', 'auth', 'cookie', 'jwt', 'key', 'password', 'secret', 'session', 'token'].some((part) => normalized.includes(part))
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\b(?:sk|pk|rk|or)-[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]')
}

export function createUjimuPiEnabledToolNames(
  customTools: Array<{ name?: unknown }> = [],
  task?: PiTaskName
): string[] {
  return [...new Set([
    ...(task === 'chat'
      ? UJIMU_PI_CHAT_TOOL_NAMES
      : task === 'derivation'
        ? UJIMU_PI_DERIVATION_TOOL_NAMES
        : UJIMU_PI_DEFAULT_TOOL_NAMES),
    ...customTools.map((tool) => tool.name).filter((name): name is string => typeof name === 'string' && name.length > 0)
  ])]
}

export function createUjimuCustomToolsForTask(task: PiTaskName, cwd = process.cwd()): any[] {
  return task === 'chat' || task === 'derivation' ? [] : [createPdfToMarkdownTool({ cwd })]
}

async function resolveTaskModel(
  modelRuntime: any,
  settingsManager: any,
  modelEnvPrefix: string | undefined
): Promise<unknown | undefined> {
  const overrideProvider = modelEnvPrefix ? process.env[`${modelEnvPrefix}_PROVIDER`] : undefined
  const overrideModel = modelEnvPrefix ? process.env[`${modelEnvPrefix}_MODEL`] : undefined

  if (overrideProvider || overrideModel) {
    if (!overrideProvider || !overrideModel) {
      throw new Error(`${modelEnvPrefix}_PROVIDER and ${modelEnvPrefix}_MODEL must be set together.`)
    }

    return resolveConfiguredModel(modelRuntime, overrideProvider, overrideModel)
  }

  const defaultProvider = settingsManager.getDefaultProvider?.()
  const defaultModel = settingsManager.getDefaultModel?.()
  if (!defaultProvider || !defaultModel) {
    return undefined
  }

  return resolveConfiguredModel(modelRuntime, defaultProvider, defaultModel)
}

function resolveTaskThinkingLevel(task: PiTaskName): UjimuPiThinkingLevel | undefined {
  if (task !== 'ingestion') return undefined

  const configured = process.env[UJIMU_PI_INGESTION_THINKING_LEVEL_ENV]?.trim()
  if (!configured) return undefined
  if (!UJIMU_PI_THINKING_LEVELS.includes(configured as UjimuPiThinkingLevel)) {
    throw new Error(
      `${UJIMU_PI_INGESTION_THINKING_LEVEL_ENV} must be one of: ${UJIMU_PI_THINKING_LEVELS.join(', ')}.`
    )
  }

  return configured as UjimuPiThinkingLevel
}

function requireDerivationTarget(options: CreateUjimuPiSessionOptions): string {
  if (!options.derivationTargetPath) {
    throw new Error('A derivation target path is required for Pi derivation sessions.')
  }
  return options.derivationTargetPath
}

function resolveConfiguredModel(modelRuntime: any, provider: string, model: string): unknown {
  const resolved = modelRuntime.getModel(provider, model)
  if (!resolved) {
    throw new Error(`Configured Pi model ${provider}/${model} is not available in the Ujimu Pi agent models.json or built-in models.`)
  }

  if (!modelRuntime.hasConfiguredAuth(provider)) {
    throw new Error(`Configured Pi model ${provider}/${model} has no configured authentication.`)
  }

  return resolved
}

export function hasUjimuPiAuthFile(): boolean {
  return existsSync(join(resolveUjimuPiAgentDir(), 'auth.json'))
}
