import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type PiTaskName = 'conversion' | 'ingestion' | 'chat'

export interface CreateUjimuPiSessionOptions {
  cwd: string
  task: PiTaskName
  tools: Array<'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls'>
  appendSystemPromptOverride?: () => string[]
  modelEnvPrefix?: string
}

export function resolveUjimuPiAgentDir(): string {
  return resolve(process.env.UJIMU_PI_AGENT_DIR || join(process.cwd(), '.pi'))
}

export async function createUjimuPiSession(options: CreateUjimuPiSessionOptions): Promise<{ session: any }> {
  const {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
    SettingsManager
  } = await import('@earendil-works/pi-coding-agent')

  const agentDir = resolveUjimuPiAgentDir()
  const authStorage = AuthStorage.create(join(agentDir, 'auth.json'))
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, 'models.json'))
  const settingsManager = SettingsManager.create(options.cwd, agentDir)
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    appendSystemPromptOverride: options.appendSystemPromptOverride
  })
  await loader.reload()

  const selectedModel = await resolveTaskModel(modelRegistry, settingsManager, options.modelEnvPrefix)

  const result = await createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    tools: options.tools,
    sessionManager: SessionManager.inMemory(options.cwd),
    settingsManager,
    authStorage,
    modelRegistry,
    ...(selectedModel ? { model: selectedModel as any } : {})
  } as any)

  attachPiDebugLogger(result.session, {
    task: options.task,
    cwd: options.cwd,
    agentDir,
    tools: options.tools,
    model: selectedModel
  })

  return result
}

interface PiDebugContext {
  task: PiTaskName
  cwd: string
  agentDir: string
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
    throw new Error(`Configured Pi model ${provider}/${model} is not available in .pi/models.json or built-in models.`)
  }

  if (!modelRegistry.hasConfiguredAuth(resolved)) {
    throw new Error(`Configured Pi model ${provider}/${model} has no configured authentication.`)
  }

  return resolved
}

export function hasUjimuPiAuthFile(): boolean {
  return existsSync(join(resolveUjimuPiAgentDir(), 'auth.json'))
}
