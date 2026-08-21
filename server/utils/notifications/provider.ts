export type OtpDeliveryChannel = 'email' | 'phone'

export interface OtpDeliveryRequest {
  channel: OtpDeliveryChannel
  contact: string
  code: string
}

export interface NotificationProvider {
  deliverOtp(request: OtpDeliveryRequest): Promise<void>
  verifyOtp?(request: OtpDeliveryRequest): Promise<boolean>
}

export type OtpProviderMode = 'direct' | 'twilio-verify' | 'disabled'

export interface OtpDeliveryCapabilities {
  otpChannels: OtpDeliveryChannel[]
}

interface NotificationProviderOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

export class NotificationProviderConfigurationError extends Error {
  public readonly code = 'NOTIFICATION_PROVIDER_NOT_CONFIGURED'

  constructor(message = 'OTP delivery provider is not configured.') {
    super(message)
    this.name = 'NotificationProviderConfigurationError'
  }
}

export class NotificationProviderDeliveryError extends Error {
  public readonly code = 'NOTIFICATION_PROVIDER_DELIVERY_FAILED'

  constructor() {
    super('OTP delivery failed.')
    this.name = 'NotificationProviderDeliveryError'
  }
}

export function resolveOtpProviderMode(
  env: Record<string, string | undefined> = process.env
): OtpProviderMode {
  const configured = env.UJIMU_OTP_PROVIDER?.trim()
  if (!configured || configured === 'direct') return 'direct'
  if (configured === 'twilio-verify') return 'twilio-verify'
  return 'disabled'
}

export function getOtpDeliveryCapabilities(
  env: Record<string, string | undefined> = process.env
): OtpDeliveryCapabilities {
  const mode = resolveOtpProviderMode(env)
  if (mode === 'disabled') return { otpChannels: [] }
  if (mode === 'twilio-verify') {
    return { otpChannels: twilioVerifyConfig(env) ? ['phone'] : [] }
  }
  if (fakeDeliveryEnabled(env)) {
    return { otpChannels: ['email', 'phone'] }
  }

  const otpChannels: OtpDeliveryChannel[] = []
  if (sendGridConfig(env)) otpChannels.push('email')
  if (twilioConfig(env)) otpChannels.push('phone')
  return { otpChannels }
}

export function createNotificationProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: NotificationProviderOptions = {}
): NotificationProvider {
  const mode = resolveOtpProviderMode(env)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000

  if (mode === 'twilio-verify') {
    const verify = twilioVerifyConfig(env)
    if (!verify) return unconfiguredProvider()
    return {
      async deliverOtp(request) {
        if (request.channel !== 'phone') throw new NotificationProviderConfigurationError()
        await startTwilioVerification(fetchImpl, verify, request.contact, timeoutMs)
      },
      async verifyOtp(request) {
        if (request.channel !== 'phone') throw new NotificationProviderConfigurationError()
        return checkTwilioVerification(fetchImpl, verify, request.contact, request.code, timeoutMs)
      }
    }
  }

  if (mode === 'disabled') return unconfiguredProvider()
  if (fakeDeliveryEnabled(env)) return { async deliverOtp() {} }

  const sendGrid = sendGridConfig(env)
  const twilio = twilioConfig(env)
  return {
    async deliverOtp(request) {
      if (request.channel === 'email' && sendGrid) {
        await sendWithSendGrid(fetchImpl, sendGrid, request, timeoutMs)
        return
      }

      if (request.channel === 'phone' && twilio) {
        await sendWithTwilio(fetchImpl, twilio, request, timeoutMs)
        return
      }

      throw new NotificationProviderConfigurationError()
    }
  }
}

function unconfiguredProvider(): NotificationProvider {
  return {
    async deliverOtp() {
      throw new NotificationProviderConfigurationError()
    }
  }
}

function fakeDeliveryEnabled(env: Record<string, string | undefined>): boolean {
  return env.UJIMU_AUTH_FAKE_DELIVERY_ENABLED === 'true' && env.NODE_ENV !== 'production'
}

function sendGridConfig(env: Record<string, string | undefined>): {
  apiKey: string
  fromEmail: string
  fromName: string
} | undefined {
  const apiKey = env.UJIMU_SENDGRID_API_KEY?.trim()
  const fromEmail = env.UJIMU_SENDGRID_FROM_EMAIL?.trim()
  if (!apiKey || !fromEmail) return undefined
  return { apiKey, fromEmail, fromName: env.UJIMU_SENDGRID_FROM_NAME?.trim() || 'Ujimu' }
}

