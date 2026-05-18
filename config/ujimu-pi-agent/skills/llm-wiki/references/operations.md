# Operations

This file describes the three core operations performed on an existing wiki: **ingest** (new source → wiki), **query** (question → answer), and **lint** (health check). Read the relevant section before performing the operation.

**Before any operation:** read the wiki's schema file at the repo root (`AGENTS.md` / `CLAUDE.md` / `wiki-schema.md`). Where it disagrees with this file, the schema wins — it was tuned for this specific wiki.

---

## Ingest

A new source has arrived in `raw/`. Your job is to integrate it into the wiki such that the wiki is richer afterward, all relevant pages reflect what the source said, and the change is traceable.

### Default ingestion workflow

1. **Locate the source.** The user typically mentions a filename or path. If they don't, list `raw/` and ask. Don't guess.

2. **Read the source completely.** Do not skim. If it's long, read it in chunks but read it all. If it contains images and they're available locally (e.g. `raw/assets/`), view them — many sources put crucial context in figures.

3. **Discuss the source with the user before writing anything.** State 3–5 key takeaways. Ask: "Anything to emphasize, anything you disagree with, anything I missed?" Their answer often shifts what gets recorded. Skip this step only if the user has explicitly opted into batch mode.

4. **Identify what the source touches.** Make a mental list:
   - What new entities does it introduce?
   - What existing entities does it add to?
   - What concepts/methods/themes does it discuss?
   - What claims does it make? Which agree with existing wiki content? Which contradict?
   - Does it warrant a new synthesis or comparison page, or update an existing one?

5. **Read the existing pages you'll touch.** Do not write updates blind. For every entity / concept / synthesis page you intend to modify, read it first. This prevents accidental erasure of nuance, double-recording of the same claim, and inconsistency in voice.

6. **Write the source page** in `wiki/sources/` (or whatever the schema specifies). Follow the schema's slug convention. Include the sections the schema requires — typically: summary, key claims, methodology / structure, how it relates to the existing wiki, open questions it raises.

7. **Update entity / concept pages.** For each one:
   - Add new information, attributing it to the source.
   - Add a cross-link to the new source page.
   - If the new info contradicts existing content, do not overwrite — add a "Conflicting evidence" or "Disputes" subsection that records both views.
   - Apply any domain-specific discipline from the schema (e.g. spoiler discipline for book wikis: only add what is on-screen in this chapter; do not let later knowledge leak in).

8. **Update synthesis pages** if the source shifts the overall picture. Be conservative: a single source rarely changes the thesis. But if it does, update the synthesis and log the shift clearly.

9. **Update `wiki/index.md`.** Add the new source under "Sources." Add any new entity/concept pages under their categories. Re-sort if the convention is alphabetical.

10. **Append to `wiki/log.md`** in the format the schema specifies. Default:
    ```
    ## [YYYY-MM-DD] ingest | {{Source Title}}

    Summary: 1–2 lines on what the source argued.
    Touched: list of pages updated or created.
    ```

11. **Tell the user what changed.** Briefly: "I created sources/{slug}.md and a new concept page concepts/foo.md, and updated bar.md, baz.md, and the index." This lets the user spot anything wrong before it ossifies.

### Variations and judgment calls

- **Sources with multiple distinct topics:** Consider writing more than one source page only if the source is genuinely two unrelated things bound together (rare). Usually keep one source page per source file and let the cross-references handle distribution.
- **Very short sources** (a tweet, a single quote): Often don't warrant a full source page. Either fold into the relevant entity page directly with a citation, or create a minimal stub. Ask the user.
- **Sources you partially disagree with:** Record what the source says faithfully — don't editorialize. The wiki is a record of what the user has read; your judgments belong in synthesis pages or in conversation, not in source summaries.
- **Sources the user hasn't read:** If the user drops a source and asks for ingestion without reading it themselves, that's fine — many users want the wiki to *be* their reading. But state this in the log entry (e.g. `## [date] ingest | Article (user has not read)`) so they can revisit.
- **Re-ingestion** (same source ingested twice): Don't double-create the source page. If the user asks to re-ingest, treat it as an opportunity to enrich the existing source page with anything that was missed.

### What "many pages" actually looks like

