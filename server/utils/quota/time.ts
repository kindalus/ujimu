export interface QuotaWindow {
  startAtUtc: Date
  resetAtUtc: Date
}

export interface QuotaWindows {
  timezone: string
  daily: QuotaWindow
  weekly: QuotaWindow
}

const DEFAULT_TIMEZONE = 'Africa/Luanda'

export function normalizeTimezone(timezone: string | undefined | null): string {
  if (!timezone || typeof timezone !== 'string') {
    return DEFAULT_TIMEZONE
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return timezone
  } catch {
    return DEFAULT_TIMEZONE
  }
}

export function resolveQuotaWindows(now: Date, timezoneInput: string | undefined | null): QuotaWindows {
  const timezone = normalizeTimezone(timezoneInput)
  const parts = getZonedParts(now, timezone)

  const dailyStart = zonedTimeToUtc(timezone, parts.year, parts.month, parts.day)
  const nextDay = addLocalDays(parts.year, parts.month, parts.day, 1)
  const dailyReset = zonedTimeToUtc(timezone, nextDay.year, nextDay.month, nextDay.day)

  const dayOfWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  const daysSinceMonday = (dayOfWeek + 6) % 7
  const weekStart = addLocalDays(parts.year, parts.month, parts.day, -daysSinceMonday)
  const weekReset = addLocalDays(weekStart.year, weekStart.month, weekStart.day, 7)

  return {
    timezone,
    daily: {
      startAtUtc: dailyStart,
      resetAtUtc: dailyReset
    },
    weekly: {
      startAtUtc: zonedTimeToUtc(timezone, weekStart.year, weekStart.month, weekStart.day),
      resetAtUtc: zonedTimeToUtc(timezone, weekReset.year, weekReset.month, weekReset.day)
    }
  }
}

function getZonedParts(date: Date, timezone: string): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  const values: Record<string, string> = {}

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = part.value
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  }
}

function zonedTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  let utc = localAsUtc

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimezoneOffsetMs(timezone, new Date(utc))
    const nextUtc = localAsUtc - offset

    if (Math.abs(nextUtc - utc) < 1) {
      return new Date(nextUtc)
    }

    utc = nextUtc
  }

  return new Date(utc)
}

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  const parts = getZonedParts(date, timezone)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds()
  )

  return localAsUtc - date.getTime()
}

function addLocalDays(year: number, month: number, day: number, days: number): {
  year: number
  month: number
  day: number
} {
  const date = new Date(Date.UTC(year, month - 1, day + days))

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  }
}
