# Operations

This file describes the operating workflows for an OKF-backed LLM wiki: **convert**, **ingest**, **re-ingest**, **query**, **lint**, and maintenance operations.

Before any operation, read the local schema file at the repo root (`AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md`). It records domain-specific conventions and may be stricter than this file.

Before creating or modifying anything inside `wiki/`, read `references/OKF-SPEC.md` unless you already read it in the current session.

---

## Universal rules

1. **Never ingest directly from `raw/`.** Ingest always reads `converted/`.
2. **Never query directly from `raw/`.** Queries start in `wiki/`; if detail is missing, consult relevant `converted/` files.
3. **`raw/` is immutable.** Do not modify, rename, or delete raw sources unless the user explicitly asks.
4. **`converted/` is generated.** It is not curated and may be overwritten by reconversion.
5. **`wiki/` is the curated OKF bundle.** Every non-reserved markdown file in `wiki/` must have YAML frontmatter with `type`.
6. **Use standard markdown links in `wiki/`.** Do not write Obsidian wikilinks as the primary link format.
7. **Log in OKF format.** Use date-grouped entries in `wiki/log.md`, not the old bracketed llm-wiki format.

---

## Convert

Conversion creates or updates a markdown representation of a source from `raw/` under `converted/`. It does not modify `wiki/`.

### Path mapping

Map raw paths by preserving the full relative path and appending `.md`:

```text
raw/report.pdf       -> converted/report.pdf.md
raw/report.docx      -> converted/report.docx.md
raw/notes.md         -> converted/notes.md.md
raw/folder/a.txt     -> converted/folder/a.txt.md
```

This rule is intentionally mechanical, reversible, and collision-resistant.

### Converted frontmatter

Every converted file starts with YAML frontmatter:

```yaml
---
type: Converted Source
title: "Source title or filename"
source_path: ../raw/report.pdf
source_format: pdf
source_sha256: "sha256:..."
converted_at: 2026-06-26T12:00:00Z
conversion_status: full
conversion_method: "pymupdf"
warnings: []
assets_dir: report.pdf.assets
assets:
  - path: report.pdf.assets/image-001.png
    kind: image
    description: "Short description of the extracted asset."
    extraction_status: extracted
    description_status: model-described
    confidence: medium
---
```

Required fields:

- `type: Converted Source`
- `title`
- `source_path`
- `source_format`
- `source_sha256`
- `converted_at`
- `conversion_status`
- `conversion_method`
- `warnings`

Optional but recommended fields:

- `original_frontmatter` for markdown/text sources with parseable original frontmatter.
- `assets_dir` and `assets` when assets are extracted.
- `error` when `conversion_status: failed`.

### Conversion statuses

Use one of:

- `full` — complete conversion with essential text/structure preserved.
- `partial` — only part of the content was extracted with confidence.
- `lossy` — usable conversion with degraded layout/tables/images/structure.
- `ocr-full` — complete conversion via OCR.
- `ocr-partial` — incomplete or low-confidence OCR.
- `summary-only` — no faithful conversion; only a description/summary exists.
- `metadata-only` — only metadata is available.
- `passthrough` — original was already markdown/text and was normalized/copied.
- `failed` — conversion failed.

Auto-ingest allowed: `full`, `ocr-full`, `lossy`, `passthrough`.

User confirmation required before ingest: `partial`, `ocr-partial`, `summary-only`, `metadata-only`.

Never ingest: `failed`.

### Conversion workflow

1. **Locate the raw source.** If the user did not identify a source, list `raw/` and ask.
2. **Compute `source_sha256`.** Use a stable SHA-256 hash of the raw file.
3. **Determine converted path** using the mapping above.
4. **Check staleness.** If the converted file exists and its `source_sha256` matches, conversion can be skipped unless the user requests reconversion or conversion tooling changed. If it mismatches, reconvert automatically.
5. **Choose conversion method.** Use available tools. Prefer common tools when available: `pandoc` for DOCX/HTML-like formats, PDF text extractors for digital PDFs, OCR only when needed, spreadsheet readers for tabular files. Tool choice is flexible; the contract is mandatory.
6. **Preserve fidelity.** Converted body should be a faithful markdown representation, not a curated summary. Synthesis belongs in `wiki/`, not `converted/`.
7. **Handle markdown/text passthrough.** For `.md`/text sources, create a converted file with `conversion_status: passthrough`. If the original has parseable frontmatter, store it under `original_frontmatter` and use the original body as the converted body. If parsing fails, preserve the whole file body and add a warning.
8. **Extract assets when useful.** Place assets beside the converted file as `<converted-basename>.assets/`, for example:
   ```text
   converted/report.pdf.md
   converted/report.pdf.assets/image-001.png
   ```
   Include a compact frontmatter manifest with short descriptions when the model/tool can inspect the assets. Add a `# Extracted Assets` section in the body only when more detail is useful.
9. **On failure, create a stub and stop.** Create the converted file with `conversion_status: failed`, include `error`, and do not modify `wiki/`.

### Failed conversion stub

