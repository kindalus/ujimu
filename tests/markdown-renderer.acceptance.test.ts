import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { renderMarkdownToSafeHtml } from '../utils/markdown'

describe('chat Markdown rendering acceptance', () => {
  it('renders assistant Markdown blocks used by specialist answers', () => {
    const html = renderMarkdownToSafeHtml(`## Resumo

- **Obrigação** principal
- Artigo 1.º

| Fonte | Artigo |
| --- | --- |
| Código | 1.º |`)

    expect(html).toContain('<h2>Resumo</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li><strong>Obrigação</strong> principal</li>')
    expect(html).toContain('<li>Artigo 1.º</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Fonte</th>')
    expect(html).toContain('<td>1.º</td>')
  })

  it('escapes unsafe HTML and refuses javascript links before v-html rendering', () => {
    const html = renderMarkdownToSafeHtml('Texto <img src=x onerror=alert(1)> [abrir](javascript:alert(1)) `const x = "<ok>"`')

    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('<a>abrir</a>')
    expect(html).toContain('<code>const x = "&#x3C;ok>"</code>')
  })

  it('uses the safe Markdown renderer and restores Markdown presentation after the global CSS reset', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(page).toContain("import { renderMarkdownToSafeHtml } from '../utils/markdown'")
    expect(page).toContain('function renderAssistantMessageHtml')
    expect(page).toContain('v-html="renderAssistantMessageHtml(item.message)"')
    expect(css).toMatch(/\.assistant-markdown ul\s*\{[^}]*list-style:\s*disc/)
    expect(css).toMatch(/\.assistant-markdown ol\s*\{[^}]*list-style:\s*decimal/)
    expect(css).toMatch(/\.assistant-markdown h2\s*\{[^}]*font-size:\s*var\(--fs-read\)[^}]*font-weight:\s*600/)
  })
})
