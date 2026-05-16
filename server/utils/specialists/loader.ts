import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { parse } from 'yaml'
import { resolveSpecialistPaths, resolveSpecialtiesRoot, type SpecialistPathOptions } from './paths'
import {
  SpecialistConfigError,
  type SpecialistLoadError,
  type SpecialistRuntime,
  assertValidSpecialistId,
  validateSpecialistConfig
} from './schema'

export interface SpecialistRegistrySnapshot {
  specialists: SpecialistRuntime[]
  errors: SpecialistLoadError[]
}

export type LoadSpecialistsOptions = SpecialistPathOptions

export async function loadSpecialistsFromDisk(
  options: LoadSpecialistsOptions = {}
): Promise<SpecialistRegistrySnapshot> {
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  await mkdir(specialtiesRoot, { recursive: true })

  const entries = await readdir(specialtiesRoot, { withFileTypes: true })
  const specialists: SpecialistRuntime[] = []
  const errors: SpecialistLoadError[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue
    }

    const directoryId = entry.name
    const paths = resolveSpecialistPaths(specialtiesRoot, directoryId)

    try {
      assertValidSpecialistId(directoryId)
      const yaml = await readFile(paths.config, 'utf8')
      const parsed = parse(yaml)
      const config = validateSpecialistConfig(parsed, directoryId)
      await assertRequiredDirectories(directoryId, paths)
      specialists.push({ ...config, paths })
    } catch (error) {
      errors.push(toLoadError(error, directoryId, paths.config))
    }
  }

  return { specialists, errors }
}

async function assertRequiredDirectories(
  specialistId: string,
  paths: SpecialistRuntime['paths']
): Promise<void> {
  for (const path of [paths.raw, paths.wiki, paths.ingest]) {
    const stats = await stat(path).catch(() => undefined)

    if (!stats?.isDirectory()) {
      throw new SpecialistConfigError(
        'MISSING_REQUIRED_DIRECTORY',
        `Specialist "${specialistId}" is missing required directory "${path}".`
      )
    }
  }
}

function toLoadError(error: unknown, specialistId: string, path: string): SpecialistLoadError {
  if (isNodeError(error) && error.code === 'ENOENT') {
    return {
      code: 'MISSING_CONFIG',
      specialistId,
      path,
      message: `Specialist "${specialistId}" is missing specialist.yaml.`
    }
  }

  if (error instanceof SpecialistConfigError) {
    return {
      code: error.code,
      specialistId,
      path,
      message: error.message
    }
  }

  if (error instanceof Error) {
    return {
      code: 'INVALID_YAML',
      specialistId,
      path,
      message: error.message
    }
  }

  return {
    code: 'INVALID_YAML',
    specialistId,
    path,
    message: 'Unknown specialist YAML parse error.'
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
