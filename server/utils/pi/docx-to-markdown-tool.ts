import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'

export const DOCX_TO_MARKDOWN_TOOL_NAME = 'docx_to_markdown'

export interface CreateDocxToMarkdownToolOptions {
  cwd: string
}

interface DocxToMarkdownParams {
  docxPath: string
}

interface DocxToMarkdownResult {
  status: 'converted'
  markdownPath: string
  bytes: number
}

interface ZipEntry {
  name: string
  compressionMethod: number
  compressedData: Buffer
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50

export function createDocxToMarkdownTool(options: CreateDocxToMarkdownToolOptions): any {
  return {
    name: DOCX_TO_MARKDOWN_TOOL_NAME,
    label: 'DOCX to Markdown',
    description: 'Convert one DOCX under raw/ into Markdown using Ujimu-controlled OpenXML extraction. Only available to the Ujimu conversion agent.',
    parameters: {
      type: 'object',
      properties: {
        docxPath: {
          type: 'string',
          description: 'Relative DOCX path under raw/, for example raw/document.docx.'
        }
      },
      required: ['docxPath'],
      additionalProperties: false
    },
    async execute(_toolCallId: string, params: DocxToMarkdownParams) {
      const result = await convertDocxToMarkdown(options, params)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result
      }
    }
  }
}

export async function convertDocxToMarkdown(
  options: CreateDocxToMarkdownToolOptions,
  params: DocxToMarkdownParams
): Promise<DocxToMarkdownResult> {
  const docxPath = assertValidDocxPath(params.docxPath)
  const rootReal = await realpath(options.cwd)
  const rawRoot = join(rootReal, 'raw')
  const rawRootReal = await realpath(rawRoot)
  const sourcePath = resolve(rootReal, docxPath)
  const sourceReal = await realpath(sourcePath)
  assertInside(rawRootReal, sourceReal)
  if (!(await stat(sourceReal)).isFile()) {
    throw createToolError('INVALID_DOCX_INPUT', 'DOCX input is not a regular file.')
  }

  const markdownPath = `${docxPath}.md`
  const outputPath = resolve(rootReal, markdownPath)
  const outputParentReal = await realpath(dirname(outputPath))
  assertInside(rawRootReal, outputParentReal)
  const existingOutput = await lstat(outputPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existingOutput?.isSymbolicLink()) {
    throw createToolError('INVALID_DOCX_INPUT', 'Refusing to write DOCX Markdown through a symbolic link.')
  }

  const docx = await readFile(sourceReal)
  const documentXml = extractZipText(docx, 'word/document.xml')
  const markdown = openXmlDocumentToMarkdown(documentXml)
  if (markdown.replace(/\s/g, '').length < 20) {
    throw createToolError('DOCX_CONVERSION_FAILED', 'DOCX conversion produced too little text.')
  }

  const tmpPath = join(dirname(outputPath), `.${markdownPath.split('/').at(-1)}.${randomUUID()}.tmp`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(tmpPath, markdown, 'utf8')
  await rename(tmpPath, outputPath).catch(async (error) => {
    await unlink(tmpPath).catch(() => undefined)
    throw error
  })

  return {
    status: 'converted',
    markdownPath,
    bytes: Buffer.byteLength(markdown, 'utf8')
  }
}

function assertValidDocxPath(path: string): string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('raw/') ||
    path.includes('\0') ||
    path.startsWith('~') ||
    path.startsWith('@') ||
    isAbsolute(path) ||
    path.split('/').includes('..') ||
    !path.toLowerCase().endsWith('.docx')
  ) {
    throw createToolError('INVALID_DOCX_INPUT', 'DOCX input must be a relative .docx path under raw/.')
  }

  return path
}

function extractZipText(archive: Buffer, entryName: string): string {
  for (const entry of readLocalZipEntries(archive)) {
    if (entry.name !== entryName) continue
    if (entry.compressionMethod === 0) {
      return entry.compressedData.toString('utf8')
    }
    if (entry.compressionMethod === 8) {
      return inflateRawSync(entry.compressedData).toString('utf8')
    }
    throw createToolError('DOCX_UNSUPPORTED_ZIP_ENTRY', `DOCX entry ${entryName} uses unsupported ZIP compression method ${entry.compressionMethod}.`)
  }

  throw createToolError('DOCX_MISSING_DOCUMENT_XML', 'DOCX is missing word/document.xml.')
}

