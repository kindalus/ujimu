#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const experimentDir = dirname(fileURLToPath(import.meta.url))
const options = parseArgs(process.argv.slice(2))
const corpusPath = resolve(options.corpus ?? resolve(experimentDir, 'corpus.json'))
const resultsPath = resolve(options.output ?? resolve(experimentDir, 'results.json'))
const reportPath = resolve(options.report ?? resolve(experimentDir, 'report.md'))
const corpusBytes = await readFile(corpusPath)
const corpus = JSON.parse(corpusBytes.toString('utf8'))
const validation = validateCorpus(corpus)

if (options.validateOnly) {
  process.stdout.write(`${JSON.stringify(validation)}\n`)
  process.exit(0)
}

const cacheDir = process.env.UJIMU_EMBEDDING_CACHE
if (!cacheDir) throw new Error('UJIMU_EMBEDDING_CACHE is required for the isolated model cache.')

const modelStartedAt = performance.now()
const { env, pipeline } = await import('@huggingface/transformers')
const transformersEntry = fileURLToPath(import.meta.resolve('@huggingface/transformers'))
const transformersPackage = JSON.parse(await readFile(resolve(dirname(transformersEntry), '..', 'package.json'), 'utf8'))
const weightsSha256 = await sha256File(resolve(cacheDir, corpus.model.id, 'onnx', `model_${corpus.model.dtype}.onnx`))
env.cacheDir = cacheDir
env.allowRemoteModels = false
const extractor = await pipeline('feature-extraction', corpus.model.id, { dtype: corpus.model.dtype })
const modelLoadMs = performance.now() - modelStartedAt

const texts = [
  ...corpus.intents.map(({ canonical }) => canonical),
  ...corpus.cases.map(({ query }) => query)
]
const embeddingStartedAt = performance.now()
const vectors = await embedAll(extractor, texts.map((text) => `${corpus.model.prefix} ${text}`))
const embeddingMs = performance.now() - embeddingStartedAt
if (vectors.some((vector) => vector.length !== corpus.model.dimensions || vector.some((value) => !Number.isFinite(value)))) {
  throw new Error(`Expected finite ${corpus.model.dimensions}-dimensional embeddings.`)
}

const intentById = new Map(corpus.intents.map((intent, index) => [intent.id, { ...intent, index }]))
const embeddingPairScores = corpus.cases.map((item, index) => ({
  item,
  score: dot(vectors[corpus.intents.length + index], vectors[intentById.get(item.intentId).index])
}))
const trigramPairScores = corpus.cases.map((item) => ({
  item,
  score: sorensenDiceTrigramSimilarity(normalizeQuestion(item.query), normalizeQuestion(intentById.get(item.intentId).canonical))
}))
const embeddingRankings = buildRankings(corpus, vectors.slice(corpus.intents.length), (queryVector, intentIndex) =>
  dot(queryVector, vectors[intentIndex]))
const trigramRankings = buildRankings(corpus, corpus.cases.map(({ query }) => normalizeQuestion(query)),
  (query, intentIndex) => sorensenDiceTrigramSimilarity(query, normalizeQuestion(corpus.intents[intentIndex].canonical)))

const pairwise = {
  embedding: calibratePairwise(embeddingPairScores, corpus),
  trigram: calibratePairwise(trigramPairScores, corpus)
}
const retrieval = {
  embedding: calibrateRetrieval(embeddingRankings, corpus),
  trigram: calibrateRetrieval(trigramRankings, corpus)
}
const results = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpus: {
    sha256: createHash('sha256').update(corpusBytes).digest('hex'),
    intents: validation.intents,
    cases: validation.cases,
    positives: validation.positives,
    negatives: validation.negatives,
    folds: validation.folds
  },
  model: {
    ...corpus.model,
    runtimePackage: '@huggingface/transformers',
    runtimeVersion: transformersPackage.version,
    weightsSha256
  },
  timings: {
    modelLoadMs: round(modelLoadMs, 2),
    embeddingMs: round(embeddingMs, 2),
    texts: texts.length,
    averageEmbeddingMs: round(embeddingMs / texts.length, 3)
  },
  currentTrigramPolicy: {
    threshold: 0.85,
    margin: 0,
    pairwise: evaluatePairs(trigramPairScores, 0.85),
    retrieval: evaluateRetrieval(trigramRankings, 0.85, 0)
  },
  pairwise,
  retrieval
}

