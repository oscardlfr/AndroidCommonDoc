---
scope: [adapters, copilot, templates, generation]
sources: [androidcommondoc, adapters/copilot-adapter.sh]
targets: [l0, l1, l2]
slug: copilot-templates-regen
status: active
layer: L0
category: guides
description: "How to regenerate GitHub Copilot prompt templates from canonical SKILL.md definitions via copilot-adapter.sh."
version: 1
last_updated: "2026-05"
---

# Copilot Templates Regeneration

GitHub Copilot prompt templates in `setup/copilot-templates/` are generated from canonical `skills/*/SKILL.md` definitions. When you add, modify, or remove a skill, regenerate to keep the templates in sync.

## When to Regenerate

- After adding a new `SKILL.md` with `copilot: true` in frontmatter
- After changing the `## Usage`, `## Parameters`, or `## Output` sections of an existing skill
- After modifying `skills/params.json` parameter definitions
- Before running `copilot-parity.bats` to verify sync state

## How to Run

### All adapters at once (recommended)

```bash
bash adapters/generate-all.sh
```

This runs both `claude-adapter.sh` and `copilot-adapter.sh` in sequence.

### Copilot only

```bash
bash adapters/copilot-adapter.sh
```

Output lands in `setup/copilot-templates/*.prompt.md`. Files include a
`<!-- GENERATED ... DO NOT EDIT MANUALLY -->` header — manual edits will be
overwritten on the next run.

## Frontmatter Gate

`copilot-adapter.sh` only processes skills with `copilot: true` in their
SKILL.md frontmatter. Skills without this flag are skipped silently.

To add a skill to Copilot, add `copilot: true` to its frontmatter:

```yaml
---
name: my-skill
description: "Does X"
copilot: true
---
```

## Verifying Parity

After regeneration, run the parity test to confirm no drift:

```bash
bash scripts/sh/copilot-parity.sh --project-root "$(pwd)"
```

Or via the CI workflow:

```yaml
copilot-parity:
  uses: <org>/AndroidCommonDoc/.github/workflows/reusable-copilot-parity.yml@master
```

The `scripts/tests/copilot-parity.bats` suite exercises adapter output and parity
script behaviour. Run it with:

```bash
bats scripts/tests/copilot-parity.bats
```

## Adapters Architecture

```
skills/*/SKILL.md          (source of truth)
skills/params.json         (parameter definitions)
        │
        ▼
adapters/copilot-adapter.sh
        │
        ▼
setup/copilot-templates/*.prompt.md   (generated — do not edit)
```

The adapter is idempotent: running it twice with identical inputs produces
identical output, safe to run in CI.

## Cross-References

- Adapter source: `adapters/copilot-adapter.sh`
- Parity script: `scripts/sh/copilot-parity.sh`
- Parity tests: `scripts/tests/copilot-parity.bats`
- CI workflow: `.github/workflows/reusable-copilot-parity.yml`
- Adapters overview: `adapters/README.md`
- Hub: [guides-hub](guides-hub.md)
