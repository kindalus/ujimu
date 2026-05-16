export interface QuotaExceededLimitDetail {
  limit: number
  used: number
  resetAt: string
}

export interface QuotaExceededPayload {
  code: 'QUOTA_EXCEEDED'
  message: string
  limits: {
    daily?: QuotaExceededLimitDetail
    weekly?: QuotaExceededLimitDetail
  }
}

export class QuotaExceededError extends Error {
  public readonly statusCode = 429

  constructor(public readonly payload: QuotaExceededPayload) {
    super(payload.message)
    this.name = 'QuotaExceededError'
  }
}
