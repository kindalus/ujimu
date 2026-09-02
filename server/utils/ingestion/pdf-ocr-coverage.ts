import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export type PdfOcrPageStatus = 'confirmed' | 'corrected' | 'illegible'

export interface PdfOcrPreparedResult {
  status: 'prepared'
  sourceSha256: string
  pageCount: number
  normalizedPdfPath: string
  extractedTextPath: string
}

export interface PdfOcrRenderedResult {
  status: 'rendered'
  page: number
  pageCount: number
  overviewPath: string
  overviewSha256: string
  ocrTextPath: string
  tiles: Array<{ path: string; sha256: string; width: number; height: number }>
}

export interface PdfOcrCoverageTracker {
  recordPrepared(pdfPath: string, result: PdfOcrPreparedResult): void
  recordPreparationFailure(pdfPath: string, code: string): void
  beforeRender(pdfPath: string): void
  recordRendered(pdfPath: string, result: PdfOcrRenderedResult): void
  recordSuccessfulRead(path: string): void
  requiresVisualReview(): boolean
  confirmPage(input: { pdfPath: string; page: number; status: PdfOcrPageStatus }): Promise<void>
  publishReviewedMarkdown(pdfPath: string): Promise<{
    status: 'published'
    convertedPath: string
    bytes: number
    sha256: string
  }>
  isPublicationAllowed(): boolean
  isManagedConvertedPath(path: string): boolean
  assertPublishable(): void
  validateManifest(manifest: {
    processed: Array<{ raw_path: string }>
    failed: Array<{ raw_path: string; error_code: string }>
  }): void
}

export class PdfOcrCoverageError extends Error {
  constructor(
    public readonly code:
      | 'PDF_OCR_SOURCE_UNEXPECTED'
      | 'PDF_OCR_NOT_PREPARED'
      | 'PDF_OCR_PAGE_UNCONFIRMED'
      | 'PDF_OCR_VISUAL_READ_INCOMPLETE'
      | 'PDF_OCR_COVERAGE_INCOMPLETE'
      | 'PDF_OCR_VISUAL_REVIEW_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'PdfOcrCoverageError'
  }
}

interface CurrentPage {
  result: PdfOcrRenderedResult
  requiredReads: Set<string>
  successfulReads: Set<string>
}

interface SourceCoverage {
  prepared?: PdfOcrPreparedResult
  preparationFailure?: string
  current?: CurrentPage
  published?: boolean
  pages: Map<number, {
    page: number
    status: PdfOcrPageStatus
    ocr_text_path: string
    images: Array<{ path: string; sha256: string }>
  }>
}

