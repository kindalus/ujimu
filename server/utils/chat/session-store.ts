import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveAppConfig } from '../config'
import { readSignedCookieValue, signCookieValue } from '../security/signed-cookie'

const SESSION_STATE_FILENAME = 'state.json'
const PENDING_TURN_FILENAME = '.pending-turn.json'
const SESSION_ROOT_PARTS = ['pi', 'chat-sessions'] as const
const ANONYMOUS_RETENTION_MS = 24 * 60 * 60 * 1000
const REGISTERED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SAFE_PATH_COMPONENT = /^[A-Za-z0-9_-]{1,100}$/u

export type ChatSessionIdentity =
  | { type: 'anonymous' }
  | { type: 'registered'; userId: string }

export interface ChatSessionHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface OpenChatSessionTurnOptions {
  dataDir?: string
  cwd: string
  specialistId: string
  identity: ChatSessionIdentity
  conversationId?: string
  replaceFromPiEntryId?: string
  reconstructFromHistory?: boolean
  rehydrationMessages?: ChatSessionHistoryMessage[]
  loadRehydrationMessages?: () => ChatSessionHistoryMessage[] | Promise<ChatSessionHistoryMessage[]>
  now?: Date
  secret?: string
  isPersistedEntryPair?: (entryIds: { userPiEntryId: string; assistantPiEntryId: string }) => boolean
}

export interface ChatSessionCommitResult {
  conversationId: string
  userPiEntryId: string
  assistantPiEntryId: string
}

export interface ChatSessionTurn {
  manager: any
  internalConversationId: string
  reconstructed: boolean
  rehydratedMappings: Array<{ messageId: string; piEntryId: string }>
  beginTurn(): Promise<void>
  captureCompletedEntryIds(options?: { now?: Date }): Promise<{ userPiEntryId: string; assistantPiEntryId: string }>
  commit(options?: { now?: Date }): Promise<ChatSessionCommitResult>
  rollback(): Promise<void>
  release(): void
}

interface SessionState {
  version: 1
  identityType: ChatSessionIdentity['type']
  specialistId: string
  internalConversationId: string
  createdAt: string
  lastCommittedAt: string | null
}

interface PendingTurn {
  version: 1
  sessionFile: string
  checkpointBytes: number
  sessionFileExisted: boolean
  removeOnRollback: boolean
  replaceFromPiEntryId?: string
  completedAt?: string
  userPiEntryId?: string
  assistantPiEntryId?: string
  branchedSessionFile?: string
}

const activeSessionLocks = new Set<string>()

export class ChatConversationBusyError extends Error {
  constructor() {
    super('Conversation already has an active request.')
    this.name = 'ChatConversationBusyError'
  }
}

export class ChatConversationExpiredError extends Error {
  constructor() {
    super('Conversation session has expired.')
    this.name = 'ChatConversationExpiredError'
  }
}

export class ChatConversationUnauthorizedError extends Error {
  constructor() {
    super('Conversation session is not available.')
    this.name = 'ChatConversationUnauthorizedError'
  }
}

