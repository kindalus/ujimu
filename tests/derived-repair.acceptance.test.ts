import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDerivedRepairPrompt,
  DerivedRepairExecutionError,
  runStagedDerivedRepair
} from '../server/utils/analytics/derived-repair-runner'

const OLD_DERIVED = `---
type: Derived Analysis
title: "Horas extra"
description: "Resposta antiga."
source_pages:
  - /articles/old.md
tags: [derived]
timestamp: 2026-09-07T10:00:00Z
---

# Horas extra

Resposta antiga.
`

const NEW_DERIVED = `---
type: Derived Analysis
title: "Horas extra"
description: "Resposta corrigida."
source_pages:
  - /articles/old.md
  - /articles/new.md
tags: [derived]
timestamp: 2026-09-07T11:00:00Z
---

# Horas extra

Resposta corrigida com [nova fonte](/articles/new.md).
`

const NEW_ARTICLE = `---
type: Legal Article
title: "Artigo novo"
description: "Condição omitida."
tags: [artigo]
timestamp: 2026-09-07T11:00:00Z
---

# Artigo novo

Condição legal recuperada de converted.
`

describe('staged derived repair acceptance', () => {
  it('requires repaired pages to use content-indicative declarative titles', () => {
    const prompt = buildDerivedRepairPrompt({
      question: 'Quanto se ganha por hora extra?',
      originalAnswer: 'Resposta antiga.',
      baseline: { answer: 'Resposta correcta.', citations: [], consultedDocuments: [] },
      targetPaths: ['wiki/derived/answer.md']
    })

    expect(prompt).toContain("The title must not repeat the user's question verbatim or use an interrogative form")
    expect(prompt).toContain("a concise, declarative title that identifies the synthesis's substantive subject and principal conclusion")
  })

  it('repairs outside the active wiki and promotes only a favourably checked candidate', async () => {
    const fixture = await createRepairFixture()
    const result = await runStagedDerivedRepair({
      specialistRoot: fixture.root,
      verificationId: 'verification-1',
      question: 'Quanto se ganha por hora extra?',
      originalAnswer: 'Resposta antiga.',
      baseline: {
        answer: 'Resposta correcta.', citations: [], consultedDocuments: ['wiki/articles/old.md']
      },
      negativeDerivedPaths: ['wiki/derived/answer.md'],
      adapters: {
        async repair(input) {
          await expect(access(join(input.stagingRoot, 'raw'))).rejects.toThrow()
          await expect(readFile(join(fixture.root, 'wiki', 'derived', 'answer.md'), 'utf8')).resolves.toBe(OLD_DERIVED)
          await writeFile(join(input.stagingRoot, 'wiki', 'derived', 'answer.md'), NEW_DERIVED)
          await writeFile(join(input.stagingRoot, 'wiki', 'articles', 'new.md'), NEW_ARTICLE)
          await writeFile(join(input.stagingRoot, 'wiki', 'index.md'), '# Index\n\n- [Horas extra](/derived/answer.md)\n- [Artigo novo](/articles/new.md)\n')
          await writeFile(join(input.stagingRoot, 'wiki', 'log.md'), '## 2026-09-07\n* **Repair**: [Horas extra](/derived/answer.md).\n')
          return { status: 'repaired' }
        },
        async answer(input) {
          expect(input.cwd).toContain(join('.ujimu', 'verification', 'verification-1'))
          return {
            answer: 'Resposta correcta.', citations: [], consultedDocuments: ['wiki/derived/answer.md']
          }
        },
        async judge() {
          return { level: 'FIEL', reason: 'A candidata recupera a condição.', confidence: 'high' }
        }
      }
    })

    expect(result).toMatchObject({
      status: 'accepted',
      revisions: [{ path: 'wiki/derived/answer.md', revisionSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }]
    })
    await expect(readFile(join(fixture.root, 'wiki', 'derived', 'answer.md'), 'utf8')).resolves.toBe(NEW_DERIVED)
    await expect(readFile(join(fixture.root, 'wiki', 'articles', 'new.md'), 'utf8')).resolves.toBe(NEW_ARTICLE)
    await expect(readFile(join(fixture.root, 'wiki', 'index.md'), 'utf8')).resolves.toContain('/articles/new.md')
    await expect(stat(join(fixture.root, '.ujimu', 'verification', 'verification-1'))).rejects.toThrow()
  })

  it('rejects an insufficiently aligned candidate without changing the active wiki', async () => {
    const fixture = await createRepairFixture()
    await expect(runStagedDerivedRepair({
      specialistRoot: fixture.root,
      verificationId: 'verification-2',
      question: 'Quanto se ganha por hora extra?',
      originalAnswer: 'Resposta antiga.',
      baseline: { answer: 'Resposta correcta.', citations: [], consultedDocuments: [] },
      negativeDerivedPaths: ['wiki/derived/answer.md'],
      adapters: {
        async repair(input) {
          await writeFile(join(input.stagingRoot, 'wiki', 'derived', 'answer.md'), NEW_DERIVED)
          await writeFile(join(input.stagingRoot, 'wiki', 'articles', 'new.md'), NEW_ARTICLE)
          await writeFile(join(input.stagingRoot, 'wiki', 'index.md'), '# Index\n\n- [Horas extra](/derived/answer.md)\n- [Artigo novo](/articles/new.md)\n')
          await writeFile(join(input.stagingRoot, 'wiki', 'log.md'), '## 2026-09-07\n* **Repair**: [Horas extra](/derived/answer.md).\n')
          return { status: 'repaired' }
        },
        async answer() {
          return { answer: 'Ainda incompleta.', citations: [], consultedDocuments: ['wiki/derived/answer.md'] }
        },
        async judge() {
          return { level: 'ALINHADO', reason: 'Ainda falta uma condição.', confidence: 'high' }
        }
      }
    })).rejects.toMatchObject({ code: 'DERIVED_REPAIR_NOT_ACCEPTED' } satisfies Partial<DerivedRepairExecutionError>)

    await expect(readFile(join(fixture.root, 'wiki', 'derived', 'answer.md'), 'utf8')).resolves.toBe(OLD_DERIVED)
    await expect(access(join(fixture.root, 'wiki', 'articles', 'new.md'))).rejects.toThrow()
    await expect(stat(join(fixture.root, '.ujimu', 'verification', 'verification-2'))).rejects.toThrow()
  })

  it('returns an explicit missing-source outcome without promoting staged changes', async () => {
    const fixture = await createRepairFixture()
    const result = await runStagedDerivedRepair({
      specialistRoot: fixture.root,
      verificationId: 'verification-3',
      question: 'Questão sem fonte?',
      originalAnswer: 'Resposta incompleta.',
      baseline: { answer: 'Contexto insuficiente.', citations: [], consultedDocuments: [] },
      negativeDerivedPaths: ['wiki/derived/answer.md'],
      adapters: {
        async repair() { return { status: 'needs_admin_source', reason: 'Falta o diploma oficial.' } },
        async answer() { throw new Error('must not answer') },
        async judge() { throw new Error('must not judge') }
      }
    })

    expect(result).toEqual({ status: 'needs_admin_source', reason: 'Falta o diploma oficial.' })
    await expect(readFile(join(fixture.root, 'wiki', 'derived', 'answer.md'), 'utf8')).resolves.toBe(OLD_DERIVED)
    await expect(stat(join(fixture.root, '.ujimu', 'verification', 'verification-3'))).rejects.toThrow()
  })
})

async function createRepairFixture(): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-derived-repair-'))
  await mkdir(join(root, 'raw'), { recursive: true })
  await mkdir(join(root, 'converted'), { recursive: true })
  await mkdir(join(root, 'wiki', 'derived'), { recursive: true })
  await mkdir(join(root, 'wiki', 'articles'), { recursive: true })
  await writeFile(join(root, 'AGENTS.md'), '# Specialist\n')
  await writeFile(join(root, 'raw', 'secret.md'), 'raw must not be staged')
  await writeFile(join(root, 'converted', 'source.md'), '# Converted source\n\nCondição legal.')
  await writeFile(join(root, 'wiki', 'derived', 'answer.md'), OLD_DERIVED)
  await writeFile(join(root, 'wiki', 'articles', 'old.md'), '# Artigo antigo\n')
  await writeFile(join(root, 'wiki', 'index.md'), '# Index\n\n- [Horas extra](/derived/answer.md)\n')
  await writeFile(join(root, 'wiki', 'log.md'), '## 2026-09-07\n* Original.\n')
  return { root }
}
