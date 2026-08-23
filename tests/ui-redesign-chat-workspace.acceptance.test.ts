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

  it('updates streamed chat turns through reactive message references', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('const reactiveUserMessage = userMessage')
    expect(page).toContain('const reactiveAssistantMessage = assistantMessage')
    expect(page).toContain('await readChatStream(response, reactiveAssistantMessage, reactiveUserMessage, responseStartedAt)')
    expect(page).not.toContain('await readChatStream(response, assistantMessage, userMessage)')
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

  it('caps the chat composer textarea at five visible lines before scrolling', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(page).toContain('const chatInputMaxRows = 5')
    expect(page).toContain('const questionTextarea = ref<HTMLTextAreaElement | null>(null)')
    expect(page).toContain('watch(question')
    expect(page).toContain('resizeQuestionTextarea')
    expect(page).toContain('calculateQuestionTextareaMaxHeight')
    expect(page).toContain('ref="questionTextarea"')
    expect(page).toContain('@keydown.enter.exact.prevent="submitQuestion"')
    expect(css).toContain('max-height: 8.75rem')
    expect(css).toContain('overflow-y: hidden')
  })

  it('shows response metrics only on the latest completed assistant response in memory', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain("import { formatChatResponseMetrics } from '../utils/chat-metrics'")
    expect(page).toContain('responseMetrics?: ChatResponseMetrics')
    expect(page).toContain('const latestResponseMetricMessageId = computed')
    expect(page).toContain('function responseMetricsLabel(message: ChatUiMessage): string')
    expect(page).toContain('formatChatResponseMetrics(message.responseMetrics)')
    expect(page).toContain('responseStartedAt')
    expect(page).toContain("event.type === 'metrics'")
    expect(page).toContain('performance.now()')
    expect(page).toContain('class="ai-note response-metrics"')
    expect(page).toContain('{{ responseMetricsLabel(item.message) }}')
  })

  it('uses an opaque specialist dropdown and clips specialist descriptions to 256 characters', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(page).toContain('const specialistDescriptionPreviewLimit = 256')
    expect(page).toContain('function specialistDescriptionPreview(description: string): string')
    expect(page).toContain('description.length <= specialistDescriptionPreviewLimit')
    expect(page).toContain('description.slice(0, specialistDescriptionPreviewLimit - 1).trimEnd()')
    expect(page).toContain('<span class="spec-card-short" :title="specialist.description">{{ specialistDescriptionPreview(specialist.description) }}</span>')
    expect(page).toContain('<span class="spec-opt-short" :title="specialist.description">{{ specialistDescriptionPreview(specialist.description) }}</span>')
    expect(css).toContain('background: var(--surface-solid)')
    expect(css).toContain('backdrop-filter: none')
    expect(css).toContain('grid-template-columns: 34px minmax(0, 1fr)')
    expect(css).toContain('.spec-card .spec-chip-letter')
    expect(css).toContain('-webkit-line-clamp: 3')
    expect(css).toContain('-webkit-line-clamp: 2')
    expect(css).toContain('overflow-wrap: anywhere')
  })
})
