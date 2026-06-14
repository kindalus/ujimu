import type { IngestionSourceRecord } from '../ingestion/types'
import type { ChatCitation } from './types'

const MAX_CITATION_TEXT_LENGTH = 240
const MAX_ARTICLE_REFS = 20

export function isUsableCitationSource(source: IngestionSourceRecord): boolean {
  return (
    (source.status === 'ingested' || source.ingestion?.status === 'ingested') &&
    source.raw_path.trim().length > 0 &&
    (source.ingestion?.citations?.length ?? 0) > 0
  )
}

export function sourceToChatCitations(source: IngestionSourceRecord): ChatCitation[] {
  return (source.ingestion?.citations ?? []).map((citation) => ({
    sourceTitle: citation.source_title.trim(),
    sourceFile: citation.source_file.trim(),
    articleRefs: citation.article_refs.map((articleRef) => articleRef.trim()).filter(Boolean)
  }))
}

export function sourceToChatCitation(source: IngestionSourceRecord): ChatCitation {
  return sourceToChatCitations(source)[0] ?? {
    sourceTitle: source.title.trim(),
    sourceFile: `raw/${source.raw_path}`,
    articleRefs: source.article_refs.map((articleRef) => articleRef.trim()).filter(Boolean)
  }
}

export function normalizeChatCitation(citation: ChatCitation): ChatCitation | undefined {
  const sourceTitle = truncate(citation.sourceTitle.trim(), MAX_CITATION_TEXT_LENGTH)
  const sourceFile = citation.sourceFile?.trim()
  const articleRefs = citation.articleRefs
    .map((articleRef) => truncate(articleRef.trim(), MAX_CITATION_TEXT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_ARTICLE_REFS)

  if (!sourceTitle || articleRefs.length === 0) {
    return undefined
  }

  return {
    sourceTitle,
    ...(sourceFile ? { sourceFile: truncate(sourceFile, MAX_CITATION_TEXT_LENGTH) } : {}),
    articleRefs
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value
}
