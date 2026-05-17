# BL-W47 — Adaptive Harness Redesign Plan

> **Status**: PLANNED — requires its own clean session. DO NOT mix with cleanup or sync waves.
> **Created**: 2026-05-09 (post-BL-W46.1)
> **Source research**: `.planning/RESEARCH-adaptive-harness.md` (Web + Context7, 9 sections)
> **Reframes**: BL-W31.7-01..05 (rationale was misinterpreted in prior sessions; rewritten here per user vision)
> **Reopens**: BL-W46 PR4 Deferred-1 (plan-mode interactive Q&A regression — closure was wrong)

---

## Why this wave exists

The current L0 harness (W31.6 canonical) treats every session as a fixed 6-peer + 5-specialist topology and assumes:

1. Plan-mode entry triggers a sentinel hook but the planner itself does NOT interactively ask the user clarifying questions (regression vs. canonical Anthropic behavior).
2. Same-name agent respawn clears context (it does NOT — Context7 confirms auto-resume of paused teammates).
3. Architects coordinate static phases (Phase 1 / 2 / 3) regardless of task fan-out.
4. Context-exhausted specialists must be killed and replaced via free-form prompt re-spawn (no structured context-bundle injection).

User vision (validated by Context7 + Anthropic docs):

> "El quality gate y la execution si hace falta se respawnean con agentes limpios si hay multiples PRs que corregir... lo correcto seria corregir la orden de la inicializacion del team para que dependiendo del caso inicialice 1 o X agentes. El context provider esta usando una cache para guardar los patrones de la sesion etc, que problema hay por ejemplo en spawnear 7 devs distintos de testing si son necesarios o ejecutar la execution wave con temas de testing, quality gate la rechaza y como tiene mucho contexto gastado el architect ordena que lo maten y respawneamos uno limpio, el architect deberia de ser capaz de ordenar que le den contexto para seguir la tarea con los patterns cacheados, el plan tambien guardado, estatus actual etc."

This is **harness engineering**: adaptive topology + respawn-with-context-bundle. State-of-the-art per Anthropic Agent SDK research.

---

## Anthropic-confirmed primitives we will use

From `.planning/RESEARCH-adaptive-harness.md` §9:

| Primitive | Currently used? | BL-W47 plan |
|-----------|----------------|-------------|
| `EnterPlanMode` / `ExitPlanMode` hooks | YES (L0-specific) | Extend in PR1 to enforce planner Q&A |
| Plan-mode interactive clarifying questions | NO (regression) | PR1 restores canonical behavior |
| `SubagentStart` hook + `additionalContext` injection | NO | PR2 — primary respawn-with-bundle mechanism |
| `SessionStart` `compact` matcher | NO | PR2 — post-compaction context recovery |
| TaskList per-session-lead semantics | Assumed shared (wrong) | PR4 — design around per-lead reality |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag dependency | YES (silent) | Document prominently in PR1 |
| Adaptive subagent count (1 / 2-4 / 10+ buckets) | NO (fixed 6+5) | PR4 — planner Spawn Table drives count |

---

## 6-PR Plan

### PR1 — Plan-mode interactive Q&A restoration (LOW risk)

**Goal**: When a session enters plan mode, the planner peer (or main agent in planner role) MUST proactively ask the user clarifying questions before producing a plan, per canonical Anthropic behavior.

**Scope**:
- `setup/agent-templates/planner.md` — add explicit "BEFORE writing PLAN.md, ask 2-5 clarifying questions if any of these axes are unclear: scope, success criteria, non-goals, constraints, dependencies."
- `setup/agent-templates/tl-session-setup.md` — when plan mode is active and planner is spawned, team-lead MUST relay the planner's clarifying questions to the user (do NOT assume defaults).
- `.claude/hooks/plan-mode-spawn-planner.js` — extend to verify the spawned planner template version supports interactive Q&A (regression guard).
- `setup/agent-templates/team-lead.md` (now main-agent-orchestration-guide.md) — main-as-orchestrator path: when in plan mode without spawned planner, main itself MUST ask clarifying questions before drafting the plan.

### PR1 expansion — Spec-amendment-pause protocol

**Sub-goal**: When mid-flight discovery changes the specification scope (e.g., specialist surfaces a root-cause architectural issue), planner/PM MUST auto-pause specialist work + re-sync with user before continuing. Prevents race conditions where stale work supersedes corrected briefs.

