import { constants } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type EditOperations,
  type FindOperations,
  type GrepOperations,
  type LsOperations,
  type ReadOperations,
  type ToolDefinition,
  type WriteOperations
} from '@earendil-works/pi-coding-agent'

export type UjimuPiFileToolName = 'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls'

export interface UjimuPiPathAccess {
  directories?: string[]
  files?: string[]
}

export interface UjimuPiFileSystemPolicy {
  root: string
  read?: UjimuPiPathAccess
  write?: UjimuPiPathAccess
  list?: Pick<UjimuPiPathAccess, 'directories'>
}

export class UjimuPiPathPolicyError extends Error {
  constructor(message = 'Path is outside the allowed Ujimu Pi filesystem policy.') {
    super(message)
    this.name = 'UjimuPiPathPolicyError'
  }
}

interface ResolvedPolicy {
  rootReal: string
  readDirectories: string[]
  readFiles: ResolvedAllowedFile[]
  writeDirectories: string[]
  writeFiles: ResolvedAllowedFile[]
  listDirectories: string[]
}

interface ResolvedAllowedFile {
  absolutePath: string
  realPath?: string
}

interface WritableTarget {
  path: string
}

export async function createSandboxedFileTools(
  policy: UjimuPiFileSystemPolicy,
  toolNames: UjimuPiFileToolName[]
): Promise<Array<ToolDefinition<any, any, any>>> {
  const resolvedPolicy = await resolvePolicy(policy)
  const readOperations = createReadOperations(resolvedPolicy)
  const writeOperations = createWriteOperations(resolvedPolicy)
  const editOperations = createEditOperations(resolvedPolicy)
  const grepOperations = createGrepOperations(resolvedPolicy)
  const findOperations = createFindOperations(resolvedPolicy)
  const lsOperations = createLsOperations(resolvedPolicy)
  const definitions: Partial<Record<UjimuPiFileToolName, ToolDefinition<any, any, any>>> = {
    read: withInputPathValidation(createReadToolDefinition(resolvedPolicy.rootReal, { operations: readOperations }), ['path']),
    write: withInputPathValidation(createWriteToolDefinition(resolvedPolicy.rootReal, { operations: writeOperations }), ['path']),
    edit: withInputPathValidation(createEditToolDefinition(resolvedPolicy.rootReal, { operations: editOperations }), ['path']),
    grep: withInputPathValidation(createGrepToolDefinition(resolvedPolicy.rootReal, { operations: grepOperations }), ['path']),
    find: withInputPathValidation(createFindToolDefinition(resolvedPolicy.rootReal, { operations: findOperations }), ['path']),
    ls: withInputPathValidation(createLsToolDefinition(resolvedPolicy.rootReal, { operations: lsOperations }), ['path'])
  }

  return toolNames.map((name) => definitions[name]).filter((tool): tool is ToolDefinition<any, any, any> => Boolean(tool))
}

function createReadOperations(policy: ResolvedPolicy): ReadOperations {
  return {
    async access(absolutePath) {
      const safePath = await assertReadablePath(policy, absolutePath)
      await access(safePath, constants.R_OK)
    },
    async readFile(absolutePath) {
      const safePath = await assertReadablePath(policy, absolutePath)
      return readFile(safePath)
    }
  }
}

function createWriteOperations(policy: ResolvedPolicy): WriteOperations {
  return {
    async mkdir(absolutePath) {
      const safeTarget = await assertWritablePath(policy, absolutePath, { directory: true })
      await mkdir(safeTarget.path, { recursive: true })
    },
    async writeFile(absolutePath, content) {
      const safeTarget = await assertWritablePath(policy, absolutePath, { directory: false })
      await writeFile(safeTarget.path, content, 'utf8')
    }
  }
}

function createEditOperations(policy: ResolvedPolicy): EditOperations {
  return {
    async access(absolutePath) {
      const readPath = await assertReadablePath(policy, absolutePath)
      await assertWritablePath(policy, absolutePath, { directory: false })
      await access(readPath, constants.R_OK | constants.W_OK)
    },
    async readFile(absolutePath) {
      const safePath = await assertReadablePath(policy, absolutePath)
      return readFile(safePath)
    },
    async writeFile(absolutePath, content) {
      const safeTarget = await assertWritablePath(policy, absolutePath, { directory: false })
      await writeFile(safeTarget.path, content, 'utf8')
    }
  }
}

function createGrepOperations(policy: ResolvedPolicy): GrepOperations {
  return {
    async isDirectory(absolutePath) {
      const safePath = await assertReadablePath(policy, absolutePath)
      return (await stat(safePath)).isDirectory()
    },
    async readFile(absolutePath) {
      const safePath = await assertReadablePath(policy, absolutePath)
      return readFile(safePath, 'utf8')
    }
  }
}

