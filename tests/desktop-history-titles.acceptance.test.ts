import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createChatEventStreamFromBody } from '../server/utils/chat/engine'
import { buildChatPrompt } from '../server/utils/chat/pi-runner'
import { initializeDatabase } from '../server/utils/db'
import { getConversation, persistCompletedHistoryTurn } from '../server/utils/history/repository'
import { scanSpecialistRawSources } from '../server/utils/ingestion/detect'
import { writeIngestionState } from '../server/utils/ingestion/state'
import { storeRawSource } from '../server/utils/ingestion/storage'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

const citation = { sourceTitle: 'Código do IVA', sourceFile: 'raw/codigo.md', articleRefs: ['Artigo 1.º'] }

describe('desktop history and generated titles acceptance', () => {
  it('keeps the chat drawer permanently accessible only from the desktop breakpoint', async () => {
    const drawer = await import('node:fs/promises').then(({ readFile }) => readFile('components/AppDrawer.vue', 'utf8'))
    const page = await import('node:fs/promises').then(({ readFile }) => readFile('pages/index.vue', 'utf8'))
    const css = await import('node:fs/promises').then(({ readFile }) => readFile('assets/css/main.css', 'utf8'))

    expect(page).toContain('class="app ujimu-runtime app--chat"')
    expect(page).toContain(':permanent-on-desktop="true"')
    expect(drawer).toContain("window.matchMedia('(min-width: 1024px)')")
    expect(drawer).toContain("'drawer--permanent': isPermanent")
    expect(drawer).toContain(':aria-hidden="isPermanent ? false : !drawerOpen"')
    expect(drawer).toContain(':inert="isPermanent ? undefined : !drawerOpen"')
    expect(css).toMatch(/@media\s*\(min-width:\s*1024px\)[\s\S]*\.app--chat\s+\.stage[\s\S]*margin-left:\s*320px/)
  })

  it('persists a validated title emitted by the response run without a title runner', async () => {
    resetSpecialistRegistryForTests()
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-title-'))
    const specialtiesRoot = join(dataDir, 'specialties')
    await createSpecialist({
      id: 'iva', name: 'IVA', description: 'IVA', wiki_type: 'legislation-regulatory',
      system_prompt: 'Answer only from the wiki.', citations_required: true, streaming_enabled: true
    }, { specialtiesRoot })
    const specialist = (await import('../server/utils/specialists/registry')).getSpecialistById
    const loaded = await specialist('iva', { specialtiesRoot })
    if (!loaded) throw new Error('specialist missing')
    await storeRawSource(loaded, { fileName: 'codigo.md', content: '# Código' })
    const state = await scanSpecialistRawSources(loaded)
    const source = state.sources['codigo.original.md']
    source.status = 'ingested'
    source.ingestion!.status = 'ingested'
    source.ingestion!.citations = [{ source_title: citation.sourceTitle, source_file: citation.sourceFile, article_refs: citation.articleRefs }]
    source.ingestion!.manifest_validated_at = '2026-08-23T00:00:00.000Z'
    source.ingested_at = '2026-08-23T00:00:00.000Z'
    await writeIngestionState(loaded.paths.ingestState, state)

    const database = await initializeDatabase({ dbPath: join(dataDir, 'db.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', '2026-08-23T00:00:00.000Z')
    const stream = await createChatEventStreamFromBody(
      { specialistId: 'iva', question: 'Como funciona a dedução?' },
      {
        specialtiesRoot,
        runner: { async run() { return { grounded: true, citations: [citation], title: '  Dedução   do IVA  ', deltas: deltas('Resposta.') } } },
        history: { database, subject: { type: 'registered', id: 'user-a' } }
      }
    )
    const events = []
    for await (const event of stream) events.push(event)
    const history = events.find((event) => event.type === 'history')
    expect(history).toMatchObject({ title: 'Dedução do IVA', titleStatus: 'generated' })
    expect(getConversation(database, { userId: 'user-a', conversationId: history!.conversationId })).toMatchObject({
      title: 'Dedução do IVA', titleStatus: 'generated'
    })
    database.close()
  })

  it('rejects generic title labels and shows only the useful conversation title in history', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-generic-title-'))
    const database = await initializeDatabase({ dbPath: join(dataDir, 'db.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', '2026-08-23T00:00:00.000Z')
    const persisted = await persistCompletedHistoryTurn(database, {
      userId: 'user-a', specialistId: 'iva', specialistName: 'IVA',
      question: 'Como funciona a dedução?', answer: 'Resposta.', grounded: true, citations: [],
      generatedTitle: '  TÍTULO GERADO.  '
    })
    expect(persisted).toMatchObject({ title: 'Como funciona a dedução?', titleStatus: 'pending' })

    const page = await import('node:fs/promises').then(({ readFile }) => readFile('pages/index.vue', 'utf8'))
    expect(page).toContain('{{ conversation.title }}')
    expect(page).not.toContain("conversation.titleStatus === 'pending' ? 'Título pendente' : 'Título gerado'")
    database.close()
  })

  it('asks the response model for a specific optional title and keeps it outside answer text', () => {
    const prompt = buildChatPrompt({ specialist: {} as never, question: 'Pergunta', citationEvidence: [] })
    expect(prompt).toContain('{"type":"title","title":"Prazo legal para férias"}')
    expect(prompt).toContain('at most 80 characters')
    expect(prompt).toContain('Never use a generic label')
  })
})

async function* deltas(...values: string[]): AsyncIterable<string> {
  yield* values
}
