import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import adminSessionHandler from '../server/api/admin/session.get'
import adminRawUploadHandler from '../server/api/admin/specialists/[id]/raw.post'
import adminSourcesReloadHandler from '../server/api/admin/specialists/[id]/sources/reload.post'
import { createSessionToken } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import type { ChatEngineRunner, ChatStreamEvent } from '../server/utils/chat/types'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { runPendingIngestion } from '../server/utils/ingestion/run'
import { readIngestionState, writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import type { PiIngestionRunner } from '../server/utils/ingestion/pi-runner'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

const execFileAsync = promisify(execFile)

describe('three Pi agent pipeline acceptance', () => {
  it('renames direct Markdown uploads to .original.md and marks them pending for agent-owned conversion and ingestion', async () => {
    const { specialist } = await createTempSpecialist('iva')

    const stored = await storeRawSource(specialist, {
      fileName: 'lei.md',
      content: '# Lei normalizada\n\nArtigo 1.º\nTexto oficial já em Markdown.'
    })

    expect(stored.relativePath).toBe('lei.original.md')
    await expect(readFile(join(specialist.paths.raw, 'lei.original.md'), 'utf8')).resolves.toContain('Artigo 1.º')
    await expect(
      storeRawSource(specialist, {
        fileName: 'lei.md',
        content: '# Duplicado\n\nArtigo 2.º\nTexto duplicado.'
      })
    ).rejects.toMatchObject({ code: 'RAW_SOURCE_ALREADY_EXISTS' })
    await expect(
      storeRawSource(specialist, {
        fileName: 'lei.txt.md',
        content: '# Artefacto gerado\n\nArtigo 2.º\nTexto duplicado.'
      })
    ).rejects.toMatchObject({ code: 'GENERATED_MARKDOWN_ARTIFACT' })

    const state = await scanSpecialistRawSources(specialist)
    const source = state.sources['lei.original.md'] as any

    expect(source).toMatchObject({
      raw_path: 'lei.original.md',
      conversion: {
        status: 'pending',
        markdown_path: 'lei.original.md.md'
      },
      ingestion: {
        status: 'pending',
        source_path: 'lei.original.md.md'
      }
    })
  })

  it('tracks converted-source state by original upload and ignores generated Markdown as an independent source', async () => {
    const { specialist } = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'lei.pdf',
      content: Buffer.from('%PDF-1.7 textual pdf placeholder')
    })
    await writeFile(join(specialist.paths.raw, 'lei.pdf.md'), '# Lei convertida\n\nArtigo 1.º\nTexto convertido.')

    const state = await scanSpecialistRawSources(specialist)

    expect(state.sources['lei.pdf.md']).toBeUndefined()
    expect(state.sources['lei.pdf'] as any).toMatchObject({
      raw_path: 'lei.pdf',
      conversion: {
        status: 'pending',
        markdown_path: 'lei.pdf.md'
      },
      ingestion: {
        status: 'pending',
        source_path: 'lei.pdf.md'
      }
    })
  })

  it('runs manual conversion for pending and failed sources, validates Markdown output, and leaves ready sources pending for ingestion', async () => {
    const { specialist } = await createTempSpecialist('iva')
    await storeRawSource(specialist, { fileName: 'lei.txt', content: 'Artigo 1.º\nTexto original.' })
    await storeRawSource(specialist, { fileName: 'falhou.csv', content: 'artigo,valor\n1,10' })
    await scanSpecialistRawSources(specialist)

    const state = await readIngestionState(specialist.paths.ingestState) as any
    state.sources['falhou.csv'].conversion.status = 'failed'
    state.sources['falhou.csv'].conversion.error_code = 'CONVERSION_FAILED'
    await writeIngestionState(specialist.paths.ingestState, state)

    const modulePath = '../server/utils/ingestion/conversion'
    const { runPendingConversions } = await import(modulePath) as {
      runPendingConversions: (specialist: SpecialistRuntime, options: unknown) => Promise<{
        converted: number
        failed: number
        skipped: number
      }>
    }

    const result = await runPendingConversions(specialist, {
      piConversionEnabled: true,
      runner: {
        async convertSource(targetSpecialist: SpecialistRuntime, source: any) {
          await writeFile(
            join(targetSpecialist.paths.raw, source.conversion.markdown_path),
            `# Converted ${source.raw_path}\n\nArtigo 1.º\nTexto convertido com conteúdo suficiente.`
          )
        }
      }
    })

    expect(result).toMatchObject({ converted: 2, failed: 0 })
    const after = await readIngestionState(specialist.paths.ingestState) as any
    expect(after.sources['lei.txt']).toMatchObject({
      conversion: { status: 'converted', markdown_path: 'lei.txt.md', markdown_checksum: expect.stringMatching(/^sha256:/) },
      ingestion: { status: 'pending', source_path: 'lei.txt.md' }
    })
    expect(after.sources['falhou.csv'].conversion.status).toBe('converted')
  })

  it('ingests pending raw sources through their converted Markdown targets and cites original uploads', async () => {
    const { specialist } = await createTempSpecialist('iva')
    await mkdir(specialist.paths.raw, { recursive: true })
    await writeFile(join(specialist.paths.raw, 'lei.pdf'), '%PDF-1.7 textual pdf placeholder')
    await writeFile(join(specialist.paths.raw, 'lei.pdf.md'), '# Lei PDF\n\nArtigo 1.º\nTexto convertido.')
    await writeFile(join(specialist.paths.raw, 'pendente.docx'), 'docx placeholder')
    await writeFile(join(specialist.paths.raw, 'manual.original.md'), '# Manual\n\nArtigo 2.º\nTexto manual.')

    await writeIngestionState(specialist.paths.ingestState, {
      version: 1,
      sources: {
        'lei.pdf': convertedSource('iva', 'lei.pdf', 'lei.pdf.md', 'Código PDF', ['Artigo 1.º']),
        'pendente.docx': pendingConversionSource('iva', 'pendente.docx', 'pendente.docx.md'),
        'manual.original.md': markdownOriginalSource('iva', 'manual.original.md', 'Manual', ['Artigo 2.º'])
      }
    } as any)
    const ingestedMarkdownPaths: string[] = []

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: fakeIngestionRunner(async (source: any, targetSpecialist) => {
        ingestedMarkdownPaths.push(source.ingestion.source_path)
        await writeFile(join(targetSpecialist.paths.wiki, 'index.md'), `# Wiki\n\nIngested ${source.ingestion.source_path}\n`)
      })
    })

    expect(ingestedMarkdownPaths).toEqual(['lei.pdf.md', 'manual.original.md.md', 'pendente.docx.md'])
    const state = await readIngestionState(specialist.paths.ingestState) as any
    expect(state.sources['lei.pdf']).toMatchObject({
      raw_path: 'lei.pdf',
      ingestion: { status: 'ingested', source_path: 'lei.pdf.md' }
    })
    expect(state.sources['pendente.docx'].ingestion.status).toBe('ingested')
    expect(state.sources['manual.original.md']).toMatchObject({
      ingestion: { status: 'ingested', source_path: 'manual.original.md.md' }
    })
  })

  it('rejects generated Markdown artefact and mismatched MIME uploads at the admin boundary', async () => {
    const { dataDir } = await createTempAdminData()
    await seedAdmin(dataDir)
    await createSpecialist(validSpecialist('iva'), { dataDir })
    const routePath = '../server/api/admin/specialists/[id]/conversion/run.post'
    const conversionModule = await import(routePath) as { default: unknown }
    const fetchAdmin = createAdminFetch(dataDir, conversionModule.default)

    const generatedResponse = await fetchAdmin(uploadRequest('http://local/api/admin/specialists/iva/raw', 'lei.txt.md', '# Generated'))
    expect(generatedResponse.status).toBe(400)

    const mismatchResponse = await fetchAdmin(
      uploadRequest('http://local/api/admin/specialists/iva/raw', 'lei.md', '# Lei', 'application/x-msdownload')
    )
    expect(mismatchResponse.status).toBe(400)
  })

  it('fails PDF conversion quickly when PDF tool prerequisites are unavailable', async () => {
    const { dataDir } = await createTempAdminData()
    await seedAdmin(dataDir)
    await createSpecialist(validSpecialist('iva'), { dataDir })
    const routePath = '../server/api/admin/specialists/[id]/conversion/run.post'
    const conversionModule = await import(routePath) as { default: unknown }
    const fetchAdmin = createAdminFetch(dataDir, conversionModule.default)

    const previousGeminiApiKey = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      await fetchAdmin(uploadRequest('http://local/api/admin/specialists/iva/raw', 'lei.pdf', '%PDF-1.7 placeholder', 'application/pdf'))
      await fetchAdmin(jsonRequest('http://local/api/admin/specialists/iva/sources/reload', { method: 'POST' }))
      const response = await fetchAdmin(jsonRequest('http://local/api/admin/specialists/iva/conversion/run', { method: 'POST' }))

      expect(response.status).toBe(200)
      const payload = await response.json() as { failed: number; sources: Array<{ conversion?: { error_message?: string } }> }
      expect(payload.failed).toBe(1)
      expect(payload.sources[0]?.conversion?.error_message).toContain('GEMINI_API_KEY_MISSING')
    } finally {
      restoreEnv('GEMINI_API_KEY', previousGeminiApiKey)
    }
  })

  it('requires the manual admin conversion endpoint and audits safe conversion counts', async () => {
    const { dataDir } = await createTempAdminData()
    await seedAdmin(dataDir)
    await createSpecialist(validSpecialist('iva'), { dataDir })
    const routePath = '../server/api/admin/specialists/[id]/conversion/run.post'
    const conversionModule = await import(routePath) as { default: unknown }
    const fetchAdmin = createAdminFetch(dataDir, conversionModule.default)

    await fetchAdmin(uploadRequest('http://local/api/admin/specialists/iva/raw', 'lei.txt', 'Artigo 1.º\nTexto.'))
    await fetchAdmin(jsonRequest('http://local/api/admin/specialists/iva/sources/reload', { method: 'POST' }))
    const response = await fetchAdmin(jsonRequest('http://local/api/admin/specialists/iva/conversion/run', { method: 'POST' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ converted: expect.any(Number), failed: expect.any(Number), skipped: expect.any(Number) })
    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    const audit = database
      .prepare('SELECT action, metadata_json FROM admin_audit_events ORDER BY occurred_at, id')
      .all() as Array<{ action: string; metadata_json: string }>
    database.close()
    expect(audit.map((event) => event.action)).toContain('conversion_run')
    expect(audit.find((event) => event.action === 'conversion_run')?.metadata_json).not.toContain('Artigo 1.º')
  })

  it('accepts consultation citations without filtering them against backend-provided evidence', async () => {
    const { specialist, specialtiesRoot } = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    const state = await scanSpecialistRawSources(specialist)
    state.sources['codigo-iva.original.md'].status = 'ingested'
    state.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
    state.sources['codigo-iva.original.md'].ingestion!.citations = [{
      source_file: 'raw/codigo-iva.original.md',
      source_title: 'Código do IVA',
      article_refs: ['Artigo 1.º']
    }]
    state.sources['codigo-iva.original.md'].ingestion!.manifest_validated_at = '2026-05-16T00:00:00.000Z'
    state.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
    await writeIngestionState(specialist.paths.ingestState, state)

    const events = await collectChatEvents(
      await createChatEventStreamFromBody(
        { specialistId: 'iva', question: 'O que diz o Artigo 1.º?' },
        {
          specialtiesRoot,
          piChatEnabled: true,
          runner: invalidCitationRunner()
        }
      )
    )

    expect(joinDeltas(events)).toContain('Resposta com citação inventada')
    expect(events).toContainEqual({
      type: 'citation',
      citation: {
        sourceTitle: 'Fonte inventada',
        sourceFile: 'raw/inventado.md',
        articleRefs: ['Artigo 99.º']
      }
    })
    expect(events.at(-1)).toEqual({ type: 'done', grounded: true })
  })

  it('uses mutable Ujimu config outside bundled Pi resources and Pi CLI .pi discovery', async () => {
    const { DefaultResourceLoader, SettingsManager } = await import('@earendil-works/pi-coding-agent')
    const { ensureUjimuPiConfigDir, resolveUjimuConfigDir, resolveUjimuPiBundleDir } = await import('../server/utils/pi/paths')
    const previousConfigDir = process.env.UJIMU_CONFIG_DIR
    const previousBundleDir = process.env.UJIMU_PI_BUNDLE_DIR
    delete process.env.UJIMU_CONFIG_DIR
    delete process.env.UJIMU_PI_BUNDLE_DIR

    try {
      const loaderCwd = await mkdtemp(join(tmpdir(), 'ujimu-pi-loader-'))
      const configDir = await mkdtemp(join(tmpdir(), 'ujimu-config-'))
      const defaultConfigDir = resolveUjimuConfigDir()
      const bundleDir = resolveUjimuPiBundleDir()
      const seededConfigDir = await ensureUjimuPiConfigDir({ env: { UJIMU_CONFIG_DIR: configDir }, bundledPiDir: bundleDir })
      const loader = new DefaultResourceLoader({
        cwd: loaderCwd,
        agentDir: bundleDir,
        settingsManager: SettingsManager.create(loaderCwd, seededConfigDir),
        additionalSkillPaths: [join(bundleDir, 'skills')],
        noContextFiles: true,
        noExtensions: true,
        noPromptTemplates: true,
        noSkills: true,
        noThemes: true
      })
      await loader.reload()
      const skills = loader.getSkills()
      const extensions = loader.getExtensions()
      const llmWiki = skills.skills.find((skill) => skill.name === 'llm-wiki')
      const trackedPi = await execFileAsync('git', ['ls-files', '.pi'])

      expect(defaultConfigDir).toMatch(/\.config\/ujimu$/)
      expect(bundleDir).toBe(join(process.cwd(), 'config', 'pi'))
      expect(bundleDir).not.toBe(join(process.cwd(), '.pi'))
      expect(seededConfigDir).toBe(configDir)
      expect(llmWiki?.filePath).toBe(join(bundleDir, 'skills', 'llm-wiki', 'SKILL.md'))
      expect(skills.skills.map((skill) => skill.name)).toEqual(['llm-wiki'])
      expect(extensions.errors).toEqual([])
      expect(trackedPi.stdout.trim()).toBe('')
      await expect(readFile(join(configDir, 'auth.json'), 'utf8')).resolves.toContain('OPENROUTER_API_KEY')
      await expect(readFile(join(configDir, 'models.json'), 'utf8')).resolves.toContain('moonshotai/kimi-k2.6')
      await expect(readFile(join(configDir, 'settings.json'), 'utf8')).resolves.toContain('moonshotai/kimi-k2.6')
      await expect(readFile('.gitignore', 'utf8')).resolves.toContain('config/pi/auth.json')
      await expect(readFile('.gitignore', 'utf8')).resolves.toContain('.pi/')
    } finally {
      restoreEnv('UJIMU_CONFIG_DIR', previousConfigDir)
      restoreEnv('UJIMU_PI_BUNDLE_DIR', previousBundleDir)
    }
  })
})

