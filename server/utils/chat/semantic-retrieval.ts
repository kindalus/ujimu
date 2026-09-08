import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { resolveAppConfig } from '../config'
import {
  listSemanticRetrievalCandidates,
  lookupRetrievalHints,
  type RetrievalHints,
  type SemanticRetrievalCandidate
} from './retrieval-cache'

export const SEMANTIC_RETRIEVAL_SCORE_THRESHOLD = 0.92
export const SEMANTIC_RETRIEVAL_MARGIN = 0.003

const MODEL_ID = 'Xenova/multilingual-e5-small'
const MODEL_DTYPE = 'int8'
const MODEL_DIMENSIONS = 384
const MODEL_WEIGHTS_SHA256 = '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c'
const VECTOR_CACHE_LIMIT = 2_000
const EMBEDDING_BATCH_SIZE = 32
const LOOKUP_TIMEOUT_MS = 5_000
const WARMUP_TIMEOUT_MS = 30_000

export interface SemanticRankInput {
  question: string
  candidates: SemanticRetrievalCandidate[]
}

export interface RankedSemanticCandidate {
  candidateKey: string
  score: number
}

export type SemanticCandidateRanker = (input: SemanticRankInput) => Promise<RankedSemanticCandidate[]>
export type SemanticEmbedder = (texts: string[]) => Promise<number[][]>

type ModelStatus = 'idle' | 'loading' | 'ready' | 'failed'
type FeatureExtractor = (texts: string[], options: { pooling: 'mean'; normalize: true }) => Promise<{ tolist(): number[][] }>

let modelStatus: ModelStatus = 'idle'
let extractorPromise: Promise<FeatureExtractor> | undefined
let warmFailureLogged = false

const defaultRankSemanticCandidates = createSemanticRanker({ embed: embedWithLocalModel })

export async function lookupRetrievalHintsWithSemantic(
  database: DatabaseSync,
  input: { specialistId: string; question: string; now?: Date; blockedWikiPaths?: string[] },
  options: {
    semanticEnabled?: boolean
    rankSemanticCandidates?: SemanticCandidateRanker
    timeoutMs?: number
  } = {}
): Promise<RetrievalHints | undefined> {
  const lexical = lookupRetrievalHints(database, input)
  if (lexical) return lexical
  if (!(options.semanticEnabled ?? isSemanticRetrievalEnabled())) return undefined

  const candidates = listSemanticRetrievalCandidates(database, input)
  if (candidates.length === 0) return undefined

  try {
    const ranked = deduplicateRankedCandidates(
      await withTimeout((options.rankSemanticCandidates ?? defaultRankSemanticCandidates)({
        question: input.question,
        candidates
      }), options.timeoutMs ?? LOOKUP_TIMEOUT_MS),
      new Set(candidates.map(({ key }) => key))
    )
    const best = ranked[0]
    if (!best) return undefined
    const margin = best.score - (ranked[1]?.score ?? -1)
    if (best.score < SEMANTIC_RETRIEVAL_SCORE_THRESHOLD || margin < SEMANTIC_RETRIEVAL_MARGIN) return undefined

    const candidate = candidates.find(({ key }) => key === best.candidateKey)
    return candidate
      ? { wikiPaths: candidate.wikiPaths, match: 'semantic', score: best.score, margin }
      : undefined
  } catch {
    console.error('[ujimu] semantic retrieval failed', {
      code: 'SEMANTIC_RETRIEVAL_FAILED'
    })
    return undefined
  }
}

export function createSemanticRanker(options: {
  embed: SemanticEmbedder
  dimensions?: number
  maxCachedVectors?: number
}): SemanticCandidateRanker {
  const dimensions = options.dimensions ?? MODEL_DIMENSIONS
  const maxCachedVectors = options.maxCachedVectors ?? VECTOR_CACHE_LIMIT
  const candidateVectors = new Map<string, Float32Array>()

  return async ({ question, candidates }) => {
    for (const { key } of candidates) {
      const vector = candidateVectors.get(key)
      if (!vector) continue
      candidateVectors.delete(key)
      candidateVectors.set(key, vector)
    }
    const missing = candidates.filter(({ key }) => !candidateVectors.has(key))
    const vectors = await options.embed([
      withQueryPrefix(question),
      ...missing.map(({ question }) => withQueryPrefix(question))
    ])
    assertVectors(vectors, 1 + missing.length, dimensions)
    const queryVector = vectors[0]

    missing.forEach((candidate, index) => {
      candidateVectors.set(candidate.key, Float32Array.from(vectors[index + 1]))
      while (candidateVectors.size > maxCachedVectors) {
        const oldestKey = candidateVectors.keys().next().value
        if (typeof oldestKey !== 'string') break
        candidateVectors.delete(oldestKey)
      }
    })

    return candidates.flatMap(({ key }) => {
      const vector = candidateVectors.get(key)
      if (!vector) return []
      candidateVectors.delete(key)
      candidateVectors.set(key, vector)
      return [{ candidateKey: key, score: dot(queryVector, vector) }]
    })
  }
}

