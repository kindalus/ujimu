import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { extractArticleRefs, inferSourceTitle } from './metadata'
import { readIngestionState, writeIngestionState } from './state'
import type { IngestionSourceRecord, IngestionState } from './types'

const SUPPORTED_RAW_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf'])
const TEXT_RAW_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

export async function scanSpecialistRawSources(specialist: SpecialistRuntime): Promise<IngestionState> {
  const state = await readIngestionState(specialist.paths.ingestState)
  const rawFiles = await listRawFiles(specialist.paths.raw)
  const now = new Date().toISOString()

  for (const absolutePath of rawFiles) {
    const rawPath = toRawRelativePath(specialist.paths.raw, absolutePath)
    const extension = extname(rawPath).toLowerCase()

    if (!SUPPORTED_RAW_EXTENSIONS.has(extension)) {
      continue
    }

    const content = await readFile(absolutePath)
    const checksum = toChecksum(content)
    const existing = state.sources[rawPath]

    if (existing?.checksum === checksum) {
      state.sources[rawPath] = {
        ...existing,
        title: existing.title || inferSourceTitle(rawPath, readTextIfSupported(extension, content)),
        article_refs: existing.article_refs?.length
          ? existing.article_refs
          : extractArticleRefs(readTextIfSupported(extension, content) ?? ''),
        updated_at: now
      }
      continue
    }

    state.sources[rawPath] = createPendingRecord({
      specialistId: specialist.id,
      rawPath,
      checksum,
      content,
      extension,
      now
    })
  }

  await writeIngestionState(specialist.paths.ingestState, state)
  return state
}

export function isTextSource(rawPath: string): boolean {
  return TEXT_RAW_EXTENSIONS.has(extname(rawPath).toLowerCase())
}

export function isPdfSource(rawPath: string): boolean {
  return extname(rawPath).toLowerCase() === '.pdf'
}

async function listRawFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listRawFiles(path)))
      continue
    }

    if (entry.isFile()) {
      files.push(path)
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

function createPendingRecord(input: {
  specialistId: string
  rawPath: string
  checksum: string
  content: Buffer
  extension: string
  now: string
}): IngestionSourceRecord {
  const text = readTextIfSupported(input.extension, input.content)

  return {
    source_id: `${input.rawPath}#${input.checksum}`,
    specialist_id: input.specialistId,
    raw_path: input.rawPath,
    checksum: input.checksum,
    status: 'pending',
    title: inferSourceTitle(input.rawPath, text),
    article_refs: text ? extractArticleRefs(text) : [],
    detected_at: input.now,
    updated_at: input.now
  }
}

function readTextIfSupported(extension: string, content: Buffer): string | undefined {
  if (!TEXT_RAW_EXTENSIONS.has(extension)) {
    return undefined
  }

  return content.toString('utf8')
}

function toChecksum(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function toRawRelativePath(rawRoot: string, absolutePath: string): string {
  return relative(rawRoot, absolutePath).split(sep).join('/')
}
