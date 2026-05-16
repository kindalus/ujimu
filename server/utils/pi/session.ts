import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type PiTaskName = 'conversion' | 'ingestion' | 'chat'

export interface CreateUjimuPiSessionOptions {
  cwd: string
  task: PiTaskName
  tools: unknown[]
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

  const selectedModel = await resolveTaskModel(modelRegistry, options.modelEnvPrefix)

  return createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    tools: options.tools as any,
    sessionManager: SessionManager.inMemory(options.cwd),
    settingsManager,
    authStorage,
    modelRegistry,
    ...(selectedModel ? { model: selectedModel as any } : {})
  } as any)
}

export async function createUjimuFileTools(cwd: string, toolNames: Array<'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls'>): Promise<unknown[]> {
  const pi = await import('@earendil-works/pi-coding-agent')
  const factories: Record<string, (cwd: string) => unknown> = {
    read: pi.createReadTool,
    write: pi.createWriteTool,
    edit: pi.createEditTool,
    grep: pi.createGrepTool,
    find: pi.createFindTool,
    ls: pi.createLsTool
  }

  return toolNames.map((name) => factories[name](cwd))
}

async function resolveTaskModel(modelRegistry: any, modelEnvPrefix: string | undefined): Promise<unknown | undefined> {
  if (!modelEnvPrefix) return undefined

  const provider = process.env[`${modelEnvPrefix}_PROVIDER`]
  const model = process.env[`${modelEnvPrefix}_MODEL`]

  if (!provider && !model) return undefined
  if (!provider || !model) {
    throw new Error(`${modelEnvPrefix}_PROVIDER and ${modelEnvPrefix}_MODEL must be set together.`)
  }

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
