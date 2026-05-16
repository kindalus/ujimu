# Ujimu slice implementation status

Last updated: 2026-05-16

This file is the canonical progress tracker for implementation slices. Keep it current whenever a slice is refined, grilled, acceptance-tested, implemented, or verified.

## Status values

| Status | Meaning |
| --- | --- |
| `planned` | Slice deck exists, but implementation work has not started. |
| `idea-refining` | The slice is being refined with the `idea-refine` skill. |
| `idea-refined` | Direction and scope have been refined before implementation decisions. |
| `grilling` | Implementation decisions are being stress-tested with the `grill-me` skill. |
| `grilled` | Implementation decisions are locked enough to write acceptance tests. |
| `acceptance-tested` | Acceptance tests for the slice have been written and fail for missing behaviour. |
| `implemented` | Slice code has been implemented. |
| `verified` | Tests, typecheck, build, and any relevant manual checks have passed. |
| `deferred` | Slice is intentionally not part of the current MVP implementation sequence. |

## Current verification snapshot

Latest full verification after Slice 05:

- `npm test` — passed, 36 tests
- `npm run typecheck` — passed
- `npm run build` — passed
- Manual API check — passed for anonymous quota enforcement: first 5 valid chat requests returned `200`, the 6th returned `429` with structured quota JSON.

Known non-blocking warnings:

- Nuxt/Tailwind sourcemap warnings during build.
- `node:sqlite` is external during Nitro build and experimental at runtime under Node.

## Slice table

| Slice | Deck | Status | Last verified | Notes |
| --- | --- | --- | --- | --- |
| 00 | [`00-slices-inicio.html`](./00-slices-inicio.html) | `verified` | 2026-05-16 | Initial slice overview deck exists. |
| 01 | [`01-project-foundation-ui-shell.html`](./01-project-foundation-ui-shell.html) | `verified` | 2026-05-16 | Nuxt app shell, runtime config, SQLite init/migrations, Nuxt UI shell. |
| 02 | [`02-specialist-registry-yaml.html`](./02-specialist-registry-yaml.html) | `verified` | 2026-05-16 | Specialist YAML schema, loader, registry, create/delete services, public listing endpoint. |
| 03 | [`03-legislation-wiki-raw-ingestion.html`](./03-legislation-wiki-raw-ingestion.html) | `verified` | 2026-05-16 | Raw source storage, checksum-based detection, `ingest/state.json`, Pi SDK ingestion runner, disabled-by-default real ingestion, PDF unsupported handling. |
| 04 | [`04-specialist-chat-streaming-citations.html`](./04-specialist-chat-streaming-citations.html) | `verified` | 2026-05-16 | Anonymous chat UI, NDJSON chat endpoint, swappable engine contract, grounding pre-check, citation rendering, visible question queue. |
| 05 | [`05-quotas-rate-limits.html`](./05-quotas-rate-limits.html) | `verified` | 2026-05-16 | Anonymous chat quota enforcement, quota policy engine, request event log, timezone windows, 429 UI handling. |
| 06 | [`06-auth-otp-mvp.html`](./06-auth-otp-mvp.html) | `idea-refined` | — | Direction refined: OTP by email or mobile phone creates sessions and registered quota subjects; delivery provider stays abstract/fakeable. |
| 07 | [`07-conversation-history-editing.html`](./07-conversation-history-editing.html) | `planned` | — | Not started. |
| 08 | [`08-admin-specialist-management.html`](./08-admin-specialist-management.html) | `planned` | — | Not started. Upload UI and admin protection are expected here, not in Slice 03. |
| 09 | [`09-question-analytics-content-gaps.html`](./09-question-analytics-content-gaps.html) | `planned` | — | Not started. |
| 10 | [`10-subscriptions-payments-ads.html`](./10-subscriptions-payments-ads.html) | `planned` | — | Not started. |
| 11 | [`11-security-ops-observability.html`](./11-security-ops-observability.html) | `planned` | — | Not started. |
| 12 | [`12-passkeys-post-mvp.html`](./12-passkeys-post-mvp.html) | `deferred` | — | Post-MVP passkeys slice; OTP is the MVP authentication path. |

## Active slice details

### Slice 06 — Authentication with OTP

Status: `idea-refined`

Idea-refined direction:

- Let anonymous visitors request an OTP by email or mobile phone.
- Verify the OTP to create a server-owned session.
- After verification, quota evaluation should see the user as a registered subject rather than anonymous.
- Keep notification delivery behind a provider interface; use a fake provider in tests.
- Add a minimal OTP request/verify/logout UI on the main page.
- Store normalized email or phone identifiers and hashed OTP secrets; never store OTP codes in clear text.

