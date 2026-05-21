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
    expect(page).toContain('aria-label="Subscrição e publicidade"')
  })

  it('opens authentication as an on-demand Nuxt UI modal instead of a permanent panel', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('<UModal')
    expect(page).toContain('v-model:open="authPanelOpen"')
    expect(page).toContain('class="auth-modal"')
    expect(page).toContain('class="auth-form"')
    expect(page).toContain('@open-auth="authPanelOpen = true"')
    expect(page).toContain('Entrar com passkey')
    expect(page).toContain('Telemóvel')
  })
})
