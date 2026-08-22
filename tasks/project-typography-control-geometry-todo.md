# Task list: Project typography and control geometry

## Task 1: Specify typography and interaction geometry

**Description:** Add acceptance coverage for font delivery, the four-size scale, geometry tokens, minimum targets, focus visibility, safe area, and the known undersized control families.

**Acceptance criteria:**
- [ ] Tests require `html { font-size: 100% }`, exactly four type-size tokens, and no application `font-size` in pixels.
- [ ] Tests require the approved height, padding, radius, gap, and tap-target tokens.
- [ ] Tests identify current icon, compact, link, and field selectors below the contract.
- [ ] Tests require shared `:focus-visible` and composer safe-area rules.

**Verification:**
- [ ] Focused tests fail against the current implementation for the expected reasons.

**Dependencies:** None

**Files likely touched:**
- `tests/project-typography-control-geometry.acceptance.test.ts`
- `tests/ui-redesign-shell.acceptance.test.ts`
- `tests/markdown-renderer.acceptance.test.ts`

**Estimated scope:** Medium

## Task 2: Configure fonts and visual tokens

**Description:** Declare Nuxt Fonts directly, preserve OFL notices, and introduce the approved typography and geometry custom properties.

**Acceptance criteria:**
- [ ] Production build emits same-origin Inter, Literata, and JetBrains Mono variable WOFF2.
- [ ] Fonts use normal style, weights 400–600, Latin subset, swap, and metric fallbacks.
- [ ] CSS defines the four text sizes and the approved control tokens once.
- [ ] Inter plus Literata total no more than 90KiB; mono size is reported separately.

**Verification:**
- [ ] `npm run build` succeeds and generated assets/CSS pass direct inspection.

**Dependencies:** Task 1

**Files likely touched:**
- `nuxt.config.ts`
- `package.json`
- `package-lock.json`
- `assets/css/main.css`
- font licence notice files

**Estimated scope:** Medium

## Task 3: Apply typography roles

**Description:** Replace IBM Plex aliases and scattered sizes with Inter UI, Literata assistant reading, JetBrains Mono code, and the four approved sizes.

**Acceptance criteria:**
- [ ] Assistant answers use Literata 400 at `1.0625rem/1.65` with a 34em maximum measure.
- [ ] User messages, inputs, and normal buttons use Inter at `1.0625rem`.
- [ ] Citation markers and source cards match the approved typography.
- [ ] No application `font-size` declaration uses pixels.

**Verification:**
- [ ] Focused typography and Markdown tests pass.

**Dependencies:** Task 2

**Files likely touched:**
- `assets/css/main.css`
- `components/AuthModal.vue`
- `pages/especialidades/[id].vue`

**Estimated scope:** Medium

## Task 4: Reclaim chat width and migrate interactions

**Description:** Remove the assistant's lateral marker and apply the geometry system to the composer, textarea, specialist selector, send button, queue actions, message actions, copy controls, citation controls, and source rows.

**Acceptance criteria:**
- [ ] Assistant responses contain no “U” marker or marker-specific gap at any viewport width.
- [ ] Thread padding remains 1rem on mobile and 1.25rem on larger screens.
- [ ] Assistant content uses the remaining width up to the approved 34em measure; user messages, citations, sources, and streaming remain unchanged.
- [ ] Chat textarea is 3rem minimum, 8.75rem maximum, keeps five-line auto-resize, and uses the approved padding and radius.
- [ ] Send and compact chat actions have 2.25rem visuals, 2.75rem targets, approved icons, and at least 0.5rem separation.
- [ ] Composer bottom padding includes `env(safe-area-inset-bottom)`.

**Verification:**
- [ ] Focused chat tests prevent reintroduction of the marker and pass.
- [ ] Browser confirms the recovered mobile width and pointer targets without overlap.

**Dependencies:** Tasks 2 and 3

**Files likely touched:**
- `assets/css/main.css`
- `pages/index.vue`

**Estimated scope:** Medium

## Task 5: Migrate shared controls

**Description:** Apply the control scale to primary, secondary, small, icon, and text buttons; fields; selects; chips; navigation rows; and OTP controls.

**Acceptance criteria:**
- [ ] Normal buttons and fields are 3rem high with approved padding and text.
- [ ] Icon buttons are 2.75rem square with 1.25rem icons.
- [ ] Text links have a 2.75rem minimum target and 0.5rem horizontal padding.
- [ ] Icon-with-text controls use 1.125rem icons and a 0.5rem gap.
- [ ] All keyboard-focusable controls show a 2px/2px `:focus-visible` ring.

**Verification:**
- [ ] Focused shell, auth, account, billing, company, and admin tests pass.

**Dependencies:** Task 4

**Files likely touched:**
- `assets/css/main.css`

**Estimated scope:** Medium

## Task 6: Resolve local styles and width rules

**Description:** Migrate remaining component-scoped controls and enforce full-width treatment only on primary screen or modal actions.

**Acceptance criteria:**
- [ ] Component-local styles use approved tokens and no new geometry values.
- [ ] Secondary authentication actions are not full width.
- [ ] Primary modal and subscription actions may remain full width.
- [ ] Avatars, logos, illustrations, ads, and decorative icons remain unchanged, except for the removed assistant marker.

**Verification:**
- [ ] Static geometry audit finds no unapproved interactive dimensions.
- [ ] Relevant component tests pass.

**Dependencies:** Task 5

**Files likely touched:**
- `components/AuthModal.vue`
- any Vue file with a genuinely local interactive style found by the final audit

**Estimated scope:** Medium

## Checkpoint: Build and interaction contract

- [ ] Production build passes.
- [ ] Font budget and generated fallback CSS pass.
- [ ] Every audited pointer target is at least 2.75rem.
- [ ] Compact target extensions do not overlap.
- [ ] Full-width controls are limited to primary actions.

## Task 7: Verify representative views in Chrome

**Description:** Test the production build at desktop and mobile widths across chat, auth, subscription, account, admin, company, and public-specialist surfaces.

**Acceptance criteria:**
- [ ] Computed typography and control dimensions match the spec.
- [ ] Keyboard focus is visible and follows a logical order.
- [ ] Touch targets remain usable on short and safe-area mobile viewports.
- [ ] Fonts load from the Ujimu origin; console, network, accessibility tree, and CLS checks pass.

**Verification:**
- [ ] Capture screenshots and inspect computed styles, target boundaries, network requests, accessibility tree, and a performance trace.

**Dependencies:** Tasks 3–6

**Files likely touched:** None unless verification finds a defect

**Estimated scope:** Medium

## Task 8: Complete quality gates and Zafir records

**Description:** Run the complete suite, review the diff against both approved guidelines, and record final evidence.

**Acceptance criteria:**
- [ ] No unrelated graphic or behavioural changes are present.
- [ ] Every success condition in Slice 57 has evidence.
- [ ] Slice deck and `STATUS.md` move to verified only after all checks pass.

**Verification:**
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Five-axis code review

**Dependencies:** Tasks 1–7

**Files likely touched:**
- `docs/specs/slices/57-project-typography-control-geometry.html`
- `docs/specs/slices/STATUS.md`

**Estimated scope:** Small
