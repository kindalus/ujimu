import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { stringify } from 'yaml'
import { deleteConversationHistoryForSpecialist } from '../history/delete'
import { resolveSpecialistPaths, resolveSpecialtiesRoot, type SpecialistPathOptions } from './paths'
import {
  type SpecialistConfig,
  type SpecialistRuntime,
  assertValidSpecialistId,
  validateSpecialistConfig
} from './schema'
import { reloadSpecialistRegistry } from './registry'

export interface SpecialistManagerOptions extends SpecialistPathOptions {
  deleteHistoryForSpecialist?: (specialistId: string) => Promise<void>
}

export class SpecialistOperationError extends Error {
  constructor(
    public readonly code: 'SPECIALIST_ALREADY_EXISTS' | 'SPECIALIST_NOT_FOUND',
    message: string
  ) {
    super(message)
    this.name = 'SpecialistOperationError'
  }
}

export async function createSpecialist(
  input: SpecialistConfig,
  options: SpecialistManagerOptions = {}
): Promise<SpecialistRuntime> {
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  const config = validateSpecialistConfig(input, input.id)
  const paths = resolveSpecialistPaths(specialtiesRoot, config.id)

  if (await pathExists(paths.root)) {
    throw new SpecialistOperationError(
      'SPECIALIST_ALREADY_EXISTS',
      `Specialist "${config.id}" already exists.`
    )
  }

  await mkdir(paths.raw, { recursive: true })
  await mkdir(paths.wiki, { recursive: true })
  await mkdir(paths.ingest, { recursive: true })
  await writeFile(paths.ingestState, '{}\n')
  await writeFile(paths.config, stringifySpecialistConfig(config))

  await reloadSpecialistRegistry({ specialtiesRoot })
  return { ...config, paths }
}

export async function deleteSpecialist(
  specialistId: string,
  options: SpecialistManagerOptions = {}
): Promise<void> {
  assertValidSpecialistId(specialistId)
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  const paths = resolveSpecialistPaths(specialtiesRoot, specialistId)

  if (!(await pathExists(paths.root))) {
    throw new SpecialistOperationError(
      'SPECIALIST_NOT_FOUND',
      `Specialist "${specialistId}" does not exist.`
    )
  }

  await (options.deleteHistoryForSpecialist ?? deleteConversationHistoryForSpecialist)(specialistId)
  await rm(paths.root, { recursive: true, force: false })
  await reloadSpecialistRegistry({ specialtiesRoot })
}

function stringifySpecialistConfig(config: SpecialistConfig): string {
  return stringify(
    {
      id: config.id,
      name: config.name,
      description: config.description,
      wiki_type: config.wiki_type,
      system_prompt: config.system_prompt,
      citations_required: config.citations_required,
      streaming_enabled: config.streaming_enabled
    },
    { lineWidth: 0 }
  )
}

async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false)
}
