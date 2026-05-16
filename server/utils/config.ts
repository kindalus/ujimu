import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface AppConfig {
  dataDir: string
  dbDir: string
  dbPath: string
  publicAppName: string
}

export interface ResolveAppConfigOptions {
  env?: Record<string, string | undefined>
}

const DEFAULT_DATA_DIR = '~/.local/share/ujimu'
const DEFAULT_DB_FILENAME = 'ujimu.sqlite'

export function resolveAppConfig(options: ResolveAppConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env
  const dataDir = resolvePath(env.UJIMU_DATA_DIR ?? DEFAULT_DATA_DIR)
  const dbDir = join(dataDir, 'db')
  const configuredDbPath = env.UJIMU_DB_PATH

  return {
    dataDir,
    dbDir,
    dbPath: configuredDbPath
      ? resolvePath(configuredDbPath, { dataDir })
      : join(dbDir, DEFAULT_DB_FILENAME),
    publicAppName: env.NUXT_PUBLIC_APP_NAME ?? 'Ujimu'
  }
}

function resolvePath(path: string, context: { dataDir?: string } = {}): string {
  const expanded = expandEnvironmentPath(expandHome(path), context)
  return isAbsolute(expanded) ? expanded : resolve(expanded)
}

function expandHome(path: string): string {
  if (path === '~') {
    return homedir()
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }

  return path
}

function expandEnvironmentPath(path: string, context: { dataDir?: string }): string {
  if (context.dataDir && path.startsWith('$UJIMU_DATA_DIR/')) {
    return join(context.dataDir, path.slice('$UJIMU_DATA_DIR/'.length))
  }

  if (context.dataDir && path === '$UJIMU_DATA_DIR') {
    return context.dataDir
  }

  return path
}
