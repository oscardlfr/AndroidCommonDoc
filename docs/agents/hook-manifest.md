---
scope: [agents, hooks, workflow]
sources: [androidcommondoc]
targets: [all]
version: 4
last_updated: "2026-08"
description: "Consumer hook manifest: classifies all 37 L0 hook files as consumer-required / consumer-optional / l0-internal"
slug: hook-manifest
status: active
layer: L0
parent: agents-hub
category: agents
---

# L0 Hook Manifest

Reference classification for all 37 hook files in `.claude/hooks/`. Consumers use this to reconcile their `settings.json` against the full L0 hook set.

> **CI-enforced** — the `hook-manifest-coverage` job in `.github/workflows/drift-audit.yml` fails the build if the hook table below drifts from `.claude/hooks/` (a missing, phantom, or duplicated hook). The table is the source of truth for coverage.

## Three-Tier Status

| Status | Meaning |
|--------|---------|
| `consumer-required` | Hook enforces a topology or safety rule the consumer inherits. Missing registration creates a silent gap. |
| `consumer-optional` | Hook implements a wave-model or advisory feature. Valuable but not universally required. |
| `l0-internal` | L0 authoring hook or hook runtime helper. Do not register as a consumer hook; helper files may still be copied when propagated hooks import them. |

## Propagation vs Registration

These are two separate steps — both must be completed for a hook to be active.

**File copy (propagation)**:
- `.js` hooks: copied to the consumer by `/sync-l0` (see `skills/sync-l0/SKILL.md:140-160`). Opt out per-hook via `selection.exclude_hooks` in `l0-manifest.json`.
- `.js` runtime helpers: copied as files when imported by propagated hooks, but never registered in `settings.json`.
- `.sh` hooks: NOT in `/sync-l0` scope. `setup/install-hooks.sh` copies exactly 3 files: `detekt-post-write.sh`, `detekt-pre-commit.sh`, `branch-guard.js`.

**settings.json registration**:
- `/sync-l0` registers **nothing** in `settings.json` — it only copies files.
- `install-hooks.sh` auto-registers exactly **2** hooks via python JSON merge: `detekt-post-write.sh` (PostToolUse `Write|Edit`) and `detekt-pre-commit.sh` (PreToolUse `Bash`).
- `branch-guard.js` is copied by `install-hooks.sh` but **not registered**.
- Every other hook (all `/sync-l0`-propagated `.js` hooks, plus the remaining `.sh` hooks) requires **manual** `settings.json` registration.

This is the gap the manifest addresses: files landing on disk is not the same as registration. The L2 consumer project currently registers 5 of 12 consumer-required hooks; 7 are missing.

## Hook Table

### JavaScript Hooks (33)

