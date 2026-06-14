import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { createAgentSessionLogger, type AgentSessionLogger, type AgentSessionLogTask } from '../agents/logs'
import { createPdfToMarkdownTool } from './pdf-to-markdown-tool'
import { ensureUjimuPiConfigDir, resolveUjimuPiBundleDir, resolveUjimuPiAgentDir } from './paths'
import { createSandboxedFileTools, type UjimuPiFileSystemPolicy } from './sandboxed-tools'

export type PiTaskName = AgentSessionLogTask | 'chat'

export interface CreateUjimuPiSessionOptions {
  cwd: string
  task: PiTaskName
  tools: Array<'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls'>
  fileSystemPolicy: UjimuPiFileSystemPolicy
  appendSystemPromptOverride?: () => string[]
  modelEnvPrefix?: string
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
  const {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
    SettingsManager
  } = await import('@earendil-works/pi-coding-agent')

  const configDir = await ensureUjimuPiConfigDir()
  const bundledPiDir = resolveUjimuPiBundleDir()
  const authStorage = AuthStorage.create(join(configDir, 'auth.json'))
  const modelRegistry = ModelRegistry.create(authStorage, join(configDir, 'models.json'))
  const settingsManager = SettingsManager.create(options.cwd, configDir)
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: bundledPiDir,
    settingsManager,
    additionalSkillPaths: [join(bundledPiDir, 'skills')],
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    skillsOverride: (base: any) => ({
      ...base,
      skills: base.skills.map((skill: any) => ({
        ...skill,
        filePath: toVirtualBundlePath(skill.filePath, bundledPiDir)
      }))
    }),
    appendSystemPromptOverride: options.appendSystemPromptOverride
  })
  await loader.reload()

  const selectedModel = await resolveTaskModel(modelRegistry, settingsManager, options.modelEnvPrefix)
  const sandboxedFileTools = await createSandboxedFileTools(options.fileSystemPolicy, options.tools)
  const customTools = [...sandboxedFileTools, ...createUjimuCustomToolsForTask(options.task, options.cwd)]

  const result = await createAgentSession({
    cwd: '/data',
    resourceLoader: loader,
    tools: options.tools,
    customTools,
    sessionManager: SessionManager.inMemory('/data'),
    settingsManager,
    authStorage,
    modelRegistry,
    ...(selectedModel ? { model: selectedModel as any } : {})
  } as any)

  const sessionContext = {
    task: options.task,
    cwd: options.cwd,
    configDir,
    bundledPiDir,
    tools: [...options.tools, ...customTools.map((tool: any) => tool.name)],
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

function toVirtualBundlePath(filePath: string, bundleRoot: string): string {
  const relativePath = relative(bundleRoot, filePath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return '/bundle'
  }
  return `/bundle/${relativePath.split(sep).join('/')}`
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

export function createUjimuFileTools(
  _cwd: string,
  toolNames: Array<'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls'>
): Array<'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls'> {
  return toolNames
}

export function createUjimuCustomToolsForTask(task: PiTaskName, cwd = process.cwd()): any[] {
  if (task !== 'conversion') {
    return []
  }

  return [createPdfToMarkdownTool({ cwd })]
}

async function resolveTaskModel(
  modelRegistry: any,
  settingsManager: any,
  modelEnvPrefix: string | undefined
): Promise<unknown | undefined> {
  const overrideProvider = modelEnvPrefix ? process.env[`${modelEnvPrefix}_PROVIDER`] : undefined
  const overrideModel = modelEnvPrefix ? process.env[`${modelEnvPrefix}_MODEL`] : undefined

  if (overrideProvider || overrideModel) {
    if (!overrideProvider || !overrideModel) {
      throw new Error(`${modelEnvPrefix}_PROVIDER and ${modelEnvPrefix}_MODEL must be set together.`)
    }

    return resolveConfiguredModel(modelRegistry, overrideProvider, overrideModel)
  }

  const defaultProvider = settingsManager.getDefaultProvider?.()
  const defaultModel = settingsManager.getDefaultModel?.()
  if (!defaultProvider || !defaultModel) {
    return undefined
  }

  return resolveConfiguredModel(modelRegistry, defaultProvider, defaultModel)
}

function resolveConfiguredModel(modelRegistry: any, provider: string, model: string): unknown {
  const resolved = modelRegistry.find(provider, model)
  if (!resolved) {
    throw new Error(`Configured Pi model ${provider}/${model} is not available in the Ujimu Pi agent models.json or built-in models.`)
  }

  if (!modelRegistry.hasConfiguredAuth(resolved)) {
    throw new Error(`Configured Pi model ${provider}/${model} has no configured authentication.`)
  }

  return resolved
}

export function hasUjimuPiAuthFile(): boolean {
  return existsSync(join(resolveUjimuPiAgentDir(), 'auth.json'))
}
