import type { BillingPaymentMethod, BillingProvider } from '../subscriptions'

export interface MockCheckoutDetails {
  providerReference: string
  checkoutUrl: string
  instructions: string
}

export function createMockCheckoutDetails(input: {
  paymentId: string
  provider: BillingProvider
  method: BillingPaymentMethod
}): MockCheckoutDetails {
  const providerReference = `mock-${input.provider}-${input.paymentId}`

  return {
    providerReference,
    checkoutUrl: `mock://billing/${input.provider}/${input.paymentId}`,
    instructions: resolveInstructions(input.provider, input.method, providerReference)
  }
}

function resolveInstructions(
  provider: BillingProvider,
  method: BillingPaymentMethod,
  providerReference: string
): string {
  if (provider === 'stripe') {
    return `Confirme o pagamento VISA de teste com a referência ${providerReference}.`
  }

  if (method === 'multicaixa_express') {
    return `Confirme o pagamento Multicaixa Express de teste com a referência ${providerReference}.`
  }

  if (method === 'multicaixa_reference') {
    return `Use a referência Multicaixa de teste ${providerReference}.`
  }

  return `Use o QR Code de teste associado à referência ${providerReference}.`
}