| Hook | Status | Rationale |
|------|--------|-----------|
| `architect-bash-write-gate.js` | consumer-required | Topology: arch-* cannot bypass dispatch via Bash writes |
| `architect-self-edit-gate.js` | consumer-required | Topology: arch-* cannot Write/Edit project files directly |
| `context-provider-gate.js` | consumer-required | Gating: CP consult required before search ops; post-PLAN, a deeper branch (T-BUG-015/BL-W35-06) additionally requires a genuine `consult/v2`→`result/v2`→`accepted-result.json` transaction correlated to the caller's own `{role,agent_id,session_id}` before Read on `docs/agents/**`/`docs/adr/**` — specialists take a lighter "reporting-architect-has-a-current-accepted-result" branch instead of their own transaction — see [context-provider-adoption-hooks](context-provider-adoption-hooks.md) and [runtime-messaging-protocol](runtime-messaging-protocol.md) |
| `context-provider-consulted.js` | consumer-required | Gating: sets the session flag the gate checks (pair with context-provider-gate) — see [context-provider-adoption-hooks](context-provider-adoption-hooks.md) |
| `context-provider-write-gate.js` | consumer-required | Gating: confines context-provider's sole write capability (publishing its own nested-consultation `result/v2` via `write-bundle.sh`) — CP's read-only boundary otherwise stays intact — see [runtime-messaging-cp-writer](runtime-messaging-cp-writer.md) |
| `runtime-consultation-target-gate.js` | consumer-required | Gating: resolves target lifecycle-ready state plus every native target claim/lease/result/stop-ack grant for the Wave-1 consultation protocol — see [runtime-messaging-state-machine](runtime-messaging-state-machine.md) |
| `agent-spawn-execution-gate.js` | consumer-required | Topology: PreToolUse gate on the `Agent` tool, main-orchestrator context only. Before a real `Agent()` call executes for a genuine role-lifecycle action ("owning" call — some pending action truly exists for the exact `subagent_type` named), atomically reserves that action via a no-clobber execution-claim record, revalidating binding/PLAN/session/role/expiry fresh. Every other `Agent()` call ("non-owning" — the overwhelming majority of ordinary ad-hoc specialist/architect dispatch) is silent pass-through with zero side effects, governed only by other hooks (`agent-spawn-validator.js` etc.) — see [runtime-messaging-drivers](runtime-messaging-drivers.md) |
| `hook-control-plane-utils.js` | l0-internal | Shared CommonJS runtime dependency for propagated hooks; copy with importing hooks, never register in `settings.json` |
| `coordination-artifact.js` | l0-internal | Shared CommonJS runtime dependency for propagated hooks (read/validate coordination artifacts — consult/result/request/approval/stop/message; writes are owned by `write-coordination-artifact.sh`, not this module); copy with importing hooks, never register in `settings.json` — see [coordination-artifact-schema](coordination-artifact-schema.md) |
| `premature-execution-gate.js` | consumer-required | Gating: blocks specialist Write/Edit/Bash before APPROVED-PREP verdict |
| `branch-guard.js` | consumer-required | Branch protection: blocks write-git ops on develop/master — see [branch-guard](branch-guard.md) |
| `git-amend-gate.js` | consumer-required | Amend discipline: blocks `git commit --amend` without explicit authorization |
| `addressee-liveness-gate.js` | consumer-required | Agent safety: blocks SendMessage to shutdown or unresponsive peers |
| `tool-use-logger.js` | consumer-required | Observability baseline: writes JSONL entry for every tool call — see [context-provider-adoption-hooks](context-provider-adoption-hooks.md) |
| `wave-phase-gate.js` | consumer-optional | Wave model: blocks push without QG sentinel; blocks arch spawn without PLAN.md |
| `team-completeness-gate.js` | consumer-optional | RETIRED — named-team roster floor obsolete; no-op tombstone, unregistered from settings.json |
| `team-topology-gate.js` | consumer-optional | RETIRED — named-team roster floor obsolete; no-op tombstone, unregistered from settings.json |
| `architect-verdict-presence-gate.js` | consumer-optional | Verdict files: blocks arch-* APPROVE without verdict file on disk |
| `commit-scope-validation-gate.js` | consumer-optional | Commit lint: blocks commit if scope not in `.commitlintrc.json` |
| `push-authorization-gate.js` | consumer-required | Push gate: **best-effort early-block** of peer/subagent `git push` — catches direct `git push`, `rtk git push`, compound commands, and common shell-exec wrappers (`sh -c`, `eval`, `$(…)`); string-parsing cannot be exhaustive (ANSI-C escapes, variable indirection, language interpreters remain). **Primary enforcement is the git-layer `pre-push` hook** (see Git-Layer Hooks below) — fires on every actual push via `emit-push-proof.sh verify-proof`, but only once bootstrapped per clone via `install-git-hooks.sh`/`make install-git-hooks` (git never auto-installs hooks — see [qg-proof-push-gate](qg-proof-push-gate.md)). For the main orchestrator, this Claude-layer hook delegates to `scripts/sh/verify-git-hooks.sh` and BLOCKS (fail-closed) when that git-layer hook is absent, non-executable, unmarked, or drifted from canonical — it does **not** fall back to any in-JS proof re-verification (wave `push-authority-bootstrap` removed that ~205-LOC fallback entirely). Honest contract: no **normal branch** push without proof the canonical QG ran for real over HEAD (the pre-push hook exempts branch deletions, tags, protected-branch merge refs, and `SKIP_PUSH_GATE=1`) — NOT peer-identity enforcement; identity-aware provenance enforcement is deferred to a future harness gate. Replaces legacy `pre-push-pre-pr-gate.js` + `quality-gate-pre-push.sh` |
| `subagent-start-context-bundle.js` | consumer-optional | SubagentStart adapter: injects context bundle as additionalContext on teammate spawn/wake; absent or stale bundle → fail-open silently |
| `knowledge-currency-gate.js` | consumer-optional | KMP gating: blocks arch-platform/arch-testing KMP claims without CP marker — see [knowledge-currency-gate](knowledge-currency-gate.md) |
| `agent-delegation-reminder.js` | consumer-optional | Advisory: reminder when Composable .kt edited without ui-specialist |
| `doc-freshness-alert.js` | consumer-optional | Advisory: checks if referenced pattern docs are >90 days stale on .kt edit |
| `plan-md-write-gate.js` | l0-internal | Restricts PLAN.md writes to planner agent only |
| `plan-context.js` | l0-internal | Injects MODULE_MAP.md + agent/skill summary as additionalContext on EnterPlanMode |
| `plan-mode-spawn-planner.js` | l0-internal | Auto-spawns planner on EnterPlanMode |

