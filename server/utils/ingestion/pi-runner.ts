import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUjimuFileTools, createUjimuPiSession } from '../pi/session'
import type { AgentSessionLogCloseStatus } from '../agents/logs'
import type { SpecialistRuntime } from '../specialists/schema'
import type { IngestionManifest, IngestionSourceRecord } from './types'

export const DEFAULT_PI_INGESTION_TIMEOUT_MS = 30 * 60 * 1000

export interface PiIngestionResult {
  summary?: string
}

export interface PiBatchIngestionResult {
  manifest: IngestionManifest
}

export interface PiIngestionRunner {
  ingestSource(
    specialist: SpecialistRuntime,
    source: IngestionSourceRecord,
    options?: PiSdkIngestionOptions
  ): Promise<PiIngestionResult | void>
  ingestSources?(
    specialist: SpecialistRuntime,
    sources: IngestionSourceRecord[],
    options?: PiSdkIngestionOptions
  ): Promise<PiBatchIngestionResult | IngestionManifest | void>
}

export interface PiSdkIngestionOptions {
  timeoutMs?: number
}

export class PiIngestionError extends Error {
  constructor(
    public readonly code: 'PI_TIMEOUT' | 'PI_EXECUTION_FAILED' | 'WIKI_OUTPUT_MISSING' | 'INGESTION_MANIFEST_MISSING' | 'INGESTION_MANIFEST_INVALID',
    message: string
  ) {
    super(message)
    this.name = 'PiIngestionError'
  }
}

export function createPiSdkIngestionRunner(): PiIngestionRunner {
  return {
    async ingestSource(specialist, source, options = {}) {
      const result = await runPiSdkBatchIngestion(specialist, [source], options)
      return { summary: `Pi ingested ${result.manifest.ingested.length} source(s).` }
    },
    async ingestSources(specialist, sources, options = {}) {
      return runPiSdkBatchIngestion(specialist, sources, options)
    }
  }
}

async function runPiSdkBatchIngestion(
  specialist: SpecialistRuntime,
  _sources: IngestionSourceRecord[],
  options: PiSdkIngestionOptions
): Promise<PiBatchIngestionResult> {
  const cwd = specialist.paths.root
  await mkdir(join(cwd, '.ujimu'), { recursive: true })
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    tools: await createUjimuFileTools(cwd, ['read', 'write', 'edit', 'grep', 'find', 'ls']),
    fileSystemPolicy: {
      root: cwd,
      read: { directories: ['wiki', 'raw'], files: ['AGENTS.md', 'ingest/state.json'] },
      write: { directories: ['wiki'], files: ['.ujimu/ingestion-manifest.json'] },
      list: { directories: ['wiki', 'raw'], virtualRootEntries: ['AGENTS.md', 'wiki', 'raw'] }
    },
    agentLog: { specialistId: specialist.id }
  })

  let finalText = ''
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'
  const unsubscribe = session.subscribe?.((event: any) => {
    if (event?.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      finalText += event.assistantMessageEvent.delta
    }
  })

  try {
    await runWithTimeout(
      () => session.prompt(buildBatchIngestionPrompt(specialist)),
      options.timeoutMs ?? DEFAULT_PI_INGESTION_TIMEOUT_MS,
      async () => session.abort()
    )
    const fileManifest = await readManifestFile(cwd)
    const finalManifest = parseManifestFromText(finalText)
    if (JSON.stringify(fileManifest) !== JSON.stringify(finalManifest)) {
      throw new PiIngestionError('INGESTION_MANIFEST_INVALID', 'Pi ingestion final manifest does not match .ujimu/ingestion-manifest.json.')
    }
    return { manifest: fileManifest }
  } catch (error) {
    logStatus = error instanceof PiIngestionError && error.code === 'PI_TIMEOUT' ? 'aborted' : 'failed'
    if (error instanceof PiIngestionError) {
      throw error
    }

    throw new PiIngestionError(
      'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi ingestion failed.'
    )
  } finally {
    unsubscribe?.()
    session.dispose()
    await agentLog?.close(logStatus)
  }
}

