import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(process.cwd(), 'config', 'pi', 'tools', 'pdf_ocr.sh')

describe('local PDF OCR foundation acceptance', () => {
  it('prepares a validated por+eng OCR workspace without Gemini or publication', async () => {
    const fixture = await createFixture()
    const original = await readFile(join(fixture.root, 'raw', 'lei.pdf'))

    const result = await runScript(fixture.root, ['prepare', 'raw/lei.pdf'], fixture.bin)

    expect(result).toMatchObject({ code: 0, stderr: '' })
    const payload = JSON.parse(result.stdout) as Record<string, unknown>
    const hash = createHash('sha256').update(original).digest('hex')
    expect(payload).toEqual({
      status: 'prepared',
      sourceSha256: `sha256:${hash}`,
      pageCount: 2,
      normalizedPdfPath: `.ujimu/ocr/${hash}/normalized.pdf`,
      extractedTextPath: `.ujimu/ocr/${hash}/document.txt`
    })
    await expect(readFile(join(fixture.root, 'raw', 'lei.pdf'))).resolves.toEqual(original)
    await expect(stat(join(fixture.root, '.ujimu', 'ocr', hash, 'normalized.pdf'))).resolves.toMatchObject({ mode: expect.any(Number) })
    expect(existsSync(join(fixture.root, 'converted'))).toBe(false)
    expect(existsSync(join(fixture.root, 'wiki'))).toBe(false)

    const calls = await readFile(fixture.log, 'utf8')
    expect(calls).toContain('qpdf --check')
    expect(calls).toContain('ocrmypdf --skip-text --rotate-pages --deskew -l por+eng')
    expect(calls).toContain('pdftotext -layout')
    expect(calls).not.toContain('gemini')
  })

  it('renders exactly one bounded page at 300 DPI and replaces the current artefacts', async () => {
    const fixture = await createFixture()
    await runScript(fixture.root, ['prepare', 'raw/lei.pdf'], fixture.bin)

    const first = await runScript(fixture.root, ['page', 'raw/lei.pdf', '1'], fixture.bin)
    const firstPayload = JSON.parse(first.stdout) as Record<string, unknown>
    expect(firstPayload).toMatchObject({ status: 'rendered', page: 1, pageCount: 2 })
    expect(firstPayload.overviewPath).toMatch(/\/current\/overview\.png$/)
    expect(firstPayload.ocrTextPath).toMatch(/\/current\/page\.txt$/)
    expect(firstPayload.overviewSha256).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(firstPayload.tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: expect.stringMatching(/\/current\/tiles\/tile-\d{4}\.png$/),
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    ]))

    const second = await runScript(fixture.root, ['page', 'raw/lei.pdf', '2'], fixture.bin)
    expect(second.code).toBe(0)
    const calls = await readFile(fixture.log, 'utf8')
    expect(calls).toContain('pdftoppm -f 1 -l 1 -singlefile -r 300 -png')
    expect(calls).toContain('pdftoppm -f 2 -l 2 -singlefile -r 300 -png')
    expect(await readFile(join(fixture.root, String(firstPayload.ocrTextPath)), 'utf8')).toContain('page 2')

    const outside = await runScript(fixture.root, ['page', 'raw/lei.pdf', '3'], fixture.bin)
    expect(outside.code).not.toBe(0)
    expect(outside.stderr).toContain('PDF_OCR_PAGE_OUT_OF_RANGE')
  })

  it('rejects traversal and symlink inputs before invoking PDF processors', async () => {
    const fixture = await createFixture()
    const outside = join(fixture.root, 'outside.pdf')
    await writeFile(outside, '%PDF outside')
    await symlink(outside, join(fixture.root, 'raw', 'linked.pdf'))

    for (const path of ['../outside.pdf', 'raw/linked.pdf', 'raw/not-pdf.txt']) {
      const result = await runScript(fixture.root, ['prepare', path], fixture.bin)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('INVALID_PDF_INPUT')
    }
    expect(existsSync(fixture.log)).toBe(false)

    const escapedWorkspace = await mkdtemp(join(tmpdir(), 'ujimu-escaped-ocr-'))
    await symlink(escapedWorkspace, join(fixture.root, '.ujimu'))
    const escaped = await runScript(fixture.root, ['prepare', 'raw/lei.pdf'], fixture.bin)
    expect(escaped.code).not.toBe(0)
    expect(escaped.stderr).toContain('PDF_OCR_WORKSPACE_INVALID')
    expect(existsSync(join(escapedWorkspace, 'ocr'))).toBe(false)
  })

  it('exposes OCR preparation tools only to ingestion sessions', async () => {
    const { createUjimuCustomToolsForTask } = await import('../server/utils/pi/session')

    const ingestion = createUjimuCustomToolsForTask('ingestion').map((tool: { name: string }) => tool.name)
    const conversion = createUjimuCustomToolsForTask('conversion').map((tool: { name: string }) => tool.name)

    expect(ingestion).toEqual(expect.arrayContaining(['prepare_pdf_ocr', 'render_pdf_ocr_page']))
    expect(conversion).not.toContain('prepare_pdf_ocr')
    expect(conversion).not.toContain('render_pdf_ocr_page')
    expect(createUjimuCustomToolsForTask('chat')).toEqual([])
    expect(createUjimuCustomToolsForTask('derivation')).toEqual([])
  })
})

async function createFixture(): Promise<{ root: string; bin: string; log: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-local-ocr-'))
  const bin = join(root, 'bin')
  const log = join(root, 'calls.log')
  await mkdir(join(root, 'raw'), { recursive: true })
  await mkdir(bin)
  await writeFile(join(root, 'raw', 'lei.pdf'), '%PDF-1.7\nscanned pages')
  await writeFile(join(root, 'raw', 'not-pdf.txt'), 'not pdf')

  await fakeCommand(bin, 'qpdf', `printf 'qpdf %s\\n' "$*" >> '${log}'`)
  await fakeCommand(bin, 'pdfinfo', `printf 'pdfinfo %s\\n' "$*" >> '${log}'; printf 'Pages:          2\\n'`)
  await fakeCommand(bin, 'ocrmypdf', `
printf 'ocrmypdf %s\\n' "$*" >> '${log}'
args=("$@"); count=$((\${#args[@]})); cp "\${args[$((count-2))]}" "\${args[$((count-1))]}"
`)
  await fakeCommand(bin, 'pdftotext', `
printf 'pdftotext %s\\n' "$*" >> '${log}'
args=("$@"); count=$((\${#args[@]})); output="\${args[$((count-1))]}"; page='all'
for ((i=0; i<count; i++)); do if [ "\${args[$i]}" = '-f' ]; then page="\${args[$((i+1))]}"; fi; done
printf 'OCR text page %s\\n' "$page" > "$output"
`)
  await fakeCommand(bin, 'pdftoppm', `
printf 'pdftoppm %s\\n' "$*" >> '${log}'
args=("$@"); count=$((\${#args[@]})); prefix="\${args[$((count-1))]}"
python3 - "\${prefix}.png" <<'PY'
from PIL import Image
import sys
Image.new('RGB', (2480, 3508), 'white').save(sys.argv[1])
PY
`)
  return { root, bin, log }
}

async function fakeCommand(bin: string, name: string, body: string): Promise<void> {
  const path = join(bin, name)
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`)
  await chmod(path, 0o755)
}

async function runScript(
  cwd: string,
  args: string[],
  bin: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn('bash', [SCRIPT_PATH, ...args], {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
  })
}