export async function openChatSessionTurn(options: OpenChatSessionTurnOptions): Promise<ChatSessionTurn> {
  assertSafeComponent(options.specialistId)
  const now = options.now ?? new Date()
  const dataDir = options.dataDir ?? resolveAppConfig().dataDir
  const resolved = resolveConversationAuthority(options, now)
  const sessionDir = resolveChatSessionDirectory({
    dataDir,
    identityType: options.identity.type,
    specialistId: options.specialistId,
    internalConversationId: resolved.internalConversationId
  })

  acquireLock(sessionDir)

  try {
    let state = await readSessionState(sessionDir)
    let reconstructed = false

    if (options.reconstructFromHistory && options.identity.type === 'registered') {
      await rm(sessionDir, { recursive: true, force: true })
      state = undefined
      reconstructed = true
    }
    let manager: any
    const rehydratedMappings: Array<{ messageId: string; piEntryId: string }> = []

    if (state && isExpired(state, now)) {
      if (options.identity.type === 'anonymous' || (!options.rehydrationMessages && !options.loadRehydrationMessages)) {
        await rm(sessionDir, { recursive: true, force: true })
        throw new ChatConversationExpiredError()
      }
      await rm(sessionDir, { recursive: true, force: true })
      state = undefined
      reconstructed = true
    }

    if (state && (
      state.identityType !== options.identity.type
      || state.specialistId !== options.specialistId
      || state.internalConversationId !== resolved.internalConversationId
    )) {
      throw new ChatConversationUnauthorizedError()
    }

    await recoverAbandonedTurn(sessionDir, options.isPersistedEntryPair)

    const existingSessionFile = await findSingleSessionFile(sessionDir)
    if (existingSessionFile) {
      manager = await openPiSessionManager(existingSessionFile, sessionDir, options.cwd)
    } else {
      if (options.conversationId && options.identity.type === 'anonymous') {
        throw new ChatConversationUnauthorizedError()
      }

      await mkdir(sessionDir, { recursive: true, mode: 0o700 })
      await chmod(sessionDir, 0o700)
      manager = await createPiSessionManager(options.cwd, sessionDir, resolved.internalConversationId)
      await secureSessionFile(manager.getSessionFile())

      const history = options.rehydrationMessages ?? await options.loadRehydrationMessages?.() ?? []
      reconstructed ||= history.length > 0
      for (const message of history) {
        const piEntryId = manager.appendCustomMessageEntry(
          'ujimu-history-rehydration',
          `${message.role.toUpperCase()}: ${message.content}`,
          false,
          { messageId: message.id, role: message.role }
        )
        rehydratedMappings.push({ messageId: message.id, piEntryId })
      }

      state = {
        version: 1,
        identityType: options.identity.type,
        specialistId: options.specialistId,
        internalConversationId: resolved.internalConversationId,
        createdAt: now.toISOString(),
        lastCommittedAt: history.length > 0 ? now.toISOString() : null
      }
      await writeSessionState(sessionDir, state)
    }

    if (!state) {
      throw new ChatConversationUnauthorizedError()
    }

    if (options.replaceFromPiEntryId) {
      const target = manager.getEntry(options.replaceFromPiEntryId)
      if (!target) {
        throw new ChatConversationUnauthorizedError()
      }
      if (target.parentId) manager.branch(target.parentId)
      else manager.resetLeaf()
    }

    let began = false
    let completed = false
    let released = false
    let pending: PendingTurn | undefined

    const release = () => {
      if (released) return
      released = true
      activeSessionLocks.delete(sessionDir)
    }
    const captureCompletedEntryIds = async (captureOptions: { now?: Date } = {}) => {
      if (!began || !pending) throw new Error('Chat session turn was not started.')
      const entryIds = findLatestTurnEntryIds(manager)
      pending = {
        ...pending,
        ...entryIds,
        completedAt: (captureOptions.now ?? new Date()).toISOString()
      }
      await writePrivateJson(join(sessionDir, PENDING_TURN_FILENAME), pending)
      return entryIds
    }

    return {
      manager,
      internalConversationId: resolved.internalConversationId,
      reconstructed,
      rehydratedMappings,
      async beginTurn() {
        if (began) return
        const sessionFile = manager.getSessionFile()
        if (!sessionFile) throw new Error('Persistent Pi session file was not created.')
        const checkpoint = await stat(sessionFile).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        pending = {
          version: 1,
          sessionFile,
          checkpointBytes: checkpoint?.size ?? 0,
          sessionFileExisted: Boolean(checkpoint),
          removeOnRollback: state!.lastCommittedAt === null && rehydratedMappings.length === 0,
          ...(options.replaceFromPiEntryId ? { replaceFromPiEntryId: options.replaceFromPiEntryId } : {})
        }
        await writePrivateJson(join(sessionDir, PENDING_TURN_FILENAME), pending)
        began = true
      },
      captureCompletedEntryIds,
      async commit(commitOptions = {}) {
        if (!began || !pending) throw new Error('Chat session turn was not started.')
        const entryIds = pending.userPiEntryId && pending.assistantPiEntryId
          ? { userPiEntryId: pending.userPiEntryId, assistantPiEntryId: pending.assistantPiEntryId }
          : await captureCompletedEntryIds(commitOptions)
        const committedAt = commitOptions.now ?? (pending.completedAt ? new Date(pending.completedAt) : new Date())

        if (options.replaceFromPiEntryId) {
          const branchedFile = manager.createBranchedSession(entryIds.assistantPiEntryId)
          if (!branchedFile) throw new Error('Pi did not create a persistent branch session.')
          await secureSessionFile(branchedFile)
          pending = { ...pending, branchedSessionFile: branchedFile }
          await writePrivateJson(join(sessionDir, PENDING_TURN_FILENAME), pending)
          if (branchedFile !== pending.sessionFile) {
            await rm(pending.sessionFile, { force: true })
          }
        }

        await secureSessionFile(await findSingleSessionFile(sessionDir))
        state!.lastCommittedAt = committedAt.toISOString()
        await writeSessionState(sessionDir, state!)
        await rm(join(sessionDir, PENDING_TURN_FILENAME), { force: true })
        completed = true

        return {
          conversationId: options.identity.type === 'anonymous'
            ? createAnonymousConversationToken(
                resolved.internalConversationId,
                options.specialistId,
                committedAt,
                options.secret
              )
            : resolved.internalConversationId,
          ...entryIds
        }
      },
      async rollback() {
        if (completed) return
        if (!began || !pending) {
          if (state!.lastCommittedAt === null && rehydratedMappings.length === 0) {
            await rm(sessionDir, { recursive: true, force: true })
          }
          return
        }

        if (pending.removeOnRollback) {
          await rm(sessionDir, { recursive: true, force: true })
          return
        }

        if (pending.sessionFileExisted) {
          await truncate(pending.sessionFile, pending.checkpointBytes)
        } else {
          await rm(pending.sessionFile, { force: true })
        }
        for (const file of await listSessionFiles(sessionDir)) {
          if (file !== pending.sessionFile) await rm(file, { force: true })
        }
        await rm(join(sessionDir, PENDING_TURN_FILENAME), { force: true })
      },
      release
    }
  } catch (error) {
    activeSessionLocks.delete(sessionDir)
    throw error
  }
}

