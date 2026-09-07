import type { DatabaseSync } from 'node:sqlite'
import type { AnswerVerificationJob, AnswerVerificationJobRunner } from '../jobs/background'
import { normalizeConsultedWikiDocumentPath } from '../pi/file-policy'
import { createUjimuPiSession } from '../pi/session'
import { loadSpecialistsFromDisk } from '../specialists/loader'
import { getCitationEvidence } from '../chat/context'
import { lookupRetrievalHints, type RetrievalHints } from '../chat/retrieval-cache'
import type { ChatCitation, ChatConversationContextMessage } from '../chat/types'
import {
  readAnswerVerification,
  type AnswerAlignmentJudgement,
  type AnswerVerificationBaseline,
  type AnswerVerificationExecutionResult,
  type NegativeDerivedAttribution
} from './answer-verification'

export class AnswerVerificationExecutionError extends Error {
  public readonly code = 'ANSWER_VERIFICATION_OUTPUT_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'AnswerVerificationExecutionError'
  }
}

export function createPiAnswerVerificationJobRunner(options: {
  database: DatabaseSync
  dataDir?: string
}): AnswerVerificationJobRunner {
  return {
    async run(job) {
      const verification = readAnswerVerification(options.database, job.verificationId)
      if (!verification || verification.sourceEventId !== job.sourceEventId || verification.specialistId !== job.specialistId) {
        throw new AnswerVerificationExecutionError('Answer verification record does not match its job.')
      }
      const event = options.database.prepare(`
        SELECT question_text
        FROM question_analytics_events
        WHERE id = ? AND specialist_id = ? AND outcome = 'answered'
      `).get(job.sourceEventId, job.specialistId) as { question_text: string } | undefined
      if (!event) throw new AnswerVerificationExecutionError('Answer verification source event is unavailable.')

      const snapshot = await loadSpecialistsFromDisk({ dataDir: options.dataDir })
      const specialist = snapshot.specialists.find((item) => item.id === job.specialistId)
      if (!specialist) throw new AnswerVerificationExecutionError('Answer verification specialist was not found.')

      const citationEvidence = await getCitationEvidence(specialist)
      const hints = lookupRetrievalHints(options.database, {
        specialistId: specialist.id,
        question: event.question_text
      })
      if (!verification.originalAnswer) {
        throw new AnswerVerificationExecutionError('Delivered answer is unavailable for verification.')
      }
      const baseline = await runSourceOnlyAnswer({
        cwd: specialist.paths.root,
        prompt: buildSourceOnlyAnswerPrompt({
          question: event.question_text,
          citationEvidence,
          retrievalHints: hints,
          conversationContext: verification.conversationContext
        })
      })
      const judgement = await runJudgementSession({
        cwd: specialist.paths.root,
        prompt: buildAlignmentJudgementPrompt({
          question: event.question_text,
          deliveredAnswer: verification.originalAnswer,
          deliveredCitations: verification.originalCitations,
          deliveredDocuments: verification.derivedPages.map((page) => page.path),
          baseline
        })
      }).then(parseAlignmentJudgement)
      const result: AnswerVerificationExecutionResult = { baseline, judgement }
      if (requiresAttribution(judgement.level)) {
        result.attribution = await runJudgementSession({
          cwd: specialist.paths.root,
          prompt: buildNegativeAttributionPrompt({
            question: event.question_text,
            deliveredAnswer: verification.originalAnswer,
            baseline,
            judgement,
            allowedDerivedPaths: verification.derivedPages.map((page) => page.path)
          })
        }).then((output) => parseNegativeAttribution(
          output,
          verification.derivedPages.map((page) => page.path)
        ))
      }
      return result
    }
  }
}

export function buildSourceOnlyAnswerPrompt(input: {
  question: string
  citationEvidence: ChatCitation[]
  retrievalHints?: RetrievalHints
  conversationContext: ChatConversationContextMessage[]
}): string {
  const hintPaths = input.retrievalHints?.wikiPaths.filter((path) => !path.startsWith('wiki/derived/')) ?? []
  return `Answer the user question independently from this specialist workspace.

Read the local schema and wiki/index.md, then use only non-derived wiki pages. Access to wiki/derived/ is blocked by the application. Do not rely on the delivered answer; it is intentionally absent from this prompt.
The current working directory is the specialist root. The wiki is the only source of truth. If the wiki lacks enough evidence, say so.

Return exactly one JSON object and no markdown fence:
{"answer":"...","citations":[{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}]}
The answer must be European Portuguese using pre-1990 orthography. Citations may be an empty array only when the answer explains insufficient context.

Candidate non-derived wiki paths from a matching consultation:
${hintPaths.length > 0 ? hintPaths.join('\n') : '(none)'}

Known citation metadata:
${input.citationEvidence.length > 0 ? input.citationEvidence.map((citation) => JSON.stringify(citation)).join('\n') : '(none)'}

User question:
${input.question}

Conversation context:
${formatConversationContext(input.conversationContext)}
`
}

