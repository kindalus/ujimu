---
name: llm-wiki
description: "Build and maintain OKF-backed LLM wikis: raw sources are converted into auditable markdown, then ingested into a fully OKF-compliant wiki that compounds knowledge through summaries, cross-references, filed queries, and linting."
license: MIT
---

# OKF-backed LLM Wiki

A skill for building and maintaining a persistent, LLM-authored markdown wiki that compounds knowledge across sources. It implements Andrej Karpathy's LLM Wiki pattern with an explicit persistence contract: `wiki/` is a fully OKF-compliant knowledge bundle, while `raw/` and `converted/` support source custody and conversion.

## The core idea

Most LLM-plus-document workflows re-derive knowledge from raw files on every query. This skill works the opposite way: ingest a source once, integrate it into a durable network of markdown pages, and keep that synthesis current as more sources and questions arrive.

Your role is not to be a one-shot answerer. Your role is to maintain a long-lived knowledge repo:

- The user curates sources and asks questions.
- You convert sources, summarize them, cross-link them, file derived answers, and keep indexes/logs current.
- Knowledge accumulates in files, not in chat history.
- The wiki gets more valuable because every ingest and substantive query updates the persistent artifact.

## Non-negotiable architecture

Every OKF-backed LLM wiki has four layers:

1. **`raw/`** — original source files collected by the user. These are immutable source-of-truth artifacts. Do not modify, rename, or delete them unless the user explicitly asks.
2. **`converted/`** — generated markdown representations of files in `raw/`. Every source passes through this layer, including `.md` and `.txt` files via `conversion_status: passthrough`. This layer is generated, non-curated, and may be overwritten during reconversion.
3. **`wiki/`** — the curated knowledge bundle authored and maintained by the LLM. This directory must be fully compliant with `references/OKF-SPEC.md`.
4. **Schema file** — `AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md` at the repo root. It records domain-specific conventions for this wiki: page taxonomy, naming, additional frontmatter rules, ingestion style, and domain-specific exceptions.

The invariant is:

```text
raw/ -> converted/ -> wiki/
```

Never ingest directly from `raw/`. Never answer a substantive query by reading `raw/` directly. Conversion is the only operation that reads `raw/`; ingest and query operate on `converted/` and `wiki/`.

## OKF persistence contract

`wiki/` is the only OKF bundle. It must follow `references/OKF-SPEC.md`:

- Every non-reserved `.md` file in `wiki/` has YAML frontmatter.
- Every concept page has a non-empty `type` field.
- Internal links use standard markdown links, not Obsidian wikilinks.
- `wiki/index.md` follows the OKF index format and has no frontmatter.
- `wiki/log.md` follows the OKF date-grouped log format.
- The local schema may add stricter requirements, but it must never weaken OKF.

Before creating or modifying files inside `wiki/`, read `references/OKF-SPEC.md` unless you already read it in the current session.

## Converted-source contract

`converted/` is not an OKF bundle, but every converted markdown file uses an OKF-like audit contract:

```yaml
---
type: Converted Source
title: "Source title or filename"
source_path: ../raw/path/to/source.pdf
source_format: pdf
source_sha256: "sha256:..."
converted_at: 2026-06-26T12:00:00Z
conversion_status: full
conversion_method: "tool or method used"
warnings: []
---
```

Use the deterministic path mapping:

```text
raw/<relative-path> -> converted/<relative-path>.md
```

Examples:

```text
raw/report.pdf       -> converted/report.pdf.md
raw/report.docx      -> converted/report.docx.md
raw/notes.md         -> converted/notes.md.md
raw/folder/a.txt     -> converted/folder/a.txt.md
```

Allowed `conversion_status` values:

- `full` — complete conversion with essential text/structure preserved.
- `partial` — only part of the content was extracted with confidence.
- `lossy` — broadly usable conversion, but layout/tables/images/structure were degraded.
- `ocr-full` — complete conversion via OCR.
- `ocr-partial` — OCR conversion was incomplete or low confidence.
- `summary-only` — no faithful conversion; only a description/summary exists.
- `metadata-only` — only metadata is available.
- `passthrough` — original was already markdown/text and was normalized/copied.
- `failed` — conversion failed; create a stub in `converted/` and stop.

