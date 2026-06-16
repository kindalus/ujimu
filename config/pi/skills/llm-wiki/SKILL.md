---
name: llm-wiki
description: Build and maintain a persistent, interlinked markdown knowledge base (a "wiki") that the LLM writes and the user curates — the inverse of typical RAG, where knowledge accumulates and compounds across sources rather than being re-derived per query. Use this skill whenever the user wants to start a wiki, knowledge base, research notebook, book companion, journal-backed system, team wiki, help-desk / FAQ / customer-support KB, engineering wiki / runbook / ADR collection, due-diligence file, legislation/regulatory database, or any domain-specific knowledge repo built from sources over time. Also use it to ingest a new source (article, paper, transcript, chapter, law, amendment, post-mortem) into an existing wiki, query a wiki, run a lint, or when asked about Andrej Karpathy's "LLM Wiki" pattern. Trigger even without the word "wiki" — phrases like "organize my reading", "document our services", "track everything on X", or "summarize this and file it" all qualify.
---

# LLM Wiki

A skill for building and maintaining a persistent, LLM-authored markdown wiki that compounds knowledge across sources. Based on the pattern described by Andrej Karpathy: the user curates sources and asks questions; the LLM does all reading, summarizing, cross-referencing, filing, and bookkeeping.

## What makes this different from RAG

Most LLM-plus-documents setups (NotebookLM, ChatGPT file uploads, generic RAG) re-derive knowledge from raw sources on every query. Nothing accumulates. This skill works the opposite way: ingest a source once, integrate it into an evolving network of markdown pages, and the synthesis stays in place. Cross-references are pre-computed. Contradictions are pre-flagged. The wiki is a compounding artifact, not a query-time index.

This means **your role is fundamentally different** from a conversational assistant:
- You are the maintainer of a long-lived markdown repo, not a one-shot answerer.
- Almost every operation touches multiple files (a single ingest may update 10–15 pages).
- Persistence and cross-references matter more than rhetorical polish.
- You write the wiki; the user does not (or rarely does).

## The three layers

Every LLM-wiki has the same architecture:

1. **`raw/`** — source documents the user collected. Articles, papers, PDFs, transcripts, images, journal entries. **Read-only from your perspective.** Never modify these. They are the source of truth.
2. **`wiki/`** — markdown pages you author and maintain: summaries, entity pages, concept pages, comparisons, an index, a log. You own this layer entirely.
3. **The schema file** (e.g. `AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md` at the repo root) — domain-specific conventions for *this particular wiki*: what page types exist, how they're named, what cross-references look like, what happens on ingest. You and the user co-author this during initialization, and you read it at the start of every session.

The exact directory names (`raw/`, `wiki/`) are conventions — adapt to what already exists.

## Mode detection: do this first, every session

Before doing anything else, figure out which mode you're in by inspecting the working directory:

- **No schema file present** (no `AGENTS.md` / `CLAUDE.md` / `wiki-schema.md` describing a wiki, no `wiki/` directory) → **Initialization mode**. The user is starting fresh. Read `references/initialization.md` and run the domain interview before creating any files. **The skill must establish the domain before scaffolding the wiki — different domains demand different page taxonomies and different ingestion rituals, and a wiki bootstrapped without that context will accumulate sloppy structure that's painful to fix later.**
- **Schema file present, normal operation requested** (ingest, query, lint, browse) → **Operating mode**. Read the wiki's own schema file first — it overrides anything in this skill where they conflict, because it was tuned for this specific wiki. Then read `references/operations.md` for the relevant workflow.
- **Schema file present, but user wants to substantially restructure** (new domain, reorganization, schema rewrite) → Treat as a guided re-initialization. Read both `references/initialization.md` and the existing schema, and propose a migration plan rather than blowing away the existing wiki.

If you're unsure which mode you're in, ask the user — don't guess. Creating a wiki on top of an existing one, or re-running init when the user wanted ingest, is the kind of mistake that wastes a session.

## Initializing a new wiki

When you detect initialization mode, **read `references/initialization.md` in full before asking any questions or writing any files.** That file contains:

- The domain interview (questions to elicit purpose, scope, source types, page taxonomy, cross-reference patterns)
- Domain presets (research, book companion, personal journal, business knowledge, custom) with tailored ingestion strategies
- The bootstrap procedure (directories, schema file, seed index, seed log)
- The schema file template (in `references/wiki-schema-template.md`) — instantiate it with the answers from the interview

The output of initialization is: a directory tree, a populated schema file, an empty `wiki/index.md`, an empty `wiki/log.md`, and a clear next step for the user (typically: "drop your first source into `raw/` and tell me to ingest it").

**Do not skip the interview** even when the user gives a one-line description like "I want a wiki for my PhD research." The domain still has many degrees of freedom (what sub-area, which entity types matter, source mix, naming conventions) that determine whether the wiki will be useful or annoying six months in.

## Operating on an existing wiki

When you detect operating mode:

1. **Read the schema file first.** It defines the conventions you must follow: page types, naming, cross-reference style, ingestion ritual, log format. Treat it as authoritative. If it disagrees with this SKILL.md, it wins.
2. **Read `wiki/index.md`** to orient yourself in the existing knowledge.
3. **Read recent entries in `wiki/log.md`** (last ~10 entries) to understand what's been done lately and the user's current threads of inquiry.
4. **Then perform the requested operation** following `references/operations.md`.

