# Ujimu Project Agent Guidelines

These guidelines are authoritative for agents working in this repository. Follow them unless a more specific instruction from the user overrides them.

## Product premise

Ujimu is a Nuxt-based chat product where users consult a chosen specialist. Each specialist is backed by an LLM Wiki-style knowledge base. Answers must be grounded only in the selected specialist wiki and must cite the supporting documentation.

The AI engine is the embeddable Pi coding agent harness (`pi.dev`). Treat Pi as a product dependency: use official project documentation before implementing Pi-specific integration details.

## Current MVP assumptions

- The initial target audience is the general public.
- The first planned specialties are invoicing legislation, VAT legislation, labour legislation, and customs tariff.
- The initial MVP success target is 50 distinct visits per month.
- The initial wiki model is one public wiki per specialty.
- The first planned specialties should use the LLM Wiki `legislation/regulatory` preset.
- The initial subscription price is 50,000.00 AOA per quarter.
- Initial payment methods are Multicaixa Express, Multicaixa Reference, QR Code, and VISA. VISA should be attempted through Stripe if technically and commercially available.
- The application stack is Nuxt with TypeScript, Nuxt UI for components and theme definition, and npm.
- Persistent application data uses SQLite without an ORM.
- The default SQLite database location is `<UJIMU_DATA_DIR>/db/ujimu.sqlite`.

## Language rules

- All project documentation, technical notes, ADRs, specs, code comments intended as documentation, and agent-facing files must be written in English.
- All user-facing UI copy must be written in European Portuguese using pre-1990 orthography.
- Brainstorming or planning artefacts may be written in European Portuguese pre-1990 only when explicitly requested by the user.
- Do not mix UI copy language into technical documentation unless documenting exact strings.

## Clarification rule for brainstorming and plans

Before writing or updating brainstorming files, planning files, specs, roadmaps, or decks, stop and ask the user for clarification whenever there is uncertainty that would affect the content. Do not silently invent product direction. If assumptions are unavoidable, mark them explicitly and ask the user to confirm them.

## Core product model

- A specialist is represented by a directory on disk.
- Each specialist directory must contain a YAML configuration file with its metadata and runtime settings.
- Each specialist owns or references one wiki data set.
- The initial product model assumes public wikis by specialty; the MVP `specialist.yaml` does not need a visibility field.
- The specialties root directory is configured by environment variable and defaults to `~/.local/share/ujimu`.
- Specialties are loaded when the application starts, when a specialty is created, and on demand.
- On application start and on demand reload, the backend must check for source documents that have not yet been ingested.
- Ingestion state is stored per specialist in `ingest/state.json`.
- Official sources are always submitted as files, such as PDF, TXT, Markdown, or similar formats, and stored in the specialist `raw/` directory before ingestion.
- There is no raw file size restriction in the MVP.
- OCR is not required in the MVP; scanned PDFs that need OCR are out of scope until a later slice.
- Pi-backed ingestion uses the Pi SDK in-process, scoped to the specialist directory, with file tools only (`read`, `write`, `edit`, `grep`, `find`, `ls`) and no `bash` by default.
- Pi-backed ingestion must be explicitly enabled with `UJIMU_PI_INGESTION_ENABLED=true`; when disabled, pending sources remain pending rather than being marked failed.
- In the initial ingestion slice, PDF files may be stored and detected, but text extraction is not implemented; PDFs are marked failed with an unsupported-source error when ingestion runs.
- Administrators can create specialties, choose the LLM Wiki preset, configure fields, define specialist system prompts, and upload documents for ingestion.
- Administrators can delete a specialty; deleting a specialty must also delete customer conversation history for that specialty.

## LLM Wiki behaviour

- Wiki type configuration must map to one of the presets supported by the `llm-wiki` skill:
  - `research-project`
  - `book-companion`
  - `personal-journal-backed`
  - `business-team-knowledge`
  - `help-desk-faq-customer-support`
  - `engineering-internal-technical-documentation`
  - `legislation-regulatory`
  - `custom-domain`
- Treat the wiki as the only source of truth for specialist answers.
- Do not answer from general model knowledge when the wiki does not support the answer.
- If the wiki lacks enough evidence, tell the user that the assistant cannot answer with the current context and ask for more context.
- Every substantive answer to a user must cite the relevant source material.
- User-facing citations appear at the end of the answer.
- Citations should reference the original source file; for legislation/regulatory specialties, cite titles and articles rather than wiki page names.
- Keep raw uploaded/source documents distinct from generated wiki pages.
- Preserve traceability from answer → wiki page → source document.
- Repeated user questions may indicate missing wiki coverage; aggregate these signals and surface them for admin review before adding new content.

## Chat experience

- The product interface is a chat experience similar to ChatGPT.
- At the start of each chat, the user must choose the specialist to consult.
- Chat sessions must remain scoped to the selected specialist unless the user explicitly starts a new consultation.
- Answers should stream to the UI.
- The assistant must make clear when a question is outside the chosen specialist's wiki.
- Each specialist experience must clearly disclose that the content is generated by AI and may contain errors.
- Registered users can view their chat history by specialty, limited to the latest 20 conversations/sessions per specialty.
- Registered users can delete any conversation from their history; deletion is permanent.
- Registered users can resume a historical session.
- If a user jumps back and edits a prior question in a session, all later messages and interactions in that conversation must be permanently removed and replaced by the new continuation.

## Authentication, quotas, and subscriptions