export function buildAlignmentJudgementPrompt(input: {
  question: string
  deliveredAnswer: string
  deliveredCitations: ChatCitation[]
  deliveredDocuments: string[]
  baseline: AnswerVerificationBaseline
}): string {
  return `Compare two answers to the same specialist question using the available specialist evidence when needed.
The source-only answer is a control, not an oracle. Judge semantic, factual, legal, numerical, conditional, and citation alignment. Do not prefer an answer merely because it is longer.

Return exactly one JSON object and no markdown fence:
{"level":"FIEL|MUITO_ALINHADO|ALINHADO|POUCO_ALINHADO|NAO_ALINHADO","reason":"...","confidence":"high|medium|low"}
Definitions:
- FIEL: same conclusions, values, conditions, and legal basis.
- MUITO_ALINHADO: minor differences without legal or practical impact.
- ALINHADO: same main conclusion with relevant omissions or differences.
- POUCO_ALINHADO: differences could change the user's decision.
- NAO_ALINHADO: factual, legal, or numerical contradiction.

Question:
${input.question}

Delivered answer:
${input.deliveredAnswer}

Delivered citations:
${JSON.stringify(input.deliveredCitations)}

Derived pages read by the delivered answer:
${input.deliveredDocuments.join('\n')}

Source-only control answer:
${input.baseline.answer}

Control citations:
${JSON.stringify(input.baseline.citations)}

Non-derived pages read by the control:
${input.baseline.consultedDocuments.join('\n')}
`
}

export function buildNegativeAttributionPrompt(input: {
  question: string
  deliveredAnswer: string
  baseline: AnswerVerificationBaseline
  judgement: AnswerAlignmentJudgement
  allowedDerivedPaths: string[]
}): string {
  return `Determine whether any allowed derived page contributed negatively to the delivered answer.
A difference alone is not proof. The source-only control may be worse. Read the named derived pages and supporting non-derived evidence as needed. Return an empty path list when no derived page is demonstrably harmful.

Return exactly one JSON object and no markdown fence:
{"negativeDerivedPaths":["wiki/derived/example.md"],"reason":"..."}
Only paths in the allowlist below are valid.

Question:
${input.question}

Delivered answer:
${input.deliveredAnswer}

Source-only control answer:
${input.baseline.answer}

Alignment judgement:
${JSON.stringify(input.judgement)}

Allowed derived paths:
${input.allowedDerivedPaths.join('\n')}
`
}

export function parseAlignmentJudgement(text: string): AnswerAlignmentJudgement {
  const parsed = parseJsonObject(text)
  const level = parsed.level
  const reason = parsed.reason
  const confidence = parsed.confidence
  if (
    !['FIEL', 'MUITO_ALINHADO', 'ALINHADO', 'POUCO_ALINHADO', 'NAO_ALINHADO'].includes(String(level)) ||
    !isBoundedText(reason) ||
    !['high', 'medium', 'low'].includes(String(confidence))
  ) {
    throw new AnswerVerificationExecutionError('Alignment judgement fields are invalid.')
  }
  return {
    level: level as AnswerAlignmentJudgement['level'],
    reason: reason.trim(),
    confidence: confidence as AnswerAlignmentJudgement['confidence']
  }
}

export function parseNegativeAttribution(text: string, allowedDerivedPaths: string[]): NegativeDerivedAttribution {
  const parsed = parseJsonObject(text)
  if (!Array.isArray(parsed.negativeDerivedPaths) || !isBoundedText(parsed.reason)) {
    throw new AnswerVerificationExecutionError('Negative attribution fields are invalid.')
  }
  const allowed = new Set(allowedDerivedPaths)
  const paths = parsed.negativeDerivedPaths
  if (paths.some((path) => typeof path !== 'string' || !allowed.has(path))) {
    throw new AnswerVerificationExecutionError('Negative attribution contains a path outside the allowlist.')
  }
  return {
    negativeDerivedPaths: [...new Set(paths as string[])].sort(),
    reason: parsed.reason.trim()
  }
}

