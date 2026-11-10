import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { normalizeConsultedWikiDocumentPath } from '../pi/file-policy'
import type { SemanticEmbedder } from './semantic-retrieval'

export const WIKI_EXCERPT_LIMIT = 6
const EXCLUDED_PREFIXES = ['sources/', 'laws/']
const RESERVED_PAGES = new Set(['index.md', 'log.md'])
const DIMENSIONS = 384
const VECTOR_BYTES = DIMENSIONS * Float32Array.BYTES_PER_ELEMENT
const BUSY_TIMEOUT_MS = 100

// Settings the llm-wiki `wiki_index.py` script writes; any difference means another model or chunker.
const EXPECTED_META: Record<string, string> = {
  schema_version: '1',
  chunker_version: '1',
  model: 'Xenova/multilingual-e5-small',
  model_sha256: '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c',
  dimensions: String(DIMENSIONS),
  query_prefix: 'query: ',
  passage_prefix: 'passage: '
}

export interface WikiExcerpt {
  /** Root-relative page path, `wiki/...`. */
  path: string
  title: string
  heading: string
  text: string
  citations: string
  score: number
}

export interface WikiExcerptSource {
  page: string
  sourceTitle: string
  sourceFile: string
}

export interface WikiExcerpts {
  results: WikiExcerpt[]
  sources: WikiExcerptSource[]
}

export interface WikiExcerptSearchInput {
  specialistRoot: string
  question: string
  blockedWikiPaths?: string[]
}

export interface WikiExcerptSearchDeps {
  embed: SemanticEmbedder
  timeoutMs: number
}

export type WikiExcerptSearch = (input: WikiExcerptSearchInput) => Promise<WikiExcerpts | undefined>

interface IndexPage {
  sha256: string
  title: string
  citations: string
  citedSources: string[]
  sourceTitle: string | null
  sourceFile: string | null
}

interface IndexSection {
  path: string
  heading: string
  text: string
  vector: Float32Array
}

interface LoadedIndex {
  queryPrefix: string
  pages: Map<string, IndexPage>
  sections: IndexSection[]
}

interface CachedIndex extends LoadedIndex {
  mtimeMs: number
  size: number
  indexedAt: string | undefined
}

class InvalidWikiIndexError extends Error {}

const indexCache = new Map<string, CachedIndex>()
const fileHashCache = new Map<string, { mtimeMs: number; size: number; sha256: string }>()

/**
 * Best sections of the specialist wiki index for the question, or undefined when the
 * index is absent, out of sync with the wiki, invalid, busy, or the model fails.
 */
export async function searchWikiExcerpts(
  input: WikiExcerptSearchInput,
  deps: WikiExcerptSearchDeps
): Promise<WikiExcerpts | undefined> {
  try {
    return await withTimeout(search(input, deps), deps.timeoutMs)
  } catch {
    console.error('[ujimu] wiki excerpt search failed', { code: 'WIKI_EXCERPTS_FAILED' })
    return undefined
  }
}

async function search(input: WikiExcerptSearchInput, deps: WikiExcerptSearchDeps): Promise<WikiExcerpts | undefined> {
  const root = resolve(input.specialistRoot)
  const index = await loadIndex(join(root, 'db', 'wiki-index.sqlite'))
  if (!index || !(await isInSync(join(root, 'wiki'), index.pages))) return undefined

  const blocked = new Set(input.blockedWikiPaths ?? [])
  const eligible = index.sections.filter(({ path }) =>
    // Case-insensitive, like the skill's `not like 'sources/%'`.
    !EXCLUDED_PREFIXES.some((prefix) => path.toLowerCase().startsWith(prefix)) && !blocked.has(`wiki/${path}`))
  if (eligible.length === 0) return undefined

  const [query] = await deps.embed([`${index.queryPrefix}${input.question}`])
  if (!query || query.length !== DIMENSIONS || !query.every(Number.isFinite)) {
    throw new Error('Unexpected query embedding.')
  }

  const ranked = eligible
    .map((section) => ({ section, score: dot(query, section.vector) }))
    .sort((a, b) => b.score - a.score)
  const pageAllowed = new Map<string, boolean>()
  const results: WikiExcerpt[] = []
  const cited: string[] = []
  for (const { section, score } of ranked) {
    if (results.length === WIKI_EXCERPT_LIMIT) break
    const wikiPath = `wiki/${section.path}`
    if (!pageAllowed.has(section.path)) {
      // A symlink or a path that leaves the wiki does not normalise to itself.
      pageAllowed.set(section.path, await normalizeConsultedWikiDocumentPath(root, wikiPath) === wikiPath)
    }
    if (!pageAllowed.get(section.path)) continue

    // The skill joins sections to pages; a section without its page is skipped.
    const page = index.pages.get(section.path)
    if (!page) continue
    results.push({
      path: wikiPath,
      title: page.title,
      heading: section.heading,
      text: section.text,
      citations: page.citations,
      score
    })
    for (const source of page.citedSources) {
      if (!cited.includes(source)) cited.push(source)
    }
  }
  if (results.length === 0) return undefined

  const sources: WikiExcerptSource[] = []
  for (const path of cited) {
    const page = index.pages.get(path)
    if (page?.sourceTitle && page.sourceFile && await isRawSourceFile(root, page.sourceFile)) {
      sources.push({ page: `wiki/${path}`, sourceTitle: page.sourceTitle, sourceFile: page.sourceFile })
    }
  }
  return { results, sources }
}

