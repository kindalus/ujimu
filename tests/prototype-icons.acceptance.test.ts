import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('prototype icon port acceptance', () => {
  it('uses the prototype inline SVG icon set on ported surfaces', async () => {
    const icon = await readFile('components/UjimuIcon.vue', 'utf8')
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')
    const authModal = await readFile('components/AuthModal.vue', 'utf8')
    const chatPage = await readFile('pages/index.vue', 'utf8')
    const adminPage = await readFile('pages/admin/index.vue', 'utf8')
    const portedSurfaces = `${drawer}\n${authModal}\n${chatPage}\n${adminPage}`

    expect(icon).toContain('stroke-width="1.8"')
    expect(icon).toContain('M5 12 L20 5 L14 20 L11.5 13.5 L5 12 Z')
    expect(icon).toContain('M12 4 L13.8 10.2 L20 12 L13.8 13.8 L12 20 L10.2 13.8 L4 12 L10.2 10.2 Z')
    expect(icon).toContain('M7 3 H14 L19 8 V21 H7 Z')
    expect(icon).toContain('M4.5 20 C5.5 16 8.5 14.5 12 14.5 C15.5 14.5 18.5 16 19.5 20')

    expect(portedSurfaces).toContain('<UjimuIcon name="menu"')
    expect(portedSurfaces).toContain('<UjimuIcon name="send"')
    expect(portedSurfaces).toContain('<UjimuIcon name="doc"')
    expect(portedSurfaces).toContain('<UjimuIcon name="trash"')
    expect(portedSurfaces).toContain('<UjimuIcon :name="copiedMessageId === item.message.id ? \'check\' : \'copy\'"')
    expect(portedSurfaces).not.toContain('<UIcon')
    expect(portedSurfaces).not.toContain('i-lucide')
  })
})
