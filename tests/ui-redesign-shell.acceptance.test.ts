import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const drawerComponentPath = 'components/AppDrawer.vue'

describe('UI redesign shell and drawer acceptance', () => {
  it('uses the prototype fixed scrim/aside drawer instead of a generic Nuxt UI drawer', async () => {
    expect(existsSync(drawerComponentPath), 'components/AppDrawer.vue must exist for the shared drawer').toBe(true)
    if (!existsSync(drawerComponentPath)) return

    const drawer = await readFile(drawerComponentPath, 'utf8')

    expect(drawer).toContain('class="scrim"')
    expect(drawer).toContain("'scrim--on': drawerOpen")
    expect(drawer).toContain('class="drawer"')
    expect(drawer).toContain("'drawer--open': drawerOpen")
    expect(drawer).toContain('class="drawer-head"')
    expect(drawer).toContain('class="btn btn--new"')
    expect(drawer).toContain('class="drawer-scroll"')
    expect(drawer).toContain('class="drawer-foot"')
    expect(drawer).toContain('class="drawer-user"')
    expect(drawer).toContain('Nova consulta')
    expect(drawer).toContain('newConversation')
    expect(drawer).toContain('temporaryDrawerContent.value?.contains(document.activeElement)')
    expect(drawer).toContain('@click="startNewConversation"')
    expect(drawer).toContain('O meu perfil')
    expect(drawer).toContain('/admin')
    expect(drawer).toContain('/subscription')
    expect(drawer).toContain('Subscrição')
    expect(drawer).toContain('Terminar sessão')
    expect(drawer).not.toContain('<UDrawer')
    expect(drawer).not.toContain('drawer--nuxt')
    expect(drawer).not.toContain('mock-drawer-content')
    expect(drawer).not.toContain('Fixar')
    expect(drawer).not.toContain('Desafixar')
    expect(drawer).not.toContain('pinDrawer')
    expect(drawer).not.toContain('/admin/specialists')
    expect(drawer).not.toContain('/admin/analytics')
    expect(drawer).not.toContain('/admin/ops')
    expect(drawer).not.toContain('/account/security')
    expect(drawer).not.toContain('/companies')
  })

  it('uses the shared prototype shell from chat and route chrome without future route placeholders', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const routeChrome = await readFile('components/MockRouteChrome.vue', 'utf8')

    expect(page).toContain('<AppDrawer')
    expect(page).toContain('Abrir menu')
    expect(page).toContain('@new-conversation="startNewConversation"')
    expect(page).toContain('function startNewConversation')
    expect(page).toContain('activeChatAbortController.value?.abort()')
    expect(page).toContain('class="topbar"')
    expect(page).toContain('class="quota-pill"')
    expect(page).toContain('/subscription')
    expect(routeChrome).toContain('<AppDrawer')
    expect(routeChrome).toContain('0/{{ authSession.authenticated ? 20 : 5 }} hoje')
    expect(routeChrome).not.toContain('Consulta</span>')
    expect(page).not.toContain('/admin/specialists')
    expect(page).not.toContain('/admin/analytics')
    expect(page).not.toContain('/admin/ops')
  })
})
