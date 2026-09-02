import { realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const CHAT_FILE_TOOLS = new Set(['read', 'grep', 'find', 'ls'])

export function createChatFilePolicyExtension(cwd: string): {
  name: string
  hidden: boolean
  factory: (pi: any) => void
} {
  return {
    name: 'ujimu-chat-file-policy',
    hidden: true,
    factory(pi) {
      pi.on('tool_call', async (event: { toolName?: unknown; input?: { path?: unknown } }) => {
        if (typeof event.toolName !== 'string' || !CHAT_FILE_TOOLS.has(event.toolName)) {
          return { block: true, reason: 'Tool is not available during chat consultations.' }
        }

        const requestedPath = typeof event.input?.path === 'string' ? event.input.path : '.'
        if (await isChatPathAllowed(cwd, requestedPath)) return undefined
        return { block: true, reason: 'Path is not available during chat consultations.' }
      })
    }
  }
}

export async function normalizeConsultedWikiDocumentPath(
  cwd: string,
  requestedPath: string
): Promise<string | undefined> {
  try {
    const root = await realpath(cwd)
    const wiki = await realpath(resolve(root, 'wiki'))
    const requested = await realpath(resolve(root, requestedPath))
    if (!isWithin(root, wiki) || !isWithin(wiki, requested) || extname(requested).toLowerCase() !== '.md') {
      return undefined
    }

    const relativeToWiki = relative(wiki, requested).split(sep).join('/')
    if (relativeToWiki === 'index.md' || relativeToWiki === 'log.md') return undefined
    return `wiki/${relativeToWiki}`
  } catch {
    return undefined
  }
}

export async function isChatPathAllowed(cwd: string, requestedPath: string): Promise<boolean> {
  try {
    const root = await realpath(cwd)
    const requested = await realpath(resolve(root, requestedPath))
    const agents = await realpath(resolve(root, 'AGENTS.md')).catch(() => '')
    const wiki = await realpath(resolve(root, 'wiki'))

    if (!isWithin(root, wiki)) return false
    return requested === agents || isWithin(wiki, requested)
  } catch {
    return false
  }
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}
