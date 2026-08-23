import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { deleteConversationHistoryForSpecialist } from '../history/delete'
import { resolveSpecialistPaths, resolveSpecialtiesRoot, type SpecialistPathOptions } from './paths'
import {
  type NormalizedSpecialistConfig,
  type SpecialistConfig,
  type SpecialistRuntime,
  type SpecialistSeoConfig,
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
>> & { seo?: SpecialistSeoConfig }

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
  await mkdir(paths.converted, { recursive: true })
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
  const updated = validateSpecialistConfig({
    ...existing,
    ...input,
    seo: input.seo ? { ...existing.seo, ...input.seo } : existing.seo
  }, specialistId)
  const tempPath = `${paths.config}.tmp`
  await writeFile(tempPath, stringifySpecialistConfig(updated))
  await rename(tempPath, paths.config)
  await reloadSpecialistRegistry({ specialtiesRoot })

  return { ...updated, paths }
}

export async function resetSpecialistWorkspace(
  specialistId: string,
  options: SpecialistManagerOptions = {}
): Promise<SpecialistRuntime> {
  assertValidSpecialistId(specialistId)
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  const paths = resolveSpecialistPaths(specialtiesRoot, specialistId)
  if (!(await pathExists(paths.root))) {
    throw new SpecialistOperationError('SPECIALIST_NOT_FOUND', `Specialist "${specialistId}" does not exist.`)
  }

  const config = validateSpecialistConfig(parse(await readFile(paths.config, 'utf8')), specialistId)
  for (const entry of await readdir(paths.root)) {
    if (entry === 'raw' || entry === 'specialist.yaml') continue
    await rm(join(paths.root, entry), { recursive: true, force: true })
  }
  await mkdir(paths.raw, { recursive: true })
  await mkdir(paths.converted, { recursive: true })
  await mkdir(paths.wiki, { recursive: true })
  await mkdir(paths.ingest, { recursive: true })
  await writeFile(paths.ingestState, '{}\n')
  await writeFile(paths.config, stringifySpecialistConfig(config))
  await reloadSpecialistRegistry({ specialtiesRoot })
  return { ...config, paths }
}

export async function rollbackSpecialistCreation(
  specialistId: string,
  options: SpecialistManagerOptions = {}
): Promise<void> {
  assertValidSpecialistId(specialistId)
  const specialtiesRoot = resolveSpecialtiesRoot(options)
  const paths = resolveSpecialistPaths(specialtiesRoot, specialistId)
  await rm(paths.root, { recursive: true, force: true })
  await reloadSpecialistRegistry({ specialtiesRoot })
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
      ...(config.system_prompt ? { system_prompt: config.system_prompt } : {}),
      citations_required: config.citations_required,
      streaming_enabled: config.streaming_enabled,
      status: config.status,
      ...(config.company_id ? { company_id: config.company_id } : {}),
      ...(hasSpecialistSeo(config.seo) ? { seo: compactSpecialistSeo(config.seo) } : {})
    },
    { lineWidth: 0 }
  )
}

function hasSpecialistSeo(seo: NormalizedSpecialistConfig['seo']): boolean {
  return Boolean(seo.title || seo.description || seo.introduction || seo.topics.length || seo.limitations || seo.call_to_action)
}

function compactSpecialistSeo(seo: NormalizedSpecialistConfig['seo']): SpecialistSeoConfig {
  return {
    ...(seo.title ? { title: seo.title } : {}),
    ...(seo.description ? { description: seo.description } : {}),
    ...(seo.introduction ? { introduction: seo.introduction } : {}),
    ...(seo.topics.length ? { topics: seo.topics } : {}),
    ...(seo.limitations ? { limitations: seo.limitations } : {}),
    ...(seo.call_to_action ? { call_to_action: seo.call_to_action } : {})
  }
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
