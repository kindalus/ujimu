import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SpecialistRuntime } from './schema'

export const DERIVED_WRITE_POLICY_MARKER = '<!-- ujimu-derived-write-policy-v1 -->'

const DERIVED_WRITE_POLICY = `${DERIVED_WRITE_POLICY_MARKER}
## Ujimu derived knowledge policy

During normal user consultations, never create, edit, or delete \`wiki/derived/\`. Only an explicit derivation job initiated by an administrator may create or update derived knowledge.
`

export async function ensureSpecialistConsultationPolicies(
  specialists: SpecialistRuntime[]
): Promise<number> {
  let updated = 0
  for (const specialist of specialists) {
    if (await ensureSpecialistConsultationPolicy(specialist)) updated += 1
  }
  return updated
}

export async function ensureSpecialistConsultationPolicy(
  specialist: SpecialistRuntime
): Promise<boolean> {
  const agentsPath = join(specialist.paths.root, 'AGENTS.md')
  const content = await readFile(agentsPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (content === undefined || content.includes(DERIVED_WRITE_POLICY_MARKER)) return false

  const backupDir = join(specialist.paths.ingest, 'policy-backups')
  const backupPath = join(backupDir, 'AGENTS.before-derived-policy.md')
  await mkdir(backupDir, { recursive: true })
  await copyFile(agentsPath, backupPath, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })

  const tempPath = `${agentsPath}.derived-policy.tmp`
  await writeFile(tempPath, `${content.trimEnd()}\n\n${DERIVED_WRITE_POLICY}`)
  try {
    await rename(tempPath, agentsPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
  return true
}
