import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import type {
  AnswerAlignmentJudgement,
  AnswerVerificationBaseline,
  DerivedPageRevision,
  DerivedRepairOutcome
} from './answer-verification'
import { createUjimuPiSession } from '../pi/session'

export class DerivedRepairExecutionError extends Error {
  constructor(
    public readonly code:
      | 'DERIVED_REPAIR_OUTPUT_INVALID'
      | 'DERIVED_REPAIR_NOT_ACCEPTED'
      | 'DERIVED_REPAIR_PATH_INVALID',
    message: string
  ) {
    super(message)
    this.name = 'DerivedRepairExecutionError'
  }
}

export interface DerivedRepairAdapters {
  repair(input: {
    stagingRoot: string
    question: string
    originalAnswer: string
    baseline: AnswerVerificationBaseline
    targetPaths: string[]
  }): Promise<{ status: 'repaired' } | { status: 'needs_admin_source'; reason: string }>
  answer(input: {
    cwd: string
    question: string
    targetPaths: string[]
  }): Promise<AnswerVerificationBaseline>
  judge(input: {
    cwd: string
    question: string
    candidate: AnswerVerificationBaseline
    baseline: AnswerVerificationBaseline
    targetPaths: string[]
  }): Promise<AnswerAlignmentJudgement>
}

export async function runStagedDerivedRepair(input: {
  specialistRoot: string
  verificationId: string
  question: string
  originalAnswer: string
  baseline: AnswerVerificationBaseline
  negativeDerivedPaths: string[]
  adapters: DerivedRepairAdapters
}): Promise<DerivedRepairOutcome> {
  if (!/^[a-zA-Z0-9-]+$/u.test(input.verificationId)) {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_PATH_INVALID', 'Verification id is invalid for staging.')
  }
  const root = await realpath(input.specialistRoot)
  const targets = [...new Set(input.negativeDerivedPaths)].sort()
  await assertRepairTargets(root, targets)
  const stagingRoot = join(root, '.ujimu', 'verification', input.verificationId)
  await rm(stagingRoot, { recursive: true, force: true })

  try {
    await createStagingWorkspace(root, stagingRoot)
    const before = await snapshotMarkdownTree(join(root, 'wiki'))
    const repair = await input.adapters.repair({
      stagingRoot,
      question: input.question,
      originalAnswer: input.originalAnswer,
      baseline: input.baseline,
      targetPaths: targets
    })

    if (repair.status === 'needs_admin_source') {
      const after = await snapshotMarkdownTree(join(stagingRoot, 'wiki'))
      if (!isBoundedText(repair.reason) || snapshotsDiffer(before, after)) {
        throw new DerivedRepairExecutionError(
          'DERIVED_REPAIR_OUTPUT_INVALID',
          'Missing-source repair outcome changed staged wiki files.'
        )
      }
      return { status: 'needs_admin_source', reason: repair.reason.trim() }
    }

    const changes = await validateStagedChanges({ root, stagingRoot, targets, before })
    const candidate = await input.adapters.answer({
      cwd: stagingRoot,
      question: input.question,
      targetPaths: targets
    })
    const judgement = await input.adapters.judge({
      cwd: stagingRoot,
      question: input.question,
      candidate,
      baseline: input.baseline,
      targetPaths: targets
    })
    if (judgement.level !== 'FIEL' && judgement.level !== 'MUITO_ALINHADO') {
      throw new DerivedRepairExecutionError(
        'DERIVED_REPAIR_NOT_ACCEPTED',
        'Repaired derived candidate did not meet the alignment threshold.'
      )
    }

    await promoteChanges(root, stagingRoot, changes, targets)
    return {
      status: 'accepted',
      revisions: await readPromotedRevisions(root, targets)
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

export async function runPiDerivedRepairAgent(input: {
  stagingRoot: string
  question: string
  originalAnswer: string
  baseline: AnswerVerificationBaseline
  targetPaths: string[]
}): Promise<{ status: 'repaired' } | { status: 'needs_admin_source'; reason: string }> {
  const { session } = await createUjimuPiSession({
    cwd: input.stagingRoot,
    task: 'derived_repair',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    repairTargetPaths: input.targetPaths
  })
  let streamedText = ''
  let finalText = ''
  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      if (typeof event.assistantMessageEvent.delta === 'string') streamedText += event.assistantMessageEvent.delta
      return
    }
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_end') {
      if (typeof event.assistantMessageEvent.content === 'string') finalText = event.assistantMessageEvent.content
      return
    }
    if (event?.type === 'message_end' && event.message?.role === 'assistant') {
      finalText = extractAssistantText(event.message) || finalText
      return
    }
    if (event?.type === 'agent_end') finalText = extractLatestAssistantText(event.messages) || finalText
  })
  try {
    await session.prompt(buildDerivedRepairPrompt(input))
    return parseRepairAgentResult(finalText || streamedText)
  } finally {
    unsubscribe?.()
    session.dispose()
  }
}

