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

Latest full verification after Slice 09:

- `npm test` — passed, 57 tests
- `npm run typecheck` — passed
- `npm run build` — passed
- Manual API smoke check — not separately run for analytics; route, stream logging, privacy deletion, review lifecycle, visitor count, and UI contracts are covered by acceptance tests.

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
| 06 | [`06-auth-otp-mvp.html`](./06-auth-otp-mvp.html) | `verified` | 2026-05-16 | OTP email/phone auth, JWT session cookie, registered quota subject integration, compact auth UI. |
| 07 | [`07-conversation-history-editing.html`](./07-conversation-history-editing.html) | `verified` | 2026-05-16 | Registered conversation history, restore/delete/edit, citation snapshots, history stream event, compact history UI. |
| 08 | [`08-admin-specialist-management.html`](./08-admin-specialist-management.html) | `verified` | 2026-05-16 | Admin allowlist, single-page console, specialist CRUD, uploads, source reload, disabled ingestion handling, trash delete, audit events. |
| 09 | [`09-question-analytics-content-gaps.html`](./09-question-analytics-content-gaps.html) | `verified` | 2026-05-16 | Question analytics, content-gap candidates, review lifecycle, first-party visitor counts, admin dashboard. |
| 10 | [`10-subscriptions-payments-ads.html`](./10-subscriptions-payments-ads.html) | `idea-refined` | — | Direction refined for a mockable provider MVP before real Appy Pay/Stripe integrations. |
| 11 | [`11-security-ops-observability.html`](./11-security-ops-observability.html) | `planned` | — | Not started. |
| 12 | [`12-passkeys-post-mvp.html`](./12-passkeys-post-mvp.html) | `deferred` | — | Post-MVP passkeys slice; OTP is the MVP authentication path. |

## Slice 10 — Subscriptions, payments & advertising

Status: `idea-refined`

Idea-refined direction:

- Implement a mockable billing MVP rather than direct Appy Pay or Stripe API calls in this slice.
- Keep payment providers behind an internal interface so real Appy Pay and Stripe adapters can be added later without changing subscription, quota, or UI logic.
- Authenticated users can create a quarterly subscription checkout for the public 50,000.00 AOA plan.
- Checkout creates a pending payment; subscription activation happens only after a provider-style confirmation event.
- Subscription status drives quota subject resolution, expiry warnings, and advertising visibility.
- Advertising zones remain visible for anonymous and registered free users and hidden for subscribed users.
- Treat provider event payloads as untrusted input and keep confirmation idempotent.

Out of scope for this slice:

- Real Appy Pay API calls.
- Real Stripe Checkout, Payment Intents, or card processing.
- Subscription cancellation, refunds, invoices, or receipts.
- Admin billing dashboards.

## Completed slice details

### Slice 09 — Question analytics & content gaps

Status: `verified`

Implemented:

- `question_analytics_events`, `question_analytics_reviews`, and `visitor_events` SQLite migration.
- Deterministic question normalization and SHA-256 fingerprints for repeated-question grouping.
- Chat stream analytics logging after complete visible `answered` or `insufficient_context` outcomes only.
- Analytics rows linked to conversation/user message IDs when authenticated history is saved, while keeping old analytics after successful edits.
- Conversation deletion privacy via cascading removal of linked readable analytics rows.
- First-party `ujimu_visitor_id` cookie and public visit recording endpoint.
- Admin visitor-count endpoint for distinct monthly visitors, using `user_id` before visitor cookie identity.
- Admin question analytics endpoint for candidates and recent questions per specialist.
- Candidate review endpoint that hides reviewed fingerprints until renewed recurrence after review.
- `/admin` dashboard sections for monthly visitors, content-gap candidates, recent questions, and review actions.
- Main page visit ping on load.

Idea-refined direction:

- Treat user questions as editorial signals per specialist, not as answer-grounding evidence.
- Record only questions that produced a visible answer outcome: `answered` or `insufficient_context`.
- Store the raw question text, with a length limit and sensitive-data treatment, so admins can understand real user wording.
- Also store a normalized question and fingerprint for deterministic grouping.
- Keep analytics separate from citations and the wiki; analytics must never become a factual source for assistant answers.
- Surface repeated question candidates in the existing single `/admin` console.
- Add a minimal distinct monthly visitor metric using Ujimu-owned identifiers instead of external analytics.

Locked grill decisions:

