import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordQuestionAnalyticsEvent } from '../server/utils/analytics/questions'
import { createChatEventStreamForSpecialist } from '../server/utils/chat/engine'
import { buildChatPrompt } from '../server/utils/chat/pi-runner'
import { storeRetrievalHints } from '../server/utils/chat/retrieval-cache'
import type { ChatRunnerInput, ChatStreamEvent } from '../server/utils/chat/types'
import { searchWikiExcerpts } from '../server/utils/chat/wiki-excerpts'
import { initializeDatabase } from '../server/utils/db'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const DIMENSIONS = 384
const QUESTION = 'Quantas horas por semana?'
const FLAG = 'UJIMU_SEMANTIC_RETRIEVAL_ENABLED'

interface FixturePage {
  path: string
  title: string
  sections: Array<{ heading: string; text: string; axis: number }>
  citedSources?: string[]
  sourceTitle?: string
  sourceFile?: string
  citations?: string
}

// Unit vectors on hand-picked axes; the fake query weighs lower axes higher.
const PAGES: FixturePage[] = [
  {
    path: 'derived/horas.md',
    title: 'Horas semanais',
    sections: [
      { heading: 'Limite semanal', text: 'O período normal é de 44 horas por semana.', axis: 0 },
      { heading: 'Excepções', text: 'Regimes especiais podem alargar o limite.', axis: 4 }
    ],
    citedSources: ['sources/lei.md'],
    citations: '- [Lei Geral do Trabalho](../sources/lei.md), Artigo 95.º'
  },
  {
    path: 'laws/lei.md',
    title: 'Lei Geral do Trabalho',
    sections: [{ heading: 'Texto', text: 'Texto integral da lei.', axis: 1 }]
  },
  {
    path: 'articles/art-148.md',
    title: 'Artigo 148.º',
    sections: [{ heading: 'Conteúdo', text: 'Trabalho suplementar e limites.', axis: 2 }],
    citedSources: ['sources/lei.md']
  },
  {
    path: 'sources/lei.md',
    title: 'Lei Geral do Trabalho',
    sections: [{ heading: 'Resumo', text: 'Resumo da fonte.', axis: 3 }],
    sourceTitle: 'Lei Geral do Trabalho',
    sourceFile: 'raw/lei.md'
  },
  ...[5, 6, 7, 8].map((axis) => ({
    path: `topics/t${axis}.md`,
    title: `Tema ${axis}`,
    sections: [{ heading: `Tema ${axis}`, text: `Texto do tema ${axis}.`, axis }]
  }))
]

