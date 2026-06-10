import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import { extractArticleRefs, inferSourceTitle } from './metadata'
import { readIngestionState, writeIngestionState } from './state'
import type { IngestionSourceRecord, IngestionState } from './types'

const CONVERSION_RAW_EXTENSIONS = new Set(['.pdf', '.txt', '.docx', '.html', '.htm', '.csv', '.xlsx'])
const MARKDOWN_RAW_EXTENSIONS = new Set(['.md', '.markdown'])
const SUPPORTED_RAW_EXTENSIONS = new Set([...CONVERSION_RAW_EXTENSIONS, ...MARKDOWN_RAW_EXTENSIONS])
const TEXT_RAW_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.csv'])
const GENERATED_MARKDOWN_SUFFIXES = ['.pdf.md', '.txt.md', '.docx.md', '.html.md', '.htm.md', '.csv.md', '.xlsx.md']

export async function scanSpecialistRawSources(specialist: SpecialistRuntime): Promise<IngestionState> {
  const state = await readIngestionState(specialist.paths.ingestState)
  const rawFiles = await listRawFiles(specialist.paths.raw)
  const now = new Date().toISOString()

  for (const absolutePath of rawFiles) {
    const rawPath = toRawRelativePath(specialist.paths.raw, absolutePath)
    if (isGeneratedMarkdownArtifact(rawPath)) {
      continue
    }

    const extension = extname(rawPath).toLowerCase()

    if (!SUPPORTED_RAW_EXTENSIONS.has(extension)) {
      continue
    }

    const content = await readFile(absolutePath)
    const checksum = toChecksum(content)
    const existing = state.sources[rawPath]
    const text = readTextIfSupported(extension, content)

    if (existing?.checksum === checksum || (existing && !isCanonicalSha256Checksum(existing.checksum))) {
      state.sources[rawPath] = refreshExistingRecord(existing, {
        rawPath,
        checksum: isCanonicalSha256Checksum(existing.checksum) ? checksum : existing.checksum,
        extension,
        content,
        text,
        now
      })
      continue
    }

    state.sources[rawPath] = createPendingRecord({
      existing,
      specialistId: specialist.id,
      rawPath,
      checksum,
      content,
      extension,
      text,
      now
    })
  }

  await writeIngestionState(specialist.paths.ingestState, state)
  return state
}

export function isTextSource(rawPath: string): boolean {
  const extension = extname(rawPath).toLowerCase()
  return MARKDOWN_RAW_EXTENSIONS.has(extension)
}

export function isPdfSource(rawPath: string): boolean {
  return extname(rawPath).toLowerCase() === '.pdf'
}

export function isGeneratedMarkdownArtifact(rawPath: string): boolean {
  const normalized = rawPath.toLowerCase()
  return GENERATED_MARKDOWN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function toGeneratedMarkdownPath(rawPath: string): string {
  return `${rawPath}.md`
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

function refreshExistingRecord(
  existing: IngestionSourceRecord,
  input: { rawPath: string; checksum: string; extension: string; content: Buffer; text?: string; now: string }
): IngestionSourceRecord {
  const withDefaults = ensurePipelineDefaults(existing, input)

  return {
    ...withDefaults,
    title: withDefaults.title || inferSourceTitle(input.rawPath, input.text),
    article_refs: withDefaults.article_refs?.length ? withDefaults.article_refs : extractArticleRefs(input.text ?? ''),
    updated_at: input.now
  }
}

function createPendingRecord(input: {
  existing?: IngestionSourceRecord
  specialistId: string
  rawPath: string
  checksum: string
  content: Buffer
  extension: string
  text?: string
  now: string
}): IngestionSourceRecord {
  const articleRefs = input.text ? extractArticleRefs(input.text) : []
  const title = inferSourceTitle(input.rawPath, input.text)
  const isMarkdown = MARKDOWN_RAW_EXTENSIONS.has(input.extension)
  const markdownPath = isMarkdown ? input.rawPath : toGeneratedMarkdownPath(input.rawPath)
  const previousChecksum = input.existing?.checksum
  const wasReplaced = Boolean(previousChecksum && previousChecksum !== input.checksum)

  return {
    source_id: `${input.rawPath}#${input.checksum}`,
    specialist_id: input.specialistId,
    raw_path: input.rawPath,
    checksum: input.checksum,
    ...(wasReplaced ? { previous_checksum: previousChecksum, replaced_at: input.now } : {}),
    status: isMarkdown ? 'pending' : 'blocked',
    title,
    article_refs: articleRefs,
    conversion: isMarkdown
      ? {
          status: 'not_required',
          markdown_path: markdownPath,
          markdown_checksum: input.checksum,
          updated_at: input.now
        }
      : {
          status: 'pending',
          markdown_path: markdownPath,
          updated_at: input.now
        },
    ingestion: {
      status: isMarkdown ? 'pending' : 'blocked',
      source_path: markdownPath,
      ...(isMarkdown ? {} : { skipped_reason: 'conversion_pending' }),
      updated_at: input.now
    },
    detected_at: input.now,
    updated_at: input.now
  }
}

function ensurePipelineDefaults(
  source: IngestionSourceRecord,
  input: { rawPath: string; checksum: string; extension: string; content: Buffer; text?: string; now: string }
): IngestionSourceRecord {
  const isMarkdown = MARKDOWN_RAW_EXTENSIONS.has(input.extension)
  const markdownPath = source.conversion?.markdown_path ?? (isMarkdown ? input.rawPath : toGeneratedMarkdownPath(input.rawPath))
  const ingestionStatus = source.ingestion?.status ?? (source.status === 'blocked' ? 'blocked' : source.status)
  const normalizedIngestionStatus = ingestionStatus === 'blocked' ? 'blocked' : ingestionStatus
  const conversionStatus = source.conversion?.status ?? (isMarkdown ? 'not_required' : source.status === 'ingested' ? 'converted' : 'pending')

  return {
    ...source,
    conversion: {
      status: conversionStatus,
      markdown_path: markdownPath,
      ...(isMarkdown && !source.conversion?.markdown_checksum ? { markdown_checksum: input.checksum } : {}),
      ...source.conversion,
      updated_at: source.conversion?.updated_at ?? input.now
    },
    ingestion: {
      status: normalizedIngestionStatus,
      source_path: source.ingestion?.source_path ?? markdownPath,
      ...(source.ingested_at && !source.ingestion?.ingested_at ? { ingested_at: source.ingested_at } : {}),
      ...source.ingestion,
      updated_at: source.ingestion?.updated_at ?? input.now
    }
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

function isCanonicalSha256Checksum(checksum: string): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(checksum)
}

function toRawRelativePath(rawRoot: string, absolutePath: string): string {
  return relative(rawRoot, absolutePath).split(sep).join('/')
}
