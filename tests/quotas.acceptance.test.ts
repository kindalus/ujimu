import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import chatHandler from '../server/api/chat.post'
import { createSessionToken } from '../server/utils/auth/session'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import type { ChatEngineRunner } from '../server/utils/chat/types'
import { createCompany, replaceCompanyMemberships, setActiveCompanyForUser, upsertCorporateSubscription } from '../server/utils/companies/repository'
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
  evaluateAndRecordQuotaWithFallback,
  getCompanyQuotaUsage,
  getRequestEventCount
} from '../server/utils/quota/usage'
import { QuotaExceededError } from '../server/utils/quota/errors'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('quota and request limit acceptance', () => {
  it('resolves the effective policy for anonymous, registered, and subscribed subjects', () => {
    expect(resolveQuotaPolicy({ subjectType: 'anonymous' })).toEqual({
      dailyLimit: 10,
      weeklyLimit: 40
    })
    expect(resolveQuotaPolicy({ subjectType: 'registered' })).toEqual({
      dailyLimit: 40,
      weeklyLimit: 200
    })
    expect(resolveQuotaPolicy({ subjectType: 'subscribed' }, { subscribedWeeklyLimit: 7500 })).toEqual({
      dailyLimit: null,
      weeklyLimit: 7500
    })
    expect(resolveQuotaPolicy({ subjectType: 'company' }, { subscribedWeeklyLimit: 7500, companySeats: 3 })).toEqual({
      dailyLimit: null,
      weeklyLimit: 22500
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

  it('creates a signed httpOnly anonymous identity cookie only when a trustworthy one is missing', () => {
    const sessionSecret = 'anon-cookie-secret'
    const created = resolveAnonymousIdentity(undefined, {
      generateId: () => '00000000-0000-4000-8000-000000000001',
      isProduction: false,
      sessionSecret
    })

    expect(created.subject).toEqual({ type: 'anonymous', id: '00000000-0000-4000-8000-000000000001' })
    expect(created.cookieToSet).toMatchObject({
      name: ANONYMOUS_QUOTA_COOKIE_NAME,
      value: expect.stringMatching(/^00000000-0000-4000-8000-000000000001\..+/),
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 60 * 60 * 24 * 180
      }
    })

    const reused = resolveAnonymousIdentity(created.cookieToSet?.value, { sessionSecret })
    expect(reused.subject).toEqual({ type: 'anonymous', id: '00000000-0000-4000-8000-000000000001' })
    expect(reused.cookieToSet).toBeUndefined()
  })

  it('refuses anonymous quota cookies that were not signed by this server', () => {
    const sessionSecret = 'anon-cookie-secret'
    const minted = resolveAnonymousIdentity(undefined, {
      generateId: () => '00000000-0000-4000-8000-000000000002',
      sessionSecret
    })

    // An attacker cannot mint their own subject id, nor claim someone else's, without the secret.
    for (const forged of ['attacker-chosen-id', '00000000-0000-4000-8000-000000000002', `${minted.subject.id}.notasignature`]) {
      const resolved = resolveAnonymousIdentity(forged, {
        generateId: () => 'server-minted',
        sessionSecret
      })
      expect(resolved.subject.id).toBe('server-minted')
      expect(resolved.cookieToSet).toBeDefined()
    }

    // A cookie signed with a different secret is rejected too.
    const otherServer = resolveAnonymousIdentity(undefined, {
      generateId: () => '00000000-0000-4000-8000-000000000003',
      sessionSecret: 'a-different-secret'
    })
    const rejected = resolveAnonymousIdentity(otherServer.cookieToSet?.value, {
      generateId: () => 'server-minted',
      sessionSecret
    })
    expect(rejected.subject.id).toBe('server-minted')
  })

  it('records allowed and denied anonymous events and blocks after the daily limit', async () => {
    const database = await createTempDatabase()
    const now = new Date('2026-05-16T12:00:00.000Z')

    for (let index = 0; index < 10; index += 1) {
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
        daily: { limit: 10, used: 10, resetAt: '2026-05-16T23:00:00.000Z' }
      }
    })
    expect(denied.error.limits).not.toHaveProperty('weekly')
    expect(getRequestEventCount(database)).toBe(11)
    expect(getDeniedEventCount(database)).toBe(1)
    database.close()
  })

  it('returns both daily and weekly exceeded limits when both are exhausted', async () => {
    const database = await createTempDatabase()
    const subject = { type: 'anonymous' as const, id: 'anon-weekly' }

    for (let day = 0; day < 4; day += 1) {
      for (let request = 0; request < 10; request += 1) {
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
      daily: { limit: 10, used: 10, resetAt: '2026-05-14T23:00:00.000Z' },
      weekly: { limit: 40, used: 40, resetAt: '2026-05-17T23:00:00.000Z' }
    })
    database.close()
  })

  it('uses company quota first and falls back to the individual user when corporate quota is exhausted', async () => {
    const database = await createTempDatabase()
    const now = new Date('2026-05-16T12:00:00.000Z')

    const first = evaluateAndRecordQuotaWithFallback(database, {
      primary: {
        subject: { type: 'company', id: 'company-1', seats: 1 },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now,
        subscribedWeeklyLimit: 2
      },
      fallback: {
        subject: { type: 'registered', id: 'user-1' },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now
      }
    })
    expect(first).toMatchObject({ allowed: true, consumedSubject: { type: 'company', id: 'company-1' } })

    const second = evaluateAndRecordQuotaWithFallback(database, {
      primary: {
        subject: { type: 'company', id: 'company-1', seats: 1 },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now,
        subscribedWeeklyLimit: 2
      },
      fallback: {
        subject: { type: 'registered', id: 'user-1' },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now
      }
    })
    expect(second).toMatchObject({ allowed: true, consumedSubject: { type: 'company', id: 'company-1' } })

    const fallback = evaluateAndRecordQuotaWithFallback(database, {
      primary: {
        subject: { type: 'company', id: 'company-1', seats: 1 },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now,
        subscribedWeeklyLimit: 2
      },
      fallback: {
        subject: { type: 'registered', id: 'user-1' },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now
      }
    })
    expect(fallback).toMatchObject({ allowed: true, consumedSubject: { type: 'registered', id: 'user-1' } })
    expect(getSubjectCount(database, 'company', 'company-1')).toBe(2)
    expect(getSubjectCount(database, 'registered', 'user-1')).toBe(1)
    expect(getDeniedSubjectCount(database, 'company', 'company-1')).toBe(1)
    database.close()
  })

  it('reports weekly company quota usage for company admins only', async () => {
    const database = await createTempDatabase()
    const { companyId } = seedCorporateQuotaScenario(database)
    const now = new Date('2026-05-16T12:00:00.000Z')

    for (let index = 0; index < 3; index += 1) {
      expect(evaluateAndRecordQuota(database, {
        subject: { type: 'company', id: companyId, seats: 2 },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: now,
        subscribedWeeklyLimit: 10
      }).allowed).toBe(true)
    }

    expect(getCompanyQuotaUsage(database, { companyId, occurredAt: now, subscribedWeeklyLimit: 10 })).toEqual({
      subject: { type: 'company', id: companyId },
      weekly: { limit: 20, used: 3, resetAt: '2026-05-17T23:00:00.000Z' }
    })
    database.close()
  })

  it('does not apply request quotas to Ujimu admins in the chat API', async () => {
    resetSpecialistRegistryForTests()
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-admin-quota-'))
    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    seedQuotaUser(database, 'admin-user', 'admin@example.com')
    const specialist = await createSpecialist(
      {
        id: 'iva',
        name: 'Legislação de IVA',
        description: 'Especialista sobre legislação de IVA.',
        wiki_type: 'legislation-regulatory',
        system_prompt: 'Answer only from this specialist wiki.',
        citations_required: true,
        streaming_enabled: true
      },
      { dataDir }
    )
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    const state = await scanSpecialistRawSources(specialist)
    state.sources['codigo-iva.original.md'].status = 'ingested'
    state.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
    state.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
    await writeIngestionState(specialist.paths.ingestState, state)

    for (let index = 0; index < 20; index += 1) {
      expect(evaluateAndRecordQuota(database, {
        subject: { type: 'registered', id: 'admin-user' },
        specialistId: 'iva',
        userTimezone: 'Africa/Luanda',
        occurredAt: new Date('2026-05-16T12:00:00.000Z')
      }).allowed).toBe(true)
    }

    const fetchChat = createChatFetch(dataDir, 'admin@example.com')
    const response = await fetchChat(new Request('http://local/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `ujimu_session=${createSessionToken('admin-user', {
          sessionSecret: 'quota-admin-secret'
        })}`
      },
      body: JSON.stringify({
        specialistId: 'iva',
        question: 'O que diz o Artigo 1.º?',
        clientTimezone: 'Africa/Luanda'
      })
    }))

    expect(response.status).toBe(200)
    await response.body?.cancel().catch(() => undefined)
    expect(getRequestEventCount(database)).toBe(20)
    database.close()
  })

  it('checks quota before creating a chat stream and does not call the runner when denied', async () => {
    const database = await createTempDatabase()
    const { specialtiesRoot } = await createTempSpecialist('iva')
    await createIngestedSource(specialtiesRoot)
    const runner = fakeRunner()
    const now = new Date('2026-05-16T12:00:00.000Z')

    for (let index = 0; index < 10; index += 1) {
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

function createChatFetch(dataDir: string, adminContacts: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.post('/api/chat', chatHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    const previousPiChatEnabled = process.env.UJIMU_PI_CHAT_ENABLED
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'quota-admin-secret'
    process.env.UJIMU_ADMIN_CONTACTS = adminContacts
    delete process.env.UJIMU_PI_CHAT_ENABLED

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_ADMIN_CONTACTS', previousAdminContacts)
      restoreEnv('UJIMU_PI_CHAT_ENABLED', previousPiChatEnabled)
    }
  }
}

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
  state.sources['codigo-iva.original.md'].status = 'ingested'
  state.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
  state.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
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

function seedCorporateQuotaScenario(database: DatabaseSync): { companyId: string } {
  seedQuotaUser(database, 'admin-user', 'admin@example.com')
  const company = createCompany(database, {
    nif: '5009990001',
    name: 'Empresa Quota',
    phone: '+244923000000',
    address: 'Rua Principal'
  })
  upsertCorporateSubscription(database, {
    companyId: company.id,
    seats: 2,
    currentPeriodStart: '2026-05-01T00:00:00.000Z',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z'
  })
  replaceCompanyMemberships(database, {
    companyId: company.id,
    admins: ['admin@example.com'],
    members: []
  })
  setActiveCompanyForUser(database, { userId: 'admin-user', companyId: company.id })
  return { companyId: company.id }
}

function seedQuotaUser(database: DatabaseSync, userId: string, email: string): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-05-16T12:00:00.000Z')
  database
    .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run(`${userId}-email`, userId, 'email', email, '2026-05-16T12:00:00.000Z')
}

function getSubjectCount(database: DatabaseSync, subjectType: string, subjectId: string): number {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM request_events WHERE subject_type = ? AND subject_id = ? AND counted = 1')
    .get(subjectType, subjectId) as { count: number }
  return row.count
}

function getDeniedSubjectCount(database: DatabaseSync, subjectType: string, subjectId: string): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM request_events WHERE subject_type = ? AND subject_id = ? AND decision = 'denied'")
    .get(subjectType, subjectId) as { count: number }
  return row.count
}

function getDeniedEventCount(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM request_events WHERE decision = 'denied'")
    .get() as { count: number }
  return row.count
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
