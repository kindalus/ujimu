import { copyFile, mkdir, stat, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const DEFAULT_UJIMU_CONFIG_DIR = '~/.config/ujimu'
export const DEFAULT_UJIMU_PI_BUNDLE_DIR = join('config', 'pi')

interface ResolvePiPathOptions {
  env?: Record<string, string | undefined>
}

interface EnsureUjimuPiConfigOptions extends ResolvePiPathOptions {
  bundledPiDir?: string
}

export function resolveUjimuConfigDir(options: ResolvePiPathOptions = {}): string {
  const env = options.env ?? process.env
  return resolvePath(env.UJIMU_CONFIG_DIR || DEFAULT_UJIMU_CONFIG_DIR)
}

export function resolveUjimuPiAgentDir(options: ResolvePiPathOptions = {}): string {
  return resolveUjimuConfigDir(options)
}

export function resolveUjimuPiBundleDir(options: ResolvePiPathOptions = {}): string {
  const env = options.env ?? process.env
  return resolvePath(env.UJIMU_PI_BUNDLE_DIR || join(process.cwd(), DEFAULT_UJIMU_PI_BUNDLE_DIR))
}

export async function ensureUjimuPiConfigDir(options: EnsureUjimuPiConfigOptions = {}): Promise<string> {
  const configDir = resolveUjimuConfigDir(options)
  const bundledPiDir = options.bundledPiDir ?? resolveUjimuPiBundleDir(options)
  await mkdir(configDir, { recursive: true })

  await copyIfMissing(join(bundledPiDir, 'auth.json.sample'), join(configDir, 'auth.json'), 0o600)
  await copyIfMissing(join(bundledPiDir, 'models.json'), join(configDir, 'models.json'))
  await copyIfMissing(join(bundledPiDir, 'settings.json'), join(configDir, 'settings.json'))

  return configDir
}

export function resolveUjimuPiToolPath(toolName: string): string {
  return join(resolveUjimuPiBundleDir(), 'tools', toolName)
}

async function copyIfMissing(source: string, target: string, mode?: number): Promise<void> {
  const existing = await stat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })

  if (!existing) {
    await copyFile(source, target)
  }

  if (mode !== undefined) {
    await chmod(target, mode).catch(() => undefined)
  }
}

function resolvePath(path: string): string {
  const expanded = expandHome(path)
  return isAbsolute(expanded) ? expanded : resolve(expanded)
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}
