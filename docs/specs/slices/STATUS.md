# Ujimu slice implementation status

Last updated: 2026-08-21

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

Latest full verification after Slice 53 Twilio Verify SMS OTP:

- `npm test` — passed, 245 tests
- `npm run typecheck` — passed
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings
- `npm audit` — passed with 0 known vulnerabilities after updating Nuxt, Nuxt UI, Vite, and related dependencies.
- `npm audit signatures` — passed; 1,034 packages had verified registry signatures and 357 had verified attestations.
- Dependency audit note: the prior `esbuild` advisory was resolved with a lockfile refresh and a top-level `overrides.esbuild = 0.28.1` pin; new advisories appeared after that snapshot.
- Chrome DevTools production browser and performance check, 2026-08-21 — passed at `https://ujimu.com`: SEO 100, Best Practices 100, LCP 237 ms, TTFB 173 ms, CLS 0, HTTP/2, four initial API calls, and no console errors or warnings.
- Real Pi initialization smoke test, 2026-08-21 — passed with the configured OpenRouter model in a temporary workspace; `llm-wiki` created `AGENTS.md`, `wiki/index.md`, and `wiki/log.md`, and strengthened backend validation accepted the generated contract.
- `scripts/container/build.sh` — passed with Podman, built `localhost/ujimu:latest`
- Container smoke test — passed: `gemini --version` returned `0.42.0`; `/healthz` returned `{ "ok": true, "service": "ujimu" }`
- Real Pi TXT pipeline smoke test, 2026-05-20 — passed in a non-production temporary data directory using a temporary agent configuration with `openrouter/google/gemini-2.5-flash`: admin specialist creation, TXT upload, Pi conversion, Pi ingestion, and grounded chat with a citation to `raw/lei-smoke.txt`.
- Gemini CLI PDF-to-Markdown smoke tests, 2026-05-20 — passed in non-production temporary directories with the real `gemini` CLI and a user-provided `GEMINI_API_KEY`: direct `pdf_to_markdown.sh` produced `raw/small-sample.pdf.md`, and the admin upload/conversion endpoint converted `sample.pdf` to `sample.pdf.md`; both preserved the expected article/day text. These remain intentionally excluded from CI because they require external credentials and service access.

Launch roadmap note as of 2026-05-20:

- The first launch scope excludes live payments.
- Appy Pay, Stripe/VISA, and SendGrid integrations are deferred until after launch.
- The OTP/contact-delivery path for production launch remains an open product/operations question if OTP remains in launch scope without SendGrid.

Known non-blocking warnings:

- Nuxt/Tailwind sourcemap warnings during build.
- VueUse Rollup pure-comment warnings during build.
- Node `module.register()` deprecation warning during build.
- `node:sqlite` is external during Nitro build and experimental at runtime under Node.
- Real Pi smoke finding: the committed default `openrouter/moonshotai/kimi-k2.6` converted the TXT source but timed out during ingestion at the current 5-minute ingestion timeout. Do not treat the default Pi model choice as production-validated until a follow-up decision confirms it or changes it.

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
| 10 | [`10-subscriptions-payments-ads.html`](./10-subscriptions-payments-ads.html) | `verified` | 2026-05-16 | Mockable billing provider MVP, secret webhook confirmation, subscriptions, subscribed quota subject, expiry warning, and ad hiding. |
| 11 | [`11-security-ops-observability.html`](./11-security-ops-observability.html) | `verified` | 2026-05-16 | Security headers, healthz/readyz, sanitized daily JSONL operational logs, CI, and operations runbook. |
| 12 | [`12-passkeys-post-mvp.html`](./12-passkeys-post-mvp.html) | `verified` | 2026-05-16 | Passkey registration/login/removal, OTP fallback, adapter contract, UI, migration, readiness, and operations documentation. |
| 13 | [`13-pi-agent-pipeline.html`](./13-pi-agent-pipeline.html) | `verified` | 2026-05-18 | Three Pi sessions for conversion, ingestion, and consultation; Ujimu Pi agent config under `config/ujimu-pi-agent`; Markdown-first ingestion pipeline. |
| 14 | [`14-pdf-to-markdown-gemini-tool.html`](./14-pdf-to-markdown-gemini-tool.html) | `verified` | 2026-05-17 | Gemini CLI-backed PDF conversion tool scoped to the conversion agent; full automated verification passed. |
| 15 | [`15-podman-container-deployment.html`](./15-podman-container-deployment.html) | `verified` | 2026-05-19 | Podman-compatible image, prod/test env profiles, lifecycle scripts, persistent Pi/Ujimu mounts, and manual deployment documentation. |
| 16 | [`16-ui-shell-drawer-foundation.html`](./16-ui-shell-drawer-foundation.html) | `verified` | 2026-05-21 | Shared `AppDrawer.vue` using Nuxt UI `UDrawer`; main chat page uses drawer with existing-route links only and desktop pin option. |
| 17 | [`17-chat-workspace-nuxt-ui.html`](./17-chat-workspace-nuxt-ui.html) | `verified` | 2026-05-21 | Chat-first workspace using Nuxt UI chat components, parts adapter, bottom-anchored two-row Gemini-style prompt with specialist selector, specialist empty state, and no hero block. |
| 18 | [`18-history-auth-drawer.html`](./18-history-auth-drawer.html) | `verified` | 2026-05-21 | Conversation history moved into the drawer; OTP/passkey login opens as an on-demand Nuxt UI modal; permanent auth/history side panels removed. |
| 19 | [`19-subscription-page-billing-ui.html`](./19-subscription-page-billing-ui.html) | `verified` | 2026-05-21 | Dedicated `/subscription` page for billing status and checkout; drawer link added; permanent billing checkout blocks removed from chat. |
| 20 | [`20-inline-ads-chat-polish.html`](./20-inline-ads-chat-polish.html) | `verified` | 2026-05-21 | Inline ad placements after every randomized 5–10 completed assistant responses for eligible users; citations remain inside assistant messages. |
| 21 | [`21-admin-routing-specialists-sources.html`](./21-admin-routing-specialists-sources.html) | `verified` | 2026-05-21 | Admin subpages for specialist list/create plus detail/source upload/reload/conversion/ingestion/delete; existing API and auth semantics preserved. |
| 22 | [`22-admin-analytics-ops-polish.html`](./22-admin-analytics-ops-polish.html) | `verified` | 2026-05-21 | Admin analytics/content-gap and safe readiness subpages; admin index simplified to navigation cards. |
| 23 | [`23-dev-auth-login.html`](./23-dev-auth-login.html) | `verified` | 2026-06-10 | Development-only login for allowlisted contacts, without OTP/passkey, guarded from production. |
| 24 | [`24-specialist-availability-access.html`](./24-specialist-availability-access.html) | `verified` | 2026-06-10 | Specialist suspension and email allowlist, enforced in public listing, chat, and history. |
| 25 | [`25-source-upload-replacement-refresh.html`](./25-source-upload-replacement-refresh.html) | `verified` | 2026-06-10 | Source upload/replacement and source-status refresh without manual conversion UI. |
| 26 | [`26-recoverable-ingestion-jobs.html`](./26-recoverable-ingestion-jobs.html) | `verified` | 2026-06-10 | Recoverable SQLite-backed ingestion jobs. |
| 27 | [`27-automatic-conversion-ingestion-worker.html`](./27-automatic-conversion-ingestion-worker.html) | `verified` | 2026-06-10 | Automatic conversion inside the asynchronous ingestion worker. |
| 28 | [`28-corporate-data-model-context.html`](./28-corporate-data-model-context.html) | `verified` | 2026-06-10 | Corporate SQLite model, memberships, subscriptions, and active-company context. |
| 29 | [`29-corporate-checkout-billing-status.html`](./29-corporate-checkout-billing-status.html) | `verified` | 2026-06-10 | Simulated corporate checkout and enriched billing status while preserving individual subscriptions. |
| 30 | [`30-company-profile-management.html`](./30-company-profile-management.html) | `verified` | 2026-06-10 | Registered user profile, active company selector, and company admin management UI/API. |
| 31 | [`31-specialist-company-access.html`](./31-specialist-company-access.html) | `verified` | 2026-06-10 | Specialist access via company_id and removal of allowed_emails. |
| 32 | [`32-corporate-quota-fallback.html`](./32-corporate-quota-fallback.html) | `verified` | 2026-06-10 | Aggregated corporate quota with individual fallback. |
| 33 | [`33-admin-companies-specialist-assignment.html`](./33-admin-companies-specialist-assignment.html) | `verified` | 2026-06-10 | Ujimu admin company pages and specialist-company assignment. |
| 34 | [`34-corporate-specialist-management-api.html`](./34-corporate-specialist-management-api.html) | `verified` | 2026-06-11 | Corporate admin specialist-management API for prompt and source upload without ingestion. |
| 35 | [`35-corporate-specialist-management-ui.html`](./35-corporate-specialist-management-ui.html) | `verified` | 2026-06-11 | Corporate admin specialist-management UI for prompt, source upload, and source states. |
| 36 | [`36-copy-assistant-response-with-sources.html`](./36-copy-assistant-response-with-sources.html) | `verified` | 2026-06-11 | In-chat copy action for assistant responses including citations. |
| 37 | [`37-agent-session-audit-log-foundation.html`](./37-agent-session-audit-log-foundation.html) | `verified` | 2026-06-12 | Global human-readable agent session logs for initialization, conversion, and ingestion. |
| 38 | [`38-transactional-specialist-initialization.html`](./38-transactional-specialist-initialization.html) | `verified` | 2026-06-12 | Background transactional specialist initialization with agent-owned `AGENTS.md`/`wiki/` and backend rollback. |
| 39 | [`39-batch-ingestion-manifest-state.html`](./39-batch-ingestion-manifest-state.html) | `verified` | 2026-06-12 | Batch ingestion session, dual-channel manifest, backend validation, and enriched `ingest/state.json`. |
| 40 | [`40-state-driven-citations-minimal-chat-envelope.html`](./40-state-driven-citations-minimal-chat-envelope.html) | `verified` | 2026-06-12 | State-driven citation allowlist and minimal chat envelope with behaviour in specialist `AGENTS.md`. |
| 41 | [`41-admin-agent-workflow-progress-recovery.html`](./41-admin-agent-workflow-progress-recovery.html) | `verified` | 2026-06-12 | Admin workflow for initialization states, upload gating, logs, and recovery/retry. |
| 42 | [`42-chat-input-autogrow.html`](./42-chat-input-autogrow.html) | `verified` | 2026-06-16 | Chat input auto-grows up to five lines, then scrolls internally. |
| 43 | [`43-chat-copy-question-response-metrics.html`](./43-chat-copy-question-response-metrics.html) | `verified` | 2026-06-16 | Copy user questions and show duration/tokens for the latest completed response without persisting metrics. |
| 44 | [`44-agent-owned-conversion-ingestion.html`](./44-agent-owned-conversion-ingestion.html) | `verified` | 2026-06-27 | Ingestion agent owns `raw/ -> converted/ -> wiki/` using the updated `llm-wiki` contract. |
| 45 | [`45-llm-wiki-owned-specialist-agents.html`](./45-llm-wiki-owned-specialist-agents.html) | `verified` | 2026-08-21 | `llm-wiki` owns specialist scaffold; Ujimu supplies and validates consultation rules. |
| 46 | [`46-doubled-free-quotas.html`](./46-doubled-free-quotas.html) | `verified` | 2026-08-21 | Double anonymous and registered free-tier quotas. |
| 47 | [`47-configured-otp-channels.html`](./47-configured-otp-channels.html) | `verified` | 2026-08-21 | Enable SendGrid email and Twilio SMS only when configured. |
| 48 | [`48-launch-feature-flags.html`](./48-launch-feature-flags.html) | `verified` | 2026-08-21 | Hide and block subscription/company features behind default-off flags. |
| 49 | [`49-public-seo-identity.html`](./49-public-seo-identity.html) | `verified` | 2026-08-21 | Add immediate SSR identity, social previews, crawl policy, and launch assets. |
| 50 | [`50-specialist-editorial-seo.html`](./50-specialist-editorial-seo.html) | `verified` | 2026-08-21 | Add administrable editorial SEO fields per specialist. |
| 51 | [`51-public-specialist-pages.html`](./51-public-specialist-pages.html) | `verified` | 2026-08-21 | Render public specialist pages and a dynamic public sitemap. |
| 52 | [`52-measured-loading-performance.html`](./52-measured-loading-performance.html) | `verified` | 2026-08-21 | Measure and improve initial loading performance. |
| 53 | [`53-twilio-verify-sms-otp.html`](./53-twilio-verify-sms-otp.html) | `verified` | 2026-08-21 | Use one global OTP provider selector and Twilio Verify for SMS request and confirmation. |
| 54 | [`54-real-quota-admin-navigation.html`](./54-real-quota-admin-navigation.html) | `grilled` | — | Show real quota, attribute anonymous usage, and hide admin navigation from non-admins. |
| 55 | [`55-editable-profile-verified-contacts.html`](./55-editable-profile-verified-contacts.html) | `planned` | — | Edit display name and manage verified primary/secondary contacts safely. |

## Account usage, profile, and admin navigation extension

Status: `in-progress`

Approved originating decks:

- [`../brainstorm-account-usage-profile-admin-navigation.html`](../brainstorm-account-usage-profile-admin-navigation.html)
- [`../account-usage-profile-admin-navigation-architecture.html`](../account-usage-profile-admin-navigation-architecture.html)

Planned order:

1. Slice 54 establishes canonical quota/session state, anonymous-event attribution, and role-aware navigation.
2. Slice 55 adds the profile data model and verified-contact lifecycle after Slice 54 is fully green.

Slice 54 confirmed TDD seams:

1. `GET /api/auth/session?timezone=…` before and after quota consumption.
2. OTP, passkey, and development login for idempotent anonymous-event attribution.
3. `POST /api/chat` followed by session refresh for the visible count.
4. Drawer and admin shell rendering for anonymous, registered, and admin states.

## Twilio Verify OTP extension

Status: `verified`

Approved originating decks:

- [`../brainstorm-twilio-verify-otp.html`](../brainstorm-twilio-verify-otp.html)
- [`../twilio-verify-otp-architecture.html`](../twilio-verify-otp-architecture.html)

Confirmed TDD seams:

1. `GET /api/features` for provider capabilities.
2. `POST /api/auth/otp/request` for Verify submission and provider failures.
3. `POST /api/auth/otp/verify` for approval, rejection, expiry, malformed responses, and session creation.
4. The same OTP routes in `direct` mode for backwards compatibility.

Acceptance-test RED:

- `npm test -- tests/otp-provider-availability.acceptance.test.ts --reporter=verbose` — failed as expected because the selector still exposed direct channels and Verify requests returned 503 without calling the Verify API.

Implementation verification so far:

- Focused tests passed, followed by `npm test` (245 tests), `npm run typecheck`, `npm run build`, and `npm audit` with zero findings.
- Production was deployed at commit `971dcc8` with the existing Twilio Verify Service; `/api/features` exposes only `phone` and the real OTP request returned HTTP 200.
- The real SMS code was approved with zero failed attempts; the production challenge was consumed, the verified identity exists, and `/api/admin/session` returned HTTP 200 with `authenticated: true` and `admin: true`.

## SEO and performance launch extension

Status: `verified`

Approved originating decks:

- [`../brainstorm-seo-performance-launch.html`](../brainstorm-seo-performance-launch.html)
- [`../seo-performance-launch-architecture.html`](../seo-performance-launch-architecture.html)

Planned order:

1. Slice 49 fixes the already-public site's identity and social sharing immediately.
2. Slice 50 adds approved editorial metadata to specialist configuration and administration.
3. Slice 51 publishes SSR specialist pages and expands the sitemap safely.
4. Slice 52 measures production loading and keeps only demonstrated improvements.

## Slice 49 — Public SEO identity

Status: `verified`

Refinement decisions:

- Use Nuxt and Nitro native APIs without adding an SEO package.
- Render the approved title, description, canonical, Open Graph, Twitter Cards, language, and basic JSON-LD in server HTML.
- Create an original 1200 × 630 social image, favicon, Apple icon, and web manifest in the existing black, white, and Angola-yellow identity.
- Publish `robots.txt` and an initial home-only sitemap; specialist URLs arrive in Slice 51.
- Apply `noindex` headers to private, operational, and API routes.
- Treat the rendered HTTP response as the acceptance seam for browser and WhatsApp behaviour.

Grill decisions:

- Configure the public origin through `NUXT_PUBLIC_SITE_URL`, defaulting to the approved `https://ujimu.com`.
- Emit all launch metadata in the initial SSR HTML; no crawler may depend on hydration.
- Use a PNG social image with exact 1200 × 630 dimensions and absolute HTTPS URLs.
- Keep the initial sitemap home-only; later specialist URLs cannot leak into this slice.
- Mark every current non-home page plus `/api/**` as `noindex`; Slice 51 will explicitly admit public specialist routes.
- Use trusted static JSON-LD for `WebSite` and `Organization`, without ratings, legal claims, or generated content.
- Verify through HTTP with browser and WhatsApp user agents, then redeploy through the tested production script.

Acceptance-test RED:

- `npm test -- tests/public-seo-identity.acceptance.test.ts --reporter=verbose` — failed as expected because the SSR metadata, launch assets, crawl routes, and noindex headers were absent.

Implementation and verification:

