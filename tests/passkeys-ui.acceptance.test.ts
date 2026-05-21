import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('passkey UI acceptance', () => {
  it('exposes passkey sign-in and account-security management entry points', async () => {
    const mainPage = await readFile('pages/index.vue', 'utf8')
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')
    const authModal = await readFile('components/AuthModal.vue', 'utf8')
    const shellSources = `${mainPage}\n${drawer}\n${authModal}`

    expect(shellSources).toContain('Entrar com passkey')
    expect(shellSources).toContain('Segurança da conta')
    expect(shellSources).toContain('/account/security')
    expect(shellSources).toContain('/api/auth/passkeys/authentication/options')
    expect(shellSources).toContain('/api/auth/passkeys/authentication/verify')
  })

  it('provides a dedicated account-security page for adding, listing, and removing passkeys', async () => {
    const securityPage = await readFile('pages/account/security.vue', 'utf8')

    expect(securityPage).toContain('/api/auth/session')
    expect(securityPage).toContain('/api/auth/passkeys')
    expect(securityPage).toContain('/api/auth/passkeys/registration/options')
    expect(securityPage).toContain('/api/auth/passkeys/registration/verify')
    expect(securityPage).toContain('Segurança da conta')
    expect(securityPage).toContain('Adicionar passkey')
    expect(securityPage).toContain('Remover')
    expect(securityPage).toContain('Pode continuar a entrar com código por email ou telemóvel.')
    expect(securityPage).toContain('Volte a entrar por código para adicionar uma passkey.')
    expect(securityPage).toContain('Este dispositivo ou navegador não suporta passkeys.')
  })
})
