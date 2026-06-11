import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createPdfToMarkdownTool, PDF_TO_MARKDOWN_TOOL_NAME } from '../../../server/utils/pi/pdf-to-markdown-tool'

export { createPdfToMarkdownTool, PDF_TO_MARKDOWN_TOOL_NAME }

export default function pdfToMarkdownToolExtension(_pi: ExtensionAPI) {
  // Intentionally do not auto-register this tool from Ujimu Pi agent extension discovery.
  // Ujimu exposes pdf_to_markdown only through createUjimuCustomToolsForTask('conversion')
  // so ingestion, chat, and generic Pi sessions cannot call it.
}
