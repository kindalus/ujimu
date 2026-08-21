# Implementation Plan: SEO and Loading Performance Launch

## Overview

Deliver the approved SEO and performance extension in four sequential slices. Slice 49 is the immediate release path for the already-public site's title, favicon, social preview, crawl policy, and canonical identity. Later slices add editorial specialist data, public specialist pages, and measured loading improvements.

## Architecture Decisions

- Use native Nuxt/Nitro SEO, head, public asset, and server route capabilities.
- Keep specialist editorial metadata in `specialist.yaml`, with explicit admin ownership and safe fallback.
- Index only anonymous public content; never index chat responses, history, accounts, admin, billing, or APIs.
- Measure performance before optimizing and revert changes that do not exceed run-to-run variance.

## Task List

### Slice 49: Public SEO identity

- [ ] Lock implementation decisions and HTTP acceptance seams.
- [ ] Add failing acceptance tests for SSR metadata, crawl endpoints, route headers, and image dimensions.
- [ ] Create the approved social image and icon assets.
- [ ] Implement SSR metadata, canonical, JSON-LD, robots, sitemap, and noindex headers.
- [ ] Run full tests, typecheck, build, audit, HTTP/WhatsApp checks, and browser verification.
- [ ] Deploy through `/usr/local/bin/deploy_ujimu.sh` and verify `https://ujimu.com`.

### Slice 50: Specialist editorial SEO

- [ ] Refine and grill the specialist YAML/editor contract.
- [ ] Implement tests, schema, API, and admin fields.

### Slice 51: Public specialist pages

- [ ] Refine and grill the anonymous editorial endpoint and SSR route contract.
- [ ] Implement tests, public pages, JSON-LD, CTA, and dynamic sitemap.

### Slice 52: Measured loading performance

- [ ] Capture a repeatable production baseline.
- [ ] Test one optimization hypothesis at a time and keep only measured gains.
- [ ] Establish a regression budget after the stable result.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Social crawlers do not execute JavaScript | High | Require all preview tags in the initial SSR HTML. |
| Private specialist or conversation data enters discovery | High | Build sitemap and pages only from anonymous public access; noindex operational routes. |
| WhatsApp caches an old preview | Medium | Verify raw HTML first, then test a cache-busting URL only for preview refresh. |
| SEO package adds unnecessary dependency surface | Low | Use native Nuxt/Nitro APIs. |
| Performance work adds complexity without benefit | Medium | Compare repeated before/after measurements and revert neutral changes. |

## Open Questions

None for Slice 49. Title, description, identity, canonical domain, and image concept are approved.
