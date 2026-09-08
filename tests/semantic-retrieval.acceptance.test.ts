import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { recordQuestionAnalyticsEvent } from '../server/utils/analytics/questions'
import {
  createSemanticRanker,
  lookupRetrievalHintsWithSemantic,
  SEMANTIC_RETRIEVAL_MARGIN,
  SEMANTIC_RETRIEVAL_SCORE_THRESHOLD
} from '../server/utils/chat/semantic-retrieval'
import { storeRetrievalHints, type SemanticRetrievalCandidate } from '../server/utils/chat/retrieval-cache'
import { initializeDatabase } from '../server/utils/db'

describe('semantic retrieval acceptance', () => {
  it('preserves disabled, exact, and strong lexical paths before semantic matching', async () => {
    const database = await createDatabase()
    const now = new Date('2026-09-08T10:00:00.000Z')
    seedHint(database, 'iva', 'Qual é o prazo para entregar declaração mensal de IVA?', ['wiki/prazos.md'], now)
    const rank = vi.fn(async () => [])

    await expect(lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'iva', question: 'Quando entrego o imposto?', now
    }, { semanticEnabled: false, rankSemanticCandidates: rank })).resolves.toBeUndefined()

    await expect(lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'iva', question: 'Qual é o prazo para entregar declaração mensal de IVA?', now
    }, { semanticEnabled: true, rankSemanticCandidates: rank })).resolves.toMatchObject({ match: 'exact' })

    await expect(lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'iva', question: 'Qual é o prazo para entrega da declaração mensal de IVA?', now
    }, { semanticEnabled: true, rankSemanticCandidates: rank })).resolves.toMatchObject({ match: 'similar' })

    expect(rank).not.toHaveBeenCalled()
    database.close()
  })

  it('groups equivalent stored questions, filters blocked paths, and enforces score plus top-two margin', async () => {
    const database = await createDatabase()
    const now = new Date('2026-09-08T10:00:00.000Z')
    seedHint(database, 'laboral', 'Qual é o limite máximo de horas de trabalho por semana?', ['wiki/derived/horas.md'], now)
    seedHint(database, 'laboral', 'Qual é o limite máximo de horas de trabalho por semana?', ['wiki/trabalho.md'], now)
    seedHint(database, 'laboral', 'Quantas horas semanais são permitidas no trabalho normal?', ['wiki/trabalho.md'], now)
    seedHint(database, 'laboral', 'Como é remunerado o trabalho prestado em horas extraordinárias?', ['wiki/horas-extra.md'], now)
    let candidates: SemanticRetrievalCandidate[] = []

    const insufficientMargin = await lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'laboral',
      question: 'Numa semana quantas horas pode o trabalhador cumprir no máximo?',
      now,
      blockedWikiPaths: ['wiki/derived/horas.md']
    }, {
      semanticEnabled: true,
      async rankSemanticCandidates(input) {
        candidates = input.candidates
        return input.candidates.map((candidate) => ({
          candidateKey: candidate.key,
          score: candidate.question.includes('limite máximo') ? 0.93 : 0.928
        }))
      }
    })

    expect(insufficientMargin).toBeUndefined()
    expect(candidates).toHaveLength(3)
    expect(candidates.find(({ question }) => question.includes('limite máximo')))
      .toMatchObject({ wikiPaths: ['wiki/trabalho.md'] })

    const insufficientScore = await lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'laboral',
      question: 'Numa semana quantas horas pode o trabalhador cumprir no máximo?',
      now,
      blockedWikiPaths: ['wiki/derived/horas.md']
    }, {
      semanticEnabled: true,
      async rankSemanticCandidates(input) {
        return input.candidates.map((candidate) => ({
          candidateKey: candidate.key,
          score: candidate.question.includes('limite máximo')
            ? 0.919
            : candidate.question.includes('horas semanais') ? 0.918 : 0.8
        }))
      }
    })
    expect(insufficientScore).toBeUndefined()

    const accepted = await lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'laboral',
      question: 'Numa semana quantas horas pode o trabalhador cumprir no máximo?',
      now,
      blockedWikiPaths: ['wiki/derived/horas.md']
    }, {
      semanticEnabled: true,
      async rankSemanticCandidates(input) {
        return input.candidates.map((candidate) => ({
          candidateKey: candidate.key,
          score: candidate.question.includes('limite máximo')
            ? 0.93
            : candidate.question.includes('horas semanais') ? 0.929 : 0.92
        }))
      }
    })

    expect(accepted).toMatchObject({
      wikiPaths: ['wiki/trabalho.md'],
      match: 'semantic',
      score: 0.93
    })
    expect(accepted?.margin).toBeCloseTo(0.01)
    expect(SEMANTIC_RETRIEVAL_SCORE_THRESHOLD).toBe(0.92)
    expect(SEMANTIC_RETRIEVAL_MARGIN).toBe(0.003)
    database.close()
  })

  it('caches candidate vectors without caching the current question', async () => {
    const calls: string[][] = []
    const vectors = new Map([
      ['query: primeira pergunta', [1, 0]],
      ['query: segunda pergunta', [0, 1]],
      ['query: terceira pergunta', [1, 1]],
      ['query: candidato a', [1, 0]],
      ['query: candidato b', [0, 1]],
      ['query: candidato c', [1, 1]]
    ])
    const ranker = createSemanticRanker({
      dimensions: 2,
      maxCachedVectors: 2,
      async embed(texts) {
        calls.push(texts)
        return texts.map((text) => vectors.get(text)!)
      }
    })
    const candidates = [
      candidate('a', 'candidato a'),
      candidate('b', 'candidato b')
    ]

    await ranker({ question: 'primeira pergunta', candidates })
    await ranker({ question: 'segunda pergunta', candidates })
    const afterEviction = await ranker({
      question: 'terceira pergunta',
      candidates: [candidate('a', 'candidato a'), candidate('c', 'candidato c')]
    })

    expect(calls).toEqual([
      ['query: primeira pergunta', 'query: candidato a', 'query: candidato b'],
      ['query: segunda pergunta'],
      ['query: terceira pergunta', 'query: candidato c']
    ])
    expect(afterEviction.map(({ candidateKey }) => candidateKey)).toEqual(['a', 'c'])
  })

  it('returns no hint and logs no private input when semantic inference fails', async () => {
    const database = await createDatabase()
    const now = new Date('2026-09-08T10:00:00.000Z')
    seedHint(database, 'laboral', 'Qual é o limite máximo de horas de trabalho por semana?', ['wiki/trabalho.md'], now)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const question = 'pergunta privada que não deve ir para o log'

    await expect(lookupRetrievalHintsWithSemantic(database, {
      specialistId: 'laboral', question, now
    }, {
      semanticEnabled: true,
      timeoutMs: 5,
      async rankSemanticCandidates() { return await new Promise(() => undefined) }
    })).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith('[ujimu] semantic retrieval failed', {
      code: 'SEMANTIC_RETRIEVAL_FAILED'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(question)
    expect(JSON.stringify(log.mock.calls)).not.toContain('modelo e caminho privados')
    log.mockRestore()
    database.close()
  })
})

async function createDatabase(): Promise<DatabaseSync> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-semantic-retrieval-'))
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

function seedHint(database: DatabaseSync, specialistId: string, question: string, wikiPaths: string[], now: Date): void {
  const event = recordQuestionAnalyticsEvent(database, {
    specialistId,
    question,
    outcome: 'answered',
    occurredAt: now
  })!
  storeRetrievalHints(database, { sourceEventId: event.id, wikiPaths, now })
}

function candidate(key: string, question: string): SemanticRetrievalCandidate {
  return { key, question, wikiPaths: [`wiki/${key}.md`] }
}
