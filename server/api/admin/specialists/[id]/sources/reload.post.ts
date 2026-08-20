import { createError, defineEventHandler, getRouterParam } from 'h3'
import { recordAdminAuditEvent } from '../../../../../utils/admin/audit'
import { requireAdmin } from '../../../../../utils/admin/guards'
import { countSources } from '../../../../../utils/admin/specialists'
import { initializeDatabase } from '../../../../../utils/db'
import { scanSpecialistRawSources } from '../../../../../utils/ingestion/detect'
import { getSpecialistById } from '../../../../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const admin = requireAdmin(database, event)
  const specialistId = getRequiredSpecialistId(event)
  const specialist = await getSpecialistById(specialistId)
  if (!specialist) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }

  const state = await scanSpecialistRawSources(specialist)
  const sources = Object.values(state.sources).sort((left, right) => left.raw_path.localeCompare(right.raw_path))
  const counts = countSources(sources)
  recordAdminAuditEvent(database, {
    admin,
    action: 'sources_reloaded',
    specialistId,
    metadata: { counts }
  })

  return { sources, counts }
})

function getRequiredSpecialistId(event: Parameters<typeof getRouterParam>[0]): string {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }
  return id
}
