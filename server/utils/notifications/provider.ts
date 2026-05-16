export type OtpDeliveryChannel = 'email' | 'phone'

export interface OtpDeliveryRequest {
  channel: OtpDeliveryChannel
  contact: string
  code: string
}

export interface NotificationProvider {
  deliverOtp(request: OtpDeliveryRequest): Promise<void>
}

export class NotificationProviderConfigurationError extends Error {
  public readonly code = 'NOTIFICATION_PROVIDER_NOT_CONFIGURED'

  constructor(message = 'OTP delivery provider is not configured.') {
    super(message)
    this.name = 'NotificationProviderConfigurationError'
  }
}

export function createNotificationProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): NotificationProvider {
  const fakeEnabled = env.UJIMU_AUTH_FAKE_DELIVERY_ENABLED === 'true'
  const isProduction = env.NODE_ENV === 'production'

  if (fakeEnabled && !isProduction) {
    return {
      async deliverOtp() {
        // Fake delivery intentionally does not log OTP codes; tests inject providers that capture codes.
      }
    }
  }

  return {
    async deliverOtp() {
      throw new NotificationProviderConfigurationError()
    }
  }
}
