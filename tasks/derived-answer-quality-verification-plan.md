# Derived answer quality verification plan

Status: completed and verified on 2026-09-07

Approved source decks:

- `docs/specs/brainstorm-derived-answer-quality-verification.html`
- `docs/specs/derived-answer-quality-verification-architecture.html`

## Overview

Audit a deterministic 10% sample of completed answers that consulted derived wiki pages, force the first check of each derived revision, compare each sampled answer with a default-model answer that cannot read `wiki/derived/`, quarantine negatively contributing pages, and repair them in staging with the ingestion model. The client response must never wait for this pipeline, and no `llm-wiki` skill file may change.

## Architecture decisions

- Extend the existing post-response telemetry path rather than the public chat protocol.
- Persist a private verification backlog separately, then attach its oldest eligible item to the existing per-specialist background-job lock.
- Use the event ID for deterministic 10% sampling and the derived file SHA-256 to identify a revision.
- Enforce source-only baseline retrieval in the Pi file policy, not only in a prompt.
- Use the configured ingestion model for alignment, attribution, and repair.
- Validate all model JSON before changing state or paths.
- Quarantine a negatively contributing path before repair and enforce quarantine in retrieval hints and the chat file policy.
- Repair in a temporary specialist workspace containing `AGENTS.md`, `wiki/`, and `converted/`, but no `raw/`.
- Promote only a candidate rated `FIEL` or `MUITO_ALINHADO`; keep the previous page quarantined otherwise.
- Delete transient answers and conversation context when a verification reaches a terminal state.

## Test seams approved by the architecture

- `createChatEventStreamForSpecialist()` / completed NDJSON stream: response completion and post-response enqueue behaviour.
- Verification persistence interface: eligibility, deterministic sampling, revision forcing, idempotency, and terminal data minimisation.
- `runDueBackgroundJobs()`: backlog promotion, specialist serialization, retries, and runner dispatch.
- Pi file-policy interfaces: derived exclusion, quarantine, traversal, and symlink handling.
- Verification and repair runner interfaces: validated model output, staging isolation, rollback, and promotion.

## Slice order

1. Slice 75 — verified: sampling, durable backlog, source-only default-model baseline.
2. Slice 76 — verified: ingestion-model alignment, attribution, and effective quarantine.
3. Slice 77 — verified: staged repair, post-repair verification, and safe promotion.

## Dependency graph

```text
Completed chat observation
  -> verification selection + durable backlog
     -> source-only baseline
        -> alignment judgement
           -> negative attribution
              -> quarantine
                 -> staged repair
                    -> candidate answer + judgement
                       -> promotion or retained quarantine
```

## Checkpoints

### After Slice 75

- Selected checks survive another active specialist job.
- Baseline uses the default model and cannot read derived pages.
- Client completion remains independent of verification execution.
- Full tests, typecheck, and build pass.

### After Slice 76

- Five-level judgements and attribution JSON are validated.
- Only consulted derived paths can be quarantined.
- Quarantined paths are absent from hints and blocked from direct reads.
- Full tests, typecheck, and build pass.

### After Slice 77

- Repair workspace has no raw directory and cannot mutate the active wiki while preparing.
- Missing official evidence ends in `NEEDS_ADMIN_SOURCE`.
- Only accepted candidates are promoted; failures retain quarantine.
- Full tests, typecheck, build, dependency audit, and production browser verification pass.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Model disagreement is mistaken for derived-page fault | High | Separate alignment and attribution calls; allow an empty negative-path result. |
| Prompt instruction fails to exclude derived pages | High | Enforce exclusion in the tool-call path policy. |
| Model output supplies an arbitrary file path | High | Restrict attribution to the exact consulted-derived allowlist and canonicalize every path. |
| Repair publishes partial knowledge | High | Work in staging; validate the diff and candidate answer before promotion. |
| Verification competes with ingestion or reset | High | Promote through the existing one-active-job-per-specialist mechanism. |
| Private answer text remains indefinitely | High | Keep payload private and clear it on every terminal outcome. |
| A repair repeatedly retriggers itself | Medium | One row per event, one revision record per file hash, bounded retries. |
| LLM cost grows unexpectedly | Medium | Run only forced first checks and the deterministic 10% sample; stop after favourable alignment. |

## Non-goals

- No skill changes.
- No public or admin UI.
- No Internet retrieval or automatic official-source upload.
- No retroactive correction of an answer already delivered.
- No replacement of human legal review.

## Open questions

None. The user approved the objective, boundaries, minimal architecture, model roles, sampling rule, quarantine, and staged promotion.
