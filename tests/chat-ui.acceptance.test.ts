import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('anonymous specialist chat UI acceptance', () => {
  it('exposes specialist selection, AI notice, citation area, and a visible pending-question queue', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('/api/specialists')
    expect(page).toContain('/api/chat')
    expect(page).toContain('Conteúdo gerado por IA. Pode conter erros. Confirme sempre a resposta nas fontes citadas. As respostas não substituem aconselhamento profissional.')
    expect(page).toContain('Ainda não há especialidades disponíveis. Volte mais tarde.')
    expect(page).toContain('Fila de perguntas')
    expect(page).toContain('queueLimit = 3')
    expect(page).toContain('Subir')
    expect(page).toContain('Descer')
    expect(page).toContain('Remover')
    expect(page).toContain('Fontes')
    expect(page).toContain(':disabled="!canSubmitQuestion"')
  })
})
