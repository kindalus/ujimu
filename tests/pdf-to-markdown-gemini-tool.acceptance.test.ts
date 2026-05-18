import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(process.cwd(), '.pi', 'tools', 'pdf_to_markdown.sh')

describe('PDF to Markdown Gemini tool acceptance', () => {
  it('converts a raw PDF through gemini stdout, writes Markdown atomically, and returns metadata only', async () => {
    const workspace = await createPdfWorkspace('Documento.PDF')
    const fakeBin = await createFakeGeminiBin({ mode: 'success' })

    const result = await runPdfTool(workspace.root, ['raw/Documento.PDF'], {
      PATH: `${fakeBin.bin}:${process.env.PATH ?? ''}`,
      GEMINI_API_KEY: 'test-gemini-api-key'
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('# Documento')
    const payload = JSON.parse(result.stdout) as { status: string; markdownPath: string; bytes: number }
    expect(payload).toMatchObject({ status: 'converted', markdownPath: 'raw/Documento.PDF.md' })
    expect(payload.bytes).toBeGreaterThan(20)

    const markdown = await readFile(join(workspace.root, 'raw', 'Documento.PDF.md'), 'utf8')
    expect(markdown.trim()).toMatch(/^# Documento/)
    expect(markdown.trim()).not.toMatch(/^```markdown/)
    expect(markdown).toContain('Texto convertido com conteúdo suficiente.')

    const geminiArgs = await readNullSeparatedArgs(fakeBin.geminiLog)
    expect(geminiArgs[0]).toBe('-y')
    expect(geminiArgs[1]).toBe('-p')
    expect(geminiArgs.at(-1)).toBe('raw/Documento.PDF')
    expect(geminiArgs[2]).toContain('raw/Documento.PDF.md')
    expect(geminiArgs[2].toLowerCase()).toContain('stdout')
    expect(geminiArgs[2].toLowerCase()).toContain('markdown')

    const timeoutArgs = await readNullSeparatedArgs(fakeBin.timeoutLog)
    expect(timeoutArgs[0]).toBe('600s')
    expect(timeoutArgs[1]).toBe('gemini')
  })

  it('rejects invalid PDF inputs before invoking gemini', async () => {
    const workspace = await createPdfWorkspace('lei.pdf')
    await writeFile(join(workspace.root, 'raw', 'not-a-pdf.txt'), 'texto')
    const fakeBin = await createFakeGeminiBin({ mode: 'success' })

    const result = await runPdfTool(workspace.root, ['raw/not-a-pdf.txt'], {
      PATH: `${fakeBin.bin}:${process.env.PATH ?? ''}`,
      GEMINI_API_KEY: 'test-gemini-api-key'
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('INVALID_PDF_INPUT')
    expect(existsSync(fakeBin.geminiLog)).toBe(false)
    expect(existsSync(join(workspace.root, 'raw', 'not-a-pdf.txt.md'))).toBe(false)
  })

  it('requires GEMINI_API_KEY before invoking gemini', async () => {
    const workspace = await createPdfWorkspace('lei.pdf')
    const fakeBin = await createFakeGeminiBin({ mode: 'success' })
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${fakeBin.bin}:${process.env.PATH ?? ''}` }
    delete env.GEMINI_API_KEY

    const result = await runPdfTool(workspace.root, ['raw/lei.pdf'], env)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('GEMINI_API_KEY_MISSING')
    expect(existsSync(fakeBin.geminiLog)).toBe(false)
  })

  it('redacts GEMINI_API_KEY from gemini failure messages', async () => {
    const workspace = await createPdfWorkspace('lei.pdf')
    const fakeBin = await createFakeGeminiBin({ mode: 'auth-failure' })
    const secret = 'fake-secret-key-that-must-not-leak'

    const result = await runPdfTool(workspace.root, ['raw/lei.pdf'], {
      PATH: `${fakeBin.bin}:${process.env.PATH ?? ''}`,
      GEMINI_API_KEY: secret
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('GEMINI_CLI_AUTH_FAILED')
    expect(result.stderr).not.toContain(secret)
    expect(existsSync(join(workspace.root, 'raw', 'lei.pdf.md'))).toBe(false)
  })

  it('exposes pdf_to_markdown only to conversion Pi sessions', async () => {
    const sessionModule = await import('../server/utils/pi/session') as any

    expect(sessionModule.createUjimuCustomToolsForTask).toBeTypeOf('function')
    const conversionTools = await sessionModule.createUjimuCustomToolsForTask('conversion')
    const ingestionTools = await sessionModule.createUjimuCustomToolsForTask('ingestion')
    const chatTools = await sessionModule.createUjimuCustomToolsForTask('chat')

    expect(conversionTools.map((tool: { name: string }) => tool.name)).toContain('pdf_to_markdown')
    expect(ingestionTools.map((tool: { name: string }) => tool.name)).not.toContain('pdf_to_markdown')
    expect(chatTools.map((tool: { name: string }) => tool.name)).not.toContain('pdf_to_markdown')
  })
})

async function createPdfWorkspace(fileName: string): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-pdf-tool-'))
  await mkdir(join(root, 'raw'), { recursive: true })
  await writeFile(join(root, 'raw', fileName), Buffer.from('%PDF-1.7\nplaceholder pdf bytes'))
  return { root }
}

async function createFakeGeminiBin(options: { mode: 'success' | 'auth-failure' }): Promise<{
  bin: string
  geminiLog: string
  timeoutLog: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-fake-gemini-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const geminiLog = join(root, 'gemini.args')
  const timeoutLog = join(root, 'timeout.args')

  await writeFile(join(bin, 'timeout'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" > "${timeoutLog}"
if [ "$1" != "600s" ]; then
  echo "unexpected timeout: $1" >&2
  exit 94
fi
shift
exec "$@"
`)
  await writeFile(join(bin, 'gemini'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" > "${geminiLog}"
if [ "${options.mode}" = "auth-failure" ]; then
  echo "authentication failed for $GEMINI_API_KEY" >&2
  exit 7
fi
cat <<'MARKDOWN'
\`\`\`markdown
# Documento

Texto convertido com conteúdo suficiente.
\`\`\`
MARKDOWN
`)
  await chmod(join(bin, 'timeout'), 0o755)
  await chmod(join(bin, 'gemini'), 0o755)

  return { bin, geminiLog, timeoutLog }
}

async function runPdfTool(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn('bash', [SCRIPT_PATH, ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve)
  })
  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

async function readNullSeparatedArgs(path: string): Promise<string[]> {
  await stat(path)
  const raw = await readFile(path)
  return raw.toString('utf8').split('\0').filter(Boolean)
}