await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`)
await writeFile(reportPath, renderReport(results, corpus))
process.stdout.write(`${JSON.stringify({ results: resultsPath, report: reportPath, pairwise: pairwise.embedding.threshold, retrieval: { threshold: retrieval.embedding.threshold, margin: retrieval.embedding.margin } })}\n`)

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--validate-only') parsed.validateOnly = true
    else if (argument === '--corpus') parsed.corpus = requiredValue(args, ++index, argument)
    else if (argument === '--output') parsed.output = requiredValue(args, ++index, argument)
    else if (argument === '--report') parsed.report = requiredValue(args, ++index, argument)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return parsed
}

function requiredValue(args, index, flag) {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

function validateCorpus(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.intents) || !Array.isArray(value.cases)) {
    throw new Error('Invalid calibration corpus schema.')
  }
  if (value.intents.length !== 20 || value.cases.length !== 200) throw new Error('Expected 20 intents and 200 cases.')
  if (!value.model || value.model.id !== 'Xenova/multilingual-e5-small' || value.model.dtype !== 'int8' ||
      value.model.dimensions !== 384 || value.model.prefix !== 'query:') {
    throw new Error('Unexpected calibration model contract.')
  }
  if (JSON.stringify(value.specialties) !== '["customs","invoicing","labour","vat"]') {
    throw new Error('Unexpected calibration specialties.')
  }
  const intentIds = new Set(value.intents.map(({ id }) => id))
  const caseIds = new Set(value.cases.map(({ id }) => id))
  const queries = new Set(value.cases.map(({ query }) => normalizeQuestion(query)))
  if (intentIds.size !== 20 || caseIds.size !== 200 || queries.size !== 200) throw new Error('Corpus identifiers and queries must be unique.')
  if (value.intents.some(({ id, specialty, canonical }) => !id || !value.specialties.includes(specialty) || !canonical)) {
    throw new Error('Every intent needs an id, known specialty, and canonical question.')
  }
  if (value.cases.some(({ intentId, label, query, fold }) =>
    !intentIds.has(intentId) || !['positive', 'negative'].includes(label) || !query || !Number.isInteger(fold) || fold < 0 || fold > 4)) {
    throw new Error('Every case needs a known intent, label, query, and fold from zero to four.')
  }
  const positives = value.cases.filter(({ label }) => label === 'positive').length
  const negatives = value.cases.filter(({ label }) => label === 'negative').length
  if (positives !== 100 || negatives !== 100) throw new Error('Expected 100 positive and 100 negative cases.')
  for (const intent of value.intents) {
    for (const label of ['positive', 'negative']) {
      const folds = value.cases.filter((item) => item.intentId === intent.id && item.label === label).map(({ fold }) => fold).sort()
      if (JSON.stringify(folds) !== '[0,1,2,3,4]') throw new Error(`Expected one ${label} case per fold for ${intent.id}.`)
    }
  }
  return { valid: true, intents: 20, cases: 200, positives, negatives, folds: 5 }
}

async function embedAll(extractor, texts) {
  const result = []
  for (let index = 0; index < texts.length; index += 32) {
    const output = await extractor(texts.slice(index, index + 32), { pooling: 'mean', normalize: true })
    result.push(...output.tolist())
  }
  return result
}

function buildRankings(corpus, queries, score) {
  return corpus.cases.map((item, queryIndex) => {
    const candidates = corpus.intents.map((intent, intentIndex) => ({
      intentId: intent.id,
      score: score(queries[queryIndex], intentIndex)
    })).sort((left, right) => right.score - left.score || left.intentId.localeCompare(right.intentId))
    return {
      item,
      expectedIntentId: item.label === 'positive' ? item.intentId : null,
      topIntentId: candidates[0].intentId,
      bestScore: candidates[0].score,
      secondScore: candidates[1].score,
      margin: candidates[0].score - candidates[1].score
    }
  })
}

function calibratePairwise(scoredCases, corpus) {
  const tuned = tunePairThreshold(scoredCases)
  const fullCorpus = evaluatePairs(scoredCases, tuned.threshold)
  const folds = [0, 1, 2, 3, 4].map((fold) => {
    const training = scoredCases.filter(({ item }) => item.fold !== fold)
    const evaluation = scoredCases.filter(({ item }) => item.fold === fold)
    const selected = tunePairThreshold(training)
    return {
      fold,
      trainingCases: training.length,
      evaluationCases: evaluation.length,
      threshold: selected.threshold,
      metrics: evaluatePairs(evaluation, selected.threshold),
      errors: pairErrors(evaluation, selected.threshold)
    }
  })
  return {
    threshold: tuned.threshold,
    fullCorpus,
    crossValidation: { folds, aggregate: aggregateFoldMetrics(folds) },
    bySpecialty: bySpecialty(corpus, scoredCases, (items) => evaluatePairs(items, tuned.threshold)),
    scoreDistribution: scoreDistribution(scoredCases),
    errors: pairErrors(scoredCases, tuned.threshold)
  }
}

function calibrateRetrieval(rankings, corpus) {
  const tuned = tuneRetrieval(rankings)
  const fullCorpus = evaluateRetrieval(rankings, tuned.threshold, tuned.margin)
  const folds = [0, 1, 2, 3, 4].map((fold) => {
    const training = rankings.filter(({ item }) => item.fold !== fold)
    const evaluation = rankings.filter(({ item }) => item.fold === fold)
    const selected = tuneRetrieval(training)
    return {
      fold,
      trainingCases: training.length,
      evaluationCases: evaluation.length,
      threshold: selected.threshold,
      margin: selected.margin,
      metrics: evaluateRetrieval(evaluation, selected.threshold, selected.margin),
      errors: retrievalErrors(evaluation, selected.threshold, selected.margin)
    }
  })
  const positives = rankings.filter(({ item }) => item.label === 'positive')
  return {
    threshold: tuned.threshold,
    margin: tuned.margin,
    fullCorpus,
    fullCorpusTop1Accuracy: divide(positives.filter((item) => item.topIntentId === item.expectedIntentId).length, positives.length),
    crossValidation: { folds, aggregate: aggregateFoldMetrics(folds) },
    bySpecialty: bySpecialty(corpus, rankings, (items) => evaluateRetrieval(items, tuned.threshold, tuned.margin)),
    errors: retrievalErrors(rankings, tuned.threshold, tuned.margin)
  }
}

function tunePairThreshold(scoredCases) {
  return thresholdCandidates(scoredCases.map(({ score }) => score))
    .map((threshold) => ({ threshold, metrics: evaluatePairs(scoredCases, threshold) }))
    .sort(compareSelections)[0]
}

function tuneRetrieval(rankings) {
  const thresholds = thresholdCandidates(rankings.map(({ bestScore }) => bestScore))
  const margins = thresholdCandidates(rankings.map(({ margin }) => margin))
  let best
  for (const threshold of thresholds) {
    for (const margin of margins) {
      const candidate = { threshold, margin, metrics: evaluateRetrieval(rankings, threshold, margin) }
      if (!best || compareRetrievalSelections(candidate, best) < 0) best = candidate
    }
  }
  return best
}

function evaluatePairs(scoredCases, threshold) {
  return metrics(scoredCases.map(({ item, score }) => ({ expected: item.label === 'positive', predicted: score >= threshold })))
}

function evaluateRetrieval(rankings, threshold, margin) {
  const counts = {
    evaluatedCases: rankings.length,
    truePositives: 0,
    trueNegatives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    wrongMatches: 0
  }
  for (const item of rankings) {
    const accepted = item.bestScore >= threshold && item.margin >= margin
    if (item.expectedIntentId === null) {
      if (accepted) counts.falsePositives += 1
      else counts.trueNegatives += 1
    } else if (accepted && item.topIntentId === item.expectedIntentId) {
      counts.truePositives += 1
    } else {
      counts.falseNegatives += 1
      if (accepted) {
        counts.falsePositives += 1
        counts.wrongMatches += 1
      }
    }
  }
  return completeMetrics(counts)
}

function metrics(decisions) {
  return completeMetrics({
    evaluatedCases: decisions.length,
    truePositives: decisions.filter(({ expected, predicted }) => expected && predicted).length,
    trueNegatives: decisions.filter(({ expected, predicted }) => !expected && !predicted).length,
    falsePositives: decisions.filter(({ expected, predicted }) => !expected && predicted).length,
    falseNegatives: decisions.filter(({ expected, predicted }) => expected && !predicted).length,
    wrongMatches: 0
  })
}

function aggregateFoldMetrics(folds) {
  const totals = folds.reduce((result, { metrics: value }) => ({
    evaluatedCases: result.evaluatedCases + value.evaluatedCases,
    truePositives: result.truePositives + value.truePositives,
    trueNegatives: result.trueNegatives + value.trueNegatives,
    falsePositives: result.falsePositives + value.falsePositives,
    falseNegatives: result.falseNegatives + value.falseNegatives,
    wrongMatches: result.wrongMatches + value.wrongMatches
  }), { evaluatedCases: 0, truePositives: 0, trueNegatives: 0, falsePositives: 0, falseNegatives: 0, wrongMatches: 0 })
  return completeMetrics(totals)
}

function completeMetrics(counts) {
  return {
    ...counts,
    precision: divide(counts.truePositives, counts.truePositives + counts.falsePositives),
    recall: divide(counts.truePositives, counts.truePositives + counts.falseNegatives),
    f1: divide(2 * counts.truePositives, 2 * counts.truePositives + counts.falsePositives + counts.falseNegatives),
    accuracy: divide(counts.truePositives + counts.trueNegatives, counts.evaluatedCases)
  }
}

function bySpecialty(corpus, items, evaluate) {
  const specialistByIntent = new Map(corpus.intents.map(({ id, specialty }) => [id, specialty]))
  return Object.fromEntries(corpus.specialties.map((specialty) => [specialty,
    evaluate(items.filter(({ item }) => specialistByIntent.get(item.intentId) === specialty))
  ]))
}

function pairErrors(scoredCases, threshold) {
  return scoredCases.flatMap(({ item, score }) => {
    const predicted = score >= threshold
    const expected = item.label === 'positive'
    if (predicted === expected) return []
    return [{ type: predicted ? 'false_positive' : 'false_negative', caseId: item.id, targetIntentId: item.intentId, score }]
  })
}

function retrievalErrors(rankings, threshold, margin) {
  return rankings.flatMap((item) => {
    const accepted = item.bestScore >= threshold && item.margin >= margin
    if (item.expectedIntentId === null && accepted) return [{
      type: 'false_positive', caseId: item.item.id, topIntentId: item.topIntentId,
      bestScore: item.bestScore, margin: item.margin
    }]
    if (item.expectedIntentId !== null && (!accepted || item.topIntentId !== item.expectedIntentId)) return [{
      type: item.topIntentId !== item.expectedIntentId && accepted ? 'wrong_match' : 'false_negative',
      caseId: item.item.id, expectedIntentId: item.expectedIntentId,
      topIntentId: item.topIntentId, bestScore: item.bestScore, margin: item.margin
    }]
    return []
  })
}

function scoreDistribution(scoredCases) {
  return Object.fromEntries(['positive', 'negative'].map((label) => {
    const scores = scoredCases.filter(({ item }) => item.label === label).map(({ score }) => score).sort((a, b) => a - b)
    return [label, { min: scores[0], p25: percentile(scores, .25), median: percentile(scores, .5), p75: percentile(scores, .75), max: scores.at(-1) }]
  }))
}

function thresholdCandidates(values) {
  return [...new Set([0, 1, ...values, ...values.map((value) => Math.min(1, value + Number.EPSILON * 8))])].sort((a, b) => a - b)
}

function compareSelections(left, right) {
  return right.metrics.f1 - left.metrics.f1 || right.metrics.precision - left.metrics.precision || right.threshold - left.threshold
}

function compareRetrievalSelections(left, right) {
  return compareSelections(left, right) || right.margin - left.margin
}

function sorensenDiceTrigramSimilarity(left, right) {
  if (left === right) return 1
  const leftTrigrams = trigrams(left)
  const rightTrigrams = trigrams(right)
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return 0
  let intersection = 0
  for (const trigram of leftTrigrams) if (rightTrigrams.has(trigram)) intersection += 1
  return (2 * intersection) / (leftTrigrams.size + rightTrigrams.size)
}

function trigrams(value) {
  if (value.length < 3) return value ? new Set([value]) : new Set()
  const result = new Set()
  for (let index = 0; index <= value.length - 3; index += 1) result.add(value.slice(index, index + 3))
  return result
}

function normalizeQuestion(question) {
  return question.replace(/[ºª]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function dot(left, right) {
  return Math.max(-1, Math.min(1, left.reduce((sum, value, index) => sum + value * right[index], 0)))
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator
}

function percentile(sorted, point) {
  const index = (sorted.length - 1) * point
  const lower = Math.floor(index)
  const fraction = index - lower
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function renderReport(result, corpus) {
  const lines = [
    '# Embedding retrieval calibration',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    '## Scope',
    '',
    `- Model: \`${result.model.id}\`, ${result.model.dtype}, ${result.model.dimensions} dimensions.`,
    `- Runtime: \`${result.model.runtimePackage}@${result.model.runtimeVersion}\`.`,
    `- ONNX weights SHA-256: \`${result.model.weightsSha256}\`.`,
    `- Prefix: \`${result.model.prefix}\` on canonical and candidate questions.`,
    `- Corpus: ${result.corpus.cases} cases, ${result.corpus.positives} positive and ${result.corpus.negatives} negative.`,
    '- Data: public/synthetic legal-domain questions; no production question history.',
    '- Execution: isolated experiment; no application dependency or production integration.',
    '',
    '## Recommendation',
    '',
    `- Pairwise E5 threshold: ${result.pairwise.embedding.threshold}.`,
    `- Ranked E5 score threshold: ${result.retrieval.embedding.threshold}.`,
    `- Ranked E5 top-two margin: ${result.retrieval.embedding.margin}.`,
    `- Five-fold ranked F1: ${result.retrieval.embedding.crossValidation.aggregate.f1}.`,
    '',
    'These values are calibrated on synthetic questions. Validate them on a separately reviewed sample before runtime adoption.',
    '',
    '## Decision',
    '',
    `- E5 ranked cross-validation F1: ${result.retrieval.embedding.crossValidation.aggregate.f1}; trigram: ${result.retrieval.trigram.crossValidation.aggregate.f1}.`,
    `- E5 ranked cross-validation errors: ${result.retrieval.embedding.crossValidation.aggregate.falsePositives} false positives and ${result.retrieval.embedding.crossValidation.aggregate.falseNegatives} false negatives.`,
    '- E5 improves retrieval on this corpus, but the false-positive rate is too high for unguarded runtime adoption.',
    '- Treat the score and margin as calibration candidates, not production defaults.',
    '',
    '## Current runtime trigram policy',
    '',
    `At the existing 0.85 threshold and without a margin, trigram Dice returned ${result.currentTrigramPolicy.retrieval.truePositives} of ${result.corpus.positives} positive matches and ${result.currentTrigramPolicy.retrieval.falsePositives} false positives.`,
    '',
    'The comparison below also shows trigram Dice at its own best-F1 threshold. That separates algorithm capacity from the current conservative runtime policy.',
    '',
    '## Full-corpus comparison',
    '',
    '| Method | Pair threshold | Pair precision | Pair recall | Pair F1 | Retrieval threshold | Margin | Retrieval precision | Retrieval recall | Retrieval F1 | Top-1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    comparisonRow('E5', result.pairwise.embedding, result.retrieval.embedding),
    comparisonRow('Trigram Dice', result.pairwise.trigram, result.retrieval.trigram),
    '',
    '## Cross-validation',
    '',
    '| Method | Pair precision | Pair recall | Pair F1 | Retrieval precision | Retrieval recall | Retrieval F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    crossValidationRow('E5', result.pairwise.embedding, result.retrieval.embedding),
    crossValidationRow('Trigram Dice', result.pairwise.trigram, result.retrieval.trigram),
    '',
    '## E5 retrieval by specialty',
    '',
    '| Specialty | Precision | Recall | F1 | Accuracy |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(result.retrieval.embedding.bySpecialty).map(([specialty, value]) =>
      `| ${specialty} | ${value.precision} | ${value.recall} | ${value.f1} | ${value.accuracy} |`),
    '',
    '## False positives',
    '',
    ...renderErrors(result, corpus, 'false_positive'),
    '',
    '## False negatives',
    '',
    ...renderErrors(result, corpus, 'false_negative'),
    '',
    '## Wrong matches',
    '',
    ...renderErrors(result, corpus, 'wrong_match'),
    '',
    '## Timing',
    '',
    `- Model load: ${result.timings.modelLoadMs} ms.`,
    `- ${result.timings.texts} embeddings: ${result.timings.embeddingMs} ms, ${result.timings.averageEmbeddingMs} ms/text average.`,
    '',
    '## Dependency status',
    '',
    `- The disposable lab pinned \`${result.model.runtimePackage}@${result.model.runtimeVersion}\`.`,
    '- Its isolated install reported two high-severity advisories through `sharp <0.35.0`: https://github.com/advisories/GHSA-f88m-g3jw-g9cj.',
    '- All 54 installed packages had valid registry signatures; nine had attestations.',
    '- The package was not added to the application. Production adoption remains blocked until a reviewed version removes those advisories.',
    '',
    '## Sources',
    '',
    '- https://huggingface.co/intfloat/multilingual-e5-small',
    '- https://huggingface.co/docs/transformers.js/api/pipelines'
  ]
  return `${lines.join('\n')}\n`
}

