import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('UI redesign inline ads acceptance', () => {
  it('renders ads as inert items inside the chat message stream instead of a side panel', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('chatStreamItems')
    expect(page).toContain('inlineAdSchedule')
    expect(page).toContain('buildInlineAdStreamItems')
    expect(page).toContain('billingStatus.value.ads.visible')
    expect(page).toContain('class="inline-ad-card"')
    expect(page).toContain('Publicidade')
    expect(page).toContain('300 × 250')
    expect(page).not.toContain('class="ad-panel"')
    expect(page).not.toContain('class="ads-section"')
  })

  it('keeps citations inside assistant messages and outside inline advertising cards', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    const citationIndex = page.indexOf('class="citations"')
    const inlineAdIndex = page.indexOf('class="inline-ad-card"')

    expect(citationIndex).toBeGreaterThan(-1)
    expect(inlineAdIndex).toBeGreaterThan(-1)
    expect(page).toContain('item.message.role === \'assistant\' && item.message.citations.length > 0')
    expect(page).toContain('item.type === \'ad\'')
  })
})