- Do not log quota denials, technical failures, malformed requests, or requests without a valid specialist/question in question analytics.
- A visible grounded answer is recorded as `answered`; the safe no-evidence fallback is recorded as `insufficient_context`.
- When a user deletes a conversation, remove or anonymize readable analytics linked to that conversation. Aggregate counters may remain.
- When a user edits a historical question successfully, keep the old analytics event and record the new edited question if it produces a visible outcome.
- Define repeated questions by `specialist_id + normalized_question` for the MVP; normalization lowercases, trims, removes simple punctuation, and collapses whitespace.
- A content-gap candidate appears when the same normalized question appears at least 2 times in the last 30 days.
- Insufficient-context candidates should be highlighted separately from answered repeats.
- A reviewed candidate stores `reviewed_at` and is hidden until the same fingerprint crosses the threshold again after review.
- Distinct monthly visitors use a first-party `ujimu_visitor_id` cookie. Count `user_id` when authenticated; otherwise count visitor cookie identity.
- Do not integrate Google Analytics or other third-party analytics in this slice.
- Admin REST contracts are: `POST /api/analytics/visit`, `GET /api/admin/analytics/visitors?month=YYYY-MM`, `GET /api/admin/analytics/questions?specialistId=...`, and `POST /api/admin/analytics/questions/:fingerprint/review`.

Acceptance tests written first in:

- `tests/analytics.acceptance.test.ts`
- `tests/admin-ui.acceptance.test.ts`
- `tests/db.test.ts`

Acceptance-test targets:

- Chat analytics logs only `answered` and `insufficient_context` visible outcomes, never quota denials or stream failures.
- Logged records include specialist, outcome, raw question, normalized question, fingerprint, timestamp, visitor identity, optional user/conversation/message references, and no answer content.
- Deleting a conversation removes readable question analytics linked to that conversation.
- Editing a question keeps older analytics and records the edited question only after a visible answer.
- Admin question analytics lists repeated candidates by specialist, hides reviewed candidates, and resurfaces them after post-review recurrence.
- Visit analytics creates/reuses a first-party visitor cookie and exposes distinct monthly visitor counts to admins.
- The `/admin` page contains visitor metric and content-gap sections wired to the admin analytics endpoints.

Out of scope for this slice:

- Semantic/embedding-based question clustering.
- Automatic wiki page creation or source ingestion from analytics.
- Third-party analytics integrations.
- Admin comments, assignments, or editorial workflow beyond reviewed/unreviewed.
- Using analytics as citations or answer context.

### Slice 08 — Admin specialist management

Status: `verified`

Implemented:

- `admin_audit_events` SQLite migration for minimal admin operation auditing.
- Admin guard based on existing OTP sessions and `UJIMU_ADMIN_CONTACTS`, checking every verified identity for the user.
- Admin session endpoint returning authenticated/admin status without exposing allowlist internals.
- Admin specialist list/create/edit/delete endpoints with 401/403/400/404/409 semantics.
- Specialist edit support for mutable metadata and prompts while keeping `id` and `wiki_type` immutable.
- Specialist deletion that moves the directory to `<UJIMU_DATA_DIR>/trash/specialties/<timestamp>_<id>/`, removes it from public selection, and deletes conversation history.
- Raw source upload endpoint with supported extension checks, filename sanitization, and duplicate rejection.
- Source reload endpoint that refreshes `ingest/state.json` and returns source statuses.
- Manual ingestion endpoint that surfaces disabled Pi ingestion as `409` with safe user-facing copy and audited skipped state.
- Single-page `/admin` console for specialist creation, editing, source upload, source reload, ingestion trigger, and delete confirmation.
- Conditional `Administração` link on the main page for allowlisted admins.

Idea-refined direction:

- Provide a single-page admin console at `/admin` for the MVP rather than a multi-route admin area.
- Use the existing OTP identity system for authentication.
- Authorize admins through an environment allowlist such as `UJIMU_ADMIN_CONTACTS`, matching verified email or E.164 phone identities.
- Keep one role only: `admin`. Do not add editor, reviewer, owner, or per-specialist permissions in this slice.
- Keep `visibility` out of the YAML model in this slice; created specialists are public once valid and loaded.
- Admins can create specialists by supplying ID, display name, description, LLM Wiki preset, system prompt, citation-required, and streaming-enabled settings.
- Admins can edit specialist metadata and system prompt; prompt-version audit history remains out of scope.
- Admins can upload official source files into the specialist `raw/` directory.
- Upload does not silently run Pi ingestion. Admins can refresh source detection/status separately, then manually trigger ingestion when enabled.
- Admins can inspect ingestion/source statuses after upload, detection, and ingestion attempts.
- Deleting a specialist requires explicit confirmation, removes its directory, reloads the registry, and deletes customer conversation history for that specialist.
- Record minimal SQLite audit events for admin create, edit, upload, reload/detect, ingestion trigger, and delete actions.