function twilioVerifyConfig(env: Record<string, string | undefined>): {
  accountSid: string
  authToken: string
  serviceSid: string
} | undefined {
  const accountSid = env.UJIMU_TWILIO_ACCOUNT_SID?.trim()
  const authToken = env.UJIMU_TWILIO_AUTH_TOKEN?.trim()
  const serviceSid = env.UJIMU_TWILIO_VERIFY_SERVICE_SID?.trim()
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken || !serviceSid || !/^VA[0-9a-f]{32}$/i.test(serviceSid)) {
    return undefined
  }
  return { accountSid, authToken, serviceSid }
}

function twilioConfig(env: Record<string, string | undefined>): {
  accountSid: string
  authToken: string
  fromPhone: string
} | undefined {
  const accountSid = env.UJIMU_TWILIO_ACCOUNT_SID?.trim()
  const authToken = env.UJIMU_TWILIO_AUTH_TOKEN?.trim()
  const fromPhone = env.UJIMU_TWILIO_FROM_PHONE?.trim()
  if (!accountSid || !authToken || !fromPhone) return undefined
  return { accountSid, authToken, fromPhone }
}

async function sendWithSendGrid(
  fetchImpl: typeof globalThis.fetch,
  config: NonNullable<ReturnType<typeof sendGridConfig>>,
  request: OtpDeliveryRequest,
  timeoutMs: number
): Promise<void> {
  await sendRequest(fetchImpl, 'https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: request.contact }] }],
      from: { email: config.fromEmail, name: config.fromName },
      subject: 'Código de acesso Ujimu',
      content: [{ type: 'text/plain', value: otpMessage(request.code) }]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  })
}

async function sendWithTwilio(
  fetchImpl: typeof globalThis.fetch,
  config: NonNullable<ReturnType<typeof twilioConfig>>,
  request: OtpDeliveryRequest,
  timeoutMs: number
): Promise<void> {
  const body = new URLSearchParams({
    To: request.contact,
    From: config.fromPhone,
    Body: otpMessage(request.code)
  })
  await sendRequest(
    fetchImpl,
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs)
    }
  )
}

async function startTwilioVerification(
  fetchImpl: typeof globalThis.fetch,
  config: NonNullable<ReturnType<typeof twilioVerifyConfig>>,
  contact: string,
  timeoutMs: number
): Promise<void> {
  const response = await twilioVerifyRequest(fetchImpl, config, 'Verifications', {
    To: contact,
    Channel: 'sms'
  }, timeoutMs)
  const payload = await readProviderJson(response)
  if (!response.ok || readVerifyStatus(payload) !== 'pending') {
    throw new NotificationProviderDeliveryError()
  }
}

async function checkTwilioVerification(
  fetchImpl: typeof globalThis.fetch,
  config: NonNullable<ReturnType<typeof twilioVerifyConfig>>,
  contact: string,
  code: string,
  timeoutMs: number
): Promise<boolean> {
  const response = await twilioVerifyRequest(fetchImpl, config, 'VerificationCheck', {
    To: contact,
    Code: code
  }, timeoutMs)
  if (response.status === 400 || response.status === 404) return false
  const status = readVerifyStatus(await readProviderJson(response))
  if (!response.ok || !status) throw new NotificationProviderDeliveryError()
  return status === 'approved'
}

async function twilioVerifyRequest(
  fetchImpl: typeof globalThis.fetch,
  config: NonNullable<ReturnType<typeof twilioVerifyConfig>>,
  resource: 'Verifications' | 'VerificationCheck',
  fields: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  return fetchImpl(
    `https://verify.twilio.com/v2/Services/${config.serviceSid}/${resource}`,
    {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    }
  ).catch(() => {
    throw new NotificationProviderDeliveryError()
  })
}

async function readProviderJson(response: Response): Promise<unknown> {
  return response.json().catch(() => {
    throw new NotificationProviderDeliveryError()
  })
}

function readVerifyStatus(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const status = (payload as { status?: unknown }).status
  if (typeof status !== 'string') return undefined
  return ['pending', 'approved', 'canceled', 'max_attempts_reached', 'deleted', 'failed', 'expired'].includes(status)
    ? status
    : undefined
}

async function sendRequest(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit
): Promise<void> {
  const response = await fetchImpl(url, init).catch(() => {
    throw new NotificationProviderDeliveryError()
  })
  if (!response.ok) {
    throw new NotificationProviderDeliveryError()
  }
}

function otpMessage(code: string): string {
  return `O seu código de acesso Ujimu é ${code}. Expira em 10 minutos.`
}
