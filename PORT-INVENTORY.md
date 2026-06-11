# Prototype Port Inventory

Source prototype: `mock/` (`index.html` + `mock/ujimu/*.jsx`), with `mock/offline.html` used only as an executable visual reference.

## Governing context

- Repository instructions in `AGENTS.md` apply.
- Existing approved UI-redesign specs apply: `docs/specs/brainstorm-ui-redesign.html`, `docs/specs/ui-redesign-architecture.html`, and slices 16-22 in `docs/specs/slices/`.
- The target stack is Nuxt 4, Vue 3, TypeScript, Nuxt UI 4, and Tailwind CSS 4.
- User-facing copy remains European Portuguese using pre-1990 orthography.
- Product behaviour for grounding, citations, quotas, history, specialist access, subscriptions, admin checks, ingestion, and corporate access must remain backed by existing APIs rather than prototype demo state.

## Prototype artefacts

| Artefact | Status | Notes |
|---|---:|---|
| `mock/index.html` | Found | Visual source of truth: tokens, dark/light theme variables, prompt/drawer/chat/admin/subscription CSS. |
| `mock/ujimu/*.jsx` | Found | Behaviour source of truth: chat flow, queue, login modal, admin, subscription, profile, and corporate management demo flows. |
| `mock/offline.html` | Found | Executable reference only; not read or edited as source code. |
| `mock/ujimu/tweaks-panel.jsx` | Ignored for product port | Design-time controls only. |
| `mock/ujimu/data.js` | Demo data | Used to understand states, not copied as production data. |

## Screens and routes

| Prototype view | Target route/component | Access path | Required states | Port status |
|---|---|---|---|---:|
| Chat empty state | `pages/index.vue` | `/` | loading specialists, no specialists, specialist not selected, specialist selected | Verified in Nuxt browser spot-check |
| Chat conversation | `pages/index.vue` | `/` | user message, assistant streaming, done answer, grounded answer with citations, no-context answer, copy action | Implemented; browser verification pending |
| Pending question queue | `pages/index.vue` | submit while streaming | empty, 1-3 queued questions, queue full, reorder, remove | Implemented; browser verification pending |
| Inline advertising | `pages/index.vue` + `utils/inline-ads.ts` | after eligible assistant answers | hidden for subscribed users, visible between answers for eligible users | Implemented; browser verification pending |
| Drawer navigation/history | `components/AppDrawer.vue` + chat slot | menu button | anonymous history gate, authenticated empty history, grouped history, delete/resume, profile/admin/subscription links | Verified anonymous drawer in Nuxt browser spot-check |
| OTP/passkey login modal | `components/AuthModal.vue` | login buttons/drawer/quota/subscription | contact step, code step, passkey action, dev-login action, errors | Restored to Nuxt UI `UModal`; verified contact step in Nuxt browser spot-check |
| Subscription overview | `pages/subscription.vue` | `/subscription` | anonymous, authenticated unsubscribed, subscribed, expiry warning, no visible payment-method choices before launch | Prototype `subpage`/three-plan layout verified in Nuxt browser spot-check; payment method buttons hidden until launch while existing API-backed billing remains wired. |
| Corporate subscription flow | Existing company routes/API | `/companies/**` and `/subscription` | setup/management, seat limits, no visible payment-method choices before launch | Company plan card and company management zones ported visually; existing company APIs retained for real data. |
| Profile page | `pages/account/profile.vue` | `/account/profile` | anonymous gate, authenticated profile, subscription summary, account delete | Prototype anonymous gate verified in Nuxt browser spot-check; authenticated card layout implemented against real profile API. |
| Account security | `pages/account/security.vue` | `/account/security` | session required, list passkeys, add/remove passkey, unsupported browser, recent OTP gate | Existing API-backed implementation retained; visual parity pending |
| Admin dashboard | `pages/admin/index.vue` | `/admin` | loading, unauthenticated, non-admin, admin dashboard | Prototype `adm-page`/`adm-homegrid` layout and unauthenticated gate verified in Nuxt browser spot-check |
| Admin specialists list/create | `pages/admin/specialists/index.vue` | `/admin/specialists` | list, create form, company selector data, validation | Prototype admin layout and route-level side panel verified in Nuxt browser spot-check |
| Admin specialist detail | `pages/admin/specialists/[id].vue` | `/admin/specialists/:id` | edit metadata, upload/replace source, refresh, run ingestion, errors, delete | Prototype `adm-page` detail, metadata, official sources, restricted access, danger-zone, and delete modal layout restored against existing APIs; browser spot-check passed for an authenticated admin detail page. |
| Admin analytics | `pages/admin/analytics.vue` | `/admin/analytics` | visitors, recent questions, content gaps, filters, review action | Prototype `adm-statrow`/chart/feed layout verified in Nuxt browser spot-check; real analytics APIs retained. |
| Admin ops | `pages/admin/ops.vue` | `/admin/ops` | readiness ok/warn, safe values only | Prototype `adm-srcs` readiness list verified in Nuxt browser spot-check; real readiness API retained. |
| Ujimu admin companies | `pages/admin/companies*.vue` | `/admin/companies` | list/detail, quota, memberships, assigned specialists | Existing API-backed implementation retained; visual parity pending |
| Corporate specialist management | `pages/companies/index.vue`, `pages/companies/[id].vue`, `pages/companies/[id]/specialists.vue` | `/companies`, `/companies/:id`, `/companies/:id/specialists` | company admin gate, active-company specialist list, company quota/users, specialist prompt edit, source upload/state | Prototype `adm-page`/`subpage` company zones ported; `/companies/[id]/specialists` source labels and ingestion wording realigned to the prototype while retaining real company/specialist APIs. |