async function createTempSpecialist(id: string): Promise<{ specialist: SpecialistRuntime; specialtiesRoot: string }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-pipeline-'))
  const specialtiesRoot = join(dataDir, 'specialties')
  const specialist = await createSpecialist(validSpecialist(id), { specialtiesRoot })

  return { specialist, specialtiesRoot }
}

async function createTempAdminData(): Promise<{ dataDir: string }> {
  resetSpecialistRegistryForTests()
  return { dataDir: await mkdtemp(join(tmpdir(), 'ujimu-pipeline-admin-')) }
}

function convertedSource(
  specialistId: string,
  rawPath: string,
  markdownPath: string,
  title: string,
  articleRefs: string[]
) {
  return {
    source_id: `${rawPath}#sha256:original`,
    specialist_id: specialistId,
    raw_path: rawPath,
    checksum: 'sha256:original',
    title,
    article_refs: articleRefs,
    detected_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    conversion: {
      status: 'converted',
      markdown_path: markdownPath,
      markdown_checksum: 'sha256:markdown',
      converted_at: '2026-05-16T00:00:00.000Z'
    },
    ingestion: {
      status: 'pending',
      source_path: markdownPath
    }
  }
}

function pendingConversionSource(specialistId: string, rawPath: string, markdownPath: string) {
  return {
    source_id: `${rawPath}#sha256:pending`,
    specialist_id: specialistId,
    raw_path: rawPath,
    checksum: 'sha256:pending',
    title: rawPath,
    article_refs: [],
    detected_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    conversion: {
      status: 'pending',
      markdown_path: markdownPath
    },
    ingestion: {
      status: 'blocked',
      source_path: markdownPath,
      skipped_reason: 'conversion_pending'
    }
  }
}

