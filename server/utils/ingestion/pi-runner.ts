import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUjimuPiSession } from '../pi/session'
import type { AgentSessionLogCloseStatus } from '../agents/logs'
import type { SpecialistRuntime } from '../specialists/schema'
import type { IngestionManifest, IngestionSourceRecord } from './types'

export interface PiIngestionResult {
  summary?: string
}

export interface PiBatchIngestionResult {
  manifest: IngestionManifest
}

export interface PiIngestionRunner {
  ingestSource(
    specialist: SpecialistRuntime,
    source: IngestionSourceRecord
  ): Promise<PiIngestionResult | void>
  ingestSources?(
    specialist: SpecialistRuntime,
    sources: IngestionSourceRecord[]
  ): Promise<PiBatchIngestionResult | IngestionManifest | void>
}

export class PiIngestionError extends Error {
  constructor(
    public readonly code: 'PI_EXECUTION_FAILED' | 'WIKI_OUTPUT_MISSING' | 'INGESTION_MANIFEST_MISSING' | 'INGESTION_MANIFEST_INVALID',
    message: string
  ) {
    super(message)
    this.name = 'PiIngestionError'
  }
}

export function createPiSdkIngestionRunner(): PiIngestionRunner {
  return {
    async ingestSource(specialist, source) {
      const result = await runPiSdkBatchIngestion(specialist, [source])
      return { summary: `Pi ingested ${countManifestSuccesses(result.manifest)} source(s).` }
    },
    async ingestSources(specialist, sources) {
      return runPiSdkBatchIngestion(specialist, sources)
    }
  }
}

function countManifestSuccesses(manifest: IngestionManifest): number {
  return manifest.version === 2 ? manifest.processed.length : manifest.ingested.length
}

async function runPiSdkBatchIngestion(
  specialist: SpecialistRuntime,
  _sources: IngestionSourceRecord[]
): Promise<PiBatchIngestionResult> {
  const cwd = specialist.paths.root
  await mkdir(join(cwd, '.ujimu'), { recursive: true })
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
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
    await session.prompt(buildBatchIngestionPrompt(specialist))
    const fileManifest = await readManifestFile(cwd)
    const finalManifest = parseManifestFromText(finalText)
    if (JSON.stringify(fileManifest) !== JSON.stringify(finalManifest)) {
      throw new PiIngestionError('INGESTION_MANIFEST_INVALID', 'Pi ingestion final manifest does not match .ujimu/ingestion-manifest.json.')
    }
    return { manifest: fileManifest }
  } catch (error) {
    logStatus = 'failed'
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
  return `Use the llm-wiki skill to process pending Ujimu specialist sources in batch/no-discussion mode.

Follow the llm-wiki contract exactly:
- Convert raw sources from raw/ into converted/ before ingesting.
- Ingest only from converted/ into wiki/.
- Never modify, rename, or delete files in raw/.
- Keep wiki/ OKF-compliant and update its index and log.

Read AGENTS.md and ingest/state.json to identify pending or retryable sources. Do not ask follow-up questions.

Write a complete Ujimu ingestion manifest to .ujimu/ingestion-manifest.json and repeat the same JSON as your final response.

.ujimu/ingestion-manifest.json specification:
{
  "version": 2,
  "specialist_id": "${specialist.id}",
  "processed": [
    {
      "raw_path": "source.pdf",
      "source_path": "source.pdf.md",
      "converted_path": "source.pdf.md",
      "source_sha256": "sha256:...",
      "converted_sha256": "sha256:...",
      "conversion_status": "full",
      "wiki_pages": ["relative-page.md"],
      "citations": [
        { "source_file": "raw/source.pdf", "source_title": "Source title", "article_refs": ["Artigo 1.º"] }
      ],
      "warnings": []
    }
  ],
  "failed": [
    { "raw_path": "failed.pdf", "stage": "conversion", "converted_path": "failed.pdf.md", "conversion_status": "failed", "error_code": "ERROR_CODE", "error_message": "Human readable failure" }
  ]
}

Only include conversion_status values allowed by the llm-wiki skill. Put sources that require user confirmation before ingestion in failed[] with a clear error_message instead of processed[].
`
}

async function runPiSdkIngestion(
  specialist: SpecialistRuntime,
  source: IngestionSourceRecord
): Promise<PiIngestionResult> {
  const cwd = specialist.paths.root
  const markdownPath = source.ingestion?.source_path ?? source.raw_path
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'ingestion',
    modelEnvPrefix: 'UJIMU_PI_INGESTION',
    agentLog: { specialistId: specialist.id }
  })

  const prompt = buildIngestionPrompt(specialist, source)
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'

  try {
    await session.prompt(prompt)
    return { summary: `Pi ingested ${source.ingestion?.source_path ?? source.raw_path}` }
  } catch (error) {
    logStatus = 'failed'
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

  return `Use the llm-wiki skill to convert and ingest exactly one specialist source.

Specialist:
- id: ${specialist.id}
- name: ${specialist.name}
- wiki type: ${specialist.wiki_type}

Source:
- original raw path for citations: raw/${source.raw_path}
- converted Markdown path: converted/${markdownPath}
- title: ${source.title}
- original checksum: ${source.checksum}
- article references detected by the app: ${source.article_refs.join(', ') || '(none)'}

Instructions:
1. Convert raw/${source.raw_path} to converted/${markdownPath} before ingestion.
2. Ingest only from converted/${markdownPath}; do not ingest directly from raw/.
3. Do not modify, rename, or delete anything under raw/.
4. Maintain the wiki/ directory using the specialist schema and OKF rules.
5. Preserve traceability from wiki pages to raw/${source.raw_path} and converted/${markdownPath}.
6. Update wiki/index.md and wiki/log.md if present, or create them if missing.
7. If this is a reingestion, reconcile existing wiki pages instead of creating duplicate source pages.
8. If you cannot convert or ingest the source from the available context, explain the failure clearly.
`
}