function createFindOperations(policy: ResolvedPolicy): FindOperations {
  return {
    async exists(absolutePath) {
      await assertListablePath(policy, absolutePath)
      return true
    },
    async glob(pattern, cwd, options) {
      const safeCwd = await assertListableDirectory(policy, cwd)
      const matcher = globMatcher(pattern)
      const results: string[] = []
      await walkFiles(safeCwd, async (absolutePath) => {
        if (results.length >= options.limit) return
        const relativePath = toPosixPath(relative(safeCwd, absolutePath))
        if (shouldIgnore(relativePath, options.ignore)) return
        if (matcher(relativePath) || matcher(relativePath.split('/').at(-1) ?? relativePath)) {
          results.push(absolutePath)
        }
      })
      return results
    }
  }
}

function createLsOperations(policy: ResolvedPolicy): LsOperations {
  return {
    async exists(absolutePath) {
      await assertListablePath(policy, absolutePath)
      return true
    },
    async stat(absolutePath) {
      const safePath = await assertListablePath(policy, absolutePath)
      return stat(safePath)
    },
    async readdir(absolutePath) {
      const safePath = await assertListableDirectory(policy, absolutePath)
      return readdir(safePath)
    }
  }
}

async function resolvePolicy(policy: UjimuPiFileSystemPolicy): Promise<ResolvedPolicy> {
  const rootReal = await realpath(policy.root)
  return {
    rootReal,
    readDirectories: await resolveAllowedDirectories(rootReal, policy.read?.directories ?? []),
    readFiles: await resolveAllowedFiles(rootReal, policy.read?.files ?? []),
    writeDirectories: await resolveAllowedDirectories(rootReal, policy.write?.directories ?? []),
    writeFiles: await resolveAllowedFiles(rootReal, policy.write?.files ?? []),
    listDirectories: await resolveAllowedDirectories(rootReal, policy.list?.directories ?? [])
  }
}

async function resolveAllowedDirectories(rootReal: string, entries: string[]): Promise<string[]> {
  const directories: string[] = []
  for (const entry of entries) {
    assertSafeRelativePolicyEntry(entry)
    const absolutePath = resolve(rootReal, entry)
    assertLexicallyInside(rootReal, absolutePath)
    const directoryReal = await realpath(absolutePath)
    assertRealInside(rootReal, directoryReal)
    if (!(await stat(directoryReal)).isDirectory()) {
      throw new UjimuPiPathPolicyError(`Allowed directory is not a directory: ${entry}`)
    }
    directories.push(directoryReal)
  }
  return directories
}

async function resolveAllowedFiles(rootReal: string, entries: string[]): Promise<ResolvedAllowedFile[]> {
  const files: ResolvedAllowedFile[] = []
  for (const entry of entries) {
    assertSafeRelativePolicyEntry(entry)
    const absolutePath = resolve(rootReal, entry)
    assertLexicallyInside(rootReal, absolutePath)
    const real = await realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (real) {
      assertRealInside(rootReal, real)
    }
    files.push({ absolutePath, ...(real ? { realPath: real } : {}) })
  }
  return files
}

async function assertReadablePath(policy: ResolvedPolicy, absolutePath: string): Promise<string> {
  assertLexicallyInside(policy.rootReal, absolutePath)
  const targetReal = await realpath(absolutePath)
  assertRealInside(policy.rootReal, targetReal)

  if (
    policy.readDirectories.some((directory) => isInside(directory, targetReal)) ||
    policy.readFiles.some((file) => file.realPath === targetReal)
  ) {
    return targetReal
  }

  throw new UjimuPiPathPolicyError()
}

async function assertWritablePath(
  policy: ResolvedPolicy,
  absolutePath: string,
  options: { directory: boolean }
): Promise<WritableTarget> {
  assertLexicallyInside(policy.rootReal, absolutePath)
  const existing = await lstat(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing?.isSymbolicLink()) {
    throw new UjimuPiPathPolicyError('Refusing to write through a symbolic link.')
  }

  const nearestExistingParent = await nearestExistingAncestor(dirname(absolutePath))
  assertRealInside(policy.rootReal, nearestExistingParent)

  const existingReal = existing ? await realpath(absolutePath) : undefined
  if (existingReal) {
    assertRealInside(policy.rootReal, existingReal)
  }

  if (matchesWritablePolicy(policy, absolutePath, existingReal, options.directory)) {
    return { path: absolutePath }
  }

  throw new UjimuPiPathPolicyError()
}

