# Initialization

Read this file in full before scaffolding a new wiki. The whole point of doing a careful initialization is that **the wiki's structure is determined by its domain**, and getting the structure right at the start is much cheaper than reorganizing it later. A wiki for tracking a PhD thesis has different page types, different ingestion rituals, and different cross-reference patterns than a wiki for a fantasy novel re-read or a personal journal.

The order of work is:

1. Run the **domain interview** with the user.
2. Pick (or build) a **domain preset** based on their answers.
3. **Confirm the design** with the user before writing files.
4. **Bootstrap** the directory structure, schema file, index, and log.
5. Tell the user how to add their first source.

Do not skip step 3. The schema file is the most important artifact you will produce in this session; the user should sign off on it before it's written.

---

## Step 1: The domain interview

Ask these questions conversationally — don't dump them all at once. Adapt order and follow-up based on the user's answers. Skip questions whose answers are already obvious from earlier conversation.

### A. Purpose and scope

1. **What is this wiki for?** (One or two sentences. What will the user be able to do with it that they can't do today?)
2. **What's the time horizon?** Days, weeks, months, indefinite? (Affects how much structure to invest in upfront.)
3. **Who is the audience?** Just the user, a team, the public? (Affects tone, citation style, privacy considerations.)

### B. Source landscape

4. **What kinds of sources will go into `raw/`?** (Web articles, academic papers, PDFs, podcast transcripts, book chapters, journal entries, meeting notes, screenshots, your own writing, etc.)
5. **Roughly how many sources do you expect?** (Tens? Hundreds? Thousands?)
6. **Will sources arrive one at a time as you read them, or in batches?** (Affects ingest workflow.)
7. **Are images important?** (If yes, plan for `raw/assets/` and reference images from wiki pages.)

### C. The shape of the knowledge

8. **What kinds of "things" will the wiki track?** Push the user to enumerate. Examples by domain:
   - Research: papers, people, concepts, methods, datasets, debates, claims
   - Book: characters, places, factions, events, themes, chapters, languages, items
   - Personal: themes, people, projects, goals, beliefs, habits
   - Business: products, customers, competitors, decisions, meetings, projects
9. **Which of those are most important?** (The wiki's "primary keys" — the entities you'll most often want pages for.)
10. **Are there relationships between those things you want to be able to follow?** (e.g. paper → cites → paper, character → appears-in → chapter, project → blocked-by → project.) These become the cross-reference patterns.

### D. Sensitive areas

11. **Spoilers, surprises, or temporally-sensitive knowledge.** Especially relevant for books, ongoing research with unpublished work, journals with private content, or anything where information becomes "true" only at a certain point. If yes, note in the schema and apply when ingesting.
12. **Privacy concerns.** Will this be in a public git repo, a private repo, or local-only? (Affects whether to include real names, URLs, etc.)

### E. Working style

13. **Will you ingest sources one at a time with you reviewing, or batch with less supervision?** (Karpathy's preference: one at a time, stay involved. But the user picks.)
14. **Are you using Obsidian, plain markdown, or something else?** (Determines link syntax: `[[wikilinks]]` vs `[text](path.md)`.)
15. **Are you OK with frontmatter on pages?** (YAML frontmatter enables Obsidian Dataview queries but adds visual noise. Default: yes for source pages, optional for everything else.)

You don't need every answer to every question. The goal is enough understanding to choose a preset and tailor it. If the user is uncertain, propose defaults from the closest preset and let them adjust.

---

## Step 2: Domain presets

Use these as starting points. Each one specifies a page taxonomy, a cross-reference convention, and an ingestion strategy. Pick the closest fit, then customize based on the interview answers. If nothing fits, build a custom preset using the "Custom domain" template at the bottom.

### Preset: Research project

**Use when:** The user is going deep on a topic over weeks/months, building toward an evolving thesis. Reading papers, articles, reports.

**Page taxonomy:**
- `wiki/sources/` — one page per source, with summary, key claims, methodology, contribution
- `wiki/concepts/` — one page per important concept (terms, ideas, frameworks)
- `wiki/people/` — researchers/authors with notable contributions
- `wiki/orgs/` — labs, companies, institutions
- `wiki/methods/` — techniques, models, datasets
- `wiki/debates/` — open questions where sources disagree
- `wiki/derived/` — comparisons, analyses, and connections produced from queries (filed by default — see "Queries compound too")
- `wiki/thesis.md` — the user's evolving thesis as a single master page, updated continuously
- `wiki/index.md` — catalog
- `wiki/log.md` — chronological

**Cross-reference convention:** Source pages link to every concept/person/method/org they mention. Concept pages link back to all sources that discuss them. The thesis page links to everything. Derived pages cite both the wiki pages and (through them) the underlying sources they synthesize.

**Ingestion strategy:** Per source. Workflow: read source → discuss key claims with user → write source page (summary + claims + how it relates to thesis) → update or create concept/person/method pages it references → update `thesis.md` if it shifts the thesis → flag contradictions on debate pages → update index → log.

**Watch for:** Citation hygiene. Every claim in `thesis.md` and in any derived page should trace to a source. Maintain a "claims and counter-claims" structure on debate pages.

### Preset: Book companion

**Use when:** The user is reading (or re-reading) a book and wants a fan-wiki-style companion built as they go. Think Tolkien Gateway, Coppermind, etc.

**Page taxonomy:**
- `wiki/characters/` — one page per character
- `wiki/places/` — locations, settings
- `wiki/events/` — significant happenings
- `wiki/themes/` — thematic threads
- `wiki/chapters/` — per-chapter summaries (ingestion unit)
- `wiki/derived/` — comparisons, character-arc analyses, theme deep-dives, and connections produced from queries (filed by default — see "Queries compound too")
- `wiki/factions/` (optional) — groups, houses, organizations
- `wiki/items/` (optional) — significant objects
- `wiki/glossary/` (optional) — invented terms, languages

**Cross-reference convention:** Heavy. Every character mention in a chapter summary links to the character page. Character pages list all chapters they appear in. Themes link to chapters where they surface.

**Ingestion strategy:** Per chapter. Workflow: read chapter → discuss with user → write chapter summary → update character pages with new info / new appearances → update place / event / theme pages → flag any retcons or surprises → update index → log.

**Spoiler discipline:** If the user is reading for the first time, **never include information from later chapters** on entity pages. Each page reflects only what is known up to the most recently ingested chapter. Note the chapter watermark on each page (e.g. `_As of: Chapter 14_`). If re-reading, ask whether to allow forward-looking notes.

**Watch for:** Tracking when information is *revealed* vs when it is *true* (these differ in mystery plots). Allow each character page to record both.

### Preset: Personal / journal-backed

**Use when:** The user is filing journal entries, articles they've read, podcasts they've heard, and wants the wiki to reflect their evolving self-understanding — goals, beliefs, projects, relationships, health, psychology.

**Page taxonomy:**
- `wiki/sources/` — one page per article/podcast/book/journal entry
- `wiki/themes/` — recurring concerns (anxiety, ambition, loneliness, productivity, etc.)
- `wiki/people/` — people in the user's life (with privacy in mind — confirm)
- `wiki/projects/` — ongoing personal projects
- `wiki/goals/` — declared goals with status
- `wiki/beliefs/` — operating beliefs the user has expressed (and how they've evolved)
- `wiki/derived/` — patterns, retrospectives, cross-cutting analyses, and connections produced from queries (filed by default — see "Queries compound too"). Especially valuable here, since self-understanding accrues largely *through* reflective questions, not just through reading.
- `wiki/log.md` — chronological
- `wiki/index.md` — catalog
- `wiki/me.md` — synthesis page about the user's current state of self

**Cross-reference convention:** Themes are the connective tissue. Most pages link to one or more themes. Belief pages track *changes over time* — new entries don't overwrite old beliefs, they timestamp them.

**Ingestion strategy:** Per entry/source. Workflow: read entry → discuss what it suggests → file source page (or journal-entry page) → update relevant themes → update beliefs (with timestamps if they shift) → update goals if mentioned → update `me.md` if a non-trivial pattern emerged → log.

**Watch for:** Privacy. Confirm whether real names are OK. If the wiki may be sync'd to cloud or git, prefer initials or pseudonyms unless the user opts in. Also: do **not** invent psychological insights; surface what the user said, not what you'd say about it.

### Preset: Business / team knowledge

**Use when:** The user wants an internal wiki fed by Slack threads, meeting transcripts, project docs, customer calls, decision memos.

**Page taxonomy:**
- `wiki/sources/` — meeting/Slack/doc records (one per source)
- `wiki/projects/` — active and past projects
- `wiki/customers/` (optional) — customer accounts
- `wiki/people/` — team members and external contacts
- `wiki/decisions/` — decision records (date, options considered, decision, rationale)
- `wiki/derived/` — cross-project analyses, retrospectives, customer-segment summaries, and connections produced from queries (filed by default — see "Queries compound too")
- `wiki/products/` (optional) — product areas
- `wiki/glossary/` — internal jargon
- `wiki/index.md`, `wiki/log.md`

**Cross-reference convention:** Decisions link to the meetings/sources where they were made. Projects link to the decisions, people, and customers involved. People pages list their projects.

**Ingestion strategy:** Per source (transcript / thread / doc). Workflow: read → extract decisions, action items, project updates → file source page → update project pages → create / update decision records → update people pages → log.

**Watch for:** Don't invent action items or decisions that weren't in the source. Distinguish "decision made" from "discussed but undecided." Confidentiality: confirm what's OK to record.

### Preset: Help-desk / FAQ / customer support

**Use when:** The user is building a customer-facing or employee-facing knowledge base of help articles, FAQs, troubleshooting guides, or policy documents. Articles answer questions or explain procedures; the audience is *end users*, not the curator. Common examples: SaaS product help center, internal HR/IT/operations FAQ, customer service knowledge base, public documentation portal.

**This preset stretches the skill's default model.** The other presets assume sources go in `raw/` and pages are synthesized from them. Help articles are mostly *authored* — drafted from product knowledge, support ticket patterns, and Slack threads — rather than summarized. The "sources" relationship is inverted: tickets and discussions are *evidence supporting* an article, not material the article condenses. Adjust expectations accordingly.

**Page taxonomy:**
- `wiki/articles/` — one page per help article. The article *is* the unit; this is where most content lives.
- `wiki/categories/` — category pages that group articles. Categories are the navigation backbone.
- `wiki/policies/` — formal policy documents (refund policy, ToS, code of conduct). Versioned more carefully than ordinary articles.
- `wiki/glossary/` — terms readers may need to understand to follow articles.
- `wiki/sources/` — supporting evidence: ticket patterns, product specs, internal discussions. *Optional and invisible to readers.*
- `wiki/derived/` — analyses produced from queries: most-asked topics, gaps in coverage, content audits.
- `wiki/index.md`, `wiki/log.md`

**Cross-reference convention:** Articles link to (a) other articles via "Related articles," (b) categories they belong to, (c) policies they reference, (d) glossary terms. Every article must belong to at least one category. Cross-references are lighter than in research wikis — each article should be readable on its own without forcing the reader to chase links.

**Article lifecycle (decide at init time, bake into schema):**

Help articles have a lifecycle the other domains don't have. Every article carries a state: `draft` / `under-review` / `published` / `needs-refresh` / `deprecated`. Pick:

1. **Lifecycle in frontmatter** — each article has `status`, `last_reviewed`, `next_review_due`, `owner`, optionally `audience`. Lint surfaces stale articles. **Default recommendation.**
2. **Lifecycle by subdirectory** — `articles/draft/`, `articles/published/`, `articles/deprecated/`. Visible in the file tree; harder to query.
3. **No formal lifecycle** — only appropriate for very small KBs.

**Authoring strategy — three sub-flows:**

*Author from a need* (most common): user identifies a question that recurs (in tickets, Slack, conversations) → discuss scope and audience → draft the article → link to relevant categories, policies, and glossary terms → optionally record originating evidence in `wiki/sources/` → update index → log.

*Update from a product or policy change*: user reports a change → identify all affected articles → update each, bump `last_reviewed`, possibly create or update a policy page → log.

*Refresh pass*: when articles hit `next_review_due`, walk through them with the user → confirm still accurate, edit, or deprecate → log.

**Watch for:**

- *Voice and tone matter.* The reader is not the curator. Use "you," not "the user." Active voice. Skim-friendly headings. Lean explicitly toward end-user readable rather than the skill's default analytical voice.
- *Don't invent product behavior.* Verify with the user before writing definitive statements about how something works. A confidently-wrong help article is worse than no article.
- *Categories should be discoverable, not exhaustive.* 5–10 top-level categories is usually right.
- *Lifecycle hygiene.* Articles unreviewed for 12+ months are usually wrong. Lint should surface them aggressively.
- *Search-friendliness.* Article titles should be the question or task ("How do I reset my password?", "Configure SSO with Okta"), not internal jargon.

### Preset: Engineering / internal technical documentation

**Use when:** The user is building or maintaining technical documentation for a software system or team — service/component reference, runbooks, architecture decision records (ADRs), API docs, onboarding guides, post-mortems, design docs. Audience is engineers (typically internal team members or new hires).

**This preset is a hybrid of authored reference and source-driven updates.** Component pages, ADRs, and runbooks are mostly *authored*. Post-mortems and design reviews function as *sources* that trigger updates to runbooks and component pages. Both flows coexist and the schema should make that explicit.

**Page taxonomy:**
- `wiki/components/` — one page per service, component, or subsystem. Stable reference: purpose, interfaces, ownership, deploy procedure, monitoring, gotchas.
- `wiki/runbooks/` — incident response procedures and operational playbooks. Highest-stakes pages — wrong runbooks during an incident cascade fast.
- `wiki/adrs/` — architecture decision records, numbered sequentially, append-only. Each: context, decision, alternatives considered, status, consequences.
- `wiki/post-mortems/` — incident retrospectives. Often trigger updates to runbooks and components.
- `wiki/design-docs/` — proposals for new work. Lifecycle: draft → reviewed → accepted/rejected. Accepted designs often spawn ADRs.
- `wiki/onboarding/` (optional) — guides for new team members.
- `wiki/glossary/` — internal terms, acronyms, project codenames.
- `wiki/derived/` — cross-component analyses, FAQs that emerge, comparisons.
- `wiki/index.md`, `wiki/log.md`

**Cross-reference convention:** Components link to their ADRs (decisions that shaped them), their runbooks (operational procedures), their post-mortems (incidents involving them). Runbooks back-link to the components they cover. ADRs reference affected components and runbooks. Post-mortems link to the runbook(s) followed (or that should have existed) and trigger updates.

**ADR discipline (specific to this preset, overrides default contradiction rule):**

ADRs are a load-bearing pattern in engineering wikis with unusual rules:

- **Numbered sequentially**: `adrs/adr-001-postgres-over-mysql.md`, `adr-002-...`
- **Append-only**: once published, an ADR is not edited. If the decision changes, write a new ADR that supersedes the old one. The old one stays, marked `superseded by ADR-N`.
- Status field: `proposed` / `accepted` / `superseded` / `deprecated`.
- This is the second context (after legislation) where the default "flag contradictions" rule is replaced by a supersession rule — superseded ADRs are not in dispute, they are succeeded. Note this in the schema's "Domain-specific notes."

**Ingestion / authoring strategy — four sub-flows:**

*Author a component page*: user identifies a component lacking docs → discuss scope and audience → draft covering purpose, interfaces, ownership, deploy, monitoring, common issues → link to relevant ADRs, runbooks, post-mortems → log.

*Author a runbook*: triggered by recurring operational issue or post-mortem action item → discuss the procedure step by step → draft with clear preconditions, steps, verification, rollback → link to component(s) involved → **walk through it with the user before considering it published.** A wrong runbook is worse than a missing one.

*Record an ADR*: significant decision was made → discuss context, alternatives, decision, consequences → write the ADR with the next sequential number → set status → if it supersedes a prior ADR, update the prior ADR's status → link from affected components → log.

*Ingest a post-mortem* (this is the only flow that resembles the default ingestion model): incident has occurred → read the timeline → write the post-mortem page (timeline, root cause, action items) → identify which runbooks and component pages need updates → propose those updates and apply after user confirmation → log both the post-mortem and the downstream updates.

**Watch for:**

- *Currency is critical.* Stale runbooks during an incident are dangerous. Lint should aggressively flag runbooks unreviewed in 6+ months. Component pages contradicting reality should be updated immediately, not discussed.
- *Ownership.* Every component page and runbook records an owner. Ownerless pages decay fastest.
- *ADRs are not editable.* Resist "fixing" old ADRs as context evolves. Write a new one that supersedes.
- *Code links rot.* Linking to specific lines (`src/foo.py:42`) ages badly. Link to files or symbols, or to commit-pinned permalinks when specificity matters.
- *Don't invent system behavior.* Only describe what's actually true. Verify with the user. The cost of a confidently-wrong runbook is high.
- *Onboarding pages drift fast.* They reflect what the system was when the page was last touched. Schedule explicit refresh.

### Preset: Legislation / regulatory

**Use when:** The user wants to consult, navigate, or maintain a knowledge base for a body of law — statutes, codes, regulations, decrees, sectoral rules — possibly with implementing regulations and (optionally) jurisprudence. Typical use is a consultation wiki: look up the current state of a provision, follow its cross-references, trace its amendment history. Relevant for compliance work, legal research, regulatory analysis, due diligence on a regulatory area.

**Page taxonomy:**
- `wiki/laws/` — one page per law/statute/code/decree, with metadata: enactment date, jurisdiction, issuing authority, current status (in force / amended / repealed), and a list of articles
- `wiki/articles/` — one page per article or provision (the operative unit). Holds operative text, amendment history, cross-references to other articles, and links to jurisprudence interpreting it (if used)
- `wiki/definitions/` — defined terms whose scope is internal to a specific law (the "Definitions" section of a statute). Distinguished from concepts because the same term may be defined differently in different laws
- `wiki/concepts/` — free-standing legal concepts that span multiple laws (good faith, force majeure, due process, proportionality)
- `wiki/topics/` — synthesis pages for regulatory areas. **This is where "groups of concepts" live** — a topic page draws together the laws, articles, definitions, and concepts relevant to one subject (e.g. "data protection," "labor termination," "environmental impact assessment"). These are typically the most consulted pages.
- `wiki/amendments/` — one page per amending instrument (the decree or law that modified existing provisions). Records what it changed, when, and the effective date.
- `wiki/jurisprudence/` (optional) — notable court rulings interpreting provisions
- `wiki/derived/` — analyses, jurisdictional comparisons, "current state" summaries on demand
- `wiki/index.md`, `wiki/log.md`

**Cross-reference convention:** Dense. Article pages back-link to their parent law, forward-link to every defined term they use and every other article they cross-reference, and inbound-link from jurisprudence and topic pages. Topic pages are the synthesis hubs and link to all relevant laws, articles, and concepts. Definitions link to every article in the same law that uses them. The graph density *is* the wiki's value — a sparsely-linked legislation wiki cannot answer the consultation queries that motivate it.

**Versioning pattern (decide at init time, bake into schema):**

This is a domain-specific decision the standard interview doesn't cover. Ask the user explicitly:

1. **In-page versioning** — each article page has an "Operative text (current)" section and a "History" section below it where each amendment is recorded with effective dates. One file per article, growing over time. Best for consultation use cases where the user mostly wants the current state. **Default recommendation.**
2. **Separate versioned pages** — `articles/article-5.md` holds the current version, `articles/historical/article-5-v2018.md` holds a prior version. Best for point-in-time analysis ("what was the rule on March 14, 2020?"). More files, more cross-reference overhead.
3. **Git-based versioning** — one page per article, history lives in git. Lowest structural overhead but the wiki itself can't answer point-in-time queries.

Record the choice in the schema's "Domain-specific notes." The amendment ingestion ritual differs significantly between (1)/(2) and (3).

**Ingestion strategy — two sub-flows:**

*Initial law ingest* (a freshly enacted law, or an existing law being added to the wiki for the first time): read the law → discuss scope with user → create the law page with metadata → create one article page per article (with its operative text) → create definition pages for each defined term in the law's definitions section → identify cross-referenced articles within and outside the law and link them → flag concepts the user may want stand-alone pages for → update relevant topic pages → update index → log.

*Amendment ingest* (an amending instrument modifying existing provisions): read the amending instrument → identify which articles of which laws are affected → for each affected article, **apply the chosen versioning pattern**:
- Pattern 1: append a "History" entry with the prior text and effective dates; replace operative text with the new version; cite the amending instrument.
- Pattern 2: copy the current page to `historical/` with a versioned filename; rewrite the canonical page with the new text.
- Pattern 3: rewrite the canonical page; let git record the change.

Then update the law's metadata (last amended date), check whether the amendment renumbered articles (if so, find every page that referenced the old numbering and update the references — exactly the bookkeeping the wiki is built for), create or update the amendment instrument's own page, update affected topic pages if the regulatory landscape shifted, update index, log.

**Supersession discipline (overrides the default contradiction rule):**

For most domains, the skill's rule is "flag, don't hide, contradictions" — when a new source disagrees with existing content, both views are recorded and the disagreement is surfaced. **For legislation this is wrong.** When an amendment changes Article 5, the old text is not *in dispute* with the new text — it is *superseded by* it, with a clear effective date. The schema's "Domain-specific notes" should record that supersession replaces the contradiction rule for this wiki: superseded provisions move to History (or historical pages) and the operative text is replaced. The "history" is structured chronological succession, not unresolved disagreement. (Genuine contradictions still exist — between two laws of equal authority that conflict, or between a law and its implementing regulation — and those should still be flagged on a topic or debate page.)

**Watch for:**

- *Effective vs enactment dates.* These often differ, sometimes by years. Record both on the amendment page; the article's history entry uses the effective date, since that's when the rule actually changed.
- *Repeals are not deletions.* When a provision is repealed entirely, mark the page "repealed effective X" — do not remove it. The old rule may still apply to facts that arose before the repeal.
- *Transitional provisions.* The rules a law sets for handling the transition itself. They are themselves articles, deserve their own pages, and tend to be heavily cross-referenced for years after the underlying change.
- *Jurisdictional and authority hierarchy.* Constitutional vs statutory vs regulatory; federal vs regional; general vs sectoral. Record on each law's page as metadata; conflict-of-laws questions are common and the wiki can answer them if the metadata is there.
- *Defined terms have local scope.* A term defined in Law A may be defined differently (or not at all) in Law B. Don't conflate them into a single concept page; keep them as separate definition pages, and reserve concept pages for cross-cutting ideas that aren't formally defined anywhere.
- *Start narrow.* Legislation wikis fail when users try to ingest an entire code at once and end up with thousands of stub pages with sparse cross-references. Process one law (or one regulatory area) thoughtfully, get the linking density right, then expand.

### Custom domain

If none of the seven presets above fits, build a custom preset by answering these in the schema:

- What's the **ingestion unit**? (A source, a chapter, an entry, a transcript, a screenshot?)
- What are the **3–6 page types** that matter most for this domain?
- What is the **synthesis page** (if any) — the master page the wiki evolves toward?
- What is the **link convention** — what does it mean when page A links to page B in this domain?
- What is the **spoiler / privacy / confidentiality** discipline?

Walk the user through each. Write the answers into the schema.

**Always include `wiki/derived/`** in the page taxonomy regardless of domain. It is the destination for filed answers — comparisons, analyses, connections produced from queries. Karpathy's pattern treats this as parallel to ingestion: queries compound knowledge into the wiki the same way sources do, and they need a home. The only reason to omit `derived/` is if the user explicitly says they don't want filed answers, which is unusual.

---

## Step 3: Confirm the design before writing files

Show the user a draft of:
- The directory structure you'll create
- The chosen preset (with any customizations from the interview)
- The link syntax (Obsidian wikilinks or plain markdown)
- The ingestion ritual (the steps you'll take when they ask you to ingest a source)

Ask: "Does this look right? Want me to adjust anything before I scaffold it?"

Iterate until they say yes.

---

## Step 4: Bootstrap

Once the design is confirmed, create the directory tree and seed files. Use the existing working directory as the wiki root unless the user asks otherwise.

```
.
├── raw/                         # user drops sources here
│   └── (assets/ if images expected)
├── wiki/
│   ├── index.md                 # catalog
│   ├── log.md                   # chronological
│   └── (subdirectories per the preset's page taxonomy)
└── (schema file at root)
```

**Schema file naming:**
- If the user is using Claude Code, name it `CLAUDE.md`.
- If using Codex, opencode, or other AGENTS.md-aware tools, name it `AGENTS.md`.
- If unsure or environment-agnostic, use `wiki-schema.md` and tell the user they can rename or symlink it.

**Schema file content:** Instantiate `references/wiki-schema-template.md`, filling in every placeholder with what was decided in the interview. Do not leave placeholders unfilled — if something is undecided, ask the user before writing.

**Seed `wiki/index.md`** with empty section headers matching the page taxonomy:

```markdown
# Index

_Catalog of all wiki pages. Updated on every ingest and on every filed query._

## Sources
_(none yet)_

## Concepts
_(none yet)_

## People
_(none yet)_

## Derived
_(none yet — filed answers, comparisons, analyses, and connections produced from queries land here)_

(... etc. for the chosen taxonomy ...)
```

**Seed `wiki/log.md`** with a header and the first entry:

```markdown
# Log

_Chronological record of operations on this wiki. Each entry begins with a date prefix so that entries can be filtered with `grep "^## \[" log.md`._

## [YYYY-MM-DD] init | wiki bootstrapped

Initialized wiki for [purpose]. Domain preset: [preset]. Page taxonomy: [list].
```

Use today's date in ISO format. Use the actual purpose and preset from the interview.

**Suggest `git init`** if the directory is not already a git repo. Mention that the wiki is well-suited to version control (history, branches, collaboration) and that `raw/` may benefit from `.gitignore` if sources are large or sensitive.

---

## Step 5: Hand off to the user

End the initialization session with a clear next-step message. Something like:

> Wiki is set up. To add your first source: drop a file into `raw/` (an article, paper, transcript, journal entry — whatever fits) and tell me to ingest it. I'll read it, discuss it with you, write a summary page, update the relevant entity / concept pages, refresh the index, and append to the log.
>
> When you want to ask questions of the wiki, just ask — I'll search across pages and synthesize. If the answer is substantive (a comparison, an analysis, a connection), I'll file it in `wiki/derived/` by default so it doesn't evaporate into chat history.
>
> Once a month or so, ask me to "lint the wiki" and I'll check for contradictions, stale claims, orphan pages, gaps, and any recent queries we should retroactively file.

Then stop. Do not proactively ingest sources, write more pages, or expand the wiki — wait for the user to drive.
