# Initialization

Read this file in full before scaffolding a new OKF-backed LLM wiki. Initialization has one job: turn the user's domain into a concrete repo contract that future agents can follow without guessing.

The result is always:

```text
.
├── raw/                         # original sources, user-maintained, immutable to the agent
├── converted/                   # generated markdown conversions, one per raw source when converted
├── wiki/                        # fully OKF-compliant knowledge bundle
│   ├── index.md                 # OKF index, no frontmatter
│   ├── log.md                   # OKF date-grouped log
│   └── ...                      # page-type directories from the selected taxonomy
└── AGENTS.md / CLAUDE.md / wiki-schema.md
```

Before writing anything under `wiki/`, read `references/OKF-SPEC.md`. The local schema may add stricter rules, but it cannot weaken OKF.

---

## Initialization sequence

1. Run the domain interview.
2. Pick or adapt a domain preset.
3. Confirm the design with the user before writing files.
4. Bootstrap `raw/`, `converted/`, `wiki/`, the schema file, `wiki/index.md`, and `wiki/log.md`.
5. Tell the user how to convert and ingest the first source.

Do not skip confirmation. The schema file is the operating manual for this wiki; if it is wrong, every future ingest compounds the mistake.

---

## Step 1: Domain interview

Ask conversationally. Do not dump every question at once. Skip questions already answered by context.

### A. Purpose and audience

1. **What is this wiki for?** What should it let you answer or do that you cannot do today?
2. **Who is the audience?** Just you, a team, customers, the public?
3. **What is the time horizon?** A short project, months, or indefinite?
4. **What does success look like after 20 ingested sources?** A better search archive, an evolving thesis, operational docs, consultation answers, a publishable knowledge base?

### B. Source landscape

5. **What source formats will appear in `raw/`?** Markdown, text, PDF, DOCX, HTML, images, spreadsheets, transcripts, email, chat logs, scans, etc.
6. **How many sources do you expect?** Tens, hundreds, thousands?
7. **Will sources arrive one at a time, or in batches?** Batch convert is allowed; batch ingest requires explicit user request.
8. **Are visual assets important?** If yes, conversion should extract assets beside the converted markdown and describe them when possible.
9. **Will source files change in place?** If yes, record that reconversion should happen automatically when source hashes change.

### C. Knowledge shape

10. **What kinds of things should get pages?** Examples: sources, concepts, people, organizations, methods, customers, components, laws, articles, characters, events, themes, decisions.
11. **Which page types are primary?** These are the things users will most often ask about or navigate through.
12. **What relationships matter?** Examples: source discusses concept, project depends on decision, law amends article, character appears in chapter, component has runbook.
13. **Is there a master synthesis page?** Examples: `wiki/thesis.md`, `wiki/me.md`, `wiki/overview.md`, `wiki/current-state.md`.

### D. Sensitivity and temporal rules

14. **Are there spoilers, temporal constraints, or supersession rules?** Books, legislation, ADRs, research versions, policies, and personal journals often need special handling.
15. **Are there privacy/confidentiality constraints?** Decide whether to use real names, initials, pseudonyms, redacted URLs, or private-only links.
16. **What should never be inferred?** Record domain-specific no-invention rules.

### E. Working style

17. **Do you want one-at-a-time ingest with discussion, or explicit batch/no-discussion mode when requested?** Default is one-at-a-time with discussion.
18. **Which schema filename should be used?** `AGENTS.md` for AGENTS-aware tools, `CLAUDE.md` for Claude Code, or `wiki-schema.md` for environment-neutral use.
19. **Any local conventions?** Naming style, page owners, review cadence, confidence levels, lifecycle statuses.

Fixed decisions that are not interview questions:

- `converted/` is mandatory.
- Every source is converted before ingestion, including markdown/text via `conversion_status: passthrough`.
- `wiki/` uses standard markdown links, not Obsidian wikilinks.
- `wiki/` pages use YAML frontmatter because OKF requires it.
- `wiki/index.md` has no frontmatter.
- `wiki/log.md` uses OKF date-grouped entries.

---

## Step 2: Domain presets

Use these as starting points. Customize them based on the interview. Every preset includes:

- `wiki/sources/` with `type: Source` pages.
- `wiki/derived/` with `type: Derived Analysis` or a more specific derived type.
- `wiki/index.md` and `wiki/log.md`.

