import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import type { ChatEngineRunner } from '../server/utils/chat/types'
import { initializeDatabase } from '../server/utils/db'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { normalizeTimezone, resolveQuotaWindows } from '../server/utils/quota/time'
import { resolveQuotaPolicy } from '../server/utils/quota/policy'
import {
  ANONYMOUS_QUOTA_COOKIE_NAME,
  resolveAnonymousIdentity
} from '../server/utils/quota/identity'
import {
  evaluateAndRecordQuota,
  getRequestEventCount
} from '../server/utils/quota/usage'
import { QuotaExceededError } from '../server/utils/quota/errors'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('quota and request limit acceptance', () => {
  it('resolves the effective policy for anonymous, registered, and subscribed subjects', () => {
    expect(resolveQuotaPolicy({ subjectType: 'anonymous' })).toEqual({
      dailyLimit: 5,
      weeklyLimit: 20
    })
    expect(resolveQuotaPolicy({ subjectType: 'registered' })).toEqual({
      dailyLimit: 20,
      weeklyLimit: 100
    })
    expect(resolveQuotaPolicy({ subjectType: 'subscribed' }, { subscribedWeeklyLimit: 7500 })).toEqual({
      dailyLimit: null,
      weeklyLimit: 7500
    })
  })

  it('uses validated user timezones and local ISO week quota windows', () => {
    const now = new Date('2026-05-16T12:00:00.000Z')
    const windows = resolveQuotaWindows(now, 'Africa/Luanda')

    expect(normalizeTimezone('Not/A_Timezone')).toBe('Africa/Luanda')
    expect(windows.timezone).toBe('Africa/Luanda')
    expect(windows.daily.startAtUtc.toISOString()).toBe('2026-05-15T23:00:00.000Z')
    expect(windows.daily.resetAtUtc.toISOString()).toBe('2026-05-16T23:00:00.000Z')
    expect(windows.weekly.startAtUtc.toISOString()).toBe('2026-05-10T23:00:00.000Z')
    expect(windows.weekly.resetAtUtc.toISOString()).toBe('2026-05-17T23:00:00.000Z')
  })

  it('creates an opaque httpOnly anonymous identity cookie only when one is missing', () => {
    const created = resolveAnonymousIdentity(undefined, {
      generateId: () => '00000000-0000-4000-8000-000000000001',
      isProduction: false
    })

    expect(created.subject).toEqual({ type: 'anonymous', id: '00000000-0000-4000-8000-000000000001' })
    expect(created.cookieToSet).toMatchObject({
      name: ANONYMOUS_QUOTA_COOKIE_NAME,
      value: '00000000-0000-4000-8000-000000000001',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 60 * 60 * 24 * 180
      }
    })

    const existing = resolveAnonymousIdentity('existing-anon-id')
    expect(existing.subject).toEqual({ type: 'anonymous', id: 'existing-anon-id' })
    expect(existing.cookieToSet).toBeUndefined()
  })

  it('records allowed and denied anonymous events and blocks after the daily limit', async () => {
    const database = await createTempDatabase()
    const now = new Date('2026-05-16T12:00:00.000Z')

    for (let index = 0; index < 5; index += 1) {
      const decision = evaluateAndRecordQuota(database, {
        subject: { type: 'anonymous', id: 'anon-daily' },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now
      })
      expect(decision.allowed).toBe(true)
    }

    const denied = evaluateAndRecordQuota(database, {
      subject: { type: 'anonymous', id: 'anon-daily' },
      specialistId: 'iva',
      userTimezone: 'Africa/Luanda',
      occurredAt: now
    })

    expect(denied.allowed).toBe(false)
    if (denied.allowed) {
      throw new Error('Expected daily quota to be denied')
    }
    expect(denied.error).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      limits: {
        daily: { limit: 5, used: 5, resetAt: '2026-05-16T23:00:00.000Z' }
      }
    })
    expect(denied.error.limits).not.toHaveProperty('weekly')
    expect(getRequestEventCount(database)).toBe(6)
    expect(getDeniedEventCount(database)).toBe(1)
    database.close()
  })

  it('returns both daily and weekly exceeded limits when both are exhausted', async () => {
    const database = await createTempDatabase()
    const subject = { type: 'anonymous' as const, id: 'anon-weekly' }

    for (let day = 0; day < 4; day += 1) {
      for (let request = 0; request < 5; request += 1) {
        const decision = evaluateAndRecordQuota(database, {
          subject,
          specialistId: 'iva',
          userTimezone: 'Africa/Luanda',
          occurredAt: new Date(Date.UTC(2026, 4, 11 + day, 12, request))
        })
        expect(decision.allowed).toBe(true)
      }
    }

    const denied = evaluateAndRecordQuota(database, {
      subject,
      specialistId: 'iva',
      userTimezone: 'Africa/Luanda',
      occurredAt: new Date('2026-05-14T13:00:00.000Z')
    })

    expect(denied.allowed).toBe(false)
    if (denied.allowed) {
      throw new Error('Expected daily and weekly quotas to be denied')
    }
    expect(denied.error.limits).toEqual({
      daily: { limit: 5, used: 5, resetAt: '2026-05-14T23:00:00.000Z' },
      weekly: { limit: 20, used: 20, resetAt: '2026-05-17T23:00:00.000Z' }
    })
    database.close()
  })

  it('checks quota before creating a chat stream and does not call the runner when denied', async () => {
    const database = await createTempDatabase()
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource(specialtiesRoot)
    const runner = fakeRunner()
    const now = new Date('2026-05-16T12:00:00.000Z')

    for (let index = 0; index < 5; index += 1) {
      evaluateAndRecordQuota(database, {
        subject: { type: 'anonymous', id: 'anon-chat' },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now
      })
    }

    await expect(
      createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?', clientTimezone: 'Africa/Luanda' },
        {
          specialtiesRoot,
          runner,
          quota: {
            database,
            subject: { type: 'anonymous', id: 'anon-chat' },
            occurredAt: now
          }
        }
      )
    ).rejects.toBeInstanceOf(QuotaExceededError)

    expect(runner.run).not.toHaveBeenCalled()
    expect(getDeniedEventCount(database)).toBe(1)
    database.close()
  })
})