For a research paper introducing a new method that builds on prior work, a typical ingest might touch:
- `wiki/sources/2024-author-keyword.md` (new)
- `wiki/methods/the-new-method.md` (new)
- `wiki/methods/the-prior-method.md` (existing — note the descendant)
- `wiki/people/first-author.md` (new or existing)
- `wiki/concepts/relevant-concept.md` (existing — add the paper as evidence)
- `wiki/debates/long-running-question.md` (existing — paper takes a side)
- `wiki/synthesis.md` (existing — possibly minor update)
- `wiki/index.md`
- `wiki/log.md`

Nine files for one paper. This is normal. It is exactly the work that makes the wiki valuable, and it's the work humans don't sustain.

---

## Query

The user asks a question. Your job is to answer from the wiki, with citations, and to recognize when the answer is itself worth filing.

### Workflow

1. **Read `wiki/index.md`.** Identify candidate pages. The index is your search engine at small-to-moderate scale.

2. **Drill into candidate pages.** Read them in full — don't rely on title-and-summary alone. The index is for discovery; the pages are for content.

3. **Follow cross-references.** A query about an entity often surfaces the most relevant content not on the entity page but on related concept or synthesis pages.

4. **Synthesize an answer.** With inline citations to wiki pages: `(see [[Concept X]])` or `[Concept X](concepts/concept-x.md)` per the schema's link convention. Through wiki pages, claims trace back to sources in `raw/`.

5. **Be candid about what's missing.** If the wiki doesn't cover the question well, say so explicitly. Do not pad the answer with general knowledge — the user can get that from any chatbot. The wiki's answer should be specifically what *this* wiki knows.

