import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertDocxToMarkdown } from '../server/utils/pi/docx-to-markdown-tool'
import { runPendingConversions } from '../server/utils/ingestion/conversion'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('DOCX to Markdown Ujimu tool acceptance', () => {
  it('converts a DOCX under raw into Markdown without a Pi model session', async () => {
    const root = await createSpecialistRoot()
    await writeFile(join(root, 'raw', 'manual.docx'), createDocxBuffer(`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Procedimentos</w:t></w:r></w:p>
          <w:p><w:r><w:t>Abrir a porta</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>com cuidado.</w:t></w:r></w:p>
          <w:tbl>
            <w:tr><w:tc><w:p><w:r><w:t>Passo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Acção</w:t></w:r></w:p></w:tc></w:tr>
            <w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Confirmar acesso</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>
    `))

    const result = await convertDocxToMarkdown({ cwd: root }, { docxPath: 'raw/manual.docx' })

    expect(result).toMatchObject({ status: 'converted', markdownPath: 'raw/manual.docx.md' })
    const markdown = await readFile(join(root, 'raw', 'manual.docx.md'), 'utf8')
    expect(markdown).toContain('# Procedimentos')
    expect(markdown).toContain('Abrir a porta com cuidado.')
    expect(markdown).toContain('| Passo | Acção |')
    expect(markdown).toContain('| 1 | Confirmar acesso |')
  })

  it('keeps DOCX conversion inside raw and blocks absolute paths and symlink writes', async () => {
    const root = await createSpecialistRoot()
    await writeFile(join(root, 'raw', 'manual.docx'), createDocxBuffer('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Texto suficiente para converter o documento.</w:t></w:r></w:p></w:body></w:document>'))
    await writeFile(join(root, '..', 'outside.md'), 'outside', 'utf8')
    await symlink(join(root, '..', 'outside.md'), join(root, 'raw', 'manual.docx.md'))

    await expect(convertDocxToMarkdown({ cwd: root }, { docxPath: join(root, 'raw', 'manual.docx') })).rejects.toThrow('INVALID_DOCX_INPUT')
    await expect(convertDocxToMarkdown({ cwd: root }, { docxPath: 'raw/manual.docx' })).rejects.toThrow('INVALID_DOCX_INPUT')
    await expect(readFile(join(root, '..', 'outside.md'), 'utf8')).resolves.toBe('outside')
  })

  it('runs DOCX conversion through the pending conversion pipeline', async () => {
    const root = await createSpecialistRoot()
    await writeFile(join(root, 'raw', 'manual.docx'), createDocxBuffer('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Manual de procedimentos com texto suficiente para ingestão.</w:t></w:r></w:p></w:body></w:document>'))
    const specialist = createSpecialist(root)

    const result = await runPendingConversions(specialist, { piConversionEnabled: true })

    expect(result.converted).toBe(1)
    expect(result.failed).toBe(0)
    expect(await readFile(join(root, 'raw', 'manual.docx.md'), 'utf8')).toContain('Manual de procedimentos')
  })
})

async function createSpecialistRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-docx-'))
  await mkdir(join(root, 'raw'), { recursive: true })
  await mkdir(join(root, 'wiki'), { recursive: true })
  await mkdir(join(root, 'ingest'), { recursive: true })
  await writeFile(join(root, 'ingest', 'state.json'), '{}\n', 'utf8')
  return root
}

function createSpecialist(root: string): SpecialistRuntime {
  return {
    id: 'docx-test',
    name: 'DOCX Test',
    description: 'DOCX Test',
    wiki_type: 'legislation-regulatory',
    system_prompt: 'Answer from wiki only.',
    citations_required: true,
    streaming_enabled: true,
    status: 'active',
    company_id: null,
    paths: {
      root,
      config: join(root, 'specialist.yaml'),
      raw: join(root, 'raw'),
      wiki: join(root, 'wiki'),
      ingest: join(root, 'ingest'),
      ingestState: join(root, 'ingest', 'state.json')
    }
  }
}

function createDocxBuffer(documentXml: string): Buffer {
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml.trim(), 'utf8') }
  ]
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + entry.data.length
  }

  const centralDirectoryOffset = offset
  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(centralDirectoryOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, eocd])
}
