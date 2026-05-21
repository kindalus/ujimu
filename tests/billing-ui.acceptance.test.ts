import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('billing and advertising UI acceptance', () => {
  it('exposes subscription status, checkout actions, and expiry warning on the subscription page', async () => {
    const subscriptionPage = await readFile('pages/subscription.vue', 'utf8')

    expect(subscriptionPage).toContain('/api/billing/status')
    expect(subscriptionPage).toContain('/api/billing/checkout')
    expect(subscriptionPage).toContain('Subscrição')
    expect(subscriptionPage).toContain('50 000,00 AOA')
    expect(subscriptionPage).toContain('Multicaixa Express')
    expect(subscriptionPage).toContain('Referência Multicaixa')
    expect(subscriptionPage).toContain('QR Code')
    expect(subscriptionPage).toContain('VISA')
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
