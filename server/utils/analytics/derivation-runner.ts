import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { parse } from 'yaml'
import type { DerivationJob, DerivationJobRunner } from '../jobs/background'
import { createUjimuPiSession } from '../pi/session'
import { loadSpecialistsFromDisk } from '../specialists/loader'
import { buildDerivationPrompt, buildDerivationTargetPath } from './derivation'

export class DerivationExecutionError extends Error {
  constructor(
    public readonly code: 'DERIVATION_EVENT_INVALID' | 'DERIVATION_TARGET_INVALID' | 'DERIVATION_OUTPUT_INVALID',
    message: string
  ) {
    super(message)
    this.name = 'DerivationExecutionError'
  }
}

export function createPiDerivationJobRunner(options: {
  database: DatabaseSync
  dataDir?: string
}): DerivationJobRunner {
  return {
    async run(job) {
      const event = readDerivationEvent(options.database, job)
      const snapshot = await loadSpecialistsFromDisk({ dataDir: options.dataDir })
      const specialist = snapshot.specialists.find((item) => item.id === job.specialistId)
      if (!specialist) {
        throw new DerivationExecutionError('DERIVATION_EVENT_INVALID', 'Derivation specialist was not found.')
      }

      const expectedTarget = buildDerivationTargetPath(event.normalizedQuestion, event.id)
      if (job.targetPath !== expectedTarget || !job.targetPath.startsWith('wiki/derived/')) {
        throw new DerivationExecutionError('DERIVATION_TARGET_INVALID', 'Derivation target does not match the event.')
      }

      const target = resolve(specialist.paths.root, job.targetPath)
      const index = join(specialist.paths.wiki, 'index.md')
      const log = join(specialist.paths.wiki, 'log.md')
      await mkdir(dirname(target), { recursive: true })
      const files = await Promise.all([target, index, log].map(snapshotFile))
      const untouchedBefore = await hashWikiFiles(specialist.paths.wiki, new Set([target, index, log]))

      try {
        const { session } = await createUjimuPiSession({
          cwd: specialist.paths.root,
          task: 'derivation',
          modelEnvPrefix: 'UJIMU_PI_INGESTION',
          derivationTargetPath: job.targetPath
        })
        try {
          await session.prompt(buildDerivationPrompt({
            eventId: event.id,
            targetPath: job.targetPath,
            question: event.question
          }))
        } finally {
          session.dispose()
        }

        await validateDerivationOutput({
          wiki: specialist.paths.wiki,
          target,
          targetPath: job.targetPath,
          index,
          log,
          untouchedBefore
        })
      } catch (error) {
        await restoreFiles(files)
        if (error instanceof DerivationExecutionError) throw error
        throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'Derivation execution did not produce a valid result.')
      }
    }
  }
}

interface DerivationEventRecord {
  id: string
  specialistId: string
  question: string
  normalizedQuestion: string
}

interface FileSnapshot {
  path: string
  content?: Buffer
}

function readDerivationEvent(database: DatabaseSync, job: DerivationJob): DerivationEventRecord {
  const row = database.prepare(`
    SELECT id, specialist_id, outcome, question_text, normalized_question, consulted_document_count
    FROM question_analytics_events
    WHERE id = ?
  `).get(job.eventId) as {
    id: string
    specialist_id: string
    outcome: string
    question_text: string
    normalized_question: string
    consulted_document_count: number
  } | undefined
  if (!row || row.specialist_id !== job.specialistId || row.outcome !== 'answered' || row.consulted_document_count <= 3) {
    throw new DerivationExecutionError('DERIVATION_EVENT_INVALID', 'Derivation event is missing or no longer eligible.')
  }
  return {
    id: row.id,
    specialistId: row.specialist_id,
    question: row.question_text,
    normalizedQuestion: row.normalized_question
  }
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  const content = await readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  return { path, content }
}

async function restoreFiles(files: FileSnapshot[]): Promise<void> {
  await Promise.all(files.map(async (file) => {
    if (file.content === undefined) {
      await rm(file.path, { force: true })
    } else {
      await writeFile(file.path, file.content)
    }
  }))
}

async function validateDerivationOutput(input: {
  wiki: string
  target: string
  targetPath: string
  index: string
  log: string
  untouchedBefore: Map<string, string>
}): Promise<void> {
  const wiki = await realpath(input.wiki)
  const target = await realpath(input.target).catch(() => '')
  if (!target || !isWithin(wiki, target) || !relative(wiki, target).split(sep).join('/').startsWith('derived/')) {
    throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'Derived page is missing or outside wiki/derived.')
  }

  const content = await readFile(target, 'utf8')
  const frontmatter = parseFrontmatter(content)
  if (
    frontmatter.type !== 'Derived Analysis' ||
    !isNonEmptyString(frontmatter.title) ||
    !isNonEmptyString(frontmatter.description) ||
    !Array.isArray(frontmatter.source_pages) || frontmatter.source_pages.length === 0 ||
    !Array.isArray(frontmatter.tags) || !frontmatter.tags.includes('derived') ||
    !isNonEmptyString(frontmatter.timestamp) || Number.isNaN(Date.parse(frontmatter.timestamp))
  ) {
    throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'Derived page frontmatter is invalid.')
  }

  for (const sourcePage of frontmatter.source_pages) {
    if (!isNonEmptyString(sourcePage)) {
      throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'Derived source_pages is invalid.')
    }
    const source = await realpath(join(wiki, sourcePage.replace(/^\/+/, ''))).catch(() => '')
    if (!source || !isWithin(wiki, source) || !(await stat(source)).isFile()) {
      throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'A derived source page does not exist.')
    }
  }

  const reference = relative(wiki, target).split(sep).join('/')
  const [indexContent, logContent] = await Promise.all([
    readFile(input.index, 'utf8'),
    readFile(input.log, 'utf8')
  ])
  if (!containsReference(indexContent, reference) || !containsReference(logContent, reference)) {
    throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'Index or log does not reference the derived page.')
  }

  const untouchedAfter = await hashWikiFiles(input.wiki, new Set([input.target, input.index, input.log]))
  if (!sameHashes(input.untouchedBefore, untouchedAfter)) {
    throw new DerivationExecutionError('DERIVATION_OUTPUT_INVALID', 'Derivation changed a non-allowlisted wiki file.')
  }
}

function parseFrontmatter(content: string): Record<string, any> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)
  if (!match) return {}
  const value = parse(match[1])
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function containsReference(content: string, relativePath: string): boolean {
  return content.includes(`/${relativePath}`) || content.includes(`(${relativePath})`) || content.includes(`wiki/${relativePath}`)
}

async function hashWikiFiles(wiki: string, excluded: Set<string>): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  await walk(wiki, async (path) => {
    if (excluded.has(path)) return
    const content = await readFile(path)
    hashes.set(relative(wiki, path).split(sep).join('/'), createHash('sha256').update(content).digest('hex'))
  })
  return hashes
}

async function walk(directory: string, visit: (path: string) => Promise<void>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path, visit)
    else if (entry.isFile()) await visit(path)
  }
}

function sameHashes(left: Map<string, string>, right: Map<string, string>): boolean {
  if (left.size !== right.size) return false
  for (const [path, hash] of left) {
    if (right.get(path) !== hash) return false
  }
  return true
}

function isWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !fromRoot.startsWith(sep))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