```markdown
---
type: Converted Source
title: "report.pdf"
source_path: ../raw/report.pdf
source_format: pdf
source_sha256: "sha256:..."
converted_at: 2026-06-26T12:00:00Z
conversion_status: failed
conversion_method: "pymupdf"
warnings: []
error: "Encrypted PDF; password required."
---

# Conversion failed

Encrypted PDF; password required.
```

---

## Ingest

Ingest integrates a converted source into the OKF-compliant `wiki/`. It always runs conversion first if the converted file is absent or stale.

### Default ingest workflow

1. **Read the local schema.** It defines the domain taxonomy, required sections, naming conventions, and stricter frontmatter requirements.
2. **Read `references/OKF-SPEC.md`** before writing `wiki/` if not already read this session.
3. **Locate the raw source.** If the user gave a converted path, trace it back through `source_path`; if ambiguous, ask.
4. **Convert first.** Create/update the converted file using the Convert workflow. If conversion fails, stop. If status requires confirmation, ask before ingesting.
5. **Read the converted file completely.** Do not skim. If it references extracted assets that matter, inspect their descriptions and, when possible, the asset files.
6. **Discuss before writing.** State 3-5 key takeaways and ask what to emphasize. Skip only when the user explicitly requested batch/no-discussion mode.
7. **Identify touched pages.** Determine which source, concept, entity, synthesis, debate, or domain pages must be created or updated.
8. **Read existing pages before editing.** Never update a page blind.
9. **Write or update the source page** under `wiki/sources/` using a stable human-readable kebab-case slug. If a slug collision occurs, append a short hash from the raw SHA-256. Re-ingest never renames by default.
10. **Update related pages.** Add new information with citations to the source page. Add cross-links. Handle contradictions or domain-specific supersession rules.
11. **Update synthesis pages** when the source changes the overall picture.
12. **Update `wiki/index.md`** following OKF index format.
13. **Append to `wiki/log.md`** using OKF date-grouped format.
14. **Tell the user what changed.** List created/updated files briefly.

### Source page frontmatter

A source page in `wiki/sources/` uses `type: Source` plus `source_kind`:

```yaml
---
type: Source
source_kind: pdf
title: "Annual Report 2025"
description: "One-sentence summary of the source."
source_path: ../../raw/report.pdf
source_sha256: "sha256:..."
converted_path: ../../converted/report.pdf.md
converted_sha256: "sha256:..."
conversion_status: full
tags: [source]
timestamp: 2026-06-26T12:00:00Z
---
```

The body should include a human-readable source-material section:

```markdown
# Source Material

- Original: [raw/report.pdf](../../raw/report.pdf)
- Converted: [converted/report.pdf.md](../../converted/report.pdf.md)
- Conversion status: `full`
```

Then include domain-specific sections such as summary, key claims, evidence, methodology, relevant entities/concepts, open questions, and citations.

### Log format

Use OKF date groups, newest first:

```markdown
## 2026-06-26
* **Ingest**: Added [Annual Report 2025](/sources/annual-report-2025.md). Updated [Revenue](/concepts/revenue.md) and [Pricing](/concepts/pricing.md).
```

For a query that is filed:

```markdown
## 2026-06-26
* **Query filed**: Filed [Comparison of X and Y](/derived/comparison-of-x-and-y.md) from user question "How do X and Y differ?".
```

If the date heading already exists, add the entry under it. Keep newest dates first.

### Batch ingest

Batch convert is allowed. Batch ingest is allowed only by explicit user request. Batch ingest may skip discussion only when the user explicitly says batch/no-discussion mode. Even in batch mode:

- Convert each source first.
- Do not ingest `failed` conversions.
- Ask before ingesting statuses that require confirmation unless the user pre-approved them.
- Preserve OKF compliance.
- Update index and log.

---

## Re-ingest

Re-ingest is idempotent by default. If the raw source, converted artifact, and schema-relevant interpretation did not change, re-ingest should not create duplicates or unnecessary edits.

### Re-ingest workflow

1. **Identify canonical records.** Locate the raw file, converted file, and existing `wiki/sources/` page. Confirm identity using `source_path`, `source_sha256`, `converted_path`, and `converted_sha256`.
2. **Check raw staleness.** If the raw hash differs from the converted frontmatter, reconvert automatically.
3. **Check converted staleness.** If the converted file changed since last ingest, continue. If it did not, inspect whether the user asked for enrichment, schema changes, or correction.
4. **No-op when appropriate.** If nothing changed and no enrichment was requested, report that the source is already current and optionally log a verification entry if useful.
5. **Update the existing source page.** Do not create `source-2.md`. Preserve the source slug unless the user explicitly requests a rename.
6. **Propagate differences.** Update pages that cite or depend on the source. Remove or correct claims caused by old conversion errors. If the new conversion corrects the old extraction, treat it as an ingestion correction, not as a contradiction between sources.
7. **Update index and log.** Distinguish no-op, conversion-improved, raw-content-changed, and schema-driven re-ingests.

Suggested source-page body section:

```markdown
# Ingestion History

- 2026-06-26: Re-ingested after improved PDF conversion; updated affected concept pages.
```