- A request is each question sent by the user.
- Anonymous users are tracked with browser cookies and are limited to 5 requests per day or 20 requests per week.
- Registered users without a subscription are limited to 20 requests per day and 100 requests per week.
- Subscribed users have no daily limit by default, but have a configurable weekly limit; the initial target is 5000 requests per week.
- The initial subscription period is quarterly, priced at 50,000.00 AOA per quarter.
- Appy Pay is the provider for Multicaixa Express, Multicaixa Reference, and QR Code payments.
- Payment methods should also support VISA; validate Stripe as the preferred VISA integration path.
- Subscriptions activate automatically after payment confirmation.
- There is no grace period after subscription expiry.
- When a subscription has less than one week remaining, the application must show an expiry warning.
- Quotas are evaluated in the user's timezone.
- Quotas must be enforced server-side. Client cookies are an identifier, not an authority.
- Authentication supports one-time passwords by email and mobile phone in the MVP.
- SendGrid is the preferred initial email/SMS provider, but provider integration must be abstracted so it can be changed with minimal friction.
- Passkeys are a later slice, not part of the OTP MVP.
- Avoid storing sensitive authentication material in plaintext.

## Advertising

- Users without a subscription may see advertising.
- Reserve advertising zones compatible with common Google Ads dimensions.
- Advertising UI must not interfere with the user's ability to read cited answers or citations.

## Visual direction

- The product look and feel should resemble modern chat applications.
- Use a black and white foundation with an Angola-flag yellow accent.
- Keep the interface clean, readable, and trustworthy rather than decorative.

## Admin capabilities

There is a single administrative role: `admin`.

Administrators must be able to:

- Create and configure specialties.
- Choose the LLM Wiki preset backing a specialty.
- Edit specialist metadata and system prompts.
- Upload source documents.
- Trigger or inspect ingestion status.
- Review repeated questions per specialist.
- Decide whether repeated questions justify new wiki content.
- Delete specialties and the associated customer history.

Specialist prompt changes do not require audit history in the MVP.

## Data and observability

- Log questions by specialist for product analysis and content-gap discovery.
- Measure the MVP target of 50 distinct monthly visitors using a combined signal from cookies, accounts, and analytics.
- Separate analytics data from answer grounding; analytics must not become an uncited knowledge source.
- Record ingestion state so the system can identify pending documents reliably.
- Prefer audit-friendly records for admin actions such as specialty creation, upload, reload, and prompt changes.

## Security and privacy expectations

- Treat uploads, prompts, cookies, phone numbers, email addresses, and chat history as sensitive data.
- Validate and sanitize all uploaded documents and user inputs.
- Never trust client-provided quota state.
- Avoid leaking one specialist's private wiki content into another specialist's chat.
- Ensure citations do not expose restricted files to users who should not access them.
- Keep secrets in environment variables or a secret manager; never commit `.env` files.

## Nuxt implementation expectations

- Use Nuxt as the application platform.
- Use Nuxt UI as the default component system and theme definition layer.
- Keep server-only logic in server-side modules and API routes.
- Keep user-facing copy separate enough that pre-1990 Portuguese strings can be reviewed consistently.
- Prefer typed interfaces for specialty configuration, quota policy, authentication state, and citation metadata.
- Add tests for quota enforcement, specialist loading, ingestion detection, and answer-grounding failure paths.
- Implementation planning decks should describe success conditions that can be converted into tests; they should not contain concrete test code.

## Project specifications and slice workflow

- Treat `docs/brainstorming-inicial.html` and the slice decks in `docs/slices/` as project specification artefacts, not presentation-only files.
- For slices that have not yet been implemented, update the relevant brainstorming or slice deck whenever a new product idea, technical idea, scope clarification, or implementation decision emerges.
- During `idea-refine` and `grill-me` for an unimplemented slice, update that slice deck so the refined scope and locked decisions are captured before acceptance tests are written.
- Do not retroactively change the intended scope of an already implemented slice deck. If the implemented slice needs factual corrections or as-built notes, keep them clearly documented as corrections/notes; new behaviour belongs in a future slice.
- Keep `docs/slices/STATUS.md` as the canonical slice progress tracker and update it whenever a slice changes status or verification state.
- Use Git as the project change log. After this repository has been initialized, keep commits small and phase-based during each slice.
- For every new slice, make separate commits for at least: `idea-refine`/spec updates, `grill-me` locked decisions, acceptance-test creation, and implementation after the full verification suite passes.
- Do not collapse those slice-phase commits into one large commit unless the user explicitly asks for a squash.
- Before moving into a new implementation slice, first refine the slice direction with the `idea-refine` skill, then stress-test and lock implementation decisions with the `grill-me` skill.
- During the `grill-me` step, ask one decision-sharpening question at a time, provide a recommended answer for each question, and resolve dependencies before implementation starts.
- When implementation of a slice starts, write acceptance tests first from the slice success conditions.
- After acceptance tests exist, implement the remaining code incrementally and use test-driven development where practical: write a failing test, make it pass with the smallest correct change, then refactor while keeping tests green.
- Keep acceptance tests focused on externally visible slice behaviour rather than implementation details.

## Suggested specialty directory shape

This is a starting convention and may evolve after product clarification:

```text
~/.local/share/ujimu/
  db/
    ujimu.sqlite
  specialties/
    example-specialist/
      specialist.yaml
      raw/
      wiki/
      ingest/
        state.json
```

The YAML configuration should eventually cover at least:

- Specialist identifier, display name, and description shown to users.
- Wiki type and paths.
- Specialist system prompt.
- Citation policy.
- Ingestion settings.
- Access or visibility settings.
- Admin-owned metadata.

## Change discipline

- Keep changes small and reviewable.
- Prefer incremental implementation over large rewrites.
- When adding behaviour, add or update tests where practical.
- Before implementing framework- or library-specific code, verify the current official documentation.
- Summarize changed files and known open questions after each task.
