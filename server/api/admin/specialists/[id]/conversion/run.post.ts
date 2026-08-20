import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { recordAdminAuditEvent } from '../../../../../utils/admin/audit'
import { requireAdmin } from '../../../../../utils/admin/guards'
import { countSources } from '../../../../../utils/admin/specialists'
import { initializeDatabase } from '../../../../../utils/db'
import { PiConversionDisabledError, runPendingConversions } from '../../../../../utils/ingestion/conversion'
import { getSpecialistById } from '../../../../../utils/specialists/registry'

const disabledMessage = 'A conversão automática não está activa neste ambiente.'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  const admin = requireAdmin(database, event)
  const specialistId = getRequiredSpecialistId(event)
  const specialist = await getSpecialistById(specialistId)
  if (!specialist) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }

  try {
    const result = await runPendingConversions(specialist)
    const counts = countSources(result.sources)
    recordAdminAuditEvent(database, {
      admin,
      action: 'conversion_run',
      specialistId,
      metadata: {
        converted: result.converted,
        failed: result.failed,
        skipped: result.skipped,
        counts
      }
    })
    return { converted: result.converted, failed: result.failed, skipped: result.skipped, sources: result.sources, counts }
  } catch (error) {
    if (error instanceof PiConversionDisabledError) {
      recordAdminAuditEvent(database, {
        admin,
        action: 'conversion_skipped_disabled',
        specialistId,
        metadata: { error_code: error.code }
      })
      setResponseStatus(event, 409)
      return { error: { code: error.code, message: disabledMessage } }
    }

    throw error
  }
})

function getRequiredSpecialistId(event: Parameters<typeof getRouterParam>[0]): string {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }
  return id
}