function matchesWritablePolicy(
  policy: ResolvedPolicy,
  absolutePath: string,
  existingReal: string | undefined,
  isDirectoryTarget: boolean
): boolean {
  if (existingReal && policy.writeDirectories.some((directory) => isInside(directory, existingReal))) {
    return true
  }

  if (!existingReal && policy.writeDirectories.some((directory) => isInside(directory, absolutePath))) {
    return true
  }

  if (!isDirectoryTarget) {
    return policy.writeFiles.some((file) => file.absolutePath === absolutePath || file.realPath === existingReal)
  }

  return policy.writeFiles.some((file) => {
    const fileParent = dirname(file.absolutePath)
    return absolutePath === fileParent || isInside(absolutePath, fileParent)
  })
}

async function assertListablePath(policy: ResolvedPolicy, absolutePath: string): Promise<string> {
  assertLexicallyInside(policy.rootReal, absolutePath)
  const targetReal = await realpath(absolutePath)
  assertRealInside(policy.rootReal, targetReal)
  if (policy.listDirectories.some((directory) => isInside(directory, targetReal))) {
    return targetReal
  }
  throw new UjimuPiPathPolicyError()
}

async function assertListableDirectory(policy: ResolvedPolicy, absolutePath: string): Promise<string> {
  const safePath = await assertListablePath(policy, absolutePath)
  if (!(await stat(safePath)).isDirectory()) {
    throw new UjimuPiPathPolicyError('Path is not an allowed directory.')
  }
  return safePath
}

async function nearestExistingAncestor(path: string): Promise<string> {
  let candidate = path
  for (;;) {
    const found = await realpath(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (found) return found
    const parent = dirname(candidate)
    if (parent === candidate) {
      throw new UjimuPiPathPolicyError('No existing parent directory found for write target.')
    }
    candidate = parent
  }
}

function withInputPathValidation<T extends ToolDefinition<any, any, any>>(tool: T, fields: string[]): T {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      for (const field of fields) {
        const value = (params as Record<string, unknown>)[field]
        if (value !== undefined) {
          assertSafeToolPathInput(value)
        }
      }
      return tool.execute(toolCallId, params, signal, onUpdate, ctx)
    }
  }
}

function assertSafeToolPathInput(value: unknown): void {
  if (typeof value !== 'string') {
    throw new UjimuPiPathPolicyError('Tool path must be a string.')
  }
  if (value.includes('\0') || value.startsWith('~') || value.startsWith('@') || isAbsolute(value)) {
    throw new UjimuPiPathPolicyError('Absolute, home-relative, resource-prefixed, or null-byte paths are not allowed.')
  }
}

function assertSafeRelativePolicyEntry(entry: string): void {
  if (!entry || entry.includes('\0') || entry.startsWith('~') || entry.startsWith('@') || isAbsolute(entry)) {
    throw new UjimuPiPathPolicyError(`Invalid Ujimu Pi filesystem policy entry: ${entry}`)
  }
}

function assertLexicallyInside(rootReal: string, absolutePath: string): void {
  if (!isInside(rootReal, resolve(absolutePath))) {
    throw new UjimuPiPathPolicyError()
  }
}

function assertRealInside(rootReal: string, absolutePath: string): void {
  if (!isInside(rootReal, absolutePath)) {
    throw new UjimuPiPathPolicyError()
  }
}

function isInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  const result = relative(normalizedParent, normalizedChild)
  return result === '' || (!!result && !result.startsWith('..') && !isAbsolute(result))
}

async function walkFiles(root: string, onFile: (absolutePath: string) => Promise<void>): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
    const absolutePath = join(root, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, onFile)
      continue
    }
    if (entry.isFile()) {
      await onFile(absolutePath)
    }
  }
}

function globMatcher(pattern: string): (value: string) => boolean {
  const normalized = toPosixPath(pattern)
  let expression = ''

  for (let index = 0; index < normalized.length;) {
    if (normalized.slice(index, index + 3) === '**/') {
      expression += '(?:.*/)?'
      index += 3
      continue
    }

    if (normalized.slice(index, index + 2) === '**') {
      expression += '.*'
      index += 2
      continue
    }

    const char = normalized[index]
    if (char === '*') {
      expression += '[^/]*'
    } else if (char === '?') {
      expression += '[^/]'
    } else {
      expression += escapeRegExp(char)
    }
    index++
  }

  const regex = new RegExp(`^${expression}$`)
  return (value) => regex.test(toPosixPath(value))
}

function shouldIgnore(relativePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => globMatcher(pattern)(relativePath))
}

function toPosixPath(value: string): string {
  return value.split(sep).join('/')
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}