Out of scope for this slice:

- Passkeys, passwords, and social login.
- Subscription activation or payment state.
- Durable conversation-history migration from anonymous to account.
- Full profile-management UI beyond showing the current signed-in identity and logout.

## Completed slice details

### Slice 05 — Quotas & request limits

Status: `verified`

Implemented:

- Quota policy engine for anonymous, registered free, and subscribed subjects.
- Configurable subscribed weekly limit via `UJIMU_SUBSCRIBED_WEEKLY_LIMIT`, default `5000`.
- IANA timezone validation with fallback to `Africa/Luanda`.
- Daily and local ISO weekly quota windows.
- `request_events` SQLite migration and append-only event recording.
- Anonymous identity helper for the `ujimu_anon_id` httpOnly cookie.
- `POST /api/chat` anonymous quota enforcement before stream creation.
- HTTP 429 structured JSON for quota denials.
- Frontend quota error display above the composer, without creating assistant messages.
- Queue processing stops when a queued request receives 429, keeping pending questions visible.

Idea-refined direction:

- Protect the anonymous first-time visitor chat path first.
- Enforce anonymous quotas in `POST /api/chat` before any stream or chat-engine call starts.
- Use a server-issued httpOnly anonymous identity cookie as an identifier only.
- Store quota events and decisions server-side in SQLite.
- Keep the policy engine able to calculate anonymous, registered free, and subscribed quotas, but connect only anonymous chat enforcement in this slice.
- Return HTTP 429 JSON for quota denials before streaming; do not create a specialist assistant turn for quota denial.

Locked grill decisions:

- Weekly quotas use local ISO weeks, Monday 00:00 to the following Monday 00:00 in the user's timezone.
- Quota is consumed after request validation and specialist lookup, immediately before stream creation.
- Invalid requests and missing specialists do not consume quota.
- A valid question still counts if chat later falls back or fails technically.
- Create `ujimu_anon_id` only on the first valid chat request.
- Anonymous cookie settings: httpOnly, sameSite=lax, secure in production, maxAge 180 days, server-generated UUID value.
- Missing or invalid timezone falls back to `Africa/Luanda`.
- 429 responses use structured JSON with `error.code = QUOTA_EXCEEDED`, a pt-PT pre-1990 message, and only exceeded limits.
- If both daily and weekly limits are exceeded, return both daily and weekly limit objects.
- Quota events are append-only records for both allowed and denied attempts; denied events have `counted=false`.
- Subscribed weekly limit is configured by `UJIMU_SUBSCRIBED_WEEKLY_LIMIT`, default `5000`.
- `resolveQuotaSubject(event)` currently returns anonymous and is the future auth integration seam.
- If a queued frontend question hits 429, stop processing the queue and keep pending questions visible.
- The UI shows quota errors above the composer, not as assistant messages.
- The UI continues sending `Intl.DateTimeFormat().resolvedOptions().timeZone`; the server validates/falls back.

Out of scope for this slice:

- Authentication and real registered-user identity.
- Subscription activation or payment state.
- Durable conversation history.
- Client-authoritative quota state.

Verification:

- Covered by `tests/quotas.acceptance.test.ts` and updated UI acceptance checks.
- Included in latest full verification snapshot.

### Slice 04 — Specialist chat, streaming & citations

Status: `verified`

Implemented:

- Anonymous first-time visitor chat path in `pages/index.vue`.
- Specialist list loaded from `GET /api/specialists`.
- Composer disabled until a specialist is selected.
- In-memory conversation state only.
- Visible pending-question queue with a maximum of three questions and controls to cancel or reorder.
- `POST /api/chat` endpoint streaming `application/x-ndjson` events.
- Strict request validation for specialist, question, JSON body, and known specialist lookup.
- Deterministic citation-evidence pre-check from `ingest/state.json`.
- Rich insufficiency fallback when evidence is missing.
- Swappable chat engine contract with deterministic fake runner in tests.
- Service-unavailable fallback when no real chat runner is configured.
- Citation event rendering in a separate `Fontes` section.
- Server-side enforcement that grounded answers must include citations.

Key locked decisions:

