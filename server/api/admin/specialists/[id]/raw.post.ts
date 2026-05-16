import { createError, defineEventHandler, getRouterParam, readMultipartFormData, setResponseStatus } from 'h3'
import { recordAdminAuditEvent } from '../../../../utils/admin/audit'
import { requireAdmin } from '../../../../utils/admin/guards'
import { isAllowedRawSourceFileName } from '../../../../utils/admin/specialists'
import { initializeDatabase } from '../../../../utils/db'
import { RawSourceStorageError, storeRawSource } from '../../../../utils/ingestion/storage'
import { getSpecialistById } from '../../../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    const admin = requireAdmin(database, event)
    const specialistId = getRequiredSpecialistId(event)
    const specialist = await getSpecialistById(specialistId)
    if (!specialist) {
      throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
    }

    const file = await readUploadFile(event)
    if (!isAllowedRawSourceFileName(file.filename)) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported source file type' })
    }

    const stored = await storeRawSource(specialist, {
      fileName: file.filename,
      content: file.data
    })

    recordAdminAuditEvent(database, {
      admin,
      action: 'raw_source_uploaded',
      specialistId,
      metadata: { filename: stored.relativePath, bytes: file.data.length }
    })

    setResponseStatus(event, 201)
    return { stored: { relativePath: stored.relativePath } }
  } catch (error) {
    if (error instanceof RawSourceStorageError) {
      throw createError({
        statusCode: error.code === 'RAW_SOURCE_ALREADY_EXISTS' ? 409 : 400,
        statusMessage: error.message,
        data: { code: error.code }
      })
    }

    throw error
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

async function readUploadFile(event: Parameters<typeof readMultipartFormData>[0]): Promise<{ filename: string; data: Buffer }> {
  const parts = await readMultipartFormData(event).catch(() => undefined)
  const file = parts?.find((part) => part.name === 'file' && part.filename)

  if (!file?.filename || !file.data) {
    throw createError({ statusCode: 400, statusMessage: 'Missing upload file' })
  }

  return { filename: file.filename, data: file.data }
}
