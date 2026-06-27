import { join } from 'node:path'
import { resolveAppConfig } from '../config'

export interface SpecialistPathOptions {
  dataDir?: string
  specialtiesRoot?: string
}

export function resolveSpecialtiesRoot(options: SpecialistPathOptions = {}): string {
  if (options.specialtiesRoot) {
    return options.specialtiesRoot
  }

  const appConfig = options.dataDir
    ? resolveAppConfig({ env: { ...process.env, UJIMU_DATA_DIR: options.dataDir } })
    : resolveAppConfig()

  return join(appConfig.dataDir, 'specialties')
}

export function resolveSpecialistPaths(specialtiesRoot: string, specialistId: string) {
  const root = join(specialtiesRoot, specialistId)

  return {
    root,
    config: join(root, 'specialist.yaml'),
    raw: join(root, 'raw'),
    converted: join(root, 'converted'),
    wiki: join(root, 'wiki'),
    ingest: join(root, 'ingest'),
    ingestState: join(root, 'ingest', 'state.json')
  }
}