## Behavioural rules confirmed from prototype modules

- Anonymous users see a daily quota pill (`2/5 hoje` in demo); authenticated users get registered quota, and subscribed/company users are treated as ad-free/subscribed.
- Users must choose a specialist before asking a question.
- A question submitted while an answer streams enters a queue with maximum length 3.
- Queued questions can be removed and reordered.
- Editing a previous user question removes later conversation continuation and creates a new assistant answer.
- Assistant answers stream, then show citations/source rows when available.
- No-context answers show a visible `Contexto insuficiente` tag and list relevant specialist sources when possible.
- Copying an answer includes citations/sources.
- Ads are inline conversation items and must never interrupt citation blocks.
- Drawer contains the prototype shell destinations: new chat, history, subscription, administration, profile when authenticated, and login/logout actions. Non-prototype management routes remain available by URL or their own pages rather than being surfaced in the drawer.
- OTP login uses email/phone contact step followed by a 6-digit code step; passkeys remain an alternate sign-in path when available.
- Admin source ingestion progresses asynchronously: pending/replaced/converted sources can be ingested; refresh observes state changes.
- Corporate admins can manage only company-reserved specialists and cannot trigger ingestion.
- Corporate seat specification allows at most subscribed seats plus 10% extra specified accounts.

## Verification checklist

| Item | Status | Notes |
|---|---:|---|
| `npm run typecheck` | PASS | Passed after final fixes. |
| `npm test` | PASS | 40 files, 147 tests, including prototype icon-port and fidelity coverage. |
| `npm run build` | PASS | Completed with existing Nuxt/Tailwind/VueUse/Node warnings. |
| `npm audit --audit-level=high` | PASS | 0 vulnerabilities. |
| Prototype browser inspection | PASS | `mock/` Vite reference loaded at `http://127.0.0.1:5174/`; chat, drawer, login, authenticated drawer, and admin were inspected. |
| Nuxt browser inspection | PASS | `http://127.0.0.1:3000/`, `/admin`, `/admin/ops`, `/admin/analytics`, `/subscription`, `/account/profile`, and `/companies` spot-checked through Chrome DevTools MCP. |
| Console check | PASS | Nuxt spot-check showed only development info logs; no critical console errors. |

## Decisions

- Do not copy the React prototype demo state or seed data into production logic.
- Preserve existing server APIs and real persistence; port visual structure and interaction patterns only.
- Keep prototype CSS class names where practical to make visual auditing easier.
- Use a local inline SVG icon component based on the prototype's `Icon` paths for the ported chat, drawer, auth, and admin-gate surfaces instead of Lucide `UIcon` glyphs.
- Use the prototype's bespoke specialist selector (`spec-sel`, `spec-chip`, `spec-pop`) inside the chat prompt rather than rendering the generic Nuxt UI select as the visible control.
- Port `/admin/specialists` to the prototype admin list/create layout classes (`adm-page`, `adm-create`, `adm-list`, `adm-spec`) while preserving the existing API-backed route model.
- Render `/admin/**` inside the prototype admin shell (`adm`, `adm-nav`, `adm-content`) so the left administration panel remains present across admin pages and page-local navigation buttons are not duplicated.
- Port `/admin`, `/admin/ops`, `/admin/analytics`, `/subscription`, `/account/profile`, and `/companies/**` to the prototype zone/class structure while keeping real Nuxt APIs and persistence.
- Keep the product-approved 50,000.00 AOA quarterly subscription price even though the prototype demo used illustrative monthly values.
- Do not show payment-method choices on `/subscription` before launch; keep a single subscription CTA and hide Appy Pay/Stripe method labels from the page.
- Keep Nuxt UI structural primitives (`UApp`, `UModal`, existing U* components) where useful, but render the drawer as the prototype fixed `scrim` + `aside.drawer` instead of Nuxt UI `UDrawer` because the generic drawer chrome was visually divergent.
- Treat `mock/ujimu/tweaks-panel.jsx` as design-time tooling and exclude it from product code.