function readLocalZipEntries(archive: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive)
  if (eocdOffset === undefined) {
    throw createToolError('DOCX_INVALID_ZIP', 'DOCX ZIP central directory was not found.')
  }

  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (centralDirectoryEnd > archive.length) {
    throw createToolError('DOCX_INVALID_ZIP', 'DOCX ZIP central directory is truncated.')
  }

  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  while (offset + 46 <= centralDirectoryEnd) {
    const signature = archive.readUInt32LE(offset)
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) break

    const compressionMethod = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8')
    const localDataStart = readLocalDataStart(archive, localHeaderOffset)
    const localDataEnd = localDataStart + compressedSize
    if (localDataEnd > archive.length) {
      throw createToolError('DOCX_INVALID_ZIP', `DOCX ZIP entry is truncated: ${name}`)
    }

    entries.push({
      name,
      compressionMethod,
      compressedData: archive.subarray(localDataStart, localDataEnd)
    })
    offset = nameStart + nameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(archive: Buffer): number | undefined {
  const minOffset = Math.max(0, archive.length - 65557)
  for (let offset = archive.length - 22; offset >= minOffset; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset
    }
  }
  return undefined
}

function readLocalDataStart(archive: Buffer, localHeaderOffset: number): number {
  if (localHeaderOffset + 30 > archive.length || archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw createToolError('DOCX_INVALID_ZIP', 'DOCX ZIP local header is invalid.')
  }
  const nameLength = archive.readUInt16LE(localHeaderOffset + 26)
  const extraLength = archive.readUInt16LE(localHeaderOffset + 28)
  return localHeaderOffset + 30 + nameLength + extraLength
}

function openXmlDocumentToMarkdown(xml: string): string {
  const body = firstMatch(xml, /<w:body[\s\S]*?<\/w:body>/u) ?? xml
  const blocks: string[] = []
  const blockRegex = /<w:(p|tbl)\b[\s\S]*?<\/w:\1>/gu
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(body))) {
    if (match[1] === 'tbl') {
      const table = convertTable(match[0])
      if (table) blocks.push(table)
      continue
    }

    const paragraph = convertParagraph(match[0])
    if (paragraph) blocks.push(paragraph)
  }

  return `${blocks.join('\n\n').replace(/\n{3,}/gu, '\n\n').trim()}\n`
}

function convertParagraph(xml: string): string {
  const text = extractParagraphText(xml)
  if (!text) return ''
  const headingLevel = paragraphHeadingLevel(xml)
  if (headingLevel) {
    return `${'#'.repeat(headingLevel)} ${text}`
  }
  if (paragraphStyle(xml)?.toLowerCase().includes('list')) {
    return `- ${text}`
  }
  return text
}

function convertTable(xml: string): string {
  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)]
    .map((row) => [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)]
      .map((cell) => extractParagraphText(cell[0]).replace(/\|/gu, '\\|'))
      .filter((cell) => cell.length > 0))
    .filter((row) => row.length > 0)

  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalizedRows = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')])
  const header = normalizedRows[0]
  const separator = Array.from({ length: width }, () => '---')
  const bodyRows = normalizedRows.slice(1)
  return [header, separator, ...bodyRows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

function extractParagraphText(xml: string): string {
  const parts: string[] = []
  const tokenRegex = /<w:(t|tab|br)\b([^>]*)>([\s\S]*?)<\/w:\1>|<w:(tab|br)\b[^/]*\/>/gu
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(xml))) {
    const token = match[1] ?? match[4]
    if (token === 't') parts.push(unescapeXml(match[3] ?? ''))
    if (token === 'tab') parts.push('\t')
    if (token === 'br') parts.push('\n')
  }
  return parts.join('').replace(/[ \t]+/gu, ' ').replace(/\s*\n\s*/gu, '\n').trim()
}

function paragraphHeadingLevel(xml: string): number | undefined {
  const style = paragraphStyle(xml)?.toLowerCase()
  if (!style) return undefined
  const match = style.match(/heading(\d)|ttulo(\d)|titulo(\d)/u)
  const level = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? '')
  return Number.isFinite(level) && level >= 1 && level <= 6 ? level : undefined
}

function paragraphStyle(xml: string): string | undefined {
  return firstMatch(xml, /<w:pStyle\b[^>]*w:val="([^"]+)"/u)
}

function firstMatch(value: string, regex: RegExp): string | undefined {
  return value.match(regex)?.[1] ?? value.match(regex)?.[0]
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
}

function assertInside(parent: string, child: string): void {
  const resolvedParent = resolve(parent)
  const resolvedChild = resolve(child)
  const result = relative(resolvedParent, resolvedChild)
  if (result === '' || (!!result && !result.startsWith('..') && !isAbsolute(result))) return
  throw createToolError('INVALID_DOCX_INPUT', 'DOCX path escapes the raw directory.')
}

function createToolError(code: string, message: string): Error & { code: string } {
  const error = new Error(`${code}: ${message}`) as Error & { code: string }
  error.name = 'DocxToMarkdownToolError'
  error.code = code
  return error
}
