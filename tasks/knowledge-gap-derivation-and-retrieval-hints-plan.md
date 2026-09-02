# Implementation Plan: Knowledge Gaps, Derivation, and Retrieval Hints

## Overview

Implement the approved knowledge-improvement workflow without adding an embedding service, vector database, scheduler, or second job system. The plan fixes missing insufficient-context analytics, removes telemetry from the response's critical path, makes chat file access read-only and path-scoped, records unique consulted-document counts, adds a seven-day cache of retrieval paths, and gives administrators an auditable ignored/derived decision per eligible question event.

The canonical task status is `docs/specs/slices/STATUS.md`. This plan is the ordered implementation index and does not duplicate status tracking.

**Plan status:** Approved by the user on 2026-09-01. Implementation is in progress; Slices 65–70 are verified and Slice 71 is next.

## Approved Specifications

- `docs/specs/brainstorm-knowledge-gap-derivation-and-answer-memory.html`
- `docs/specs/knowledge-gap-derivation-and-answer-memory-architecture.html`

## Architecture Decisions

- Keep the existing chat runner, engine, analytics repository, SQLite migration system, and specialist background-job worker.
- Add one internal chat observation carrying the completed outcome and unique successful read paths.
- Keep quota enforcement, conversation history, and Pi session commit synchronous.
- Schedule question analytics and retrieval-hint writes after the response without awaiting them; sanitize and log failures.
- Give chat only `read`, `grep`, `find`, and `ls`; enforce allowed paths in a Pi inline extension.
- Count only successful `read` calls for Markdown content under `wiki/`, excluding `AGENTS.md`, `wiki/index.md`, and `wiki/log.md`; only explicit derivation may also read `converted/`.
- Cache retrieval paths, never prior answers or prior user questions in model context.
- Match cache entries by exact fingerprint first, then Sørensen–Dice character trigrams at `>= 0.85`.
- Expire each cache entry seven days after its last eligible answer and clean expired entries lazily.
- Reuse `background_jobs` for derivation, with a deterministic target path and rollback of the target, index, and log.
- Store final ignored/derived decisions in a separate event-keyed table; retain fingerprint reviews for repeated content gaps.
- Make the state-changing admin action idempotent through a unique database constraint.
- Do not change visitor identity logic; Slice 63 already satisfies the requested browser/account reconciliation.

## Dependency Graph

```text
Slice 65: reliable outcomes + post-response telemetry
  ├── Slice 67: document observation and count
  │     ├── Slice 68: retrieval-hint cache
  │     └── Slice 69: derivation decision and job contract
  │             └── Slice 70: transactional derived execution
  │                     └── Slice 71: admin decision/API/UI
  └── Slice 66: read-only tools + path policy + AGENTS.md rule
        ├── Slice 67
        └── Slice 69
```

## Slice 65: Reliable Gaps and Non-Blocking Telemetry


**Description:** Correctly distinguish a completed insufficient-context answer from a failed stream, and ensure analytics persistence cannot turn an otherwise successful response into `CHAT_STREAM_FAILED`.

**Acceptance criteria:**

- A completed ungrounded response records exactly one `insufficient_context` event.
- A grounded response records `answered`; a failed stream records neither outcome.
- An analytics exception does not alter answer deltas or the terminal `done` event.

**Verification:**

- Focused chat-runner and analytics acceptance tests.
- Full `npm test`, `npm run typecheck`, and `npm run build`.

**Dependencies:** None.

**Likely files:**

- `server/utils/chat/types.ts`
- `server/utils/chat/pi-runner.ts`
- `server/utils/chat/engine.ts`
- `server/utils/analytics/questions.ts`
- `tests/analytics.acceptance.test.ts`
- `tests/chat-pi-runtime-prompt.acceptance.test.ts`

**Estimated scope:** Medium.

## Slice 66: Read-Only Chat and Derived Policy

**Description:** Make chat incapable of modifying specialist workspaces and add the explicit consultation-time derived-page prohibition to future and existing specialist `AGENTS.md` files.

**Acceptance criteria:**

