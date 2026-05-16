---
scope: l0
sources: https://agentskills.io/specification
targets: l0
category: skills
slug: agentskills-pilot
---

# Agentskills.io Spec Pilot (Fase A — WARN-only)

## What is agentskills.io?

[agentskills.io](https://agentskills.io/specification) is an open specification for agent skill manifests. It defines a standard schema for `SKILL.md` files — the same convention L0 uses to describe Claude Code skills under `skills/*/SKILL.md`.

The spec defines required and optional fields for each skill manifest, enabling external tooling to validate, index, and compose skills across projects.

## Why WARN-only (Fase A)?

L0 predates the agentskills.io spec. Our `SKILL.md` files carry custom fields (`scope`, `sources`, `targets`, `category`, `slug`, `copilot`, `intent`) that may not be recognized by the upstream validator. Running the validator in blocking mode before understanding the divergence scope would introduce CI failures with no actionable path.

Fase A goal: **observe drift, collect verdicts, no breakage**. The `agentskills-pilot.yml` workflow runs on every push to develop/master and every PR targeting develop, writes a pass/fail table to the GitHub Step Summary, and exits 0 regardless of validation outcome.

Fase B (deferred, requires user authorization) would triage findings, rename or add fields as needed, and potentially promote the step to a CI gate.

## Required SKILL.md fields per agentskills.io spec

From the specification:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Human-readable skill name |
| `description` | Yes | One-line summary of what the skill does |

Additional optional fields defined by the spec may exist — consult the specification for the full schema.

## Known L0 divergences

L0 `SKILL.md` files contain these custom fields **not in the base spec**:

| L0 field | Purpose |
|----------|---------|
| `scope` | Target layer (l0 / l1 / l2) |
| `sources` | Canonical doc references |
| `targets` | Consumer layer(s) |
| `category` | Doc category for vault routing |
| `slug` | Kebab-case identifier for registry + vault |
| `copilot` | Whether skill is available in Copilot mode |
| `intent` | Frontmatter intent tag for `/work` routing |

It is unknown whether the validator rejects unknown keys or ignores them. Fase A CI runs will surface this.

## How to run locally

Requires `uv` installed (`pip install uv` or `brew install uv`):

```bash
bash scripts/sh/agentskills-validate.sh
```

The script iterates all `skills/*/` directories and prints per-skill PASS/WARN verdicts. Exit code is always 0.

To validate a single skill manually:

```bash
uvx --from "git+https://github.com/agentskills/agentskills#subdirectory=skills-ref" \
  skills-ref validate skills/<skill-name>/
```

## Fase B scope (deferred)

Fase B is deferred and requires explicit user authorization before any work begins. Potential scope:

- Triage all WARN findings from Fase A CI runs
- Decide per-field: add to SKILL.md, alias, or request spec extension
- Rename non-compliant fields if the spec rejects unknown keys
- Promote `agentskills-pilot.yml` step to a CI Gate (blocking) after full compliance

**Do not file Fase B backlog unilaterally** — alert team-lead with findings count if Fase A surfaces ≥10 divergent skills.
