import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
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

describe('task-scoped Pi tools acceptance', () => {
  beforeEach(() => {
    createAgentSessionMock.mockClear()
    sessionManagerInMemoryMock.mockClear()
    defaultResourceLoaderMock.mockClear()
  })

  it('gives chat only read-only file tools and installs the path policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-unrestricted-'))
    await mkdir(join(root, 'wiki'))
    await writeFile(join(root, 'AGENTS.md'), '# Specialist\n')
    await writeFile(join(root, 'wiki', 'page.md'), '# Page\n')
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({ cwd: root, task: 'chat' })

    expect(sessionManagerInMemoryMock).toHaveBeenCalledWith(root)
    expect(defaultResourceLoaderMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: root,
      agentDir: '/tmp/ujimu-config',
      additionalSkillPaths: ['/tmp/ujimu-bundle/skills'],
      extensionFactories: [expect.objectContaining({ name: 'ujimu-chat-file-policy', hidden: true })],
      noSkills: true
    }))
    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: root,
      modelRuntime: expect.objectContaining({ getModel: expect.any(Function) }),
      tools: ['read', 'grep', 'find', 'ls'],
      customTools: []
    }))

    const loaderOptions = defaultResourceLoaderMock.mock.calls[0][0]
    let toolCallHandler: ((event: unknown) => Promise<unknown>) | undefined
    loaderOptions.extensionFactories[0].factory({
      on: (_event: string, handler: (event: unknown) => Promise<unknown>) => { toolCallHandler = handler }
    })
    await expect(toolCallHandler?.({ toolName: 'read', input: { path: 'wiki/page.md' } })).resolves.toBeUndefined()
    await expect(toolCallHandler?.({ toolName: 'read', input: { path: 'specialist.yaml' } })).resolves.toMatchObject({ block: true })
    await expect(toolCallHandler?.({ toolName: 'write', input: { path: 'wiki/page.md' } })).resolves.toMatchObject({ block: true })
  })

  it('installs an exact derivation policy with no bash or conversion tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-derivation-'))
    const { createUjimuPiSession } = await import('../server/utils/pi/session')

    await createUjimuPiSession({
      cwd: root,
      task: 'derivation',
      derivationTargetPath: 'wiki/derived/result.md'
    })

    expect(defaultResourceLoaderMock).toHaveBeenCalledWith(expect.objectContaining({
      extensionFactories: [expect.objectContaining({ name: 'ujimu-derivation-file-policy', hidden: true })]
    }))
    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      tools: ['read', 'edit', 'write', 'grep', 'find', 'ls'],
      customTools: []
    }))
  })

  it('blocks ingestion publication until PDF visual coverage is publishable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-ingestion-policy-'))
    await mkdir(join(root, 'raw'))
    await mkdir(join(root, 'wiki'))
    await mkdir(join(root, 'converted'))
    await mkdir(join(root, '.ujimu'))
    const coverage = {
      isPublicationAllowed: vi.fn(() => false),
      isManagedConvertedPath: vi.fn((path: string) => path === 'converted/source.pdf.md')
    }
    const { createIngestionPublicationPolicyExtension } = await import('../server/utils/pi/file-policy')
    const extension = createIngestionPublicationPolicyExtension(root, coverage)
    let handler: ((event: any) => Promise<unknown>) | undefined
    extension.factory({
      on: (_event: string, callback: (event: any) => Promise<unknown>) => { handler = callback }
    })

    await expect(handler?.({ toolName: 'write', input: { path: 'wiki/page.md' } }))
      .resolves.toMatchObject({ block: true })
    await expect(handler?.({ toolName: 'edit', input: { path: 'converted/source.pdf.md' } }))
      .resolves.toMatchObject({ block: true })
    await expect(handler?.({ toolName: 'write', input: { path: '.ujimu/ingestion-manifest.json' } }))
      .resolves.toBeUndefined()

    coverage.isPublicationAllowed.mockReturnValue(true)
    await expect(handler?.({ toolName: 'write', input: { path: 'wiki/page.md' } }))
      .resolves.toBeUndefined()
    await expect(handler?.({ toolName: 'write', input: { path: 'wiki/nested/page.md' } }))
      .resolves.toBeUndefined()
    await expect(handler?.({ toolName: 'write', input: { path: 'converted/source.pdf.md' } }))
      .resolves.toMatchObject({ block: true })
    await expect(handler?.({ toolName: 'write', input: { path: 'raw/source.pdf' } }))
      .resolves.toMatchObject({ block: true })
    await expect(handler?.({ toolName: 'write', input: { path: 'specialist.yaml' } }))
      .resolves.toMatchObject({ block: true })
  })

  it('allows only AGENTS.md and real paths inside wiki', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-policy-'))
    const outside = await mkdtemp(join(tmpdir(), 'ujimu-pi-outside-'))
    await mkdir(join(root, 'wiki', 'derived'), { recursive: true })
    await mkdir(join(root, 'converted'))
    await mkdir(join(root, 'raw'))
    await writeFile(join(root, 'AGENTS.md'), '# Specialist\n')
    await writeFile(join(root, 'wiki', 'page.md'), '# Page\n')
    await writeFile(join(root, 'wiki', 'index.md'), '# Index\n')
    await writeFile(join(root, 'converted', 'source.md'), '# Converted\n')
    await writeFile(join(root, 'raw', 'source.md'), '# Source\n')
    await writeFile(join(root, 'specialist.yaml'), 'id: test\n')
    await writeFile(join(outside, 'secret.md'), '# Secret\n')
    await symlink(join(outside, 'secret.md'), join(root, 'wiki', 'escaped.md'))

    const {
      isChatPathAllowed,
      isDerivationReadPathAllowed,
      isDerivationWritePathAllowed,
      normalizeConsultedWikiDocumentPath
    } = await import('../server/utils/pi/file-policy')

    await expect(isChatPathAllowed(root, 'AGENTS.md')).resolves.toBe(true)
    await expect(isChatPathAllowed(root, 'wiki')).resolves.toBe(true)
    await expect(isChatPathAllowed(root, 'wiki/page.md')).resolves.toBe(true)
    await expect(isChatPathAllowed(root, 'raw/source.md')).resolves.toBe(false)
    await expect(isChatPathAllowed(root, 'specialist.yaml')).resolves.toBe(false)
    await expect(isChatPathAllowed(root, '../secret.md')).resolves.toBe(false)
    await expect(isChatPathAllowed(root, 'wiki/escaped.md')).resolves.toBe(false)
    await expect(normalizeConsultedWikiDocumentPath(root, 'wiki/page.md')).resolves.toBe('wiki/page.md')
    await expect(normalizeConsultedWikiDocumentPath(root, 'wiki/index.md')).resolves.toBeUndefined()
    await expect(normalizeConsultedWikiDocumentPath(root, 'raw/source.md')).resolves.toBeUndefined()
    await expect(normalizeConsultedWikiDocumentPath(root, 'wiki/escaped.md')).resolves.toBeUndefined()

    await expect(isDerivationReadPathAllowed(root, 'converted/source.md')).resolves.toBe(true)
    await expect(isDerivationReadPathAllowed(root, 'raw/source.md')).resolves.toBe(false)
    const writeTargets = ['wiki/derived/new.md', 'wiki/index.md', 'wiki/log.md']
    await expect(isDerivationWritePathAllowed(root, 'wiki/derived/new.md', writeTargets)).resolves.toBe(true)
    await expect(isDerivationWritePathAllowed(root, 'wiki/page.md', writeTargets)).resolves.toBe(false)
    await expect(isDerivationWritePathAllowed(root, '../outside.md', writeTargets)).resolves.toBe(false)
  })
})