export function isSemanticRetrievalEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.UJIMU_SEMANTIC_RETRIEVAL_ENABLED === 'true'
}

export async function warmSemanticRetrieval(): Promise<void> {
  if (!isSemanticRetrievalEnabled()) return
  try {
    await withTimeout(getFeatureExtractor(), WARMUP_TIMEOUT_MS)
  } catch {
    if (!warmFailureLogged) {
      warmFailureLogged = true
      console.error('[ujimu] semantic retrieval warm-up failed', {
        code: 'SEMANTIC_RETRIEVAL_WARMUP_FAILED'
      })
    }
  }
}

export function getSemanticRetrievalReadiness(
  env: Record<string, string | undefined> = process.env
): { semanticRetrievalEnabled: boolean; semanticRetrievalReady: boolean; semanticRetrievalStatus: ModelStatus | 'disabled' } {
  const enabled = isSemanticRetrievalEnabled(env)
  return {
    semanticRetrievalEnabled: enabled,
    semanticRetrievalReady: enabled && modelStatus === 'ready',
    semanticRetrievalStatus: enabled ? modelStatus : 'disabled'
  }
}

async function embedWithLocalModel(texts: string[]): Promise<number[][]> {
  const extractor = await getFeatureExtractor()
  const vectors: number[][] = []
  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const output = await extractor(texts.slice(index, index + EMBEDDING_BATCH_SIZE), {
      pooling: 'mean',
      normalize: true
    })
    vectors.push(...output.tolist())
  }
  return vectors
}

function getFeatureExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    modelStatus = 'loading'
    extractorPromise = loadFeatureExtractor().then((extractor) => {
      modelStatus = 'ready'
      return extractor
    }).catch((error) => {
      modelStatus = 'failed'
      throw error
    })
  }
  return extractorPromise
}

async function loadFeatureExtractor(): Promise<FeatureExtractor> {
  const cacheDir = join(resolveAppConfig().dataDir, 'models', 'transformers')
  const weightsPath = join(cacheDir, MODEL_ID, 'onnx', `model_${MODEL_DTYPE}.onnx`)
  if (await sha256File(weightsPath) !== MODEL_WEIGHTS_SHA256) {
    throw new Error('Semantic retrieval model weights failed integrity validation.')
  }

  const { env, pipeline } = await import('@huggingface/transformers')
  env.cacheDir = cacheDir
  env.allowRemoteModels = false
  return await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE }) as FeatureExtractor
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Semantic retrieval timed out.')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function withQueryPrefix(value: string): string {
  return `query: ${value}`
}

function assertVectors(vectors: number[][], count: number, dimensions: number): void {
  if (vectors.length !== count || vectors.some((vector) =>
    vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error('Semantic retrieval returned invalid embeddings.')
  }
}

function deduplicateRankedCandidates(
  ranked: RankedSemanticCandidate[],
  allowedKeys: Set<string>
): RankedSemanticCandidate[] {
  const bestByKey = new Map<string, number>()
  for (const candidate of ranked) {
    if (!allowedKeys.has(candidate.candidateKey) || !Number.isFinite(candidate.score)) continue
    const score = Math.max(-1, Math.min(1, candidate.score))
    if (score > (bestByKey.get(candidate.candidateKey) ?? -Infinity)) bestByKey.set(candidate.candidateKey, score)
  }
  return [...bestByKey].map(([candidateKey, score]) => ({ candidateKey, score }))
    .sort((left, right) => right.score - left.score || left.candidateKey.localeCompare(right.candidateKey))
}

function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let score = 0
  for (let index = 0; index < left.length; index += 1) score += left[index] * (right[index] ?? 0)
  return Math.max(-1, Math.min(1, score))
}
