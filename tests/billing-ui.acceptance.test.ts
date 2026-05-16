import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('billing and advertising UI acceptance', () => {
  it('exposes subscription status, checkout actions, expiry warning, and ad visibility rules on the main page', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('/api/billing/status')
    expect(page).toContain('/api/billing/checkout')
    expect(page).toContain('Subscrição')
    expect(page).toContain('50 000,00 AOA')
    expect(page).toContain('Multicaixa Express')
    expect(page).toContain('Referência Multicaixa')
    expect(page).toContain('QR Code')
    expect(page).toContain('VISA')
    expect(page).toContain('A sua subscrição termina em menos de uma semana.')
    expect(page).toContain('billingStatus.ads.visible')
    expect(page).toContain('Publicidade')
  })
})