---

## Query

A query answers a user question from the accumulated wiki. It starts in `wiki/`, not `raw/`.

### Query workflow

1. **Read the local schema** to understand page types and conventions.
2. **Read `wiki/index.md`** to find candidate pages.
3. **Read candidate pages in full.** Do not rely on snippets.
4. **Follow cross-references** to related pages.
5. **Consult `converted/` only when needed.** If the wiki does not contain enough detail, use source-page frontmatter/body links to locate relevant converted files. Never read `raw/` directly.
6. **Synthesize an answer** with citations to wiki pages. If you used details from `converted/` that are not yet represented in the wiki, cite the relevant source page and update/file wiki content as described below.
7. **File substantive answers by default** in `wiki/derived/`, unless the user explicitly says not to.

Do not file:

- Simple lookups already answered by an existing page.
- Single-source restatements that should simply point to the source page.
- Casual back-and-forth.
- User-explicit "do not file" requests.

Borderline cases should be filed. It is cheaper to delete a redundant derived page later than to reconstruct a lost synthesis.

### Derived page frontmatter

```yaml
---
type: Derived Analysis
title: "Comparison of X and Y"
description: "Compares X and Y across cost, risk, and evidence."
source_pages:
  - /sources/source-a.md
  - /concepts/concept-x.md
tags: [derived]
timestamp: 2026-06-26T12:00:00Z
---
```

`source_pages` points to OKF pages. Raw/converted lineage remains available through source pages.

### Query logging

Filed query:

```markdown
* **Query filed**: Filed [Comparison of X and Y](/derived/comparison-of-x-and-y.md) from user question "How do X and Y differ?".
```

Unfiled query:

```markdown
* **Query**: Answered "When was Source A published?" Not filed: simple lookup already present in [Source A](/sources/source-a.md).
```

---

## Lint

Lint checks the health of the wiki and the conversion pipeline. Run when the user asks, or periodically on mature wikis.

### What to check

#### OKF conformance

- Every non-reserved `.md` file under `wiki/` has parseable YAML frontmatter.
- Every concept page has non-empty `type`.
- `wiki/index.md` has no frontmatter and follows OKF index shape.
- `wiki/log.md` uses date headings in `YYYY-MM-DD` form.
- Internal wiki links are markdown links.
- Local schema requirements are satisfied.

#### Conversion layer

- Every ingested source page has both `source_path` and `converted_path`.
- Every ingested source page has `source_sha256` and `converted_sha256`.
- Converted files referenced by wiki source pages exist.
- Raw hashes match converted frontmatter; mismatches mean converted files are stale.
- Converted hashes match wiki source frontmatter; mismatches mean source pages may be stale.
- `conversion_status: failed` files are reported.
- `partial`, `ocr-partial`, `summary-only`, and `metadata-only` ingests had user confirmation or should be reviewed.

#### Knowledge graph health

- Contradictions across pages.
- Stale claims superseded by newer sources.
- Orphan pages with no inbound links.
- Missing pages for frequently mentioned entities/concepts.
- Missing cross-references.
- Overgrown pages over roughly 500 lines.
- Gaps relative to the schema's purpose statement.
- Unfiled queries that look substantive.

### Lint workflow

1. Read the local schema.
2. Read `references/OKF-SPEC.md`.
3. Read `wiki/index.md` and recent `wiki/log.md` entries.
4. Run cheap programmatic checks where possible: file lists, hash comparisons, frontmatter presence, link grep, orphan detection.
5. Sample important hub pages and recently changed pages.
6. Produce a report with severity:
   - **Blocking** — OKF violations, source lineage breaks, factual contradictions, stale conversion used for ingestion.
   - **Warning** — orphans, missing pages, missing cross-references, questionable partial ingests, unfiled substantive queries.
   - **Suggestion** — gaps, overgrown pages, schema improvements.
7. Present findings to the user. Do not silently apply fixes.
8. Apply approved fixes.
9. Log the lint pass in OKF format.

Example log entry:

```markdown
* **Lint**: Found 2 blocking issues and 5 warnings. Fixed missing frontmatter on [Foo](/concepts/foo.md); deferred source reconversion for `report.pdf` pending user review.
```

---

## Other maintenance operations

Follow the same discipline: preserve OKF, update cross-references, update index, and log.

- **Rename a page.** Update every inbound link, index entry, and any `source_pages` references.
- **Merge pages.** Choose a canonical path, move content, update links, and log.
- **Split a page.** Create focused pages, redistribute content, link them, update index, and log.
- **Schema amendment.** Update the schema file, append to its changelog, and log. The amendment may add stricter rules but cannot weaken OKF.
- **Reconvert.** Update `converted/` from `raw/`; do not touch `wiki/` unless followed by re-ingest.
- **Asset promotion.** By default, wiki pages cite source pages rather than linking directly to converted assets. If an asset is itself curated knowledge, copy it into `wiki/assets/` intentionally and link it from the relevant OKF page.

The general rule: if a future agent would need to know the change happened, log it.
