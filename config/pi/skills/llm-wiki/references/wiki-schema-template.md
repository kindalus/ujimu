# Wiki schema template

This file is **not** the schema itself — it is the template the skill instantiates for the user's wiki. Every `{{placeholder}}` should be replaced with a value decided during the domain interview. Every comment marked `<!-- guidance -->` is for the LLM filling out the template and should be removed from the final file written to the user's wiki.

When you instantiate this for a user, write the result to the wiki root as `AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md` (per the convention chosen during initialization), and remove all guidance comments. The result should read as a clean, self-contained document the user can review.

---

```markdown
# {{Wiki Name}}

<!-- guidance: a one-line description, e.g. "A research wiki on alignment evaluations" -->
{{One-sentence description of this wiki's purpose.}}

This document is the schema for this wiki. It tells future LLM sessions how the wiki is organized and what conventions to follow. **Read this file at the start of every session before performing any operation.**

## Purpose

{{Two or three sentences describing what this wiki is for, what kinds of questions it should be able to answer, and the user's intent in maintaining it.}}

## Architecture

- `raw/` — source documents. **Read-only.** Never modify, rename, or delete files here without explicit instruction from the user.
- `wiki/` — markdown pages authored and maintained by the LLM. This is the working layer.
- This file (`{{schema-filename}}`) — the schema you are reading now. Co-authored with the user; update it (with their approval) when conventions evolve.

## Page taxonomy

The wiki contains the following types of pages, each in its own subdirectory of `wiki/`:

<!-- guidance: list every page type from the chosen preset (or custom design). Include subdirectory, what each page describes, and a short slug convention. -->

- **`wiki/sources/`** — {{description of source pages: what each one summarizes, what fields it contains}}
- **`wiki/{{type-2}}/`** — {{description}}
- **`wiki/{{type-3}}/`** — {{description}}
<!-- ... add as many as the preset specifies ... -->
- **`wiki/derived/`** — pages produced from queries: comparisons, analyses, connections, syntheses across multiple sources. Filed by default rather than discarded into chat history. See "Query workflow" below.
- **`wiki/index.md`** — catalog of all pages, updated on every ingest and on every filed query. Organized by page type.
- **`wiki/log.md`** — chronological record of operations. Each entry starts with `## [YYYY-MM-DD] {{operation}} | {{summary}}`. Operation values include `init`, `ingest`, `query`, `query-filed`, `lint`, plus any others your wiki uses.

## Naming conventions

- Page filenames: {{kebab-case | snake_case | Title Case}} (e.g. `{{example-filename}}.md`).
- Slugs in cross-references: {{slug rule, e.g. lowercase kebab-case matching filename without extension}}.
- Source-page slugs: {{rule, e.g. `YYYY-MM-DD-short-title` or `author-year-keyword`}}.

## Cross-reference style

- **Link syntax:** {{`[[Wikilinks]]` (Obsidian) | `[Display Text](relative/path.md)` (plain markdown)}}.
- **What links to what:** {{the cross-reference rules from the preset, e.g. "Source pages link to every entity and concept they discuss. Entity pages link back to all sources that mention them. Concept pages list all sources discussing them and all related concepts."}}
- **Inline citations:** {{format, e.g. "After a claim, append `[source-slug]` linking to the source's summary page"}}.

## Frontmatter conventions

<!-- guidance: only include if the user opted in to YAML frontmatter. Otherwise replace this whole section with "Pages do not use YAML frontmatter in this wiki." -->

Pages use YAML frontmatter as follows:

- **Source pages:** `title`, `author`, `date_published`, `date_ingested`, `source_url` or `source_path`, `tags`.
- **Entity pages:** `tags`, `aliases` (other names this entity goes by), `last_updated`.
- **Other types:** {{specify per-type as needed, or "no required frontmatter"}}.

## Ingestion ritual

When the user asks to ingest a new source from `raw/`, perform the following steps in order:

1. **Read the source.** If it's long, read fully — do not skim. If it has images and they're available locally, view them.
2. **Discuss with the user.** Briefly state the key takeaways and ask if there's anything specific to emphasize. Do not skip this step unless the user has explicitly said "batch mode, no discussion."
3. **Write the source page** in `wiki/sources/` following the {{slug rule}} for the filename. The page should contain:
   - {{required sections, e.g. summary, key claims, methodology, contribution to thesis, open questions}}