Locked grill decisions:

- `UJIMU_ADMIN_CONTACTS` accepts comma-separated verified OTP contacts. Email contacts compare lowercased; phone contacts compare without spaces. If unset or empty, nobody is admin.
- Admin authorization checks all verified identities for the authenticated user, not only the session display contact.
- Admin endpoints return `401` for unauthenticated requests, `403` for authenticated non-admin users, `400` for invalid input, `404` for missing specialists, and `409` for duplicates, disabled ingestion, or operational conflicts.
- Source uploads accept only `.txt`, `.md`, `.markdown`, and `.pdf`; Ujimu adds no MVP-specific file size cap beyond platform limits.
- Upload filenames must be plain basenames with no absolute paths, slashes, `.` or `..` path tricks. Duplicate filenames are rejected by default instead of overwritten.
- Specialist edits may change `name`, `description`, `system_prompt`, `citations_required`, and `streaming_enabled` only. `id` and `wiki_type` are immutable after creation.
- Manual ingestion returns `409 Conflict` with the user-facing message `A ingestão automática não está activa neste ambiente.` when Pi ingestion is disabled; pending sources remain pending and the skipped action is audited.
- `admin_audit_events` stores `id`, `admin_user_id`, `admin_contact`, `action`, `specialist_id`, `occurred_at`, and `metadata_json`.
- Audit metadata may include safe operational details such as filename, status counts, changed fields, and error code. It must not store document contents, OTPs, old prompts, or secrets.
- Deleting a specialist behaves as product deletion but moves the specialist directory to `<UJIMU_DATA_DIR>/trash/specialties/<timestamp>_<specialistId>/` instead of erasing it immediately.
- Delete requires exact `confirmationId`, deletes customer conversation history, removes the specialist from public selection, reloads the registry, and does not implement restore in this slice.
- The admin UI is a single `/admin` page with authentication/authorization messaging, specialist list, create form, edit panel, source upload, source status list, reload, ingestion, and delete controls.
- The main chat page shows a discreet `Administração` link only when `/api/admin/session` reports that the signed-in user is an admin.
- Admin REST contracts are: `GET /api/admin/session`, `GET/POST /api/admin/specialists`, `PATCH/DELETE /api/admin/specialists/:id`, `POST /api/admin/specialists/:id/raw`, `POST /api/admin/specialists/:id/sources/reload`, and `POST /api/admin/specialists/:id/ingestion/run`.

Acceptance tests written first in:

- `tests/admin.acceptance.test.ts`
- `tests/admin-ui.acceptance.test.ts`
- `tests/db.test.ts`
- `tests/chat-ui.acceptance.test.ts`

Acceptance-test targets:

- Unauthenticated admin operations return `401`; authenticated non-admin operations return `403`.
- `GET /api/admin/session` reflects `authenticated` and `admin` using all verified identities and an empty allowlist grants no admin access.
- An admin can create a valid legislation/regulatory specialist and duplicate/invalid creates fail with appropriate errors.
- An admin can edit mutable specialist fields, while attempts to change `id` or `wiki_type` are rejected or ignored safely.
- Upload accepts supported raw source types, rejects duplicate filenames and unsafe filenames, and marks sources pending after reload/detection.
- Manual ingestion returns `409` and leaves sources pending when Pi ingestion is disabled; enabled ingestion can reuse the existing runner contract.
- Deleting a specialist with the exact confirmation moves its directory to trash, removes it from public specialists, deletes conversation history, and records audit.
- Admin create/update/upload/reload/ingestion/delete actions create safe audit events.
- The `/admin` page contains the agreed management UI copy and the main page contains the conditional `Administração` link/API hook.

Out of scope for this slice:

- Public/private/draft specialist visibility.
- Admin management UI or invitation flows.
- Multi-role permissions.
- Prompt version history.
- Background ingestion workers or queues.
- OCR for scanned PDFs.
- Payment/subscription admin functions.

### Slice 07 — Conversation history & editing

Status: `verified`

Implemented:

