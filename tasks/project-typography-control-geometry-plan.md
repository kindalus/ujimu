# Implementation plan: Project typography and control geometry

## Overview

Implement the approved typography and interaction-sizing spec as one Zafir slice. Inter Variable will cover interface text, Literata Variable assistant answers, and JetBrains Mono Variable code. Four font-size tokens replace the current 28 sizes. A compact control token set replaces scattered heights, padding, radii, and gaps while guaranteeing a 44px minimum pointer target and a 48px default control height.

Approved source: `docs/specs/brainstorm-project-typography.html`

Planned slice: `docs/specs/slices/57-project-typography-control-geometry.html`

The user explicitly retained the existing architecture. No separate architecture deck is required. The user approved the revised spec and Slice 57 before implementation.

## Architecture decisions

- Add the already-transitive `@nuxt/fonts` package as a direct dependency and use its official build-time, same-origin asset emission.
- Request normal variable fonts at weights 400–600 with the `latin` subset only.
- Keep exactly four global text sizes: `0.75rem`, `0.875rem`, `1.0625rem`, and `1.5rem`.
- Use `1.0625rem` for normal buttons and inputs rather than adding the guideline's `1rem` as a fifth size.
- Keep typography and geometry as CSS custom properties in `assets/css/main.css`; do not add a TypeScript token layer.
- Use 3rem for normal controls, 2.75rem for icon controls and minimum pointer targets, and 2.25rem only for the visible box of compact controls.
- Extend compact controls to a 2.75rem pointer target with a shared pseudo-element pattern. Keep at least 0.5rem between neighbouring targets so extensions do not overlap.
- Reuse the existing chat textarea auto-resize logic. Do not add `field-sizing` or another JavaScript path.
- Apply the geometry system only to interactive controls and icons inside them. Avatars, branding, illustrations, ads, and decorative icons remain unchanged, except for the assistant's lateral marker, which the user explicitly removed.
- Remove the assistant “U” marker and only its dedicated gap at every viewport width. Preserve thread padding at 1rem on mobile and 1.25rem on larger screens, then let assistant content use the remaining width up to the approved 34em measure.
- Use full-width buttons only for the primary action of a screen or modal. Remove full-width treatment from secondary actions.
- Keep 1px borders and a 2px focus ring as physical pixel values, as explicitly requested.
- Do not add service-worker infrastructure.

## Official sources

- Nuxt Fonts configuration: https://fonts.nuxt.com/get-started/configuration
- Nuxt Fonts providers: https://fonts.nuxt.com/get-started/providers
- WCAG 2.2 target size enhanced, 44 by 44 CSS pixels: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- Android Accessibility touch targets, at least 48dp: https://developer.android.com/guide/topics/ui/accessibility/apps#touch-targets
- MDN `:focus-visible`: https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible
- MDN safe-area environment variables: https://developer.mozilla.org/en-US/docs/Web/CSS/env
- MDN `font-display`: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- MDN `size-adjust`: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust
- Font licences and metadata: https://github.com/google/fonts/tree/main/ofl/inter, https://github.com/google/fonts/tree/main/ofl/literata, https://github.com/google/fonts/tree/main/ofl/jetbrainsmono

## Dependency graph

```text
Acceptance contract
  -> font and geometry tokens
     -> same-origin font delivery
     -> critical chat controls
        -> shared controls and local styles
           -> build and pointer-target audit
              -> real-browser verification
```

## Task list

### Phase 1: Lock the contract

- [ ] Task 1: Add failing acceptance tests for typography, control tokens, focus, safe area, and legacy undersized controls.

### Checkpoint: RED

- [ ] Focused tests fail because the current app uses an 18px root, IBM Plex aliases, pixel font sizes, scattered geometry, undersized icon buttons, and no shared `:focus-visible` rule.

### Phase 2: Establish foundations

- [ ] Task 2: Configure Nuxt Fonts, preserve OFL notices, and add approved typography and geometry tokens.
- [ ] Task 3: Apply typography roles and remove obsolete size declarations.

### Checkpoint: Foundation

- [ ] Focused token and font tests pass.
- [ ] Production build emits same-origin variable WOFF2 with swap and fallback metrics.
- [ ] Inter plus Literata total no more than 90KiB; JetBrains Mono is reported separately.

### Phase 3: Migrate interaction families

- [ ] Task 4: Remove the assistant marker and migrate the chat composer, send action, message actions, citations, and source controls.
- [ ] Task 5: Migrate shared buttons, icon buttons, links, fields, chips, selectors, OTP controls, and focus treatment.
- [ ] Task 6: Migrate remaining component-local and public-page controls, then remove invalid full-width secondary actions.

### Checkpoint: Interaction contract

- [ ] Normal controls are 3rem high.
- [ ] Every interactive pointer target is at least 2.75rem in each required dimension.
- [ ] Compact visual controls remain 2.25rem where specified and accept pointer input across their expanded target.
- [ ] Adjacent targets have at least 0.5rem separation.
- [ ] The fixed composer respects the bottom safe area.

### Phase 4: Runtime and quality verification

- [ ] Task 7: Verify representative chat, auth, subscription, account, admin, company, and public-specialist views in Chrome DevTools.
- [ ] Task 8: Run the full quality gate, inspect the final diff, and update Zafir evidence.

### Checkpoint: Complete

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] Desktop and mobile browser checks pass with a clean console and no measurable CLS regression.
- [ ] Slice 57 and `STATUS.md` contain final evidence before the slice is marked verified.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Expanded pseudo-targets overlap | High | Require 0.5rem gaps, test boundary points with `elementFromPoint`, and prefer real 2.75rem boxes where density allows. |
| Larger controls reduce chat reading space | Medium | Remove the assistant marker and its indent, keep full-width actions out of chat, retain compact 2.25rem visuals, and verify short mobile viewports. |
| Broad selectors change non-interactive graphics | Medium | Scope geometry to explicit interactive selectors; exclude avatars, logos, ads, and decorative icons in tests and review. |
| Four text sizes flatten hierarchy | Medium | Preserve hierarchy with the approved weights, spacing, and line heights rather than adding sizes. |
| Generated fonts exceed 90KiB | Medium | Measure build output before completion and reduce axes, not Portuguese glyph coverage. |
| Serif fallback causes layout shift | High | Require generated metric overrides and measure CLS in production mode. |
| Existing `outline: none` declarations suppress keyboard focus | High | Add a later, shared `:focus-visible` rule and verify keyboard navigation across all representative surfaces. |
| Safe-area padding duplicates existing composer spacing | Low | Replace the existing bottom value with one `calc()` token rather than stacking padding rules. |

## Open questions

None. The user confirmed that the previous four-size typography contract remains unchanged and that geometry applies only to interactive controls, their internal icons, radii, gaps, focus, and safe area.