**Scope**:
- Extend planner template + main-agent-orchestration-guide.md with "spec-amendment-pause" protocol
- Trigger: when planner receives discovery from specialist OR PM identifies scope expansion
- Mechanism: PM HOLD signal to specialist + AskUserQuestion to re-sync + only resume on user GO

**References**: L1 BL-W47p friction signals #15, #19, #35 (see `.../shared-kmp-libs/.planning/wave-bl-w47p-bugfix/topology-friction-log.md`)

**Estimated effort**: 0.5 day. Template changes + planner amendment.

**Reopens**: BL-W46 PR4 Deferred-1 (closure as NOT-REPRODUCIBLE was wrong — only verified ExitPlanMode exit, not Q&A entry flow).

**Validation**: empirical session — enter plan mode with a deliberately under-specified task, confirm clarifying questions are asked.

**Estimated effort**: 2-3 hours.

---

### PR2 — `SubagentStart` hook + CP cache-slice export protocol (MEDIUM risk)

**Goal**: When a context-exhausted specialist is replaced (architect-ordered respawn or same-name rotation), the fresh agent receives a structured context bundle injected via Anthropic's official `SubagentStart` hook `additionalContext` field — NOT via prompt-text injection.

**Scope**:
- `.claude/hooks/subagent-start-context-bundle.js` (NEW) — fires on `SubagentStart`, reads `.planning/wave-{slug}/context-bundles/{agent-name}.json`, injects via `additionalContext`.
- CP v3.5.0 — add `export_cache_slice(agent_role, plan_id, status_snapshot)` MCP tool that writes the bundle file. Bundle contents:
  - Pattern matches CP cached for this session
  - Current PLAN.md anchor (which task is in-flight)
  - Last 3 SendMessage interactions involving this agent
  - Verdict files written so far (paths)
- Architect templates — add "When ordering respawn, FIRST call CP `export_cache_slice` for the target agent role. Hook will inject bundle into fresh subagent automatically."
- `.claude/hooks/session-start-compact-resync.js` (NEW) — fires on `SessionStart` with `compact` matcher, re-injects critical context per `docs/agents/post-compaction-resync.md`.

### PR2 expansion (a) — Specialist self-verification on lifecycle event

**Sub-goal**: Programmatically verify files-modified-vs-claimed before specialist marks task complete. Closes signal where specialist claimed work that wasn't delivered.

**Scope**:
- Investigate Anthropic Agent SDK hook events: PreToolUse, PostToolUse, EnterPlanMode, ExitPlanMode, SessionStart, SubagentStart (SubagentStop unverified — may not exist; verify in PR2 implementation phase via Context7)
- IF an applicable lifecycle event exists: implement hook that triggers on specialist completion and verifies `git diff --stat` of files-modified vs specialist's claim in completion message
- IF no applicable event: fallback to PM-side verification — PM runs check on specialist's IMPL-COMPLETE before architect dispatch

**References**: L1 BL-W47p friction #21, #36

**Open Design Question 9**: which Anthropic Agent SDK hook event is the right surface for this verification? (Provisional: SubagentStart in pre-fire mode if available; otherwise PM-side check.)

**Estimated effort**: 1 day (research + hook OR PM protocol).

### PR2 expansion (b) — CP cache-slice role boundary documentation

**Sub-goal**: Explicit doc that context-provider cache-slice contains PATTERNS only (doc references, frontmatter slugs), NEVER arbitrary file contents. PM still needs to do file reads — CP can't substitute.

**Scope**:
- Update `docs/agents/context-provider-adoption-hooks.md` with explicit boundary section
- Update CP template + PM template to clarify division of labor
- Update CP cache-slice export protocol (from PR2 main scope) to enforce no-file-contents constraint at schema level

**References**: L1 BL-W47p friction #5, #9

**Estimated effort**: 0.5 day. Documentation + schema constraint.

**Validation**:
- Bats test — spawn agent, manually create bundle, confirm `additionalContext` is delivered.
- E2E session — exhaust a test-specialist, architect orders respawn, fresh test-specialist resumes the failing test from the bundle without re-reading the entire PLAN.

**Estimated effort**: 1-2 days. New CP method + 2 new hooks + template updates.

---

### PR3 — Verify SAME-name respawn behavior + fix rotation if broken (HIGH risk)

**Goal**: Empirically verify Context7 §9.4 claim ("SendMessage to a stopped teammate auto-resumes it in background") and fix `setup/agent-templates/tl-session-setup.md:53` rotation protocol if confirmed broken.