- `conversations`, `conversation_messages`, and `message_citations` SQLite migration.
- History repository for list, load, delete, persistence, specialist cleanup, and continuation context windows.
- Authenticated REST history endpoints for list, load, and permanent delete.
- `POST /api/chat` history metadata support with `conversationId` and `replaceFromMessageId`.
- Authenticated stream persistence after complete responses/fallbacks only.
- NDJSON `history` event emitted before `done` with persisted conversation and message IDs.
- Destructive edit replacement that keeps old history intact when replacement generation fails.
- Citation snapshots restored from SQLite rather than recalculated.
- Hybrid AI title generation contract with generated or pending title status.
- Compact main-page history panel with Retomar, Apagar, and Editar flows for authenticated users.

Idea-refined direction:

- Registered users can see the latest 20 conversations per selected specialist.
- Anonymous users do not get cross-session history, and messages sent before login are not retroactively migrated.
- The first authenticated question for a selected specialist creates a new conversation automatically.
- History is exposed as a compact panel on the main chat page rather than a separate route.
- Opening a conversation restores its messages and allows continuation.
- Deleting a conversation permanently removes it, its messages, and citations from SQLite.
- Editing an earlier user question permanently removes every later message before saving the replacement path.
- Assistant fallback answers that were shown to the user are saved; technical failures and quota denials are not saved as conversation messages.
- Conversation titles are generated by AI after the first assistant response, using the first question, first answer, and selected specialist as input.
- Generated titles are for navigation only and must not become answer-grounding evidence.

Locked grill decisions:

- Conversation title generation uses a hybrid path: after the first assistant response, the app tries to generate an AI title quickly; if generation fails or times out, the conversation keeps a temporary title and is eligible for later regeneration.
- Opening an old conversation automatically switches the selected specialist to that conversation's original specialist; continuing a conversation never changes its specialist.
- Only authenticated user-authored question messages can be edited. Assistant messages cannot be edited; when an edit succeeds, the original user question and all later messages are permanently deleted, then the edited question and new assistant response are appended after the remaining prefix.
- Persisted assistant messages store citation snapshots exactly as shown to the user; reopening history renders the snapshot instead of recalculating citations from the wiki.
- Authenticated chat history is persisted only after a stream completes with a full assistant response or visible fallback. Quota denials, technical send failures, and partial streams are not saved as conversation messages.
- If no AI title provider/model is configured, the conversation keeps a temporary title and `title_status = pending`; title generation must not block conversation persistence.
- `POST /api/chat` is extended with optional history metadata: `conversationId` to continue a session and `replaceFromMessageId` to edit a prior user question by deleting all later messages before saving the replacement path.
- When continuing a conversation, the backend supplies a limited slice of previous messages as conversational context for disambiguation only; persisted history is never treated as grounding evidence and never replaces wiki citations.
- The resumed conversational context window includes the first 5 messages plus the last 10 messages, de-duplicated when conversations are short.
- History management uses REST endpoints: `GET /api/history?specialistId=...` for the latest 20 conversations, `GET /api/history/:conversationId` to load one conversation, and `DELETE /api/history/:conversationId` to permanently delete it.
- History endpoints return `401` for unauthenticated users; missing conversations and cross-user access both return `404` to avoid revealing whether another user's conversation exists.
- Edit replacement uses new message IDs: after successful generation, delete the original edited question and all later messages, then insert the edited question and new assistant response after the remaining prefix.
- If an edit replacement fails technically or the stream is incomplete, the existing conversation remains intact; destructive truncation only happens after a complete replacement response exists.
- After authenticated chat history is persisted, the NDJSON stream emits a `history` event containing `conversationId`, `userMessageId`, `assistantMessageId`, `title`, and `titleStatus`, so the frontend can continue or edit without an extra fetch.
- The `history` event is emitted before `done`; after `done`, the frontend can treat the assistant response and persisted history state as complete.
- Quick AI title generation waits up to 5 seconds before falling back to a temporary title with `title_status = pending`.
- This slice stores `pending` title state but does not implement a background title regeneration worker; regeneration is left to a future slice.

Acceptance-test targets:

- Unauthenticated history list/load/delete returns `401`.
- Registered users see at most the latest 20 conversations for the selected specialist.
- Cross-user or missing conversation access returns `404`.
- Opening a conversation restores messages and citation snapshots.
- Continuing a conversation via `POST /api/chat` persists user and assistant messages, emits a `history` event before `done`, and uses the original conversation specialist.
- Editing via `replaceFromMessageId` deletes the original edited question and all later messages only after a complete replacement response exists.
- If edit replacement fails technically, old messages remain intact.
- First completed authenticated response creates a conversation with an AI-generated title when the title runner succeeds.
- Missing/failing/timed-out title generation stores a temporary title with `title_status = pending`.
- Resumed chat context uses the first 5 plus last 10 messages, de-duplicated, as non-grounding conversational context.

