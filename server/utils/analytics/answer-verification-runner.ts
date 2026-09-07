import type { DatabaseSync } from 'node:sqlite'
import type { AnswerVerificationJob, AnswerVerificationJobRunner } from '../jobs/background'
import { normalizeConsultedWikiDocumentPath } from '../pi/file-policy'
import { createUjimuPiSession } from '../pi/session'
import { loadSpecialistsFromDisk } from '../specialists/loader'
import { getCitationEvidence } from '../chat/context'
import { lookupRetrievalHints, type RetrievalHints } from '../chat/retrieval-cache'
import type { ChatCitation, ChatConversationContextMessage } from '../chat/types'
import { readAnswerVerification, type AnswerVerificationBaseline } from './answer-verification'

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
      return runSourceOnlyAnswer({
        cwd: specialist.paths.root,
        prompt: buildSourceOnlyAnswerPrompt({
          question: event.question_text,
          citationEvidence,
          retrievalHints: hints,
          conversationContext: verification.conversationContext
        })
      })
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
