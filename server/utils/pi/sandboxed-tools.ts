import { constants } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
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

export interface UjimuPiListAccess {
  directories?: string[]
  virtualRootEntries?: string[]
}

export interface UjimuPiFileSystemPolicy {
  root: string
  virtualRoot?: string
  read?: UjimuPiPathAccess
  write?: UjimuPiPathAccess
  list?: UjimuPiListAccess
}

export class UjimuPiPathPolicyError extends Error {
  constructor(message = 'Permission denied.') {
    super(message)
    this.name = 'UjimuPiPathPolicyError'
  }
}

export class UjimuPiPathNotFoundError extends Error {
  constructor(path = '/data') {
    super(`Path not found: ${path}`)
    this.name = 'UjimuPiPathNotFoundError'
  }
}

interface ResolvedPolicy {
  rootReal: string
  virtualRoot: string
  readDirectories: string[]
  readFiles: ResolvedAllowedFile[]
  writeDirectories: string[]
  writeFiles: ResolvedAllowedFile[]
  listDirectories: string[]
  virtualRootEntries: string[]
}

interface ResolvedAllowedFile {
  absolutePath: string
  realPath?: string
}

interface WritableTarget {
  path: string
}

interface VirtualPathMapping {
  relativePath: string
  virtualPath: string
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
    read: withVirtualPathMapping(createReadToolDefinition(resolvedPolicy.rootReal, { operations: readOperations }), ['path'], resolvedPolicy),
    write: withVirtualPathMapping(createWriteToolDefinition(resolvedPolicy.rootReal, { operations: writeOperations }), ['path'], resolvedPolicy),
    edit: withVirtualPathMapping(createEditToolDefinition(resolvedPolicy.rootReal, { operations: editOperations }), ['path'], resolvedPolicy),
    grep: withVirtualPathMapping(createGrepToolDefinition(resolvedPolicy.rootReal, { operations: grepOperations }), ['path'], resolvedPolicy),
    find: withVirtualPathMapping(createFindToolDefinition(resolvedPolicy.rootReal, { operations: findOperations }), ['path'], resolvedPolicy),
    ls: withVirtualPathMapping(createLsToolDefinition(resolvedPolicy.rootReal, { operations: lsOperations }), ['path'], resolvedPolicy)
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
      if (isVirtualRootListingPath(policy, absolutePath)) return true
      await assertListablePath(policy, absolutePath)
      return true
    },
    async stat(absolutePath) {
      if (isVirtualRootListingPath(policy, absolutePath)) return stat(policy.rootReal)
      if (isVirtualRootEntryPath(policy, absolutePath)) {
        return stat(await assertVirtualRootEntryPath(policy, absolutePath))
      }
      const safePath = await assertListablePath(policy, absolutePath)
      return stat(safePath)
    },
    async readdir(absolutePath) {
      if (isVirtualRootListingPath(policy, absolutePath)) return [...policy.virtualRootEntries]
      const safePath = await assertListableDirectory(policy, absolutePath)
      return readdir(safePath)
    }
  }
}