export function createPdfOcrCoverageTracker(options: {
  cwd: string
  expectedPdfPaths: string[]
}): PdfOcrCoverageTracker {
  const root = resolve(options.cwd)
  const expected = new Set(options.expectedPdfPaths.map(normalizePdfPath))
  const sources = new Map<string, SourceCoverage>(
    [...expected].map(path => [path, { pages: new Map() }])
  )

  function requireSource(pdfPath: string): [string, SourceCoverage] {
    const path = normalizePdfPath(pdfPath)
    const source = sources.get(path)
    if (!source) {
      throw new PdfOcrCoverageError('PDF_OCR_SOURCE_UNEXPECTED', 'PDF is not pending in this ingestion batch.')
    }
    return [path, source]
  }

  function assertReviewed(source: SourceCoverage): void {
    if (source.preparationFailure) return
    if (!source.prepared || source.current || source.pages.size !== source.prepared.pageCount) {
      throw new PdfOcrCoverageError('PDF_OCR_COVERAGE_INCOMPLETE', 'Not every PDF page has complete visual coverage.')
    }
    for (let page = 1; page <= source.prepared.pageCount; page += 1) {
      if (!source.pages.has(page)) {
        throw new PdfOcrCoverageError('PDF_OCR_COVERAGE_INCOMPLETE', 'PDF page coverage is not contiguous.')
      }
    }
  }

  function failureCode(source: SourceCoverage): string | undefined {
    if (source.preparationFailure) return source.preparationFailure
    return [...source.pages.values()].some(page => page.status === 'illegible')
      ? 'PDF_OCR_VISUAL_REVIEW_FAILED'
      : undefined
  }

  function assertPublishable(): void {
    for (const path of expected) {
      const source = sources.get(path)!
      assertReviewed(source)
      if (failureCode(source)) {
        throw new PdfOcrCoverageError('PDF_OCR_VISUAL_REVIEW_FAILED', 'PDF failed visual coverage requirements.')
      }
    }
  }

  return {
    recordPrepared(pdfPath, result) {
      const [, source] = requireSource(pdfPath)
      if (!Number.isInteger(result.pageCount) || result.pageCount < 1) {
        throw new PdfOcrCoverageError('PDF_OCR_NOT_PREPARED', 'Prepared PDF page count is invalid.')
      }
      source.prepared = result
      source.preparationFailure = undefined
      source.current = undefined
      source.published = false
      source.pages.clear()
    },

    recordPreparationFailure(pdfPath, code) {
      const [, source] = requireSource(pdfPath)
      source.preparationFailure = code
      source.prepared = undefined
      source.current = undefined
      source.published = false
      source.pages.clear()
    },

    beforeRender(pdfPath) {
      const [, source] = requireSource(pdfPath)
      if (!source.prepared) {
        throw new PdfOcrCoverageError('PDF_OCR_NOT_PREPARED', 'PDF must be prepared before visual review.')
      }
      if (source.current) {
        throw new PdfOcrCoverageError('PDF_OCR_PAGE_UNCONFIRMED', 'Confirm the current PDF page before rendering another page.')
      }
    },

    recordRendered(pdfPath, result) {
      const [, source] = requireSource(pdfPath)
      if (
        !source.prepared ||
        result.pageCount !== source.prepared.pageCount ||
        result.page !== source.pages.size + 1 ||
        result.page > result.pageCount
      ) {
        throw new PdfOcrCoverageError('PDF_OCR_NOT_PREPARED', 'Rendered PDF page does not match the next expected page.')
      }
      if (source.current) {
        throw new PdfOcrCoverageError('PDF_OCR_PAGE_UNCONFIRMED', 'A PDF page is already awaiting confirmation.')
      }
      if (
        result.tiles.length === 0 ||
        result.tiles.some(tile => tile.width < 1 || tile.height < 1 || tile.width >= 2000 || tile.height >= 2000)
      ) {
        throw new PdfOcrCoverageError('PDF_OCR_VISUAL_READ_INCOMPLETE', 'Rendered PDF page has invalid high-resolution tiles.')
      }
      const requiredReads = new Set([
        absoluteWithinRoot(root, result.ocrTextPath),
        absoluteWithinRoot(root, result.overviewPath),
        ...result.tiles.map(tile => absoluteWithinRoot(root, tile.path))
      ])
      source.current = { result, requiredReads, successfulReads: new Set() }
    },

    recordSuccessfulRead(path) {
      const absolute = resolve(root, path)
      for (const source of sources.values()) {
        if (source.current?.requiredReads.has(absolute)) {
          source.current.successfulReads.add(absolute)
        }
      }
    },

    requiresVisualReview() {
      return expected.size > 0
    },

    async confirmPage(input) {
      const [pdfPath, source] = requireSource(input.pdfPath)
      const current = source.current
      if (!current || current.result.page !== input.page) {
        throw new PdfOcrCoverageError('PDF_OCR_PAGE_UNCONFIRMED', 'Rendered PDF page does not match the confirmation.')
      }
      if (!['confirmed', 'corrected', 'illegible'].includes(input.status)) {
        throw new PdfOcrCoverageError('PDF_OCR_VISUAL_REVIEW_FAILED', 'PDF page status is invalid.')
      }
      const missing = [...current.requiredReads].filter(path => !current.successfulReads.has(path))
      if (missing.length > 0) {
        throw new PdfOcrCoverageError('PDF_OCR_VISUAL_READ_INCOMPLETE', 'Read OCR text, overview, and every tile before confirmation.')
      }

      source.pages.set(input.page, {
        page: input.page,
        status: input.status,
        ocr_text_path: current.result.ocrTextPath,
        images: [
          { path: current.result.overviewPath, sha256: current.result.overviewSha256 },
          ...current.result.tiles
        ]
      })
      source.current = undefined
      try {
        await writeCoverageLedger(root, pdfPath, source)
      } catch (error) {
        source.pages.delete(input.page)
        source.current = current
        throw error
      }
    },

    async publishReviewedMarkdown(pdfPath) {
      const [sourcePath, source] = requireSource(pdfPath)
      assertPublishable()
      const prepared = source.prepared!
      const workspace = dirname(absoluteWithinRoot(root, prepared.normalizedPdfPath))
      const draft = resolve(workspace, 'draft.md')
      const draftStats = await lstat(draft).catch(() => undefined)
      if (!draftStats?.isFile() || draftStats.isSymbolicLink()) {
        throw new PdfOcrCoverageError('PDF_OCR_COVERAGE_INCOMPLETE', 'Reviewed PDF Markdown draft is missing.')
      }
      const content = await readFile(draft)
      if (content.toString('utf8').replace(/\s/gu, '').length < 20) {
        throw new PdfOcrCoverageError('PDF_OCR_COVERAGE_INCOMPLETE', 'Reviewed PDF Markdown draft is empty.')
      }

      const convertedPath = `converted/${sourcePath.slice('raw/'.length)}.md`
      const target = absoluteWithinRoot(root, convertedPath)
      const convertedRoot = resolve(root, 'converted')
      if (!isWithin(convertedRoot, target)) {
        throw new PdfOcrCoverageError('PDF_OCR_SOURCE_UNEXPECTED', 'Converted PDF target escapes converted/.')
      }
      await ensureSafeOutputParent(convertedRoot, target)
      const temporary = `${target}.tmp`
      await copyFile(draft, temporary)
      try {
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      await chmod(target, 0o600).catch(() => undefined)
      source.published = true
      return {
        status: 'published',
        convertedPath,
        bytes: content.byteLength,
        sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`
      }
    },

    isPublicationAllowed() {
      try {
        assertPublishable()
        return [...expected].every(path => sources.get(path)?.published === true)
      } catch {
        return false
      }
    },

    isManagedConvertedPath(path) {
      const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '')
      return [...expected].some(sourcePath =>
        normalized === `converted/${sourcePath.slice('raw/'.length)}.md`
      )
    },

    assertPublishable,

    validateManifest(manifest) {
      const processed = new Set(manifest.processed.map(entry => entry.raw_path))
      const failed = new Map(manifest.failed.map(entry => [entry.raw_path, entry.error_code]))
      for (const path of expected) {
        const source = sources.get(path)!
        assertReviewed(source)
        const rawPath = path.slice('raw/'.length)
        const expectedFailure = failureCode(source)
        if (expectedFailure) {
          if (processed.has(rawPath) || failed.get(rawPath) !== expectedFailure) {
            throw new PdfOcrCoverageError('PDF_OCR_VISUAL_REVIEW_FAILED', 'Failed PDF is not represented correctly in the ingestion manifest.')
          }
        } else if (!source.published || !processed.has(rawPath) || failed.has(rawPath)) {
          throw new PdfOcrCoverageError('PDF_OCR_COVERAGE_INCOMPLETE', 'Reviewed PDF was not atomically published or represented correctly in the ingestion manifest.')
        }
      }
    }
  }
}

async function writeCoverageLedger(root: string, sourcePath: string, source: SourceCoverage): Promise<void> {
  const prepared = source.prepared
  if (!prepared) return
  const workspace = dirname(absoluteWithinRoot(root, prepared.normalizedPdfPath))
  const ocrRoot = resolve(root, '.ujimu', 'ocr')
  if (!isWithin(ocrRoot, workspace)) {
    throw new PdfOcrCoverageError('PDF_OCR_NOT_PREPARED', 'Coverage ledger path escapes the OCR workspace.')
  }
  const target = resolve(workspace, 'coverage.json')
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    version: 1,
    source_path: sourcePath,
    source_sha256: prepared.sourceSha256,
    page_count: prepared.pageCount,
    pages: [...source.pages.values()].sort((left, right) => left.page - right.page)
  }, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, target)
  await chmod(target, 0o600).catch(() => undefined)
}

async function ensureSafeOutputParent(outputRoot: string, target: string): Promise<void> {
  const realOutputRoot = await realpathOrEmpty(outputRoot)
  if (!realOutputRoot) {
    throw new PdfOcrCoverageError('PDF_OCR_SOURCE_UNEXPECTED', 'Converted output root is missing.')
  }
  let existingParent = dirname(target)
  while (isWithin(outputRoot, existingParent)) {
    const resolved = await realpathOrEmpty(existingParent)
    if (resolved) {
      if (!isWithin(realOutputRoot, resolved)) {
        throw new PdfOcrCoverageError('PDF_OCR_SOURCE_UNEXPECTED', 'Converted PDF parent escapes converted/.')
      }
      break
    }
    existingParent = dirname(existingParent)
  }
  await mkdir(dirname(target), { recursive: true })
  const realParent = await realpathOrEmpty(dirname(target))
  if (!realParent || !isWithin(realOutputRoot, realParent)) {
    throw new PdfOcrCoverageError('PDF_OCR_SOURCE_UNEXPECTED', 'Converted PDF parent escapes converted/.')
  }
}

async function realpathOrEmpty(path: string): Promise<string> {
  return realpath(path).catch(() => '')
}

function normalizePdfPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '')
}

function absoluteWithinRoot(root: string, path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  if (!isWithin(root, absolute)) {
    throw new PdfOcrCoverageError('PDF_OCR_SOURCE_UNEXPECTED', 'OCR artefact escapes the specialist root.')
  }
  return absolute
}

function isWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}
