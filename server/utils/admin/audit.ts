import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RequiredAdminSession } from './guards'

export type AdminAuditAction =
  | 'specialist_created'
  | 'specialist_updated'
  | 'specialist_company_assignment_updated'
  | 'raw_source_uploaded'
  | 'raw_source_replaced'
  | 'sources_reloaded'
  | 'conversion_run'
  | 'conversion_skipped_disabled'
  | 'ingestion_started'
  | 'ingestion_completed'
  | 'ingestion_skipped_disabled'
  | 'specialist_deleted'
  | 'specialist_hard_reset_requested'
  | 'specialist_hard_reset_completed'
  | 'specialist_hard_reset_failed'

export interface RecordAdminAuditEventInput {
  admin: RequiredAdminSession
  action: AdminAuditAction
  specialistId?: string
  metadata?: Record<string, unknown>
  now?: Date
}

export function recordAdminAuditEvent(
  database: DatabaseSync,
  input: RecordAdminAuditEventInput
): void {
  database
    .prepare(`
      INSERT INTO admin_audit_events (
        id,
        admin_user_id,
        admin_contact,
        action,
        specialist_id,
        occurred_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.admin.user.id,
      input.admin.adminContact,
      input.action,
      input.specialistId ?? null,
      (input.now ?? new Date()).toISOString(),
      JSON.stringify(input.metadata ?? {})
    )
}
