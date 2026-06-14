import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import adminSpecialistsListHandler from '../server/api/admin/specialists/index.get'
import adminSpecialistsCreateHandler from '../server/api/admin/specialists/index.post'
import adminSpecialistPatchHandler from '../server/api/admin/specialists/[id].patch'
import publicSpecialistsHandler from '../server/api/specialists/index.get'
import historyListHandler from '../server/api/history/index.get'
import historyGetHandler from '../server/api/history/[conversationId].get'
import { createSessionToken } from '../server/utils/auth/session'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import { createCompany, replaceCompanyMemberships, setActiveCompanyForUser, upsertCorporateSubscription } from '../server/utils/companies/repository'
import { initializeDatabase } from '../server/utils/db'
import { persistCompletedHistoryTurn } from '../server/utils/history/repository'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getPublicSpecialists, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

describe('specialist availability and access acceptance', () => {
  it('keeps legacy specialist YAML active and public by default', async () => {
    const { dataDir, specialtiesRoot } = await createTempData()
    await createSpecialist(validSpecialist('iva'), { dataDir })

    expect(await getPublicSpecialists({ specialtiesRoot })).toEqual([
      expect.objectContaining({ id: 'iva', name: 'Legislação de IVA' })
    ])
  })

  it('lets admins create and edit status plus company access without exposing company ids publicly', async () => {
    const { dataDir, specialtiesRoot } = await createTempData()
    await seedUser(dataDir, { userId: 'admin-user', contacts: ['admin@example.com'] })
    await seedUser(dataDir, { userId: 'company-user', contacts: ['member@example.com'] })
    const companyId = await seedCompany(dataDir, { memberUserEmail: 'member@example.com' })
    const fetchApp = createAccessFetch(dataDir, { adminContacts: 'admin@example.com' })

    const created = await fetchApp(jsonRequest('http://local/api/admin/specialists', {
      method: 'POST',
      headers: sessionHeaders('admin-user'),
      body: {
        ...validSpecialist('laboral'),
        status: 'suspended',
        company_id: companyId
      }
    }))
    expect(created.status).toBe(202)
    const createdBody = await created.json() as { specialist: { status: string; company_id: string }; job: { type: string; status: string } }
    expect(createdBody).toMatchObject({
      specialist: { status: 'initializing', company_id: companyId },
      job: { type: 'specialist_initialization', status: 'queued' }
    })

    const edited = await fetchApp(jsonRequest('http://local/api/admin/specialists/laboral', {
      method: 'PATCH',
      headers: sessionHeaders('admin-user'),
      body: { status: 'active', company_id: companyId }
    }))
    expect(edited.status).toBe(200)
    await expect(edited.json()).resolves.toMatchObject({ specialist: { status: 'active', company_id: companyId } })

    const invalidCompany = await fetchApp(jsonRequest('http://local/api/admin/specialists/laboral', {
      method: 'PATCH',
      headers: sessionHeaders('admin-user'),
      body: { company_id: 'missing-company' }
    }))
    expect(invalidCompany.status).toBe(400)

    const adminList = await fetchApp(new Request('http://local/api/admin/specialists', {
      headers: sessionHeaders('admin-user')
    }))
    await expect(adminList.json()).resolves.toMatchObject({
      specialists: [expect.objectContaining({ id: 'laboral', status: 'active', company_id: companyId })]
    })

    const anonymousPublic = await fetchApp(new Request('http://local/api/specialists'))
    expect(await anonymousPublic.json()).toEqual({ specialists: [] })

    await setActiveCompany(dataDir, 'company-user', companyId)
    const allowedPublic = await fetchApp(new Request('http://local/api/specialists', {
      headers: sessionHeaders('company-user')
    }))
    const allowedBody = await allowedPublic.json() as { specialists: Array<Record<string, unknown>> }
    expect(allowedBody.specialists).toEqual([expect.objectContaining({ id: 'laboral' })])
    expect(allowedBody.specialists[0]).not.toHaveProperty('company_id')

    expect(await getPublicSpecialists({ specialtiesRoot })).toEqual([])
  })

  it('hides suspended specialists from public listing, chat, and history resume', async () => {
    const { dataDir } = await createTempData()
    await seedUser(dataDir, { userId: 'user-a', contacts: ['user@example.com'] })
    await createSpecialist({ ...validSpecialist('laboral'), status: 'suspended' } as never, { dataDir })
    const database = await openDatabase(dataDir)
    const saved = await persistCompletedHistoryTurn(database, {
      userId: 'user-a',
      specialistId: 'laboral',
      specialistName: 'Legislação de IVA',
      question: 'Pergunta antiga',
      answer: 'Resposta antiga',
      grounded: false,
      citations: [],
      now: new Date('2026-05-16T12:00:00.000Z')
    })

    const fetchApp = createAccessFetch(dataDir)
    const publicList = await fetchApp(new Request('http://local/api/specialists', {
      headers: sessionHeaders('user-a')
    }))
    expect(await publicList.json()).toEqual({ specialists: [] })

    await expect(
      createChatEventStreamFromBody(
        { specialistId: 'laboral', question: 'O que diz a lei?', conversationId: saved.conversationId },
        {
          dataDir,
          history: { database, subject: { type: 'registered', id: 'user-a' } },
          quota: { database, subject: { type: 'registered', id: 'user-a' } }
        }
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'SPECIALIST_NOT_FOUND' })

    const historyList = await fetchApp(new Request('http://local/api/history?specialistId=laboral', {
      headers: sessionHeaders('user-a')
    }))
    expect(historyList.status).toBe(404)

    const historyGet = await fetchApp(new Request(`http://local/api/history/${saved.conversationId}`, {
      headers: sessionHeaders('user-a')
    }))
    expect(historyGet.status).toBe(404)
    database.close()
  })

  it('requires the matching active company for private specialists', async () => {
    const { dataDir } = await createTempData()
    await seedUser(dataDir, { userId: 'member-user', contacts: ['member@example.com'] })
    await seedUser(dataDir, { userId: 'other-user', contacts: ['other@example.com'] })
    const companyId = await seedCompany(dataDir, { memberUserEmail: 'member@example.com' })
    await createSpecialist({ ...validSpecialist('laboral'), company_id: companyId } as never, { dataDir })
    const fetchApp = createAccessFetch(dataDir)

    const anonymousList = await fetchApp(new Request('http://local/api/specialists'))
    expect(await anonymousList.json()).toEqual({ specialists: [] })

    const memberWithoutActiveCompany = await fetchApp(new Request('http://local/api/specialists', {
      headers: sessionHeaders('member-user')
    }))
    expect(await memberWithoutActiveCompany.json()).toEqual({ specialists: [] })

    const database = await openDatabase(dataDir)
    await expect(
      createChatEventStreamFromBody(
        { specialistId: 'laboral', question: 'Posso consultar?' },
        {
          dataDir,
          history: { database, subject: { type: 'registered', id: 'member-user' } },
          quota: { database, subject: { type: 'registered', id: 'member-user' } }
        }
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'SPECIALIST_NOT_FOUND' })
    database.close()

    await setActiveCompany(dataDir, 'member-user', companyId)
    const allowedList = await fetchApp(new Request('http://local/api/specialists', {
      headers: sessionHeaders('member-user')
    }))
    await expect(allowedList.json()).resolves.toMatchObject({
      specialists: [expect.objectContaining({ id: 'laboral' })]
    })

    const otherList = await fetchApp(new Request('http://local/api/specialists', {
      headers: sessionHeaders('other-user')
    }))
    expect(await otherList.json()).toEqual({ specialists: [] })
  })
})

