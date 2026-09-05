import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPdfOcrCoverageTracker,
  PdfOcrCoverageError
} from '../server/utils/ingestion/pdf-ocr-coverage'

describe('enforced visual PDF OCR coverage acceptance', () => {
  it('requires OCR text, overview, and every tile read before confirming every page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-ocr-coverage-'))
    const workspace = '.ujimu/ocr/sourcehash'
    await mkdir(join(root, workspace), { recursive: true })
    await mkdir(join(root, 'converted'))
    const tracker = createPdfOcrCoverageTracker({
      cwd: root,
      expectedPdfPaths: ['raw/lei.pdf']
    })
    tracker.recordPrepared('raw/lei.pdf', prepared(workspace, 2))

    tracker.beforeRender('raw/lei.pdf')
    tracker.recordRendered('raw/lei.pdf', rendered(workspace, 1, 2))
    tracker.recordSuccessfulRead(`${workspace}/current/page.txt`)
    tracker.recordSuccessfulRead(`${workspace}/current/overview.png`)

    await expect(tracker.confirmPage({
      pdfPath: 'raw/lei.pdf', page: 1, status: 'confirmed'
    })).rejects.toMatchObject({ code: 'PDF_OCR_VISUAL_READ_INCOMPLETE' })

    tracker.recordSuccessfulRead(`${workspace}/current/tiles/tile-0001.png`)
    tracker.recordSuccessfulRead(`${workspace}/current/tiles/tile-0002.png`)
    await tracker.confirmPage({ pdfPath: 'raw/lei.pdf', page: 1, status: 'corrected' })

    tracker.beforeRender('raw/lei.pdf')
    tracker.recordRendered('raw/lei.pdf', rendered(workspace, 2, 2))
    for (const path of [
      `${workspace}/current/page.txt`,
      `${workspace}/current/overview.png`,
      `${workspace}/current/tiles/tile-0001.png`,
      `${workspace}/current/tiles/tile-0002.png`
    ]) tracker.recordSuccessfulRead(path)
    await tracker.confirmPage({ pdfPath: 'raw/lei.pdf', page: 2, status: 'confirmed' })

    expect(tracker.isPublicationAllowed()).toBe(false)
    expect(() => tracker.assertPublishable()).not.toThrow()
    expect(() => tracker.validateManifest({
      processed: [{ raw_path: 'lei.pdf' }],
      failed: []
    })).toThrowError(PdfOcrCoverageError)
    await writeFile(join(root, workspace, 'draft.md'), '# Lei\n\nConteúdo revisto integralmente.\n')
    await expect(tracker.publishReviewedMarkdown('raw/lei.pdf')).resolves.toMatchObject({
      status: 'published',
      convertedPath: 'converted/lei.pdf.md',
      sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    })
    await expect(readFile(join(root, 'converted', 'lei.pdf.md'), 'utf8'))
      .resolves.toContain('Conteúdo revisto integralmente.')
    expect(tracker.isPublicationAllowed()).toBe(true)
    expect(() => tracker.validateManifest({
      processed: [{ raw_path: 'lei.pdf' }],
      failed: []
    })).not.toThrow()
    const ledger = JSON.parse(await readFile(join(root, workspace, 'coverage.json'), 'utf8'))
    expect(ledger).toMatchObject({
      version: 1,
      source_path: 'raw/lei.pdf',
      page_count: 2,
      pages: [
        { page: 1, status: 'corrected' },
        { page: 2, status: 'confirmed' }
      ]
    })
    expect(ledger.pages[0].images).toHaveLength(3)
  })

  it('blocks replacement of an unconfirmed page and rejects illegible or absent coverage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ujimu-ocr-rejected-'))
    const workspace = '.ujimu/ocr/sourcehash'
    await mkdir(join(root, workspace), { recursive: true })
    const tracker = createPdfOcrCoverageTracker({ cwd: root, expectedPdfPaths: ['raw/lei.pdf'] })
    tracker.recordPrepared('raw/lei.pdf', prepared(workspace, 1))
    tracker.recordRendered('raw/lei.pdf', rendered(workspace, 1, 1))

    expect(() => tracker.beforeRender('raw/lei.pdf')).toThrowError(PdfOcrCoverageError)
    expect(() => tracker.assertPublishable()).toThrowError(PdfOcrCoverageError)

    for (const path of [
      `${workspace}/current/page.txt`,
      `${workspace}/current/overview.png`,
      `${workspace}/current/tiles/tile-0001.png`,
      `${workspace}/current/tiles/tile-0002.png`
    ]) tracker.recordSuccessfulRead(path)
    await tracker.confirmPage({ pdfPath: 'raw/lei.pdf', page: 1, status: 'illegible' })

    expect(tracker.isPublicationAllowed()).toBe(false)
    expect(() => tracker.assertPublishable()).toThrowError(
      expect.objectContaining({ code: 'PDF_OCR_VISUAL_REVIEW_FAILED' })
    )
    expect(() => tracker.validateManifest({
      processed: [],
      failed: [{ raw_path: 'lei.pdf', error_code: 'PDF_OCR_VISUAL_REVIEW_FAILED' }]
    })).not.toThrow()
    expect(() => tracker.validateManifest({
      processed: [{ raw_path: 'lei.pdf' }],
      failed: []
    })).toThrowError(PdfOcrCoverageError)
  })

  it('removes bash from ingestion while exposing restricted hashing and page confirmation', async () => {
    const session = await import('../server/utils/pi/session')
    const tools = session.createUjimuCustomToolsForTask('ingestion')
    const toolNames = tools.map((tool: { name: string }) => tool.name)

    expect(session.createUjimuPiEnabledToolNames(tools, 'ingestion')).toEqual([
      'read', 'edit', 'write', 'grep', 'find', 'ls',
      'sha256_file', 'prepare_pdf_ocr', 'render_pdf_ocr_page', 'confirm_pdf_ocr_page',
      'publish_pdf_ocr_markdown'
    ])
  })
})

function prepared(workspace: string, pageCount: number) {
  return {
    status: 'prepared' as const,
    sourceSha256: 'sha256:sourcehash',
    pageCount,
    normalizedPdfPath: `${workspace}/normalized.pdf`,
    extractedTextPath: `${workspace}/document.txt`
  }
}

function rendered(workspace: string, page: number, pageCount: number) {
  return {
    status: 'rendered' as const,
    page,
    pageCount,
    overviewPath: `${workspace}/current/overview.png`,
    overviewSha256: `sha256:overview${page}`,
    ocrTextPath: `${workspace}/current/page.txt`,
    tiles: [
      { path: `${workspace}/current/tiles/tile-0001.png`, sha256: `sha256:tile1page${page}`, width: 1900, height: 1900 },
      { path: `${workspace}/current/tiles/tile-0002.png`, sha256: `sha256:tile2page${page}`, width: 1900, height: 1900 }
    ]
  }
}
