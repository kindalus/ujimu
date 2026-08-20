import { createError, getRequestHeader, type H3Event } from 'h3'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const MAX_JSON_BODY_BYTES = 1024 * 1024

/**
 * `multipart/form-data` is a content type an HTML form can send cross-origin, so unlike the JSON
 * endpoints these routes are not implicitly protected against CSRF by their content type. Requests
 * that declare an origin must declare this one.
 */
export function assertSameOriginRequest(event: H3Event): void {
  const origin = getRequestHeader(event, 'origin')
  if (!origin) {
    // Non-browser clients (and same-origin GETs) omit Origin; browsers always send it on
    // cross-origin form posts, which is the case being blocked here.
    return
  }

  const host = getRequestHeader(event, 'host')
  if (!host || originHost(origin) !== host.toLowerCase()) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cross-origin request rejected',
      data: { code: 'CROSS_ORIGIN_REJECTED' }
    })
  }
}

/**
 * h3 buffers the whole body before any handler validation runs, so the limit has to be enforced
 * from the declared length before reading.
 */
export function assertMaxRequestBytes(event: H3Event, maxBytes: number): void {
  const declared = Number(getRequestHeader(event, 'content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Request body is too large',
      data: { code: 'REQUEST_BODY_TOO_LARGE' }
    })
  }
}

function originHost(origin: string): string {
  try {
    return new URL(origin).host.toLowerCase()
  } catch {
    return ''
  }
}
