import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '../server/utils/db'
import { persistCompletedHistoryTurn } from '../server/utils/history/repository'
import {
  BackgroundJobConflictError,
  enqueueSpecialistHardResetJob,
  enqueueSpecialistIngestionJob,
  runDueBackgroundJobs
} from '../server/utils/jobs/background'
import { createSpecialist } from '../server/utils/specialists/manager'
import { getSpecialistById, resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import { readIngestionState } from '../server/utils/ingestion/state'

describe('specialist hard reset acceptance', () => {
  it('preserves only raw content, config identity and global records while deleting all specialist-derived data', async () => {
    resetSpecialistRegistryForTests()
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-hard-reset-'))
    const database = await initializeDatabase({ dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('admin', '2026-08-23T00:00:00.000Z')
    database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('customer', '2026-08-23T00:00:00.000Z')
    const specialist = await createSpecialist({
      id: 'iva', name: 'IVA Angola', description: 'Legislação IVA', wiki_type: 'legislation-regulatory',
      system_prompt: 'Prompt aprovado', citations_required: true, streaming_enabled: true,
      status: 'active', company_id: 'company-a',
      seo: { title: 'IVA', description: 'SEO IVA', topics: ['Dedução'] }
    }, { dataDir })
    await mkdir(join(specialist.paths.raw, 'leis'), { recursive: true })
    await writeFile(join(specialist.paths.raw, 'leis', 'codigo.pdf'), Buffer.from([0, 1, 2, 255]))
    await writeFile(join(specialist.paths.raw, '._codigo.pdf'), 'AppleDouble metadata')
    const rawHash = hash(await readFile(join(specialist.paths.raw, 'leis', 'codigo.pdf')))
    await writeFile(join(specialist.paths.converted, 'old.md'), 'DERIVADO ANTIGO')
    await writeFile(join(specialist.paths.wiki, 'old.md'), 'WIKI ANTIGA')
    await writeFile(join(specialist.paths.root, 'AGENTS.md'), 'AGENTE ANTIGO')
    await writeFile(join(specialist.paths.root, 'unknown.secret'), 'NÃO SOBREVIVE')
    await mkdir(join(specialist.paths.root, 'logs'), { recursive: true })
    await writeFile(join(specialist.paths.root, 'logs', 'old.ndjson'), '{}')
    await mkdir(join(dataDir, 'pi', 'chat-sessions', 'registered', 'iva', 'old-session'), { recursive: true })
    await writeFile(join(dataDir, 'pi', 'chat-sessions', 'registered', 'iva', 'old-session', 'session.jsonl'), '{}')

    const conversation = await persistCompletedHistoryTurn(database, {
      userId: 'customer', specialistId: 'iva', specialistName: 'IVA Angola', question: 'Pergunta', answer: 'Resposta',
      grounded: true, citations: []
    })
    database.prepare(`INSERT INTO question_analytics_events
      (id, specialist_id, outcome, question_text, normalized_question, fingerprint, occurred_at, user_timezone, visitor_id, user_id, conversation_id, user_message_id)
      VALUES ('q1','iva','answered','Pergunta','pergunta','fp','2026-08-23T00:00:00.000Z','UTC',NULL,'customer',?,?)`
    ).run(conversation.conversationId, conversation.userMessageId)
    database.prepare(`INSERT INTO question_analytics_reviews
      (specialist_id, fingerprint, reviewed_at, reviewed_by_user_id, reviewed_by_contact)
      VALUES ('iva','fp','2026-08-23T00:00:00.000Z','admin','admin@example.com')`).run()
    database.prepare(`INSERT INTO request_events
      (id, subject_type, subject_id, specialist_id, occurred_at_utc, user_timezone, counted, decision, denial_reason)
      VALUES ('quota1','registered','customer','iva','2026-08-23T00:00:00.000Z','UTC',1,'allowed',NULL)`).run()

    const job = enqueueSpecialistHardResetJob(database, {
      specialistId: 'iva', requestedByUserId: 'admin', requestedByContact: 'admin@example.com'
    })
    const result = await runDueBackgroundJobs({
      database, dataDir,
      initializationRunner: { async initializeSpecialist(current) {
        await writeFile(join(current.paths.root, 'AGENTS.md'), 'llm-wiki only source of truth lacks sufficient evidence cite the original document title and relevant articles do not expose physical or internal file paths to the user read and apply the `unslop` skill. During normal user consultations, never create, edit, or delete `wiki/derived/`. Only an explicit derivation job initiated by an administrator may create or update derived knowledge.')
        await writeFile(join(current.paths.wiki, 'index.md'), '# Índice novo')
        await writeFile(join(current.paths.wiki, 'log.md'), '# Log novo')
      } }
    })
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    expect(job.type).toBe('specialist_hard_reset')
    expect(hash(await readFile(join(specialist.paths.raw, 'leis', 'codigo.pdf')))).toBe(rawHash)
    expect((await readdir(specialist.paths.root)).sort()).toEqual(['AGENTS.md', 'converted', 'ingest', 'raw', 'specialist.yaml', 'wiki'])
    await expect(stat(join(specialist.paths.root, 'unknown.secret'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(dataDir, 'trash'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(dataDir, 'pi', 'chat-sessions', 'registered', 'iva'))).rejects.toMatchObject({ code: 'ENOENT' })

    const reloaded = await getSpecialistById('iva', { dataDir })
    expect(reloaded).toMatchObject({
      name: 'IVA Angola', system_prompt: 'Prompt aprovado', company_id: 'company-a', status: 'awaiting_sources',
      seo: { title: 'IVA', description: 'SEO IVA', topics: ['Dedução'] }
    })
    const state = await readIngestionState(reloaded!.paths.ingestState)
    expect(state.sources['leis/codigo.pdf']).toMatchObject({ status: 'pending' })
    expect(state.sources['._codigo.pdf']).toBeUndefined()
    expect(await readFile(join(specialist.paths.raw, '._codigo.pdf'), 'utf8')).toBe('AppleDouble metadata')
    expect(database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE specialist_id = ?').get('iva')).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM question_analytics_events WHERE specialist_id = ?').get('iva')).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM question_analytics_reviews WHERE specialist_id = ?').get('iva')).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM request_events WHERE specialist_id = ?').get('iva')).toEqual({ count: 1 })
    expect(database.prepare("SELECT action FROM admin_audit_events WHERE specialist_id = 'iva' ORDER BY occurred_at").all()).toEqual([
      { action: 'specialist_hard_reset_completed' }
    ])
    database.close()
  })

  it('refuses a reset while any specialist job is active', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-hard-reset-conflict-'))
    const database = await initializeDatabase({ dbPath: join(dataDir, 'db.sqlite') })
    enqueueSpecialistIngestionJob(database, { specialistId: 'iva' })
    expect(() => enqueueSpecialistHardResetJob(database, {
      specialistId: 'iva', requestedByUserId: 'admin', requestedByContact: 'admin@example.com'
    })).toThrow(BackgroundJobConflictError)
    database.close()
  })

  it('requires exact-id confirmation in the admin UI and endpoint', async () => {
    const page = await readFile('pages/admin/specialists/[id].vue', 'utf8')
    const endpoint = await readFile('server/api/admin/specialists/[id]/reset.post.ts', 'utf8')
    expect(page).toContain('confirmResetId')
    expect(page).toContain('Reinicializar completamente')
    expect(endpoint).toContain('confirmationId !== specialistId')
    expect(endpoint).toContain('statusCode: 409')
  })
})

function hash(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
