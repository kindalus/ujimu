import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const SHA256_FILE_TOOL_NAME = 'sha256_file'

export function createSha256FileTool(cwd: string): Record<string, unknown> {
  return {
    name: SHA256_FILE_TOOL_NAME,
    label: 'SHA-256 file',
    description: 'Compute the SHA-256 of one regular file under raw/ or converted/.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path under raw/ or converted/.' }
      },
      required: ['path'],
      additionalProperties: false
    },
    async execute(_toolCallId: string, params: { path: string }) {
      const path = await resolveAllowedFile(cwd, params.path)
      const sha256 = await hashFile(path)
      const relativePath = relative(await realpath(cwd), path).split(sep).join('/')
      const details = { path: relativePath, sha256 }
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
    }
  }
}

async function resolveAllowedFile(cwd: string, requestedPath: string): Promise<string> {
  try {
    if (!requestedPath.trim() || isAbsolute(requestedPath)) throw invalidHashPath()
    const root = await realpath(cwd)
    const targetPath = resolve(root, requestedPath)
    const targetStats = await lstat(targetPath)
    if (!targetStats.isFile() || targetStats.isSymbolicLink()) throw invalidHashPath()

    const target = await realpath(targetPath)
    const allowedRoots = await Promise.all([
      realpath(resolve(root, 'raw')),
      realpath(resolve(root, 'converted'))
    ])
    if (!allowedRoots.some(allowedRoot => isWithin(allowedRoot, target))) throw invalidHashPath()
    return target
  } catch (error) {
    if (readErrorCode(error) === 'INVALID_HASH_PATH') throw error
    throw invalidHashPath()
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return `sha256:${hash.digest('hex')}`
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

function invalidHashPath(): Error & { code: string } {
  const error = new Error('INVALID_HASH_PATH: Hashing is limited to regular files under raw/ and converted/.') as Error & { code: string }
  error.name = 'Sha256FileToolError'
  error.code = 'INVALID_HASH_PATH'
  return error
}

function readErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}
