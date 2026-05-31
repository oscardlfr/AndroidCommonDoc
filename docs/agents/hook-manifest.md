---
scope: [agents, hooks, workflow]
sources: [androidcommondoc]
targets: [all]
version: 1
last_updated: "2026-05"
description: "Consumer hook manifest: classifies all 34 L0 hooks as consumer-required / consumer-optional / l0-internal"
slug: hook-manifest
status: active
layer: L0
parent: agents-hub
category: agents
---

# L0 Hook Manifest

Reference classification for all 34 hooks in `.claude/hooks/`. Consumers use this to reconcile their `settings.json` against the full L0 hook set.

> **CI-enforced** — the `hook-manifest-coverage` job in `.github/workflows/drift-audit.yml` fails the build if the hook table below drifts from `.claude/hooks/` (a missing, phantom, or duplicated hook). The table is the source of truth for coverage.

## Three-Tier Status

| Status | Meaning |
|--------|---------|
| `consumer-required` | Hook enforces a topology or safety rule the consumer inherits. Missing registration creates a silent gap. |
| `consumer-optional` | Hook implements a wave-model or advisory feature. Valuable but not universally required. |
| `l0-internal` | Hook is specific to L0 authoring workflows (planner, registry, plan-mode). Do not install in consumer projects. |

## Propagation vs Registration

These are two separate steps — both must be completed for a hook to be active.

**File copy (propagation)**:
- `.js` hooks: copied to the consumer by `/sync-l0` (see `skills/sync-l0/SKILL.md:140-160`). Opt out per-hook via `selection.exclude_hooks` in `l0-manifest.json`.
- `.sh` hooks: NOT in `/sync-l0` scope. `setup/install-hooks.sh` copies exactly 3 files: `detekt-post-write.sh`, `detekt-pre-commit.sh`, `branch-guard.js`.

**settings.json registration**:
- `/sync-l0` registers **nothing** in `settings.json` — it only copies files.
- `install-hooks.sh` auto-registers exactly **2** hooks via python JSON merge: `detekt-post-write.sh` (PostToolUse `Write|Edit`) and `detekt-pre-commit.sh` (PreToolUse `Bash`).
- `branch-guard.js` is copied by `install-hooks.sh` but **not registered**.
- Every other hook (all `/sync-l0`-propagated `.js` hooks, plus the remaining `.sh` hooks) requires **manual** `settings.json` registration.

This is the gap the manifest addresses: files landing on disk is not the same as registration. The L2 consumer project currently registers 5 of 12 consumer-required hooks; 7 are missing.

## Hook Table

### JavaScript Hooks (28)

