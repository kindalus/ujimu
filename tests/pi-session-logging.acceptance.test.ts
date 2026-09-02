import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const originalIngestionThinkingLevel = process.env.UJIMU_PI_INGESTION_THINKING_LEVEL

  beforeEach(() => {
    writeSessionCreatedMock.mockClear()
    createAgentSessionLoggerMock.mockClear()
    createAgentSessionMock.mockClear()
    delete process.env.UJIMU_PI_INGESTION_THINKING_LEVEL
  })

  afterEach(() => {
    if (originalIngestionThinkingLevel === undefined) {
      delete process.env.UJIMU_PI_INGESTION_THINKING_LEVEL
    } else {
      process.env.UJIMU_PI_INGESTION_THINKING_LEVEL = originalIngestionThinkingLevel
    }
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
      tools: [
        'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
        'pdf_to_markdown', 'prepare_pdf_ocr', 'render_pdf_ocr_page'
      ]
    }))
    expect(writeSessionCreatedMock).toHaveBeenCalledWith({
      task: 'ingestion',
      tools: [
        'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
        'pdf_to_markdown', 'prepare_pdf_ocr', 'render_pdf_ocr_page'
      ],
      model: 'configured'
    })
  })

  it('passes the validated ingestion thinking-level override to the Pi SDK', async () => {
    process.env.UJIMU_PI_INGESTION_THINKING_LEVEL = ' high '
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-thinking-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({ cwd: root, task: 'ingestion' })

    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: 'high' }))
  })

  it('preserves the settings fallback when the ingestion override is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-thinking-fallback-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({ cwd: root, task: 'ingestion' })

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ thinkingLevel: expect.anything() })
    )
  })

  it('does not apply the ingestion thinking level to chat sessions', async () => {
    process.env.UJIMU_PI_INGESTION_THINKING_LEVEL = 'high'
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-thinking-chat-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({ cwd: root, task: 'chat' })

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ thinkingLevel: expect.anything() })
    )
  })

  it('rejects an invalid ingestion thinking level before creating a Pi session', async () => {
    process.env.UJIMU_PI_INGESTION_THINKING_LEVEL = 'extreme'
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-thinking-invalid-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await expect(createUjimuPiSession({ cwd: root, task: 'ingestion' })).rejects.toThrow(
      'UJIMU_PI_INGESTION_THINKING_LEVEL'
    )
    expect(createAgentSessionMock).not.toHaveBeenCalled()
  })
})