Out of scope for this slice:

- Anonymous history migration after login.
- User-editable conversation titles.
- Conversation sharing/export.
- Multi-branch conversation trees; editing rewrites the linear future.
- Using history summaries as grounding evidence for specialist answers.

### Slice 06 — Authentication with OTP

Status: `verified`

Implemented:

- OTP request and verify services for email and E.164 phone contacts.
- `users`, `user_identities`, and `otp_challenges` SQLite migration.
- OTP codes stored only as hashes with a pepper.
- OTP expiry, attempt limit, reuse prevention, and active-code invalidation.
- Notification provider interface with fake delivery enabled by environment outside production.
- JWT session creation and verification with httpOnly `ujimu_session` cookie.
- Session endpoint and logout endpoint.
- Quota subject resolution now prefers valid registered JWT sessions and falls back to anonymous identity.
- Compact main-page OTP auth panel with Entrar, Email/Telemóvel, contact input, code input, signed-in identity, and Sair.

Idea-refined direction:

- Let anonymous visitors request an OTP by email or mobile phone.
- Verify the OTP to create a server-owned session.
- After verification, quota evaluation should see the user as a registered subject rather than anonymous.
- Keep notification delivery behind a provider interface; use a fake provider in tests.
- Add a minimal OTP request/verify/logout UI on the main page.
- Store normalized email or phone identifiers and hashed OTP secrets; never store OTP codes in clear text.

Key locked decisions:

- Data model uses `users` plus `user_identities` for verified email and phone identities.
- Linking UI is out of scope, but verifying a new identity while signed in links it to the current account.
- OTP codes are numeric 6-digit codes.
- OTP expires after 10 minutes and allows at most 5 verification attempts.
- Store only `sha256(pepper + code)`; `UJIMU_OTP_PEPPER` is used when available.
- Notification delivery uses a provider interface; fake delivery is enabled by `UJIMU_AUTH_FAKE_DELIVERY_ENABLED=true` outside production and tests inject providers directly.
- Session uses a signed JWT in an httpOnly `ujimu_session` cookie.
- JWT payload includes `sub`, `iat`, `exp`, and `typ: "session"`.
- JWT session expiry is 90 days.
- If `UJIMU_SESSION_SECRET` is missing, generate a random singleton process secret; sessions will not survive restart.
- If `UJIMU_OTP_PEPPER` is missing, generate a random singleton process pepper; pending OTPs will not survive restart.
- Logout clears the cookie; no server-side JWT revocation in this slice.
- `resolveQuotaSubject(event)` validates `ujimu_session` first and falls back to anonymous cookie identity.
- Email normalization: trim + lowercase.
- Phone normalization: remove spaces and require international E.164 format.
- Invalid contact input returns HTTP 400 and does not call the provider.
- Valid OTP request responses are generic to avoid account enumeration.
- Only one OTP is active per contact; a new request invalidates the previous OTP and creates a new code.
- Provider delivery failure returns HTTP 503 with a generic message and does not leave an active OTP.
- Wrong, expired, over-attempted, and reused OTP verification failures use the same generic error message.
- `GET /api/auth/session` returns only authenticated status, user id, and display contact.
- Successful verification keeps the OTP record with `used_at` filled for audit and reuse prevention.
- UI uses a compact main-page auth panel with Entrar, Email/Telemóvel, contact input, code input, signed-in identity, and Sair.
- Endpoints: `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`, `GET /api/auth/session`, and `POST /api/auth/logout`.

Context compaction before implementation:

- Implement server-side OTP authentication with a minimal main-page UI.
- Data model: `users`, `user_identities`, `otp_challenges`; no server-side session table because sessions are JWT cookies.
- Security invariants: no plaintext OTP storage, generic valid-contact request response, generic verification failure response, provider abstraction, no fake delivery in production.
- Quota integration: update `resolveQuotaSubject(event)` to prefer valid `ujimu_session` and otherwise fall back to anonymous.
- Acceptance tests should cover email OTP, phone OTP, expired/reused/over-attempted OTP failures, provider abstraction/fake delivery, session endpoint/logout, and registered quota subject resolution.

Out of scope for this slice:

- Passkeys, passwords, and social login.
- Subscription activation or payment state.
- Durable conversation-history migration from anonymous to account.
- Full profile-management UI beyond showing the current signed-in identity and logout.

Verification:

- Covered by `tests/auth.acceptance.test.ts` and updated UI acceptance checks.
- Included in latest full verification snapshot.

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