- Added SSR title, description, robots policy, canonical, Open Graph, Twitter Cards, `pt-AO`, and trusted `WebSite`/`Organization` JSON-LD.
- Added the approved 1200 × 630 social PNG, SVG/PNG favicons, Apple icon, and manifest.
- Added home-only sitemap and robots routes plus `X-Robots-Tag` middleware for private and API routes.
- Added canonical-site configuration to container environment examples and operational checks to the runbook.
- Focused tests passed, followed by `npm test` (228 tests), `npm run typecheck`, `npm run build`, `npm audit`, and registry signature verification.
- Production was redeployed at commit `d304f52`; browser and raw WhatsApp-user-agent checks confirmed metadata in initial HTML, all assets returned 200, Gzip remained active, and the console stayed clean.

## Slice 50 — Specialist editorial SEO

Status: `verified`

Refinement decisions:

- Add an optional nested `seo` mapping to `specialist.yaml`: `title`, `description`, `introduction`, `topics`, `limitations`, and `call_to_action`.
- Keep existing specialist files valid without migration; empty editorial values remain absent when YAML is written.
- Resolve public title and description through fallback to existing `name` and `description`; do not invent fallback text for the other fields.
- Expose only normalized editorial text in public/admin payloads and never expose prompts or internal paths through the SEO object.
- Edit the fields on the existing admin specialist detail page; creation may use empty defaults and be completed after initialization.

Grill decisions:

- Limit title to 70 characters, description to 180, introduction to 1,200, limitations to 600, CTA to 160, and at most 12 unique topics of 100 characters each.
- Trim text, reject non-string values and over-limit content, and normalize missing fields to empty values without rewriting files on load.
- Serialize the `seo` mapping only when at least one editorial field is non-empty.
- Audit only `seo` as a changed field; never place editorial content itself in audit metadata.
- Preserve the current public specialist list contract while adding one `seo` object with safe title/description fallback.
- Treat editorial values as plain text; future pages must render them through Vue escaping rather than `v-html` or Markdown.

Acceptance-test RED:

- Focused specialist, admin API, and admin UI tests failed as expected because the normalized `seo` contract, YAML persistence, HTTP payloads, and editing controls were absent.

Implementation and verification:

- Added validated and normalized specialist SEO fields with safe public fallback and compact YAML persistence.
- Added partial SEO edits, safe audit-field reporting, admin/public payloads, shared UI types, and the six editing controls on the specialist detail page.
- Kept existing YAML valid and confirmed production did not rewrite the labour specialist automatically.
- Focused tests passed, followed by `npm test` (231 tests), `npm run typecheck`, `npm run build`, and `npm audit` with zero findings.
- Browser verification used an isolated development container: all controls rendered, a title edit persisted through PATCH 200, and the console remained clean.
- Production was redeployed at commit `9079c39`; the anonymous API returns title/description fallback while the production YAML remains unchanged.

## Slice 51 — Public specialist pages

Status: `verified`

Refinement decisions:

- Add SSR pages at `/especialidades/:id` backed by a dedicated anonymous public endpoint.
- Render approved editorial fields as plain text with title/description fallback; omit empty optional sections.
- Add specialist-specific title, description, canonical, Open Graph, and `WebPage` JSON-LD while retaining the global social image.
- Expand the sitemap from the anonymous specialist registry only and add a discoverable route from the consultation experience.
- Make the CTA return to `/?specialist=:id` and pre-select that specialist after the public list loads.
- Return 404 for missing, suspended, or company-restricted specialists without revealing why access failed.

Grill decisions:

- Use `GET /api/public/specialists/:id` as the only page-data seam and resolve it through `getPublicSpecialists()` with the default anonymous subject.
- Permit indexing only for `/` and `/especialidades/:id`; failed routes still return HTTP 404.
- Keep sitemap output to canonical HTTPS URLs without `lastmod` because no reliable editorial-update timestamp exists.
- XML-escape sitemap values even though specialist IDs are validated slugs.
- Render all editorial values through Vue interpolation; do not use `v-html` or Markdown.
- Use the global social image and the specialist title/description for page metadata; omit fabricated ratings, FAQs, source counts, and legal claims.
- Make the home-page query selection conditional on an actually available public specialist.

Acceptance-test RED:

- `npm test -- tests/public-specialist-pages.acceptance.test.ts --reporter=verbose` — failed as expected because the anonymous endpoint, SSR page, dynamic sitemap, index policy, and CTA selection were absent.

Implementation and verification:

- Added the anonymous-only specialist endpoint, SSR editorial page, specialist metadata/`WebPage` JSON-LD, dynamic sitemap, and index policy.
- Added a consultation CTA that returns to the chat and pre-selects only a currently available public specialist.
- Added direct HTTP coverage proving active public specialists return 200 while suspended, company-restricted, and missing IDs return the same 404.
- Focused tests passed, followed by `npm test` (235 tests), `npm run typecheck`, `npm run build`, and `npm audit` with zero findings.
- Production browser verification confirmed the page, canonical, 200 responses, clean console, CTA navigation, query pre-selection, and home link back to the specialist page.
- Production was redeployed at commit `f7e6319`; sitemap discovery and 404 failure paths were confirmed externally.

## Slice 52 — Measured loading performance

Status: `verified`

Production baseline:

- Chrome trace on `https://ujimu.com/`: LCP 262 ms, TTFB 170 ms, render delay 92 ms, CLS 0, no CrUX field data yet.
- Mobile Lighthouse: SEO 100, Best Practices 100, Accessibility 96.
- Initial request graph used HTTP/1.1 for the document, 13 script/style assets, and API calls; Chrome raised the Modern HTTP insight.
- The initial client flow requested development-auth and admin-session endpoints even though neither result changed the anonymous home UI.
- The manifest chain reached 686 ms but had no estimated FCP/LCP saving; the 6 ms render-blocking stylesheet also had zero estimated saving.

Refinement decisions:

- Keep the already-good rendering path; do not add SSR complexity or alter CSS based on zero-savings insights.
- Render `LazyAuthModal` only when authentication is opened, removing its initial feature/dev-auth work and chunk from the closed state.
- Remove the unused anonymous admin-session probe and the unused `adminAvailable` drawer prop.
- Enable HTTP/2 in the production Nginx TLS server and verify Chrome no longer reports static assets over HTTP/1.1.
- Re-run the same production trace and Lighthouse audit; keep changes only if Core Web Vitals do not regress and request/protocol evidence improves.

Grill decisions:

- Change both application shells to `LazyAuthModal v-if="authPanelOpen"`; authentication remains functionally identical once opened.
- Remove `adminAvailable` and shell-level `/api/admin/session` calls because the prop has no renderer and every admin page performs its own authorization request.
- Keep `/api/auth/session`, `/api/features`, `/api/specialists`, and visitor analytics because each still drives visible state or required measurement.
- Add `http2 on;` only to the existing Ujimu TLS server, validate Nginx before reload, and leave unrelated virtual hosts untouched.
- Reject the manifest and CSS changes suggested by the trace: both had zero estimated LCP/FCP savings.
- Compare the same unthrottled production trace; require HTTP/2 evidence, fewer initial API calls, LCP below 2.5 s, CLS at most 0.1, and no console regression.

Acceptance-test RED:

- `npm test -- tests/loading-performance.acceptance.test.ts --reporter=verbose` — failed as expected because both shells mounted the eager auth modal and requested the unused admin session.

Implementation and verification:

- Replaced eager shell authentication with conditional `LazyAuthModal` rendering and removed the unused shell-level admin-session request/prop.
- Enabled HTTP/2 on the existing Ujimu Nginx TLS server after a successful configuration test; ALPN negotiated `h2`.
- Focused tests passed, followed by `npm test` (237 tests), `npm run typecheck`, `npm run build`, and `npm audit` with zero findings.
- Production initial API calls fell from six to four; initial script requests fell from thirteen to eleven. The auth chunk and dev/features calls now load only when the login modal opens.
- A fresh isolated production trace removed the Modern HTTP insight and measured LCP 237 ms, TTFB 173 ms, render delay 65 ms, and CLS 0, compared with the 262/170/92/0 baseline. LCP stayed far inside the 2.5 s budget.
- Mobile Lighthouse remained SEO 100 and Best Practices 100; Accessibility remained 96 with the pre-existing contrast and label-name findings.
- Rejected attempts remain documented: manifest and render-blocking CSS changes were not made because Chrome estimated zero FCP/LCP saving; SSR complexity was not introduced because the baseline already met the target.
- Production was redeployed at commit `c0e2555`; an isolated browser confirmed four initial API calls, deferred auth loading on click, and a clean console.

## Progressive account launch extension

Status: `verified`

Approved originating decks:

- [`../brainstorm-progressive-account-launch.html`](../brainstorm-progressive-account-launch.html)
- [`../progressive-account-launch-architecture.html`](../progressive-account-launch-architecture.html)

Planned order:

1. Slice 46 doubles anonymous and registered quotas.
2. Slice 47 adds configured OTP channels and account-login availability.
3. Slice 48 adds default-off launch flags for subscriptions and companies.

## Slice 46 — Doubled free quotas

Status: `verified`

Refinement decisions:

- Change anonymous quotas from 5/day and 20/week to 10/day and 40/week.
- Change registered quotas from 20/day and 100/week to 40/day and 200/week.
- Preserve subscribed, company, and admin policies.
- Update visible quota copy without making the values configurable.

Grill decisions:

- Keep quota values as backend constants and preserve timezone windows and counting semantics.
- Test both policy values and the allow-then-deny boundary.
- Update static copy even where a later feature flag temporarily hides the page.

Acceptance-test RED:

- `npm test -- tests/quotas.acceptance.test.ts tests/ui-redesign-shell.acceptance.test.ts tests/billing-ui.acceptance.test.ts --reporter=verbose` — failed as expected because policy enforcement and visible copy still used the old limits.

Implementation and verification:

- Updated anonymous policy to 10/day and 40/week and registered policy to 40/day and 200/week.
- Updated chat shell, shared route chrome, and subscription copy.
- Focused tests passed, followed by `npm test` (212 tests), `npm run typecheck`, and `npm run build`.

## Slice 47 — Configured OTP channels

Status: `verified`

Refinement decisions:

- Send email OTP through SendGrid and SMS OTP through Twilio.
- Activate each channel independently only when its required environment variables are complete.
- Keep `UJIMU_SENDGRID_FROM_NAME` optional and use `Ujimu` when absent.
- Add a public capabilities endpoint for OTP channels and launch flags.
- Block new OTP/passkey login when no OTP channel is configured while preserving valid sessions and in-progress OTP verification.
- Use native `fetch` against fixed official HTTPS endpoints; add no SDK dependency.

Grill decisions:

- SendGrid requires API key and sender email; sender name defaults to `Ujimu`.
- Twilio requires Account SID, Auth Token, and sender phone number.
- Use a 10-second timeout, reject redirects, accept any 2xx, and never parse or expose provider error bodies.
- Fake delivery exposes both channels only outside production.
- Keep OTP verification available for already-issued challenges; block new OTP and passkey login when no channel is configured.

Official sources:

- https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
- https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
- https://nodejs.org/api/globals.html#fetch

Acceptance-test RED:

- `npm test -- tests/otp-provider-availability.acceptance.test.ts --reporter=verbose` — failed as expected because adapters, public capabilities, and channel-aware UI were absent.

Implementation and verification:

- Added configuration-aware SendGrid Mail Send and Twilio Messages adapters using native `fetch`, fixed HTTPS endpoints, 10-second timeouts, redirect rejection, and generic provider errors.
- Added `GET /api/features`, channel-level OTP request gating, and passkey login gating when no OTP channel exists.
- Updated chat, route chrome, profile, drawer, and auth modal to hide unavailable login paths and show only configured channels.
- Documented production environment variables and launch behaviour in the operations runbook.
- Focused tests passed, followed by `npm test` (220 tests), `npm run typecheck`, and `npm run build`.

## Slice 48 — Launch feature flags

Status: `verified`

Refinement decisions:

- Default `UJIMU_SUBSCRIPTIONS_ENABLED` and `UJIMU_COMPANIES_ENABLED` to false.
- Publish feature availability through the capabilities endpoint.
- Use Nuxt server middleware to block disabled page/API prefixes before route handlers.
- Hide links, calls to action, and company selectors when their feature is disabled.
- Preserve all billing/company code and data for later activation.

Grill decisions:

- Match exact route segments so unrelated paths are not blocked.
- When subscriptions are disabled, do not upgrade quota subjects or remove ads from free accounts.
- When companies are disabled, do not grant corporate quota or private-specialist access.
- Reject company assignment through admin specialist endpoints while disabled.
- Keep persisted subscriptions and companies dormant rather than deleting them.

Official source:

- https://nuxt.com/docs/4.x/directory-structure/server#server-middleware

Acceptance-test RED:

- `npm test -- tests/launch-feature-flags.acceptance.test.ts --reporter=verbose` — failed as expected because public flags, route middleware, dormant tier logic, and conditional UI were absent.

Implementation and verification:

- Added strict default-off launch flags and published them through `GET /api/features`.
- Added Nuxt server middleware that returns 404 for disabled subscription, billing, company, and company-admin route segments.
- Kept disabled subscription/company records dormant: no quota elevation, ad removal, corporate quota, active-company context, or private-specialist access.
- Hid subscription/company UI and blocked company assignment while disabled.
- Made readiness secrets conditional on enabled OTP/subscription capabilities.
- Fixed the anonymous header so absence of login no longer renders a placeholder account avatar.
- Focused tests passed, followed by `npm test` (225 tests), `npm run typecheck`, and `npm run build`.
- Browser verification passed on the test instance and a temporary production-mode anonymous container; disabled routes returned 404 and the console remained clean.

## Slice 45 — llm-wiki-owned specialist AGENTS.md

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-llm-wiki-owned-specialist-agents.html`](../brainstorm-llm-wiki-owned-specialist-agents.html)
- [`../llm-wiki-owned-specialist-agents-architecture.html`](../llm-wiki-owned-specialist-agents-architecture.html)

Refinement decisions:

- Make the initialization prompt explicitly invoke `llm-wiki` with the configured preset.
- Require `AGENTS.md` as the schema file produced by the skill.
- Supply the specialist persona and canonical Ujimu consultation rules in that same prompt.
- Preserve optional NDJSON citations and plain-text answers.

Grill decisions:

- Keep `sourceFile` as internal traceability metadata while forbidding user-facing physical or internal paths.
- Validate canonical required rules with simple text matching rather than a Markdown parser.
- Reuse `WIKI_INITIALIZATION_OUTPUT_MISSING` and the existing transactional rollback path.
- Do not migrate existing specialist workspaces or alter chat, ingestion, APIs, or global system prompts.

Acceptance-test plan:

- Update the public initialization-runner acceptance test to require explicit `llm-wiki` ownership, `AGENTS.md` schema selection, Ujimu consultation rules, and the unchanged optional NDJSON protocol.
- Prove that incomplete `AGENTS.md` files are rejected and a complete contract is accepted.
- Keep the transactional initialization fixture aligned with the strengthened contract.

Acceptance-test RED:

- `npm test -- tests/specialist-initialization-prompt.acceptance.test.ts tests/specialist-initialization.acceptance.test.ts --reporter=verbose` — failed as expected because the prompt did not explicitly delegate the scaffold to `llm-wiki` and validation accepted missing Ujimu rules.

Implementation:

- Updated the initialization prompt to invoke `llm-wiki`, select the configured preset, choose `AGENTS.md` as schema, and treat the pre-created empty `wiki/` directory as initialization mode.
- Added the canonical Ujimu consultation block with wiki-only grounding, insufficient-evidence handling, original-title/article citations, internal-path protection, `unslop`, optional NDJSON, and plain-text compatibility.
- Strengthened output validation to reject any missing mandatory consultation rule while preserving the existing error and rollback path.

Verification:

- Focused RED then GREEN cycle passed, 6 tests.
- `npm test` — passed, 212 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- Real Pi initialization smoke test — passed in a temporary workspace with the configured OpenRouter model; the generated files and consultation contract passed backend validation.

## Slice 44 — Agent-owned conversion and ingestion

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-agent-owned-conversion-ingestion.html`](../brainstorm-agent-owned-conversion-ingestion.html)
- [`../agent-owned-conversion-ingestion-architecture.html`](../agent-owned-conversion-ingestion-architecture.html)

Refinement decisions:

- Follow the updated `llm-wiki` invariant: `raw/ -> converted/ -> wiki/`.
- Make the normal ingestion job responsible for conversion and wiki ingestion in one agent session.
- Keep Ujimu validation at system boundaries: upload checks, sandbox policy, manifest shape, safe paths, hashes, wiki page existence, and citation metadata.
- Do not validate conversion fidelity, article extraction quality, or converted-source prose in Ujimu backend code.
- Keep the legacy conversion endpoint available for transition, but stop calling it from the background ingestion worker.

Grill decisions:

- Add `converted/` as a first-class specialist path and creation-time directory.
- Treat supported uploaded sources as pending for ingestion even when conversion is still needed.
- Use manifest v2 with `processed[]` entries that include conversion status and converted hashes.
- Only accept auto-ingest conversion statuses (`full`, `ocr-full`, `lossy`, `passthrough`) as successful processed entries; statuses requiring confirmation must be reported as failures.
- Restore pending state when a manifest is invalid.

Acceptance-test plan:

- Update ingestion prompt tests to assert the `converted/` sandbox and manifest v2 contract.
- Update batch-ingestion tests to create converted files, validate converted hashes/frontmatter, and enrich state from manifest v2.
- Update background-job tests to assert the legacy conversion runner is not called in the normal ingestion path.
- Update source-detection tests to assert direct Markdown and PDFs are pending for agent-owned conversion/ingestion.

