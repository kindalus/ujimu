import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPendingIngestion } from '../server/utils/ingestion/run'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { readIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getSpecialistById, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { PiIngestionRunner } from '../server/utils/ingestion/pi-runner'
import type { IngestionManifest, IngestionSourceRecord } from '../server/utils/ingestion/types'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('batch ingestion manifest acceptance', () => {
  it('converts and ingests pending raw sources in one batch and enriches state from a validated v2 manifest', async () => {
    const { dataDir, specialist } = await createTempSpecialist({ status: 'awaiting_sources' })
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.' })
    await storeRawSource(specialist, { fileName: 'regulamento.txt', content: 'Regulamento\n\nArtigo 2.º\nTexto regulamentar.' })
    await scanSpecialistRawSources(specialist)
    const batches: string[][] = []

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: batchRunner(async (targetSpecialist, sources) => {
        batches.push(sources.map((source) => source.raw_path))
        await writeFile(join(targetSpecialist.paths.wiki, 'codigo-iva.md'), '# Código do IVA\n')
        await writeFile(join(targetSpecialist.paths.wiki, 'regulamento.md'), '# Regulamento\n')
        const processed = []
        for (const source of sources) {
          const convertedPath = `${source.raw_path}.md`
          const convertedSha = await writeConvertedSource(targetSpecialist, source, convertedPath)
          processed.push({
            raw_path: source.raw_path,
            source_path: convertedPath,
            converted_path: convertedPath,
            source_sha256: source.checksum,
            converted_sha256: convertedSha,
            conversion_status: source.raw_path.endsWith('.original.md') ? 'passthrough' as const : 'full' as const,
            wiki_pages: [source.raw_path.startsWith('codigo') ? 'codigo-iva.md' : 'regulamento.md'],
            citations: [{
              source_file: `raw/${source.raw_path}`,
              source_title: source.title,
              article_refs: source.article_refs.length > 0 ? source.article_refs : ['Artigo 2.º']
            }],
            warnings: []
          })
        }
        return { version: 2, specialist_id: targetSpecialist.id, processed, failed: [] }
      })
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(batches).toEqual([['codigo-iva.original.md', 'regulamento.txt']])
    expect(state.sources['codigo-iva.original.md']).toMatchObject({
      status: 'ingested',
      conversion: {
        status: 'converted',
        markdown_path: 'codigo-iva.original.md.md',
        conversion_status: 'passthrough',
        markdown_checksum: expect.stringMatching(/^sha256:/)
      },
      ingestion: {
        status: 'ingested',
        source_path: 'codigo-iva.original.md.md',
        wiki_pages: ['codigo-iva.md'],
        citations: [{ source_file: 'raw/codigo-iva.original.md', article_refs: ['Artigo 1.º'] }]
      }
    })
    expect(state.sources['regulamento.txt'].conversion).toMatchObject({
      status: 'converted',
      markdown_path: 'regulamento.txt.md',
      conversion_status: 'full'
    })
    expect(state.sources['regulamento.txt'].ingestion?.citations?.[0]).toMatchObject({
      source_file: 'raw/regulamento.txt',
      source_title: 'Regulamento',
      article_refs: ['Artigo 2.º']
    })
    await expect(readFile(join(specialist.paths.converted, 'codigo-iva.original.md.md'), 'utf8')).resolves.toContain('Conversion status')
    await expect(readFile(join(specialist.paths.wiki, 'codigo-iva.md'), 'utf8')).resolves.toContain('Código')
    await expect(getSpecialistById('iva', { dataDir })).resolves.toMatchObject({ status: 'active' })
  })

  it('keeps conversion or ingestion failures retryable while publishing the first successful source', async () => {
    const { dataDir, specialist } = await createTempSpecialist({ status: 'awaiting_sources' })
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.' })
    await storeRawSource(specialist, { fileName: 'falha.pdf', content: Buffer.from('%PDF-1.7 fonte incompleta') })
    await scanSpecialistRawSources(specialist)

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: batchRunner(async (targetSpecialist, sources) => {
        await writeFile(join(targetSpecialist.paths.wiki, 'codigo-iva.md'), '# Código do IVA\n')
        const successful = sources.find((source) => source.raw_path === 'codigo-iva.original.md')!
        const failed = sources.find((source) => source.raw_path === 'falha.pdf')!
        const convertedPath = `${successful.raw_path}.md`
        const convertedSha = await writeConvertedSource(targetSpecialist, successful, convertedPath)
        return {
          version: 2,
          specialist_id: targetSpecialist.id,
          processed: [{
            raw_path: successful.raw_path,
            source_path: convertedPath,
            converted_path: convertedPath,
            source_sha256: successful.checksum,
            converted_sha256: convertedSha,
            conversion_status: 'passthrough',
            wiki_pages: ['codigo-iva.md'],
            citations: [{ source_file: `raw/${successful.raw_path}`, source_title: successful.title, article_refs: successful.article_refs }],
            warnings: []
          }],
          failed: [{
            raw_path: failed.raw_path,
            stage: 'conversion',
            converted_path: `${failed.raw_path}.md`,
            conversion_status: 'failed',
            error_code: 'CONVERSION_FAILED',
            error_message: 'A fonte não pôde ser convertida.'
          }]
        }
      })
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(state.sources['codigo-iva.original.md'].status).toBe('ingested')
    expect(state.sources['falha.pdf']).toMatchObject({
      status: 'failed',
      conversion: { status: 'failed', conversion_status: 'failed' },
      ingestion: { status: 'failed', error_code: 'CONVERSION_FAILED' }
    })
    await expect(getSpecialistById('iva', { dataDir })).resolves.toMatchObject({ status: 'active' })
  })

  it('rejects invalid manifests without marking pending sources as ingested or failed', async () => {
    const { specialist } = await createTempSpecialist({ status: 'awaiting_sources' })
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.' })
    await scanSpecialistRawSources(specialist)

    await expect(runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: batchRunner(async (targetSpecialist, sources) => {
        await writeFile(join(targetSpecialist.paths.wiki, 'codigo-iva.md'), '# Código do IVA\n')
        const source = sources[0]!
        const convertedPath = `${source.raw_path}.md`
        const convertedSha = await writeConvertedSource(targetSpecialist, source, convertedPath)
        return {
          version: 2,
          specialist_id: targetSpecialist.id,
          processed: [{
            raw_path: source.raw_path,
            source_path: convertedPath,
            converted_path: convertedPath,
            source_sha256: source.checksum,
            converted_sha256: convertedSha,
            conversion_status: 'passthrough',
            wiki_pages: ['codigo-iva.md'],
            citations: [{ source_file: 'raw/outra-fonte.md', source_title: source.title, article_refs: source.article_refs }]
          }],
          failed: []
        }
      })
    })).rejects.toMatchObject({ code: 'INGESTION_MANIFEST_INVALID' })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(state.sources['codigo-iva.original.md']).toMatchObject({
      status: 'pending',
      conversion: { status: 'pending' },
      ingestion: { status: 'pending' }
    })
    expect(state.sources['codigo-iva.original.md'].ingestion).not.toHaveProperty('citations')
  })
})