| Hook | Status | Rationale |
|------|--------|-----------|
| `architect-bash-write-gate.js` | consumer-required | Topology: arch-* cannot bypass dispatch via Bash writes |
| `architect-self-edit-gate.js` | consumer-required | Topology: arch-* cannot Write/Edit project files directly |
| `context-provider-gate.js` | consumer-required | Gating: CP consult required before search ops — see [context-provider-adoption-hooks](context-provider-adoption-hooks.md) |
| `context-provider-consulted.js` | consumer-required | Gating: sets the session flag the gate checks (pair with context-provider-gate) — see [context-provider-adoption-hooks](context-provider-adoption-hooks.md) |
| `premature-execution-gate.js` | consumer-required | Gating: blocks specialist Write/Edit/Bash before APPROVED-PREP verdict |
| `branch-guard.js` | consumer-required | Branch protection: blocks write-git ops on develop/master — see [branch-guard](branch-guard.md) |
| `git-amend-gate.js` | consumer-required | Amend discipline: blocks `git commit --amend` without explicit authorization |
| `addressee-liveness-gate.js` | consumer-required | Agent safety: blocks SendMessage to shutdown or unresponsive peers |
| `tool-use-logger.js` | consumer-required | Observability baseline: writes JSONL entry for every tool call — see [context-provider-adoption-hooks](context-provider-adoption-hooks.md) |
| `wave-phase-gate.js` | consumer-optional | Wave model: blocks push without QG sentinel; blocks arch spawn without PLAN.md |
| `team-completeness-gate.js` | consumer-optional | Wave model: blocks execution if mandatory peers from wave-topology.yaml not spawned |
| `team-topology-gate.js` | consumer-optional | Wave model: records peer spawns; checks mandatory peer coverage |
| `architect-verdict-presence-gate.js` | consumer-optional | Verdict files: blocks arch-* APPROVE without verdict file on disk |
| `commit-scope-validation-gate.js` | consumer-optional | Commit lint: blocks commit if scope not in `.commitlintrc.json` |
| `pre-push-pre-pr-gate.js` | consumer-optional | /pre-pr skill: blocks push unless /pre-pr stamp is fresh and PASS |
| `knowledge-currency-gate.js` | consumer-optional | KMP gating: blocks arch-platform/arch-testing KMP claims without CP marker — see [knowledge-currency-gate](knowledge-currency-gate.md) |
| `agent-delegation-reminder.js` | consumer-optional | Advisory: reminder when Composable .kt edited without ui-specialist |
| `doc-freshness-alert.js` | consumer-optional | Advisory: checks if referenced pattern docs are >90 days stale on .kt edit |
| `plan-md-write-gate.js` | l0-internal | Restricts PLAN.md writes to planner agent only |
| `plan-context.js` | l0-internal | Injects MODULE_MAP.md + agent/skill summary as additionalContext on EnterPlanMode |
| `plan-mode-spawn-planner.js` | l0-internal | Auto-spawns planner on EnterPlanMode |
| `architect-scope-gate.js` | l0-internal | Restricts arch-* Write/Edit to current wave scope files only |
| `kmp-test-runner-gate.js` | l0-internal | Blocks all Gradle test task variants; agents must use kmp-test-runner CLI |
| `specialist-task-completion-gate.js` | l0-internal | Blocks specialists from marking tasks completed directly |
| `bash-cli-spawn-gate.js` | l0-internal | Blocks Bash attempts to spawn Claude agents via --agent-id/--team-name CLI flags |
| `agent-spawn-validator.js` | l0-internal | Validates subagent_type against agents.manifest.yaml + SHA-256 drift |
| `registry-rehash-reminder.js` | l0-internal | Emits reminder to run --update-manifest-hash after agent template edits |
| `kickoff-scope-validator.js` | l0-internal | WARN-only: checks commitlint scopes on *-kickoff.md file writes |

### Shell Hooks (6)

| Hook | Status | Rationale |
|------|--------|-----------|
| `detekt-post-write.sh` | consumer-required | Code quality: runs Detekt on every Kotlin Write/Edit |
| `detekt-pre-commit.sh` | consumer-required | Code quality: validates staged Kotlin files with Detekt before commit |
| `compile-fail-pre-commit.sh` | consumer-required | Code quality: blocks commit on staged .kt files containing `error()` patterns (peer of detekt-pre-commit) |
| `quality-gate-pre-push.sh` | consumer-optional | Quality-stamp workflow: verifies quality-gate.stamp is fresh and PASS before push |
| `registry-pre-commit.sh` | l0-internal | Auto-rehashes registry when L0 agent template files are staged |
| `quality-gate-pre-commit.sh` | l0-internal | Pass-through stub only; stamp check moved to pre-push in BL-W47-prep-3 F4 |

## Cross-References

- `.js` propagation mechanism: `skills/sync-l0/SKILL.md:140-160`
- CP adoption hooks (context-provider-gate, tool-use-logger): [context-provider-adoption-hooks](context-provider-adoption-hooks.md)
- Branch protection hook: [branch-guard](branch-guard.md)
- Knowledge currency gate: [knowledge-currency-gate](knowledge-currency-gate.md)
- Hub: [agents-hub](agents-hub.md)

**Note**: `docs/agents/branch-guard.md`'s propagation section was corrected to match this manifest (it previously claimed `.claude/hooks/` is NOT in `/sync-l0` scope — stale since BL-W47-prep-8).
