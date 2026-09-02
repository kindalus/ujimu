# Visual OCR ingestion plan

Status: completed and verified

Approved source decks:

- `docs/specs/brainstorm-visual-ocr-ingestion.html`
- `docs/specs/visual-ocr-ingestion-architecture.html`

## Locked decisions

- PDF processing must not use Gemini.
- Local OCR uses Portuguese and English language data.
- The model configured by `UJIMU_PI_INGESTION_PROVIDER` and `UJIMU_PI_INGESTION_MODEL` performs visual confirmation.
- Every PDF page must be visually confirmed, including pages with native text, using one overview plus overlapping 300 DPI tiles below 2000×2000 pixels.
- All required images and the current OCR text must be read successfully before the page can be confirmed.
- Any missing or persistently illegible content rejects the complete document before wiki ingestion.
- `raw/` remains immutable and canonical.
- Processing is sequential and bounded to one rendered page at a time.

## Slice order

1. Slice 72 — verified: installed and exposed the local PDF inspection, OCR, and page-rendering foundation without publishing converted or wiki content.
2. Slice 73 — verified: requires and validates complete visual page coverage before atomically accepting converted Markdown and permitting wiki ingestion.

## Quality gates per slice

- Acceptance tests first.
- Full test suite.
- Typecheck and production build.
- Dependency audit.
- Container-level verification for installed OCR tools.
