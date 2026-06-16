import { describe, expect, it } from 'vitest'
import { formatChatResponseMetrics } from '../utils/chat-metrics'

describe('chat response metrics acceptance', () => {
  it('formats elapsed response time and token totals for the latest answer footer', () => {
    expect(formatChatResponseMetrics({ durationMs: 3200, totalTokens: 1248 })).toBe('3,2 s · 1 248 tokens')
  })

  it('omits token text when no reliable token total is available', () => {
    expect(formatChatResponseMetrics({ durationMs: 3200 })).toBe('3,2 s')
    expect(formatChatResponseMetrics({ durationMs: 3200, totalTokens: 0 })).toBe('3,2 s')
  })
})
