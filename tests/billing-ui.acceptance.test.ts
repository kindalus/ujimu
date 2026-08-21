import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('billing and advertising UI acceptance', () => {
  it('exposes subscription status, checkout actions, and expiry warning on the subscription page', async () => {
    const subscriptionPage = await readFile('pages/subscription.vue', 'utf8')

    expect(subscriptionPage).toContain('/api/billing/status')
    expect(subscriptionPage).toContain('/api/billing/checkout')
    expect(subscriptionPage).toContain('Subscrição')
    expect(subscriptionPage).toContain('50 000,00 AOA')
    expect(subscriptionPage).toContain('10 pedidos/dia · 40/semana (anónimo)')
    expect(subscriptionPage).toContain('40 pedidos/dia · 200/semana (com sessão)')
    expect(subscriptionPage).toContain('class="plans plans--three"')
    expect(subscriptionPage).toContain('Subscrever')
    expect(subscriptionPage).not.toContain('class="pay-method"')
    expect(subscriptionPage).not.toContain('Multicaixa Express')
    expect(subscriptionPage).not.toContain('Referência Multicaixa')
    expect(subscriptionPage).not.toContain('QR Code')
    expect(subscriptionPage).not.toContain('VISA')
    expect(subscriptionPage).not.toContain('Métodos de pagamento')
    expect(subscriptionPage).toContain('A sua subscrição termina em menos de uma semana.')
  })

  it('keeps ad visibility on the chat page without permanent checkout controls', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('/api/billing/status')
    expect(page).toContain('billingStatus.value.ads.visible')
    expect(page).toContain('Publicidade')
    expect(page).not.toContain('/api/billing/checkout')
    expect(page).not.toContain('class="billing-panel"')
    expect(page).not.toContain('Métodos de pagamento')
  })
})