describe('wiki excerpt context acceptance', () => {
  let previousFlag: string | undefined

  beforeEach(() => {
    previousFlag = process.env[FLAG]
    resetSpecialistRegistryForTests()
  })

  afterEach(() => {
    if (previousFlag === undefined) delete process.env[FLAG]
    else process.env[FLAG] = previousFlag
  })

  it('S1 keeps the current flow when the flag is off', async () => {
    const { specialist, database } = await createFixture()
    await writeWikiPages(specialist.paths.root, PAGES)
    await writeWikiIndex(specialist.paths.root, PAGES)
    seedHint(database, specialist.id, QUESTION, ['wiki/topics/t5.md'])
    delete process.env[FLAG]
    let searched = false

    const input = await captureRunnerInput(specialist, database, {
      searchWikiExcerpts: async () => {
        searched = true
        return { results: [], sources: [] }
      }
    })

    expect(searched).toBe(false)
    expect(input).not.toHaveProperty('wikiExcerpts')
    expect(input.retrievalHints).toMatchObject({ wikiPaths: ['wiki/topics/t5.md'] })
    expect(buildChatPrompt(input)).toContain('Candidate wiki paths from a recent matching consultation, if any:\nwiki/topics/t5.md')
    database.close()
  })

  it('S2 gives the runner up to six excerpts by score, without sources, laws or hints', async () => {
    const { specialist, database } = await createFixture()
    await writeWikiPages(specialist.paths.root, PAGES)
    await writeWikiIndex(specialist.paths.root, PAGES)
    seedHint(database, specialist.id, QUESTION, ['wiki/topics/t5.md'])
    process.env[FLAG] = 'true'
    const embedded: string[] = []

    const input = await captureRunnerInput(specialist, database, {
      searchWikiExcerpts: (search) => searchWikiExcerpts(search, {
        embed: async (texts) => {
          embedded.push(...texts)
          return texts.map(() => queryVector())
        },
        timeoutMs: 1_000
      })
    })

    expect(embedded).toEqual([`query: ${QUESTION}`])
    expect(input.retrievalHints).toBeUndefined()
    expect(input.wikiExcerpts?.results.map(({ path, heading }) => `${path}#${heading}`)).toEqual([
      'wiki/derived/horas.md#Limite semanal',
      'wiki/articles/art-148.md#Conteúdo',
      'wiki/derived/horas.md#Excepções',
      'wiki/topics/t5.md#Tema 5',
      'wiki/topics/t6.md#Tema 6',
      'wiki/topics/t7.md#Tema 7'
    ])
    const scores = input.wikiExcerpts!.results.map(({ score }) => score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(input.wikiExcerpts!.results[0]).toMatchObject({
      title: 'Horas semanais',
      text: 'O período normal é de 44 horas por semana.',
      citations: '- [Lei Geral do Trabalho](../sources/lei.md), Artigo 95.º'
    })
    expect(input.wikiExcerpts?.sources).toEqual([
      { page: 'wiki/sources/lei.md', sourceTitle: 'Lei Geral do Trabalho', sourceFile: 'raw/lei.md' }
    ])
    database.close()
  })
})

describe('wiki excerpt prompt acceptance', () => {
  it('S3 answers from the excerpts with an explicit fallback and no hint block', () => {
    const prompt = buildChatPrompt({
      specialist: {} as SpecialistRuntime,
      question: QUESTION,
      citationEvidence: [],
      wikiExcerpts: {
        results: [
          {
            path: 'wiki/derived/horas.md',
            title: 'Horas semanais',
            heading: 'Limite semanal',
            text: 'O período normal é de 44 horas por semana.',
            citations: '- [Lei Geral do Trabalho](../sources/lei.md),\n  Artigo 95.º',
            score: 0.87654
          },
          { path: 'wiki/articles/art-148.md', title: 'Artigo 148.º', heading: '', text: 'Trabalho suplementar.', citations: '', score: 0.5 }
        ],
        sources: [{ page: 'wiki/sources/lei.md', sourceTitle: 'Lei Geral do Trabalho', sourceFile: 'raw/lei.md' }]
      }
    })

    expect(prompt).toContain('Wiki excerpts retrieved for this question are included below. If they fully support the answer and its citations, answer from them directly without reading the schema, wiki/index.md or other files.')
    expect(prompt).toContain('Read files only when the excerpts are insufficient, ambiguous or conflicting.')
    expect(prompt).toContain('When the excerpts are insufficient, read the local schema and wiki/index.md and continue with the standard workflow.')
    expect(prompt).toContain('When the answer is a list of cases (for example, every situation that requires notice), treat the excerpts as incomplete unless they plainly cover every case, and continue with the standard workflow from wiki/index.md, reading the pages of the excerpts first.')
    expect(prompt).toContain('Use answered only when the specialist wiki supports the substantive answer; otherwise explain the limitation and use insufficient_context:')
    expect(prompt).toContain([
      'Retrieved wiki excerpts (semantic search over this specialist wiki, best first):',
      '[1] wiki/derived/horas.md | Horas semanais (score 0.877)',
      '## Limite semanal',
      'O período normal é de 44 horas por semana.',
      'Page citations: - [Lei Geral do Trabalho](../sources/lei.md), Artigo 95.º',
      '',
      '[2] wiki/articles/art-148.md | Artigo 148.º (score 0.500)',
      'Trabalho suplementar.',
      '',
      'Sources (use these exact values for sourceTitle and sourceFile):',
      '- wiki/sources/lei.md -> sourceTitle: "Lei Geral do Trabalho", sourceFile: "raw/lei.md"'
    ].join('\n'))
    expect(prompt).not.toContain('Candidate wiki paths')
    expect(prompt).not.toContain('These paths are hints only.')
    expect(prompt).not.toContain('Read the local schema and wiki/index.md before candidate pages.')
  })
})

async function createFixture(id = 'laboral'): Promise<{ specialist: SpecialistRuntime; database: DatabaseSync }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-wiki-excerpts-'))
  const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
  const specialist = await createSpecialist({
    id,
    name: `Especialidade ${id}`,
    description: `Especialista ${id}.`,
    wiki_type: 'legislation-regulatory',
    system_prompt: 'Answer only from this specialist wiki.',
    citations_required: true,
    streaming_enabled: true
  }, { dataDir })
  await mkdir(join(specialist.paths.root, 'raw'), { recursive: true })
  await writeFile(join(specialist.paths.root, 'raw', 'lei.md'), '# Lei Geral do Trabalho\n')
  return { specialist, database }
}