| `kmp-test-runner-gate.js` | l0-internal | Blocks all Gradle test task variants; agents must use kmp-test-runner CLI |
| `specialist-task-completion-gate.js` | l0-internal | Blocks specialists from marking tasks completed directly |
| `bash-cli-spawn-gate.js` | l0-internal | Blocks Bash attempts to spawn Claude agents via --agent-id/--team-name CLI flags; covered by `scripts/tests/bash-cli-spawn-gate.bats` (closes a prior zero-coverage gap — proves canonical render/parse round-trip for spaces/apostrophes/metacharacters plus exact pending `session-run --action`, while non-canonical quoting/operators/near-matches/raw-spawn/background variants fail) |
| `agent-spawn-validator.js` | l0-internal | Validates subagent_type against agents.manifest.yaml + SHA-256 drift |
| `registry-rehash-reminder.js` | l0-internal | Emits reminder to run --update-manifest-hash after agent template edits |
| `kickoff-scope-validator.js` | l0-internal | WARN-only: checks commitlint scopes on *-kickoff.md file writes |

### Shell Hooks (4)

| Hook | Status | Rationale |
|------|--------|-----------|
| `detekt-post-write.sh` | consumer-required | Code quality: runs Detekt on every Kotlin Write/Edit |
| `detekt-pre-commit.sh` | consumer-required | Code quality: validates staged Kotlin files with Detekt before commit |
| `compile-fail-pre-commit.sh` | consumer-required | Code quality: blocks commit on staged .kt files containing `error()` patterns (peer of detekt-pre-commit) |
| `registry-pre-commit.sh` | l0-internal | Auto-rehashes registry when L0 agent template files are staged |

> **Note on specialist toolsets**: specialist agent templates do not include the `Grep` tool in their toolset. The `Grep` leg of `context-provider-gate.js` is therefore structurally unreachable for specialists — they are gated via the `claude-arch-responded-{session}-{type}.flag` path instead. Consumers adapting this gate for non-specialist agent types should verify their toolset includes `Grep` before relying on that leg.


## Verdict Canal Script (NOT in this manifest)

`scripts/sh/write-verdict.sh` — verdict canal script; invoked by architects via Bash to write PREP and VERIFY-FINAL verdicts to `.planning/wave-{slug}/arch-{role}-verdict.md`. Not a git hook and not a Claude Code hook. Not included in the CI hook-manifest-coverage count. See [agent-verdict-protocol](agent-verdict-protocol.md) for invocation details.

## Git-Layer Hooks (NOT in this manifest)

This manifest covers only `.claude/hooks/` (Claude Code hooks). The repository also ships **git hooks** in `scripts/sh/`, installed via `install-git-hooks.sh`. These are separate:

| Git Hook | Script | What it enforces |
|----------|--------|-----------------|
| `pre-commit` | `scripts/sh/pre-commit-hook.sh` | Registry hash freshness + manifest drift |
| `commit-msg` | `scripts/sh/commit-msg-hook.sh` | Conventional Commits format + scope whitelist (UNIVERSAL — fires for all committers, closes the team-peer bypass in `commit-scope-validation-gate.js`) |
| `pre-push` | `scripts/sh/pre-push-hook.sh` | Fail-CLOSED push gate — UNIVERSAL backstop below the Claude-layer push gates, fires for every push from the clone regardless of agent identity. Exempt: deletions, tags, refs/heads/{develop,master,main} (PR-merge flow). Layer 1: two-stamp validation — quality-gate.stamp + pre-pr.stamp PASS, ≤30 min, HEAD match. Layer 2: QG-proof verification — `emit-push-proof.sh --subcommand verify-proof --pushed-sha $sha` checks push-proof.json schema, HEAD match, freshness, manifest-version, step coverage, and report digest. Missing proof or absent verifier → BLOCK (no fallback path). Bypass: `SKIP_PUSH_GATE=1` — logged to push-proof.log (fail-OPEN). See [qg-proof-push-gate](qg-proof-push-gate.md) |

> **Why two scope gates?** `commit-scope-validation-gate.js` (PreToolUse) only intercepts the main orchestrator's commits. `commit-msg-hook.sh` is authoritative — it fires for every committer in the clone via git's native hook mechanism. See [pre-commit-hooks](../guides/pre-commit-hooks.md#three-layer-commit-scope-enforcement) for the full three-layer table.

The `hook-manifest-coverage` CI guard (prep-22) counts only `.claude/hooks/` entries — git hooks are excluded and do not affect coverage counts.

## Cross-References

- `.js` propagation mechanism: `skills/sync-l0/SKILL.md:140-160`
- CP adoption hooks (context-provider-gate, tool-use-logger): [context-provider-adoption-hooks](context-provider-adoption-hooks.md)
- Branch protection hook: [branch-guard](branch-guard.md)
- Knowledge currency gate: [knowledge-currency-gate](knowledge-currency-gate.md)
- Commit-scope + git-layer hooks: [pre-commit-hooks](../guides/pre-commit-hooks.md)
- Runtime-messaging consultation/state-machine/CP-writer/drivers hooks: [runtime-messaging-adapters](runtime-messaging-adapters.md)
- Hub: [agents-hub](agents-hub.md)

**Note**: `docs/agents/branch-guard.md`'s propagation section was corrected to match this manifest (it previously claimed `.claude/hooks/` is NOT in `/sync-l0` scope — stale since BL-W47-prep-8).
