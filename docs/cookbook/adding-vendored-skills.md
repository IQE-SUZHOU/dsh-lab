# Cookbook: vendoring an external skill set

English | [中文](adding-vendored-skills.zh.md)

This repository carries a second-party skill set: the AMD GPU skills from `amd/skills`, copied into `.agents/skills/`. This guide states how a batch is copied, how a checkout proves the copy is usable, and how a session invokes it. [subsystems/skills.md](../subsystems/skills.md) owns discovery ranks, invocation policy, and the `skill` tool contract; [adding-a-vendored-package.md](adding-a-vendored-package.md) is the equivalent procedure for vendored source packages.

## 1. Copy the skill directories in

One skill is one directory holding `SKILL.md`, plus that skill's own `references/`, `scripts/`, `templates/`, and `evals/` children. Copy each directory verbatim under `.agents/skills/<name>/`, kebab-case name unchanged:

```
.agents/skills/<name>/
  SKILL.md         # YAML frontmatter: name, description (+ optional whenToUse, metadata)
  reference.md     # optional supporting material the body links to
  scripts/         # optional executables the body invokes
  evals/           # optional upstream evaluation fixtures
  .federated.json  # optional upstream coordinates shipped by the source repository
```

Copy the whole directory rather than `SKILL.md` alone: a body that links `reference.md` or runs `scripts/detect.py` is unusable without them. Keep the upstream name, because the frontmatter `name` must equal the directory name, and the `skill` tool addresses skills by that name.

`.agents/skills` is rank 200 (`project-agents`) in the local provider's scan order, below `<projectRoot>/.dsh/skills` and above every user-level root. A vendored skill therefore wins over a same-named skill in a user's own skill directory, and a repository-authored skill at rank 100 still wins over it.

## 2. Record the provenance

`scripts/vendored-skills.manifest.json` is the single source for the vendored list. It pins the batch to one commit of the source repository and one commit per skill, so a later refresh can diff what changed:

```json
{
  "vendored_from": { "repo": "amd/skills", "ref": "main", "commit": "ff5f4cc", "source_commit_date": "2026-11-05T13:22:55-07:00", "imported_at": "2026-11-06" },
  "skills": [
    { "name": "rocm-doctor", "upstream": { "repo": "ROCm/rocm-cli", "ref": "main", "commit": "e6d2f7c0d7", "license": "MIT" } }
  ]
}
```

Each `upstream` entry is that skill's own origin. `amd/skills` federates most of its skills from the project that owns the tooling — `rocm-doctor` comes from `ROCm/rocm-cli`, `tracelens-analysis-orchestrator` from `AMD-AGI/TraceLens` — and ships those coordinates in the directory's `.federated.json`. Copy them into the manifest instead of attributing every skill to the aggregator repository. A skill the source repository authored itself records `amd/skills` as its upstream.

Licenses come from the same record. Keep `license` as `null` only when the source names none for that skill, and check the aggregator's own license before publishing a vendored batch in a redistributed fork.

## 3. Prove the copy works

Discovery reads the built `lib/` output of the skill packages, so build before the check:

```sh
pnpm install
pnpm run build
pnpm run verify-vendored-skills
```

The check boots the shipped registry and local provider over this repository, then for every name in the manifest asserts four facts: the skill is discovered, it won from `project-agents`, `ctx.skills.get()` loads it, and the loaded body is non-trivial. It prints one `sha256` prefix per `SKILL.md`, so a green run identifies the exact bytes that were loaded, and it never prints a skill body. `scripts/vendored-skills.spec.ts` runs the same assertions inside the unit suite.

| Check | What it proves |
|---|---|
| `verify-vendored-skills` | every manifest name is discovered from `project-agents` and loads |
| `vendored-skills.spec.ts` | the manifest is well-formed, and each `SKILL.md` names its own directory |
| `verify-skill-invocation-metadata` | Codex and Claude invocation metadata stay aligned for skills that ship `agents/openai.yaml` |

## 4. Use a vendored skill in a session

The `skill` tool is available in the shipped profiles, and each session's skill catalog is the discovery result for that session's working directory. Start the harness inside this checkout and the vendored skills are in the catalog with their descriptions; the model loads a body only when a task names or clearly matches one. In a chat session, typing `/rocm-doctor` invokes the skill directly. From a shell:

```sh
pnpm dsh headless "Use the rocm-doctor skill to diagnose this ROCm install"
```

The body is instructions for the agent, so a skill's value depends on the tools it drives. `rocm-doctor` requires the `rocm` CLI on the machine the session runs on; `serving-llms-on-instinct` requires an AMD Instinct GPU and a ROCm install. A missing prerequisite makes the skill report that it cannot proceed — that is the skill working as written, not a discovery failure.

## 5. What a vendored body must satisfy

- Frontmatter needs `name` and `description`; `name` is kebab-case and equals the directory name. A body whose frontmatter is missing, unparseable, or missing either field is skipped with a warning and never reaches a catalog.
- Description is routing text. The catalog renders it truncated at `tool-skill`'s `catalogDescriptionMaxLength`, so a description that hides the trigger conditions makes the skill harder to reach, and an over-long one loses its tail.
- Only two invocation keys are read: `disable-model-invocation` and `user-invocable`. An unknown key such as `allowed-tools` or `license` is ignored rather than rejected, so upstream frontmatter loads unchanged; a camelCase spelling of either invocation key is rejected outright.
- Skill lookup is one level deep. `<name>/SKILL.md` and a flat `<name>.md` are skills; a nested `references/<x>/SKILL.md` is not discovered. Upstream repositories that nest their own sub-skills, such as the analyzers under `tracelens-analysis-orchestrator/agents/`, contribute instructions the loaded body reads as files, not extra catalog entries.

## 6. Refresh the vendored batch

Re-copy from the pinned commit's successor and update the manifest in the same change, so the record never describes bytes the tree does not contain:

1. Fetch the source repository and record its new commit in `vendored_from`.
2. Replace each skill directory wholesale rather than merging file by file, then re-read every `.federated.json` into `skills[].upstream`.
3. Run `pnpm run verify-vendored-skills` and `pnpm run verify-skill-invocation-metadata`.
4. Compare the printed `SKILL.md` digests against the previous run to see which bodies actually changed, and review each changed body before publishing.

A vendored skill is upstream text, not repository policy. Local edits to a vendored `SKILL.md` must be recorded in the manifest entry that carries them, otherwise the next refresh silently reverts them.
