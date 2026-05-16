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

  return createAgentSession({
    cwd: options.cwd,
    resourceLoader: loader,
    tools: options.tools,
    sessionManager: SessionManager.inMemory(options.cwd),
    settingsManager,
    authStorage,
    modelRegistry,
    ...(selectedModel ? { model: selectedModel as any } : {})
  } as any)
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