async function resolvePolicy(policy: UjimuPiFileSystemPolicy): Promise<ResolvedPolicy> {
  const rootReal = await realpath(policy.root)
  return {
    rootReal,
    virtualRoot: normalizeVirtualRoot(policy.virtualRoot ?? '/data'),
    readDirectories: await resolveAllowedDirectories(rootReal, policy.read?.directories ?? []),
    readFiles: await resolveAllowedFiles(rootReal, policy.read?.files ?? []),
    writeDirectories: await resolveAllowedDirectories(rootReal, policy.write?.directories ?? []),
    writeFiles: await resolveAllowedFiles(rootReal, policy.write?.files ?? []),
    listDirectories: await resolveAllowedDirectories(rootReal, policy.list?.directories ?? []),
    virtualRootEntries: normalizeVirtualRootEntries(policy.list?.virtualRootEntries ?? [])
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

function normalizeVirtualRootEntries(entries: string[]): string[] {
  const normalizedEntries: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    assertSafeRelativePolicyEntry(entry)
    const normalized = posix.normalize(entry.split('\\').join('/')).replace(/\/$/u, '')
    if (normalized === '.' || normalized.includes('/') || normalized.startsWith('..')) {
      throw new UjimuPiPathPolicyError(`Invalid Ujimu Pi virtual root entry: ${entry}`)
    }
    if (!seen.has(normalized)) {
      normalizedEntries.push(normalized)
      seen.add(normalized)
    }
  }

  return normalizedEntries
}

async function assertReadablePath(policy: ResolvedPolicy, absolutePath: string): Promise<string> {
  assertLexicallyInside(policy.rootReal, absolutePath)
  const targetReal = await realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new UjimuPiPathNotFoundError(toVirtualPath(policy, absolutePath))
    throw error
  })
  assertRealInsideData(policy, targetReal, absolutePath)

  if (
    policy.readDirectories.some((directory) => isInside(directory, targetReal)) ||
    policy.readFiles.some((file) => file.realPath === targetReal)
  ) {
    return targetReal
  }

  throw new UjimuPiPathPolicyError(`Permission denied: ${toVirtualPath(policy, absolutePath)}`)
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
    throw new UjimuPiPathNotFoundError(toVirtualPath(policy, absolutePath))
  }

  if (!existing) {
    const nearestExistingParent = await nearestExistingAncestor(dirname(absolutePath))
    assertRealInsideData(policy, nearestExistingParent, absolutePath)
  }

  const existingReal = existing ? await realpath(absolutePath) : undefined
  if (existingReal) {
    assertRealInsideData(policy, existingReal, absolutePath)
  }

  if (matchesWritablePolicy(policy, absolutePath, existingReal, options.directory)) {
    return { path: absolutePath }
  }

  throw new UjimuPiPathPolicyError(`Permission denied: ${toVirtualPath(policy, absolutePath)}`)
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
  const targetReal = await realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new UjimuPiPathNotFoundError(toVirtualPath(policy, absolutePath))
    throw error
  })
  assertRealInsideData(policy, targetReal, absolutePath)
  if (policy.listDirectories.some((directory) => isInside(directory, targetReal))) {
    return targetReal
  }
  throw new UjimuPiPathPolicyError(`Permission denied: ${toVirtualPath(policy, absolutePath)}`)
}