4. **Update or create entity / concept pages** for everything material the source mentions. {{Domain-specific guidance, e.g. "Each character mentioned gets their page updated with new behavior, dialogue, or revelations from this chapter — but only what is on-screen in this chapter."}}
5. **Cross-link.** Add backlinks from entity/concept pages to the source page. Add forward links from the source page to all entity/concept pages.
6. **Flag contradictions.** If anything in the new source disagrees with existing wiki content, do not silently overwrite. Add a "Conflicting evidence" subsection to the relevant page.
7. **Update synthesis pages** if the user maintains any (e.g. `wiki/synthesis.md`, `wiki/me.md`, `wiki/thesis.md`). {{Specify how, per the preset.}}
8. **Update `wiki/index.md`** with the new source and any new entity/concept pages.
9. **Append to `wiki/log.md`:** `## [YYYY-MM-DD] ingest | {{Source Title}}` followed by 1–2 lines on what changed.

## Query workflow

When the user asks a question of the wiki:

1. **Read `wiki/index.md`** to find candidate pages.
2. **Read the candidate pages** in full (don't rely on snippets).
3. **Synthesize an answer** with inline citations to wiki pages (and through them, to sources).
4. **File the answer in `wiki/derived/` by default.** The default is to file, not to ask. Substantive answers — comparisons, analyses, connections, syntheses across multiple pages — are knowledge that belongs in the wiki, not in chat history. Update `wiki/index.md` under "Derived" and append a `query-filed` entry to `wiki/log.md`.

   Skip filing only for: simple lookups (the answer is already on an existing page), single-source restatements, casual back-and-forth, or when the user explicitly says "don't bother." Even when skipping, log a `query` entry recording what was asked and why it wasn't filed — this is what the lint workflow uses to catch misses.

## Lint workflow

When asked to lint the wiki:

1. **Contradictions** — pages or sections that disagree with each other.
2. **Stale claims** — older claims that newer sources have superseded but weren't updated.
3. **Orphan pages** — no inbound links.
4. **Missing pages** — concepts referenced multiple times but with no page of their own.
5. **Missing cross-references** — entities/concepts mentioned on a page but not linked.
6. **Gaps** — important sub-topics conspicuously absent given the wiki's purpose. Suggest sources or queries the user might pursue.
7. **Unfiled queries** — recent `query` entries in `wiki/log.md` with no matching `query-filed`. Reconstruct and file the substantive ones; skip the genuinely simple lookups. Find them with `grep "^## \[" wiki/log.md | grep -E "query \|" | tail -30`.
8. Report findings to the user and ask which to address. Do not silently apply fixes.

## Domain-specific notes

<!-- guidance: this section is where preset-specific quirks go. Pick the bullets that apply. Remove the section if nothing applies. -->

{{Examples — keep what fits, drop the rest:}}

- **Spoiler discipline:** Information from later chapters/sources never appears on entity pages until those chapters/sources have been ingested. Each entity page may carry an `_As of: {{watermark}}_` marker.
- **Privacy:** {{rules for real names, redaction, etc.}}
- **Tone:** {{neutral / personal / formal — relevant for personal wikis especially}}
- **Trust calibration:** {{e.g. "Treat peer-reviewed papers as higher-confidence than blog posts; record the confidence level on claims."}}

## What this wiki does NOT do

<!-- guidance: helpful to be explicit about non-goals. Example bullets: -->

- Pages are not invented from general knowledge. Every claim should trace to a source in `raw/` (or the user's stated input). If a gap is conspicuous, surface it; do not paper over it.
- The wiki is not a chat log. Casual back-and-forth lives in conversation; only filed answers, summaries, and entity/concept knowledge live in `wiki/`.
- The LLM does not modify `raw/`.

## Open questions and known gaps

<!-- guidance: optional. Useful to seed during init with anything the user mentioned but didn't decide. The lint workflow can also append here. -->

- {{question 1}}
- {{question 2}}

## Schema changelog

- **{{YYYY-MM-DD}}** — initial schema authored during wiki init.
<!-- append future entries when the schema is amended -->
```

---

## Filling out the template — quick reference

| Placeholder | Source |
|---|---|
| `{{Wiki Name}}` | Interview Q1 (purpose) — choose a short title with the user |
| `{{One-sentence description}}` | Interview Q1 |
| Page taxonomy bullets | Domain preset (research / book / personal / business / custom) |
| Naming conventions | Default to kebab-case unless user prefers otherwise |
| Cross-reference link syntax | Interview Q14 (Obsidian or plain) |
| Frontmatter section | Interview Q15 (yes/no) |
| Ingestion-ritual step 4 | Domain preset's "ingestion strategy" |
| Domain-specific notes | Interview Q11 (spoilers), Q12 (privacy), preset notes |
| Schema filename | `AGENTS.md` / `CLAUDE.md` / `wiki-schema.md` per env |
