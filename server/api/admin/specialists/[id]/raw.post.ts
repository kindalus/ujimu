import { createError, defineEventHandler, getRouterParam, readMultipartFormData, setResponseStatus } from 'h3'
import { recordAdminAuditEvent } from '../../../../utils/admin/audit'
import { requireAdmin } from '../../../../utils/admin/guards'
import { canUploadRawSources, isAllowedRawSourceFileName, isCompatibleRawSourceContentType } from '../../../../utils/admin/specialists'
import { initializeDatabase } from '../../../../utils/db'
import { assertMaxRequestBytes, assertSameOriginRequest, MAX_UPLOAD_BYTES } from '../../../../utils/security/request-guards'
import { scanSpecialistRawSources } from '../../../../utils/ingestion/detect'
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
    if (!canUploadRawSources(specialist.status)) {
      setResponseStatus(event, 409)
      return {
        error: {
          code: 'SPECIALIST_NOT_READY_FOR_UPLOAD',
          message: 'Aguarde pela conclusão da inicialização antes de carregar fontes.'
        }
      }
    }

    assertSameOriginRequest(event)

    assertMaxRequestBytes(event, MAX_UPLOAD_BYTES)

    const file = await readUploadFile(event)
    if (!isAllowedRawSourceFileName(file.filename)) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported source file type' })
    }
    if (!isCompatibleRawSourceContentType(file.filename, file.contentType)) {
      throw createError({ statusCode: 400, statusMessage: 'Upload content type does not match source filename' })
    }

    const stored = await storeRawSource(specialist, {
      fileName: file.filename,
      content: file.data,
      replaceExisting: true
    })
    const state = await scanSpecialistRawSources(specialist)
    const source = state.sources[stored.relativePath]

    recordAdminAuditEvent(database, {
      admin,
      action: stored.replaced ? 'raw_source_replaced' : 'raw_source_uploaded',
      specialistId,
      metadata: { filename: stored.relativePath, bytes: file.data.length }
    })

    setResponseStatus(event, stored.replaced ? 200 : 201)
    return { stored: { relativePath: stored.relativePath }, replaced: stored.replaced, source }
  } catch (error) {
    if (error instanceof RawSourceStorageError) {
      throw createError({
        statusCode: error.code === 'RAW_SOURCE_ALREADY_EXISTS' ? 409 : 400,
        statusMessage: error.message,
        data: { code: error.code }
      })
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

async function readUploadFile(event: Parameters<typeof readMultipartFormData>[0]): Promise<{ filename: string; data: Buffer; contentType?: string }> {
  const parts = await readMultipartFormData(event).catch(() => undefined)
  const file = parts?.find((part) => part.name === 'file' && part.filename)

  if (!file?.filename || !file.data) {
    throw createError({ statusCode: 400, statusMessage: 'Missing upload file' })
  }

  const contentType = typeof file.type === 'string' ? file.type : undefined
  return { filename: file.filename, data: file.data, ...(contentType ? { contentType } : {}) }
}
