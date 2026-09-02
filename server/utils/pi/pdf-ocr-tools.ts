import { spawn } from 'node:child_process'
import { resolveUjimuPiToolPath } from './paths'

export const PREPARE_PDF_OCR_TOOL_NAME = 'prepare_pdf_ocr'
export const RENDER_PDF_OCR_PAGE_TOOL_NAME = 'render_pdf_ocr_page'

interface CreatePdfOcrToolsOptions {
  cwd: string
  scriptPath?: string
}

const KNOWN_ERROR_CODES = new Set([
  'INVALID_PDF_INPUT',
  'PDF_OCR_WORKSPACE_INVALID',
  'PDF_OCR_DEPENDENCY_MISSING',
  'PDF_OCR_INVALID_PDF',
  'PDF_OCR_PREPARATION_FAILED',
  'PDF_OCR_OUTPUT_INVALID',
  'PDF_OCR_NOT_PREPARED',
  'PDF_OCR_PAGE_OUT_OF_RANGE',
  'PDF_OCR_PAGE_RENDER_FAILED'
])

export function createPdfOcrTools(options: CreatePdfOcrToolsOptions): any[] {
  return [
    {
      name: PREPARE_PDF_OCR_TOOL_NAME,
      label: 'Prepare PDF OCR',
      description: 'Validate and prepare one PDF under raw/ with local Portuguese and English OCR.',
      parameters: pdfPathParameters(),
      async execute(_toolCallId: string, params: { pdfPath: string }) {
        return toolResult(await runPdfOcrScript(options, ['prepare', params.pdfPath]))
      }
    },
    {
      name: RENDER_PDF_OCR_PAGE_TOOL_NAME,
      label: 'Render PDF OCR page',
      description: 'Render one prepared PDF page at 300 DPI and extract its local OCR text.',
      parameters: {
        type: 'object',
        properties: {
          pdfPath: { type: 'string', description: 'Relative PDF path under raw/.' },
          page: { type: 'integer', minimum: 1, description: 'One-based PDF page number.' }
        },
        required: ['pdfPath', 'page'],
        additionalProperties: false
      },
      async execute(_toolCallId: string, params: { pdfPath: string; page: number }) {
        return toolResult(await runPdfOcrScript(options, ['page', params.pdfPath, String(params.page)]))
      }
    }
  ]
}

function pdfPathParameters(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      pdfPath: { type: 'string', description: 'Relative PDF path under raw/.' }
    },
    required: ['pdfPath'],
    additionalProperties: false
  }
}

function toolResult(details: unknown): { content: Array<{ type: 'text'; text: string }>; details: unknown } {
  return {
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details
  }
}

async function runPdfOcrScript(
  options: CreatePdfOcrToolsOptions,
  args: string[]
): Promise<unknown> {
  const scriptPath = options.scriptPath ?? resolveUjimuPiToolPath('pdf_ocr.sh')
  const result = await runProcess('bash', [scriptPath, ...args], options.cwd)
  if (result.code !== 0) {
    const { code, message } = parseScriptError(result.stderr)
    throw createToolError(code, message)
  }

  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    throw createToolError('PDF_OCR_OUTPUT_INVALID', 'Local PDF OCR returned invalid output.')
  }
}

function runProcess(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
  })
}

function parseScriptError(stderr: string): { code: string; message: string } {
  const line = stderr.split('\n').find(value => value.trim())?.trim() ?? ''
  const match = /^([A-Z0-9_]+):\s*(.*)$/u.exec(line)
  return {
    code: match && KNOWN_ERROR_CODES.has(match[1]) ? match[1] : 'PDF_OCR_PREPARATION_FAILED',
    message: match?.[2] || 'Local PDF OCR failed.'
  }
}

function createToolError(code: string, message: string): Error & { code: string } {
  const error = new Error(`${code}: ${message}`) as Error & { code: string }
  error.name = 'PdfOcrToolError'
  error.code = code
  return error
}