### Preset: Research project

**Use when:** The user is reading papers, reports, articles, or books to develop an evolving understanding or thesis.

**Page taxonomy:**

- `wiki/sources/` — one page per source; summarizes claims, evidence, method, limitations, and contribution.
- `wiki/concepts/` — terms, ideas, frameworks.
- `wiki/people/` — authors/researchers and their contributions.
- `wiki/orgs/` — labs, companies, institutions.
- `wiki/methods/` — methods, models, datasets, protocols.
- `wiki/debates/` — disputed questions and competing claims.
- `wiki/derived/` — comparisons, syntheses, literature maps, query-filed analyses.
- `wiki/thesis.md` — optional evolving synthesis page.

**Ingestion emphasis:** Source page -> concepts/methods/people/orgs -> debates -> thesis if changed -> index -> log.

**Watch for:** Citation hygiene and confidence. Every thesis claim should trace to source pages.

### Preset: Book companion

**Use when:** The user is reading a book and wants a companion wiki.

**Page taxonomy:**

- `wiki/sources/` or `wiki/chapters/` — one source page per chapter/section.
- `wiki/characters/` — characters.
- `wiki/places/` — locations.
- `wiki/events/` — significant happenings.
- `wiki/themes/` — thematic threads.
- `wiki/factions/` — optional groups/houses/organizations.
- `wiki/items/` — optional significant objects.
- `wiki/derived/` — character arcs, theme analyses, comparisons.

**Ingestion emphasis:** Chapter summary -> character/place/event/theme updates -> spoiler discipline -> index -> log.

**Watch for:** If first-time reading, never include later-chapter knowledge on entity pages. Record an "as of" watermark if useful.

### Preset: Personal / journal-backed

**Use when:** The user is accumulating journal entries, notes, articles, podcasts, and reflections to understand themselves over time.

**Page taxonomy:**

- `wiki/sources/` — journal entries and external sources.
- `wiki/themes/` — recurring concerns.
- `wiki/people/` — people in the user's life, with privacy rules.
- `wiki/projects/` — ongoing projects.
- `wiki/goals/` — goals and status.
- `wiki/beliefs/` — beliefs and how they change over time.
- `wiki/derived/` — retrospectives, patterns, cross-cutting analyses.
- `wiki/me.md` — optional current-state synthesis.

**Ingestion emphasis:** Source page -> themes/projects/goals/beliefs -> `me.md` if a pattern emerges -> index -> log.

**Watch for:** Do not invent psychological interpretations. Surface what sources and the user actually say.

### Preset: Business / team knowledge

**Use when:** The wiki is fed by meeting notes, Slack threads, project docs, customer calls, and decision memos.

**Page taxonomy:**

- `wiki/sources/` — meetings, threads, call notes, docs.
- `wiki/projects/` — active and past projects.
- `wiki/people/` — team members and external contacts.
- `wiki/customers/` — optional accounts or segments.
- `wiki/decisions/` — decisions, rationale, alternatives, consequences.
- `wiki/products/` — optional product areas.
- `wiki/glossary/` — internal terminology.
- `wiki/derived/` — retrospectives, cross-project analyses, customer-segment summaries.

**Ingestion emphasis:** Extract decisions/action items/project updates without inventing them. Distinguish discussed from decided.

### Preset: Help-desk / FAQ / customer support

**Use when:** The wiki is an authored knowledge base for end users or internal employees.

**Page taxonomy:**

- `wiki/articles/` — help articles; reader-facing content.
- `wiki/categories/` — navigation groups.
- `wiki/policies/` — formal policies.
- `wiki/glossary/` — terms users need.
- `wiki/sources/` — optional supporting evidence: tickets, specs, discussions.
- `wiki/derived/` — content audits, gap analyses, most-asked-topic analyses.

**Lifecycle recommendation:** Add stricter schema fields to articles: `status`, `owner`, `audience`, `last_reviewed`, `next_review_due`.

**Watch for:** Do not invent product behavior. Use active, reader-facing language.

### Preset: Engineering / internal technical documentation

**Use when:** The wiki documents software systems, components, runbooks, ADRs, post-mortems, design docs, and onboarding.

**Page taxonomy:**

