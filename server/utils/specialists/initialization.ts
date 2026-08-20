import { readFile, stat } from 'node:fs/promises'
import type { AgentSessionLogCloseStatus } from '../agents/logs'
import { createUjimuPiSession } from '../pi/session'
import type { SpecialistRuntime } from './schema'

export interface SpecialistInitializationRunner {
  initializeSpecialist(
    specialist: SpecialistRuntime,
    options?: SpecialistInitializationRunnerOptions
  ): Promise<void>
}

export interface SpecialistInitializationRunnerOptions {}

export class SpecialistInitializationError extends Error {
  constructor(
    public readonly code: 'PI_EXECUTION_FAILED' | 'WIKI_INITIALIZATION_OUTPUT_MISSING',
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
  _options: SpecialistInitializationRunnerOptions
): Promise<void> {
  const cwd = specialist.paths.root
  const { session, agentLog } = await createUjimuPiSession({
    cwd,
    task: 'initialization',
    modelEnvPrefix: 'UJIMU_PI_INITIALIZATION',
    agentLog: { specialistId: specialist.id }
  })
  let logStatus: AgentSessionLogCloseStatus = 'succeeded'

  try {
    await session.prompt(buildInitializationPrompt(specialist))
  } catch (error) {
    logStatus = 'failed'
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

  return `Initialize a new Ujimu specialist LLM Wiki workspace. Use the information below to create the wiki structure. Choose sensible wiki conventions from the selected LLM Wiki preset, but do not invent source facts or legal content. Include the chat response guidance below in AGENTS.md so consultation chat sessions can follow it later.

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

In AGENTS.md, state that this specialist wiki is governed by the \`llm-wiki\` skill and its OKF-backed raw/ -> converted/ -> wiki contract.

---
Assume the following persona:
${persona}
---

Chat response guidance:
This guidance applies only when answering user consultation questions, not during wiki initialization or source ingestion.

1. Answer normally from this specialist wiki and do not guess when the wiki lacks evidence.
2. Before emitting the final consultation answer, read and apply the \`unslop\` skill to improve the writing. This style pass must not change grounded facts, legal meaning, citations, or the required output structure.
3. If useful citations are available, optionally emit them as JSON lines in this shape:
   {"type":"citations","citations":[{"sourceTitle":"...","sourceFile":"raw/...","articleRefs":["Artigo ..."]}]}
4. Plain-text answers are acceptable. Missing or malformed citations are ignored by Ujimu instead of blocking the answer.
`
}
