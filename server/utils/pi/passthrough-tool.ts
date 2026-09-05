import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

export const COPY_RAW_TO_CONVERTED_TOOL_NAME = 'copy_raw_to_converted'

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const MAX_PREFIX_BYTES = 64 * 1024

export function createRawPassthroughTool(cwd: string): Record<string, unknown> {
  return {
    name: COPY_RAW_TO_CONVERTED_TOOL_NAME,
    label: 'Copy raw source to converted',
    description: 'Copy one Markdown or text source byte-for-byte from raw/ to converted/, preceded by agent-authored converted-source frontmatter.',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Relative Markdown or text path under raw/.' },
        targetPath: { type: 'string', description: 'Relative Markdown path under converted/.' },
        prefix: {
          type: 'string',
          maxLength: MAX_PREFIX_BYTES,
          description: 'Converted Source frontmatter and separator to write before the unchanged raw bytes.'
        }
      },
      required: ['sourcePath', 'targetPath', 'prefix'],
      additionalProperties: false
    },
    async execute(_toolCallId: string, params: { sourcePath: string; targetPath: string; prefix: string }) {
      const paths = await resolvePassthroughPaths(cwd, params)
      const prefixBytes = Buffer.byteLength(params.prefix)
      if (prefixBytes === 0 || prefixBytes > MAX_PREFIX_BYTES) throw invalidPassthroughPath()

      const temporaryPath = `${paths.target}.tmp-${randomUUID()}`
      try {
        const output = createWriteStream(temporaryPath, { flags: 'wx' })
        output.write(params.prefix)
        await pipeline(createReadStream(paths.source), output)
        await rename(temporaryPath, paths.target)
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
        throw error
      }

      const details = {
        sourcePath: paths.sourceRelative,
        targetPath: paths.targetRelative,
        bytes: (await stat(paths.target)).size
      }
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
    }
  }
}

async function resolvePassthroughPaths(
  cwd: string,
  params: { sourcePath: string; targetPath: string }
): Promise<{ source: string; target: string; sourceRelative: string; targetRelative: string }> {
  try {
    if (isAbsolute(params.sourcePath) || isAbsolute(params.targetPath)) throw invalidPassthroughPath()
    const root = await realpath(cwd)
    const raw = await realpath(resolve(root, 'raw'))
    const converted = await realpath(resolve(root, 'converted'))
    const sourcePath = resolve(root, params.sourcePath)
    const sourceStats = await lstat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw invalidPassthroughPath()
    const source = await realpath(sourcePath)
    if (!isWithin(raw, source) || !TEXT_EXTENSIONS.has(extname(source).toLowerCase())) throw invalidPassthroughPath()

    const target = resolve(root, params.targetPath)
    if (!isWithin(converted, target) || extname(target).toLowerCase() !== '.md') throw invalidPassthroughPath()
    await mkdir(dirname(target), { recursive: true })
    const targetParent = await realpath(dirname(target))
    const targetStats = await lstat(target).catch(() => undefined)
    if (!isWithin(converted, targetParent) || targetStats?.isSymbolicLink() || (targetStats && !targetStats.isFile())) {
      throw invalidPassthroughPath()
    }

    return {
      source,
      target,
      sourceRelative: relative(root, source).split(sep).join('/'),
      targetRelative: relative(root, target).split(sep).join('/')
    }
  } catch (error) {
    if (readErrorCode(error) === 'INVALID_PASSTHROUGH_PATH') throw error
    throw invalidPassthroughPath()
  }
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

function invalidPassthroughPath(): Error & { code: string } {
  const error = new Error('INVALID_PASSTHROUGH_PATH: Passthrough is limited to textual raw/ sources and Markdown targets under converted/.') as Error & { code: string }
  error.name = 'RawPassthroughToolError'
  error.code = 'INVALID_PASSTHROUGH_PATH'
  return error
}

function readErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}
