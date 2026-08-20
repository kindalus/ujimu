# Implementation Plan: Isolated Ujimu Agent Skills

## Overview

Implement the approved Slice 01 by bundling the confirmed `unslop` and `research` snapshots, isolating Pi skill discovery to Ujimu's bundle, and verifying that sessions expose exactly the three approved skills. The existing external `llm-wiki` synchronization remains unchanged because its generated copy already matches the global version.

## Architecture Decisions

- Keep `llm-wiki` generated and externally synchronized; do not undo the existing untracked-bundle migration.
- Version `unslop` and `research` because no other official distribution source exists.
- Set Pi's official `noSkills` resource-loader option while retaining `additionalSkillPaths`; this disables implicit global discovery without disabling Ujimu's explicit bundle.
- Verify effective names and absolute paths through the real `DefaultResourceLoader`, not only mocks.
- Treat background-agent execution requested by `research` as out of scope; this slice guarantees skill availability only.

## Dependency Graph

```text
Approved global skill snapshots
  -> versioned Ujimu bundle
     -> isolated DefaultResourceLoader
        -> exact-skill acceptance test
           -> documentation and full verification
```

## Task List

### Phase 1: Bundle foundation

- [x] Task 1: Copy the approved global `unslop` and `research` skill directories into `config/pi/skills`.
- [x] Task 2: Update the real-loader acceptance expectation to require exactly the three approved bundled skills and paths.

### Checkpoint: Bundle discovery

- [x] Focused loader test fails before runtime isolation and passes after it.
- [x] Bundled files match the approved global source snapshots.

### Phase 2: Runtime isolation

- [x] Task 3: Add `noSkills: true` to the Ujimu `DefaultResourceLoader` configuration.
- [x] Task 4: Update operations documentation with distribution, loading, update, and capability notes.

### Checkpoint: Complete

- [x] Focused Pi and skill-sync tests pass.
- [x] Type checking succeeds.
- [x] Production build succeeds.
- [x] Review confirms no unrelated global skills or name collisions.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `noSkills` could also suppress explicit additional paths | High | Verify against Pi 0.84.2 with the real loader acceptance test. |
| Generated `llm-wiki` is absent in a clean checkout | Medium | Keep existing npm lifecycle synchronization and sync-script tests. |
| Versioned skill snapshots drift from the user's global copies | Low | Compare every copied file by SHA-256 during implementation and document the manual refresh source. |
| `research` requests a background agent unavailable to Ujimu | Medium | Document the limit; do not claim execution capability in acceptance criteria. |

## Open Questions

None. The user confirmed the architecture, approved Slice 01, and confirmed that no other official source exists for `unslop` or `research`.
