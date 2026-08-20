import { access, lstat, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import type { StoredRawSource } from './types'

/**
 * Upload filenames reach the conversion agent's prompt, so they must not be able to carry
 * instructions. Letters, digits, spaces and a few punctuation marks cover real document names
 * while excluding newlines, backticks, and the `@` that the agent CLI reads as a file reference.
 */
const RAW_FILENAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,149}$/u

export interface StoreRawSourceInput {
  fileName: string
  content: string | Buffer
  replaceExisting?: boolean
}

export class RawSourceStorageError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_RAW_FILENAME'
      | 'INVALID_RAW_SOURCE_TARGET'
      | 'RAW_SOURCE_ALREADY_EXISTS'
      | 'GENERATED_MARKDOWN_ARTIFACT',
    message: string
  ) {
    super(message)
    this.name = 'RawSourceStorageError'
  }
}

export async function storeRawSource(
  specialist: SpecialistRuntime,
  input: StoreRawSourceInput
): Promise<StoredRawSource> {
  const relativePath = sanitizeRawFileName(input.fileName)
  const absolutePath = join(specialist.paths.raw, relativePath)

  await mkdir(specialist.paths.raw, { recursive: true })
  const replaced = await pathExists(absolutePath)
  if (replaced && !input.replaceExisting) {
    throw new RawSourceStorageError(
      'RAW_SOURCE_ALREADY_EXISTS',
      `Raw source filename "${relativePath}" already exists.`
    )
  }
  await assertNotSymlink(absolutePath)
  await writeFile(absolutePath, input.content)

  return { relativePath, absolutePath, replaced }
}

/**
 * Writing through a symlink planted in raw/ would let an upload overwrite a file outside it.
 */
async function assertNotSymlink(absolutePath: string): Promise<void> {
  const stats = await lstat(absolutePath).catch(() => undefined)
  if (stats?.isSymbolicLink()) {
    throw new RawSourceStorageError(
      'INVALID_RAW_SOURCE_TARGET',
      `Raw source path "${absolutePath}" is a symbolic link.`
    )
  }
}

function sanitizeRawFileName(fileName: string): string {
  const trimmed = fileName.trim()

  if (
    trimmed.length === 0 ||
    isAbsolute(trimmed) ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed === '.' ||
    trimmed === '..' ||
    basename(trimmed) !== trimmed ||
    !RAW_FILENAME_PATTERN.test(trimmed)
  ) {
    throw new RawSourceStorageError('INVALID_RAW_FILENAME', `Invalid raw source filename "${fileName}".`)
  }

  return normalizeMarkdownUploadName(trimmed)
}

function normalizeMarkdownUploadName(fileName: string): string {
  const extension = extname(fileName).toLowerCase()
  if (extension !== '.md' && extension !== '.markdown') {
    return fileName
  }

  if (isGeneratedMarkdownArtifactName(fileName)) {
    throw new RawSourceStorageError(
      'GENERATED_MARKDOWN_ARTIFACT',
      `Generated Markdown artefact "${fileName}" cannot be uploaded as an original source.`
    )
  }

  return `${fileName.slice(0, -extension.length)}.original.md`
}

function isGeneratedMarkdownArtifactName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase()
  return ['.pdf.md', '.txt.md', '.docx.md', '.html.md', '.htm.md', '.csv.md', '.xlsx.md']
    .some((suffix) => normalized.endsWith(suffix))
}

async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false)
}