function markdownOriginalSource(specialistId: string, rawPath: string, title: string, articleRefs: string[]) {
  return {
    source_id: `${rawPath}#sha256:markdown-original`,
    specialist_id: specialistId,
    raw_path: rawPath,
    checksum: 'sha256:markdown-original',
    title,
    article_refs: articleRefs,
    detected_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    conversion: {
      status: 'not_required',
      markdown_path: rawPath,
      markdown_checksum: 'sha256:markdown-original'
    },
    ingestion: {
      status: 'pending',
      source_path: rawPath
    }
  }
}

function fakeIngestionRunner(
  onIngest: (
    source: Parameters<PiIngestionRunner['ingestSource']>[1],
    specialist: SpecialistRuntime
  ) => void | Promise<void>
): PiIngestionRunner {
  return {
    async ingestSource(specialist, source) {
      await onIngest(source, specialist)
      return { summary: `Ingested ${(source as any).ingestion.source_path}` }
    }
  }
}

function invalidCitationRunner(): ChatEngineRunner {
  return {
    async run() {
      return {
        grounded: true,
        citations: [
          {
            sourceTitle: 'Fonte inventada',
            sourceFile: 'raw/inventado.md',
            articleRefs: ['Artigo 99.º']
          }
        ],
        deltas: toAsyncDeltas(['Resposta com citação inventada.'])
      }
    }
  }
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}

