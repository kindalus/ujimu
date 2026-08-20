import { readFile, stat } from 'node:fs/promises'
import type { AgentSessionLogCloseStatus } from '../agents/logs'
import { createUjimuFileTools, createUjimuPiSession } from '../pi/session'
import type { SpecialistRuntime } from './schema'

export const DEFAULT_PI_INITIALIZATION_TIMEOUT_MS = 10 * 60 * 1000

export interface SpecialistInitializationRunner {
  initializeSpecialist(
    specialist: SpecialistRuntime,
    options?: SpecialistInitializationRunnerOptions
  ): Promise<void>
}

export interface SpecialistInitializationRunnerOptions {
  timeoutMs?: number
}

export class SpecialistInitializationError extends Error {
  constructor(
    public readonly code: 'PI_TIMEOUT' | 'PI_EXECUTION_FAILED' | 'WIKI_INITIALIZATION_OUTPUT_MISSING',
    message: string
  ) {
    super(message)
    this.name = 'SpecialistInitializationError'
  }
}

export function createPiSdkSpecialistInitializationRunner(): SpecialistInitializationRunner {
  return {
    async initializeSpecialist(specialist, options = {}) {
      await runPiSdkSpecialistInitialization(specialist, options)
    }
  }
}

export async function assertSpecialistInitializedWorkspace(specialist: SpecialistRuntime): Promise<void> {
  const requiredFiles = [
    specialist.paths.root + '/AGENTS.md',
    specialist.paths.wiki + '/index.md',
    specialist.paths.wiki + '/log.md'
  ]

  for (const file of requiredFiles) {
    const fileStat = await stat(file).catch(() => undefined)
    if (!fileStat?.isFile()) {
      throw new SpecialistInitializationError(
        'WIKI_INITIALIZATION_OUTPUT_MISSING',
        `Specialist initialization did not create required file ${file}.`
      )
    }
  }

  const agentsPath = specialist.paths.root + '/AGENTS.md'
  const agentsContent = await readFile(agentsPath, 'utf8')
  if (!/\bunslop\b/iu.test(agentsContent)) {
    throw new SpecialistInitializationError(
      'WIKI_INITIALIZATION_OUTPUT_MISSING',
      `Specialist initialization did not include the required unslop instruction in ${agentsPath}.`
    )
  }
}

async function runPiSdkSpecialistInitialization(
  specialist: SpecialistRuntime,
  options: SpecialistInitializationRunnerOptions
): Promise<void> {
  const cwd = specialist.paths.root
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'initialization',
    modelEnvPrefix: 'UJIMU_PI_INITIALIZATION',
    tools: await createUjimuFileTools(cwd, ['read', 'write', 'edit', 'grep', 'find', 'ls']),
    fileSystemPolicy: {
      root: cwd,
      read: { directories: ['.'] },
      write: { directories: ['wiki'], files: ['AGENTS.md'] },
      list: { directories: ['.'] }
    },
    agentLog: { specialistId: specialist.id }
  })
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'

  try {
    await runWithTimeout(
      () => session.prompt(buildInitializationPrompt(specialist)),
      options.timeoutMs ?? DEFAULT_PI_INITIALIZATION_TIMEOUT_MS,
      async () => session.abort()
    )
  } catch (error) {
    logStatus = error instanceof SpecialistInitializationError && error.code === 'PI_TIMEOUT' ? 'aborted' : 'failed'
    if (error instanceof SpecialistInitializationError) {
      throw error
    }

    throw new SpecialistInitializationError(
      'PI_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Pi specialist initialization failed.'
    )
  } finally {
    session.dispose()
    await agentLog?.close(logStatus)
  }
}

function buildInitializationPrompt(specialist: SpecialistRuntime): string {
  const persona = specialist.system_prompt.trim() || 'You are a Ujimu specialist consultation assistant. Answer as a careful domain specialist, using only this specialist wiki as your source of truth. If the wiki does not contain enough evidence, say that the current context is insufficient instead of guessing.'

  return `Initialize a new Ujimu specialist LLM Wiki workspace. Use the information below to create the wiki structure. Choose sensible wiki conventions from the selected LLM Wiki preset, but do not invent source facts or legal content. Include the chat response protocol below in AGENTS.md so consultation chat sessions can follow it later.

Specialist:
- id: ${specialist.id}
- name: ${specialist.name}
- description: ${specialist.description}
- wiki type: ${specialist.wiki_type}

The backend has already created raw/, converted/, wiki/, and ingest/. Respect the llm-wiki contract raw/ -> converted/ -> wiki/.

Create these required files:
- AGENTS.md
- wiki/index.md
- wiki/log.md

---
Assume the following persona:
${persona}
---

Chat response protocol:
This protocol applies only when answering user consultation questions, not during wiki initialization or source ingestion.

1. Emit NDJSON only: one JSON object per line, no code fence, no prose outside JSON.
2. Before emitting the final consultation answer, read and apply the \`unslop\` skill to improve the writing. This style pass must not change grounded facts, legal meaning, citations, or the required NDJSON output structure.
3. When the wiki supports the answer, emit one citations event before any answer chunk:
   {"type":"citations","citations":[{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}]}
4. Then emit answer chunks:
   {"type":"delta","text":"..."}
5. If the wiki does not contain enough evidence, emit only answer chunks explaining that the current context is insufficient; do not guess and do not emit citations.
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
      reject(new SpecialistInitializationError('PI_TIMEOUT', `Pi specialist initialization exceeded ${timeoutMs}ms.`))
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
