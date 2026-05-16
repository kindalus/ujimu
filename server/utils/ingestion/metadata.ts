import { basename, extname } from 'node:path'

const ARTICLE_PATTERN = /\bArt(?:igo|\.)\s*\d+[.ºª]*/giu

export function inferSourceTitle(relativePath: string, content?: string): string {
  if (content) {
    const lines = content.split(/\r?\n/).map((line) => line.trim())
    const heading = lines.find((line) => line.startsWith('#') && line.replace(/^#+\s*/, '').length > 0)

    if (heading) {
      return heading.replace(/^#+\s*/, '').trim()
    }

    const firstLine = lines.find((line) => line.length > 0)
    if (firstLine) {
      return firstLine
    }
  }

  const filename = basename(relativePath, extname(relativePath))
  return filename.replace(/[-_]+/g, ' ').trim() || relativePath
}

export function extractArticleRefs(content: string): string[] {
  const matches = content.match(ARTICLE_PATTERN) ?? []
  return [...new Set(matches.map((match) => match.trim()))]
}