function comparisonRow(label, pair, retrieval) {
  return `| ${label} | ${pair.threshold} | ${pair.fullCorpus.precision} | ${pair.fullCorpus.recall} | ${pair.fullCorpus.f1} | ${retrieval.threshold} | ${retrieval.margin} | ${retrieval.fullCorpus.precision} | ${retrieval.fullCorpus.recall} | ${retrieval.fullCorpus.f1} | ${retrieval.fullCorpusTop1Accuracy} |`
}

function crossValidationRow(label, pair, retrieval) {
  return `| ${label} | ${pair.crossValidation.aggregate.precision} | ${pair.crossValidation.aggregate.recall} | ${pair.crossValidation.aggregate.f1} | ${retrieval.crossValidation.aggregate.precision} | ${retrieval.crossValidation.aggregate.recall} | ${retrieval.crossValidation.aggregate.f1} |`
}

function renderErrors(result, corpus, type) {
  const queryByCase = new Map(corpus.cases.map(({ id, query }) => [id, query]))
  const occurrences = new Map()
  for (const [evaluation, value] of Object.entries({ pairwise: result.pairwise.embedding, retrieval: result.retrieval.embedding })) {
    for (const error of value.errors.filter((item) => item.type === type)) {
      addOccurrence(occurrences, error.caseId, `${evaluation}/full`)
    }
    for (const fold of value.crossValidation.folds) {
      for (const error of fold.errors.filter((item) => item.type === type)) {
        addOccurrence(occurrences, error.caseId, `${evaluation}/fold-${fold.fold}`)
      }
    }
  }
  return occurrences.size
    ? [...occurrences].map(([caseId, scopes]) => `- \`${caseId}\` [${[...scopes].join(', ')}]: ${queryByCase.get(caseId)}`)
    : ['- None.']
}

function addOccurrence(occurrences, caseId, scope) {
  if (!occurrences.has(caseId)) occurrences.set(caseId, new Set())
  occurrences.get(caseId).add(scope)
}