Implementation:

- Added `paths.converted` to specialist runtime paths and create-specialist directory creation.
- Updated source detection so every supported raw source targets `converted/<raw-path>.md` and remains pending for ingestion.
- Updated Pi ingestion runner file policy and prompt to use the `llm-wiki` convert-before-ingest workflow.
- Added manifest v2 validation and state enrichment for conversion status, converted checksums, wiki pages, and citations.
- Stopped the background ingestion worker from invoking `runPendingConversions()` before ingestion.
- Updated operations docs, environment comments, and project instructions to reflect agent-owned conversion.

Verification:

- `npm test` — passed, 195 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — failed with upstream dependency advisories outside this slice.

## Slice 43 — Copy question and latest response metrics

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-chat-copy-and-response-metrics.html`](../brainstorm-chat-copy-and-response-metrics.html)
- [`../chat-copy-and-response-metrics-architecture.html`](../chat-copy-and-response-metrics-architecture.html)

Refinement decisions:

- Add copy support for user questions without changing edit, history, queueing, or response-copy behaviour.
- Measure duration in the client from question submission until the stream emits `done`.
- Keep response metrics in memory only; do not persist them in history or SQLite.
- Show metrics only on the most recent completed assistant response in the current session.
- Show token count only when the stream provides reliable usage metadata.

Grill decisions:

- Preserve the current `pages/index.vue` message structure instead of introducing a message-action component.
- Add an optional `metrics` stream event for token totals; old clients can ignore it.
- Treat client duration as the displayed duration because the product requirement includes streaming through response completion.
- Do not show metrics for failed or cancelled responses.

Acceptance-test plan:

- Extend clipboard tests to cover copying user questions and the presence of UI controls.
- Extend chat stream tests to cover optional token metrics from runner events.
- Extend UI workspace tests to assert latest-response metric state, formatting, and template rendering.

Acceptance-test RED:

- `npm test -- tests/chat-response-metrics.acceptance.test.ts tests/chat-response-copy.acceptance.test.ts tests/chat.acceptance.test.ts tests/ui-redesign-chat-workspace.acceptance.test.ts --reporter=verbose` — failed as expected because `utils/chat-metrics.ts`, copy-question UI, stream `metrics` events, and response-metric state were not implemented yet.

Implementation:

- Added `utils/chat-metrics.ts` for deterministic `3,2 s · 1 248 tokens` formatting and token omission when unavailable.
- Added optional `metrics` events to the chat runner/server stream contract and passed validated totals through before `done`.
- Taught the Pi chat runner to extract `usage.totalTokens` from final assistant messages when the SDK provides it.
- Added copy-question controls in the user message UI while preserving response-copy behaviour.
- Refined user-question actions so edit and copy sit below the question, use icon buttons with tooltips, and reveal on hover/focus.
- Added in-memory response metrics to `pages/index.vue`, measured from submit to `done`, and rendered only on the latest completed assistant response.

Verification:

- `npm test -- tests/chat-response-metrics.acceptance.test.ts tests/chat-response-copy.acceptance.test.ts tests/chat.acceptance.test.ts tests/ui-redesign-chat-workspace.acceptance.test.ts --reporter=verbose` — passed, including the hover-revealed icon-button guard for edit/copy question actions.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- Chrome DevTools check on `http://127.0.0.1:3000/` — passed: selected a specialist, sent a question, and observed `Copiar pergunta`, `Copiar resposta`, and a metric line such as `9,4 s · 2 819 tokens`; console only showed Nuxt development info logs.
- `npm test` — passed, 195 tests after the edit-question visibility regression guard was added.
- `npm audit --audit-level=high` — failed with upstream dependency advisories outside this slice.

## Slice 42 — Chat input auto-grow

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-chat-input-autogrow.html`](../brainstorm-chat-input-autogrow.html)
- [`../chat-input-autogrow-architecture.html`](../chat-input-autogrow-architecture.html)

Refinement decisions:

- Apply the behaviour to all chat users.
- Keep `Enter` as submit and `Shift+Enter` as newline.
- Reset the field to one row when the question is cleared through submit, editing cancellation, specialist selection, conversation opening, or new consultation.
- Limit the visible input to exactly five lines, then use internal scrolling.

Grill decisions:

- Preserve the existing composer and textarea instead of introducing a new component.
- Calculate the five-line limit from computed textarea styles so the cap follows the actual typography and padding.
- Watch `question` so both typed and programmatic changes resize the textarea.
- Do not change quotas, queueing, history, streaming, or backend chat behaviour.

Acceptance-test plan:

- Extended `tests/ui-redesign-chat-workspace.acceptance.test.ts` to assert the five-line max constant, textarea ref, resize watcher, style calculation, and CSS scroll fallback.
- Confirmed RED with `npm test -- tests/ui-redesign-chat-workspace.acceptance.test.ts --reporter=verbose`: failed because `chatInputMaxRows` and resize behaviour did not yet exist.

Implementation:

- Added a textarea ref, five-row constant, resize watcher, computed max-height helper, and initial mounted resize in `pages/index.vue`.
- Added the textarea `ref` binding while preserving `Enter` submit and `Shift+Enter` newline behaviour.
- Updated `.prompt-ta` in `assets/css/main.css` with a five-line max-height fallback and hidden overflow until scrolling is required.

Verification:

- `npm test -- tests/ui-redesign-chat-workspace.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- Chrome DevTools check on `http://127.0.0.1:3000/` — passed for DOM/style inspection: textarea exists with `rows=1`, computed max-height is five lines plus padding, and `overflow-y` starts hidden; console only showed Nuxt development info logs.
- `npm test` — passed, 195 tests, during Slice 43 follow-up verification on 2026-06-16.

## Agent-managed specialist wiki extension

Status: `verified`

Approved originating decks:

- [`../brainstorm-agent-managed-specialist-wiki.html`](../brainstorm-agent-managed-specialist-wiki.html)
- [`../agent-managed-specialist-wiki-architecture.html`](../agent-managed-specialist-wiki-architecture.html)

Planning decisions:

- Create specialists through a transactional background initialization job.
- Backend owns `specialist.yaml`, `raw/`, `ingest/state.json`, states, jobs, validation, and rollback.
- Agent initialization generates the specialist wiki instructions and seed files while the backend owns `specialist.yaml`, `raw/`, `ingest/state.json`, states, jobs, validation, and rollback.
- `system_prompt` is optional; substantive behaviour and citation discipline live in the specialist `AGENTS.md`.
- Admin may create a specialist without an initial source; upload is enabled only after wiki initialization.
- A specialist becomes chat-visible only after at least one source is ingested successfully.
- Ingestion runs as one batch session over pending raw sources; the agent converts them into `converted/` before ingesting into `wiki/`.
- Ingestion produces a dual-channel manifest: final structured output and `.ujimu/ingestion-manifest.json`.
- Backend validates the manifest before enriching `ingest/state.json`; `state.json` remains an operational index, not a second wiki.
- Citation allowlists come from backend-owned state, not directly from agent prose.
- Agent logs live under each specialist's local `logs/` directory using ISO-safe filenames for `initialization`, `conversion`, and `ingestion` sessions.
- Chat prompt injection is limited to the technical envelope: user question, selected specialist, citation allowlist, and event format.
- Before implementing Pi SDK event/log behaviour, consult the official Pi documentation and current SDK API.

Implemented order:

1. Slice 37 added the global human-readable agent session logging foundation.
2. Slice 38 added transactional specialist initialization and rollback.
3. Slice 39 added batch ingestion manifests and state enrichment.
4. Slice 40 moved chat citations to enriched state and minimized backend prompt injection.
5. Slice 41 exposed the workflow in admin UI/API with progress, upload gating, logs, and retry.

## Slice 37 — Agent session audit log foundation

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-agent-managed-specialist-wiki.html`](../brainstorm-agent-managed-specialist-wiki.html)
- [`../agent-managed-specialist-wiki-architecture.html`](../agent-managed-specialist-wiki-architecture.html)

Refinement decisions:

- Build the audit foundation before transactional initialization.
- Keep logs as simple global files under `<UJIMU_DATA_DIR>/logs/agents/`; do not add a database table or admin UI in this slice.
- Use a common logger module plus `createUjimuPiSession()` attachment so Pi initialization, conversion, and ingestion sessions inherit the foundation.
- Log complete assistant text and useful tool call/result payloads, with sensitive strings redacted and long text truncated.

Grill decisions:

- Use ISO-safe filenames: `YYYY-MM-DDTHH-mm-ss-SSSZ-[specialist_id]-[initialization|conversion|ingestion].log`.
- Redact sensitive strings such as email addresses, bearer/JWT tokens, API-key-like strings, and phone numbers.
- Redact sensitive object keys such as `apiKey`, `secret`, `token`, `password`, `cookie`, and `session`.
- Never write `thinking_delta` or `toolcall_delta` entries; they are noisy and do not help audit the final action.
- Record `tool_call` with tool arguments and `tool_result` with the final redacted result content.
- Chat sessions remain out of scope for this audit-log foundation.

Acceptance-test plan:

- Add `tests/agent-session-logs.acceptance.test.ts` to verify log path format, header content, complete assistant text, tool arguments/results, redaction, and noisy-delta suppression.
- Confirmed initial RED with `npm test -- tests/agent-session-logs.acceptance.test.ts --reporter=verbose` before `server/utils/agents/logs.ts` existed.
- Confirmed correction RED when the live logs still contained `text_delta`/`thinking_delta` noise and omitted tool arguments/results.

Implementation:

- Added `server/utils/agents/logs.ts` with `createAgentSessionLogger()`, path helpers, useful event formatting, redaction, truncation, and safe close handling.
- Added optional `agentLog` attachment to `server/utils/pi/session.ts`, based on Pi SDK `session.subscribe()` events.
- Attached logs to Pi-backed initialization, conversion, and ingestion sessions, closing them as `succeeded`, `failed`, or `aborted` as appropriate.
- Did not change `ingest/state.json`, chat behaviour, or admin UI.

Verification:

- `npm test -- tests/agent-session-logs.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 175 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 38 — Transactional specialist initialization

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-agent-managed-specialist-wiki.html`](../brainstorm-agent-managed-specialist-wiki.html)
- [`../agent-managed-specialist-wiki-architecture.html`](../agent-managed-specialist-wiki-architecture.html)

Refinement decisions:

- Keep `createSpecialist()` available as the internal filesystem utility for existing tests and admin/system setup.
- Change the admin creation endpoint to create specialists in `initializing` and return `202 Accepted` with both `specialist` and `job`.
- Add `specialist_initialization` to the recoverable background job system instead of creating a second job framework.
- Keep upload gating and rich admin progress UI for Slice 41; this slice exposes enough state/API for the workflow.

Grill decisions:

- `system_prompt` is optional; absent prompts normalize to an empty string and are omitted from YAML when empty.
- Supported statuses are now `initializing`, `awaiting_sources`, `ingesting`, `active`, `suspended`, and `failed`.
- Public specialist access only accepts `active`; newly created `initializing` and post-init `awaiting_sources` specialists stay hidden from chat selection.
- The initialization agent can write only within the initialization workspace; backend still owns `specialist.yaml`, `raw/`, `ingest/state.json`, jobs, states, validation, and rollback.
- Successful initialization requires root `AGENTS.md`, plus `wiki/index.md` and `wiki/log.md`.
- Initialization failure rolls back the specialist directory and leaves the background job failed for audit/retry visibility.

Acceptance-test plan:

- Add `tests/specialist-initialization.acceptance.test.ts` for admin creation, job completion, rollback, optional prompt loading, and public hiding of non-active states.
- Update admin/access/db tests for the new `202 + job` contract and background job migration.
- Confirmed RED before implementation: new statuses, optional prompt, and initialization job behaviour were missing.

Implementation:

- Added `server/utils/specialists/initialization.ts` with a mockable runner contract, Pi SDK runner, timeout handling, and minimum-output validation.
- Added `specialist_initialization` jobs to `server/utils/jobs/background.ts`.
- Added database migration `0013_specialist_initialization_jobs` and widened fresh `background_jobs` creation.
- Updated specialist schema for optional prompt and new statuses.
- Updated admin specialist creation to enqueue initialization, return `202`, record audit metadata, schedule the worker, and rollback if enqueueing fails.
- Updated public access to hide every non-`active` specialist.

Verification:

- `npm test -- tests/specialist-initialization.acceptance.test.ts tests/db.test.ts tests/admin.acceptance.test.ts --reporter=verbose` — passed.
- `npm test` — passed, 166 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 39 — Batch ingestion manifest state

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-agent-managed-specialist-wiki.html`](../brainstorm-agent-managed-specialist-wiki.html)
- [`../agent-managed-specialist-wiki-architecture.html`](../agent-managed-specialist-wiki-architecture.html)

Refinement decisions:

- Add batch ingestion via `ingestSources()` while keeping `ingestSource()` for legacy tests and compatible runners.
- The backend validates the manifest before committing enriched state.
- Enriched state lives under each source's `ingestion` field: `wiki_pages`, `citations`, `warnings`, and `manifest_validated_at`.
- Invalid manifests restore the prior pending source records rather than leaving sources failed or processing.

Grill decisions:

- A valid manifest must mention every pending source exactly once, either in `ingested` or `failed`.
- Manifest `specialist_id` must match the selected specialist.
- Successful entries must reference existing relative Markdown pages under `wiki/`.
- Successful citations must use `source_file: raw/<raw_path>` and non-empty article references.
- A first successful ingestion publishes non-suspended/non-active specialists as `active`.
- Partial failures mark only the failed sources failed; successful sources remain ingested and publish/keep the specialist active.

Acceptance-test plan:

- Add `tests/batch-ingestion-manifest.acceptance.test.ts` for one-call batch ingestion, enriched state, first-success publication, partial failures, and invalid-manifest rollback.
- Confirmed RED before implementation: batch callback was not invoked, manifests were ignored, and invalid manifests did not reject safely.

Implementation:

- Added ingestion manifest types to `server/utils/ingestion/types.ts`.
- Added Pi SDK batch ingestion in `server/utils/ingestion/pi-runner.ts`, including `.ujimu/ingestion-manifest.json` and final-output comparison.
- Updated `server/utils/ingestion/run.ts` to prefer `ingestSources()`, validate manifests, enrich state, support partial failures, publish successful first ingestions, and preserve legacy single-source fallback.
- Kept backend ownership of `ingest/state.json`; the agent only returns/writes the manifest.

Verification:

- `npm test -- tests/batch-ingestion-manifest.acceptance.test.ts tests/ingestion.acceptance.test.ts tests/pi-agent-pipeline.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 169 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 40 — State-driven citations and minimal chat envelope

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-agent-managed-specialist-wiki.html`](../brainstorm-agent-managed-specialist-wiki.html)
- [`../agent-managed-specialist-wiki-architecture.html`](../agent-managed-specialist-wiki-architecture.html)

Refinement decisions:

- Citation evidence comes only from validated `ingestion.citations` in backend-owned `ingest/state.json`.
- Legacy source metadata (`title`, `article_refs`) no longer creates chat allowlist evidence by itself.
- The chat prompt no longer injects specialist `system_prompt`; specialist behaviour belongs in the specialist `AGENTS.md` generated during initialization.
- The backend prompt contains only technical envelope data: selected specialist identity, user question, conversation context, backend citation allowlist, and NDJSON protocol.

Grill decisions:

- Ingested sources without validated citation metadata are treated as unusable for grounded chat.
- Existing backend citation filtering remains the final authority for live runner events and non-streaming runner results.
- The safe insufficient-context path remains the behaviour when no validated citation evidence exists.
- The Pi chat system prompt override keeps only technical runtime constraints and no broad editorial answer rules.

Acceptance-test plan:

- Add `tests/state-driven-citations.acceptance.test.ts` for enriched-state citations, rejection of sources without validated citations, and minimal chat prompt contents.
- Update chat/history/analytics fixtures so successful grounded chat tests seed validated citation metadata.
- Confirmed RED before implementation: citation evidence still used legacy source metadata and the prompt still injected `system_prompt` plus broad rules.

Implementation:

- Updated `server/utils/chat/citations.ts` and `server/utils/chat/context.ts` to build citation evidence from `ingestion.citations`.
- Updated `server/utils/chat/pi-runner.ts` to remove specialist prompt injection and broad response rules from the chat prompt.
- Kept backend filtering of emitted citations against the exact allowlist.
- Updated tests that require grounded chat to seed validated citations.

Verification:

- `npm test -- tests/state-driven-citations.acceptance.test.ts tests/chat.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 172 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 41 — Admin agent workflow progress and recovery

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-agent-managed-specialist-wiki.html`](../brainstorm-agent-managed-specialist-wiki.html)
- [`../agent-managed-specialist-wiki-architecture.html`](../agent-managed-specialist-wiki-architecture.html)

Refinement decisions:

- Upload gating must be enforced in backend endpoints, not only in UI.
- Raw source upload is allowed for `awaiting_sources`, `active`, and `suspended` specialists.
- Raw source upload is blocked for `initializing`, `ingesting`, and `failed` specialists.
- Admin specialist payloads include summarized global agent logs for initialization, conversion, and ingestion sessions.
- This slice exposes log metadata only; it does not add public or admin download/read endpoints for log file contents.

Grill decisions:

