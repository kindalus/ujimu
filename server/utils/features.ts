export interface LaunchFeatures {
  subscriptionsEnabled: boolean
  companiesEnabled: boolean
}

export function resolveLaunchFeatures(
  env: Record<string, string | undefined> = process.env
): LaunchFeatures {
  return {
    subscriptionsEnabled: env.UJIMU_SUBSCRIPTIONS_ENABLED === 'true',
    companiesEnabled: env.UJIMU_COMPANIES_ENABLED === 'true'
  }
}
