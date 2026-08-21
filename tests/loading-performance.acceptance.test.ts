import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('measured loading performance acceptance', () => {
  it('defers the authentication modal until a user opens it', async () => {
    const home = await readFile('pages/index.vue', 'utf8')
    const routeChrome = await readFile('components/MockRouteChrome.vue', 'utf8')

    for (const shell of [home, routeChrome]) {
      expect(shell).toContain('<LazyAuthModal')
      expect(shell).toContain('v-if="authPanelOpen"')
      expect(shell).not.toContain('<AuthModal')
    }
  })

  it('does not request or propagate an unused admin session from application shells', async () => {
    const home = await readFile('pages/index.vue', 'utf8')
    const routeChrome = await readFile('components/MockRouteChrome.vue', 'utf8')
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')

    for (const shell of [home, routeChrome]) {
      expect(shell).not.toContain("fetch('/api/admin/session')")
      expect(shell).not.toContain('adminAvailable')
      expect(shell).not.toContain(':admin-available=')
    }
    expect(drawer).not.toContain('adminAvailable')
  })
})