export function resolveChatSessionDirectory(input: {
  dataDir: string
  identityType: ChatSessionIdentity['type']
  specialistId: string
  internalConversationId: string
}): string {
  assertSafeComponent(input.specialistId)
  assertSafeComponent(input.internalConversationId)
  return join(
    input.dataDir,
    ...SESSION_ROOT_PARTS,
    input.identityType,
    input.specialistId,
    input.internalConversationId
  )
}

export async function reconcilePendingChatSessions(options: {
  dataDir?: string
  isPersistedEntryPair?: (input: {
    identityType: ChatSessionIdentity['type']
    specialistId: string
    internalConversationId: string
    userPiEntryId: string
    assistantPiEntryId: string
  }) => boolean
} = {}): Promise<{ reconciled: number }> {
  const dataDir = options.dataDir ?? resolveAppConfig().dataDir
  const root = join(dataDir, ...SESSION_ROOT_PARTS)
  let reconciled = 0

  for (const identityType of ['anonymous', 'registered'] as const) {
    const identityRoot = join(root, identityType)
    for (const specialistId of await listDirectories(identityRoot)) {
      const specialistRoot = join(identityRoot, specialistId)
      for (const internalConversationId of await listDirectories(specialistRoot)) {
        const sessionDir = join(specialistRoot, internalConversationId)
        if (activeSessionLocks.has(sessionDir)) continue
        const pending = await readJson<PendingTurn>(join(sessionDir, PENDING_TURN_FILENAME))
        if (!pending) continue
        await recoverAbandonedTurn(sessionDir, (entryIds) =>
          identityType === 'registered' && Boolean(options.isPersistedEntryPair?.({
            identityType,
            specialistId,
            internalConversationId,
            ...entryIds
          })))
        reconciled += 1
      }
    }
  }

  return { reconciled }
}

export async function cleanupExpiredChatSessions(options: {
  dataDir?: string
  now?: Date
} = {}): Promise<{ removed: number }> {
  const dataDir = options.dataDir ?? resolveAppConfig().dataDir
  const now = options.now ?? new Date()
  const root = join(dataDir, ...SESSION_ROOT_PARTS)
  let removed = 0

  for (const identityType of ['anonymous', 'registered'] as const) {
    const identityRoot = join(root, identityType)
    for (const specialistId of await listDirectories(identityRoot)) {
      const specialistRoot = join(identityRoot, specialistId)
      for (const conversationId of await listDirectories(specialistRoot)) {
        const sessionDir = join(specialistRoot, conversationId)
        if (activeSessionLocks.has(sessionDir)) continue
        const state = await readSessionState(sessionDir)
        if (!state || isExpired(state, now)) {
          await rm(sessionDir, { recursive: true, force: true })
          removed += 1
        }
      }
    }
  }

  return { removed }
}

