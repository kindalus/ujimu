import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const writeSessionCreatedMock = vi.hoisted(() => vi.fn())
const createAgentSessionLoggerMock = vi.hoisted(() => vi.fn(async () => ({
  path: '/tmp/ujimu-agent.log',
  writeSessionCreated: writeSessionCreatedMock,
  writeEvent: vi.fn(),
  close: vi.fn(async () => undefined)
})))
const createSandboxedFileToolsMock = vi.hoisted(() => vi.fn(async (_policy: unknown, tools: string[]) =>
  tools.map((name) => ({ name }))
))
const createAgentSessionMock = vi.hoisted(() => vi.fn(async () => ({
  session: {
    subscribe: vi.fn(() => vi.fn()),
    dispose: vi.fn()
  }
})))

vi.mock('../server/utils/agents/logs', () => ({
  createAgentSessionLogger: createAgentSessionLoggerMock
}))

vi.mock('../server/utils/pi/sandboxed-tools', () => ({
  createSandboxedFileTools: createSandboxedFileToolsMock
}))

vi.mock('../server/utils/pi/paths', () => ({
  ensureUjimuPiConfigDir: vi.fn(async () => '/tmp/ujimu-config'),
  resolveUjimuPiBundleDir: vi.fn(() => '/tmp/ujimu-bundle'),
  resolveUjimuPiAgentDir: vi.fn(() => '/tmp/ujimu-config')
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: { create: vi.fn(() => ({})) },
  ModelRegistry: {
    create: vi.fn(() => ({
      find: vi.fn(() => ({ provider: 'test', id: 'model' })),
      hasConfiguredAuth: vi.fn(() => true)
    }))
  },
  SettingsManager: {
    create: vi.fn(() => ({
      getDefaultProvider: vi.fn(() => 'test'),
      getDefaultModel: vi.fn(() => 'model')
    }))
  },
  SessionManager: { inMemory: vi.fn(() => ({})) },
  DefaultResourceLoader: vi.fn().mockImplementation(() => ({
    reload: vi.fn(async () => undefined)
  })),
  createAgentSession: createAgentSessionMock
}))

describe('Ujimu Pi session logging acceptance', () => {
  beforeEach(() => {
    writeSessionCreatedMock.mockClear()
    createAgentSessionLoggerMock.mockClear()
    createSandboxedFileToolsMock.mockClear()
    createAgentSessionMock.mockClear()
  })

  it('logs each active file tool once when sandboxed tools replace the built-ins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-session-log-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({
      cwd: root,
      task: 'ingestion',
      tools: ['read', 'write', 'edit', 'grep', 'find', 'ls'],
      fileSystemPolicy: { root },
      agentLog: { specialistId: 'iva' }
    })

    expect(writeSessionCreatedMock).toHaveBeenCalledWith({
      task: 'ingestion',
      tools: ['read', 'write', 'edit', 'grep', 'find', 'ls'],
      model: 'configured'
    })
  })
})
