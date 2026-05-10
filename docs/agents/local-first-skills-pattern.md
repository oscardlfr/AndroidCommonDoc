---
scope: [workflow, ai-agents, skills, deployment]
sources: [androidcommondoc]
targets: [all]
slug: local-first-skills-pattern
status: active
layer: L0
parent: agents-hub
category: agents
description: "Local-first skill deployment pattern: when to ship a skill in L1 before L0, lifecycle stages (ship → validate → generalize → promote), promotion trigger criteria, and generalization checklist."
version: 1
last_updated: "2026-05"
assumes_read: claude-code-workflow, spec-driven-workflow
---

# Local-First Skills Pattern

When to deploy a skill in L1 before promoting it to L0, and how to manage the lifecycle from local prototype to shared canonical skill.

## When to Use Local-First (Decision Rubric)

Answer all five questions. If ANY answer is "no" or "unknown", deploy local-first.

1. **Consumer demand confirmed?** Is there ≥1 additional L0/L1/L2 consumer with a confirmed near-term need?
2. **Patterns validated?** Has the skill been invoked successfully in 3+ wave validations?
3. **L0 precedent script exists?** Is there an extracted tool (sh/ps1) the skill can thin-wrap?
4. **Thin-wrap boundary decided?** Is the boundary between SKILL.md orchestration and script logic clearly defined?
5. **Generalization checklist passable?** Can all 10 items in the checklist below be satisfied now?

**Decision tree**: if ANY of the above is "no" → ship local-first (L1). If all five are "yes" → L0 is appropriate.

## Lifecycle Stages

### Stage 1 — Ship in L1

**Location**: `{project}/.claude/skills/{skill-name}/SKILL.md`

Minimum requirements:
- SKILL.md only — no sh/ps1 scripts, no bats, no CI overhead.
- **Thin-wrap contract comment required**: first comment in SKILL.md must read  
  `# thin-wrap: delegates to {tool-or-script} — no parallel implementation`  
  (or state explicitly that no extracted tool exists yet and describe the boundary).
- **Version header required**: document target SDK/toolchain version (e.g., `# AGP 8.x / 9.x`).

Exit criterion: SKILL.md committed, thin-wrap comment present, version header present.

### Stage 2 — Validate via Wave

Run the skill across 3+ successful wave invocations.

Monitor for:
- **Fat-skill drift**: embedded awk/sed/grep pipelines accumulating in SKILL.md → schedule extraction before promotion.
- **AGP/exit-code divergence**: note any SDK version or exit-code edge cases encountered.
- **Pattern stability**: are invocation patterns consistent, or still changing each wave?

Exit criterion: 3+ successful invocations, drift log clean (or documented for promotion).

### Stage 3 — Externalize Config

Identify the project-specific hardcodings to parameterize for L0.

Target 3–6 config fields (typical set: `project_root`, SDK version flag, target scope, error patterns, tuning field).

Run through the Generalization Checklist (see below). Each unchecked item is a promotion blocker.

Exit criterion: all 10 checklist items satisfied.

### Stage 4 — Promote to L0

Full L0 artifact set:
- `skills/{skill-name}/SKILL.md` — generalized, config-driven.
- `skills/{skill-name}/{skill-name}.sh` + `.ps1` — parity scripts.
- `skills/{skill-name}/test/` — bats coverage with mocked toolchain for fast CI.
- Registry rehash (L0-side only — run `node mcp-server/build/cli/generate-registry.js` in AndroidCommonDoc).
- CI integration — add skill invocation to relevant workflow step.

Architect coordination required:
- **arch-platform**: verify lifecycle stage descriptions match SKILL.md conventions.
- **arch-integration**: verify promotion path references correct cross-repo steps.
- **arch-testing**: verify bats coverage meets minimum threshold.

Align exit codes to L0 4-code schema: `0` (pass) / `1` (warn) / `2` (error) / `3` (fatal).

Exit criterion: full artifact set committed, registry rehash run, CI green.

## Promotion Trigger Criteria

All three must be true before initiating Stage 4:

1. Skill invoked successfully in **3+ wave validations**.
2. Implementation patterns **stable** across target SDK/toolchain versions (or version flag clearly isolated).
3. **≥1 additional consumer** with confirmed near-term need.

If criteria are not met after BL-W35 evaluation, file a BL-W{N+2} entry with a calendar-bound deadline. Do NOT defer indefinitely.

## Generalization Checklist

Before promoting from L1 → L0, verify each item:

- [ ] `project_root` parameterized (standard L0 skill field)
- [ ] SDK/toolchain version flag present (e.g., `agp_version`)
- [ ] Target scope parameterized (`module_list` / `--all`)
- [ ] Error patterns externalized (regex override field)
- [ ] Optional tuning field for SDK-specific behavior (e.g., `min_sdk`)
- [ ] Exit codes aligned to L0 4-code schema (0/1/2/3)
- [ ] `.sh` + `.ps1` parity scripts written
- [ ] Bats coverage: mocked toolchain for fast CI tests
- [ ] Registry rehash completed (Stage 4 only)
- [ ] Pattern doc in target domain (e.g., `docs/gradle/`) created

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Harmful | Mitigation |
|---|---|---|
| **Fat SKILL.md** | Embedded awk/sed pipelines resist extraction; promotion debt accumulates | Extract to script at Stage 3; log drift during Stage 2 |
| **Parallel implementation** | If an extracted tool exists, SKILL.md must thin-wrap it — not re-implement it | See `feedback_no_parallel_implementation_extracted_tools.md`; thin-wrap only |
| **Premature L0 ship** | Abstracting before patterns are validated adds L0 maintenance burden with no confirmed consumer | Run all 3 promotion trigger criteria before Stage 4 |
| **Indefinite deferral** | Promotion backlog entries without deadlines are never acted on | File BL-W{N+2} entry atomically; set calendar-bound deadline (e.g., BL-W38 ~2026-07-03) |

## Inaugural Example: `/release-build-verify`

Ships in L1 (`{l1-project}/.claude/skills/release-build-verify/`) during BL-W35.

Purpose: validates R8 strip detection patterns across AGP 8/9 without requiring a full release build.

**Promotion evaluation**: BL-W36 (post-W35 retro) or BL-W38 calendar bound (~2026-07-03).

**Config fields to externalize at promotion** (5 fields):
`project_root`, `agp_version`, `module_list`, `r8_error_patterns`, `min_sdk`

Decision record: see `pr3-advisor-decision.md` in `.planning/wave-bl-w34-l1-security-prep/`.
