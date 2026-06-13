---
scope: [workflow, ai-agents, pm, session-setup]
sources: [androidcommondoc]
targets: [all]
slug: tl-session-setup
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead session setup: Phase 2 core specialist spawning, selective spawning, bundle-read mandate, rotation protocol, context management, architect routing."
version: 3
last_updated: "2026-06"
assumes_read: team-topology, tl-phase-execution
token_budget: 1500
---

# team-lead Session Setup

Reference for team-lead's session initialization: Phase 2 core specialist spawning, selective spawning rules, long-session rotation, context management, architect routing, and correct TeamCreate patterns.

## Phase 2 Core Specialists

When Phase 2 execution begins, team-lead spawns 5 core specialists as named session team members:
```
Agent(name="test-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are test-specialist for this session. FIRST: read your bundle at .planning/wave-{slug}/context-bundles/test-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-testing. Ask arch-testing for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact). Stay alive across all waves.")
Agent(name="ui-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are ui-specialist for this session. FIRST: read your bundle at .planning/wave-{slug}/context-bundles/ui-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-testing. Ask arch-testing for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact). Stay alive across all waves.")
Agent(name="domain-model-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are domain-model-specialist for this session. FIRST: read your bundle at .planning/wave-{slug}/context-bundles/domain-model-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-platform. Ask arch-platform for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact). Stay alive across all waves.")
Agent(name="data-layer-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are data-layer-specialist for this session. FIRST: read your bundle at .planning/wave-{slug}/context-bundles/data-layer-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architects are arch-platform and arch-integration. Ask them for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact). Stay alive across all waves.")
Agent(name="toolkit-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are toolkit-specialist for this session. FIRST: read your bundle at .planning/wave-{slug}/context-bundles/toolkit-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-platform. Ask arch-platform for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact). Stay alive across all waves.")
```

**Bundle-read mandate (MANDATORY)**: every peer spawn/respawn prompt opens with the bundle-read line shown above — canonical wording in [context-bundle-schema](context-bundle-schema.md) §Consumer Contract. The `.planning/` bundle path is CP-gate-exempt, so the read works BEFORE the peer's gate-ack. At fresh-session start bundles are normally absent (the conditional makes the line harmless); after a mid-wave session death the bundle on disk IS the resume context.

**Selective spawning (MANDATORY — evaluate BEFORE any Agent() call)**: You MUST produce a scope evaluation table BEFORE calling Agent() to spawn any core specialist. Format:

| Layer | Tasks in plan | Spawn? |
|---|---|---|
| test | {count} | YES/SKIP |
| ui | {count} | YES/SKIP |
| domain | {count} | YES/SKIP |
| data | {count} | YES/SKIP |

Skip specialists with zero tasks. Do NOT default to spawning all 5. Log skipped specialists: "Skipping {name} — no work in sprint scope". Architects can still request a skipped specialist mid-sprint via SendMessage to team-lead.

> 35K tokens were wasted on an idle ui-specialist in a data/domain-only sprint.

**No-UI waves**: If the sprint plan has zero `ui` tasks in the scope table above, SKIP ui-specialist spawn.
Route any doc work (README, CHANGELOG, English polish, frontmatter) to `doc-updater` instead.
Log: "Skipping ui-specialist — no UI tasks in scope; doc work routed to doc-updater."

Core specialists live until session end — same lifecycle as architects. They accumulate layer knowledge across waves. They live in the `session-{project-slug}` team — all agents reach them via `SendMessage(to="context-provider")`, `SendMessage(to="doc-updater")`, `SendMessage(to="arch-testing")`, etc.

**Why session team peers**: context-provider reads the project ONCE. Architects retain Phase 2 context — quality-gater in Phase 3 can consult them for decisions, deviations, and unresolved concerns. Team peers are always reachable via SendMessage — no idle/dead confusion, no re-spawning needed.

