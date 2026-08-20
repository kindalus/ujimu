# Unslop in specialist final answers

## Status

Implemented from approved Slice 02.

## Requirement

Every specialist-owned `AGENTS.md` must instruct consultation sessions to read and apply the bundled `unslop` skill before emitting the final answer. This is a specialist-context rule, not a global Pi system-prompt instruction.

## Behaviour

During consultation, the agent must:

1. Ground the answer in the selected specialist wiki.
2. Prepare the factual answer and citations.
3. Read and apply `unslop` before emission.
4. Preserve grounded facts, legal meaning, citations, and the required output structure during the style pass.

The rule does not apply to source conversion or wiki ingestion output.

## New specialist initialization

`buildInitializationPrompt()` includes the requirement in the chat response guidance used to generate `AGENTS.md`.

After the initialization agent finishes, `assertSpecialistInitializedWorkspace()` verifies that:

- `AGENTS.md` exists.
- `wiki/index.md` exists.
- `wiki/log.md` exists.
- `AGENTS.md` contains an `unslop` instruction.

Initialization fails with `WIKI_INITIALIZATION_OUTPUT_MISSING` if the instruction is omitted.

## Existing specialists

Every `AGENTS.md` under the configured specialties root must be updated to include the same rule. At implementation time, the only existing specialist was `legislacao-laboral-angolana`.

## Global system prompt

Ujimu does not add `systemPromptOverride` or `appendSystemPromptOverride` for this behaviour. The bundled skill remains discoverable through Pi's standard available-skills context, and specialist `AGENTS.md` decides when it is used.

## Acceptance criteria

- Initialization prompt tests require the `unslop` instruction.
- Workspace validation rejects an `AGENTS.md` that omits `unslop`.
- Existing specialist context contains the rule.
- Focused tests, type checking, and production build pass.
- A real `openrouter/deepseek/deepseek-v4-flash` consultation opens `unslop/SKILL.md` without a transient invocation instruction.
- The resulting answer remains grounded, cited, structurally valid, and read-only.
