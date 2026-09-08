import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const experimentDir = resolve('experiments/embedding-retrieval-calibration')
const corpusPath = resolve(experimentDir, 'corpus.json')
const resultsPath = resolve(experimentDir, 'results.json')
const reportPath = resolve(experimentDir, 'report.md')
const runnerPath = resolve(experimentDir, 'calibrate.mjs')

interface CalibrationCorpus {
  schemaVersion: number
  model: { id: string; dtype: string; dimensions: number; prefix: string }
  specialties: string[]
  intents: Array<{ id: string; specialty: string; canonical: string }>
  cases: Array<{
    id: string
    intentId: string
    label: 'positive' | 'negative'
    query: string
    fold: number
  }>
}

interface Metrics {
  evaluatedCases: number
  truePositives: number
  trueNegatives: number
  falsePositives: number
  falseNegatives: number
  wrongMatches: number
  precision: number
  recall: number
  f1: number
  accuracy: number
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function expectMetrics(metrics: Metrics, evaluatedCases: number): void {
  expect(metrics.evaluatedCases).toBe(evaluatedCases)
  expect(metrics.truePositives + metrics.trueNegatives + metrics.falsePositives + metrics.falseNegatives - metrics.wrongMatches)
    .toBe(evaluatedCases)
  for (const value of [metrics.precision, metrics.recall, metrics.f1, metrics.accuracy]) {
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1)
  }
}

describe('embedding retrieval calibration acceptance', () => {
  it('uses exactly 100 positive and 100 hard-negative public synthetic cases', () => {
    const corpus = readJson<CalibrationCorpus>(corpusPath)

    expect(corpus.schemaVersion).toBe(1)
    expect(corpus.model).toEqual({
      id: 'Xenova/multilingual-e5-small',
      dtype: 'int8',
      dimensions: 384,
      prefix: 'query:'
    })
    expect(corpus.specialties).toEqual(['customs', 'invoicing', 'labour', 'vat'])
    expect(corpus.intents).toHaveLength(20)
    expect(corpus.cases).toHaveLength(200)
    expect(corpus.cases.filter(({ label }) => label === 'positive')).toHaveLength(100)
    expect(corpus.cases.filter(({ label }) => label === 'negative')).toHaveLength(100)
    expect(new Set(corpus.intents.map(({ id }) => id)).size).toBe(20)
    expect(new Set(corpus.intents.map(({ canonical }) => canonical.toLocaleLowerCase('pt-PT'))).size).toBe(20)
    expect(new Set(corpus.cases.map(({ id }) => id)).size).toBe(200)
    expect(new Set(corpus.cases.map(({ query }) => query.toLocaleLowerCase('pt-PT'))).size).toBe(200)

    for (const specialty of corpus.specialties) {
      expect(corpus.intents.filter((intent) => intent.specialty === specialty)).toHaveLength(5)
    }
    for (const intent of corpus.intents) {
      const cases = corpus.cases.filter(({ intentId }) => intentId === intent.id)
      expect(cases.filter(({ label }) => label === 'positive').map(({ fold }) => fold).sort()).toEqual([0, 1, 2, 3, 4])
      expect(cases.filter(({ label }) => label === 'negative').map(({ fold }) => fold).sort()).toEqual([0, 1, 2, 3, 4])
    }

    const serialized = JSON.stringify(corpus)
    expect(serialized).not.toMatch(/question_analytics|conversation|visitor|user_id|@[a-z0-9-]+\.[a-z]{2,}|\+244\d{9}/i)
  })

  it('validates the corpus without loading the model', () => {
    const output = execFileSync(process.execPath, [runnerPath, '--validate-only', '--corpus', corpusPath], {
      encoding: 'utf8'
    })

    expect(JSON.parse(output)).toEqual({
      valid: true,
      intents: 20,
      cases: 200,
      positives: 100,
      negatives: 100,
      folds: 5
    })
  })

  it('records pairwise and ranked five-fold calibration results for E5 and trigram Dice', () => {
    const corpusBytes = readFileSync(corpusPath)
    const result = readJson<any>(resultsPath)

    expect(result.schemaVersion).toBe(1)
    expect(result.corpus).toMatchObject({
      sha256: createHash('sha256').update(corpusBytes).digest('hex'),
      cases: 200,
      positives: 100,
      negatives: 100
    })
    expect(result.model).toMatchObject({
      id: 'Xenova/multilingual-e5-small',
      dtype: 'int8',
      dimensions: 384,
      prefix: 'query:',
      runtimePackage: '@huggingface/transformers',
      runtimeVersion: '3.8.1',
      weightsSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    })

    for (const method of ['embedding', 'trigram']) {
      const pairwise = result.pairwise[method]
      expect(pairwise.threshold).toBeGreaterThanOrEqual(0)
      expect(pairwise.threshold).toBeLessThanOrEqual(1)
      expectMetrics(pairwise.fullCorpus, 200)
      expect(pairwise.crossValidation.folds).toHaveLength(5)
      expectMetrics(pairwise.crossValidation.aggregate, 200)

      const retrieval = result.retrieval[method]
      expect(retrieval.threshold).toBeGreaterThanOrEqual(0)
      expect(retrieval.threshold).toBeLessThanOrEqual(1)
      expect(retrieval.margin).toBeGreaterThanOrEqual(0)
      expect(retrieval.margin).toBeLessThanOrEqual(1)
      expectMetrics(retrieval.fullCorpus, 200)
      expect(retrieval.crossValidation.folds).toHaveLength(5)
      expectMetrics(retrieval.crossValidation.aggregate, 200)
      expect(retrieval.fullCorpusTop1Accuracy).toBeGreaterThanOrEqual(0)
      expect(retrieval.fullCorpusTop1Accuracy).toBeLessThanOrEqual(1)
      expect(retrieval.errors).toBeInstanceOf(Array)
    }
  })

  it('publishes the chosen thresholds, comparison and all observed errors', () => {
    const results = readJson<any>(resultsPath)
    const report = readFileSync(reportPath, 'utf8')

    expect(report).toContain('# Embedding retrieval calibration')
    expect(report).toContain('Xenova/multilingual-e5-small')
    expect(report).toContain(String(results.pairwise.embedding.threshold))
    expect(report).toContain(String(results.retrieval.embedding.margin))
    expect(report).toContain('Cross-validation')
    expect(report).toContain('False positives')
    expect(report).toContain('False negatives')
    expect(report).toContain('https://huggingface.co/intfloat/multilingual-e5-small')
  })
})
