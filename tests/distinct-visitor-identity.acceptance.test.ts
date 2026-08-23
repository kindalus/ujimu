import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('distinct visitor identity acceptance', () => {
  it('links the active browser cookie after authentication and explains the anonymous estimate', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const analytics = await readFile('pages/admin/analytics.vue', 'utf8')
    expect(page).toMatch(/function handleAuthenticatedSession[\s\S]*recordVisit\(\)/)
    expect(analytics).toContain('estimados por browser')
  })

  it('uses account-linked cookie clusters without collecting IP or fingerprints', async () => {
    const visitors = await readFile('server/utils/analytics/visitors.ts', 'utf8')
    expect(visitors).toContain('linked_user_id')
    expect(visitors).not.toMatch(/user[_-]?agent|fingerprint|client[_-]?ip/i)
  })
})
