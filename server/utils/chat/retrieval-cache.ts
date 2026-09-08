import type { DatabaseSync } from 'node:sqlite'
import { fingerprintQuestion, normalizeQuestionForAnalytics } from '../analytics/questions'

export interface RetrievalHints {
  wikiPaths: string[]
  match: 'exact' | 'similar' | 'semantic'
  score: number
  margin?: number
}

export interface SemanticRetrievalCandidate {
  key: string
  question: string
  wikiPaths: string[]
}

export interface StoreRetrievalHintsInput {
  sourceEventId: string
  wikiPaths: string[]
  now?: Date
}

const RETRIEVAL_HINT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SIMILARITY_THRESHOLD = 0.85
const SEMANTIC_CANDIDATE_LIMIT = 500

export function lookupRetrievalHints(
  database: DatabaseSync,
  input: { specialistId: string; question: string; now?: Date; blockedWikiPaths?: string[] }
): RetrievalHints | undefined {
  const now = input.now ?? new Date()
  const blockedWikiPaths = new Set(input.blockedWikiPaths ?? [])
  const nowIso = now.toISOString()
  deleteExpiredHints(database, nowIso)

  const normalizedQuestion = normalizeQuestionForAnalytics(input.question)
  if (!normalizedQuestion) return undefined
  const fingerprint = fingerprintQuestion(normalizedQuestion)
  const rows = readHintRows(database, input.specialistId, nowIso)

  const exact = rows.find((row) => row.fingerprint === fingerprint)
  if (exact) return toHints(exact, 'exact', 1, blockedWikiPaths)

  let best: { row: RetrievalHintRow; score: number } | undefined
  for (const row of rows) {
    const score = sorensenDiceTrigramSimilarity(normalizedQuestion, row.normalized_question)
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { row, score }
  }
  return best ? toHints(best.row, 'similar', best.score, blockedWikiPaths) : undefined
}

export function listSemanticRetrievalCandidates(
  database: DatabaseSync,
  input: { specialistId: string; now?: Date; blockedWikiPaths?: string[] }
): SemanticRetrievalCandidate[] {
  const nowIso = (input.now ?? new Date()).toISOString()
  const blockedWikiPaths = new Set(input.blockedWikiPaths ?? [])
  deleteExpiredHints(database, nowIso)
  const grouped = new Map<string, { question: string; wikiPaths: Set<string> }>()

  for (const row of readSemanticHintRows(database, input.specialistId, nowIso)) {
    let candidate = grouped.get(row.fingerprint)
    if (!candidate) {
      if (grouped.size >= SEMANTIC_CANDIDATE_LIMIT) continue
      candidate = { question: row.question_text, wikiPaths: new Set() }
      grouped.set(row.fingerprint, candidate)
    }
    for (const path of parseWikiPaths(row.wiki_paths_json, blockedWikiPaths)) candidate.wikiPaths.add(path)
  }

  return [...grouped.entries()].flatMap(([key, candidate]) => candidate.wikiPaths.size > 0
    ? [{ key: `${input.specialistId}:${key}`, question: candidate.question, wikiPaths: [...candidate.wikiPaths].sort() }]
    : [])
}

export function storeRetrievalHints(database: DatabaseSync, input: StoreRetrievalHintsInput): void {
  const wikiPaths = [...new Set(input.wikiPaths.filter(isWikiMarkdownPath))].sort()
  if (wikiPaths.length === 0) return

  const source = database.prepare(`
    SELECT outcome
    FROM question_analytics_events
    WHERE id = ?
  `).get(input.sourceEventId) as { outcome: string } | undefined
  if (!source || source.outcome !== 'answered') return

  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + RETRIEVAL_HINT_TTL_MS).toISOString()
  deleteExpiredHints(database, createdAt)
  database.prepare(`
    INSERT INTO question_retrieval_hints (
      source_event_id, wiki_paths_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT (source_event_id) DO UPDATE SET
      wiki_paths_json = excluded.wiki_paths_json,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(
    input.sourceEventId,
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

function toHints(
  row: RetrievalHintRow,
  match: RetrievalHints['match'],
  score: number,
  blockedWikiPaths: Set<string>
): RetrievalHints | undefined {
  const wikiPaths = parseWikiPaths(row.wiki_paths_json, blockedWikiPaths)
  return wikiPaths.length > 0 ? { wikiPaths, match, score } : undefined
}

function parseWikiPaths(serialized: string, blockedWikiPaths: Set<string>): string[] {
  try {
    const parsed = JSON.parse(serialized)
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string =>
          typeof path === 'string' && isWikiMarkdownPath(path) && !blockedWikiPaths.has(path))
      : []
  } catch {
    return []
  }
}

function readHintRows(database: DatabaseSync, specialistId: string, nowIso: string): RetrievalHintRow[] {
  return database.prepare(`
    SELECT events.fingerprint, events.normalized_question,
      hints.wiki_paths_json, hints.created_at
    FROM question_retrieval_hints AS hints
    JOIN question_analytics_events AS events ON events.id = hints.source_event_id
    WHERE events.specialist_id = ? AND hints.expires_at > ?
    ORDER BY hints.created_at DESC
  `).all(specialistId, nowIso) as unknown as RetrievalHintRow[]
}

function readSemanticHintRows(database: DatabaseSync, specialistId: string, nowIso: string): Array<RetrievalHintRow & { question_text: string }> {
  return database.prepare(`
    SELECT events.fingerprint, events.question_text, events.normalized_question,
      hints.wiki_paths_json, hints.created_at
    FROM question_retrieval_hints AS hints
    JOIN question_analytics_events AS events ON events.id = hints.source_event_id
    WHERE events.specialist_id = ? AND hints.expires_at > ?
    ORDER BY hints.created_at DESC
  `).all(specialistId, nowIso) as unknown as Array<RetrievalHintRow & { question_text: string }>
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
