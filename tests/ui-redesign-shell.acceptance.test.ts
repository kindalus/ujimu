import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const drawerComponentPath = 'components/AppDrawer.vue'

describe('UI redesign shell and drawer acceptance', () => {
  it('defines a Nuxt UI drawer component for existing navigation targets only', async () => {
    expect(existsSync(drawerComponentPath), 'components/AppDrawer.vue must exist for the shared drawer').toBe(true)
    if (!existsSync(drawerComponentPath)) return

    const drawer = await readFile(drawerComponentPath, 'utf8')

    expect(drawer).toContain('<UDrawer')
    expect(drawer).toContain('Chat')
    expect(drawer).toContain('/admin')
    expect(drawer).toContain('/account/security')
    expect(drawer).toContain('/subscription')
    expect(drawer).toContain('Subscrição')
    expect(drawer).toContain('Fixar')
    expect(drawer).toContain('Desafixar')
    expect(drawer).toMatch(/function closeTemporaryDrawer\(\): void \{\s*drawerOpen\.value = false\s*\}/)
    expect(drawer).not.toContain('if (!drawerPinned.value)')
    expect(drawer).toContain('function pinDrawer')
    expect(drawer).toMatch(/function pinDrawer\(\): void \{[\s\S]*drawerPinned\.value = true[\s\S]*drawerOpen\.value = false/)
    expect(drawer).toContain('class="pin-drawer-button"')
    expect(drawer).toMatch(/\.pin-drawer-button\s*\{[\s\S]*display:\s*none/)
    expect(drawer).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*\.pin-drawer-button\s*\{[\s\S]*display:\s*flex/)
    expect(drawer).not.toContain('/admin/specialists')
    expect(drawer).not.toContain('/admin/analytics')
    expect(drawer).not.toContain('/admin/ops')
  })

  it('uses the shared drawer from the main chat page without adding future route placeholders', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('<AppDrawer')
    expect(page).toContain('Abrir navegação')
    expect(page).toContain('/subscription')
    expect(page).not.toContain('/admin/specialists')
    expect(page).not.toContain('/admin/analytics')
    expect(page).not.toContain('/admin/ops')
  })
})
