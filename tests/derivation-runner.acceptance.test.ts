import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decideQuestionDerivation } from '../server/utils/analytics/derivation'
import { recordQuestionAnalyticsEvent } from '../server/utils/analytics/questions'
import { initializeDatabase } from '../server/utils/db'
import { runDueBackgroundJobs } from '../server/utils/jobs/background'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

const createUjimuPiSessionMock = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/pi/session', () => ({
  createUjimuPiSession: createUjimuPiSessionMock
}))

describe('transactional derivation runner acceptance', () => {
  beforeEach(() => {
    createUjimuPiSessionMock.mockReset()
    resetSpecialistRegistryForTests()
  })

  it('creates one validated derived page and updates index and log', async () => {
    const fixture = await createFixture()
    const action = queueDerivation(fixture.database)
    let prompt = ''
    createUjimuPiSessionMock.mockImplementation(async (options: any) => ({
      session: {
        prompt: vi.fn(async (value: string) => {
          prompt = value
          const target = join(options.cwd, options.derivationTargetPath)
          await writeFile(target, validDerivedPage())
          await writeFile(join(options.cwd, 'wiki', 'index.md'), '# Index\n\n- [Prazo](/derived/qual-e-o-prazo-para-entregar-declaracao-mensal-de-iva-event123.md)\n')
          await writeFile(join(options.cwd, 'wiki', 'log.md'), '## 2026-09-01\n* **Query filed**: [Prazo](/derived/qual-e-o-prazo-para-entregar-declaracao-mensal-de-iva-event123.md)\n')
        }),
        dispose: vi.fn()
      }
    }))

    const result = await runDueBackgroundJobs({ database: fixture.database, dataDir: fixture.dataDir })

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    expect(createUjimuPiSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: fixture.root,
      task: 'derivation',
      derivationTargetPath: action.targetPath
    }))
    expect(prompt).toContain(`Event ID: ${EVENT_ID}`)
    expect(prompt).toContain(`create exactly ${action.targetPath}`)
    await expect(readFile(join(fixture.root, action.targetPath!), 'utf8')).resolves.toContain('type: Derived Analysis')
    await expect(readFile(join(fixture.root, 'wiki', 'untouched.md'), 'utf8')).resolves.toBe('# Untouched\n')
    fixture.database.close()
  })

  it('restores index and log and removes a partial target when validation fails', async () => {
    const fixture = await createFixture()
    const action = queueDerivation(fixture.database)
    createUjimuPiSessionMock.mockImplementation(async (options: any) => ({
      session: {
        prompt: vi.fn(async () => {
          await writeFile(join(options.cwd, options.derivationTargetPath), 'invalid page\n')
          await writeFile(join(options.cwd, 'wiki', 'index.md'), '# Broken index\n')
          await writeFile(join(options.cwd, 'wiki', 'log.md'), '# Broken log\n')
        }),
        dispose: vi.fn()
      }
    }))

    const result = await runDueBackgroundJobs({ database: fixture.database, dataDir: fixture.dataDir })

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 })
    await expect(readFile(join(fixture.root, 'wiki', 'index.md'), 'utf8')).resolves.toBe('# Index\n')
    await expect(readFile(join(fixture.root, 'wiki', 'log.md'), 'utf8')).resolves.toBe('# Log\n')
    await expect(stat(join(fixture.root, action.targetPath!))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fixture.database.prepare('SELECT last_error_message FROM background_jobs WHERE id = ?').get(action.jobId)).toEqual({
      last_error_message: 'Derivation job failed.'
    })
    fixture.database.close()
  })
})

const EVENT_ID = 'event1234-aaaa-bbbb-cccc-dddddddddddd'

async function createFixture(): Promise<{ dataDir: string; root: string; database: DatabaseSync }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-derivation-runner-'))
  const database = await initializeDatabase({ dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('admin', '2026-09-01T00:00:00.000Z')
  const specialist = await createSpecialist({
    id: 'iva',
    name: 'IVA',
    description: 'Legislação de IVA.',
    wiki_type: 'legislation-regulatory',
    system_prompt: 'Use only the wiki.',
    citations_required: true,
    streaming_enabled: true,
    status: 'active'
  }, { dataDir })
  await mkdir(join(specialist.paths.wiki, 'sources'), { recursive: true })
  await writeFile(join(specialist.paths.root, 'AGENTS.md'), '# Specialist\n')
  await writeFile(join(specialist.paths.wiki, 'index.md'), '# Index\n')
  await writeFile(join(specialist.paths.wiki, 'log.md'), '# Log\n')
  await writeFile(join(specialist.paths.wiki, 'untouched.md'), '# Untouched\n')
  await writeFile(join(specialist.paths.wiki, 'sources', 'lei.md'), '# Source\n')
  return { dataDir, root: specialist.paths.root, database }
}

function queueDerivation(database: DatabaseSync) {
  recordQuestionAnalyticsEvent(database, {
    specialistId: 'iva',
    outcome: 'answered',
    question: 'Qual é o prazo para entregar declaração mensal de IVA?',
    consultedDocumentCount: 4
  })
  database.prepare('UPDATE question_analytics_events SET id = ?').run(EVENT_ID)
  return decideQuestionDerivation(database, {
    eventId: EVENT_ID,
    decision: 'derived',
    adminUserId: 'admin',
    adminContact: 'admin@example.com'
  })
}

function validDerivedPage(): string {
  return `---
type: Derived Analysis
title: "Prazo"
description: "Síntese do prazo legal."
source_pages:
  - /sources/lei.md
tags: [derived]
timestamp: "2026-09-01T12:00:00.000Z"
---

# Prazo

Síntese fundamentada.
`
}
