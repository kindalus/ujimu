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
      '   Referências: Artigo 4.º, Artigo 5.º',
      '   Ficheiro: raw/decreto-presidencial-71-25.pdf'
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

  it('exposes copy controls only for completed assistant responses', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('Copiar resposta')
    expect(page).toContain("item.message.role === 'assistant' && item.message.status === 'done'")
    expect(page).toContain('copyAssistantResponse(item.message)')
    expect(page).toContain('Resposta copiada.')
    expect(page).toContain('Não foi possível copiar a resposta.')
    expect(page).not.toContain('Copiar pergunta')
  })
})
