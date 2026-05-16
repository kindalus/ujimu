import { mkdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import type { SpecialistRuntime } from '../specialists/schema'
import type { StoredRawSource } from './types'

export interface StoreRawSourceInput {
  fileName: string
  content: string | Buffer
}

export class RawSourceStorageError extends Error {
  constructor(
    public readonly code: 'INVALID_RAW_FILENAME',
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
  await writeFile(absolutePath, input.content)

  return { relativePath, absolutePath }
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
    basename(trimmed) !== trimmed
  ) {
    throw new RawSourceStorageError('INVALID_RAW_FILENAME', `Invalid raw source filename "${fileName}".`)
  }

  return trimmed
}
