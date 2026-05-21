import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const subscriptionPagePath = 'pages/subscription.vue'

describe('UI redesign subscription page acceptance', () => {
  it('moves billing management to /subscription and leaves chat without permanent billing panels', async () => {
    expect(existsSync(subscriptionPagePath), 'pages/subscription.vue must exist for subscription management').toBe(true)
    if (!existsSync(subscriptionPagePath)) return

    const subscriptionPage = await readFile(subscriptionPagePath, 'utf8')
    const chatPage = await readFile('pages/index.vue', 'utf8')
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')

    expect(subscriptionPage).toContain('/api/billing/status')
    expect(subscriptionPage).toContain('/api/billing/checkout')
    expect(subscriptionPage).toContain('Plano trimestral — 50 000,00 AOA')
    expect(subscriptionPage).toContain('Multicaixa Express')
    expect(subscriptionPage).toContain('Referência Multicaixa')
    expect(subscriptionPage).toContain('QR Code')
    expect(subscriptionPage).toContain('VISA')
    expect(subscriptionPage).toContain('A sua subscrição termina em menos de uma semana.')
    expect(subscriptionPage).toContain('<AuthModal')
    expect(subscriptionPage).toContain('authPanelOpen')

    expect(drawer).toContain('to="/subscription"')
    expect(drawer).toContain('Subscrição')

    expect(chatPage).not.toContain('class="billing-panel"')
    expect(chatPage).not.toContain('/api/billing/checkout')
    expect(chatPage).not.toContain('Métodos de pagamento')
    expect(chatPage).not.toContain('Plano trimestral — 50 000,00 AOA')
    expect(chatPage).toContain('billingStatus.value.ads.visible')
    expect(chatPage).toContain('Publicidade')
  })

  it('keeps OTP and passkey authentication available through the shared on-demand modal', async () => {
    expect(existsSync('components/AuthModal.vue'), 'components/AuthModal.vue must host shared on-demand authentication').toBe(true)
    if (!existsSync('components/AuthModal.vue')) return

    const authModal = await readFile('components/AuthModal.vue', 'utf8')

    expect(authModal).toContain('<UModal')
    expect(authModal).toContain('/api/auth/otp/request')
    expect(authModal).toContain('/api/auth/otp/verify')
    expect(authModal).toContain('/api/auth/passkeys/authentication/options')
    expect(authModal).toContain('/api/auth/passkeys/authentication/verify')
    expect(authModal).toContain('Entrar com passkey')
    expect(authModal).toContain('Telemóvel')
  })
})
