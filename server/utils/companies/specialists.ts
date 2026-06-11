import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { createError } from 'h3'
import { readSpecialistSources } from '../admin/specialists'
import type { IngestionSourceRecord } from '../ingestion/types'
import { editSpecialist } from '../specialists/manager'
import { getSpecialistById, getSpecialistRegistry } from '../specialists/registry'
import type { SpecialistRuntime } from '../specialists/schema'
import { requireCompanyAdmin, type CompanyAccessContext } from './http'

export interface CompanySpecialistPayload {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  status: 'active' | 'suspended'
  sources: IngestionSourceRecord[]
}

export type CompanyAdminAuditAction = 'specialist_prompt_updated' | 'raw_source_uploaded' | 'raw_source_replaced'

export async function listCompanySpecialistPayloads(companyId: string): Promise<CompanySpecialistPayload[]> {
  const snapshot = await getSpecialistRegistry()
  return Promise.all(
    snapshot.specialists
      .filter((specialist) => specialist.company_id === companyId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(toCompanySpecialistPayload)
  )
}

export async function requireCompanyAdminSpecialist(
  database: DatabaseSync,
  input: { userId: string; companyId: string; specialistId: string }
): Promise<{ context: CompanyAccessContext; specialist: SpecialistRuntime }> {
  const context = requireCompanyAdmin(database, input.userId, input.companyId)
  const specialist = await getSpecialistById(input.specialistId)
  if (!specialist || specialist.company_id !== input.companyId) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found', data: { code: 'SPECIALIST_NOT_FOUND' } })
  }

  return { context, specialist }
}

export async function updateCompanySpecialistPrompt(
  specialist: SpecialistRuntime,
  systemPrompt: string
): Promise<SpecialistRuntime> {
  return editSpecialist(specialist.id, { system_prompt: systemPrompt })
}

export async function toCompanySpecialistPayload(specialist: SpecialistRuntime): Promise<CompanySpecialistPayload> {
  return {
    id: specialist.id,
    name: specialist.name,
    description: specialist.description,
    wiki_type: specialist.wiki_type,
    system_prompt: specialist.system_prompt,
    status: specialist.status,
    sources: await readSpecialistSources(specialist)
  }
}

export function recordCompanyAdminAuditEvent(
  database: DatabaseSync,
  input: {
    companyId: string
    actorUserId: string
    specialistId: string
    action: CompanyAdminAuditAction
    metadata?: Record<string, unknown>
    now?: Date
  }
): void {
  database
    .prepare(`
      INSERT INTO company_admin_audit_events (
        id,
        company_id,
        actor_user_id,
        specialist_id,
        action,
        occurred_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.companyId,
      input.actorUserId,
      input.specialistId,
      input.action,
      (input.now ?? new Date()).toISOString(),
      JSON.stringify(input.metadata ?? {})
    )
}