export async function deleteChatSession(input: {
  dataDir?: string
  identityType: ChatSessionIdentity['type']
  specialistId: string
  internalConversationId: string
}): Promise<void> {
  const sessionDir = resolveChatSessionDirectory({
    dataDir: input.dataDir ?? resolveAppConfig().dataDir,
    identityType: input.identityType,
    specialistId: input.specialistId,
    internalConversationId: input.internalConversationId
  })
  if (activeSessionLocks.has(sessionDir)) throw new ChatConversationBusyError()
  await rm(sessionDir, { recursive: true, force: true })
}

export async function deleteChatSessionsForSpecialist(input: {
  dataDir?: string
  specialistId: string
}): Promise<void> {
  assertSafeComponent(input.specialistId)
  const root = join(input.dataDir ?? resolveAppConfig().dataDir, ...SESSION_ROOT_PARTS)
  await Promise.all([
    rm(join(root, 'anonymous', input.specialistId), { recursive: true, force: true }),
    rm(join(root, 'registered', input.specialistId), { recursive: true, force: true })
  ])
}

function resolveConversationAuthority(
  options: OpenChatSessionTurnOptions,
  now: Date
): { internalConversationId: string } {
  if (options.identity.type === 'registered') {
    const internalConversationId = options.conversationId ?? randomUUID()
    assertSafeComponent(internalConversationId)
    return { internalConversationId }
  }

  if (!options.conversationId) {
    return { internalConversationId: randomUUID() }
  }

  const signedValue = readSignedCookieValue(options.conversationId, options.secret)
  if (!signedValue) throw new ChatConversationUnauthorizedError()
  const [internalConversationId, specialistId, expiresAtRaw] = signedValue.split(':')
  const expiresAt = Number(expiresAtRaw)
  if (
    !internalConversationId
    || !specialistId
    || !Number.isFinite(expiresAt)
    || specialistId !== options.specialistId
  ) {
    throw new ChatConversationUnauthorizedError()
  }
  assertSafeComponent(internalConversationId)
  if (now.getTime() >= expiresAt) throw new ChatConversationExpiredError()
  return { internalConversationId }
}

function createAnonymousConversationToken(
  internalConversationId: string,
  specialistId: string,
  now: Date,
  secret?: string
): string {
  return signCookieValue(
    `${internalConversationId}:${specialistId}:${now.getTime() + ANONYMOUS_RETENTION_MS}`,
    secret
  )
}

function acquireLock(key: string): void {
  if (activeSessionLocks.has(key)) throw new ChatConversationBusyError()
  activeSessionLocks.add(key)
}

function isExpired(state: SessionState, now: Date): boolean {
  if (!state.lastCommittedAt) return false
  const retention = state.identityType === 'anonymous' ? ANONYMOUS_RETENTION_MS : REGISTERED_RETENTION_MS
  return now.getTime() >= new Date(state.lastCommittedAt).getTime() + retention
}

async function createPiSessionManager(cwd: string, sessionDir: string, id: string): Promise<any> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  return SessionManager.create(cwd, sessionDir, { id })
}

async function openPiSessionManager(file: string, sessionDir: string, cwd?: string): Promise<any> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  return SessionManager.open(file, sessionDir, cwd)
}

function findLatestTurnEntryIds(manager: any): {
  userPiEntryId: string
  assistantPiEntryId: string
} {
  const branch = manager.getBranch() as Array<{
    id: string
    type: string
    message?: { role?: string }
  }>
  let assistantPiEntryId: string | undefined
  let userPiEntryId: string | undefined

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (entry?.type !== 'message') continue
    if (!assistantPiEntryId && entry.message?.role === 'assistant') {
      assistantPiEntryId = entry.id
      continue
    }
    if (assistantPiEntryId && entry.message?.role === 'user') {
      userPiEntryId = entry.id
      break
    }
  }

  if (!userPiEntryId || !assistantPiEntryId) {
    throw new Error('Completed Pi turn entries were not found.')
  }
  return { userPiEntryId, assistantPiEntryId }
}

