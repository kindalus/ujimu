import { createUjimuFileTools, createUjimuPiSession } from '../pi/session'
import type { SpecialistRuntime } from '../specialists/schema'
import type { IngestionSourceRecord } from './types'

export interface PiIngestionResult {
  summary?: string
}

export interface PiIngestionRunner {
  ingestSource(
    specialist: SpecialistRuntime,
    source: IngestionSourceRecord,
    options?: PiSdkIngestionOptions
  ): Promise<PiIngestionResult>
}

export interface PiSdkIngestionOptions {
  timeoutMs?: number
}

export class PiIngestionError extends Error {
  constructor(
    public readonly code: 'PI_TIMEOUT' | 'PI_EXECUTION_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'PiIngestionError'
  }
}

export function createPiSdkIngestionRunner(): PiIngestionRunner {
  return {
    async ingestSource(specialist, source, options = {}) {
      return runPiSdkIngestion(specialist, source, options)
    }
  }
}

async function runPiSdkIngestion(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord,
  options: PiSdkIngestionOptions
): Promise<PiIngestionResult> {
  const cwd = specialist.paths.root
  const { session } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    tools: await createUjimuFileTools(cwd, ['read', 'write', 'edit', 'grep', 'find', 'ls']),
    appendSystemPromptOverride: () => [
      'You are maintaining a Ujimu specialist LLM Wiki.',
      'Operate only inside the current specialist directory.',
      'Never modify files under raw/.',
      'Use the legislation/regulatory LLM Wiki conventions for laws, articles, definitions, topics, amendments, derived pages, index, and log.'
    ]
  })

  const prompt = buildIngestionPrompt(specialist, source)

  try {
    await runWithTimeout(
      () => session.prompt(prompt),
      options.timeoutMs ?? 5 * 60 * 1000,
      async () => session.abort()
    )
    return { summary: `Pi ingested ${source.ingestion?.source_path ?? source.raw_path}` }
  } catch (error) {
    if (error instanceof PiIngestionError) {
      throw error
    }

    throw new PiIngestionError(
      'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi ingestion failed.'
    )
  } finally {
    session.dispose()
  }
}

function buildIngestionPrompt(specialist: SpecialistRuntime, source: IngestionSourceRecord): string {
  const markdownPath = source.ingestion?.source_path ?? source.raw_path

  return `Ingest exactly one Markdown source into this specialist wiki.

Specialist:
- id: ${specialist.id}
- name: ${specialist.name}
- wiki type: ${specialist.wiki_type}

Source:
- original raw path for citations: raw/${source.raw_path}
- Markdown ingestion path: raw/${markdownPath}
- title: ${source.title}
- original checksum: ${source.checksum}
- Markdown checksum: ${source.conversion?.markdown_checksum ?? '(unknown)'}
- article references detected by the app: ${source.article_refs.join(', ') || '(none)'}

Instructions:
1. Use the llm-wiki skill to ingest only the Markdown file at raw/${markdownPath}.
2. Do not ingest raw/${source.raw_path} directly when it differs from the Markdown ingestion path.
3. Do not modify, rename, or delete anything under raw/.
4. Maintain the wiki/ directory using the legislation/regulatory LLM Wiki structure.
5. Preserve traceability from wiki pages to the original source file raw/${source.raw_path}.
6. Update wiki/index.md and wiki/log.md if present, or create them if missing.
7. If this is a reingestion, reconcile existing wiki pages instead of creating duplicate source pages.
8. If you cannot ingest the source from the available context, explain the failure clearly.
`
}

async function runWithTimeout(
  operation: () => Promise<void>,
  timeoutMs: number,
  onTimeout: () => Promise<void>
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined
  let timedOut = false

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      reject(new PiIngestionError('PI_TIMEOUT', `Pi ingestion exceeded ${timeoutMs}ms.`))
    }, timeoutMs)
  })

  try {
    await Promise.race([operation(), timeoutPromise])
  } catch (error) {
    if (timedOut) {
      await onTimeout().catch(() => undefined)
    }
    throw error
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
