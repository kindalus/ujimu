# Wiki schema template

This file is **not** the schema itself. It is the template instantiated during initialization as `AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md` at the user's wiki root.

When instantiating it:

- Replace every `{{placeholder}}`.
- Remove all guidance comments.
- Make the result self-contained.
- Do not weaken OKF. The schema may add stricter rules only.

---

```markdown
# {{Wiki Name}}

{{One-sentence description of this wiki's purpose.}}

This is the operating schema for this OKF-backed LLM wiki. Future LLM sessions must read this file before converting, ingesting, querying, linting, or modifying the wiki.

## Purpose

{{Two or three sentences describing what this wiki is for, what questions it should answer, who the audience is, and why the user wants it maintained over time.}}

## Architecture

This wiki has four layers:

- `raw/` — original source files collected by the user. **Read-only for the LLM.** Do not modify, rename, or delete without explicit user instruction.
- `converted/` — generated markdown conversions of files in `raw/`. Every source passes through this layer before ingestion, including markdown/text via `conversion_status: passthrough`. This layer is generated and may be overwritten by reconversion.
- `wiki/` — curated knowledge authored and maintained by the LLM. This is a fully OKF-compliant bundle.
- `{{schema-filename}}` — this schema file. Update it only when conventions change, and append to the schema changelog.

The required pipeline is:

```text
raw/ -> converted/ -> wiki/
```

Never ingest directly from `raw/`. Never query directly from `raw/`. Conversion is the only operation that reads raw sources.

## OKF contract

`wiki/` follows OKF as defined by the skill's `references/OKF-SPEC.md`:

- Every non-reserved `.md` file in `wiki/` has YAML frontmatter.
- Every concept page has a non-empty `type` field.
- `wiki/index.md` has no frontmatter and follows the OKF index format.
- `wiki/log.md` uses date-grouped `YYYY-MM-DD` entries.
- Internal links use standard markdown links.
- Unknown frontmatter fields are allowed and must be preserved when reasonable.

This schema adds local requirements but does not weaken OKF.

## Page taxonomy

The wiki contains these page types:

<!-- guidance: Replace with the chosen preset/custom taxonomy. Include directory, OKF type value, purpose, and slug convention. Keep `sources`, `derived`, `index`, and `log`. -->

- `wiki/sources/` — `type: Source`. One page per ingested source. Source pages summarize the converted source and provide source lineage back to both `raw/` and `converted/`.
- `wiki/{{type-directory}}/` — `type: {{Type Value}}`. {{Description and slug convention.}}
- `wiki/derived/` — `type: Derived Analysis` unless a more specific derived type is appropriate. Filed answers, comparisons, syntheses, and cross-source analyses produced from queries.
- `wiki/index.md` — OKF index of all pages, grouped by page type.
- `wiki/log.md` — OKF date-grouped update log.

## Naming conventions

- Page filenames: {{kebab-case by default, or chosen convention}}.
- Source page slugs: derive from title or filename; use stable human-readable kebab-case. If a collision occurs, append a short hash from the raw SHA-256. Do not rename on re-ingest unless the user explicitly asks.
- Derived page slugs: short, human-readable kebab-case derived from the query topic.
- Converted paths: preserve the raw relative path and append `.md`, e.g. `raw/report.pdf` -> `converted/report.pdf.md`.

## Cross-reference rules

- Link syntax: standard markdown links, e.g. `[Display Text](/concepts/example.md)`.
- Source pages link to every material entity/concept/page they discuss.
- Entity/concept/domain pages link back to source pages that support their claims.
- Derived pages cite the wiki pages they synthesize.
- Prefer links to curated `wiki/` pages over direct links to `converted/` assets. Source pages may link to raw, converted, and converted assets in their Source Material section.

## Converted-source contract

Every file in `converted/` starts with frontmatter like:

```yaml
---
type: Converted Source
title: "{{Example source title}}"
source_path: ../raw/{{example-source}}
source_format: {{pdf | docx | md | txt | html | image | spreadsheet | other}}
source_sha256: "sha256:..."
converted_at: {{ISO 8601 datetime}}
conversion_status: {{full | partial | lossy | ocr-full | ocr-partial | summary-only | metadata-only | passthrough | failed}}
conversion_method: "{{tool or method}}"
warnings: []
---
```

Conversion statuses:

- Auto-ingest allowed: `full`, `ocr-full`, `lossy`, `passthrough`.
- User confirmation required before ingest: `partial`, `ocr-partial`, `summary-only`, `metadata-only`.
- Never ingest: `failed`.

If conversion extracts assets, place them beside the converted file as `<converted-basename>.assets/` and include a compact manifest in frontmatter when possible:

```yaml
assets_dir: report.pdf.assets
assets:
  - path: report.pdf.assets/image-001.png
    kind: image
    description: "Short description."
    extraction_status: extracted
    description_status: model-described
    confidence: medium
```

## Wiki frontmatter conventions

All wiki pages except `wiki/index.md` and `wiki/log.md` require OKF frontmatter.

### Source pages

Required:

```yaml
---
type: Source
source_kind: {{pdf | docx | md | txt | html | image | spreadsheet | other}}
title: "{{Title}}"
description: "{{One-line description}}"
source_path: ../../raw/{{source-path}}
source_sha256: "sha256:..."
converted_path: ../../converted/{{converted-path}}
converted_sha256: "sha256:..."
conversion_status: {{status}}
tags: [source]
timestamp: {{ISO 8601 datetime}}
---
```

Required body sections:

```markdown
# Source Material

- Original: [raw path](../../raw/...)
- Converted: [converted path](../../converted/...)
- Conversion status: `...`