async function recoverAbandonedTurn(
  sessionDir: string,
  isPersistedEntryPair: OpenChatSessionTurnOptions['isPersistedEntryPair']
): Promise<void> {
  const pendingPath = join(sessionDir, PENDING_TURN_FILENAME)
  const pending = await readJson<PendingTurn>(pendingPath)
  if (!pending) return
  if (!isValidPendingTurn(pending, sessionDir)) {
    await rm(sessionDir, { recursive: true, force: true })
    return
  }

  const expected = pending.userPiEntryId && pending.assistantPiEntryId
    ? { userPiEntryId: pending.userPiEntryId, assistantPiEntryId: pending.assistantPiEntryId }
    : undefined

  if (expected && isPersistedEntryPair?.(expected)) {
    if (pending.replaceFromPiEntryId) {
      let branchedFile = pending.branchedSessionFile
      const stagedExists = branchedFile ? await stat(branchedFile).then(() => true).catch(() => false) : false
      if (!stagedExists) {
        const manager = await openPiSessionManager(pending.sessionFile, sessionDir)
        branchedFile = manager.createBranchedSession(expected.assistantPiEntryId)
      }
      if (!branchedFile) throw new Error('Pi did not recover the committed branch session.')
      await secureSessionFile(branchedFile)
      for (const file of await listSessionFiles(sessionDir)) {
        if (file !== branchedFile) await rm(file, { force: true })
      }
    }
    await secureSessionFile(await findSingleSessionFile(sessionDir))
    const state = await readSessionState(sessionDir)
    if (state) {
      state.lastCommittedAt = pending.completedAt ?? new Date().toISOString()
      await writeSessionState(sessionDir, state)
    }
    await rm(pendingPath, { force: true })
    return
  }

  if (pending.removeOnRollback) {
    await rm(sessionDir, { recursive: true, force: true })
    return
  }

  const details = await stat(pending.sessionFile).catch(() => undefined)
  if (details && pending.sessionFileExisted && details.size >= pending.checkpointBytes) {
    await truncate(pending.sessionFile, pending.checkpointBytes)
  } else if (details && !pending.sessionFileExisted) {
    await rm(pending.sessionFile, { force: true })
  }
  for (const file of await listSessionFiles(sessionDir)) {
    if (file !== pending.sessionFile) await rm(file, { force: true })
  }
  await rm(pendingPath, { force: true })
}

async function readSessionState(sessionDir: string): Promise<SessionState | undefined> {
  const state = await readJson<SessionState>(join(sessionDir, SESSION_STATE_FILENAME))
  return state && isValidSessionState(state) ? state : undefined
}

async function writeSessionState(sessionDir: string, state: SessionState): Promise<void> {
  await mkdir(sessionDir, { recursive: true, mode: 0o700 })
  await chmod(sessionDir, 0o700)
  await writePrivateJson(join(sessionDir, SESSION_STATE_FILENAME), state)
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(tempPath, path)
  await chmod(path, 0o600)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function findSingleSessionFile(sessionDir: string): Promise<string | undefined> {
  return (await listSessionFiles(sessionDir))[0]
}

async function listSessionFiles(sessionDir: string): Promise<string[]> {
  try {
    return (await readdir(sessionDir))
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .map((name) => join(sessionDir, name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function isValidSessionState(state: SessionState): boolean {
  return state.version === 1
    && (state.identityType === 'anonymous' || state.identityType === 'registered')
    && SAFE_PATH_COMPONENT.test(state.specialistId)
    && SAFE_PATH_COMPONENT.test(state.internalConversationId)
    && Number.isFinite(new Date(state.createdAt).getTime())
    && (state.lastCommittedAt === null || Number.isFinite(new Date(state.lastCommittedAt).getTime()))
}

function isValidPendingTurn(pending: PendingTurn, sessionDir: string): boolean {
  return pending.version === 1
    && dirname(pending.sessionFile) === sessionDir
    && pending.sessionFile.endsWith('.jsonl')
    && Number.isSafeInteger(pending.checkpointBytes)
    && pending.checkpointBytes >= 0
    && typeof pending.sessionFileExisted === 'boolean'
    && typeof pending.removeOnRollback === 'boolean'
    && (!pending.branchedSessionFile
      || (dirname(pending.branchedSessionFile) === sessionDir && pending.branchedSessionFile.endsWith('.jsonl')))
}

async function secureSessionFile(path: string | undefined): Promise<void> {
  if (!path) return
  await chmod(path, 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

function assertSafeComponent(value: string): void {
  if (!SAFE_PATH_COMPONENT.test(value)) throw new ChatConversationUnauthorizedError()
}
