export type QuotaSubjectType = 'anonymous' | 'registered' | 'subscribed' | 'company'

export type QuotaSubject =
  | { type: Exclude<QuotaSubjectType, 'company'>; id: string }
  | { type: 'company'; id: string; seats: number }

export interface QuotaPolicy {
  dailyLimit: number | null
  weeklyLimit: number
}

export interface ResolveQuotaPolicyInput {
  subjectType: QuotaSubjectType
}

export interface ResolveQuotaPolicyOptions {
  subscribedWeeklyLimit?: number
  companySeats?: number
  env?: Record<string, string | undefined>
}

const DEFAULT_SUBSCRIBED_WEEKLY_LIMIT = 5000

export function resolveQuotaPolicy(
  input: ResolveQuotaPolicyInput,
  options: ResolveQuotaPolicyOptions = {}
): QuotaPolicy {
  if (input.subjectType === 'anonymous') {
    return { dailyLimit: 10, weeklyLimit: 40 }
  }

  if (input.subjectType === 'registered') {
    return { dailyLimit: 40, weeklyLimit: 200 }
  }

  if (input.subjectType === 'company') {
    return {
      dailyLimit: null,
      weeklyLimit: resolveCompanyWeeklyLimit(options)
    }
  }

  return {
    dailyLimit: null,
    weeklyLimit: resolveSubscribedWeeklyLimit(options)
  }
}

function resolveCompanyWeeklyLimit(options: ResolveQuotaPolicyOptions): number {
  const seats = Number.isFinite(options.companySeats) ? Math.max(0, Math.floor(options.companySeats ?? 0)) : 0
  return seats * resolveSubscribedWeeklyLimit(options)
}

function resolveSubscribedWeeklyLimit(options: ResolveQuotaPolicyOptions): number {
  if (typeof options.subscribedWeeklyLimit === 'number' && Number.isFinite(options.subscribedWeeklyLimit)) {
    return Math.max(0, Math.floor(options.subscribedWeeklyLimit))
  }

  const raw = (options.env ?? process.env).UJIMU_SUBSCRIBED_WEEKLY_LIMIT
  const parsed = raw ? Number.parseInt(raw, 10) : NaN

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SUBSCRIBED_WEEKLY_LIMIT
}