function pageMarkdown(page: FixturePage): string {
  return `# ${page.title}\n\n${page.sections.map(({ heading, text }) => `## ${heading}\n\n${text}\n`).join('\n')}`
}

async function writeWikiPages(root: string, pages: FixturePage[]): Promise<void> {
  await writeFile(join(root, 'wiki', 'index.md'), '# Índice\n')
  await writeFile(join(root, 'wiki', 'log.md'), '# Registo\n')
  for (const page of pages) {
    const file = join(root, 'wiki', page.path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, pageMarkdown(page))
  }
}

async function writeWikiIndex(
  root: string,
  pages: FixturePage[],
  options: { meta?: Record<string, string>; vector?: (axis: number) => Uint8Array; indexedAt?: string } = {}
): Promise<string> {
  const path = join(root, 'db', 'wiki-index.sqlite')
  await mkdir(dirname(path), { recursive: true })
  const index = new DatabaseSync(path)
  index.exec(`
    DROP TABLE IF EXISTS sections; DROP TABLE IF EXISTS pages; DROP TABLE IF EXISTS meta;
    CREATE TABLE meta(key text primary key, value text not null);
    CREATE TABLE pages(
      path text primary key, sha256 text not null, type text, title text,
      description text, citations text, cited_sources text not null default '[]',
      source_title text, source_file text, indexed_at text not null
    );
    CREATE TABLE sections(
      id integer primary key, path text not null references pages(path) on delete cascade,
      ord integer not null, heading text, text text not null, vector blob not null
    );
  `)
  const indexedAt = options.indexedAt ?? '2026-11-10T10:00:00Z'
  const meta = {
    schema_version: '1',
    chunker_version: '1',
    model: 'Xenova/multilingual-e5-small',
    model_sha256: '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c',
    dimensions: '384',
    query_prefix: 'query: ',
    passage_prefix: 'passage: ',
    indexed_at: indexedAt,
    ...options.meta
  }
  for (const [key, value] of Object.entries(meta)) {
    index.prepare('INSERT INTO meta VALUES (?, ?)').run(key, value)
  }
  for (const page of pages) {
    const sha256 = createHash('sha256').update(pageMarkdown(page)).digest('hex')
    index.prepare(`
      INSERT INTO pages VALUES (?, ?, 'page', ?, '', ?, ?, ?, ?, ?)
    `).run(
      page.path,
      sha256,
      page.title,
      page.citations ?? '',
      JSON.stringify(page.citedSources ?? []),
      page.sourceTitle ?? null,
      page.sourceFile ?? null,
      indexedAt
    )
    page.sections.forEach(({ heading, text, axis }, ord) => {
      index.prepare('INSERT INTO sections (path, ord, heading, text, vector) VALUES (?, ?, ?, ?, ?)')
        .run(page.path, ord, heading, text, (options.vector ?? unitVectorBytes)(axis))
    })
  }
  index.close()
  return path
}

function unitVectorBytes(axis: number): Uint8Array {
  const vector = new Float32Array(DIMENSIONS)
  vector[axis] = 1
  return new Uint8Array(vector.buffer)
}

function queryVector(): number[] {
  const weights = Array.from({ length: DIMENSIONS }, (_, axis) => (axis < 10 ? 10 - axis : 0))
  const norm = Math.hypot(...weights)
  return weights.map((weight) => weight / norm)
}

function seedHint(database: DatabaseSync, specialistId: string, question: string, wikiPaths: string[]): void {
  const event = recordQuestionAnalyticsEvent(database, { specialistId, question, outcome: 'answered' })!
  storeRetrievalHints(database, { sourceEventId: event.id, wikiPaths })
}

async function captureRunnerInput(
  specialist: SpecialistRuntime,
  database: DatabaseSync,
  options: Record<string, unknown> = {},
  question = QUESTION
): Promise<ChatRunnerInput> {
  let captured: ChatRunnerInput | undefined
  await collect(await createChatEventStreamForSpecialist(specialist, { specialistId: specialist.id, question }, {
    analytics: { database },
    runner: {
      async run(input) {
        captured = input
        return { grounded: true, citations: [], deltas: toAsyncDeltas(['Resposta.']) }
      }
    },
    ...options
  }))
  await new Promise((resolve) => setImmediate(resolve))
  if (!captured) throw new Error('Runner was not called.')
  return captured
}

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) yield delta
}
