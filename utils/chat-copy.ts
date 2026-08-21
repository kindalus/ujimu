export interface ClipboardCitation {
  sourceTitle: string
  sourceFile?: string
  articleRefs: string[]
}

export interface ClipboardAssistantResponse {
  text: string
  citations: ClipboardCitation[]
}

export interface ClipboardWriter {
  writeText(text: string): Promise<void>
}

export function formatAssistantResponseForClipboard(response: ClipboardAssistantResponse): string {
  const answer = response.text.trim()
  const citations = response.citations
    .map(formatCitationForClipboard)
    .filter((citation) => citation.length > 0)

  if (citations.length === 0) {
    return answer
  }

  return [answer, '', 'Fontes:', ...citations].join('\n')
}

export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard
): Promise<void> {
  if (!clipboard) {
    throw new Error('Clipboard API unavailable.')
  }

  await clipboard.writeText(text)
}

function formatCitationForClipboard(citation: ClipboardCitation, index: number): string {
  const title = citation.sourceTitle.trim()
  if (!title) return ''

  const lines = [`${index + 1}. ${title}`]
  const articleRefs = citation.articleRefs.map((articleRef) => articleRef.trim()).filter(Boolean)

  if (articleRefs.length > 0) {
    lines.push(`   Referências: ${articleRefs.join(', ')}`)
  }

  return lines.join('\n')
}