async function readManifestFile(cwd: string): Promise<IngestionManifest> {
  const manifestPath = join(cwd, '.ujimu', 'ingestion-manifest.json')
  const raw = await readFile(manifestPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new PiIngestionError('INGESTION_MANIFEST_MISSING', 'Pi ingestion did not write .ujimu/ingestion-manifest.json.')
    }
    throw error
  })
  return parseManifestJson(raw)
}

function parseManifestFromText(text: string): IngestionManifest {
  const trimmed = text.trim()
  const jsonBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim()
  if (jsonBlock) {
    return parseManifestJson(jsonBlock)
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new PiIngestionError('INGESTION_MANIFEST_MISSING', 'Pi ingestion final response did not include a JSON manifest.')
  }

  return parseManifestJson(trimmed.slice(start, end + 1))
}

function parseManifestJson(value: string): IngestionManifest {
  try {
    return JSON.parse(value) as IngestionManifest
  } catch (error) {
    throw new PiIngestionError(
      'INGESTION_MANIFEST_INVALID',
      error instanceof Error ? error.message : 'Invalid ingestion manifest JSON.'
    )
  }
}

function buildBatchIngestionPrompt(specialist: SpecialistRuntime): string {
  return `Ingest all markdown files from raw that have not been ingested yet.

Write a complete ingestion manifest to /data/.ujimu/ingestion-manifest.json and repeat the same JSON as your final response.

/data/.ujimu/ingestion-manifest.json specification:
{
  "version": 1,
  "specialist_id": "${specialist.id}",
  "ingested": [
    {
      "raw_path": "source.original.md",
      "source_path": "source.original.md",
      "wiki_pages": ["relative-page.md"],
      "citations": [
        { "source_file": "raw/source.original.md", "source_title": "Source title", "article_refs": ["Artigo 1.º"] }
      ],
      "warnings": []
    }
  ],
  "failed": [
    { "raw_path": "failed.md", "source_path": "failed.md", "error_code": "ERROR_CODE", "error_message": "Human readable failure" }
  ]
}
`
}

async function runPiSdkIngestion(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord,
  options: PiSdkIngestionOptions
): Promise<PiIngestionResult> {
  const cwd = specialist.paths.root
  const markdownPath = source.ingestion?.source_path ?? source.raw_path
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    tools: await createUjimuFileTools(cwd, ['read', 'write', 'edit', 'grep', 'find', 'ls']),
    fileSystemPolicy: {
      root: cwd,
      read: { directories: ['wiki'], files: ['AGENTS.md', `raw/${markdownPath}`] },
      write: { directories: ['wiki'] },
      list: { directories: ['wiki'], virtualRootEntries: ['AGENTS.md', 'wiki', 'raw'] }
    },
    agentLog: { specialistId: specialist.id }
  })

  const prompt = buildIngestionPrompt(specialist, source)
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'

  try {
    await runWithTimeout(
      () => session.prompt(prompt),
      options.timeoutMs ?? DEFAULT_PI_INGESTION_TIMEOUT_MS,
      async () => session.abort()
    )
    return { summary: `Pi ingested ${source.ingestion?.source_path ?? source.raw_path}` }
  } catch (error) {
    logStatus = error instanceof PiIngestionError && error.code === 'PI_TIMEOUT' ? 'aborted' : 'failed'
    if (error instanceof PiIngestionError) {
      throw error
    }

    throw new PiIngestionError(
      'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi ingestion failed.'
    )
  } finally {
    session.dispose()
    await agentLog?.close(logStatus)
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
- Markdown ingestion path: /data/raw/${markdownPath}
- title: ${source.title}
- original checksum: ${source.checksum}
- Markdown checksum: ${source.conversion?.markdown_checksum ?? '(unknown)'}
- article references detected by the app: ${source.article_refs.join(', ') || '(none)'}

Instructions:
1. Use the llm-wiki skill to ingest only the Markdown file at /data/raw/${markdownPath}.
2. Do not ingest /data/raw/${source.raw_path} directly when it differs from the Markdown ingestion path.
3. Do not modify, rename, or delete anything under /data/raw.
4. Maintain the /data/wiki directory using the legislation/regulatory LLM Wiki structure.
5. Preserve traceability from wiki pages to the original source file raw/${source.raw_path}.
6. Update /data/wiki/index.md and /data/wiki/log.md if present, or create them if missing.
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
