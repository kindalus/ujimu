import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCitationEvidence } from '../server/utils/chat/context'
import { buildChatPrompt } from '../server/utils/chat/pi-runner'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import type { SpecialistRuntime } from '../server/utils/specialists/schema'

describe('state-driven citations and minimal chat envelope acceptance', () => {
  it('builds citation evidence from validated ingestion citations instead of legacy source metadata', async () => {
    const specialist = await createTempSpecialist()
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto.' })
    const state = await scanSpecialistRawSources(specialist)
    const source = state.sources['codigo-iva.original.md']
    source.status = 'ingested'
    source.title = 'Título legado que não deve aparecer'
    source.article_refs = ['Artigo legado']
    source.ingestion = {
      ...source.ingestion!,
      status: 'ingested',
      source_path: 'codigo-iva.original.md',
      citations: [{
        source_file: 'raw/codigo-iva.original.md',
        source_title: 'Código do IVA validado',
        article_refs: ['Artigo 7.º']
      }],
      wiki_pages: ['codigo-iva.md'],
      manifest_validated_at: '2026-06-12T12:00:00.000Z'
    }
    await writeIngestionState(specialist.paths.ingestState, state)

    await expect(getCitationEvidence(specialist)).resolves.toEqual([{
      sourceTitle: 'Código do IVA validado',
      sourceFile: 'raw/codigo-iva.original.md',
      articleRefs: ['Artigo 7.º']
    }])
  })

  it('does not allow ingested sources without validated citation metadata', async () => {
    const specialist = await createTempSpecialist()
    await storeRawSource(specialist, { fileName: 'codigo-iva.md', content: '# Código do IVA\n\nArtigo 1.º\nTexto.' })
    const state = await scanSpecialistRawSources(specialist)
    state.sources['codigo-iva.original.md'].status = 'ingested'
    state.sources['codigo-iva.original.md'].ingestion!.status = 'ingested'
    await writeIngestionState(specialist.paths.ingestState, state)

    await expect(getCitationEvidence(specialist)).resolves.toEqual([])
  })

  it('builds a minimal chat prompt without specialist metadata, citation allowlists, persona, or protocol', () => {
    const specialist = createPromptSpecialist('Use the customs classification output format.')
    const prompt = buildChatPrompt({
      specialist,
      question: 'Classifica este produto.',
      citationEvidence: [{ sourceTitle: 'Pauta Aduaneira', sourceFile: 'raw/pauta.md', articleRefs: ['ARTIGO 1.º'] }]
    })

    expect(prompt).toContain('Answer the user question using this specialist workspace')
    expect(prompt).toContain('User question:')
    expect(prompt).not.toContain('Selected specialist:')
    expect(prompt).not.toContain('Backend citation allowlist')
    expect(prompt).not.toContain('{"type":"delta","text":"..."}')
    expect(prompt).not.toContain('Specialist system prompt')
    expect(prompt).not.toContain('Use the customs classification output format.')
    expect(prompt).not.toContain('Do not answer from general model knowledge')
    expect(prompt).not.toContain('Every substantive answer')
  })
})

async function createTempSpecialist(): Promise<SpecialistRuntime> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-state-citations-'))
  return createSpecialist(
    {
      id: 'iva',
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      citations_required: true,
      streaming_enabled: true
    },
    { dataDir }
  )
}

function createPromptSpecialist(systemPrompt: string): SpecialistRuntime {
  return {
    id: 'pauta-aduaneira',
    name: 'Pauta Aduaneira',
    description: 'Classifica produtos conforme a pauta aduaneira.',
    wiki_type: 'legislation-regulatory',
    system_prompt: systemPrompt,
    citations_required: true,
    streaming_enabled: true,
    status: 'active',
    company_id: null,
    paths: {
      root: '/tmp/pauta-aduaneira',
      config: '/tmp/pauta-aduaneira/specialist.yaml',
      raw: '/tmp/pauta-aduaneira/raw',
      converted: '/tmp/pauta-aduaneira/converted',
      wiki: '/tmp/pauta-aduaneira/wiki',
      ingest: '/tmp/pauta-aduaneira/ingest',
      ingestState: '/tmp/pauta-aduaneira/ingest/state.json'
    }
  }
}