async function loadIndex(path: string): Promise<LoadedIndex | undefined> {
  const file = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!file) return undefined

  const database = new DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS })
  try {
    database.exec('BEGIN')
    const meta = Object.fromEntries(
      (database.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>)
        .map(({ key, value }) => [key, value])
    )
    if (Object.entries(EXPECTED_META).some(([key, value]) => meta[key] !== value)) {
      throw new InvalidWikiIndexError('Wiki index settings differ.')
    }

    const cached = indexCache.get(path)
    if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size && cached.indexedAt === meta.indexed_at) {
      database.exec('COMMIT')
      return cached
    }

    const pages = new Map<string, IndexPage>()
    for (const row of database.prepare(`
      SELECT path, sha256, title, citations, cited_sources, source_title, source_file FROM pages
    `).all() as Array<Record<string, any>>) {
      const citedSources = JSON.parse(row.cited_sources ?? '[]')
      pages.set(String(row.path), {
        sha256: String(row.sha256),
        title: typeof row.title === 'string' && row.title ? row.title : String(row.path),
        citations: typeof row.citations === 'string' ? row.citations : '',
        citedSources: Array.isArray(citedSources) ? citedSources.filter((source) => typeof source === 'string') : [],
        sourceTitle: typeof row.source_title === 'string' ? row.source_title : null,
        sourceFile: typeof row.source_file === 'string' ? row.source_file : null
      })
    }
    const sections = (database.prepare('SELECT path, heading, text, vector FROM sections ORDER BY path, ord').all() as Array<Record<string, any>>)
      .map((row) => ({
        path: String(row.path),
        heading: typeof row.heading === 'string' ? row.heading : '',
        text: String(row.text),
        vector: toVector(row.vector)
      }))
    database.exec('COMMIT')

    const loaded: CachedIndex = {
      queryPrefix: meta.query_prefix,
      pages,
      sections,
      mtimeMs: file.mtimeMs,
      size: file.size,
      indexedAt: meta.indexed_at
    }
    indexCache.set(path, loaded)
    return loaded
  } finally {
    database.close()
  }
}

function toVector(blob: unknown): Float32Array {
  if (!(blob instanceof Uint8Array) || blob.byteLength !== VECTOR_BYTES) {
    throw new InvalidWikiIndexError('Unexpected wiki index vector.')
  }
  // Copy into a fresh, aligned buffer; the blob may be a view into a larger one.
  const vector = new Float32Array(Uint8Array.from(blob).buffer)
  if (!vector.every(Number.isFinite)) throw new InvalidWikiIndexError('Unexpected wiki index vector.')
  return vector
}

async function isInSync(wikiDir: string, pages: Map<string, IndexPage>): Promise<boolean> {
  const files = await listWikiFiles(wikiDir)
  if (files.length !== pages.size) return false
  for (const path of files) {
    const page = pages.get(path)
    if (!page || await hashFile(join(wikiDir, path)) !== page.sha256) return false
  }
  return true
}

// Same set as the skill's `wiki_files`: every `*.md` under wiki/ except the top-level index and log.
async function listWikiFiles(wikiDir: string): Promise<string[]> {
  const entries = await readdir(wikiDir, { recursive: true, withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith('.md')) continue
    const full = join(entry.parentPath, entry.name)
    const path = relative(wikiDir, full).split(sep).join('/')
    if (RESERVED_PAGES.has(path)) continue
    if (entry.isFile() || (entry.isSymbolicLink() && (await stat(full).catch(() => undefined))?.isFile())) {
      files.push(path)
    }
  }
  return files
}

async function hashFile(path: string): Promise<string> {
  const file = await stat(path)
  const cached = fileHashCache.get(path)
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) return cached.sha256
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
  fileHashCache.set(path, { mtimeMs: file.mtimeMs, size: file.size, sha256 })
  return sha256
}

async function isRawSourceFile(root: string, sourceFile: string): Promise<boolean> {
  if (!sourceFile.startsWith('raw/')) return false
  try {
    const raw = await realpath(join(root, 'raw'))
    const file = await realpath(join(root, sourceFile))
    return file.startsWith(`${raw}${sep}`) && (await stat(file)).isFile()
  } catch {
    return false
  }
}

function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let total = 0
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index]
  return total
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Wiki excerpt search timed out.')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
