import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ChatRequestError, validateChatRequestBody } from '../server/utils/chat/request'

describe('regenerate last response acceptance', () => {
  it('requires a conversation and keeps regeneration distinct from editing', () => {
    expect(() => validateChatRequestBody({ specialistId: 'iva', question: 'Q', regenerateLast: true })).toThrow(ChatRequestError)
    expect(() => validateChatRequestBody({ specialistId: 'iva', question: 'Q', conversationId: 'c', regenerateLast: true, replaceFromMessageId: 'm' })).toThrow(ChatRequestError)
    expect(validateChatRequestBody({ specialistId: 'iva', question: 'Q', conversationId: 'c', regenerateLast: true })).toMatchObject({
      conversationId: 'c', regenerateLast: true
    })
  })

  it('shows Refazer only on the latest completed response and submits the explicit intent', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    expect(page).toContain('latestCompletedAssistantMessageId')
    expect(page).toContain("@click=\"regenerateLastResponse(item.message)\"")
    expect(page).toContain('class="iconbtn regenerate-response"')
    expect(page).toContain('title="Refazer resposta"')
    expect(page).toContain('aria-label="Refazer resposta"')
    expect(page).not.toContain('<UjimuIcon name="refresh" /> Refazer')
    expect(page).toContain('regenerateLast: true')
    expect(page).toContain('const previousMessages = [...messages.value]')
  })
})
