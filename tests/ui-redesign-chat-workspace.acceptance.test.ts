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

  it('presents the prompt as a Gemini-style bottom composer', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('class="composer gemini-prompt"')
    expect(page).toContain('prompt-specialist-row')
    expect(page).toContain('prompt-plus-button')
    expect(page).toContain('prompt-specialist-control')
    expect(page).toContain('prompt-mic-button')
    expect(page).toContain('prompt-submit')
    expect(page).not.toContain('<label for="specialist-select">Especialidade</label>')
    expect(page).not.toContain(':disabled="isStreaming || specialistsPending || !hasSpecialists"')
    expect(page).toMatch(/<UChatPrompt[\s\S]*:rows="1"[\s\S]*autoresize[\s\S]*<template #header>[\s\S]*prompt-specialist-row[\s\S]*<USelect[\s\S]*prompt-specialist-control[\s\S]*:disabled="isStreaming \|\| specialistsPending"[\s\S]*<template #footer>[\s\S]*prompt-toolbar[\s\S]*prompt-plus-button[\s\S]*prompt-mic-button[\s\S]*<UChatPromptSubmit[\s\S]*prompt-submit/)
    expect(page).toMatch(/\.workspace\s*\{[\s\S]*align-items:\s*start/)
    expect(page).toMatch(/\.chat-panel\s*\{[\s\S]*height:\s*calc\(100dvh - 128px\)/)
    expect(page).toMatch(/\.messages\s*\{[\s\S]*min-height:\s*0/)
  })
})
