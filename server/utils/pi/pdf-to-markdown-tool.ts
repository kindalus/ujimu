import { spawn } from 'node:child_process'
import { resolveUjimuPiToolPath } from './paths'

export const PDF_TO_MARKDOWN_TOOL_NAME = 'pdf_to_markdown'

export interface CreatePdfToMarkdownToolOptions {
  cwd: string
  scriptPath?: string
}

interface PdfToMarkdownParams {
  pdfPath: string
}

interface PdfToMarkdownResult {
  status: 'converted'
  markdownPath: string
  bytes: number
}

const KNOWN_ERROR_CODES = new Set([
  'INVALID_PDF_INPUT',
  'GEMINI_API_KEY_MISSING',
  'GEMINI_CLI_UNAVAILABLE',
  'GEMINI_CLI_AUTH_FAILED',
  'GEMINI_CONVERSION_FAILED',
  'TIMEOUT_COMMAND_UNAVAILABLE',
  'PDF_TOOL_INVALID_OUTPUT'
])

export function createPdfToMarkdownTool(options: CreatePdfToMarkdownToolOptions): any {
  return {
    name: PDF_TO_MARKDOWN_TOOL_NAME,
    label: 'PDF to Markdown',
    description: 'Convert one PDF under raw/ into faithful Markdown using Gemini CLI. Only available to the Ujimu conversion agent.',
    parameters: {
      type: 'object',
      properties: {
        pdfPath: {
          type: 'string',
          description: 'Relative PDF path under raw/, for example raw/document.pdf.'
        }
      },
      required: ['pdfPath'],
      additionalProperties: false
    },
    async execute(_toolCallId: string, params: PdfToMarkdownParams) {
      const result = await runPdfToMarkdownScript(options, params)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result
      }
    }
  }
}

async function runPdfToMarkdownScript(
  options: CreatePdfToMarkdownToolOptions,
  params: PdfToMarkdownParams
): Promise<PdfToMarkdownResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw createToolError('GEMINI_API_KEY_MISSING', 'GEMINI_API_KEY must be set in the environment.')
  }

  const scriptPath = options.scriptPath ?? resolveUjimuPiToolPath('pdf_to_markdown.sh')
  const result = await runProcess('bash', [scriptPath, params.pdfPath], {
    cwd: options.cwd,
    env: process.env
  })

  if (result.code !== 0) {
    const { code, message } = parseScriptError(result.stderr)
    throw createToolError(code, sanitizeSecret(message))
  }

  try {
    const parsed = JSON.parse(result.stdout) as PdfToMarkdownResult
    if (parsed.status !== 'converted' || typeof parsed.markdownPath !== 'string' || typeof parsed.bytes !== 'number') {
      throw new Error('Unexpected success JSON shape.')
    }
    return {
      status: 'converted',
      markdownPath: parsed.markdownPath,
      bytes: parsed.bytes
    }
  } catch {
    throw createToolError('PDF_TOOL_INVALID_OUTPUT', 'PDF conversion tool returned invalid success JSON.')
  }
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
  })
}

function parseScriptError(stderr: string): { code: string; message: string } {
  const firstLine = stderr.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''
  const match = firstLine.match(/^([A-Z0-9_]+):\s*(.*)$/)
  if (!match) {
    return { code: 'GEMINI_CONVERSION_FAILED', message: 'PDF conversion failed.' }
  }

  const code = KNOWN_ERROR_CODES.has(match[1]) ? match[1] : 'GEMINI_CONVERSION_FAILED'
  return { code, message: match[2] || 'PDF conversion failed.' }
}

function createToolError(code: string, message: string): Error & { code: string } {
  const error = new Error(`${code}: ${message}`) as Error & { code: string }
  error.name = 'PdfToMarkdownToolError'
  error.code = code
  return error
}

function sanitizeSecret(value: string): string {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return value
  }
  return value.split(apiKey).join('[redacted]')
}