- `wiki/components/` — services, components, subsystems.
- `wiki/runbooks/` — operational procedures.
- `wiki/adrs/` — architecture decisions, numbered sequentially and append-only once accepted.
- `wiki/post-mortems/` — incident retrospectives.
- `wiki/design-docs/` — proposals and reviews.
- `wiki/onboarding/` — optional onboarding guides.
- `wiki/glossary/` — acronyms and terms.
- `wiki/sources/` — source material that feeds the documentation.
- `wiki/derived/` — cross-component analyses and FAQs.

**Watch for:** Wrong runbooks are dangerous. Confirm procedures with the user. ADRs use supersession, not contradiction edits.

### Preset: Legislation / regulatory

**Use when:** The user wants a consultation wiki for laws, regulations, amendments, jurisprudence, or compliance topics.

**Page taxonomy:**

- `wiki/laws/` — one page per law/statute/regulation.
- `wiki/articles/` — one page per operative provision.
- `wiki/definitions/` — law-scoped defined terms.
- `wiki/concepts/` — cross-law legal concepts.
- `wiki/topics/` — consultation hubs that synthesize a regulatory area.
- `wiki/amendments/` — instruments that amend other instruments.
- `wiki/jurisprudence/` — optional cases/rulings.
- `wiki/sources/` — source instruments and materials.
- `wiki/derived/` — current-state summaries, comparisons, analyses.

**Versioning decision:** Ask whether to use in-page versioning, separate historical pages, or git-only history. Default to in-page versioning for consultation use.

**Watch for:** Amendments supersede prior text; they are not ordinary contradictions. Record effective dates carefully. Repeals are not deletions.

### Custom domain

If no preset fits, define:

- Ingestion unit.
- 3-6 primary page types.
- Any synthesis page.
- Cross-reference rules.
- Privacy/spoiler/supersession rules.
- Frontmatter requirements beyond OKF.

Always include `wiki/sources/`, `wiki/derived/`, `wiki/index.md`, and `wiki/log.md` unless the user explicitly designs a special-case workflow.

---

## Step 3: Confirm the design

Show the user:

- Directory structure.
- Chosen preset and customizations.
- Page taxonomy with intended `type` values.
- Source conversion rules.
- Ingestion ritual: `raw -> converted -> wiki`.
- Query filing behavior.
- Lint checks.

Ask: "Does this look right before I scaffold it?"

Do not write files until they confirm.

---

## Step 4: Bootstrap

After confirmation, create directories:

```text
raw/
converted/
wiki/
wiki/sources/
wiki/derived/
# plus page-type directories from the selected preset
```

Create the schema file at the repo root as `AGENTS.md`, `CLAUDE.md`, or `wiki-schema.md` using `references/wiki-schema-template.md`. Fill every placeholder. Remove guidance comments. If something is undecided, ask before writing.

### Seed `wiki/index.md`

No frontmatter.

```markdown
# Index

_Catalog of OKF pages in this wiki. Updated on every ingest and every filed query._

# Sources

_(none yet)_

# Concepts

_(none yet)_

# Derived

_(none yet — filed answers, comparisons, analyses, and cross-source syntheses land here.)_
```

Use one top-level heading per section or group, following OKF index conventions. Add sections matching the selected taxonomy.

### Seed `wiki/log.md`

Use OKF's date-grouped log format, newest first.

```markdown
# Directory Update Log

## YYYY-MM-DD
* **Initialization**: Bootstrapped OKF-backed LLM wiki for [purpose]. Created `raw/`, `converted/`, `wiki/`, schema file, initial index, and log.
```

Do not use the old llm-wiki format `## [YYYY-MM-DD] operation | summary`.

### Optional git note

If the directory is not already a git repo, suggest `git init`. Mention that `raw/` may contain large or sensitive files and may need `.gitignore` rules depending on the user's needs.

---

## Step 5: Hand off

End initialization with a clear next step:

> The wiki is set up. Drop a source into `raw/` and ask me to convert or ingest it. Ingest always runs convert first, producing `converted/<raw-relative-path>.md`; then I ingest from `converted/` into the OKF-compliant `wiki/`. Substantive questions will be filed into `wiki/derived/` by default so useful analysis compounds instead of disappearing into chat history.

Then stop. Do not proactively ingest sources or expand the wiki without the user's request.
