import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSandboxedFileTools, UjimuPiPathPolicyError, type UjimuPiFileToolName } from '../server/utils/pi/sandboxed-tools'

const TOOL_NAMES: UjimuPiFileToolName[] = ['read', 'write', 'edit', 'grep', 'find', 'ls']

describe('Ujimu Pi sandboxed file tools acceptance', () => {
  it('allows chat reads/searches only inside wiki and blocks raw, absolute, and traversal paths', async () => {
    const root = await createSpecialistFixture()
    const tools = await createSandboxedFileTools({
      root,
      read: { directories: ['wiki'] },
      write: { directories: [] },
      list: { directories: ['wiki'] }
    }, TOOL_NAMES)

    await expect(executeTool(tools, 'read', { path: 'wiki/page.md' })).resolves.toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining('Artigo 1.º') })]
    })
    await expect(executeTool(tools, 'grep', { pattern: 'Artigo', path: 'wiki' })).resolves.toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining('page.md') })]
    })
    await expect(executeTool(tools, 'find', { pattern: '**/*.md', path: 'wiki' })).resolves.toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining('page.md') })]
    })

    await expect(executeTool(tools, 'read', { path: 'raw/source.md' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(executeTool(tools, 'read', { path: '../outside-secret.md' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(executeTool(tools, 'read', { path: '/etc/passwd' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(executeTool(tools, 'grep', { pattern: 'secret', path: 'raw' })).rejects.toThrow()
  })

  it('allows ingestion to write wiki files but not raw files or symlink escapes', async () => {
    const root = await createSpecialistFixture()
    await symlink(join(root, '..', 'outside-secret.md'), join(root, 'wiki', 'escape.md'))
    const tools = await createSandboxedFileTools({
      root,
      read: { directories: ['wiki'], files: ['raw/source.md'] },
      write: { directories: ['wiki'] },
      list: { directories: ['wiki'] }
    }, TOOL_NAMES)

    await expect(executeTool(tools, 'write', { path: 'wiki/new.md', content: 'new wiki page' })).resolves.toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining('Successfully wrote') })]
    })
    await expect(readFile(join(root, 'wiki', 'new.md'), 'utf8')).resolves.toBe('new wiki page')

    await expect(executeTool(tools, 'write', { path: 'raw/source.md', content: 'changed raw' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(executeTool(tools, 'write', { path: 'wiki/escape.md', content: 'leak' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(readFile(join(root, '..', 'outside-secret.md'), 'utf8')).resolves.toBe('outside secret')
  })

  it('allows conversion to read only the source and write only the derived Markdown file', async () => {
    const root = await createSpecialistFixture()
    const tools = await createSandboxedFileTools({
      root,
      read: { files: ['raw/source.txt'] },
      write: { files: ['raw/source.txt.md'] },
      list: { directories: [] }
    }, TOOL_NAMES)

    await expect(executeTool(tools, 'read', { path: 'raw/source.txt' })).resolves.toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining('Fonte TXT') })]
    })
    await expect(executeTool(tools, 'write', { path: 'raw/source.txt.md', content: '# Fonte TXT' })).resolves.toBeDefined()
    await expect(readFile(join(root, 'raw', 'source.txt.md'), 'utf8')).resolves.toBe('# Fonte TXT')

    await expect(executeTool(tools, 'read', { path: 'raw/source.md' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(executeTool(tools, 'write', { path: 'wiki/from-conversion.md', content: 'not allowed' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
    await expect(executeTool(tools, 'ls', { path: 'raw' })).rejects.toBeInstanceOf(UjimuPiPathPolicyError)
  })
})

async function createSpecialistFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-pi-tools-'))
  await mkdir(join(root, 'wiki'), { recursive: true })
  await mkdir(join(root, 'raw'), { recursive: true })
  await writeFile(join(root, 'wiki', 'page.md'), '# Página\n\nArtigo 1.º', 'utf8')
  await writeFile(join(root, 'raw', 'source.md'), '# Fonte\n\nArtigo secreto', 'utf8')
  await writeFile(join(root, 'raw', 'source.txt'), 'Fonte TXT', 'utf8')
  await writeFile(join(root, '..', 'outside-secret.md'), 'outside secret', 'utf8')
  return root
}

async function executeTool(tools: Awaited<ReturnType<typeof createSandboxedFileTools>>, name: string, params: Record<string, unknown>) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool.execute('test-tool-call', params, undefined, undefined, { model: undefined } as any)
}
