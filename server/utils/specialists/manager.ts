import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { deleteConversationHistoryForSpecialist } from '../history/delete'
import { resolveSpecialistPaths, resolveSpecialtiesRoot, type SpecialistPathOptions } from './paths'
import {
  type NormalizedSpecialistConfig,
  type SpecialistConfig,
  type SpecialistRuntime,
  assertValidSpecialistId,
  validateSpecialistConfig
} from './schema'
import { reloadSpecialistRegistry } from './registry'

export interface SpecialistManagerOptions extends SpecialistPathOptions {
  deleteHistoryForSpecialist?: (specialistId: string) => Promise<void>
}

export type EditSpecialistInput = Partial<Pick<
  NormalizedSpecialistConfig,
  'name' | 'description' | 'system_prompt' | 'citations_required' | 'streaming_enabled' | 'status' | 'company_id'
>>

export interface DeleteSpecialistResult {
  trashPath: string
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

export async function editSpecialist(
  specialistId: string,
  input: EditSpecialistInput,
  options: SpecialistManagerOptions = {}
): Promise<SpecialistRuntime> {
  assertValidSpecialistId(specialistId)
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  const paths = resolveSpecialistPaths(specialtiesRoot, specialistId)

  if (!(await pathExists(paths.root))) {
    throw new SpecialistOperationError(
      'SPECIALIST_NOT_FOUND',
      `Specialist "${specialistId}" does not exist.`
    )
  }

  const existing = validateSpecialistConfig(parse(await readFile(paths.config, 'utf8')), specialistId)
  const updated = validateSpecialistConfig({ ...existing, ...input }, specialistId)
  const tempPath = `${paths.config}.tmp`
  await writeFile(tempPath, stringifySpecialistConfig(updated))
  await rename(tempPath, paths.config)
  await reloadSpecialistRegistry({ specialtiesRoot })

  return { ...updated, paths }
}

export async function deleteSpecialist(
  specialistId: string,
  options: SpecialistManagerOptions = {}
): Promise<DeleteSpecialistResult> {
  assertValidSpecialistId(specialistId)
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  const paths = resolveSpecialistPaths(specialtiesRoot, specialistId)

  if (!(await pathExists(paths.root))) {
    throw new SpecialistOperationError(
      'SPECIALIST_NOT_FOUND',
      `Specialist "${specialistId}" does not exist.`
    )
  }

  const trashPath = await moveSpecialistToTrash(paths.root, specialistId, specialtiesRoot, options)
  await (options.deleteHistoryForSpecialist ?? deleteConversationHistoryForSpecialist)(specialistId)
  await reloadSpecialistRegistry({ specialtiesRoot })

  return { trashPath }
}

function stringifySpecialistConfig(config: NormalizedSpecialistConfig): string {
  return stringify(
    {
      id: config.id,
      name: config.name,
      description: config.description,
      wiki_type: config.wiki_type,
      system_prompt: config.system_prompt,
      citations_required: config.citations_required,
      streaming_enabled: config.streaming_enabled,
      status: config.status,
      ...(config.company_id ? { company_id: config.company_id } : {})
    },
    { lineWidth: 0 }
  )
}

async function moveSpecialistToTrash(
  specialistRoot: string,
  specialistId: string,
  specialtiesRoot: string,
  options: SpecialistPathOptions
): Promise<string> {
  const trashRoot = join(options.dataDir ?? dirname(specialtiesRoot), 'trash', 'specialties')
  await mkdir(trashRoot, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const trashPath = join(trashRoot, `${timestamp}_${specialistId}`)
  await rename(specialistRoot, trashPath)
  return trashPath
}

async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false)
}
