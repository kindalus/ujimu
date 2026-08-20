import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAgentSessionMock = vi.hoisted(() => vi.fn(async () => ({
  session: {
    subscribe: vi.fn(() => vi.fn()),
    dispose: vi.fn()
  }
})))
const sessionManagerInMemoryMock = vi.hoisted(() => vi.fn(() => ({ kind: 'memory' })))
const defaultResourceLoaderMock = vi.hoisted(() => vi.fn().mockImplementation(() => ({
  reload: vi.fn(async () => undefined)
})))

vi.mock('../server/utils/agents/logs', () => ({
  createAgentSessionLogger: vi.fn(async () => ({
    path: '/tmp/ujimu-agent.log',
    writeSessionCreated: vi.fn(),
    writeEvent: vi.fn(),
    close: vi.fn(async () => undefined)
  }))
}))

vi.mock('../server/utils/pi/paths', () => ({
  ensureUjimuPiConfigDir: vi.fn(async () => '/tmp/ujimu-config'),
  resolveUjimuPiBundleDir: vi.fn(() => '/tmp/ujimu-bundle'),
  resolveUjimuPiAgentDir: vi.fn(() => '/tmp/ujimu-config'),
  resolveUjimuPiToolPath: vi.fn((name: string) => `/tmp/ujimu-tools/${name}`)
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
  SessionManager: { inMemory: sessionManagerInMemoryMock },
  DefaultResourceLoader: defaultResourceLoaderMock,
  createAgentSession: createAgentSessionMock
}))

describe('unrestricted Pi tools acceptance', () => {
  beforeEach(() => {
    createAgentSessionMock.mockClear()
    sessionManagerInMemoryMock.mockClear()
    defaultResourceLoaderMock.mockClear()
  })

  it('uses the specialist directory as the real Pi root and enables all default plus project custom tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-unrestricted-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({ cwd: root, task: 'chat' })

    expect(sessionManagerInMemoryMock).toHaveBeenCalledWith(root)
    expect(defaultResourceLoaderMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: root,
      agentDir: '/tmp/ujimu-config',
      additionalSkillPaths: ['/tmp/ujimu-bundle/skills'],
      noSkills: true
    }))
    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: root,
      modelRuntime: expect.objectContaining({ getModel: expect.any(Function) }),
      tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'pdf_to_markdown'],
      customTools: [expect.objectContaining({ name: 'pdf_to_markdown' })]
    }))
  })
})
