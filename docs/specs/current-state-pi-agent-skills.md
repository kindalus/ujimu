# Current state: Pi agent skills

## Purpose

This document records the existing Pi skill distribution and loading behaviour before the isolated Ujimu skill bundle is implemented.

## Runtime loading

`createUjimuPiSession()` in `server/utils/pi/session.ts` creates a `DefaultResourceLoader` with:

- The selected specialist directory as `cwd`.
- The mutable Ujimu configuration directory as `agentDir`.
- `config/pi/skills` as an additional skill path.
- `config/pi/extensions` as an additional extension path.

The runtime does not currently set `noSkills: true`. Pi therefore discovers global skills in addition to the Ujimu bundle. In the inspected development environment, 45 skills were discovered and 42 were exposed to the model.

## Name collisions

Both the global agent environment and the Ujimu bundle contain a skill named `llm-wiki`. Pi reports a name collision and keeps the global copy. The bundled Ujimu copy is therefore not guaranteed to be the version used by a session.

At the time of this assessment, the global and bundled `llm-wiki/SKILL.md` files have the same SHA-256 hash:

```text
75288861a6c182948c01c9ebf8969a5607857e4f35e024b38590e6611d3fde9d
```

The collision remains a correctness risk even though the files currently match.

## Skill distribution

### llm-wiki

`scripts/sync-llm-wiki.mjs` synchronizes `llm-wiki` into `config/pi/skills/llm-wiki`.

- The generated directory is ignored by Git and by the container build context.
- npm lifecycle hooks synchronize it before development, tests, type checking, and builds.
- The default external source is `https://github.com/kindalus/skills.git`, subdirectory `skills/llm-wiki`.
- A local source directory or a pinned Git ref can be selected through environment variables.
- Container builds synchronize the skill inside the build stage.

### unslop and research

`unslop` and `research` exist only in the global agent skill directory, `~/.agents/skills`, and are absent from the Ujimu bundle. The user confirmed that no other official source exists for these two skills.

`research` also contains `agents/openai.yaml` in addition to `SKILL.md`. `unslop` contains only `SKILL.md`.

## Prompt exposure

Pi places each discovered skill's name, description, and path in the system prompt. The full `SKILL.md` content is loaded only when the model uses the `read` tool on the listed path.

The ingestion prompt explicitly tells the model to use `llm-wiki`. The consultation prompt does not explicitly invoke a skill.

## Tests

`tests/pi-agent-pipeline.acceptance.test.ts` already constructs an isolated loader with `noSkills: true` and the bundled skill path. It currently expects `llm-wiki` to be the only available skill. The production session loader does not yet use the same isolation option.

`tests/llm-wiki-sync-script.acceptance.test.ts` covers conditional and forced `llm-wiki` synchronization plus npm, Git-ignore, container, and environment wiring.

## Confirmed target

The approved architecture is:

- Keep the existing external synchronization process for `llm-wiki`.
- Copy and version the confirmed global snapshots of `unslop` and `research` under `config/pi/skills`.
- Disable implicit skill discovery in Ujimu sessions.
- Continue loading the Ujimu bundle through `additionalSkillPaths`.
- Expose exactly `llm-wiki`, `unslop`, and `research` to the model.