Auto-ingest is allowed for `full`, `ocr-full`, `lossy`, and `passthrough`. Ask for user confirmation before ingesting `partial`, `ocr-partial`, `summary-only`, or `metadata-only`. Never ingest `failed`.

## Mode detection: do this first

Inspect the working directory before acting:

- **No schema file and no `wiki/` directory** -> initialization mode. Read `references/initialization.md`, run the domain interview, confirm the design, then scaffold.
- **Schema file present** -> operating mode. Read the schema first. It defines this wiki's local conventions and may be stricter than the base skill.
- **User asks to convert** -> run the convert operation from `references/operations.md`. This creates or updates `converted/` only.
- **User asks to ingest** -> run convert first if needed, then ingest from `converted/` into `wiki/`.
- **Existing non-OKF llm-wiki detected** -> migration is out of scope for this skill rewrite. Do not mutate it automatically; tell the user this wiki does not match the OKF-backed contract and ask for explicit migration instructions.

If you are unsure which mode applies, ask. Do not guess.

## Core principles

**Convert before ingesting.** A source is not ingestible until it has a corresponding converted markdown file. This makes every wiki claim traceable to an auditable markdown representation, not an opaque binary or remote page.

**Cross-references are the value.** A standalone summary is only marginally better than the source. The wiki becomes valuable when source pages, concepts, entities, debates, and derived pages link to each other with meaningful prose around those links.

**A single ingest touches many files.** This is normal. One source may create a source page, update several entity/concept pages, add or revise a debate, touch a synthesis page, update the index, and append to the log.

**Queries compound too.** Substantive answers are filed by default in `wiki/derived/`. Comparisons, analyses, and cross-source connections should not evaporate into chat history. Simple lookups, single-source restatements, casual back-and-forth, and explicit "do not file" requests are exceptions.

**Cite through the wiki.** Claims in curated pages should trace back to source pages; source pages trace to both `raw/` and `converted/` through frontmatter and a visible "Source Material" section.

**Flag contradictions.** Do not silently overwrite an existing claim when a new source disagrees. Add a dispute/conflicting-evidence section unless the local schema defines a domain-specific supersession model, such as legislation or ADRs.

**Do not curate `converted/`.** If conversion is wrong, improve conversion, reconvert, or correct the curated interpretation in `wiki/`. Do not hand-maintain `converted/` as if it were the wiki.

**Keep pages focused.** Prefer many small, linkable pages over sprawling pages. If a page exceeds roughly 500 lines or mixes multiple topics, propose a split.

## Operations

Read `references/operations.md` for detailed workflows:

- **Convert** — create/update `converted/<relative-raw-path>.md` from a source in `raw/`.
- **Ingest** — convert first if needed, then integrate the converted source into the OKF-compliant `wiki/`.
- **Re-ingest** — idempotently refresh an existing source page and propagate changes without duplicates.
- **Query** — answer from `wiki/`, optionally consult `converted/` when the wiki lacks detail, and file substantive answers.
- **Lint** — check wiki health, OKF conformance, conversion staleness, links, orphans, contradictions, and unfiled queries.

## Tooling notes

- The repo is just files. Use ordinary shell tools to list, search, hash, and inspect it.
- Conversion tooling is environment-dependent. Prefer common tools when available (`pandoc`, `pdftotext`, PDF parsers, OCR, HTML readability tools), but the contract matters more than the tool.
- If assets are extracted during conversion, place them beside the converted file as `<converted-basename>.assets/` and include a compact manifest in the converted file's frontmatter.
- The wiki is well-suited to git. Suggest `git init` after scaffolding if the directory is not already versioned.

## Reference files

- `references/OKF-SPEC.md` — the persistence format for `wiki/`. Read before writing or modifying `wiki/`.
- `references/initialization.md` — initialization interview, presets, and bootstrap procedure.
- `references/wiki-schema-template.md` — template instantiated as the repo-local schema file.
- `references/operations.md` — detailed convert, ingest, query, re-ingest, and lint workflows.
- `references/andrej-karpathy-post.md` — conceptual source for the LLM Wiki pattern; keep it as historical/reference material.
