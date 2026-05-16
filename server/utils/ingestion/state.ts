import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IngestionState } from './types'

export function createEmptyIngestionState(): IngestionState {
  return {
    version: 1,
    sources: {}
  }
}

export async function readIngestionState(path: string): Promise<IngestionState> {
  const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return undefined
    }

    throw error
  })

  if (!raw || raw.trim() === '' || raw.trim() === '{}') {
    return createEmptyIngestionState()
  }

  const parsed = JSON.parse(raw) as Partial<IngestionState>

  return {
    version: 1,
    sources: parsed.sources ?? {}
  }
}

export async function writeIngestionState(path: string, state: IngestionState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`)
}
