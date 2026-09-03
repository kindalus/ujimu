# Remove Gemini dependency plan

## Goal

Remove the Gemini CLI, API-key contract, configured Gemini model, and `pdf_to_markdown` tool while keeping the existing visual OCR ingestion pipeline as the only PDF path.

## Governing decisions

- Approved brainstorm: `docs/specs/brainstorm-remove-gemini-dependency.html`.
- Approved architecture: `docs/specs/remove-gemini-dependency-architecture.html`.
- Slice: `docs/specs/slices/74-remove-gemini-dependency.html`.
- Keep the manual conversion endpoint for non-PDF sources.
- Reject manual PDF conversion with `PDF_CONVERSION_REQUIRES_INGESTION`.
- Do not build a second local PDF converter.
- Preserve historical slice decks as the record of superseded decisions.

## Ordered work

1. Refine and stress-test Slice 74.
2. Add acceptance coverage for the stable PDF redirect error and absence of Gemini/tool wiring.
3. Remove the PDF tool wrapper, extension, script, runtime package, API-key examples, and active model configuration.
4. Update current operational documentation and canonical slice status.
5. Run focused tests, the full test suite, typecheck, build, high-severity audit, and a container image smoke test proving `gemini` is absent while OCR tools remain present.
6. Deploy with database/environment backup and rollback; remove `GEMINI_API_KEY` from the production environment after the replacement image is healthy.

## Verification

- Manual PDF conversion fails safely without creating Markdown.
- Manual non-PDF conversion remains unchanged.
- Normal PDF ingestion retains OCRmyPDF, qpdf, Poppler, Tesseract `por+eng`, visual page coverage, and atomic publication.
- No active code, runtime configuration, current operations documentation, or tests depend on Gemini or `pdf_to_markdown`.