- The retry control reuses the existing ingestion run endpoint instead of adding a new retry endpoint.
- Existing wiki content is not deleted by retrying failed sources.
- Company-admin raw uploads follow the same readiness gate as global admin uploads.
- The UI should explain why upload is blocked while initialization/ingestion/failure states are active.

Acceptance-test plan:

- Add `tests/admin-agent-workflow.acceptance.test.ts`.
- Confirm RED before implementation: upload was not state-gated, admin payload lacked `agent_logs`, and the detail page lacked the new workflow markers.
- Verify upload rejection leaves raw storage untouched before initialization completes.
- Verify global log filenames are parsed into task and start timestamp metadata.

Implementation:

- Added `listAgentSessionLogs()` to `server/utils/agents/logs.ts`.
- Added `agent_logs` to admin specialist payloads in `server/utils/admin/specialists.ts`.
- Added `canUploadRawSources()` and enforced it in admin and company raw upload endpoints.
- Updated `pages/admin/specialists/[id].vue` with workflow status badges/messages, upload gating, agent log list, and retry button.
- Updated `utils/admin-ui.ts` with `AgentSessionLogSummary` and `agent_logs` payload typing.

Verification:

- `npm test -- tests/admin-agent-workflow.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 175 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Chat message actions extension

Status: `verified`

Approved originating decks:

- [`../brainstorm-chat-message-actions.html`](../brainstorm-chat-message-actions.html)
- [`../chat-message-actions-architecture.html`](../chat-message-actions-architecture.html)

Planning decisions:

- Implement only copying assistant responses to the clipboard with sources.
- Do not implement copying questions, regenerating answers, deleting messages, or sharing conversations in this slice.
- Keep the change client-side in the existing chat page.
- Do not alter chat API contracts, history, analytics, quotas, or database schema.
- Use user-facing UI copy in European Portuguese using pre-1990 orthography.

Planned order:

1. Slice 36 adds the assistant-response copy action with sources.

## Slice 36 — Copy assistant response with sources

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-chat-message-actions.html`](../brainstorm-chat-message-actions.html)
- [`../chat-message-actions-architecture.html`](../chat-message-actions-architecture.html)

Refinement decisions:

- Solve only the user need to reuse an assistant response together with its citations.
- Keep the action as a small per-response button in the existing chat message rendering.
- Copy plain text with lightweight structure rather than HTML or a custom export format.
- Avoid a new component or server contract for this single-page behaviour.

Grill decisions:

- Add a small pure formatter/helper for direct test coverage.
- Render the button only for assistant messages whose status is `done`.
- Do not render copy controls for user questions, streaming assistant messages, or error assistant messages.
- Use `navigator.clipboard.writeText`; if unavailable or rejected, show a short per-message error rather than adding a hidden fallback.

Acceptance-test plan:

- Add `tests/chat-response-copy.acceptance.test.ts` to verify copied text formatting, Clipboard API boundary, and response-only UI controls.
- Confirmed RED with `npm test -- tests/chat-response-copy.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added `utils/chat-copy.ts` with clipboard response formatting and a Clipboard API boundary helper.
- Added per-message `Copiar resposta` controls for completed assistant messages in `pages/index.vue`.
- Added success and error feedback next to the copied assistant message.
- Kept the change client-side and did not alter chat APIs, history, analytics, quotas, or database schema.

Verification:

- `npm test -- tests/chat-response-copy.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 141 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Corporate specialist source management extension

Status: `planned`

Approved originating decks:

- [`../brainstorm-corporate-specialist-source-management.html`](../brainstorm-corporate-specialist-source-management.html)
- [`../corporate-specialist-source-management-architecture.html`](../corporate-specialist-source-management-architecture.html)

Planning decisions:

- Admins corporativos may manage only specialists already associated with their company through `company_id`.
- Admins corporativos cannot create, delete, suspend, reassign, convert, ingest, or trigger background jobs for specialists.
- The only specialist field editable by a company admin is `system_prompt` for the specialist itself.
- Corporate source uploads use the same logical replacement rule as Ujimu admin uploads.
- The corporate page route is `/companies/:id/specialists`.
- No additional external governing context applies beyond repository instructions and approved specs.

Planned order:

1. Slice 34 adds the corporate specialist-management API and auditing.
2. Slice 35 adds the corporate specialist-management UI.

