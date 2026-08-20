# Current state: unslop in specialist answers

## Specialist context generation

New specialist workspaces are initialized by the Pi-backed runner in `server/utils/specialists/initialization.ts`. Its prompt asks the agent to create `AGENTS.md`, `wiki/index.md`, and `wiki/log.md` and to include persona, wiki grounding, citation, and chat response guidance.

The initialization prompt currently mentions the `llm-wiki` skill but does not instruct consultation sessions to read or apply `unslop` before composing their final answer.

`assertSpecialistInitializedWorkspace()` validates only that the three required files exist. It does not validate required `AGENTS.md` content.

## Existing specialist workspaces

The configured specialties root currently contains one `AGENTS.md`:

```text
~/.local/share/ujimu/specialties/legislacao-laboral-angolana/AGENTS.md
```

Its chat response protocol governs wiki grounding and NDJSON output. It does not mention `unslop`.

## Runtime skill availability

Ujimu's isolated skill bundle exposes exactly `llm-wiki`, `research`, and `unslop`. Pi lists their names, descriptions, and paths in the session system prompt. The full skill content is loaded only when the model reads its `SKILL.md`.

A DeepSeek consultation without a direct invocation instruction did not read any skill file. A subsequent one-off test proved that the same agent can read all three skill files when asked explicitly.

## Global prompt state

The Ujimu session resource loader does not configure `systemPromptOverride` or `appendSystemPromptOverride`. No persistent global instruction to invoke skills was added. Existing tests assert this absence for consultation, ingestion, and initialization sessions.

## Confirmed target

- New specialist `AGENTS.md` files must require consultation sessions to read and apply `unslop` before emitting the final answer.
- The style pass must preserve grounded facts, legal meaning, citations, and machine-readable output structure.
- Initialization must fail validation if the generated `AGENTS.md` omits `unslop`.
- Existing specialist `AGENTS.md` files must receive the same rule.
- The global system prompt must remain unchanged.
