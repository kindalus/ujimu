# Ujimu Pi agent skills

## Status

Implemented from approved Slice 01.

## Requirement

Ujimu sessions must expose a deterministic product-owned set of Agent Skills rather than inheriting skills installed in the host user's global agent directories.

The approved bundle contains exactly:

- `llm-wiki`
- `research`
- `unslop`

## Distribution

`llm-wiki` remains an external generated copy. The existing npm lifecycle synchronizes it from the configured `kindalus/skills` source before development, tests, type checking, and builds. The generated directory remains outside Git and the local container build context.

`research` and `unslop` are versioned snapshots under `config/pi/skills`. The user confirmed that their global installations under `~/.agents/skills` are the only official source available. Complete skill directories, including auxiliary files, must be copied when those snapshots are refreshed.

## Runtime architecture

`createUjimuPiSession()` configures Pi's `DefaultResourceLoader` with:

- `noSkills: true` to disable default, project, and global skill discovery.
- `config/pi/skills` as an explicit `additionalSkillPaths` entry.

Pi 0.84.2 continues to load additional skill paths when default skill discovery is disabled. Context-file and extension loading are unaffected.

This design prevents a globally installed skill from overriding a Ujimu skill through a name collision.

## Prompt behaviour

Pi exposes each available skill's name, description, and file path in the model's system prompt. The full `SKILL.md` content is loaded on demand through the `read` tool.

The ingestion flow explicitly asks the model to use `llm-wiki`. The presence of `research` does not add a background-agent executor to Ujimu; it only makes the workflow instructions available.

## Acceptance criteria

- The complete `research` and `unslop` directories match their approved global snapshots.
- The generated `llm-wiki/SKILL.md` matches the approved global version.
- The real Pi resource loader returns exactly `llm-wiki`, `research`, and `unslop` from `config/pi/skills`.
- Skill diagnostics contain no collision or loading errors.
- The production Ujimu session loader passes `noSkills: true`.
- Focused tests, type checking, and production build pass.