## Slice 35 — Corporate specialist management UI

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-specialist-source-management.html`](../brainstorm-corporate-specialist-source-management.html)
- [`../corporate-specialist-source-management-architecture.html`](../corporate-specialist-source-management-architecture.html)

Refinement and grill decisions:

- Add a single route at `/companies/:id/specialists` instead of nested per-specialist routes.
- Use local page state to select a specialist from the list and show its management panel.
- Add the page link from `/companies/:id` only for company admins.
- The page calls only `/api/companies/:id/specialists/**`, never `/api/admin/**`.
- Include prompt editor, file upload, and source-state list.
- Exclude conversion/ingestion buttons, specialist creation, specialist deletion, company reassignment, and status editing.

Acceptance-test plan:

- Add `tests/company-specialists-ui.acceptance.test.ts` to verify page route, company detail link, allowed API hooks, and absent forbidden operations.
- Confirmed RED with `npm test -- tests/company-specialists-ui.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added `/companies/:id/specialists` page with company specialist list, selected-specialist management, prompt editor, source upload, and source-state display.
- Added admin-only link from `/companies/:id` to the specialist management page.
- Kept the page on corporate endpoints only and omitted conversion, ingestion, creation, deletion, and reassignment controls.

Verification:

- `npm test -- tests/company-specialists-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 138 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 34 — Corporate specialist management API

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-specialist-source-management.html`](../brainstorm-corporate-specialist-source-management.html)
- [`../corporate-specialist-source-management-architecture.html`](../corporate-specialist-source-management-architecture.html)

Refinement and grill decisions:

- Keep the API separate from `/api/admin`; company endpoints authorize through `requireCompanyAdmin()`.
- A manageable specialist is one whose `company_id` equals the requested company id.
- Wrong-company, public, or missing specialists return `404` to avoid revealing resources.
- `PATCH` accepts exactly `system_prompt`; immutable or unrelated fields return `400`.
- Upload reuses existing raw-source validation and logical replacement, then refreshes source state only.
- Upload must not trigger conversion, ingestion, or background jobs.
- Add a small `company_admin_audit_events` table for corporate prompt/upload actions with sanitized metadata.

Acceptance-test plan:

- Add `tests/company-specialists.acceptance.test.ts` for list/detail authorization, prompt edit validation, upload/replacement, state refresh, and no job creation.
- Update `tests/db.test.ts` for the new audit migration.
- Confirmed RED with `npm test -- tests/company-specialists.acceptance.test.ts tests/db.test.ts --reporter=verbose`.

Implementation:

- Added migration `0012_company_admin_audit_events`.
- Added company specialist helper functions for company-scoped payloads, authorization, prompt update, and sanitized audit writes.
- Added corporate specialist list, detail, prompt patch, and raw upload endpoints.
- Reused existing upload validation, raw-source replacement, and source-state scan without triggering conversion or ingestion jobs.

Verification:

- `npm test -- tests/company-specialists.acceptance.test.ts tests/db.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 137 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 33 — Admin company operations and specialist assignment

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Acceptance tests:

- Updated `tests/admin.acceptance.test.ts` to cover admin company list/detail, non-admin denial, specialist-company assignment, and audit metadata hygiene.
- Updated `tests/admin-ui.acceptance.test.ts` to cover `/admin/companies`, `/admin/companies/:id`, admin dashboard navigation, and specialist company selectors.
- Confirmed RED before implementation with `npm test -- tests/admin.acceptance.test.ts tests/admin-ui.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added admin company payload helpers and `GET /api/admin/companies` plus `GET /api/admin/companies/:id`.
- Added `/admin/companies` and `/admin/companies/[id]` pages with subscription, members/admins, quota, and assigned-specialist visibility.
- Replaced raw company-id inputs in admin specialist create/detail forms with company selectors populated from the admin company API.
- Added `specialist_company_assignment_updated` audit action when `company_id` changes.

Verification:

- `npm test -- tests/admin.acceptance.test.ts tests/admin-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 136 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 32 — Corporate quota fallback

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Acceptance tests:

- Updated `tests/quotas.acceptance.test.ts` to cover `company` policies, corporate-first consumption, individual fallback, denied corporate attempts, and company quota usage reporting.
- Updated `tests/company-management.acceptance.test.ts` to cover `/api/companies/:id/quota` access for company admins only.
- Updated `tests/company-ui.acceptance.test.ts` to cover company-detail quota display.
- Confirmed RED before implementation with `npm test -- tests/quotas.acceptance.test.ts tests/company-management.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added quota subject type `company`, with weekly limit equal to active seats times the subscribed weekly limit.
- Added SQLite migration `0011_company_quota_subject` to permit corporate request-event subjects.
- Added corporate-first quota evaluation with individual fallback and wired it into chat when a registered user has an active company context.
- Added `GET /api/companies/:id/quota` for company admins and displayed weekly use on the company detail page.

Verification:

- `npm test -- tests/quotas.acceptance.test.ts tests/company-management.acceptance.test.ts tests/company-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 134 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 31 — Specialist company access

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Acceptance tests:

- Updated `tests/specialist-access.acceptance.test.ts` to cover company-scoped specialist creation/editing, public payload privacy, active-company access, and missing-company rejection.
- Updated `tests/admin-ui.acceptance.test.ts` to expect the admin create defaults to use `company_id` rather than `allowed_emails`.
- Confirmed RED before implementation with `npm test -- tests/specialist-access.acceptance.test.ts tests/admin-ui.acceptance.test.ts --reporter=verbose`.

Implementation:

- Replaced specialist `allowed_emails` with optional `company_id` in schema, manager serialization, admin payloads, and admin UI forms.
- Enforced private specialist access through the user's active company only; inactive/expired company context does not unlock access.
- Validated admin-assigned `company_id` values against the corporate company repository.

Verification:

- `npm test -- tests/specialist-access.acceptance.test.ts tests/admin-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 132 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 30 — Company profile and management

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Refinement and grill decisions:

- Build authenticated APIs first and keep UI simple but functional.
- The profile endpoint follows the session pattern and can return `authenticated:false`.
- Company endpoints require authentication; company edits and member replacement require company admin role.
- Member list updates are full replacements validated server-side.
- Detailed quota display remains deferred to Slice 32.
- Drawer exposes authenticated navigation to profile and companies.

Acceptance tests:

- Added `tests/company-management.acceptance.test.ts` for profile, active company set/clear, company list/detail, admin-only company edit, and admin-only member management.
- Added `tests/company-ui.acceptance.test.ts` for profile/company pages and drawer navigation.
- Confirmed RED before implementation with `npm test -- tests/company-management.acceptance.test.ts tests/company-ui.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added `GET /api/account/profile` and `PUT /api/account/active-company`.
- Added `GET /api/companies`, `GET/PATCH /api/companies/:id`, and `PUT /api/companies/:id/members`.
- Added company HTTP authorization helpers.
- Added `/account/profile`, `/companies`, and `/companies/[id]` pages.
- Added authenticated drawer links for profile and companies.

Verification:

- `npm test -- tests/company-management.acceptance.test.ts tests/company-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 132 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 29 — Corporate checkout and billing status

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Refinement and grill decisions:

- Corporate checkout is simulated and does not ask for provider/method in this launch scope.
- The system still records a confirmed mock payment in `billing_payments` for traceability.
- The buyer must have a verified email and is always included as a company admin.
- Reusing the same NIF renews the same company subscription.
- Top-level individual subscription fields remain intact; corporate state is exposed under a new `corporate` block.
- Active corporate subscription hides ads but does not yet change quota resolution; quota is handled in Slice 32.

Acceptance tests:

- Updated `tests/billing.acceptance.test.ts` to cover anonymous rejection, simulated confirmed corporate checkout, buyer/admin/member memberships, billing status corporate enrichment, NIF-based renewal, and member-limit rejection.
- Confirmed RED before implementation with `npm test -- tests/billing.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added `POST /api/billing/corporate/checkout`.
- Added `createCorporateBillingCheckout()` with confirmed mock payment recording, company create/update by NIF, corporate subscription renewal, and membership replacement.
- Enriched `getBillingStatus()` with corporate companies and active-company billing metadata.
- Added company repository support for lookup/update by NIF and nested transaction control when replacing memberships.

Verification:

- `npm test -- tests/billing.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 130 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 28 — Corporate data model and active-company context

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Refinement and grill decisions:

- Use UUID as the technical company id; NIF remains business data.
- Store memberships by normalized email and link `user_id` when a verified identity already exists.
- Admin role wins when an email appears as both admin and member.
- Require at least one company admin.
- Validate membership capacity from the company's corporate subscription seats: `seats + floor(seats * 0.10)`.
- Persist the user's active company server-side and allow clearing it back to individual context.

Acceptance tests:

- Added `tests/companies.acceptance.test.ts` for company creation, corporate subscription seats, normalized memberships, existing user links, user-company listing, active company set/clear, capacity rejection, and invalid active-company rejection.
- Updated `tests/db.test.ts` to require `0010_corporate_accounts` migration.
- Confirmed RED before implementation with `npm test -- tests/db.test.ts tests/companies.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added `0010_corporate_accounts` migration for `companies`, `corporate_subscriptions`, `company_memberships`, and `user_company_contexts`.
- Added `server/utils/companies/repository.ts` with company/subscription/membership/context operations and validation errors.

Verification:

- `npm test -- tests/db.test.ts tests/companies.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 129 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 27 — Automatic conversion inside ingestion worker

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-admin-source-ingestion-access.html`](../brainstorm-admin-source-ingestion-access.html)
- [`../admin-source-ingestion-access-architecture.html`](../admin-source-ingestion-access-architecture.html)

Refinement and grill decisions:

- Keep a single `specialist_ingestion` job type and let the worker orchestrate conversion followed by ingestion.
- Reuse the existing conversion runner and existing ingestion runner instead of creating a second pipeline implementation.
- Preserve `conversion` and `ingestion` substate in `ingest/state.json` for admin/debug visibility.
- Keep the manual conversion endpoint for compatibility, but the UI remains free of manual conversion action.
- Never mark a source ingested unless actual `wiki/*.md` output exists.

Acceptance tests:

- Added `tests/admin.acceptance.test.ts` coverage proving that a recoverable ingestion job converts a non-Markdown source with a fake conversion runner and then ingests the generated Markdown with a fake ingestion runner.
- Confirmed RED before implementation with `npm test -- tests/admin.acceptance.test.ts --reporter=verbose`.

Implementation:

- Extended `runDueBackgroundJobs` with `piConversionEnabled` and `conversionRunner` options.
- The `specialist_ingestion` worker now runs `runPendingConversions()` before `runPendingIngestion()`.
- Scheduled runtime jobs pass both conversion and ingestion feature flags.

Verification:

- `npm test -- tests/admin.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 127 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Corporate accounts implementation plan

Originating brainstorm and architecture:

- [`../brainstorm-corporate-accounts.html`](../brainstorm-corporate-accounts.html)
- [`../corporate-accounts-architecture.html`](../corporate-accounts-architecture.html)

Approved product and architecture decisions:

- Individual subscriptions remain available.
- Corporate subscriptions cost `35,000.00 AOA` per quarter per subscribed user.
- Corporate payment is simulated and activates immediately in this launch scope.
- A company has NIF, name, phone, and address.
- The purchaser becomes a company administrator.
- A company has one renewable corporate subscription.
- Users may belong to multiple companies, but can select only one active company at a time.
- With an active company, users see public specialists and specialists assigned to that company.
- Corporate quota is aggregated by active company and is consumed before individual quota; individual fallback does not unlock expired corporate specialist access.
- Specialist privacy moves from `allowed_emails` to `company_id`; `allowed_emails` is removed.
- Only Ujimu admins assign a specialist to a company.

Planned slices:

- Slice 28: data model and active-company context foundation.
- Slice 29: simulated corporate checkout and billing status.
- Slice 30: profile and company management surfaces.
- Slice 31: specialist company access and `allowed_emails` removal.
- Slice 32: corporate quota with individual fallback.
- Slice 33: Ujimu admin company operations and specialist assignment.

Sequencing note:

- Slice 26 is now verified; Slice 28 may safely add the next SQLite migration after `0009_background_jobs`.

## Slice 26 — Recoverable ingestion jobs

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-admin-source-ingestion-access.html`](../brainstorm-admin-source-ingestion-access.html)
- [`../admin-source-ingestion-access-architecture.html`](../admin-source-ingestion-access-architecture.html)

Refinement and grill decisions:

- When Pi ingestion is enabled, the admin ingestion endpoint enqueues a recoverable SQLite job and returns `202` immediately.
- When Pi ingestion is disabled, keep the existing operational gate: return the disabled response and leave sources pending rather than enqueueing a doomed job.
- Use one active job per specialist to prevent duplicate work from repeated clicks.
- In tests, do not auto-run real Pi from the endpoint; call the worker explicitly with a fake runner.
- Store sanitized job errors and attempts in SQLite.

Acceptance tests:

- Updated `tests/db.test.ts` to require migration `0009_background_jobs`.
- Updated `tests/admin.acceptance.test.ts` to require `202` job enqueueing, persisted queued state, and worker completion with a fake ingestion runner.
- Updated `tests/admin-ui.acceptance.test.ts` to require “Ingestão agendada” feedback.
- Confirmed RED before implementation with `npm test -- tests/admin.acceptance.test.ts tests/admin-ui.acceptance.test.ts tests/db.test.ts --reporter=verbose`.

Implementation:

- Added SQLite-backed `background_jobs` migration with a unique active ingestion job per specialist.
- Added `server/utils/jobs/background.ts` with enqueueing, locking, stale-running recovery, worker execution, sanitized failures, startup recovery scheduling, and test-safe in-process scheduling.
- Changed the admin ingestion endpoint to return `202` and a queued `specialist_ingestion` job when Pi ingestion is enabled while preserving the disabled `409` behaviour.
- Updated admin UI types and feedback to show “Ingestão agendada”.

Impact assessment for corporate slices:

- Slice 28 will touch `server/utils/db.ts` next, but only to add a later migration after `0009_background_jobs`.
- Corporate slices do not depend on ingestion jobs and should not alter job states, ingestion endpoint semantics, or source processing.
- Shared future surfaces are limited to admin navigation/audit and must be handled in their own slices.

Verification:

- `npm test -- tests/admin.acceptance.test.ts tests/admin-ui.acceptance.test.ts tests/db.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 126 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 25 — Source upload, replacement, and refresh

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-admin-source-ingestion-access.html`](../brainstorm-admin-source-ingestion-access.html)
- [`../admin-source-ingestion-access-architecture.html`](../admin-source-ingestion-access-architecture.html)

Refinement and grill decisions:

- Treat the normalized upload filename as the logical source identity.
- A second upload with the same logical name replaces the source instead of returning a duplicate conflict.
- Replacement is marked internally with previous checksum and replacement timestamp; old versions are not listed in the UI.
- Upload/replacement immediately refreshes the source state so the administrator sees pending status without a separate redetect action.
- The detail UI uses “Actualizar estado” and no longer exposes “Recarregar fontes” or “Executar conversão”.

Acceptance tests:

- Updated `tests/admin.acceptance.test.ts` so duplicate logical source upload now replaces the source, returns `replaced: true`, exposes current source state, stores previous checksum/replacement timestamp internally, and audits `raw_source_replaced` without source content.
- Updated `tests/admin-ui.acceptance.test.ts` so the detail page exposes “Actualizar estado” and no longer exposes “Recarregar fontes” or “Executar conversão”.
- Confirmed RED with `npm test -- tests/admin.acceptance.test.ts tests/admin-ui.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added explicit replacement support to raw source storage while preserving duplicate rejection for callers that do not opt in.
- Marked replaced sources in `ingest/state.json` with `previous_checksum` and `replaced_at` when checksums change.
- Updated the admin raw upload endpoint to allow replacement, refresh the affected source state immediately, return the current source, and audit upload vs replacement separately.
- Removed manual conversion action from the specialist detail UI and renamed source refresh to “Actualizar estado”.

Verification:

- `npm test -- tests/admin.acceptance.test.ts tests/admin-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm test -- tests/ingestion.acceptance.test.ts tests/security-ops.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed after adding `raw_source_replaced` to audit action types.
- `npm test` — passed, 125 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 24 — Specialist availability and access control

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-admin-source-ingestion-access.html`](../brainstorm-admin-source-ingestion-access.html)
- [`../admin-source-ingestion-access-architecture.html`](../admin-source-ingestion-access-architecture.html)

Refinement and grill decisions:

- Keep availability/access metadata in `specialist.yaml` so a specialist remains a directory-backed configuration unit.
- Treat missing `status` as `active` and missing/empty `allowed_emails` as public access for backwards compatibility.
- Compare allowlisted emails against verified email identities only; phone identities do not grant email-restricted specialist access.
- Hide inaccessible specialists from public listing and return not-found-style errors from chat/history to avoid revealing restricted specialists.
- Admin endpoints continue to see all specialists so suspended or restricted specialists can be repaired.

Acceptance tests:

- Added `tests/specialist-access.acceptance.test.ts` for legacy YAML defaults, admin create/edit of `status` and `allowed_emails`, public filtering, chat blocking, history blocking, and verified-email allowlist behaviour.
- Confirmed RED before implementation with `npm test -- tests/specialist-access.acceptance.test.ts --reporter=verbose`.

Implementation:

- Added optional `status` and `allowed_emails` to specialist YAML with active/public defaults.
- Added a central server-side specialist access utility and applied it to public specialist listing, chat, and history get/list endpoints.
- Exposed status and allowed emails only in admin payloads and UI, not public payloads.
- Updated admin create/edit pages and endpoints to manage suspension and one-email-per-line allowlists.

Verification:

- `npm test -- tests/specialist-access.acceptance.test.ts --reporter=verbose` — passed.
- `npm test -- tests/admin.acceptance.test.ts tests/chat.acceptance.test.ts tests/history.acceptance.test.ts --reporter=verbose` — passed.
- `npm test -- tests/admin-ui.acceptance.test.ts --reporter=verbose` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 125 tests.
- `npm run build` — passed with existing warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 23 — Development-only allowlisted login

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-dev-auth-login.html`](../brainstorm-dev-auth-login.html)
- [`../dev-auth-login-architecture.html`](../dev-auth-login-architecture.html)

Refinement and grill decisions:

- Add explicit `UJIMU_DEV_AUTH_ENABLED=true` plus comma-separated `UJIMU_DEV_USER_CONTACTS`; do not infer enablement from a non-empty contacts list alone.
- Reject the dev-login POST path whenever `NODE_ENV=production`, even when all dev variables are present.
- Keep admin authorization unchanged: dev-login only authenticates a user; `UJIMU_ADMIN_CONTACTS` still decides admin access.
- Reuse the existing `users`, `user_identities`, and `ujimu_session` cookie model; do not add passwords, roles, tables, or production credentials.
- Dev sessions must not be marked as OTP sessions and must not satisfy recent-OTP checks for passkey registration.
- The browser may learn whether dev auth is enabled, but never receives the allowlisted contacts.

Acceptance tests:

- Added `tests/dev-auth.acceptance.test.ts` for dev-login success, phone normalization, admin allowlist interaction, non-allowlisted rejection, disabled mode, and production blocking.
- Added `tests/dev-auth-ui.acceptance.test.ts` for the shared auth modal dev-login surface.
- Ran `npm test -- tests/dev-auth.acceptance.test.ts tests/dev-auth-ui.acceptance.test.ts --reporter=verbose`; it failed red because the endpoint and UI do not yet exist.

Implementation:

- Added `server/utils/auth/dev-login.ts` plus `GET`/`POST` `/api/auth/dev-login` endpoints.
- Added the shared `AuthModal.vue` development login panel, visible only when the dev-login status endpoint is enabled.
- Documented `UJIMU_DEV_AUTH_ENABLED` and `UJIMU_DEV_USER_CONTACTS` in `.env.sample`.
- Ran `npm audit fix` to resolve critical audit findings in development dependencies, updating `package-lock.json`.

Verification:

- `npm test` — 31 files, 117 tests.
- `npm run typecheck`.
- `npm run build`.
- `npm audit --audit-level=high` — 0 vulnerabilities.
- Browser DevTools QA with `UJIMU_DEV_AUTH_ENABLED=true` and `UJIMU_DEV_USER_CONTACTS=dev@example.test`: modal displayed the dev-login panel, dev contact authenticated, drawer showed the authenticated contact, admin navigation appeared only because the same contact was in `UJIMU_ADMIN_CONTACTS`, and `/admin` loaded successfully.

## UI redesign planned slices

Status: `planned`

Approved originating decks:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Planning decisions:

- Zafir slide decks for this project must be written in European Portuguese using pre-1990 orthography.
- Treat the UI redesign as a whole-product reformulation, but implement it as sequential verified slices.
- Use Nuxt UI broadly and validate official Nuxt UI documentation before implementing framework-specific patterns.
- Use Nuxt UI chat components where they fit, with a visual adapter from Ujimu's current chat message model to the expected chat-message shape.
- Keep the chat backend, grounding, citations, quotas, billing rules, authentication methods, ingestion, and admin authorization semantics unchanged unless a later slice explicitly approves a narrow interface change.
- Navigation should use an on-demand drawer on desktop and mobile, not a persistent sidebar.
- Conversation history belongs in the drawer, not a dedicated page for this redesign.
- Subscriptions move to `/subscription`.
- Admin management moves to subpages under `/admin`.
- Ads appear in the message stream after a randomized interval of 5–10 assistant responses for eligible users.

Planned order:

1. Slice 16 establishes the shared shell and drawer foundation. — verified 2026-05-21.
2. Slice 17 redesigns the public chat workspace and specialist prompt, including the bottom-anchored two-row Gemini-style prompt correction. — verified 2026-05-21.
3. Slice 18 moves history and authentication to on-demand drawer/modal flows. — verified 2026-05-21.
4. Slice 19 moves subscription management to `/subscription`. — verified 2026-05-21.
5. Slice 20 inserts ads into the chat stream without obstructing citations. — verified 2026-05-21.
6. Slice 21 restructures admin specialist/source management into subpages. — verified 2026-05-21.
7. Slice 22 completes admin analytics/ops pages and cross-surface UI polish. — verified 2026-05-21.

## Slice 22 — Admin analytics and operations polish

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Refinement and grill decisions:

- Move visitor counts, content-gap candidates, recent questions, and candidate review actions from `/admin` to `/admin/analytics`.
- Add `/admin/ops` for admin-only readiness checks using the existing `/api/admin/ops/readyz` endpoint.
- Keep `/admin` as a lightweight index with navigation cards for specialists, analytics, and operations.
- Preserve existing analytics, readiness, authorization, audit, and operations API semantics; do not create new metrics or endpoints.
- Treat analytics as product/editorial signals only; it must not become an answer-grounding source.
- Display readiness using safe check names, booleans, and counts only; do not expose secrets, paths, or environment values.

Implementation sources checked:

- Nuxt 4 pages directory and file-based routing documentation: `https://nuxt.com/docs/4.x/guide/directory-structure/pages`
- Nuxt 4 routing documentation: `https://nuxt.com/docs/4.x/getting-started/routing`
- Nuxt UI component documentation for Button and Badge: `https://ui.nuxt.com/components/button`, `https://ui.nuxt.com/components/badge`

Implemented files:

- `pages/admin/index.vue`
- `pages/admin/analytics.vue`
- `pages/admin/ops.vue`
- `utils/admin-ui.ts`
- `tests/admin-ui.acceptance.test.ts`
- `docs/specs/slices/22-admin-analytics-ops-polish.html`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/admin-ui.acceptance.test.ts --reporter=verbose` — failed before implementation, then passed.
- `npm test` — passed, 111 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Chrome DevTools browser check — passed on port 3100; `/admin`, `/admin/analytics`, and `/admin/ops` rendered the expected route-specific unauthenticated/admin-blocking surfaces and console output had only Nuxt development info logs.

## Slice 21 — Admin routing specialists and sources

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Refinement and grill decisions:

- Keep `/admin` as a lightweight administrative entry and non-redesigned operational summary until the analytics/ops polish slice.
- Move specialist listing and creation to `/admin/specialists`.
- Move specialist editing, source upload, source reload, conversion, ingestion, and deletion to `/admin/specialists/[id]`.
- Preserve all existing admin API endpoints, server-side authorization, audit events, specialist model, and Pi pipeline semantics.
- Show source pipeline states as clear textual badges and continue to use structured API error messages without exposing secrets.
- Keep non-admin and unauthenticated access messages on every admin route.

Implementation sources checked:

- Nuxt 4 pages directory and file-based routing documentation: `https://nuxt.com/docs/4.x/guide/directory-structure/pages`
- Nuxt 4 routing documentation: `https://nuxt.com/docs/4.x/getting-started/routing`
- Nuxt UI component documentation for Button, Input, Textarea, and Badge: `https://ui.nuxt.com/components/button`, `https://ui.nuxt.com/components/input`, `https://ui.nuxt.com/components/textarea`, `https://ui.nuxt.com/components/badge`

Implemented files:

- `pages/admin/index.vue`
- `pages/admin/specialists/index.vue`
- `pages/admin/specialists/[id].vue`
- `utils/admin-ui.ts`
- `tests/admin-ui.acceptance.test.ts`
- `docs/specs/slices/21-admin-routing-specialists-sources.html`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/admin-ui.acceptance.test.ts --reporter=verbose` — failed before implementation, then passed.
- `npm test` — passed, 110 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Chrome DevTools browser check — passed on port 3100; `/admin`, `/admin/specialists`, and `/admin/specialists/demo` rendered the expected route-specific surfaces, dynamic detail routing worked, and console output had only Nuxt development info logs.

## Slice 20 — Inline ads chat polish

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Refinement and grill decisions:

- Replace permanent side advertising panels with inert inline advertisement cards in the chat stream.
- Schedule advertisements only after completed assistant responses, using a randomized interval between 5 and 10 assistant responses.
- Keep user messages, streaming assistant messages, and error assistant messages out of the advertisement counter.
- Continue to use the existing billing status ad visibility flag; subscribed or otherwise ad-free users do not receive inline ad stream items.
- Keep citations inside assistant message cards and never inside advertising cards.
- Preserve backend chat, grounding, citation, quota, billing, authentication, ingestion, and admin semantics.

Implemented files:

- `pages/index.vue`
- `utils/inline-ads.ts`
- `tests/inline-ads.acceptance.test.ts`
- `tests/ui-redesign-inline-ads.acceptance.test.ts`
- `tests/billing-ui.acceptance.test.ts`
- `tests/ui-redesign-subscription-page.acceptance.test.ts`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/inline-ads.acceptance.test.ts tests/ui-redesign-inline-ads.acceptance.test.ts` — failed before implementation, then passed.
- `npm test` — passed, 109 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Chrome DevTools browser check — passed on port 3100; chat rendered without permanent ad side panels, `.ad-panel`/`.ads-section` were absent, and console output had only Nuxt development info logs.

## Slice 19 — Subscription page billing UI

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Refinement and grill decisions:

- Create `/subscription` as the only permanent billing management surface for the current redesign.
- Keep live payments out of scope; use the existing mock checkout endpoints and provider/method validation.
- Add the subscription route to `AppDrawer.vue` now that the route exists.
- Extract OTP/passkey login into `AuthModal.vue` so chat and subscription can both request authentication on demand.
- Remove permanent subscription and checkout controls from the chat page while keeping ad visibility and a compact expiry warning.
- Preserve backend billing, quotas, auth, webhook, and ad-visibility semantics.

Implemented files:

- `components/AppDrawer.vue`
- `components/AuthModal.vue`
- `pages/index.vue`
- `pages/subscription.vue`
- `tests/billing-ui.acceptance.test.ts`
- `tests/chat-ui.acceptance.test.ts`
- `tests/passkeys-ui.acceptance.test.ts`
- `tests/ui-redesign-history-auth-drawer.acceptance.test.ts`
- `tests/ui-redesign-shell.acceptance.test.ts`
- `tests/ui-redesign-subscription-page.acceptance.test.ts`
- `docs/specs/slices/19-subscription-page-billing-ui.html`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/ui-redesign-subscription-page.acceptance.test.ts tests/billing-ui.acceptance.test.ts` — failed before implementation, then passed.
- `npm test` — passed, 104 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Chrome DevTools browser check — passed on port 3100; subscription page, drawer link, chat billing removal, and on-demand auth modal were verified with a clean console except Nuxt development info logs.

## Slice 18 — History/auth drawer

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Refinement and grill decisions:

- Keep conversation history in the shared drawer, not in a permanent side panel or a dedicated history page.
- Add a reusable history slot to `AppDrawer.vue` and provide the current page history UI through that slot.
- Keep the existing history endpoints, conversation ownership, resume/delete behavior, and edit/replace semantics unchanged.
- Move OTP/passkey login into an on-demand `UModal` opened from the drawer.
- Keep account-security and admin entry points in the drawer, not in the chat side panel.
- Keep the chat side panel limited to subscription and advertising until their later slices.
- Move focus into the drawer when it opens so browser accessibility checks do not report hidden focused descendants.

Implemented files:

- `components/AppDrawer.vue`
- `pages/index.vue`
- `tests/ui-redesign-history-auth-drawer.acceptance.test.ts`
- `tests/chat-ui.acceptance.test.ts`
- `tests/passkeys-ui.acceptance.test.ts`
- `docs/specs/slices/18-history-auth-drawer.html`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/ui-redesign-history-auth-drawer.acceptance.test.ts` — failed before implementation, then passed.
- `npm test` — passed, 101 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Chrome DevTools browser check — passed on port 3100; the drawer shows history/login affordances, login opens as a modal, focus moves into the drawer, and the console has no errors or unexpected warnings.

## Slice 17 — Chat workspace with Nuxt UI

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Refinement and grill decisions:

- Use `UChatMessages`, `UChatMessage`, `UChatPrompt`, and `UChatPromptSubmit` for the public chat surface.
- Keep Ujimu's existing chat backend and message model; adapt current `ChatMessage.text` into Nuxt UI `parts` for rendering.
- Put the specialist selector on the top-right line inside a bottom-anchored Gemini-style rounded prompt composer with `USelect`, without a visible form-style label.
- Changing specialist still starts a new consultation by clearing messages, queue, active conversation, and editing state.
- The empty chat message area shows selected specialist name and description, or asks the user to choose a specialist.
- Keep authentication, history, billing, and advertising in auxiliary panels until their own slices.
- Remove the old hero block in this slice.

Implemented files:

- `pages/index.vue`
- `tests/ui-redesign-chat-workspace.acceptance.test.ts`
- `tests/nuxt-ui.test.ts`
- `docs/specs/slices/17-chat-workspace-nuxt-ui.html`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/ui-redesign-chat-workspace.acceptance.test.ts` — failed before implementation, then passed.
- `npm test` — passed, 99 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Chrome DevTools browser check — passed on port 3100; the prompt appears as a bottom-anchored two-row Gemini-style composer, the specialist selector is on the top-right line and not disabled just because no specialist is selected, and the console has no errors.

## Slice 16 — UI shell and drawer foundation

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-ui-redesign.html`](../brainstorm-ui-redesign.html)
- [`../ui-redesign-architecture.html`](../ui-redesign-architecture.html)

Locked decisions:

- The drawer shows only links to routes that already exist in this slice.
- Future-route placeholders such as `/subscription` and admin subpages are excluded until their own slices.
- Mobile uses a narrow drawer.
- Desktop uses a wider navigation-panel style drawer.
- Desktop users may pin the drawer, but it is closed by default to preserve the on-demand navigation direction.
- Only the drawer is extracted into a reusable component in this slice; the full shell remains in `pages/index.vue` for now.

Implemented files:

- `components/AppDrawer.vue`
- `pages/index.vue`
- `tests/ui-redesign-shell.acceptance.test.ts`
- `docs/specs/slices/16-ui-shell-drawer-foundation.html`
- `docs/specs/slices/STATUS.md`

Verification completed:

- `npm test -- tests/ui-redesign-shell.acceptance.test.ts` — failed before implementation, then passed.
- `npm test` — passed, 96 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.

## Slice 15 — Podman container deployment

Status: `verified`

Originating brainstorm and architecture:

- [`../brainstorm-container-deployment.html`](../brainstorm-container-deployment.html)
- [`../container-deployment-architecture.html`](../container-deployment-architecture.html)

Initial direction:

- Build one Dockerfile-compatible image for both production and test Podman containers.
- Create and run as internal Unix user/group `ujimu:ujimu` with home `/home/ujimu`.
- Install Gemini CLI in the image with `npm install -g @google/gemini-cli`.
- Default runtime timezone to `Africa/Luanda` through `TZ`, while allowing ENV override.
- Use in-container persistent mount points `/home/ujimu/.pi` and `/home/ujimu/.local/share/ujimu`.
- Map production host storage to `/srv/ujimu/prod/pi` and `/srv/ujimu/prod/data`.
- Map test host storage to `/srv/ujimu/test/pi` and `/srv/ujimu/test/data`.
- Use one Podman network named `ujimu`.
- Use `ujimu-prod` on host port `3000` and `ujimu-test` on host port `3001`.
- Add lifecycle scripts under `scripts/container/`: `build.sh`, `create.sh`, `deploy.sh`, `redeploy.sh`, and `remove.sh`.
- Add env examples under `config/container/prod.env.example` and `config/container/test.env.example`; real env files and secrets remain outside Git.
- Test profile must use the existing in-code mock/no-op provider paths for auth, payments, and communication.
- CI/CD, reverse proxy, TLS, DNS, certificates, new provider implementations, and committed real secrets are excluded.

Acceptance conditions:

- The image builds and can run the Nuxt production server as `ujimu:ujimu`.
- `gemini` is available on `PATH` inside the image.
- Scripts select the correct names, ports, env examples, network, and volume mappings for both `prod` and `test`.
- Redeploy replaces the container without deleting host Pi or Ujimu data directories.
- Test profile does not require or configure real external auth, payment, or communication provider secrets.
- Documentation describes manual deploy, redeploy, persistence, and known CI/CD deferral.

Implemented files:

- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `scripts/container/build.sh`
- `scripts/container/create.sh`
- `scripts/container/deploy.sh`
- `scripts/container/redeploy.sh`
- `scripts/container/remove.sh`
- `scripts/container/lib.sh`
- `config/container/prod.env.example`
- `config/container/test.env.example`
- `docs/operations.md`
- `tests/container-deployment.acceptance.test.ts`

Verification plan:

- `npm test` passed, including `tests/container-deployment.acceptance.test.ts`.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `scripts/container/build.sh` passed under Podman and produced `localhost/ujimu:latest`.
- Container smoke checks passed: `gemini --version` returned `0.42.0`; `/healthz` returned `{ "ok": true, "service": "ujimu" }`.
- Real Gemini/API conversion smoke tests were not run because they require external credentials.

Refinement and grill decisions:

- Use `node:26-trixie-slim` as the Dockerfile base.
- Use a multi-stage Dockerfile: build with `npm ci` and `npm run build`, then copy only Nuxt/Nitro `.output` plus required runtime config into the final image.
- Do not copy full `node_modules` into the final image unless smoke testing proves it necessary.
- Container listens on internal `HOST=0.0.0.0` and `PORT=3000`; profile scripts vary only host port mapping.
- Real env files default to `config/container/prod.env` and `config/container/test.env`, are gitignored, and can be overridden with `UJIMU_ENV_FILE`.
- Lifecycle scripts create missing host directories with `mkdir -p` but never delete persistent data.
- Default image tag is `localhost/ujimu:latest`, overridable with `UJIMU_IMAGE`.
- `create.sh` fails if the target container already exists; `redeploy.sh` owns replacement.
- `deploy.sh` creates the container if missing, otherwise restarts it; structural config changes require `redeploy.sh`.
- `redeploy.sh` builds, stops/removes any existing target container, recreates it, starts it, and never deletes persistent directories.
- `remove.sh` removes only the target container, not images, networks, env files, or persistent directories.
- Dockerfile includes a Node-based `HEALTHCHECK` against `/healthz`.
- Add `.dockerignore` that excludes build output, local dependencies, logs, env files, and real secrets while keeping versioned Pi config resources available.
- Runtime image installs only `ca-certificates` and `coreutils`; healthcheck uses Node instead of curl/wget.
- `test.env.example` uses `NODE_ENV=development` and `UJIMU_AUTH_FAKE_DELIVERY_ENABLED=true` to activate existing fake OTP delivery.
- Use `UJIMU_CONFIG_DIR=/home/ujimu/.config/ujimu` for mutable configuration and `UJIMU_PI_BUNDLE_DIR=/app/config/pi` for bundled Pi resources in env examples.
- Both prod and test env examples enable `UJIMU_PI_CONVERSION_ENABLED=true`, `UJIMU_PI_INGESTION_ENABLED=true`, and `UJIMU_PI_CHAT_ENABLED=true`.
- `prod.env.example` highlights required secrets; lifecycle scripts do not validate secret completeness.

## Slice 14 — PDF to Markdown Gemini tool

Status: `verified`

Originating brainstorm:

- [`../pdf-to-markdown-tool-brainstorming.html`](../pdf-to-markdown-tool-brainstorming.html)

Initial direction:

- Treat this feature as not governed or affected by legislation for the Zafir law-material workflow.
- Defer a broad architecture/design revisit and use the existing project architecture as the implementation baseline.
- Add a project-local Bash script named `pdf_to_markdown.sh` that calls the Gemini CLI in the form `gemini -y -p "<conversion instructions and final filename>" file.pdf`.
- Expose the script only to the conversion agent when it processes PDF sources; it must not be available to ingestion, consultation, or generic Pi agents.
- Make the script capture and normalize Gemini output, then write the final Markdown file itself instead of relying on Gemini to write directly to disk.
- Restrict accepted PDFs to the current specialist `raw/` directory.
- Use an initial Gemini CLI timeout of 10 minutes per PDF.
- Reuse the existing conversion pipeline Markdown-size validation instead of adding a second size limit inside the script.
- Overwrite an existing target Markdown file only as part of pipeline reprocessing, keeping conversion idempotent.
- Instruct Gemini to return only Markdown on stdout; the script writes the final file.
- Keep non-PDF source formats on the existing conversion-agent path without using this tool.
- Name the Pi tool exposed to the conversion agent exactly `pdf_to_markdown`.
- Ensure Pi session creation supports task-scoped extra tools and injects `pdf_to_markdown` only for `task === "conversion"`; ingestion and chat remain file-tool-only.
- For PDF sources, make the conversion prompt require the agent to call `pdf_to_markdown` and then stop; non-PDF prompts keep the current behavior.
- If `pdf_to_markdown` fails, fail the PDF conversion immediately without attempting manual file-tool conversion.
- Use a specific `GEMINI_CLI_UNAVAILABLE` conversion error when `gemini` is not installed or is not available on `PATH`.
- Require operational and manual-smoke-test checks for both `gemini` availability and `GEMINI_API_KEY` being set.
- Use `GEMINI_API_KEY_MISSING` when `GEMINI_API_KEY` is absent; detect it before invoking the CLI.
- Validate `GEMINI_API_KEY` in both the Pi extension and the Bash script: the extension gives structured tool errors, while the script stays safe for direct manual/smoke-test execution.
- Have the script write stable, prefixed error messages to `stderr` such as `GEMINI_API_KEY_MISSING: ...`; the Pi extension parses the prefix and returns structured errors.
- Normalize a single outer Markdown fence such as ```markdown ... ``` when it wraps the whole Gemini response; preserve legitimate internal fences.
- Invoke Gemini with the PDF as the final argument in the form `gemini -y -p "<instructions>" raw/file.pdf`.
- Apply the 10-minute timeout with `timeout 600s`; if `timeout` is unavailable, fail with `TIMEOUT_COMMAND_UNAVAILABLE` rather than running without a limit.
- Do not add a macOS/coreutils operational dependency: macOS is development-only and production is guaranteed to run in containers that must provide `timeout`.
- Use `GEMINI_CLI_AUTH_FAILED` for Gemini CLI authentication/configuration failures and `GEMINI_CONVERSION_FAILED` for other Gemini conversion failures.
- Write Markdown through a temporary file and atomic rename to avoid partial `.pdf.md` artefacts.
- Use a Bash `trap` to remove temporary files on failure/interruption, except after successful atomic rename.
- Before atomic rename, validate that Gemini output contains at least 20 non-whitespace characters; maximum-size validation remains in the existing pipeline.
- Accept only relative PDF paths beginning with `raw/`; reject absolute paths and paths outside `raw/`.
- Accept only inputs whose path ends in `.pdf`, case-insensitive, before invoking Gemini.
- Validate with `realpath` that both the source PDF and target `.pdf.md` remain inside the current specialist `raw/` directory; reject `..`, symlink escapes, and any normalized path outside `raw/`.
- Require the resolved input PDF to exist and be a regular file before invoking Gemini.
- Use a single `INVALID_PDF_INPUT` code for invalid input validation failures such as paths outside `raw/`, non-PDF input, missing files, or non-regular files; the message carries the detail.
- Assume the script runs with `cwd` equal to the specialist root and accept only the relative PDF path as input.
- Return only structured metadata from the Pi tool (`status`, `markdownPath`, `bytes`) and never the full generated Markdown content.
- Have the Bash script print success JSON on `stdout` with `status`, `markdownPath`, and `bytes`; the Pi extension validates/normalizes that JSON before returning it to the agent.
- Treat invalid script success JSON as `PDF_TOOL_INVALID_OUTPUT` in the Pi extension.
- Avoid logging or returning the full Gemini prompt, full stdout, or generated Markdown content; only short metadata/errors are exposed.
- Treat `GEMINI_API_KEY` as a sensitive secret and sanitize returned errors, captured stdout/stderr, and logs so the key is never exposed.
- Document that `GEMINI_API_KEY` must live only in environment variables or a secret manager, never in `config/ujimu-pi-agent/settings.json`, prompts, or versioned files.
- Include the final expected output path in the Gemini prompt while explicitly instructing Gemini not to write files and to return only Markdown on stdout.
- Keep the conversion Pi agent in the flow; the runner only makes the tool available to the conversion session and the prompt requires using it for PDFs.
- Use fake `gemini` and `timeout` binaries on `PATH` for automated acceptance tests; real Gemini is reserved for a documented operational/manual smoke test.
- Document a manual smoke test that requires real `gemini` on `PATH`, real `timeout` in the production/container environment, and `GEMINI_API_KEY` set.
- Add scope tests confirming `pdf_to_markdown` is only available to `conversion` sessions and never to `ingestion` or `chat` sessions.
- Add sanitization tests confirming a fake `GEMINI_API_KEY` never appears in returned errors or tool results.
- Preserve the deterministic output convention by appending `.md` to the exact source path: `raw/file.pdf` → `raw/file.pdf.md`, and `raw/Documento.PDF` → `raw/Documento.PDF.md`.
- Document `gemini` as an operational dependency before implementation is considered complete.

Likely implementation zones:

- `config/ujimu-pi-agent/tools/pdf_to_markdown.sh`
- `config/ujimu-pi-agent/extensions/pdf-to-markdown-tool.ts`
- `docs/operations.md` and/or developer-facing documentation
- Acceptance tests that put fake `gemini` and `timeout` commands on `PATH` and verify command shape, prompt content, output naming, atomic write behavior, failure handling, timeout invocation, and task-scoped tool availability

Success conditions to refine before implementation:

- The Pi tool accepts a valid PDF path inside the current specialist `raw/` directory and computes the expected target by appending `.md` to the exact source path, preserving case.
- The Gemini CLI command includes faithful-conversion instructions and the deterministic output filename.
- The script writes the final `.pdf.md` file after capturing and validating Gemini output.
- Gemini CLI execution respects an initial 10-minute timeout per PDF.
- Markdown size validation uses the existing pipeline limit rather than a duplicate script-specific limit.
- Existing target Markdown files are overwritten during pipeline reprocessing rather than treated as a hard failure.
- Gemini is instructed to return only Markdown on stdout and not to write files directly.
- PDF sources require the conversion agent to use `pdf_to_markdown`; non-PDF sources continue through the current conversion-agent behavior.
- Failed `pdf_to_markdown` execution causes immediate conversion failure without manual PDF conversion fallback.
- Missing Gemini CLI execution reports `GEMINI_CLI_UNAVAILABLE` and does not report a successful conversion.
- Operation and documented manual smoke testing verify `gemini` is installed and `GEMINI_API_KEY` is set.
- Missing `GEMINI_API_KEY` reports `GEMINI_API_KEY_MISSING` before any CLI invocation.
- Both the Pi extension and Bash script validate `GEMINI_API_KEY`.
- Script errors use stable `stderr` prefixes that the Pi extension maps into structured tool errors.
- Script normalization removes only a single whole-response outer Markdown fence and preserves internal fences.
- Acceptance tests verify Gemini is invoked as `gemini -y -p "<instructions>" raw/file.pdf`, with the PDF as the final argument.
- Timeout is enforced through `timeout 600s`; missing `timeout` reports `TIMEOUT_COMMAND_UNAVAILABLE`.
- Documentation does not require macOS coreutils for operation; production container requirements include `timeout`.
- Gemini CLI authentication/configuration failures report `GEMINI_CLI_AUTH_FAILED`.
- Other failing Gemini CLI execution reports `GEMINI_CONVERSION_FAILED` and does not report a successful conversion.
- The final Markdown target is produced via temporary file plus atomic rename after basic output validation.
- Temporary files are cleaned up on script failure/interruption.
- Basic script validation rejects output with fewer than 20 non-whitespace characters before rename.
- The tool rejects absolute paths and paths outside `raw/`.
- The tool rejects non-PDF inputs with case-insensitive `.pdf` extension validation before any Gemini call.
- The tool rejects `..`, symlink escapes, and any `realpath` resolution outside the current specialist `raw/` directory.
- The tool rejects missing inputs and inputs that are not regular files before any Gemini call.
- Invalid PDF input failures report `INVALID_PDF_INPUT` with a short explanatory message.
- The script interface does not accept a specialist root argument; it derives context from `cwd`.
- Tool results include conversion metadata only and do not expose full generated Markdown content.
- On success, script `stdout` is structured JSON with `status`, `markdownPath`, and `bytes`, and the extension validates it.
- Invalid script success JSON reports `PDF_TOOL_INVALID_OUTPUT`.
- Logs/results do not include full prompt, full stdout, or generated Markdown content.
- Returned errors, captured stdout/stderr, and logs do not expose `GEMINI_API_KEY`.
- Operations documentation warns not to put `GEMINI_API_KEY` in `config/ujimu-pi-agent/settings.json`, prompts, or versioned files.
- Gemini prompt includes the final Markdown filename, but direct file writing by Gemini is forbidden.
- The conversion runner does not bypass the Pi agent for PDFs; the agent calls the tool.
- Automated tests do not invoke real Gemini credentials or services.
- Automated tests use fake `timeout` so local macOS development does not require GNU coreutils.
- Manual smoke test documentation covers real Gemini execution with `GEMINI_API_KEY` set.
- Automated tests verify the conversion-agent tool is named `pdf_to_markdown`.
- Automated tests verify task-scoped tool isolation for conversion, ingestion, and chat sessions.
- Automated tests verify `GEMINI_API_KEY` redaction from errors/results.
- The new Gemini CLI dependency is documented for setup, authentication, and operational troubleshooting.

Explicit exclusions:

- Automatic ingestion after conversion.
- First-party OCR guarantees for scanned PDFs.
- Arbitrary shell command execution.
- Exposing the tool to ingestion, consultation, or generic Pi sessions.
- Broad rewrite of the existing Pi conversion/ingestion pipeline.

Verification status:

- `npm test -- tests/pdf-to-markdown-gemini-tool.acceptance.test.ts` — passed, 5 tests.
- `npm test` — passed, 85 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

Manual smoke status:

- Real Gemini CLI smoke test not run; it is documented in `docs/operations.md` and intentionally requires `gemini`, `timeout`, `GEMINI_API_KEY`, and external service access.

## Slice 13 — Three Pi agent pipeline

Status: `verified`

As-built correction (2026-06-11): Ujimu separates mutable Pi configuration under `<UJIMU_CONFIG_DIR>` from versioned Pi bundle resources under `<UJIMU_PI_BUNDLE_DIR>`.

Idea-refined direction:

- Split the Pi-backed source and answer flow into three distinct Pi SDK sessions: conversion, ingestion, and consultation.
- Treat the feature as not governed by legislation for the purposes of the Zafir law-material workflow.
- Defer a broad architecture/design revisit; keep the existing Nuxt, SQLite, specialist directory, and Pi SDK architecture as the base for this slice.
- Store original uploads under the specialist `raw/` directory, but ensure ingestion operates only on Markdown sources.
- Convert original PDF, TXT, DOCX, HTML/HTM, CSV, and XLSX uploads into generated Markdown files before ingestion.
- Preserve the original file extension in generated Markdown names by appending `.md` to the raw relative path: `lei.pdf` becomes `lei.pdf.md`, `lei.docx` becomes `lei.docx.md`, `lei.csv` becomes `lei.csv.md`, and so on.
- Treat generated Markdown as a derived artefact that may be overwritten whenever the original file changes.
- Skip conversion when the original checksum has not changed and the generated Markdown file already exists.
- Store direct admin Markdown uploads as already-normalized originals by renaming `lei.md` to `lei.original.md` on upload.
- Reject a direct Markdown upload when the target `raw/<name>.original.md` already exists.
- Keep traceability from original raw upload to generated/normalized Markdown source, then to wiki pages and user-facing citations.
- Add Ujimu-owned Pi configuration under `config/ujimu-pi-agent/` so Ujimu does not depend on a developer's global Pi setup or collide with the Pi CLI's reserved project `.pi/` directory.
- Version `config/ujimu-pi-agent/settings.json`, `config/ujimu-pi-agent/models.json`, `config/ujimu-pi-agent/auth.json.sample`, and agent skills/prompts, but never commit `config/ujimu-pi-agent/auth.json`.
- Use the `config/ujimu-pi-agent` default model for consultation.
- Allow conversion and ingestion to override provider/model through environment variables; when absent, they fall back to the project-local default.
- Do not add new Pi tools in this slice. Agent skills are instructions, not capabilities.
- Keep `bash` disabled by default. Conversion and ingestion may use only the already-approved file tools: `read`, `write`, `edit`, `grep`, `find`, and `ls`. Consultation should use read/search tools only.
- If PDF, DOCX, or HTML content cannot be extracted safely with the existing tools, conversion fails safely and ingestion does not advance for that source.

Locked grill decisions:

- Conversion state lives inside the existing per-specialist `ingest/state.json`, not in a separate `conversion/state.json` file.
- The state schema should distinguish conversion status from ingestion status while keeping one canonical source-pipeline state file for admin display, startup detection, reload, and manual pipeline actions.
- `ingest/state.json` uses one source record per original uploaded file, not one record per generated Markdown artefact.
- For converted sources, the record key and primary `raw_path` remain the original upload path, while conversion metadata stores the generated Markdown path and ingestion metadata stores the Markdown path used by the ingestion agent.
- Direct Markdown uploads are stored and tracked as `*.original.md` source records with conversion marked as not required and ingestion using the same Markdown path.
- Source records use nested `conversion` and `ingestion` objects rather than one shared top-level status for the whole pipeline.
- Conversion statuses are `not_required`, `pending`, `processing`, `converted`, and `failed`.
- Ingestion statuses are `blocked`, `pending`, `processing`, `ingested`, and `failed`.
- A conversion failure blocks ingestion for that source until conversion is retried successfully or the source is replaced.
- Conversion is a manual admin action, not an automatic side effect of upload or reload.
- Upload stores the original source, reload/detect updates pending pipeline state, conversion is triggered explicitly, and ingestion is triggered explicitly after conversion succeeds.
- When ingestion is triggered, it processes only Markdown sources that are ready for ingestion and skips sources whose conversion is pending or failed.
- Ingestion must not auto-run conversion. The ingestion result should report ingested/skipped counts and safe skipped reasons such as `conversion_pending` and `conversion_failed`.
- Ujimu ingestion uses the `llm-wiki` skill through the Ujimu Pi agent copy under `config/ujimu-pi-agent/skills/llm-wiki`.
- The project-local `llm-wiki` copy adds a minimal Ujimu override: only Markdown files under `raw/` may be ingested; non-Markdown raw files are original uploads for the conversion pipeline and must not be ingested directly.
- If a global `llm-wiki` skill is also available, the Ujimu Pi agent `config/ujimu-pi-agent/skills/llm-wiki` copy must prevail. This is verified through Pi resource loading using the Ujimu agent directory.
- Pi SDK sessions resolve mutable configuration from `UJIMU_CONFIG_DIR` and bundled resources from `UJIMU_PI_BUNDLE_DIR`.
- Conversion, ingestion, and consultation sessions must pass the resolved config and bundle paths explicitly to Pi SDK session/resource-loader/model-registry setup so they use the Ujimu settings, models, auth sample convention, skills, tools, and extensions.
- Conversion and ingestion model overrides are valid only when both provider and model environment variables are set for that role.
- If neither provider nor model override is set for a role, that role uses the default model from `config/ujimu-pi-agent/settings.json`.
- If only one of provider/model is set, or if the configured model does not exist or lacks configured authentication, fail with a clear configuration error before starting the Pi session.
- Do not infer providers from model IDs and do not silently fall back from a malformed override to the default model.
- Pi-backed agent execution is enabled per role with `UJIMU_PI_CONVERSION_ENABLED=true`, `UJIMU_PI_INGESTION_ENABLED=true`, and `UJIMU_PI_CHAT_ENABLED=true`.
- A disabled role must fail safely without starting a Pi session: conversion remains pending, ingestion skips or reports disabled according to existing admin semantics, and chat returns the safe service-unavailable fallback.
- Per-role flags allow admin conversion/ingestion to be enabled without exposing real Pi chat to users.
- Raw scanning must not create independent source records for generated Markdown artefacts named `*.pdf.md`, `*.docx.md`, `*.html.md`, or `*.txt.md`.
- Generated Markdown artefacts are discovered through their original source record's conversion metadata.
- Direct Markdown uploads renamed to `*.original.md` do create source records because they represent already-normalized original sources.
- Admin uploads accepted in this slice are `.pdf`, `.txt`, `.docx`, `.html`, `.htm`, `.csv`, `.xlsx`, `.md`, and `.markdown`.
- CSV and XLSX conversion should preserve tabular content faithfully in Markdown when viable; XLSX sheet names should be represented as headings.
- The conversion agent must not silently summarize tabular sources. If faithful extraction/conversion is not viable or would produce unusably large/illegible Markdown, mark conversion failed and require manual source preparation.
- This slice does not add a raw upload size limit, but conversion output is capped by `UJIMU_PI_CONVERSION_MAX_MARKDOWN_BYTES`, defaulting to 1 MiB (`1048576`).
- If generated Markdown exceeds the configured output byte limit, mark conversion failed and do not advance ingestion.
- Add a manual admin conversion endpoint `POST /api/admin/specialists/:id/conversion/run`.
- The conversion endpoint processes all sources with `conversion.status = pending` or `failed`, skips sources with `converted` or `not_required`, and returns safe converted/failed/skipped counts.
- Pipeline stages stuck in `processing` become eligible for retry when their `updated_at` is older than `UJIMU_PI_PIPELINE_STALE_PROCESSING_MINUTES`, defaulting to 30 minutes.
- The stale-processing retry rule applies to both `conversion.processing` and `ingestion.processing`.
- Reingestion after an original source changes should ask the `llm-wiki` ingestion agent to update and reconcile existing wiki pages rather than deleting pages or creating duplicate versioned pages by default.
- Reingestion context passed to the agent should include original path, Markdown path, previous/current checksums when available, and whether the source had previously been ingested.
- Automatic destructive cleanup of existing wiki pages is out of scope for this slice.
- User-facing citation `sourceFile` values point to the original uploaded source path, not the generated Markdown artefact path.
- Internal ingestion metadata keeps the Markdown `source_path` used by the ingestion agent.
- For direct Markdown uploads stored as `*.original.md`, user-facing citations point to `raw/<name>.original.md` because that stored Markdown is the normalized original.
- Before invoking the consultation Pi runner, the backend computes the allowed citation evidence list from usable ingested sources and includes that list in the consultation prompt.
- The consultation agent may cite only the provided `sourceFile` values, and the backend still validates returned citations against the same allowed list.
- The consultation agent must answer from the specialist wiki, not from `raw/` at answer time. It should not read raw uploaded or generated files during user consultation.
- If possible, enforce the consultation read/search path policy to `wiki/` plus safe state/citation context; at minimum the prompt must forbid using `raw/` for answers.
- PDF conversion attempts to structure Markdown as well as possible while retaining as much information as possible; safe failures use the generic `CONVERSION_FAILED` error code.
- OCR remains out of scope, and failed OCR-required sources keep ingestion blocked.
- Version `config/ujimu-pi-agent/settings.json` with the Ujimu Pi agent default provider/model `openrouter` / `moonshotai/kimi-k2.6`, `defaultThinkingLevel = medium`, and `hideThinkingBlock = true`.
- Version `config/ujimu-pi-agent/models.json` as a minimal custom-provider placeholder with an empty `providers` object; real credentials belong in `config/ujimu-pi-agent/auth.json` or environment variables, with examples in `config/ujimu-pi-agent/auth.json.sample`.
- If the project-local default model lacks configured authentication, Pi-backed sessions must fail with a clear configuration error rather than silently selecting another available model.
- Admin-triggered conversion runs create admin audit events with safe counts and error-code summaries.
- Ingestion continues using/expanding existing admin audit behaviour.
- Pi consultation does not create new per-question operational/audit logs containing prompts or answers; it relies on existing quota, history, and analytics mechanisms, while operational logs may record sanitized technical outcomes only.
- Automated acceptance tests for the slice use fake Pi adapters/runners and must not require real model credentials or network access.
- Real Pi conversion, ingestion, and consultation are verified through a documented manual smoke path, not mandatory CI tests.
- When an original source checksum changes after conversion or ingestion, detection resets that source to `conversion.status = pending` and `ingestion.status = blocked` until conversion and ingestion are run again.
- Changed originals must not remain usable as citation evidence from stale ingestion state; chat should ignore them until the refreshed Markdown has been ingested.
- If conversion fails while an older generated Markdown file still exists, keep the old Markdown file in place for diagnosis but keep the source state failed/blocked.
- Ingestion must trust `ingest/state.json`, not raw file existence alone, so stale generated Markdown cannot be ingested while conversion is failed or pending.
- Real Pi-backed consultation/chat is in scope for this slice, not merely a placeholder or future preparation step.
- The slice must implement the user consultation agent as a real Pi SDK runner behind `UJIMU_PI_CHAT_ENABLED=true`, while preserving safe fallbacks when disabled, misconfigured, ungrounded, or missing valid citations.
- The consultation agent must return a structured machine-readable stream rather than relying on free-form source text.
- The consultation protocol is NDJSON-style structured events produced by the Pi-backed agent and parsed by the backend, not a single buffered final JSON object.
- The backend displays Pi consultation output only from validated structured events: non-empty answer deltas, non-empty citations, citation source files belonging to the specialist's usable ingested evidence, and at least one article reference per citation.
- If structured event parsing or validation fails, the backend must use the existing insufficient-evidence fallback instead of showing unvalidated Pi output.
- The first forwarded user-visible consultation output must follow a valid `citations` event. The backend validates citations against usable specialist evidence before forwarding answer text to the UI.
- If the Pi agent emits free text before the first valid `citations` event, the backend buffers that text instead of forwarding it immediately. If valid citations arrive later, the buffered text may be released as initial answer text; if valid citations never arrive, the buffered text is discarded and the fallback is used.
- Pre-citation buffered output is capped at 16 KB. If the agent exceeds that limit before valid citations arrive, the consultation result is invalidated and the fallback is used.
- The consultation NDJSON event contract accepts only `citations`, `delta`, `done`, and `error` event types.
- `citations` must contain a non-empty citations array with known usable `sourceFile` values and non-empty `articleRefs` arrays.
- `delta` must contain non-empty string `text` and may only be forwarded after citations are valid.
- `done` terminates the response. `error` causes the backend to use a safe fallback. Unknown event types invalidate the response.
- The consultation agent is read-only. It may use only `read`, `grep`, `find`, and `ls` and must not write derived wiki pages during user conversations.
- The `llm-wiki` skill's generic "queries compound too" behaviour is overridden for Ujimu consultation: repeated or unsupported user questions remain analytics/content-gap signals for admin review, not automatic wiki content.
- The conversion agent has a strict exception to raw immutability: for a given original source it may write or edit only that source's deterministic generated Markdown target, and must not modify the original or any other raw file.
- Conversion code should validate the expected target after the run and treat unexpected missing/invalid output as conversion failure.
- Conversion succeeds only when the expected Markdown target exists, contains at least 20 non-whitespace characters of legible Markdown/text content, and can be checksummed.
- On successful conversion, store `markdown_checksum` and `converted_at`, then set ingestion to `pending`.
- Direct Markdown uploads renamed to `*.original.md` do not run through the conversion agent. They are marked with `conversion.status = not_required`, `conversion.markdown_path` equal to the stored Markdown path, `conversion.markdown_checksum` from the uploaded file, and `ingestion.status = pending`.
- User-facing citations are still emitted at the end of the response stream after answer deltas, preserving the existing UI citation placement.

Potential implementation zones:

- `server/utils/ingestion/detect.ts`
- `server/utils/ingestion/run.ts`
- `server/utils/ingestion/pi-runner.ts`
- `server/utils/ingestion/state.ts`
- `server/utils/ingestion/storage.ts`
- `server/utils/chat/pi-runner.ts`
- `server/utils/chat/engine.ts`
- `server/api/admin/specialists/[id]/raw.post.ts`
- `server/api/admin/specialists/[id]/conversion/run.post.ts`
- `.gitignore`
- `config/ujimu-pi-agent/settings.json`
- `config/ujimu-pi-agent/models.json`
- `config/ujimu-pi-agent/auth.json.sample`
- `config/ujimu-pi-agent/skills/llm-wiki/**`

Acceptance tests written first in:

- `tests/pi-agent-pipeline.acceptance.test.ts`
- `tests/admin-ui.acceptance.test.ts`
- `tests/ops-ci-docs.acceptance.test.ts`

Acceptance tests were written first and now pass with the implementation:

- `npm test -- tests/pi-agent-pipeline.acceptance.test.ts tests/admin-ui.acceptance.test.ts tests/ops-ci-docs.acceptance.test.ts` — passed.

Success conditions covered by acceptance tests:

- An admin can upload PDF, TXT, DOCX, HTML/HTM, CSV, or XLSX and the system records a deterministic generated Markdown target ending in `.md`.
- TXT and any source extractable with the approved Pi file tools are converted to Markdown before ingestion.
- Direct Markdown upload `lei.md` is stored as `lei.original.md`; duplicate `lei.original.md` targets are rejected.
- When an original file changes, the generated Markdown artefact is overwritten; when the original has not changed, conversion is skipped.
- Ingestion reads only Markdown sources and preserves original-source traceability in citation metadata.
- Consultation uses a real Pi SDK runner with the project-local default Pi model, returns a validated structured NDJSON answer/citation event stream, and produces answers grounded in the selected specialist wiki with user-facing citations.
- `config/ujimu-pi-agent/auth.json` is ignored/untracked, while `config/ujimu-pi-agent/auth.json.sample` documents safe configuration examples; `.pi/` is ignored so developers can use the Pi CLI without loading Ujimu resources.
- Conversion and ingestion model overrides are read from environment variables and fall back to the project-local default when absent.
- The Ujimu Pi agent `llm-wiki` skill under `config/ujimu-pi-agent/skills/llm-wiki` is loaded without relying on the repository `.pi/` directory and instructs ingestion to use only Markdown files under `raw/`.
- No new Pi tools are introduced; tests prove the expected tool allowlists for each agent role.

Out of scope for this slice:

- OCR for scanned PDFs.
- New custom Pi tools or extraction tools.
- Broad architecture redesign.
- Real payment, OTP, deployment, or observability provider changes.
- Using analytics as a grounding source.

Verification completed:

- `npm test` — passed, 85 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed with existing Nuxt/Tailwind/VueUse/Node warnings.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## Slice 12 — Passkeys post-MVP

Status: `verified`

Idea-refined direction:

- Passkeys are available to all registered users, not limited to subscribers or administrators.
- OTP remains the account bootstrap, fallback, and recovery path; this slice does not create passkey-only accounts.
- Passkey management lives in a dedicated `/account/security` page rather than inside the main chat workspace.
- The core user success path is: a user with an OTP account can add a passkey, sign out, sign back in with the passkey, remove the passkey, and still use OTP.
- Use a mature WebAuthn/passkey library rather than hand-rolling cryptographic verification.
- Keep library-specific implementation behind internal contracts/adapters so Ujimu can change WebAuthn libraries later without rewriting route, session, or account-management code.
- Reuse the existing `users`, `user_identities`, quota subject, and JWT session model after successful passkey authentication.
- Preserve strict WebAuthn security expectations: configured origin/RP ID validation, short-lived one-time challenges, replay rejection, malformed assertion rejection, and credential binding to the authenticated user during registration.

Locked grill decisions:

- Passkeys are enabled explicitly with `UJIMU_PASSKEYS_ENABLED=true`; when disabled, public passkey login endpoints are hidden and UI passkey actions are not shown.
- Configure WebAuthn through `UJIMU_PASSKEY_RP_ID`, `UJIMU_PASSKEY_RP_NAME`, and `UJIMU_PASSKEY_ORIGIN`; development may default to `localhost`, `Ujimu`, and `http://localhost:3000`, but production requires explicit values when passkeys are enabled.
- Admin readiness should report passkey enabled/configured booleans without exposing RP ID, origin, or other configuration values.
- Use `@simplewebauthn/server` and `@simplewebauthn/browser` initially, behind an internal `PasskeyWebAuthnAdapter` so tests and future library swaps do not change route/session/account code.
- Read current official SimpleWebAuthn documentation before implementation.
- Generate WebAuthn options through mutating `POST` endpoints because challenge creation writes server-side state.
- Public/auth contracts are `POST /api/auth/passkeys/registration/options`, `POST /api/auth/passkeys/registration/verify`, `POST /api/auth/passkeys/authentication/options`, `POST /api/auth/passkeys/authentication/verify`, `GET /api/auth/passkeys`, and `DELETE /api/auth/passkeys/:credentialId`.
- Registration endpoints require an authenticated session created by OTP within the last 15 minutes; passkey-created sessions cannot add new passkeys until the user re-enters by OTP.
- Extend session JWT payloads with `authMethod: 'otp' | 'passkey'`; existing tokens without the field remain valid as `unknown` for general app use.
- `GET /api/auth/session` may expose safe `authMethod` and `recentOtpAuthenticated` fields for UI convenience, but server-side checks remain authoritative.
- Passkey login only authenticates existing accounts; account creation/bootstrap remains OTP-only.
- Admin access remains based on verified identities and `UJIMU_ADMIN_CONTACTS`; admins may enter `/admin` with passkey sessions, but adding passkeys still requires recent OTP.
- Store passkey data in inline SQLite migrations in `server/utils/db.ts`, not a separate migrations directory.
- Add `passkey_credentials`, `passkey_challenges`, and `passkey_auth_attempts` tables.
- Store binary WebAuthn values as base64url strings; UI and delete operations use the internal `passkey_credentials.id`, not the raw WebAuthn credential ID.
- `credential_id` is globally unique. Duplicate active credentials return `409 PASSKEY_ALREADY_REGISTERED` without revealing account ownership.
- Passkey removal is soft-delete with `deleted_at`; active login/listing ignores soft-deleted credentials.
- Re-registration may reactivate a soft-deleted credential only for the same `user_id`; never reassign a credential from another user.
- Users may register multiple passkeys, with an initial defensive cap of 20 active credentials per user.
- Users may remove their last passkey because OTP remains the official fallback/recovery path.
- Passkey registration uses `attestationType: 'none'`, `residentKey: 'preferred'`, and `userVerification: 'preferred'`.
- Passkey authentication uses discoverable credentials: do not send `allowCredentials`; map returned `credential_id` to `user_id` server-side.
- Registration options include active credentials in `excludeCredentials`; soft-deleted credentials are excluded from that list.
- Challenges are stored server-side, expire after 5 minutes, are one-shot, and are consumed on any verification attempt whether verification succeeds or fails.
- Verification looks up challenges by challenge value and purpose; do not expose a separate `challengeId` to the browser.
- Clean old passkey challenges and auth-attempt rows opportunistically in passkey endpoints after 24 hours; do not add a background worker in this slice.
- Store and update WebAuthn counters, rejecting non-increasing positive counters while accepting authenticators that consistently return zero.
- Public passkey login endpoints are rate-limited server-side: roughly 20 option challenges per 10 minutes and 10 failed verifications per 10 minutes.
- Rate-limit identity prefers `ujimu_visitor_id`; fallback to direct event IP; only trust proxy headers when `UJIMU_TRUST_PROXY_HEADERS=true`; store hashed IP identifiers, not raw IP addresses.
- Authenticated sensitive passkey operations validate same-origin using `Origin` or `Referer`; production rejects missing origin evidence for those operations.
- Client UI detects unsupported WebAuthn/insecure contexts only for UX; OTP remains available and the server still validates everything.
- `/account/security` is the management UI; the main page adds a discreet `Segurança da conta` link for authenticated users and `Entrar com passkey` for unauthenticated users when available.
- `/account/security` shows session state, add passkey, active passkey list, remove buttons, and a short note that OTP remains available.
- Passkey list responses expose only internal credential ID, creation time, last-used time, and transports; never expose public keys, challenges, signatures, raw authenticator data, or full WebAuthn payloads.
- Passkey removal uses a client-side confirmation prompt; the backend returns `404` for missing, cross-user, or already removed credentials.
- Operational logs should record sanitized passkey registration/login/removal/configuration outcomes without credential IDs, public keys, challenges, signatures, contacts, or full WebAuthn payloads.
- Public error codes should be safe and generic: `INVALID_PASSKEY_REQUEST`, `PASSKEY_AUTHENTICATION_FAILED`, `RECENT_AUTH_REQUIRED`, `PASSKEY_ALREADY_REGISTERED`, `PASSKEY_RATE_LIMITED`, and `PASSKEYS_NOT_CONFIGURED`.
- Tests should use a deterministic fake adapter for WebAuthn behavior and avoid real browser/OS authenticator prompts.

Acceptance tests written first in:

- `tests/passkeys.acceptance.test.ts`
- `tests/passkeys-ui.acceptance.test.ts`
- `tests/auth.acceptance.test.ts`
- `tests/db.test.ts`
- `tests/ops-ci-docs.acceptance.test.ts`

Acceptance-test targets:

- Authenticated registered users can register a passkey for their current account only after recent OTP authentication.
- Users with a registered passkey can sign out and sign in without requesting OTP.
- Removing a passkey prevents future sign-in with that credential, while OTP request and verification continue to work.
- Disabled or misconfigured passkeys hide/fail safely without leaking configuration values.
- Invalid origin, expired challenge, reused challenge, malformed payload, unknown credential, removed credential, duplicate credential, and invalid assertion do not create a session.
- Public passkey login endpoints enforce rate limits.
- OTP-created sessions expose `authMethod: 'otp'`; future passkey sessions expose `authMethod: 'passkey'`.
- The passkey service is exercised through internal adapter contracts with fake adapter tests so the concrete WebAuthn library can be replaced.
- `/account/security` exposes the agreed management UI and the main chat page links to it when appropriate.
- Operations documentation and readiness include passkey enablement/configuration expectations without exposing secrets or RP/origin values.

Implemented:

- `@simplewebauthn/server` and `@simplewebauthn/browser` dependencies behind a swappable `PasskeyWebAuthnAdapter`.
- Session JWT `authMethod` support with backwards compatibility for older `unknown` sessions.
- SQLite migration `0008_passkeys` for credentials, challenges, and passkey auth-attempt rate limiting.
- Passkey service for registration options, registration verification, authentication options, authentication verification, credential listing, credential soft-delete, one-shot challenges, duplicate handling, reactivation, counter updates, and rate limits.
- Passkey API endpoints for registration, authentication, listing, and deletion.
- Main chat page passkey sign-in action and authenticated `Segurança da conta` link.
- `/account/security` page for passkey add/list/remove flows and unsupported-browser messaging.
- Admin readiness passkey enabled/configured booleans without exposing RP/origin values.
- Operations runbook passkey configuration notes.

Verification:

- `npm test` — passed, 73 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.
- Manual browser/WebAuthn prompt check was not run in this environment; fake-adapter acceptance tests cover the domain contract.

Out of scope for this slice:

- Password authentication.
- Mandatory passkey enrolment.
- Passkey-only accounts or passkey-only recovery.
- Subscriber-only or admin-only rollout.
- Enterprise SSO, identity-provider federation, or passkey sync/account recovery beyond platform authenticator behaviour.

Next step:

- If desired, run a real-browser WebAuthn smoke test against a configured HTTPS/dev origin before production launch.

## Slice 11 — Security, operations & observability

Status: `verified`

As-built documentation correction, idea-refined direction (2026-05-16):

- Problem: the slice deck still describes parts of the original hardening idea more broadly than the implemented and grilled Slice 11 record, especially around observability sinks and likely implementation files.
- Recommended direction: correct the deck as an as-built specification note, keeping Slice 11's implemented scope intact while making `STATUS.md`, the deck, and the operations runbook tell the same story.
- MVP correction scope: update factual contradictions, make daily JSONL operational logs explicit, document safe readiness and CI/runbook boundaries, and list future hardening candidates without promising new behaviour in Slice 11.
- Key assumptions: `STATUS.md` is the canonical source for Slice 11 as-built decisions; the current implementation remains verified; future hardening belongs in later slices rather than retroactively expanding Slice 11.
- Not doing: no code changes, no new security controls, no new acceptance tests, and no external observability integrations as part of this correction.

As-built documentation correction, locked grill decisions (2026-05-16):

- Edit the existing Slice 11 deck content so it matches the as-built decisions, and add an explicit correction note rather than leaving contradictory original slides in place.
- Keep Slice 11 status as `verified`; this is a documentation fidelity correction, not a new implementation phase or behavioural change.
- Record unresolved hardening topics only as future candidates in this correction; do not create or scope a new slice as part of this work.
- Treat `STATUS.md` as the canonical Slice 11 source of truth and align the deck to its already-locked decisions.
- Verify by documentation review and diff only, because no runtime code, tests, or package files are changed.

Future hardening candidates preserved by this correction:

- Log retention, archival, deletion, and explicit file-permission policy.
- Stricter CSP policy and environment-specific security-header tuning.
- Readiness degraded-state semantics and operational dashboards.
- Backup restore drills, incident-response workflow, alerting, APM, metrics, and external log aggregation.

Idea-refined direction:

- Implement a practical hardening MVP rather than integrating external observability vendors in this slice.
- Add baseline HTTP security headers for all app/API responses.
- Add safe structured operational logging that records decisions and outcomes without raw questions, answers, OTPs, secrets, document contents, or provider secrets.
- Add minimal health/readiness surfaces that expose operational state without leaking sensitive configuration values.
- Strengthen tests around upload path safety, specialist isolation, deletion, verified billing webhooks, and sensitive-data avoidance.
- Add CI automation for install, tests, typecheck, build, and high-severity dependency audit.
- Document SQLite backup/restore and operational runbook basics before production use.

Locked grill decisions:

- Use daily JSON Lines operational log files as the primary MVP observability sink instead of a new SQLite operational-events table.
- Operational logs are written under `<UJIMU_DATA_DIR>/logs/operational/operational-YYYY-MM-DD.jsonl`.
- Each JSONL line is one complete event with timestamp, category, event name, severity, optional specialist ID, and sanitized metadata.
- Operational logs must not include raw questions, answers, OTP codes, session cookies/JWTs, webhook secrets, document contents, or full contact values.
- Keep console logging minimal and derived from the same sanitized event payload.
- Use `GET /healthz` as the public liveness endpoint, outside `/api`, returning only a minimal non-sensitive OK payload.
- Use `GET /api/admin/ops/readyz` as the authenticated admin readiness endpoint with safe boolean checks only.
- Readiness checks include database access, data-directory write access, operational-log write access, migration count, and secret/config presence as booleans rather than values.
- Add baseline HTTP security headers through server middleware for all app/API responses.
- Add CI automation with `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, and `npm audit --audit-level=high`.
- Document SQLite backup/restore, log location, health/readiness endpoints, and secret expectations in an operations runbook.

Implemented:

- Server middleware that applies baseline security headers to all application/API responses.
- Public `GET /healthz` liveness endpoint outside `/api` with a minimal non-sensitive payload.
- Admin-only `GET /api/admin/ops/readyz` readiness endpoint with database, writeability, migration-count, and secret-presence checks that do not expose paths or secret values.
- Daily JSONL operational logger under `<UJIMU_DATA_DIR>/logs/operational/operational-YYYY-MM-DD.jsonl` with metadata sanitization and test-suppressed console emission.
- Safe operational logging around billing webhook rejection and processing outcomes.
- CI workflow for install, tests, typecheck, build, and high-severity audit.
- `docs/operations.md` runbook covering health/readiness, logs, secrets, and SQLite backup/restore.

Acceptance tests written first in:

- `tests/security-ops.acceptance.test.ts`
- `tests/ops-ci-docs.acceptance.test.ts`

Acceptance-test targets:

- Baseline security headers are applied to application responses.
- Operational events are written as daily JSONL files under the configured data directory.
- Operational-event metadata is sanitized so sensitive question, answer, OTP, session, webhook, document, and contact values are not persisted.
- Public `/healthz` exposes only a minimal liveness payload.
- Admin-only `/api/admin/ops/readyz` exposes safe readiness booleans/numeric migration count without paths or secret values.
- Raw source storage keeps uploads inside the specialist raw directory and rejects traversal filenames.
- CI runs install, tests, typecheck, build, and high-severity audit.
- The operations runbook documents health/readiness, logs, secrets, and SQLite backup/restore.

Verification:

- Covered by `tests/security-ops.acceptance.test.ts` and `tests/ops-ci-docs.acceptance.test.ts`.
- Included in latest full verification snapshot.

Out of scope for this slice:

- External log aggregation, APM, metrics, or alerting services.
- Real Appy Pay, Stripe, or SendGrid operational dashboards.
- Full incident-response process automation.
- Enterprise SIEM integration.

## Slice 10 — Subscriptions, payments & advertising

Status: `verified`

Idea-refined direction:

- Implement a mockable billing MVP rather than direct Appy Pay or Stripe API calls in this slice.
- Keep payment providers behind an internal interface so real Appy Pay and Stripe adapters can be added later without changing subscription, quota, or UI logic.
- Authenticated users can create a quarterly subscription checkout for the public 50,000.00 AOA plan.
- Checkout creates a pending payment; subscription activation happens only after a provider-style confirmation event.
- Subscription status drives quota subject resolution, expiry warnings, and advertising visibility.
- Advertising zones remain visible for anonymous and registered free users and hidden for subscribed users.
- Treat provider event payloads as untrusted input and keep confirmation idempotent.

Locked grill decisions:

- Use a mockable provider MVP now: checkout creates a pending payment and provider abstractions prepare for real Appy Pay and Stripe adapters later.
- Subscription checkout requires an authenticated OTP session; anonymous users see advertising and can sign in before subscribing.
- Payment confirmation only happens through provider-style webhook endpoints protected by `UJIMU_BILLING_WEBHOOK_SECRET`.
- If `UJIMU_BILLING_WEBHOOK_SECRET` is missing, webhook endpoints return `503` and do not activate access.
- Invalid webhook secrets return `401` and do not record a trusted provider event.
- Confirmations are idempotent: duplicate provider events or repeated confirmation for an already confirmed payment do not create duplicate subscription time.
- Unknown payment IDs in otherwise authenticated webhook events are recorded as ignored and never activate access.
- Renewals stack from `max(now, current_period_end) + 3 months`, so users do not lose remaining subscription time when renewing early.
- Expired subscriptions immediately lose subscribed status; there is no grace period.
- The expiry warning appears when an active subscription has less than seven days remaining.
- Appy Pay methods in the MVP contract are Multicaixa Express, Multicaixa Reference, and QR Code; Stripe is the VISA provider boundary.
- Billing state drives quota subject resolution: active subscribed users use the subscribed weekly quota policy; expired users fall back to registered limits.
- The user-facing billing UI lives on the main page for the MVP and hides advertising for subscribed users.

Implemented:

- `billing_payments`, `billing_provider_events`, and `billing_subscriptions` SQLite migration.
- Quarterly public plan model for 50,000.00 AOA with three-month subscription periods.
- Mock provider checkout boundary with Appy Pay method mapping and Stripe VISA method mapping.
- Authenticated `POST /api/billing/checkout` endpoint that creates pending payments only.
- Public `GET /api/billing/status` endpoint for authenticated and anonymous billing/ad state.
- Secret-protected `POST /api/billing/webhooks/:provider` endpoint using `UJIMU_BILLING_WEBHOOK_SECRET`.
- Idempotent webhook processing for duplicate events and already confirmed payments.
- Subscription renewal stacking from `max(now, current_period_end) + 3 months`.
- No-grace active subscription resolution and under-seven-day expiry warnings.
- Chat quota subject upgrade from registered to subscribed while a subscription is active.
- Main-page subscription panel with checkout actions, expiry warning, and subscribed ad hiding.

Acceptance tests written first in:

- `tests/billing.acceptance.test.ts`
- `tests/billing-ui.acceptance.test.ts`
- `tests/db.test.ts`

Acceptance-test targets:

- Registered users can create pending quarterly checkouts for 50,000.00 AOA using valid Appy Pay and Stripe method mappings.
- Anonymous checkout attempts return `401`; invalid provider/method combinations return `400`.
- Secret-protected webhook confirmation activates subscriptions, hides ads, and stays idempotent for repeated events or already confirmed payments.
- Missing webhook secret returns `503`; invalid webhook secret returns `401` and records no trusted provider event.
- Renewals stack from the current active expiry, expired subscriptions lose access immediately, and near-expiry warnings appear under seven days.
- Active subscriptions resolve to the subscribed quota subject while expired subscriptions fall back to registered limits.
- The main page exposes billing status, checkout actions, expiry warnings, and ad visibility rules.

Verification:

- Covered by `tests/billing.acceptance.test.ts`, `tests/billing-ui.acceptance.test.ts`, and updated database migration checks.
- Included in latest full verification snapshot.

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