async function createTempData(): Promise<{ dataDir: string; specialtiesRoot: string }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-specialist-access-'))
  return { dataDir, specialtiesRoot: join(dataDir, 'specialties') }
}

async function openDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function seedUser(dataDir: string, input: { userId: string; contacts: string[] }): Promise<void> {
  const database = await openDatabase(dataDir)
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(input.userId, '2026-05-16T12:00:00.000Z')
  input.contacts.forEach((contact, index) => {
    database
      .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        `${input.userId}-identity-${index}`,
        input.userId,
        contact.startsWith('+') ? 'phone' : 'email',
        contact,
        new Date(Date.UTC(2026, 4, 16, 12, index)).toISOString()
      )
  })
  database.close()
}

async function seedCompany(dataDir: string, input: { memberUserEmail: string }): Promise<string> {
  const database = await openDatabase(dataDir)
  const company = createCompany(database, {
    nif: `5${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`,
    name: 'Empresa Especialista',
    phone: '+244923000000',
    address: 'Rua Principal'
  })
  upsertCorporateSubscription(database, {
    companyId: company.id,
    seats: 10,
    currentPeriodStart: '2026-05-16T12:00:00.000Z',
    currentPeriodEnd: '2026-08-16T12:00:00.000Z'
  })
  replaceCompanyMemberships(database, {
    companyId: company.id,
    admins: [input.memberUserEmail],
    members: []
  })
  database.close()
  return company.id
}

async function setActiveCompany(dataDir: string, userId: string, companyId: string): Promise<void> {
  const database = await openDatabase(dataDir)
  setActiveCompanyForUser(database, { userId, companyId })
  database.close()
}

function createAccessFetch(dataDir: string, options: { adminContacts?: string } = {}): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/specialists', publicSpecialistsHandler)
  router.get('/api/history', historyListHandler)
  router.get('/api/history/:conversationId', historyGetHandler)
  router.get('/api/admin/specialists', adminSpecialistsListHandler)
  router.post('/api/admin/specialists', adminSpecialistsCreateHandler)
  router.patch('/api/admin/specialists/:id', adminSpecialistPatchHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => withEnv({
    UJIMU_DATA_DIR: dataDir,
    UJIMU_DB_PATH: join(dataDir, 'db', 'ujimu.sqlite'),
    UJIMU_SESSION_SECRET: 'specialist-access-test-secret',
    UJIMU_ADMIN_CONTACTS: options.adminContacts ?? ''
  }, () => fetch(request))
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'specialist-access-test-secret',
      now: new Date('2026-05-16T12:00:00.000Z')
    })}`
  })
}

function jsonRequest(url: string, options: { method?: string; headers?: Headers; body?: unknown } = {}): Request {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function validSpecialist(id: string) {
  return {
    id,
    name: 'Legislação de IVA',
    description: 'Especialista sobre legislação de IVA.',
    wiki_type: 'legislation-regulatory' as const,
    system_prompt: 'Answer only from this specialist wiki.',
    citations_required: true,
    streaming_enabled: true
  }
}

async function withEnv<T>(env: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await action()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}
