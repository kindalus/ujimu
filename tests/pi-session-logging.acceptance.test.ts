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
const createAgentSessionMock = vi.hoisted(() => vi.fn(async () => ({
  session: {
    subscribe: vi.fn(() => vi.fn()),
    dispose: vi.fn()
  }
})))

vi.mock('../server/utils/agents/logs', () => ({
  createAgentSessionLogger: createAgentSessionLoggerMock
}))

vi.mock('../server/utils/pi/paths', () => ({
  ensureUjimuPiConfigDir: vi.fn(async () => '/tmp/ujimu-config'),
  resolveUjimuPiBundleDir: vi.fn(() => '/tmp/ujimu-bundle'),
  resolveUjimuPiAgentDir: vi.fn(() => '/tmp/ujimu-config')
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: {
    create: vi.fn(async () => ({
      getModel: vi.fn(() => ({ provider: 'test', id: 'model' })),
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
    createAgentSessionMock.mockClear()
  })

  it('logs all default Pi tools plus Ujimu custom tools for the specialist-root session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-session-log-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({
      cwd: root,
      task: 'ingestion',
      agentLog: { specialistId: 'iva' }
    })

    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: root,
      tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'pdf_to_markdown']
    }))
    expect(writeSessionCreatedMock).toHaveBeenCalledWith({
      task: 'ingestion',
      tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'pdf_to_markdown'],
      model: 'configured'
    })
  })
})