async function createTempSpecialist(overrides: Partial<SpecialistRuntime> = {}): Promise<{ dataDir: string; specialist: SpecialistRuntime }> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-batch-ingestion-'))
  const specialist = await createSpecialist(
    {
      id: 'iva',
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      citations_required: true,
      streaming_enabled: true,
      status: overrides.status ?? 'active'
    },
    { dataDir }
  )
  await mkdir(specialist.paths.wiki, { recursive: true })
  await mkdir(specialist.paths.converted, { recursive: true })
  await writeFile(join(specialist.paths.root, 'AGENTS.md'), '# Wiki schema\n')
  await writeFile(join(specialist.paths.wiki, 'index.md'), '# Índice\n')
  await writeFile(join(specialist.paths.wiki, 'log.md'), '# Log\n')
  return { dataDir, specialist: { ...specialist, ...overrides } }
}

function batchRunner(
  ingestSources: (specialist: SpecialistRuntime, sources: Parameters<NonNullable<PiIngestionRunner['ingestSources']>>[1]) => Promise<IngestionManifest>
): PiIngestionRunner {
  return {
    async ingestSource() {
      throw new Error('This test expects batch ingestion.')
    },
    ingestSources
  }
}

async function writeConvertedSource(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord,
  convertedPath: string
): Promise<string> {
  const content = `---\ntype: Converted Source\ntitle: "${source.title}"\nsource_path: ../raw/${source.raw_path}\nsource_format: ${source.raw_path.split('.').at(-1) ?? 'txt'}\nsource_sha256: "${source.checksum}"\nconverted_at: 2026-06-27T00:00:00.000Z\nconversion_status: ${source.raw_path.endsWith('.original.md') ? 'passthrough' : 'full'}\nconversion_method: "test"\nwarnings: []\n---\n\n# Conversion status\n\n${source.title}\n`
  await writeFile(join(specialist.paths.converted, convertedPath), content)
  return toChecksum(content)
}

function toChecksum(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