- Chat exposes no `bash`, `write`, `edit`, or conversion tool.
- Chat reads are limited to `AGENTS.md` and `wiki/`; traversal, raw, converted, config, and escaping symlinks are blocked.
- New and production specialist schemas contain the explicit derived-page prohibition.

**Verification:**

- Focused session, path-policy, sandbox, and initialization tests.
- A real temporary Pi session proves a write request is unavailable or blocked.
- Production migration backs up and validates every existing `AGENTS.md`.

**Dependencies:** None; land after Slice 65 to keep one active slice.

**Likely files:**

- `server/utils/pi/session.ts`
- `server/utils/pi/file-policy.ts`
- `server/utils/specialists/initialization.ts`
- `tests/pi-session-logging.acceptance.test.ts`
- `tests/pi-sandboxed-tools.acceptance.test.ts`
- `tests/specialist-initialization-prompt.acceptance.test.ts`

**Estimated scope:** Medium.

## Slice 67: Consulted-Document Count

**Description:** Observe unique successful content-file reads, carry their paths internally, and persist only their count on each completed question analytics event.

**Acceptance criteria:**

- Repeated reads of one eligible file count once.
- Failed reads and excluded/out-of-policy files do not count.
- Existing events migrate to zero; new answered and insufficient-context events store the observed count.

**Verification:**

- Migration test and focused tool-event tests.
- Analytics API serialization test for the additive count field.
- Full quality gate.

**Dependencies:** Slices 65 and 66.

**Likely files:**

- `server/utils/db.ts`
- `server/utils/chat/types.ts`
- `server/utils/chat/pi-runner.ts`
- `server/utils/chat/engine.ts`
- `server/utils/analytics/questions.ts`
- `tests/db.test.ts`
- `tests/analytics.acceptance.test.ts`

**Estimated scope:** Medium.

## Slice 68: Global Retrieval-Hint Cache

**Description:** Cache previously successful wiki paths per normalized specialist question and inject valid paths as untrusted lookup hints on exact or highly similar future questions.

**Acceptance criteria:**

- Exact fingerprint lookup precedes similarity scoring.
- Sørensen–Dice scores at `0.85` hit; scores below `0.85` miss deterministically.
- Expired, cross-specialist, removed, or invalid paths never enter the prompt.
- Prior answer text and prior question text never enter the model context.
- Cache lookup or update failure never fails the chat response.

**Verification:**

- Unit tests for normalization, trigram Dice, tie-breaking, and TTL.
- Integration tests inspect the effective Pi prompt.
- Deletion tests cover source event, conversation, and specialist cleanup.

**Dependencies:** Slices 65–67.

**Likely files:**

- `server/utils/db.ts`
- `server/utils/chat/retrieval-cache.ts`
- `server/utils/chat/engine.ts`
- `server/utils/chat/pi-runner.ts`
- `server/utils/chat/types.ts`
- `tests/analytics.acceptance.test.ts`
- `tests/chat-pi-runtime-prompt.acceptance.test.ts`

**Estimated scope:** Medium.

## Slice 69: Derived Job Contract

**Description:** Extend the existing specialist job worker with one event-keyed, deterministic derivation intent and an injectable runner, without performing real model-driven filesystem writes yet.

**Acceptance criteria:**

- Only an answered event with more than three consulted documents can be queued.
- Concurrent attempts create one final decision, deterministic target, and job.
- A fake runner drives succeeded/failed states; retry preserves the decision and target.

**Verification:**

- Background-job migration, eligibility, locking, concurrency, retry, and prompt tests.
- Full quality gate.

**Dependencies:** Slices 66 and 67.

**Likely files:**

- `server/utils/db.ts`
- `server/utils/jobs/background.ts`
- `server/utils/analytics/derivation.ts`
- `server/utils/pi/session.ts`
- `tests/admin.acceptance.test.ts`
- `tests/analytics.acceptance.test.ts`

**Estimated scope:** Medium.

## Slice 70: Transactional Derived Execution

**Description:** Implement the real derivation runner with an exact write allowlist, three-file snapshot, OKF validation, and rollback.

**Acceptance criteria:**

- Tool calls cannot write outside the deterministic derived target, `wiki/index.md`, or `wiki/log.md`.
- Success creates exactly one valid OKF page and updates index/log.
- Insufficient evidence, invalid output, or a forbidden write restores all prior file contents.
- Retry uses the same target and cannot create a duplicate page.