async function collectChatEvents(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []

  for await (const event of events) {
    collected.push(event)
  }

  return collected
}

function joinDeltas(events: ChatStreamEvent[]): string {
  return events
    .filter((event): event is Extract<ChatStreamEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('')
}

async function seedAdmin(dataDir: string): Promise<void> {
  const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('admin-user', '2026-05-16T12:00:00.000Z')
  database
    .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
    .run('admin-user-identity', 'admin-user', 'email', 'admin@example.com', '2026-05-16T12:00:00.000Z')
  database.close()
}

function createAdminFetch(dataDir: string, conversionHandler: unknown): (request: Request) => Promise<Response> {
  const app = createApp()
  const router = createRouter()
  router.get('/api/admin/session', adminSessionHandler)
  router.post('/api/admin/specialists/:id/raw', adminRawUploadHandler)
  router.post('/api/admin/specialists/:id/sources/reload', adminSourcesReloadHandler)
  router.post('/api/admin/specialists/:id/conversion/run', conversionHandler as Parameters<typeof router.post>[1])
  app.use(router)
  const fetch = toWebHandler(app)

  return async (request: Request) => {
    const piAgentDir = join(dataDir, 'pi-agent')
    await mkdir(piAgentDir, { recursive: true })
    await writeFile(
      join(piAgentDir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'openrouter', defaultModel: 'moonshotai/kimi-k2.6' })
    )
    await writeFile(join(piAgentDir, 'models.json'), JSON.stringify({ providers: {} }))

    const previousDataDir = process.env.UJIMU_DATA_DIR
    const previousSessionSecret = process.env.UJIMU_SESSION_SECRET
    const previousAdminContacts = process.env.UJIMU_ADMIN_CONTACTS
    const previousConversionEnabled = process.env.UJIMU_PI_CONVERSION_ENABLED
    const previousConfigDir = process.env.UJIMU_CONFIG_DIR
    const previousConversionProvider = process.env.UJIMU_PI_CONVERSION_PROVIDER
    const previousConversionModel = process.env.UJIMU_PI_CONVERSION_MODEL
    process.env.UJIMU_DATA_DIR = dataDir
    process.env.UJIMU_SESSION_SECRET = 'admin-test-secret'
    process.env.UJIMU_ADMIN_CONTACTS = 'admin@example.com'
    process.env.UJIMU_PI_CONVERSION_ENABLED = 'true'
    process.env.UJIMU_CONFIG_DIR = piAgentDir
    delete process.env.UJIMU_PI_CONVERSION_PROVIDER
    delete process.env.UJIMU_PI_CONVERSION_MODEL

    try {
      return await fetch(request)
    } finally {
      restoreEnv('UJIMU_DATA_DIR', previousDataDir)
      restoreEnv('UJIMU_SESSION_SECRET', previousSessionSecret)
      restoreEnv('UJIMU_ADMIN_CONTACTS', previousAdminContacts)
      restoreEnv('UJIMU_PI_CONVERSION_ENABLED', previousConversionEnabled)
      restoreEnv('UJIMU_CONFIG_DIR', previousConfigDir)
      restoreEnv('UJIMU_PI_CONVERSION_PROVIDER', previousConversionProvider)
      restoreEnv('UJIMU_PI_CONVERSION_MODEL', previousConversionModel)
    }
  }
}

function uploadRequest(url: string, fileName: string, content: string, contentType = 'text/plain'): Request {
  const form = new FormData()
  form.set('file', new Blob([content], { type: contentType }), fileName)
  return new Request(url, {
    method: 'POST',
    headers: sessionHeaders('admin-user'),
    body: form
  })
}

function jsonRequest(url: string, options: { method?: string; body?: unknown } = {}): Request {
  const headers = sessionHeaders('admin-user')
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }

  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
}

function sessionHeaders(userId: string): Headers {
  return new Headers({
    cookie: `ujimu_session=${createSessionToken(userId, {
      sessionSecret: 'admin-test-secret',
      now: new Date('2026-05-16T12:00:00.000Z')
    })}`
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
