import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { recordAdminAuditEvent } from '../../../../../utils/admin/audit'
import { requireAdmin } from '../../../../../utils/admin/guards'
import { countSources } from '../../../../../utils/admin/specialists'
import { initializeDatabase } from '../../../../../utils/db'
import { scanSpecialistRawSources } from '../../../../../utils/ingestion/detect'
import { PiIngestionDisabledError, runPendingIngestion } from '../../../../../utils/ingestion/run'
import { enqueueSpecialistIngestionJob, scheduleDueBackgroundJobs } from '../../../../../utils/jobs/background'
import { getSpecialistById } from '../../../../../utils/specialists/registry'

const disabledMessage = 'A ingestão automática não está activa neste ambiente.'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const admin = requireAdmin(database, event)
    const specialistId = getRequiredSpecialistId(event)
    const specialist = await getSpecialistById(specialistId)
    if (!specialist) {
      throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
    }

    try {
      if (process.env.UJIMU_PI_INGESTION_ENABLED === 'true') {
        const state = await scanSpecialistRawSources(specialist)
        const sources = Object.values(state.sources).sort((left, right) => left.raw_path.localeCompare(right.raw_path))
        const counts = countSources(sources)
        const job = enqueueSpecialistIngestionJob(database, { specialistId })
        recordAdminAuditEvent(database, {
          admin,
          action: 'ingestion_started',
          specialistId,
          metadata: { job_id: job.id, status: job.status }
        })
        scheduleDueBackgroundJobs()
        setResponseStatus(event, 202)
        return { job, sources, counts }
      }

      const state = await runPendingIngestion(specialist)
      const sources = Object.values(state.sources).sort((left, right) => left.raw_path.localeCompare(right.raw_path))
      const counts = countSources(sources)
      recordAdminAuditEvent(database, {
        admin,
        action: 'ingestion_completed',
        specialistId,
        metadata: { counts }
      })
      return { sources, counts }
    } catch (error) {
      if (error instanceof PiIngestionDisabledError) {
        recordAdminAuditEvent(database, {
          admin,
          action: 'ingestion_skipped_disabled',
          specialistId,
          metadata: { error_code: error.code }
        })
        setResponseStatus(event, 409)
        return { error: { code: error.code, message: disabledMessage } }
      }

      throw error
    }
  } finally {
    database.close()
  }
})

function getRequiredSpecialistId(event: Parameters<typeof getRouterParam>[0]): string {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }
  return id
}
