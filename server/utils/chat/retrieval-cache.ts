import type { DatabaseSync } from 'node:sqlite'
import { fingerprintQuestion, normalizeQuestionForAnalytics } from '../analytics/questions'

export interface RetrievalHints {
  wikiPaths: string[]
  match: 'exact' | 'similar'
  score: number
}

export interface StoreRetrievalHintsInput {
  sourceEventId: string
  wikiPaths: string[]
  now?: Date
}

const RETRIEVAL_HINT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SIMILARITY_THRESHOLD = 0.85

export function lookupRetrievalHints(
  database: DatabaseSync,
  input: { specialistId: string; question: string; now?: Date }
): RetrievalHints | undefined {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  deleteExpiredHints(database, nowIso)

  const normalizedQuestion = normalizeQuestionForAnalytics(input.question)
  if (!normalizedQuestion) return undefined
  const fingerprint = fingerprintQuestion(normalizedQuestion)
  const rows = database.prepare(`
    SELECT fingerprint, normalized_question, wiki_paths_json, created_at
    FROM question_retrieval_hints
    WHERE specialist_id = ? AND expires_at > ?
    ORDER BY created_at DESC
  `).all(input.specialistId, nowIso) as unknown as RetrievalHintRow[]

  const exact = rows.find((row) => row.fingerprint === fingerprint)
  if (exact) return toHints(exact, 'exact', 1)

  let best: { row: RetrievalHintRow; score: number } | undefined
  for (const row of rows) {
    const score = sorensenDiceTrigramSimilarity(normalizedQuestion, row.normalized_question)
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { row, score }
  }
  return best ? toHints(best.row, 'similar', best.score) : undefined
}

export function storeRetrievalHints(database: DatabaseSync, input: StoreRetrievalHintsInput): void {
  const wikiPaths = [...new Set(input.wikiPaths.filter(isWikiMarkdownPath))].sort()
  if (wikiPaths.length === 0) return

  const source = database.prepare(`
    SELECT specialist_id, outcome, normalized_question, fingerprint
    FROM question_analytics_events
    WHERE id = ?
  `).get(input.sourceEventId) as {
    specialist_id: string
    outcome: string
    normalized_question: string
    fingerprint: string
  } | undefined
  if (!source || source.outcome !== 'answered') return

  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + RETRIEVAL_HINT_TTL_MS).toISOString()
  deleteExpiredHints(database, createdAt)
  database.prepare(`
    INSERT INTO question_retrieval_hints (
      source_event_id, specialist_id, fingerprint, normalized_question,
      wiki_paths_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_event_id) DO UPDATE SET
      wiki_paths_json = excluded.wiki_paths_json,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(
    input.sourceEventId,
    source.specialist_id,
    source.fingerprint,
    source.normalized_question,
    JSON.stringify(wikiPaths),
    createdAt,
    expiresAt
  )
}

export function sorensenDiceTrigramSimilarity(left: string, right: string): number {
  if (left === right) return 1
  const leftTrigrams = trigrams(left)
  const rightTrigrams = trigrams(right)
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return 0

  let intersection = 0
  for (const trigram of leftTrigrams) {
    if (rightTrigrams.has(trigram)) intersection += 1
  }
  return (2 * intersection) / (leftTrigrams.size + rightTrigrams.size)
}

interface RetrievalHintRow {
  fingerprint: string
  normalized_question: string
  wiki_paths_json: string
  created_at: string
}

function toHints(row: RetrievalHintRow, match: RetrievalHints['match'], score: number): RetrievalHints | undefined {
  try {
    const parsed = JSON.parse(row.wiki_paths_json)
    if (!Array.isArray(parsed)) return undefined
    const wikiPaths = parsed.filter((path): path is string => typeof path === 'string' && isWikiMarkdownPath(path))
    return wikiPaths.length > 0 ? { wikiPaths, match, score } : undefined
  } catch {
    return undefined
  }
}

function trigrams(value: string): Set<string> {
  if (value.length < 3) return value ? new Set([value]) : new Set()
  const result = new Set<string>()
  for (let index = 0; index <= value.length - 3; index += 1) {
    result.add(value.slice(index, index + 3))
  }
  return result
}

function isWikiMarkdownPath(path: string): boolean {
  const segments = path.split('/')
  return path.startsWith('wiki/') && path.toLowerCase().endsWith('.md') &&
    !path.includes('\0') && segments.every((segment) => segment !== '.' && segment !== '..')
}

function deleteExpiredHints(database: DatabaseSync, nowIso: string): void {
  database.prepare('DELETE FROM question_retrieval_hints WHERE expires_at <= ?').run(nowIso)
}
