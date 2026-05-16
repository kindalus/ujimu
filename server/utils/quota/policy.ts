export type QuotaSubjectType = 'anonymous' | 'registered' | 'subscribed'

export interface QuotaSubject {
  type: QuotaSubjectType
  id: string
}

export interface QuotaPolicy {
  dailyLimit: number | null
  weeklyLimit: number
}

export interface ResolveQuotaPolicyInput {
  subjectType: QuotaSubjectType
}

export interface ResolveQuotaPolicyOptions {
  subscribedWeeklyLimit?: number
  env?: Record<string, string | undefined>
}

const DEFAULT_SUBSCRIBED_WEEKLY_LIMIT = 5000

export function resolveQuotaPolicy(
  input: ResolveQuotaPolicyInput,
  options: ResolveQuotaPolicyOptions = {}
): QuotaPolicy {
  if (input.subjectType === 'anonymous') {
    return { dailyLimit: 5, weeklyLimit: 20 }
  }

  if (input.subjectType === 'registered') {
    return { dailyLimit: 20, weeklyLimit: 100 }
  }

  return {
    dailyLimit: null,
    weeklyLimit: resolveSubscribedWeeklyLimit(options)
  }
}

function resolveSubscribedWeeklyLimit(options: ResolveQuotaPolicyOptions): number {
  if (typeof options.subscribedWeeklyLimit === 'number' && Number.isFinite(options.subscribedWeeklyLimit)) {
    return Math.max(0, Math.floor(options.subscribedWeeklyLimit))
  }

  const raw = (options.env ?? process.env).UJIMU_SUBSCRIBED_WEEKLY_LIMIT
  const parsed = raw ? Number.parseInt(raw, 10) : NaN

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SUBSCRIBED_WEEKLY_LIMIT
}
