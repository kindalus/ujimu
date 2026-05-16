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
  const {
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    SessionManager,
    SettingsManager
  } = await import('@earendil-works/pi-coding-agent')

  const cwd = specialist.paths.root
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    appendSystemPromptOverride: () => [
      'You are maintaining a Ujimu specialist LLM Wiki.',
      'Operate only inside the current specialist directory.',
      'Never modify files under raw/.',
      'Use the legislation/regulatory LLM Wiki conventions for laws, articles, definitions, topics, amendments, derived pages, index, and log.'
    ]
  })
  await loader.reload()

  const { session } = await createAgentSession({
    cwd,
    resourceLoader: loader,
    tools: ['read', 'write', 'edit', 'grep', 'find', 'ls'],
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 1 }
    })
  })

  const prompt = buildIngestionPrompt(specialist, source)

  try {
    await runWithTimeout(
      () => session.prompt(prompt),
      options.timeoutMs ?? 5 * 60 * 1000,
      async () => session.abort()
    )
    return { summary: `Pi ingested ${source.raw_path}` }
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
  return `Ingest exactly one source into this specialist wiki.

Specialist:
- id: ${specialist.id}
- name: ${specialist.name}
- wiki type: ${specialist.wiki_type}

Source:
- raw path: raw/${source.raw_path}
- title: ${source.title}
- checksum: ${source.checksum}
- article references detected by the app: ${source.article_refs.join(', ') || '(none)'}

Instructions:
1. Read only the source at raw/${source.raw_path} as the ingestion source.
2. Do not modify, rename, or delete anything under raw/.
3. Maintain the wiki/ directory using the legislation/regulatory LLM Wiki structure.
4. Preserve traceability from wiki pages to the original source file raw/${source.raw_path}.
5. Update wiki/index.md and wiki/log.md if present, or create them if missing.
6. If you cannot ingest the source from the available context, explain the failure clearly.
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