**Rotation**: for long sessions (5+ waves), rotate KILL-THEN-RESPAWN: (0) dispatch context-provider `write_bundle(role, plan_id, status_snapshot)` so the role's context bundle is on disk BEFORE the kill (a dead peer cannot be queried — see [context-bundle-schema](context-bundle-schema.md)); (1) gracefully terminate the old peer — `SendMessage(to="test-specialist", message={type:"shutdown_request"})`; (2) VERIFY its member entry is GONE from `~/.claude/teams/session-{project-slug}/config.json` (if it lingers, escalate to the user for manual cleanup — do NOT work around it); (3) re-spawn the CANONICAL name: `Agent(name="test-specialist", team_name="session-{project-slug}", ...)` — collision-free now, fresh context window — with a prompt that OPENS with the bundle-read mandate (schema §Consumer Contract). NEVER respawn while the old instance is alive or its entry lingers: the spawn SUFFIXES silently (`-2`) and messages addressed to the role's canonical name stop arriving (dead-inbox routing — proven twice: feedback_stale_team_suffix_collision + PR #206 saga; suffixed names also evade exact-match gates until PR-0c identity-tolerance, matrix E17). NEVER use free-form names for agents holding Write/Bash/gh — non-canonical names are invisible to every type-keyed gate (incident E18, BL-W47 firing matrix §5). Stopped SUBAGENTS (Agent-tool, not teammates) need no respawn at all: SendMessage auto-resumes them with full context (native primitive, matrix E20).

**Long-session rotation protocol**: If a core specialist has accumulated 15+ tool uses AND 150k+ tokens AND has failed a single dispatch 2+ times, STOP retrying. Either:
(a) Architect requests team-lead rotate the specialist — kill-then-respawn: CP writes the role bundle FIRST (`write_bundle`), then graceful shutdown of the bloated peer, verify its config entry is removed, then re-spawn the CANONICAL name with fresh context and a prompt opening with the bundle-read mandate (see Rotation above), OR
(b) team-lead spawns a named overflow dev (e.g. `{specialist}-2`, team_name="session-{project-slug}") for the specific failing task — overflow is ADDITIONAL capacity alongside the live canonical peer, addressed explicitly by its own `-2` name (NOT a replacement).

Do NOT continue retrying with a context-bloated dev — retries will keep failing due to attention anchoring to past work.

## Context Management

- **Peers accumulate context** — keep the team small (only agents that need coordination)
- **Sub-agents get fresh context** — prefer Agent() for workers to avoid context bloat
- **Summarize between waves** — before starting wave N+1, summarize wave N findings in 1-2 sentences
- **Call doc-updater mid-session** for long work (5+ waves) to archive decisions to disk

Architects handle ALL investigation, code reading, and delegation to devs/guardians. team-lead NEVER looks at code.

## Architect Routing Table

| Issue domain | Assign to | Why |
|-------------|-----------|-----|
| Tests, test quality, TDD, coverage | `arch-testing` | Manages test-specialist, ui-specialist |
| KMP patterns, encoding, data layer, domain model, source sets | `arch-platform` | Manages domain-model-specialist, data-layer-specialist |
| UI wiring, DI, navigation, buttons, compilation, feature gates | `arch-integration` | Manages ui-specialist, data-layer-specialist |
| Cross-cutting (touches multiple domains) | Launch 2-3 architects in parallel | Each handles their domain |

## Session Team Setup Patterns

**Use `TeamCreate("session-{project-slug}")` at session start. 6 core agents join at session start; 5 core specialists join at Phase 2 start.**

```
// CORRECT — session peers reach each other via SendMessage
TeamCreate(team_name="session-{project-slug}")
Agent(name="context-provider", team_name="session-{project-slug}", run_in_background=true, prompt="...")
Agent(name="arch-testing", team_name="session-{project-slug}", run_in_background=true, prompt="...")

// WRONG — no team_name (go idle, team-lead confuses idle with dead → "v2" re-spawns)
Agent(name="arch-testing", run_in_background=true, prompt="...")
// WRONG — Bash spawning or team-lead reading source code
Bash("claude --print '...'")
```

## Canonical Spawning Pattern (Recommended)

Per Anthropic agent-teams canonical doc: the main agent IS the team lead. No separate team-lead subagent needed.

The main agent spawns all 12 session peers directly:

```
TeamCreate("session-{project-slug}")
// Planning + cross-cutting peers (live from session start)
Agent(name="context-provider", team_name="session-{project-slug}", ...)
Agent(name="doc-updater", team_name="session-{project-slug}", ...)
// Architecture peers (live from session start)
Agent(name="arch-platform", team_name="session-{project-slug}", ...)
Agent(name="arch-integration", team_name="session-{project-slug}", ...)
Agent(name="arch-testing", team_name="session-{project-slug}", ...)
// Dev peers (spawn at Phase 2 start, or all at once in simple sessions)
Agent(name="data-layer-specialist", team_name="session-{project-slug}", ...)
Agent(name="domain-model-specialist", team_name="session-{project-slug}", ...)
Agent(name="ui-specialist", team_name="session-{project-slug}", ...)
Agent(name="test-specialist", team_name="session-{project-slug}", ...)
Agent(name="toolkit-specialist", team_name="session-{project-slug}", ...)
// Quality gate peer
Agent(name="quality-gater", team_name="session-{project-slug}", ...)
```

In this pattern, all peers are live from session start. PREP/EXECUTE distinction in arch templates is a **legacy compatibility pattern** — required only when team-lead runs as a subagent and devs are not yet spawned when architects receive their Phase 1 dispatch.

**Legacy pattern (deferred to W31.7+)**: nested spawning where arch-platform/arch-integration/arch-testing spawn devs after PREP phase. Still supported via PREP/EXECUTE distinction in arch templates. Will be replaced when BL-W31.7-01 ships.

**PREP/EXECUTE distinction in arch templates**: Still ENFORCED — see [arch-dispatch-modes.md](arch-dispatch-modes.md) and the architect templates for current PREP/EXECUTE semantics. In the canonical pattern (all peers live from session start) architects still receive PREP dispatches in Phase 1 and EXECUTE dispatches in Phase 2; the distinction governs whether devs are available to receive sub-dispatches.

## Wave Slug Propagation (FIND-18 fix, BL-W42 PR1)

The wave slug (e.g., `bl-w42-pr1`) is used by hooks to locate PLAN.md and the quality-gate sentinel.

**MANDATORY: export slug BEFORE starting your session shell, NOT inline in commands:**

```bash
export CLAUDE_WAVE_SLUG=bl-w42-pr1   # set once in terminal; hooks pick it up
```

**Fallback detection order:**
1. `CLAUDE_WAVE_SLUG` env var (canonical)
2. Git branch: **last path-segment** (`${branch##*/}` / `branch.split('/').pop()`), so `feature/payment-api` → `payment-api` and `codex/api-redesign` → `api-redesign`. `develop`, `master`, `main`, `HEAD`, and empty values are rejected.
3. Alias scan: single `.planning/wave-*/PLAN.md` presence (last resort)

**Quality-gate sentinel location (FIND-17 fix):** `.claude/wave-quality-gates/{slug}.md`
NOT in `.planning/wave-{slug}/quality-gate.md` (gitignored by `.gitignore:54`).
Create sentinel BEFORE first `git push` on the feature branch.