**Verification:**

- Focused filesystem, path-escape, malformed-output, rollback, and retry tests.
- Temporary specialist integration test with attempted forbidden writes.
- Full quality gate.

**Dependencies:** Slices 66 and 69.

**Likely files:**

- `server/utils/analytics/derivation.ts`
- `server/utils/jobs/background.ts`
- `server/utils/pi/file-policy.ts`
- `tests/analytics.acceptance.test.ts`

**Estimated scope:** Medium.

## Slice 71: Admin Multi-Source Curation

**Description:** Expose eligible multi-source question events in admin analytics and let an administrator make one final ignored/derived decision with visible job progress and retry.

**Acceptance criteria:**

- The new section lists only unanswered-decision `answered` events with a count greater than three.
- Ignored creates no job; derived creates exactly one job.
- Repeating the same decision is idempotent; attempting the opposite decision returns `409`.
- Failed derivation shows a sanitized failure and can retry without changing the decision.

**Verification:**

- API authorization, validation, idempotency, race, and retry tests.
- UI acceptance tests for Portuguese copy and states.
- Chrome DevTools verification of loading, actions, errors, and accessibility.
- Full quality gate and production smoke test.

**Dependencies:** Slices 67, 69, and 70.

**Likely files:**

- `server/utils/analytics/questions.ts`
- `server/api/admin/analytics/questions/[eventId]/action.post.ts`
- `server/api/admin/analytics/questions/[eventId]/retry.post.ts`
- `utils/admin-ui.ts`
- `pages/admin/analytics.vue`
- `tests/analytics.acceptance.test.ts`
- `tests/admin-ui.acceptance.test.ts`

**Estimated scope:** Medium.

## Checkpoints

### After Slices 65–67: Observation Foundation

- All existing tests plus outcome/path/count acceptance tests pass.
- Chat cannot mutate or read forbidden specialist paths.
- Analytics failure cannot produce a visible chat failure.
- Production specialist schemas are backed up and updated.

### After Slice 68: Retrieval Hints

- Exact, similar, expired, invalid-path, and cross-specialist cases pass.
- No previous answer or previous user question appears in a new model prompt.
- No scheduler, embedding dependency, or vector store was added.

### After Slices 69–71: Curated Derivation

- Admin decisions are authorized, atomic, idempotent, and auditable.
- Derived filesystem changes are path-scoped, validated, and rollback-safe.
- UI behavior is verified in a real browser.
- Full test, typecheck, build, audit, container, and production health checks pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The model omits the explicit terminal outcome | Gaps may be undercounted | Require the protocol in the technical prompt and specialist schema; preserve a conservative fallback rather than phrase matching. |
| Tool paths escape through traversal or symlink | Cross-scope read/write | Canonicalize existing targets and parent directories; block on uncertainty through the Pi `tool_call` policy. |
| Fire-and-forget telemetry is lost on process exit | Missing analytics/cache rows | Accept as the explicit simplicity trade-off; log execution failures and do not move functional history out of the synchronous path. |
| Similar lexical questions are not semantically equivalent | Misleading retrieval hints | Use a high `0.85` threshold; provide paths only; require the agent to reread and verify all claims. |
| Derived job partially modifies files | Wiki inconsistency | Deterministic target, three-file snapshot, path allowlist, post-validation, and rollback. |
| Two admins act concurrently | Duplicate or conflicting action | Claim `event_id` atomically with a primary key; same action replays, opposite action returns `409`. |
| Existing specialist schemas drift | Chat behavior differs by specialist | Back up and append one canonical managed rule during deployment; validate all workspaces afterward. |

## Explicit Non-Goals

- No answer cache or cross-user answer injection.
- No embeddings, vector database, FTS, or LLM similarity judge.
- No weekly scheduler; seven-day TTL is evaluated lazily.
- No automatic creation of derived pages from chat.
- No change to visitor identity or monthly distinct-visitor counting.
- No asynchronous quota, history, or Pi session commit.
- No refactor of unrelated analytics, ingestion, or admin code.