# Summary

# Key Claims

# Related Pages

# Citations
```

<!-- guidance: Adjust required source sections for the chosen domain. -->

### Derived pages

Required:

```yaml
---
type: Derived Analysis
title: "{{Title}}"
description: "{{One-line description}}"
source_pages:
  - /sources/example.md
tags: [derived]
timestamp: {{ISO 8601 datetime}}
---
```

### Other page types

<!-- guidance: Add per-type frontmatter rules. Every page type must include `type`; add `title`, `description`, `tags`, `timestamp`, `aliases`, `status`, `owner`, or domain fields as useful. -->

- `wiki/{{type-directory}}/` pages require: `type`, `title`, `description`, `tags`, `timestamp`.

## Convert workflow

When asked to convert a source:

1. Locate the source in `raw/`. If ambiguous, ask.
2. Compute `source_sha256`.
3. Determine the converted path using the path mapping rule.
4. If the converted file exists and `source_sha256` matches, do nothing unless reconversion was requested.
5. If absent or stale, convert using available tools.
6. For markdown/text, create a passthrough converted file. If original frontmatter is parseable, store it as `original_frontmatter`.
7. Extract assets when useful into `<converted-basename>.assets/` and describe them when possible.
8. If conversion fails, create a `conversion_status: failed` stub and stop.

## Ingestion workflow

When asked to ingest a source:

1. Convert first if needed. Ingest only from `converted/`.
2. Stop if conversion failed. Ask before ingesting statuses that require confirmation.
3. Read the converted file completely.
4. Discuss key takeaways with the user unless explicit batch/no-discussion mode was requested.
5. Create or update the source page in `wiki/sources/`.
6. Update or create all material entity/concept/domain pages.
7. Cross-link source pages and related pages.
8. Apply domain-specific contradiction/supersession rules.
9. Update any synthesis pages if the source changes the overall picture.
10. Update `wiki/index.md`.
11. Append an OKF-format entry to `wiki/log.md`.

## Re-ingest workflow

Re-ingest is idempotent.

1. Locate raw, converted, and existing source page.
2. If raw hash changed, reconvert automatically.
3. If converted hash did not change and no enrichment/schema change was requested, report no-op.
4. Otherwise update the existing source page without changing its slug by default.
5. Propagate changed information to related pages.
6. Treat improved conversion corrections as ingestion corrections, not source contradictions.
7. Update index and log.

## Query workflow

When asked a question:

1. Start with `wiki/index.md`.
2. Read relevant wiki pages in full.
3. Follow cross-references.
4. If detail is missing, consult relevant `converted/` files through source-page links. Never read `raw/` directly.
5. Answer with citations to wiki pages.
6. File substantive answers in `wiki/derived/` by default.
7. Update `wiki/index.md` and `wiki/log.md` when filing.

Skip filing only for simple lookups, single-source restatements, casual back-and-forth, or explicit user instruction not to file.

## Lint workflow

When asked to lint:

1. Validate OKF conformance in `wiki/`.
2. Validate local schema requirements.
3. Check source lineage: source pages reference both raw and converted files, with hashes.
4. Check stale conversions: raw hash vs converted frontmatter.
5. Check stale ingests: converted hash vs source-page frontmatter.
6. Report failed/partial conversions and questionable ingests.
7. Check contradictions, stale claims, orphans, missing pages, missing cross-references, overgrown pages, gaps, and unfiled substantive queries.
8. Present findings before applying fixes.
9. Apply approved fixes and log the lint pass.

## Log format

`wiki/log.md` uses OKF date groups, newest first:

```markdown
# Directory Update Log

## 2026-06-26
* **Ingest**: Added [Example Source](/sources/example-source.md) and updated [Example Concept](/concepts/example-concept.md).
* **Query filed**: Filed [Comparison of A and B](/derived/comparison-of-a-and-b.md).
```

Do not use the old bracketed llm-wiki log heading format.

## Domain-specific rules

<!-- guidance: Keep only rules that apply. Examples below. -->

- **Spoiler discipline:** {{Rule for time-bounded knowledge, if any.}}
- **Privacy:** {{Redaction/pseudonym/real-name policy.}}
- **Supersession:** {{Rules for amendments, ADRs, policies, or versions that supersede older claims.}}
- **Trust calibration:** {{How to record source reliability or confidence.}}
- **Lifecycle:** {{Statuses and review cadence for help articles, runbooks, policies, etc.}}
- **No-invention rule:** {{What the LLM must not infer or fabricate.}}

## What this wiki does not do

- It does not ingest directly from `raw/`.
- It does not treat `converted/` as curated knowledge.
- It does not use chat history as durable storage.
- It does not invent claims to fill gaps.
- It does not weaken OKF for convenience.

## Open questions and known gaps

<!-- guidance: Add unresolved decisions from initialization, or write "None yet." -->

- {{Open question 1}}

## Schema changelog

- **{{YYYY-MM-DD}}** — Initial schema authored during OKF-backed LLM wiki initialization.
```

---

## Filling out the template

Use the initialization interview and selected preset to fill:

| Placeholder | Source |
|---|---|
| `{{Wiki Name}}` | User-approved name |
| Purpose text | Interview purpose/audience/success answers |
| Page taxonomy | Selected preset plus customizations |
| Naming conventions | User preference or default kebab-case |
| Schema filename | `AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md` |
| Frontmatter rules | OKF + stricter local schema decisions |
| Domain-specific rules | Spoilers, privacy, supersession, confidence, lifecycle |
| Open questions | Any unresolved decisions |

If a placeholder cannot be filled confidently, ask before writing the schema.