The three core operations are:

- **Ingest** — process a new source from `raw/` into the wiki. Touches many pages. See `references/operations.md#ingest`.
- **Query** — answer a user question against the wiki. Substantive answers are filed back as pages by default — see the "Queries compound too" principle below. See `references/operations.md#query`.
- **Lint** — health-check the wiki for contradictions, stale claims, orphans, missing pages, gaps. See `references/operations.md#lint`.

Other operations (rename a page, merge pages, split a page, refactor a section) are valid and should follow the same discipline: update cross-references, append to the log, keep the index current.

## Core principles (apply to every operation)

These are the things that go wrong if you forget them. Internalize them.

**Cross-references are the value.** A summary page in isolation is not much better than the source. The wiki's worth comes from the dense network of links between pages. When you write or update a page, ask: what other pages should link *to* this, and what should this link *to*? Use the schema's link convention (typically `[[Page Name]]` for Obsidian-style or `[Page Name](page-name.md)` for plain markdown — check the schema).

**A single ingest touches many files.** This is normal and good. A new source might mention five entities (update their pages), introduce two new concepts (create new pages), confirm or contradict three existing claims (update those pages and flag contradictions), and warrant a new comparison or synthesis. Plus the summary page, the index update, and the log entry. Do all of this in one pass. Humans abandon wikis because this maintenance burden is unbearable for a person; it's trivial for you.

**Queries compound too.** Ingest is not the only way knowledge enters the wiki. When the user asks a substantive question and you produce a non-trivial answer — a comparison between two entities, an analysis across multiple sources, a connection neither of you had explicitly noticed before — that answer is *itself* knowledge worth keeping. **The default is to file it as a page in `wiki/derived/`** (or whatever location the schema specifies), not to leave it floating in chat history where it will be lost. Treat filing derived pages as a parallel discipline to ingestion: same rigor, same cross-references, same log entry. The point of the wiki is that the user's *thinking* accumulates alongside their reading; if every clever synthesis evaporates when the conversation ends, half the value is gone. The exceptions to filing — simple lookups, restatement of one source, casual back-and-forth — are real but narrower than they feel in the moment. When in doubt, file.

**Cite sources inside wiki pages.** Every claim that came from a source should be traceable back to that source. The convention is set by the schema, but typically: `[source-slug]` references after claims, with the source-slug pointing to the summary page in `wiki/sources/`.

**Flag, don't hide, contradictions.** If a new source contradicts an existing claim, do not silently overwrite. Add a "Disputes" or "Conflicting evidence" subsection to the relevant page that records both views and which source said what. The user often cares more about the disagreement than the consensus.

**Log everything.** Every ingest, every query that produced a filed answer, every lint pass — append a one-line entry to `wiki/log.md` with the date and a brief description. This is how the user (and you, in future sessions) reconstruct what happened.

**The user curates, you maintain.** Resist the urge to invent claims, fill gaps with web-search-generic content, or do things the user didn't ask for. The wiki should reflect what the user has actually read and asked about. If a gap is conspicuous, surface it ("I notice we have nothing on X — want me to look for sources?") rather than papering over it.

**Keep raw/ pristine.** Never modify, rename, or delete files in `raw/`. If the user wants to remove a source from the wiki, that's a wiki-layer operation: remove the summary page, prune cross-references, log the removal — leave `raw/` alone unless the user explicitly says otherwise.

**Prefer many small focused pages over a few sprawling ones.** Easier to link to, easier to update, better graph view. If a page exceeds ~500 lines or covers multiple distinct topics, propose splitting it.

## Tooling notes

- The wiki is just a directory of markdown files. Plain `cat`, `grep`, `find`, `ls` work fine for navigating it at small-to-moderate scale. At larger scale (many hundreds of pages), the user may want a search tool like [qmd](https://github.com/tobi/qmd) — note its existence if they ask, but don't push it.
- The user is often viewing the wiki in [Obsidian](https://obsidian.md). The schema file should record whether to use `[[wikilinks]]` (Obsidian) or standard `[markdown](links.md)`. If unsure, ask once at init time and record the answer in the schema.
- If the user has Obsidian Web Clipper, expect new sources to arrive as markdown files with frontmatter (URL, title, date) — the schema should treat that as a known source format.
- The wiki is well-suited to being a git repo. After init, suggest `git init` if it isn't one already.

## When you don't know something

If the user's request implies wiki conventions that aren't covered in either this SKILL.md or the wiki's schema file, **ask the user once and then record the answer in the schema** so the question doesn't recur. The schema is meant to grow as the wiki matures.

## Reference files

- `references/initialization.md` — Read at the start of any new-wiki session. Contains the full domain interview, the domain presets with their tailored ingestion strategies, and the bootstrap procedure.
- `references/wiki-schema-template.md` — The template you instantiate for the user's wiki during initialization. Has placeholders and inline guidance.
- `references/operations.md` — Read when performing ingest/query/lint on an existing wiki. Step-by-step workflows for each operation.
