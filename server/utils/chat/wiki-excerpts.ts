import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SemanticEmbedder } from './semantic-retrieval'

export const WIKI_EXCERPT_LIMIT = 6
const EXCLUDED_PREFIXES = ['sources/', 'laws/']

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
  path: string
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
  meta: Record<string, string>
  pages: Map<string, IndexPage>
  sections: IndexSection[]
}

export async function searchWikiExcerpts(
  input: WikiExcerptSearchInput,
  deps: WikiExcerptSearchDeps
): Promise<WikiExcerpts | undefined> {
  const index = loadIndex(join(input.specialistRoot, 'db', 'wiki-index.sqlite'))
  const [query] = await deps.embed([`${index.meta.query_prefix}${input.question}`])

  const ranked = index.sections
    .filter(({ path }) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .map((section) => ({ section, score: dot(query, section.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, WIKI_EXCERPT_LIMIT)
  if (ranked.length === 0) return undefined

  const results: WikiExcerpt[] = []
  const cited: string[] = []
  for (const { section, score } of ranked) {
    const page = index.pages.get(section.path)!
    results.push({
      path: `wiki/${section.path}`,
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

  const sources = cited.flatMap((path) => {
    const page = index.pages.get(path)
    return page?.sourceTitle && page.sourceFile
      ? [{ page: `wiki/${path}`, sourceTitle: page.sourceTitle, sourceFile: page.sourceFile }]
      : []
  })
  return { results, sources }
}

function loadIndex(path: string): LoadedIndex {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    database.exec('BEGIN')
    const meta = Object.fromEntries(
      (database.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>)
        .map(({ key, value }) => [key, value])
    )
    const pages = new Map<string, IndexPage>()
    for (const row of database.prepare(`
      SELECT path, title, citations, cited_sources, source_title, source_file FROM pages
    `).all() as Array<Record<string, any>>) {
      pages.set(row.path, {
        path: row.path,
        title: row.title ?? row.path,
        citations: row.citations ?? '',
        citedSources: JSON.parse(row.cited_sources ?? '[]'),
        sourceTitle: row.source_title,
        sourceFile: row.source_file
      })
    }
    const sections = (database.prepare('SELECT path, heading, text, vector FROM sections ORDER BY path, ord').all() as Array<Record<string, any>>)
      .map((row) => ({
        path: row.path,
        heading: row.heading ?? '',
        text: row.text,
        vector: new Float32Array(Uint8Array.from(row.vector as Uint8Array).buffer)
      }))
    database.exec('COMMIT')
    return { meta, pages, sections }
  } finally {
    database.close()
  }
}

function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let total = 0
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index]
  return total
}
