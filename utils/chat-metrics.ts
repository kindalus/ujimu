export interface ChatResponseMetrics {
  durationMs: number
  totalTokens?: number
}

export function formatChatResponseMetrics(metrics: ChatResponseMetrics): string {
  const duration = `${formatDurationSeconds(metrics.durationMs)} s`
  const totalTokens = normalizePositiveInteger(metrics.totalTokens)

  if (!totalTokens) {
    return duration
  }

  return `${duration} · ${formatIntegerWithSpaces(totalTokens)} tokens`
}

function formatDurationSeconds(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
  return (safeDurationMs / 1000).toFixed(1).replace('.', ',')
}

function formatIntegerWithSpaces(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ')
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}