async function runSourceOnlyAnswer(input: { cwd: string; prompt: string }): Promise<AnswerVerificationBaseline> {
  const { session } = await createUjimuPiSession({
    cwd: input.cwd,
    task: 'answer_verification'
  })
  let streamedText = ''
  let finalText = ''
  const reads = new Map<string, string>()
  const successfulReads = new Set<string>()
  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'tool_execution_start' && event.toolName === 'read') {
      if (typeof event.toolCallId === 'string' && typeof event.args?.path === 'string') {
        reads.set(event.toolCallId, event.args.path)
      }
      return
    }
    if (event?.type === 'tool_execution_end' && event.toolName === 'read') {
      const path = reads.get(event.toolCallId)
      reads.delete(event.toolCallId)
      if (!event.isError && path) successfulReads.add(path)
      return
    }
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      if (typeof event.assistantMessageEvent.delta === 'string') streamedText += event.assistantMessageEvent.delta
      return
    }
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_end') {
      if (typeof event.assistantMessageEvent.content === 'string') finalText = event.assistantMessageEvent.content
      return
    }
    if (event?.type === 'message_end' && event.message?.role === 'assistant') {
      finalText = extractAssistantText(event.message) || finalText
      return
    }
    if (event?.type === 'agent_end') {
      finalText = extractLatestAssistantText(event.messages) || finalText
    }
  })

  try {
    await session.prompt(input.prompt)
    const output = parseSourceOnlyAnswer(finalText || streamedText)
    const normalized = await Promise.all(
      [...successfulReads].map((path) => normalizeConsultedWikiDocumentPath(input.cwd, path))
    )
    return {
      ...output,
      consultedDocuments: [...new Set(normalized.filter((path): path is string => Boolean(path)))].sort()
    }
  } finally {
    unsubscribe?.()
    session.dispose()
  }
}

async function runJudgementSession(input: { cwd: string; prompt: string }): Promise<string> {
  const { session } = await createUjimuPiSession({
    cwd: input.cwd,
    task: 'answer_judgement',
    modelEnvPrefix: 'UJIMU_PI_INGESTION'
  })
  let streamedText = ''
  let finalText = ''
  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      if (typeof event.assistantMessageEvent.delta === 'string') streamedText += event.assistantMessageEvent.delta
      return
    }
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_end') {
      if (typeof event.assistantMessageEvent.content === 'string') finalText = event.assistantMessageEvent.content
      return
    }
    if (event?.type === 'message_end' && event.message?.role === 'assistant') {
      finalText = extractAssistantText(event.message) || finalText
      return
    }
    if (event?.type === 'agent_end') finalText = extractLatestAssistantText(event.messages) || finalText
  })
  try {
    await session.prompt(input.prompt)
    const text = (finalText || streamedText).trim()
    if (!text) throw new AnswerVerificationExecutionError('Judgement model returned no output.')
    return text
  } finally {
    unsubscribe?.()
    session.dispose()
  }
}

function parseSourceOnlyAnswer(text: string): Omit<AnswerVerificationBaseline, 'consultedDocuments'> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new AnswerVerificationExecutionError('Source-only answer was not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AnswerVerificationExecutionError('Source-only answer was not an object.')
  }
  const value = parsed as { answer?: unknown; citations?: unknown }
  if (typeof value.answer !== 'string' || !value.answer.trim() || !Array.isArray(value.citations)) {
    throw new AnswerVerificationExecutionError('Source-only answer fields are invalid.')
  }
  const citations = value.citations.filter(isCitation)
  if (citations.length !== value.citations.length) {
    throw new AnswerVerificationExecutionError('Source-only citations are invalid.')
  }
  return { answer: value.answer.trim(), citations }
}

function parseJsonObject(text: string): Record<string, any> {
  try {
    const parsed = JSON.parse(text.trim())
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Normalized below.
  }
  throw new AnswerVerificationExecutionError('Model output was not a JSON object.')
}

function requiresAttribution(level: AnswerAlignmentJudgement['level']): boolean {
  return level === 'ALINHADO' || level === 'POUCO_ALINHADO' || level === 'NAO_ALINHADO'
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
}

function isCitation(value: unknown): value is ChatCitation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const citation = value as ChatCitation
  return typeof citation.sourceTitle === 'string' && citation.sourceTitle.trim().length > 0 &&
    (citation.sourceFile === undefined || typeof citation.sourceFile === 'string') &&
    Array.isArray(citation.articleRefs) && citation.articleRefs.every((reference) => typeof reference === 'string')
}

function formatConversationContext(context: ChatConversationContextMessage[]): string {
  if (context.length === 0) return '(none)'
  return context.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n')
}

function extractAssistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (!part || typeof part !== 'object') return ''
    return typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''
  }).filter(Boolean).join('\n')
}

function extractLatestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if ((messages[index] as { role?: unknown })?.role === 'assistant') {
      const text = extractAssistantText(messages[index])
      if (text) return text
    }
  }
  return ''
}
