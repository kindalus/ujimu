import { readFile, stat } from 'node:fs/promises'
import { mkdtemp, writeFile } from 'node:fs/promises'
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

    expect(stored.relativePath).toBe('codigo-iva.original.md')
    expect(stored.absolutePath).toBe(join(specialist.paths.raw, 'codigo-iva.original.md'))
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
    const source = state.sources['codigo-iva.original.md']

    expect(source).toMatchObject({
      specialist_id: 'iva',
      raw_path: 'codigo-iva.original.md',
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
    firstScan.sources['codigo-iva.original.md'].status = 'ingested'
    firstScan.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
    firstScan.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
    await import('../server/utils/ingestion/state').then(({ writeIngestionState }) =>
      writeIngestionState(specialist.paths.ingestState, firstScan)
    )

    const secondScan = await scanSpecialistRawSources(specialist)

    expect(Object.keys(secondScan.sources)).toEqual(['codigo-iva.original.md'])
    expect(secondScan.sources['codigo-iva.original.md'].status).toBe('ingested')
    expect(secondScan.sources['codigo-iva.original.md'].ingested_at).toBe('2026-05-16T00:00:00.000Z')
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
    expect(state.sources['codigo-iva.original.md'].status).toBe('pending')
  })

  it('runs Pi ingestion one textual source at a time and records ingested citation metadata', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    await scanSpecialistRawSources(specialist)
    const ingested: string[] = []

    await runPendingIngestionWithWikiOutput(specialist, ingested)

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(ingested).toEqual(['codigo-iva.original.md'])
    expect(state.sources['codigo-iva.original.md']).toMatchObject({
      status: 'ingested',
      title: 'Código do IVA',
      article_refs: ['Artigo 1.º']
    })
    expect(state.sources['codigo-iva.original.md']).not.toHaveProperty('error_code')
    expect(state.sources['codigo-iva.original.md']).not.toHaveProperty('error_message')
    expect(state.sources['codigo-iva.original.md'].ingested_at).toBeTruthy()
  })

  it('does not mark ingestion as successful when Pi completes without wiki output', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    await scanSpecialistRawSources(specialist)

    await runPendingIngestion(specialist, {
      piIngestionEnabled: true,
      runner: fakeRunner()
    })

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(state.sources['codigo-iva.original.md']).toMatchObject({
      status: 'failed',
      ingestion: {
        status: 'failed',
        error_code: 'WIKI_OUTPUT_MISSING'
      }
    })
  })

  it('reprocesses previously ingested sources when the wiki output is missing', async () => {
    const specialist = await createTempSpecialist('iva')
    await storeRawSource(specialist, {
      fileName: 'codigo-iva.md',
      content: '# Código do IVA\n\nArtigo 1.º\nTexto legal.'
    })
    const firstScan = await scanSpecialistRawSources(specialist)
    firstScan.sources['codigo-iva.original.md'].status = 'ingested'
    firstScan.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
    firstScan.sources['codigo-iva.original.md'].ingested_at = '2026-05-16T00:00:00.000Z'
    await import('../server/utils/ingestion/state').then(({ writeIngestionState }) =>
      writeIngestionState(specialist.paths.ingestState, firstScan)
    )
    const ingested: string[] = []

    await runPendingIngestionWithWikiOutput(specialist, ingested)

    const state = await readIngestionState(specialist.paths.ingestState)
    expect(ingested).toEqual(['codigo-iva.original.md'])
    expect(state.sources['codigo-iva.original.md'].status).toBe('ingested')
  })

  it('keeps PDF sources blocked until manual conversion succeeds', async () => {
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
      status: 'blocked',
      conversion: { status: 'pending', markdown_path: 'scan.pdf.md' },
      ingestion: { status: 'blocked', source_path: 'scan.pdf.md' }
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

async function runPendingIngestionWithWikiOutput(specialist: SpecialistRuntime, ingested: string[]): Promise<void> {
  await runPendingIngestion(specialist, {
    piIngestionEnabled: true,
    runner: fakeRunner(async (source, targetSpecialist) => {
      ingested.push(source.raw_path)
      await writeFile(join(targetSpecialist.paths.wiki, 'index.md'), `# Wiki\n\nSource: ${source.raw_path}\n`)
    })
  })
}

function fakeRunner(
  onIngest?: (
    source: Parameters<PiIngestionRunner['ingestSource']>[1],
    specialist: SpecialistRuntime
  ) => void | Promise<void>
): PiIngestionRunner {
  return {
    async ingestSource(specialist, source) {
      await onIngest?.(source, specialist)
      return { summary: `Ingested ${source.raw_path}` }
    }
  }
}
