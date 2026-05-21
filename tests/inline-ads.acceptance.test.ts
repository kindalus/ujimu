import { describe, expect, it } from 'vitest'
import {
  INLINE_AD_MAX_ASSISTANT_RESPONSES,
  INLINE_AD_MIN_ASSISTANT_RESPONSES,
  buildInlineAdStreamItems,
  createInlineAdInterval,
  extendInlineAdSchedule
} from '../utils/inline-ads'

describe('inline advertising schedule acceptance', () => {
  it('generates assistant-response intervals between five and ten responses', () => {
    expect(INLINE_AD_MIN_ASSISTANT_RESPONSES).toBe(5)
    expect(INLINE_AD_MAX_ASSISTANT_RESPONSES).toBe(10)
    expect(createInlineAdInterval(() => 0)).toBe(5)
    expect(createInlineAdInterval(() => -1)).toBe(5)
    expect(createInlineAdInterval(() => 0.9999)).toBe(10)
    expect(createInlineAdInterval(() => 1)).toBe(10)
  })

  it('places inert ad items only after scheduled completed assistant responses when ads are visible', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: `assistant-${index + 1}`,
      role: 'assistant' as const,
      status: 'done' as const
    }))
    const schedule = extendInlineAdSchedule([], 12, () => 0)

    expect(schedule).toEqual([5, 10, 15])

    const visibleItems = buildInlineAdStreamItems(messages, schedule, true)
    expect(visibleItems.filter((item) => item.type === 'ad').map((item) => item.afterAssistantResponse)).toEqual([5, 10])
    expect(visibleItems[5]).toMatchObject({ type: 'ad', afterMessageId: 'assistant-5' })
    expect(visibleItems[11]).toMatchObject({ type: 'ad', afterMessageId: 'assistant-10' })

    const hiddenItems = buildInlineAdStreamItems(messages, schedule, false)
    expect(hiddenItems.every((item) => item.type === 'message')).toBe(true)
  })

  it('does not count user, streaming, or error messages as completed assistant responses', () => {
    const messages = [
      { id: 'user-1', role: 'user' as const, status: 'done' as const },
      { id: 'assistant-1', role: 'assistant' as const, status: 'streaming' as const },
      { id: 'assistant-2', role: 'assistant' as const, status: 'error' as const },
      { id: 'assistant-3', role: 'assistant' as const, status: 'done' as const }
    ]

    const items = buildInlineAdStreamItems(messages, [1], true)

    expect(items.filter((item) => item.type === 'ad')).toEqual([
      expect.objectContaining({ afterMessageId: 'assistant-3', afterAssistantResponse: 1 })
    ])
  })
})
