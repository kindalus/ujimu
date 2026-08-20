import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, eventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import securityHeadersMiddleware from '../server/middleware/security-headers'
import healthzHandler from '../server/routes/healthz.get'
import readyzHandler from '../server/api/admin/ops/readyz.get'
import { createSessionToken } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import { writeOperationalEvent } from '../server/utils/ops/logger'
import { storeRawSource, RawSourceStorageError } from '../server/utils/ingestion/storage'
import { createSecurityHeaders } from '../server/utils/security/headers'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

describe('security, operations, and observability acceptance', () => {
  it('applies baseline security headers to application responses', async () => {
    const app = createApp()
    app.use(securityHeadersMiddleware)
    app.use('/probe', eventHandler(() => ({ ok: true })))
    const fetch = toWebHandler(app)

    const response = await fetch(new Request('http://local/probe'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('allows Vite worker blobs only outside production CSP', () => {
    expect(createSecurityHeaders({ NODE_ENV: 'development' })['content-security-policy']).toContain("worker-src 'self' blob:")
    expect(createSecurityHeaders({ NODE_ENV: 'production' })['content-security-policy']).not.toContain('worker-src')
  })

  it('sends HSTS only in production, so local http development is not pinned to https', () => {
    expect(createSecurityHeaders({ NODE_ENV: 'production' })['strict-transport-security'])
      .toBe('max-age=63072000; includeSubDomains')
    expect(createSecurityHeaders({ NODE_ENV: 'development' })).not.toHaveProperty('strict-transport-security')
  })

  it('writes daily JSONL operational events with sanitized metadata only', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-ops-logs-'))

    await writeOperationalEvent(
      {
        category: 'chat',
        event: 'chat_completed',
        severity: 'info',
        specialistId: 'iva',
        metadata: {
          outcome: 'answered',
          citationCount: 2,
          subjectType: 'registered',
          questionText: 'Qual é a taxa do IVA?',
          answer: 'A taxa é 14%.',
          otpCode: '123456',
          sessionCookie: 'ujimu_session=secret.jwt',
          webhookSecret: 'provider-secret',
          documentContent: 'conteúdo do diploma',
          contact: 'user@example.com'
        }
      },
      {
        dataDir,
        now: new Date('2026-05-16T13:40:12.000Z'),
        console: false
      }
    )

    const logPath = join(dataDir, 'logs', 'operational', 'operational-2026-05-16.jsonl')
    const contents = await readFile(logPath, 'utf8')
    const lines = contents.trim().split('\n')
    expect(lines).toHaveLength(1)

    const event = JSON.parse(lines[0]) as {
      ts: string
      category: string
      event: string
      severity: string
      specialistId: string
      metadata: Record<string, unknown>
    }
    expect(event).toMatchObject({
      ts: '2026-05-16T13:40:12.000Z',
      category: 'chat',
      event: 'chat_completed',
      severity: 'info',
      specialistId: 'iva',
      metadata: {
        outcome: 'answered',
        citationCount: 2,
        subjectType: 'registered'
      }
    })
    expect(contents).not.toContain('Qual é a taxa do IVA?')
    expect(contents).not.toContain('A taxa é 14%')
    expect(contents).not.toContain('123456')
    expect(contents).not.toContain('secret.jwt')
    expect(contents).not.toContain('provider-secret')
    expect(contents).not.toContain('conteúdo do diploma')
    expect(contents).not.toContain('user@example.com')
  })

  it('exposes minimal public healthz and admin-only safe readyz checks', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-readyz-'))
    await seedUser(dataDir, { userId: 'admin-user', contacts: ['admin@example.com'] })
    await seedUser(dataDir, { userId: 'regular-user', contacts: ['regular@example.com'] })
    const fetchOps = createOpsFetch(dataDir)

    const healthz = await fetchOps(new Request('http://local/healthz'))
    expect(healthz.status).toBe(200)
    await expect(healthz.json()).resolves.toEqual({ ok: true, service: 'ujimu' })

    const anonymousReadyz = await fetchOps(new Request('http://local/api/admin/ops/readyz'))
    expect(anonymousReadyz.status).toBe(401)

    const nonAdminReadyz = await fetchOps(
      new Request('http://local/api/admin/ops/readyz', { headers: sessionHeaders('regular-user') })
    )
    expect(nonAdminReadyz.status).toBe(403)

    const adminReadyz = await fetchOps(
      new Request('http://local/api/admin/ops/readyz', { headers: sessionHeaders('admin-user') })
    )
    expect(adminReadyz.status).toBe(200)
    const body = await adminReadyz.json() as {
      ok: boolean
      checks: Record<string, boolean | number>
    }
    expect(body).toMatchObject({
      ok: true,
      checks: {
        database: true,
        dataDirectoryWritable: true,
        operationalLogsWritable: true,
        billingWebhookSecretConfigured: true,
        sessionSecretConfigured: true,
        otpPepperConfigured: true
      }
    })
    expect(typeof body.checks.migrationsApplied).toBe('number')
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(dataDir)
    expect(serialized).not.toContain('readyz-billing-secret')
    expect(serialized).not.toContain('readyz-session-secret')
  })

  it('keeps raw uploads inside the specialist raw directory and rejects traversal filenames', async () => {
    resetSpecialistRegistryForTests()
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-secure-upload-'))
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

    const stored = await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA' })
    expect(stored.absolutePath).toBe(join(specialist.paths.raw, 'codigo-iva.original.md'))

    for (const fileName of ['/tmp/escape.md', '../escape.md', 'subdir/file.md', '..\\escape.md', '.', '..']) {
      await expect(storeRawSource(specialist, { fileName, content: 'bad' })).rejects.toBeInstanceOf(
        RawSourceStorageError
      )
    }
  })
})

async function seedUser(
  dataDir: string,
  input: { userId: string; contacts: string[] }
): Promise<void> {
  const database = await openOpsDatabase(dataDir)
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

async function openOpsDatabase(dataDir: string): Promise<DatabaseSync> {
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

function createOpsFetch(dataDir: string): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/healthz', healthzHandler)
  router.get('/api/admin/ops/readyz', readyzHandler)
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    const previousBillingSecret = process.env.UJIMU_BILLING_WEBHOOK_SECRET
    const previousOtpPepper = process.env.UJIMU_OTP_PEPPER
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'readyz-session-secret'
    process.env.UJIMU_ADMIN_CONTACTS = 'admin@example.com'
    process.env.UJIMU_BILLING_WEBHOOK_SECRET = 'readyz-billing-secret'
    process.env.UJIMU_OTP_PEPPER = 'readyz-otp-pepper'

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_ADMIN_CONTACTS', previousAdminContacts)
      restoreEnv('UJIMU_BILLING_WEBHOOK_SECRET', previousBillingSecret)
      restoreEnv('UJIMU_OTP_PEPPER', previousOtpPepper)
    }
  }
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'readyz-session-secret'
    })}`
  })
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