export function buildDerivedRepairPrompt(input: {
  question: string
  originalAnswer: string
  baseline: AnswerVerificationBaseline
  targetPaths: string[]
}): string {
  return `Repair the negatively contributing derived pages in this isolated specialist workspace.
Use the llm-wiki skill and current AGENTS.md. Read wiki and converted evidence as needed. There is no raw directory and raw material is forbidden.
Recreate every target below. You may update only those targets, wiki/index.md, wiki/log.md, and create new non-derived wiki Markdown pages when converted evidence must first be integrated. Do not edit any other existing page.
Every repaired target must remain valid Derived Analysis with source_pages and the literal derived tag. Every newly created page must be linked by a repaired target.
The title must not repeat the user's question verbatim or use an interrogative form. Write a concise, declarative title that identifies the synthesis's substantive subject and principal conclusion, so the page is understandable without the original question.

If the available converted evidence is insufficient, change no file and return exactly:
{"status":"needs_admin_source","reason":"..."}
Otherwise finish all writes and return exactly:
{"status":"repaired"}
Return one JSON object without a markdown fence.

Question:
${input.question}

Delivered answer that used the harmful derivation:
${input.originalAnswer}

Source-only control answer:
${input.baseline.answer}

Targets:
${input.targetPaths.join('\n')}
`
}

function parseRepairAgentResult(text: string): { status: 'repaired' } | { status: 'needs_admin_source'; reason: string } {
  let parsed: any
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repair agent output is not valid JSON.')
  }
  if (parsed?.status === 'repaired') return { status: 'repaired' }
  if (parsed?.status === 'needs_admin_source' && isBoundedText(parsed.reason)) {
    return { status: 'needs_admin_source', reason: parsed.reason.trim() }
  }
  throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repair agent output fields are invalid.')
}

async function createStagingWorkspace(root: string, stagingRoot: string): Promise<void> {
  await mkdir(stagingRoot, { recursive: true })
  await Promise.all([
    cp(join(root, 'AGENTS.md'), join(stagingRoot, 'AGENTS.md')),
    cp(join(root, 'wiki'), join(stagingRoot, 'wiki'), { recursive: true }),
    cp(join(root, 'converted'), join(stagingRoot, 'converted'), { recursive: true })
  ])
}

async function assertRepairTargets(root: string, targets: string[]): Promise<void> {
  if (targets.length === 0) {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_PATH_INVALID', 'At least one derived repair target is required.')
  }
  const derived = await realpath(join(root, 'wiki', 'derived'))
  for (const target of targets) {
    if (!target.startsWith('wiki/derived/') || !target.endsWith('.md') || target.split('/').some((part) => part === '..')) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_PATH_INVALID', 'Derived repair target path is invalid.')
    }
    const realTarget = await realpath(resolve(root, target)).catch(() => '')
    if (!realTarget || !isWithin(derived, realTarget) || !(await stat(realTarget)).isFile()) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_PATH_INVALID', 'Derived repair target is unavailable.')
    }
  }
}

interface MarkdownSnapshot {
  content: Buffer
  sha256: string
}

interface StagedChange {
  path: string
  existed: boolean
}

async function validateStagedChanges(input: {
  root: string
  stagingRoot: string
  targets: string[]
  before: Map<string, MarkdownSnapshot>
}): Promise<StagedChange[]> {
  const after = await snapshotMarkdownTree(join(input.stagingRoot, 'wiki'))
  for (const path of input.before.keys()) {
    if (!after.has(path)) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repair deleted an existing wiki page.')
    }
  }
  const allowedExisting = new Set([...input.targets, 'wiki/index.md', 'wiki/log.md'])
  const changes: StagedChange[] = []
  for (const [path, snapshot] of after) {
    const existing = input.before.get(path)
    if (existing?.sha256 === snapshot.sha256) continue
    if (existing && !allowedExisting.has(path)) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repair changed a non-allowlisted existing wiki page.')
    }
    if (!existing && (!path.startsWith('wiki/') || !path.endsWith('.md') || path.startsWith('wiki/derived/'))) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repair created an invalid wiki page.')
    }
    changes.push({ path, existed: Boolean(existing) })
  }
  if (input.targets.some((target) => !changes.some((change) => change.path === target))) {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repair did not recreate every derived target.')
  }

  const stagedWiki = join(input.stagingRoot, 'wiki')
  const targetContents = await Promise.all(input.targets.map((path) => readFile(resolve(input.stagingRoot, path), 'utf8')))
  for (let index = 0; index < input.targets.length; index += 1) {
    await validateDerivedTarget(stagedWiki, input.targets[index], targetContents[index])
  }
  for (const change of changes.filter((item) => !item.existed)) {
    const content = await readFile(resolve(input.stagingRoot, change.path), 'utf8')
    const frontmatter = parseFrontmatter(content)
    const wikiReference = `/${change.path.slice('wiki/'.length)}`
    if (!isNonEmptyString(frontmatter.type) || !targetContents.some((target) => target.includes(wikiReference))) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'New wiki page is invalid or unreferenced.')
    }
  }
  const [index, log] = await Promise.all([
    readFile(join(stagedWiki, 'index.md'), 'utf8'),
    readFile(join(stagedWiki, 'log.md'), 'utf8')
  ])
  if (input.targets.some((target) => !containsReference(index, target) || !containsReference(log, target))) {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Index or log does not reference every repaired target.')
  }
  return changes
}