- `/api/chat` streams NDJSON over POST.
- Missing evidence streams a normal assistant fallback response with `grounded=false`, not an HTTP error.
- The fallback explains, without technical detail, what kind of official source or context would be needed to answer safely.
- Grounding uses a deterministic server pre-check plus engine-level fail-closed behaviour.
- Conversation state is in-memory page state only.
- Pi chat remains inactive in this slice; the future activation flag is reserved as `UJIMU_PI_CHAT_ENABLED=true`.
- Pi chat citation parsing is not implemented in this slice; production falls back safely until a future Pi chat hardening slice.
- Citation events expose only user-facing fields: `sourceTitle`, `sourceFile`, and `articleRefs`.
- Citations render in a separate `Fontes` section below the streamed answer.
- The Pi chat runner design is `cwd = specialist.paths.root`, read/search tools only, no write/edit/bash, with a prompt-level instruction not to read raw source files at answer time; this restriction should be revisited after testing.
- Citation-control hardening should be revisited together with the raw-access restriction.

Out of scope:

- Authentication.
- Quotas and rate limits.
- Durable conversation history.
- Payments, subscriptions, and advertising changes.
- Admin UI and ingestion controls.

Verification:

- Covered by `tests/chat.acceptance.test.ts` and `tests/chat-ui.acceptance.test.ts`.
- Included in latest full verification snapshot.


### Slice 01 — Project foundation & UI shell

Status: `verified`

Implemented:

- Nuxt app foundation with TypeScript and npm scripts.
- Runtime data-directory config.
- SQLite database initialization and migrations.
- Nuxt UI integration and basic shell.
- Foundation tests for config, database, Nuxt UI, and UI shell.

Verification:

- Covered by `tests/config.test.ts`, `tests/db.test.ts`, `tests/nuxt-ui.test.ts`, and `tests/ui-shell.test.ts`.
- Included in latest full verification snapshot.

### Slice 02 — Specialist registry & YAML configuration

Status: `verified`

Implemented:

- Specialist directory convention and path helpers.
- `specialist.yaml` schema validation.
- Specialist registry loading and safe public metadata projection.
- Create/delete specialist service layer.
- Conversation-history deletion contract on specialist delete.
- Public `GET /api/specialists` endpoint.

Key locked decisions:

- Specialist IDs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Folder name must match YAML `id`.
- Required config fields: `id`, `name`, `description`, `wiki_type`, `system_prompt`, `citations_required`, `streaming_enabled`.
- Invalid specialists are skipped and reported internally without breaking public listing.
- Deleting a specialist physically removes the folder and deletes associated customer history through the history deletion contract.

Verification:

- Covered by `tests/specialists.acceptance.test.ts`.
- Included in latest full verification snapshot.

### Slice 03 — Legislation wiki & raw ingestion

Status: `verified`

Implemented:

- Server-side raw source storage via `storeRawSource()`.
- Startup scan of raw sources through the specialist registry plugin.
- Per-specialist ingestion state in `ingest/state.json`.
- Source identification by raw-relative path plus SHA-256 checksum.
- States: `pending`, `processing`, `ingested`, `failed`.
- Citation metadata heuristics for textual sources: title and legal article references.
- Real Pi SDK ingestion runner scoped to the specialist directory.
- Pi file tools only: `read`, `write`, `edit`, `grep`, `find`, `ls`; no `bash` by default.
- Pi ingestion disabled unless `UJIMU_PI_INGESTION_ENABLED=true`.
- Disabled ingestion leaves sources `pending`.
- PDF files are accepted and detected, but marked failed as unsupported when ingestion runs in this slice.

Key locked decisions:

- Use Pi SDK in-process instead of RPC or CLI JSON mode.
- Ingest one source at a time.
- Apply a default five-minute timeout per textual source.
- Do not expose an unauthenticated admin upload endpoint in this slice.
- Upload UI and protected admin endpoints are deferred to Slice 08.

Verification:

- Covered by `tests/ingestion.acceptance.test.ts`.
- Included in latest full verification snapshot.

## Next slice entry checklist

Before implementing the next slice:

1. Update this file: mark the slice `idea-refining`.
2. Run `idea-refine` to clarify direction and scope.
3. Update this file: mark the slice `idea-refined` and summarize decisions.
4. Run `grill-me`, one question at a time, with a recommended answer for each question.
5. Update this file: mark the slice `grilled` and summarize locked decisions.
6. Write acceptance tests first and mark the slice `acceptance-tested`.
7. Implement incrementally and mark the slice `implemented`.
8. Run verification commands and mark the slice `verified` only after they pass.

Default verification commands:

```bash
npm test
npm run typecheck
npm run build
```

Add manual verification notes when the slice includes runtime startup behaviour, streaming, browser UI behaviour, external integrations, or filesystem side effects.
