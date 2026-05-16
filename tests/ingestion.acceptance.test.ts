import { readFile, stat } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { readIngestionState } from '../server/utils/ingestion/state'
import { runPendingIngestion } from '../server/utils/ingestion/run'
import { storeRawSource } from '../server/utils/ingestion/storage'
import type { PiIngestionRunner } from '../server/utils/ingestion/pi-runner'

describe('legislation wiki raw ingestion acceptance', () => {
  it('stores an uploaded source in the specialist raw directory', async () => {
    const specialist = await createTempSpecialist('iva')

    const stored = await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })

    expect(stored.relativePath).toBe('codigo-iva.md')
    expect(stored.absolutePath).toBe(join(specialist.paths.raw, 'codigo-iva.md'))
    expect((await stat(stored.absolutePath)).isFile()).toBe(true)
    await expect(readFile(stored.absolutePath, 'utf8')).resolves.toContain('Artigo 1.º')
  })

  it('detects pending raw files and records checksum-based source state', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.\nArt. 12\nMais texto.'
    })

    const state = await scanSpecialistRawSources(specialist)
    const source = state.sources['codigo-iva.md']

    expect(source).toMatchObject({
      specialist_id: 'iva',
      raw_path: 'codigo-iva.md',
      status: 'pending',
      title: 'Código do IVA',
      article_refs: ['Artigo 1.º', 'Art. 12']
    })
    expect(source.checksum).toMatch(/^sha256:/)
    expect(source.source_id).toContain(source.checksum)
  })

  it('does not duplicate already-ingested files when they are unchanged', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })

    const firstScan = await scanSpecialistRawSources(specialist)
    firstScan.sources['codigo-iva.md'].status = 'ingested'
    firstScan.sources['codigo-iva.md'].ingested_at = '2026-05-16T00:00:00.000Z'
    await import('../server/utils/ingestion/state').then(({ writeIngestionState }) =>
      writeIngestionState(specialist.paths.ingestState, firstScan)
    )

    const secondScan = await scanSpecialistRawSources(specialist)

    expect(Object.keys(secondScan.sources)).toEqual(['codigo-iva.md'])
    expect(secondScan.sources['codigo-iva.md'].status).toBe('ingested')
    expect(secondScan.sources['codigo-iva.md'].ingested_at).toBe('2026-05-16T00:00:00.000Z')
  })

  it('keeps pending sources pending when Pi ingestion is disabled', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    await scanSpecialistRawSources(specialist)

    await expect(
      runPendingIngestion(specialist, {
        piIngestionEnabled: false,
        runner: fakeRunner()
      })
    ).rejects.toMatchObject({ code: 'PI_INGESTION_DISABLED' })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(state.sources['codigo-iva.md'].status).toBe('pending')
  })

  it('runs Pi ingestion one textual source at a time and records ingested citation metadata', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    await scanSpecialistRawSources(specialist)
    const ingested: string[] = []

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: fakeRunner((source) => ingested.push(source.raw_path))
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(ingested).toEqual(['codigo-iva.md'])
    expect(state.sources['codigo-iva.md']).toMatchObject({
      status: 'ingested',
      title: 'Código do IVA',
      article_refs: ['Artigo 1.º']
    })
    expect(state.sources['codigo-iva.md']).not.toHaveProperty('error_code')
    expect(state.sources['codigo-iva.md']).not.toHaveProperty('error_message')
    expect(state.sources['codigo-iva.md'].ingested_at).toBeTruthy()
  })

  it('reports PDF sources as unsupported without corrupting ingestion state', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'scan.pdf',
      content: Buffer.from('%PDF-1.7 fake scanned pdf')
    })
    await scanSpecialistRawSources(specialist)

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: fakeRunner(() => {
        throw new Error('PDF should not reach Pi in this slice')
      })
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(state.sources['scan.pdf']).toMatchObject({
      status: 'failed',
      error_code: 'UNSUPPORTED_SOURCE_TYPE',
      error_message: 'PDF text extraction is not available in this slice.'
    })
    expect(state.sources['scan.pdf'].checksum).toMatch(/^sha256:/)
  })
})

async function createTempSpecialist(id: string): Promise<SpecialistRuntime> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-ingestion-'))
  const specialtiesRoot = join(dataDir, 'specialties')

  return createSpecialist(
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
}

function fakeRunner(onIngest?: (source: Parameters<PiIngestionRunner['ingestSource']>[1]) => void): PiIngestionRunner {
  return {
    async ingestSource(_specialist, source) {
      onIngest?.(source)
      return { summary: `Ingested ${source.raw_path}` }
    }
  }
}
