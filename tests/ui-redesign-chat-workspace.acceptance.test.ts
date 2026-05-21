import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('UI redesign chat workspace acceptance', () => {
  it('uses Nuxt UI chat primitives with a parts-based Ujimu message adapter', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('<UChatMessages')
    expect(page).toContain('<UChatMessage')
    expect(page).toContain('<UChatPrompt')
    expect(page).toContain('<UChatPromptSubmit')
    expect(page).toContain('const chatUiMessages = computed')
    expect(page).toContain("parts: [{ type: 'text'")
    expect(page).toContain('chatStatus')
  })

  it('starts in the chat workspace without the old hero and keeps specialist choice in the prompt', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).not.toContain('class="hero-panel"')
    expect(page).not.toContain('Consulte especialistas com respostas citadas.')
    expect(page).toMatch(/<UChatPrompt[\s\S]*<USelect[\s\S]*v-model="selectedSpecialistId"/)
    expect(page).toMatch(/<UChatPrompt[\s\S]*<UChatPromptSubmit[\s\S]*:disabled="!canSubmitQuestion"/)
    expect(page).toContain('selectedSpecialist?.name')
    expect(page).toContain('selectedSpecialist?.description')
    expect(page).toContain('Conteúdo gerado por IA. Pode conter erros. Confirme sempre a resposta nas fontes citadas. As respostas não substituem aconselhamento profissional.')
  })
})