**Scope**:
- Empirical test harness — spawn `test-specialist`, exhaust context, attempt SAME-name re-spawn, measure delivered context window vs. fresh.
- IF auto-resume confirmed:
  - Switch rotation to indexed names (`test-specialist-2`, `test-specialist-3`).
  - Update tl-session-setup.md rotation protocol.
  - Update all architect templates that reference rotation.
  - Add bats coverage for indexed-name dispatch.
- IF auto-resume NOT confirmed (Context7 wrong about Agent Teams semantics):
  - Document the verified behavior.
  - No template changes.

**Why HIGH risk**: Rotation is in production. If we switch to indexed names without verifying TeamCreate accepts them OR without updating every reference, sessions break.

**Estimated effort**: 1 day investigation + 1 day fixes if confirmed broken.

---

### PR4 — Adaptive fan-out via planner Spawn Table (MEDIUM risk)

**Goal**: Replace static "spawn 6 peers + 5 specialists always" with planner-driven Spawn Table that scales to task complexity per Anthropic's 1 / 2-4 / 10+ buckets.

**Scope**:
- `setup/agent-templates/planner.md` — output a `Spawn Table` section in PLAN.md:
  ```
  | Role | Count | Reason |
  |------|-------|--------|
  | test-specialist | 3 | 3 independent test files needing parallel work |
  | toolkit-specialist | 1 | hook fix (single-file change) |
  ```
- `setup/agent-templates/tl-session-setup.md` — read planner's Spawn Table, spawn N indexed instances (`test-specialist`, `test-specialist-2`, `test-specialist-3`).
- `.claude/hooks/premature-execution-gate.js` — extend to require Spawn Table presence in PLAN.md before allowing EXECUTE phase.
- Architect templates — add "When dispatching, target a specific indexed instance (e.g., `test-specialist-2`) per the Spawn Table assignment."

### PR4 expansion — Task Completion semantics

**Sub-goal**: Specialists never mark tasks completed; team-lead marks completed after verifying READY-FOR-REVIEW message. Specialist self-verification (files-modified vs claimed) becomes the mechanical check.

**Scope**:
- Adaptive spawn-table includes per-specialist task ownership
- TaskUpdate hook (prep-10 F1) enforces this at tool-call level
- team-lead protocol: verify before marking completed

**References**: L1 BL-W47p friction signals #21, #31, #36, #42, #43 (task auto-completion + false-claim recurrence). prep-10 F1 hook provides mechanical enforcement; PR4 integrates into adaptive topology.

**Folds in**: BL-W31.7-01 (flat-spawning real → adaptive Spawn Table), BL-W31.7-02 (pull-model → indexed dispatch), BL-W31.7-05 (eliminar Phase split → Spawn Table replaces phase coordination).

**Out of scope (separate PR if needed)**: BL-W31.7-03 hook reduction — defer audit until adaptive topology stabilizes.

**Estimated effort**: 1 day planner update + 1 day team-lead update + 1 day hook extension + bats coverage.

---

### PR5 — Architect respawn-between-PRs protocol (MEDIUM risk)

**Goal**: For long multi-PR waves, architects can order their own respawn between PRs to clear accumulated context. Pre-rotate brief format codified.

**Scope**:
- Architect templates (arch-platform, arch-testing, arch-integration) — add "Pre-rotate brief" section: when context > X tokens AND ≥1 PR pending, architect emits a brief (current verdict status, in-flight findings, pending dispatches) before requesting respawn.
- Brief consumed by `SubagentStart` hook (PR2 mechanism) on the replacement architect.
- `setup/agent-templates/tl-session-setup.md` — add "architect rotation" path mirroring specialist rotation but with stricter handoff.

**Trigger**: only when wave has ≥3 sequential PRs OR architect context approaches threshold.

**Estimated effort**: 0.5-1 day. Mostly template changes; reuses PR2 infrastructure.

---

---

### PR6 — HOLD signal preemption protocol

**Goal**: Investigate Anthropic SDK preemption support for HOLD signals (interrupt active tool call). If unsupported, implement ack-required protocol fallback.

**Scope**:
- Research: does Anthropic SDK / Claude Code expose tool-call interruption?
- IF yes: integrate HOLD into preemption mechanism
- IF no: implement ack-required protocol — specialist receives HOLD, MUST ack within N seconds before continuing any tool call
- Update specialist templates with HOLD-handling protocol
- Bats coverage: simulate HOLD-during-work scenarios

**References**: L1 BL-W47p friction #35, #38 (HOLD signal race conditions)

**Estimated effort**: 1-2 days (research first, then impl).

---

## What is NOT in this wave