async function createTempDatabase(): Promise<DatabaseSync> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-quota-db-'))
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function createTempSpecialist(id: string): Promise<{
  specialist: SpecialistRuntime
  specialtiesRoot: string
}> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-quota-specialist-'))
  const specialtiesRoot = join(dataDir, 'specialties')

  const specialist = await createSpecialist(
    {
      id,
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      system_prompt: 'Answer only from this specialist wiki.',
      citations_required: true,
      streaming_enabled: true
    },
    { specialtiesRoot }
  )

  return { specialist, specialtiesRoot }
}

async function createIngestedSource(specialtiesRoot: string): Promise<void> {
  const { getSpecialistById } = await import('../server/utils/specialists/registry')
  const specialist = await getSpecialistById('iva', { specialtiesRoot })
  if (!specialist) {
    throw new Error('Expected specialist to exist')
  }

  await storeRawSource(specialist, {
    fileName: 'codigo-iva.md',
    content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
  })

  const state = await scanSpecialistRawSources(specialist)
  state.sources['codigo-iva.md'].status = 'ingested'
  state.sources['codigo-iva.md'].ingested_at = '2026-05-16T00:00:00.000Z'
  await writeIngestionState(specialist.paths.ingestState, state)
}

function fakeRunner(): ChatEngineRunner {
  return {
    run: vi.fn(async (input) => ({
      grounded: true,
      citations: [input.citationEvidence[0]],
      deltas: toAsyncDeltas(['Resposta fundamentada.'])
    }))
  }
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}

function getDeniedEventCount(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM request_events WHERE decision = 'denied'")
    .get() as { count: number }
  return row.count
}
