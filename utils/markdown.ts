import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize, defaultSchema)
  .use(rehypeStringify)

export function renderMarkdownToSafeHtml(markdown: string): string {
  const input = markdown.trim()
  if (!input) return ''

  return String(markdownProcessor.processSync(input))
}