- **Hook reduction** (BL-W31.7-03) — defer until adaptive topology stabilizes (1-2 waves of telemetry).
- **Spawn-prompt diet pass 2** (BL-W31.7-04) — orthogonal; can run before/during/after BL-W47.
- **kmp-test-runner v0.9 incorporation** (Step 2) — separate session before BL-W47.
- **L1/L2 sync** (Step 3+4) — separate sessions; sync W31.6 harness FIRST so L1/L2 are stable when BL-W47 ships.

Note: items originally listed as "not in this wave" that are NOW in scope via prep-8 amendments — spec-amendment-pause (→ PR1), specialist self-verification (→ PR2), CP role doc (→ PR2), HOLD preemption (→ PR6) — have been removed from this exclusion list.

---

## Pre-flight checklist before opening BL-W47 session

- [ ] Step 1 shipped (BL-W32-12 HIGH fix + backlog hygiene PR — this current session).
- [ ] Step 2 shipped (kmp-test-runner v0.9 incorporation — separate session).
- [ ] Step 3 shipped (L1 shared-kmp-libs sync with W31.6 harness — separate session).
- [ ] Step 4 shipped (L2 DawSync + WakeTheCave sync — separate sessions).
- [ ] Confirm `.planning/RESEARCH-adaptive-harness.md` is still current (re-validate against Anthropic docs if >2 weeks old).
- [ ] Open fresh session with no in-flight team — BL-W47 needs its own clean topology to exercise itself.

---

## Open design questions for BL-W47 session

1. **Bundle storage location**: `.planning/wave-{slug}/context-bundles/` vs `.claude/cache/bundles/` — security + git-ignore implications.
2. **Bundle TTL**: should bundles expire? After session end? After N hours?
3. **Indexed-name registry**: do `test-specialist-2` etc. need manifest entries, or is the role inheritance implicit?
4. **Backwards compatibility**: existing `tl-session-setup.md` rotation protocol — flag-gated migration or hard cutover?
5. **CP cache-slice format**: JSON Schema definition before PR2 starts.
6. **Rollback plan**: if PR3 breaks production rotation, how do we revert without breaking in-flight sessions?

These should be resolved in PR1's planning sub-task (cheap to think through before PR2 lands).

Additional questions surfaced by prep-8 amendments:

7. **Spec-amendment-pause granularity** (PR1): At what scope level does the pause apply — per-file, per-task, per-PR? If a specialist is mid-way through file 2 of 5, do we pause after the current file or interrupt immediately?
8. **SubagentStop hook timing** (PR2): `SubagentStop` hook name is UNVERIFIED — may not exist in Anthropic SDK. PR2 implementation must verify via Context7 before relying on it. See OQ9 for fallback options.
9. **OQ9 — Anthropic hook event for specialist self-verification** (PR2): Which Anthropic Agent SDK hook event is the right surface for files-modified-vs-claimed verification? Options: (a) SubagentStart pre-fire if available, (b) PostToolUse after final file write, (c) PM-side check on IMPL-COMPLETE message. SubagentStop provisional name unverified — investigate in PR2 phase.
10. **HOLD checkpoint density** (PR6): If specialists poll at "after each file write", high-frequency file writers will send many checkpoint-acks — potential message flood. Define a minimum interval (e.g., 30 seconds or N operations) to throttle.
11. **TaskUpdate hook intercept compatibility**: settings.json "Task|Agent" matcher (existing, line 286) may substring-match TaskUpdate. Adding a separate "TaskUpdate" exact-match block could cause double-firing. All hooks are fail-open so no breakage, but verify empirically after C6 hook lands. Per CP refinement.

---

## References

- `.planning/RESEARCH-adaptive-harness.md` — full research with 9 sections
- `.planning/backlog.md` lines 515-580 — original BL-W31.7-01..05 entries (now reframed)
- `.planning/backlog.md` "🟡 BL-W47 Wave Plan" subsection — quick blueprint
- `setup/agent-templates/planner.md` — current template (target for PR1 + PR4)
- `setup/agent-templates/tl-session-setup.md` — current rotation (target for PR3)
- `.claude/hooks/plan-mode-spawn-planner.js` — current hook (target for PR1)
- `docs/agents/post-compaction-resync.md` — current protocol (replaced by PR2 hook)
- Context7 sources resolved during research:
  - `/websites/code_claude` (5547 snippets, primary)
  - `/anthropics/claude-code` (764 snippets, GitHub internals)
  - `/anthropics/anthropic-sdk-python` (179 snippets)
