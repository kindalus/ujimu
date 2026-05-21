import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('UI redesign history and auth drawer acceptance', () => {
  it('moves conversation history into the app drawer and removes permanent auth/history side panels', async () => {
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')
    const page = await readFile('pages/index.vue', 'utf8')

    expect(drawer).toContain('<slot name="history"')
    expect(drawer).toContain(':close="closeTemporaryDrawer"')
    expect(drawer).toContain('aria-haspopup="dialog"')
    expect(drawer).toContain('ref="temporaryDrawerContent"')
    expect(drawer).toContain('focusTemporaryDrawerStart')
    expect(page).toContain('<template #history')
    expect(page).toContain('class="drawer-history-panel"')
    expect(page).toContain('historyConversations')
    expect(page).toContain('@click="openConversationFromDrawer(conversation.id, close)"')
    expect(page).toContain('@click="deleteHistoryConversation(conversation.id)"')
    expect(page).not.toContain('class="history-panel"')
    expect(page).not.toContain('class="auth-panel"')
    expect(page).toContain('aria-label="Publicidade"')
  })

  it('opens authentication as an on-demand Nuxt UI modal instead of a permanent panel', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const authModal = await readFile('components/AuthModal.vue', 'utf8')

    expect(page).toContain('<AuthModal')
    expect(page).toContain('v-model:open="authPanelOpen"')
    expect(authModal).toContain('<UModal')
    expect(authModal).toContain('class="auth-modal"')
    expect(authModal).toContain('class="auth-form"')
    expect(page).toContain('@open-auth="authPanelOpen = true"')
    expect(authModal).toContain('Entrar com passkey')
    expect(authModal).toContain('Telemóvel')
  })
})
