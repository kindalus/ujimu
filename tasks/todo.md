# Task List: Isolated Ujimu Agent Skills

## Task 1: Bundle approved global skill snapshots

**Description:** Copy the complete global `unslop` and `research` skill directories into the Ujimu Pi bundle without modifying their content.

**Acceptance criteria:**
- [x] `config/pi/skills/unslop/SKILL.md` matches the global source.
- [x] `config/pi/skills/research/SKILL.md` and `agents/openai.yaml` match the global source.

**Verification:**
- [x] Recursive file lists and SHA-256 hashes match.

**Dependencies:** None

**Files touched:**
- `config/pi/skills/unslop/SKILL.md`
- `config/pi/skills/research/SKILL.md`
- `config/pi/skills/research/agents/openai.yaml`

## Task 2: Specify exact bundled discovery

**Description:** Strengthen the real-loader acceptance test to require exactly the three approved names and Ujimu bundle paths.

**Acceptance criteria:**
- [x] Test expects `llm-wiki`, `research`, and `unslop` only.
- [x] Test confirms every path is inside `config/pi/skills`.
- [x] Test confirms no skill diagnostics.

**Verification:**
- [x] Focused Pi acceptance tests pass.

**Dependencies:** Task 1

## Task 3: Isolate production skill loading

**Description:** Configure Ujimu's session resource loader to disable implicit skill discovery while retaining the explicit bundle path.

**Acceptance criteria:**
- [x] `createUjimuPiSession()` passes `noSkills: true`.
- [x] Explicit bundled skills remain loadable.

**Verification:**
- [x] The production-loader mock assertion and real-loader acceptance test pass.

**Dependencies:** Task 2

## Task 4: Document operation and limitations

**Description:** Explain the three bundled skills, their source and update path, isolation behaviour, and the `research` background-agent limitation.

**Acceptance criteria:**
- [x] Runbook identifies all three skills and their purpose.
- [x] Runbook distinguishes generated and versioned skills.
- [x] Runbook states that global skills are not discovered.

**Verification:**
- [x] `docs/operations.md` and the final spec match approved Slice 01.

**Dependencies:** Tasks 1 and 3

## Checkpoint: Complete

- [x] Bundled skill hashes match the approved sources.
- [x] 20 focused tests pass.
- [x] Typecheck passes.
- [x] Build passes.
- [x] Final code-quality review passes.

The complete suite has 206 passing tests and three known, unrelated failures because test subscriptions expired on 2026-08-16.