async function assertListableDirectory(policy: ResolvedPolicy, absolutePath: string): Promise<string> {
  const safePath = await assertListablePath(policy, absolutePath)
  if (!(await stat(safePath)).isDirectory()) {
    throw new UjimuPiPathPolicyError(`Permission denied: ${toVirtualPath(policy, absolutePath)}`)
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

function withVirtualPathMapping<T extends ToolDefinition<any, any, any>>(
  tool: T,
  fields: string[],
  policy: ResolvedPolicy
): T {
  return {
    ...tool,
    description: `${tool.description}\n\nUjimu virtual filesystem: use paths under ${policy.virtualRoot}. Paths outside ${policy.virtualRoot} are not available.`,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const mappedParams = { ...(params as Record<string, unknown>) }
      const originalVirtualPaths: string[] = []

      for (const field of fields) {
        const value = mappedParams[field]
        if (value !== undefined) {
          const mapping = mapToolPathInput(value, policy.virtualRoot)
          await preflightMappedToolPath(tool.name, policy, mapping)
          mappedParams[field] = mapping.relativePath
          originalVirtualPaths.push(mapping.virtualPath)
        }
      }

      try {
        return await tool.execute(toolCallId, mappedParams as any, signal, onUpdate, ctx)
      } catch (error) {
        throw sanitizeToolError(error, policy, originalVirtualPaths[0])
      }
    }
  }
}

async function preflightMappedToolPath(
  toolName: string,
  policy: ResolvedPolicy,
  mapping: VirtualPathMapping
): Promise<void> {
  const absolutePath = resolve(policy.rootReal, mapping.relativePath)
  if (toolName === 'grep') {
    await assertReadablePath(policy, absolutePath)
  }
  if (toolName === 'ls' && isVirtualRootListingMapping(policy, mapping)) {
    return
  }
  if (toolName === 'find' || toolName === 'ls') {
    await assertListablePath(policy, absolutePath)
  }
}

function mapToolPathInput(value: unknown, virtualRoot: string): VirtualPathMapping {
  if (typeof value !== 'string' || value.includes('\0') || value.startsWith('~') || value.startsWith('@')) {
    throw new UjimuPiPathNotFoundError(typeof value === 'string' ? value : virtualRoot)
  }

  const normalizedRoot = normalizeVirtualRoot(virtualRoot)
  const normalizedInput = value.split('\\').join('/')
  const virtualPath = posix.isAbsolute(normalizedInput)
    ? posix.normalize(normalizedInput)
    : posix.normalize(posix.join(normalizedRoot, normalizedInput || '.'))

  if (!isVirtualInside(normalizedRoot, virtualPath)) {
    throw new UjimuPiPathNotFoundError(value)
  }

  const relativePath = posix.relative(normalizedRoot, virtualPath)
  return {
    relativePath: relativePath || '.',
    virtualPath
  }
}

function sanitizeToolError(error: unknown, policy: ResolvedPolicy, fallbackVirtualPath: string | undefined): Error {
  if (error instanceof UjimuPiPathPolicyError || error instanceof UjimuPiPathNotFoundError) {
    return error
  }

  const maybeErrno = error as NodeJS.ErrnoException
  if (maybeErrno?.code === 'ENOENT') {
    return new UjimuPiPathNotFoundError(fallbackVirtualPath ?? policy.virtualRoot)
  }

  if (error instanceof Error) {
    const sanitized = new Error(sanitizeHostPaths(error.message, policy))
    sanitized.name = error.name
    return sanitized
  }

  return new Error('Tool failed.')
}

function sanitizeHostPaths(message: string, policy: ResolvedPolicy): string {
  return message.split(policy.rootReal).join(policy.virtualRoot)
}

function isVirtualRootListingMapping(policy: ResolvedPolicy, mapping: VirtualPathMapping): boolean {
  return policy.virtualRootEntries.length > 0 && mapping.relativePath === '.' && mapping.virtualPath === policy.virtualRoot
}

function isVirtualRootListingPath(policy: ResolvedPolicy, absolutePath: string): boolean {
  return policy.virtualRootEntries.length > 0 && resolve(absolutePath) === policy.rootReal
}

function isVirtualRootEntryPath(policy: ResolvedPolicy, absolutePath: string): boolean {
  const relativePath = toPosixPath(relative(policy.rootReal, resolve(absolutePath)))
  return Boolean(relativePath) && !relativePath.includes('/') && policy.virtualRootEntries.includes(relativePath)
}

async function assertVirtualRootEntryPath(policy: ResolvedPolicy, absolutePath: string): Promise<string> {
  assertLexicallyInside(policy.rootReal, absolutePath)
  if (!isVirtualRootEntryPath(policy, absolutePath)) {
    throw new UjimuPiPathPolicyError(`Permission denied: ${toVirtualPath(policy, absolutePath)}`)
  }

  const targetReal = await realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new UjimuPiPathNotFoundError(toVirtualPath(policy, absolutePath))
    throw error
  })
  assertRealInsideData(policy, targetReal, absolutePath)
  return targetReal
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

function assertRealInsideData(policy: ResolvedPolicy, realPath: string, requestedPath: string): void {
  if (!isInside(policy.rootReal, realPath)) {
    throw new UjimuPiPathNotFoundError(toVirtualPath(policy, requestedPath))
  }
}

function toVirtualPath(policy: ResolvedPolicy, absolutePath: string): string {
  const relativePath = relative(policy.rootReal, resolve(absolutePath))
  if (relativePath === '') return policy.virtualRoot
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return policy.virtualRoot
  return posix.join(policy.virtualRoot, toPosixPath(relativePath))
}

function normalizeVirtualRoot(value: string): string {
  const normalized = posix.normalize(value.split('\\').join('/'))
  if (!posix.isAbsolute(normalized) || normalized === '/') {
    throw new UjimuPiPathPolicyError(`Invalid Ujimu Pi virtual root: ${value}`)
  }
  return normalized.replace(/\/$/u, '')
}

function isVirtualInside(parent: string, child: string): boolean {
  const normalizedParent = normalizeVirtualRoot(parent)
  const normalizedChild = posix.normalize(child)
  const result = posix.relative(normalizedParent, normalizedChild)
  return result === '' || (!!result && !result.startsWith('..') && !posix.isAbsolute(result))
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
