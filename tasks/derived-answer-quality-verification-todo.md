# Task list: Derived answer quality verification

## Slice 75 — Sampling and source-only baseline

### Task 1: Persist verification intent and page revision quality

**Acceptance criteria:**
- [x] SQLite stores one verification per question event and quality state per specialist/path/revision.
- [x] Transient payload and terminal result fields are distinct.
- [x] Specialist deletion and hard reset remove associated quality data.

**Verification:** Focused database and analytics acceptance tests passed.

**Dependencies:** None

### Task 2: Select completed derived answers

**Acceptance criteria:**
- [x] Answers without a derived read never enqueue a verification.
- [x] The event-ID selection is stable at 10%, and an unseen revision forces selection.
- [x] Retries cannot duplicate the event or revision intent.

**Verification:** Analytics acceptance tests with fixed event IDs and file contents passed.

**Dependencies:** Task 1

### Task 3: Enforce and run the source-only baseline

**Acceptance criteria:**
- [x] The baseline task uses the default model and read-only tools.
- [x] `wiki/derived/`, traversal aliases, and symlink aliases are blocked.
- [x] The worker records the baseline without exposing it to the client.

**Verification:** Pi policy, session, and background-worker acceptance tests passed.

**Dependencies:** Tasks 1–2

### Slice 75 checkpoint

- [x] Slice deck and `STATUS.md` are updated.
- [x] Full tests, typecheck, and build pass.
- [x] Spec, stress-test, acceptance tests, and implementation are separate commits.

## Slice 76 — Alignment, attribution, and quarantine

### Task 4: Judge alignment with validated output

**Acceptance criteria:**
- [x] The ingestion model receives both answers and their retrieval evidence.
- [x] Exactly five alignment values and bounded reason/confidence fields are accepted.
- [x] Invalid output retries three times without quarantining a page.

**Verification:** Verification-runner acceptance tests passed.

**Dependencies:** Slice 75

### Task 5: Attribute negative derived influence

**Acceptance criteria:**
- [x] Attribution runs only for `ALINHADO` or lower.
- [x] Only derived paths consulted by the original answer can be returned.
- [x] Empty attribution completes without quarantine or repair.

**Verification:** State-transition and hostile-output acceptance tests passed.

**Dependencies:** Task 4

### Task 6: Enforce quarantine in chat

**Acceptance criteria:**
- [x] Negative paths become quarantined before repair begins.
- [x] Retrieval hints omit quarantined paths.
- [x] Chat file policy blocks direct and aliased reads of quarantined paths.

**Verification:** Retrieval-cache, Pi policy, and chat acceptance tests passed.

**Dependencies:** Task 5

### Slice 76 checkpoint

- [x] Slice deck and `STATUS.md` are updated.
- [x] Full tests, typecheck, and build pass.
- [x] Spec, stress-test, acceptance tests, and implementation are separate commits.

## Slice 77 — Staged repair and promotion

### Task 7: Create an isolated repair workspace

**Acceptance criteria:**
- [ ] Staging contains only AGENTS, wiki, and converted content.
- [ ] The active specialist wiki remains byte-identical during candidate preparation.
- [ ] Repair cannot read or write raw or escape staging.

**Verification:** Filesystem and file-policy acceptance tests.

**Dependencies:** Slice 76

### Task 8: Recreate and validate a candidate

**Acceptance criteria:**
- [ ] The ingestion model can replace the target and create missing wiki pages from converted evidence.
- [ ] Existing non-target wiki pages cannot be edited.
- [ ] Invalid output or missing evidence produces a stable recoverable result.

**Verification:** Repair-runner acceptance tests.

**Dependencies:** Task 7

### Task 9: Verify and promote the candidate

**Acceptance criteria:**
- [ ] A candidate answer is compared with the stored baseline.
- [ ] Only `FIEL` or `MUITO_ALINHADO` promotes files and clears quarantine.
- [ ] Failure removes staging, clears transient private data, and leaves the prior page quarantined.

**Verification:** End-to-end verification pipeline tests and real production smoke test.

**Dependencies:** Task 8

### Slice 77 checkpoint

- [ ] Operations documentation, slice deck, and `STATUS.md` are current.
- [ ] Full tests, typecheck, build, and dependency audit pass.
- [ ] Production deploy and real tool-call verification pass.
- [ ] No `llm-wiki` skill file changed.
