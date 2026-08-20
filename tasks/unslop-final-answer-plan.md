# Implementation Plan: Unslop for specialist final answers

## Overview

Persist the approved `unslop` instruction in specialist-owned `AGENTS.md` context, validate it during new-specialist initialization, update existing specialist context, and verify the behaviour with the configured DeepSeek model. Do not add a global system-prompt override.

## Architecture decisions

- Put the rule in `AGENTS.md`, where specialist consultation behaviour already lives.
- Make the initialization prompt explicit and validate the generated file so omission cannot silently pass.
- Preserve facts, legal meaning, citations, and NDJSON structure during the style pass.
- Update existing specialist files directly because they are runtime data outside the repository.
- Keep global session prompt composition unchanged.

## Tasks

1. Extend initialization prompt tests and workspace validation tests with the `unslop` requirement.
2. Update initialization prompt and validator.
3. Update every existing specialist `AGENTS.md` under the configured specialties root.
4. Run focused tests, typecheck, and build.
5. Repeat the real DeepSeek consultation without a transient skill-loading instruction and inspect tool calls, grounding, citations, and file hashes.

## Risks

| Risk | Mitigation |
| --- | --- |
| Style revision changes legal meaning | Explicitly prohibit changes to facts, legal meaning, citations, or output structure. |
| Agent ignores the generated-context requirement | Validate that `AGENTS.md` contains `unslop`. |
| Global prompt is changed accidentally | Retain and run existing assertions that `appendSystemPromptOverride` is absent. |
| Existing runtime data drifts from the creation policy | Update every currently discovered specialist `AGENTS.md`. |
