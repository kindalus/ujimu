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
import type { IngestionManifest } from '../server/utils/ingestion/types'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('batch ingestion manifest acceptance', () => {
  it('ingests pending Markdown sources in one batch and enriches state from a validated manifest', async () => {
    const { dataDir, specialist } = await createTempSpecialist({ status: 'awaiting_sources' })
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.' })
    await storeRawSource(specialist, { fileName: 'regulamento.md', content: '# Regulamento\n\nArtigo 2.º\nTexto regulamentar.' })
    await scanSpecialistRawSources(specialist)
    const batches: string[][] = []

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: batchRunner(async (targetSpecialist, sources) => {
        batches.push(sources.map((source) => source.raw_path))
        await writeFile(join(targetSpecialist.paths.wiki, 'codigo-iva.md'), '# Código do IVA\n')
        await writeFile(join(targetSpecialist.paths.wiki, 'regulamento.md'), '# Regulamento\n')
        return {
          version: 1,
          specialist_id: targetSpecialist.id,
          ingested: sources.map((source) => ({
            raw_path: source.raw_path,
            source_path: source.ingestion!.source_path,
            wiki_pages: [source.raw_path.startsWith('codigo') ? 'codigo-iva.md' : 'regulamento.md'],
            citations: [{
              source_file: `raw/${source.raw_path}`,
              source_title: source.title,
              article_refs: source.article_refs
            }]
          })),
          failed: []
        }
      })
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(batches).toEqual([['codigo-iva.original.md', 'regulamento.original.md']])
    expect(state.sources['codigo-iva.original.md']).toMatchObject({
      status: 'ingested',
      ingestion: {
        status: 'ingested',
        source_path: 'codigo-iva.original.md',
        wiki_pages: ['codigo-iva.md'],
        citations: [{ source_file: 'raw/codigo-iva.original.md', article_refs: ['Artigo 1.º'] }]
      }
    })
    expect(state.sources['regulamento.original.md'].ingestion?.citations?.[0]).toMatchObject({
      source_file: 'raw/regulamento.original.md',
      source_title: 'Regulamento',
      article_refs: ['Artigo 2.º']
    })
    await expect(readFile(join(specialist.paths.wiki, 'codigo-iva.md'), 'utf8')).resolves.toContain('Código')
    await expect(getSpecialistById('iva', { dataDir })).resolves.toMatchObject({ status: 'active' })
  })

  it('keeps partial failures retryable while publishing the first successful source', async () => {
    const { dataDir, specialist } = await createTempSpecialist({ status: 'awaiting_sources' })
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.' })
    await storeRawSource(specialist, { fileName: 'falha.md', content: '# Fonte incompleta\n\nArtigo 9.º\nTexto.' })
    await scanSpecialistRawSources(specialist)

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: batchRunner(async (targetSpecialist, sources) => {
        await writeFile(join(targetSpecialist.paths.wiki, 'codigo-iva.md'), '# Código do IVA\n')
        const successful = sources.find((source) => source.raw_path === 'codigo-iva.original.md')!
        const failed = sources.find((source) => source.raw_path === 'falha.original.md')!
        return {
          version: 1,
          specialist_id: targetSpecialist.id,
          ingested: [{
            raw_path: successful.raw_path,
            source_path: successful.ingestion!.source_path,
            wiki_pages: ['codigo-iva.md'],
            citations: [{ source_file: `raw/${successful.raw_path}`, source_title: successful.title, article_refs: successful.article_refs }]
          }],
          failed: [{
            raw_path: failed.raw_path,
            source_path: failed.ingestion!.source_path,
            error_code: 'SOURCE_UNREADABLE',
            error_message: 'A fonte não pôde ser integrada.'
          }]
        }
      })
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(state.sources['codigo-iva.original.md'].status).toBe('ingested')
    expect(state.sources['falha.original.md']).toMatchObject({
      status: 'failed',
      ingestion: { status: 'failed', error_code: 'SOURCE_UNREADABLE' }
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
        return {
          version: 1,
          specialist_id: targetSpecialist.id,
          ingested: [{
            raw_path: source.raw_path,
            source_path: source.ingestion!.source_path,
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