6. **File the answer by default.** This is the discipline Karpathy's pattern is most emphatic about: a comparison you produced, an analysis across sources, a connection neither of you had made explicit before — these are themselves knowledge, and if they only exist in chat history they evaporate. The default is to write the answer to `wiki/derived/` (or whatever the schema specifies), update `wiki/index.md`, and log it. **Do not ask permission for routine filing.** Just do it, then tell the user where it landed in one line.

   The cases where you should *not* file are narrower than they feel:
   - **Simple lookups** — "What's the publication year of paper X?" "Which chapter does character Y first appear in?" These need no synthesis; the existing wiki page already has them. Don't file.
   - **Single-source restatement** — the answer is essentially "go read the summary page for source X." Don't file; just point to it.
   - **Casual back-and-forth** — clarifying questions, "what would you call this," "is the wiki working for me." Don't file.
   - **The user explicitly says "don't bother filing this."** — Always honor.

   Borderline cases (the answer is somewhat substantive but you're unsure whether the user will revisit it): file it anyway. It's cheap to delete a derived page later if it's redundant; it's expensive to reconstruct a synthesis that was lost.

   When filing, the log entry uses a distinct prefix so lint can find unfiled queries (see Lint section):
   ```
   ## [YYYY-MM-DD] query-filed | {{Topic}}

   User asked: {{question}}. Filed at: {{path}}. Synthesizes: {{list of source/wiki pages}}.
   ```

   For queries you decide *not* to file, still leave a log entry — it's how lint detects misses:
   ```
   ## [YYYY-MM-DD] query | {{Topic}}

   User asked: {{question}}. Not filed: {{reason — "simple lookup" / "single-source restatement" / "casual" / "user declined"}}.
   ```

### Output formats

Most queries deserve a plain-text answer in conversation. Some deserve more:

- **Comparison tables** — if the user asked for one explicitly, or the natural shape of the answer is a 2D comparison. File as a markdown page with a table.
- **Slide decks (Marp)** — if the schema mentions Marp, or the user asks. The user can preview in Obsidian if they have the Marp plugin.
- **Charts** — if the data warrants it and a tool is available. Save the chart and reference it from a wiki page.

Don't reach for fancy formats reflexively. Most questions want a sentence or two and links.

### When the wiki doesn't have the answer

Be direct. Say "the wiki doesn't currently cover X." Then offer one of:
- Suggest a search for sources to add.
- Offer a tentative answer from general knowledge with the explicit caveat that it's not in the wiki.
- Ask the user to bring a source.

Do not invent wiki content to cover the gap.

---

## Lint

A health check of the wiki. Run when the user asks ("lint the wiki", "check for issues", "what should I clean up?") — typically every few weeks or when the wiki crosses a size threshold.

### What to check

1. **Contradictions across pages.** Page A says X, page B says not-X. Surface the pair.

2. **Stale claims.** A claim attributed to an old source that has been contradicted by a newer source the wiki already contains, but the older page wasn't updated. Common after several rapid ingests.

3. **Orphan pages.** Pages with no inbound links. Sometimes appropriate (a top-level synthesis page) but often a sign that a page was created but never integrated.

4. **Missing pages.** Concepts, entities, or themes mentioned across multiple pages that don't have their own page. These are usually the wiki's biggest gaps — the cross-cutting topics.

5. **Missing cross-references.** A page mentions an entity by name but doesn't link to the entity's page. Easy to fix in bulk.

6. **Gaps relative to the wiki's purpose.** Re-read the schema's purpose statement. Are there obvious sub-topics absent? Suggest sources to look for or questions the user might pursue.

7. **Schema drift.** Pages that violate the schema's conventions (wrong filename format, missing required frontmatter, wrong directory). Worth noting but not always worth fixing — sometimes the convention is wrong, not the page.

8. **Overgrown pages.** Pages over ~500 lines or covering multiple topics. Propose splits.

9. **Unfiled queries.** Recent `query` entries in `wiki/log.md` with no corresponding `query-filed` entry. The fact that a query was logged as "not filed" doesn't mean it was the right call — at lint time it's worth re-examining whether the synthesis would actually be valuable to keep, especially for the borderline ones. This is the catch-net for the "queries compound too" principle when in-the-moment filing judgment misses.

   Cheap programmatic check:
   ```bash
   # last 30 query entries that were not filed
   grep "^## \[" wiki/log.md | grep -E "query \|" | tail -30
   ```
   For each one surfaced, decide: was it actually a simple lookup (skip), or should it be reconstructed and filed now (propose to user)? Reconstruction is fine — re-derive the answer from the wiki and file it; the user doesn't need to re-ask.

### Workflow

1. **Read the schema** to know what the conventions are.
2. **Read `wiki/index.md`** for the catalog.
3. **Sample pages.** For larger wikis, you can't read everything — sample by category, paying special attention to recently-touched pages and to hub pages (those with many links).
4. **Run programmatic checks where cheap:** orphan detection (grep all pages for `[[Page X]]` references and compare to existing files), missing-cross-reference detection (grep for entity names in non-entity pages), filename convention checks, the unfiled-queries grep above.
5. **Compile the lint report** as a structured list with severity levels:
   - **Blocking** — actual contradictions or factual errors
   - **Warning** — orphans, stale claims, missing pages, unfiled queries that look substantive
   - **Suggestion** — gaps, schema drift, overgrowth
6. **Present to the user. Do not silently apply fixes.** The user picks which to address. Some apparent issues are intentional.
7. **Apply approved fixes.**
8. **Log the lint pass:**
   ```
   ## [YYYY-MM-DD] lint | {{summary}}

   Found N issues. Fixed: {{list}}. Deferred: {{list}}.
   ```

### A note on "completeness"

A wiki is never finished. The lint report is a status snapshot, not a list of bugs to drive to zero. Some gaps will persist for years because the user hasn't read the relevant sources. That's fine. The point of the lint is to surface what's *latently* broken (contradictions, stale claims) and what's *opportunistically* improvable (missing cross-refs, splits) — not to harangue the user about reading more.

---

## Other operations

These come up less often but should follow the same discipline (update cross-references, update index, log it):

- **Rename a page.** Update every inbound link. Update the index. Log it.
- **Merge two pages.** Pick a canonical path, redirect links, archive or delete the other. Log it.
- **Split a page.** Create the new page(s), distribute content, redirect links, update index. Log it.
- **Refactor a section.** When adding a new dimension to existing pages (e.g. "started tracking confidence levels on claims"), do it consistently across all relevant pages in one pass. Update the schema if the convention changed. Log it.
- **Schema amendment.** When the schema itself changes, update the schema file, append to its changelog, and log the change in `wiki/log.md`.

The general rule: if it would surprise the user to discover the change happened, log it. If it changes how future operations work, also update the schema.
