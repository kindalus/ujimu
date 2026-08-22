import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { copyTextToClipboard, formatAssistantResponseForClipboard } from '../utils/chat-copy'

describe('assistant response copy acceptance', () => {
  it('formats the assistant response with citations for the clipboard', () => {
    const copiedText = formatAssistantResponseForClipboard({
      text: 'A factura deve conter os elementos obrigatórios indicados na fonte.',
      citations: [
        {
          sourceTitle: 'Regime Jurídico das Facturas',
          sourceFile: 'raw/decreto-presidencial-71-25.pdf',
          articleRefs: ['Artigo 4.º', 'Artigo 5.º']
        }
      ]
    })

    expect(copiedText).toBe([
      'A factura deve conter os elementos obrigatórios indicados na fonte.',
      '',
      'Fontes:',
      '1. Regime Jurídico das Facturas',
      '   Referências: Artigo 4.º, Artigo 5.º'
    ].join('\n'))
  })

  it('writes formatted response text through the Clipboard API boundary', async () => {
    const writes: string[] = []

    await copyTextToClipboard('Resposta\n\nFontes:\n1. Fonte', {
      writeText: async (text: string) => {
        writes.push(text)
      }
    })

    expect(writes).toEqual(['Resposta\n\nFontes:\n1. Fonte'])
  })

  it('exposes copy controls for user questions and completed assistant responses', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('Copiar pergunta')
    expect(page).toContain('copyUserQuestion(item.message)')
    expect(page).toContain('Não foi possível copiar a pergunta.')
    expect(page).toContain('Copiar resposta')
    expect(page).toContain("item.message.role === 'assistant' && item.message.status === 'done'")
    expect(page).toContain('copyAssistantResponse(item.message)')
    expect(page).toContain('Resposta copiada.')
    expect(page).toContain('Não foi possível copiar a resposta.')
    expect(page).not.toContain('<template v-if="citation.sourceFile"> · {{ citation.sourceFile }}</template>')
  })

  it('keeps edit and copy question actions beside the user question as hover-revealed icon buttons with tooltips', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(page).toMatch(/<div class="bubble">\{\{ item\.message\.text \}\}<\/div>[\s\S]*<div class="msg-user-actions">/)
    expect(page).toContain('class="iconbtn msg-edit"')
    expect(page).toContain('title="Editar pergunta"')
    expect(page).toContain('aria-label="Editar pergunta"')
    expect(page).toContain('@click="startEditingQuestion(item.message)"')
    expect(page).toContain('class="iconbtn msg-copy"')
    expect(page).toContain(':title="copiedMessageId === item.message.id ? \'Pergunta copiada\' : \'Copiar pergunta\'"')
    expect(page).toContain('@click="copyUserQuestion(item.message)"')
    expect(page).not.toContain("{{ copiedMessageId === item.message.id ? 'Copiado' : 'Copiar pergunta' }}")
    expect(css).toMatch(/\.msg-user-actions\s*\{[^}]*position:\s*absolute[^}]*display:\s*flex[^}]*opacity:\s*0[^}]*pointer-events:\s*none/)
    expect(css).toContain('.msg--user:hover .msg-user-actions, .msg--user:focus-within .msg-user-actions { opacity: 1; pointer-events: auto; }')
  })
})