async function validateDerivedTarget(wiki: string, targetPath: string, content: string): Promise<void> {
  const frontmatter = parseFrontmatter(content)
  if (
    frontmatter.type !== 'Derived Analysis' ||
    !isNonEmptyString(frontmatter.title) ||
    !isNonEmptyString(frontmatter.description) ||
    !Array.isArray(frontmatter.source_pages) || frontmatter.source_pages.length === 0 ||
    !Array.isArray(frontmatter.tags) || !frontmatter.tags.includes('derived') ||
    !isNonEmptyString(frontmatter.timestamp) || Number.isNaN(Date.parse(frontmatter.timestamp))
  ) {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repaired derived page frontmatter is invalid.')
  }
  for (const page of frontmatter.source_pages) {
    if (!isNonEmptyString(page)) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repaired source_pages is invalid.')
    }
    const source = await realpath(join(wiki, page.replace(/^\/+/, ''))).catch(() => '')
    if (!source || !isWithin(wiki, source) || !(await stat(source)).isFile()) {
      throw new DerivedRepairExecutionError('DERIVED_REPAIR_OUTPUT_INVALID', 'Repaired source page does not exist.')
    }
  }
  if (!targetPath.startsWith('wiki/derived/')) {
    throw new DerivedRepairExecutionError('DERIVED_REPAIR_PATH_INVALID', 'Repaired target escaped wiki/derived.')
  }
}

async function promoteChanges(
  root: string,
  stagingRoot: string,
  changes: StagedChange[],
  targets: string[]
): Promise<void> {
  const targetSet = new Set(targets)
  const ordered = [...changes].sort((left, right) => promotionRank(left.path, targetSet) - promotionRank(right.path, targetSet))
  const snapshots = new Map<string, Buffer | undefined>()
  try {
    for (const change of ordered) {
      const destination = resolve(root, change.path)
      snapshots.set(change.path, await readFile(destination).catch(() => undefined))
      await mkdir(dirname(destination), { recursive: true })
      const temporary = join(dirname(destination), `.${basename(destination)}.ujimu-repair`)
      await writeFile(temporary, await readFile(resolve(stagingRoot, change.path)))
      await rename(temporary, destination)
    }
  } catch (error) {
    for (const [path, content] of [...snapshots].reverse()) {
      const destination = resolve(root, path)
      if (content === undefined) await rm(destination, { force: true })
      else await writeFile(destination, content)
    }
    throw error
  }
}

function snapshotsDiffer(
  left: Map<string, MarkdownSnapshot>,
  right: Map<string, MarkdownSnapshot>
): boolean {
  if (left.size !== right.size) return true
  for (const [path, snapshot] of left) {
    if (right.get(path)?.sha256 !== snapshot.sha256) return true
  }
  return false
}

function promotionRank(path: string, targets: Set<string>): number {
  if (!targets.has(path) && path !== 'wiki/index.md' && path !== 'wiki/log.md') return 0
  if (targets.has(path)) return 1
  if (path === 'wiki/log.md') return 2
  return 3
}

async function readPromotedRevisions(root: string, targets: string[]): Promise<DerivedPageRevision[]> {
  return Promise.all(targets.map(async (path) => ({
    path,
    revisionSha256: `sha256:${createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')}`
  })))
}

async function snapshotMarkdownTree(wikiRoot: string): Promise<Map<string, MarkdownSnapshot>> {
  const root = dirname(wikiRoot)
  const snapshots = new Map<string, MarkdownSnapshot>()
  await walk(wikiRoot, async (path) => {
    if (!path.endsWith('.md')) return
    const content = await readFile(path)
    snapshots.set(relative(root, path).split(sep).join('/'), {
      content,
      sha256: createHash('sha256').update(content).digest('hex')
    })
  })
  return snapshots
}

async function walk(directory: string, visit: (path: string) => Promise<void>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const entryStats = await lstat(path)
    if (entryStats.isSymbolicLink()) continue
    if (entry.isDirectory()) await walk(path, visit)
    else if (entry.isFile()) await visit(path)
  }
}

function parseFrontmatter(content: string): Record<string, any> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)
  if (!match) return {}
  const value = parse(match[1])
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function containsReference(content: string, path: string): boolean {
  const relativePath = path.slice('wiki/'.length)
  return content.includes(`/${relativePath}`) || content.includes(`(${relativePath})`) || content.includes(path)
}

function extractAssistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (!part || typeof part !== 'object') return ''
    return typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''
  }).filter(Boolean).join('\n')
}

function extractLatestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if ((messages[index] as { role?: unknown })?.role === 'assistant') {
      const text = extractAssistantText(messages[index])
      if (text) return text
    }
  }
  return ''
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}
