---
name: work
description: "Smart task routing — analyzes freeform text and delegates to the right agent or skill."
copilot: false
intent: [route, delegate, orchestrate, debug, research, verify, audit, implement, review]
---

# Work Skill

Smart task routing — analyzes freeform text and delegates to the right agent or skill.

## Usage

```
/work <task description>
```

## Level 0.5 — Named Skill Override (checked before keyword routing)

If `$ARGUMENTS` starts with or contains a known skill name, route directly to that skill — bypasses Level 1 keyword scan entirely:

| Skill name match | Invokes | Use when |
|-----------------|---------|----------|
| `material-3` / `material 3` | `skills/material-3-skill/SKILL.md` | MD3 component, theme, scaffold, audit |
| `sync-vault` | `skills/sync-vault/SKILL.md` | Obsidian vault sync |
| `pre-pr` | `skills/pre-pr/SKILL.md` | Pre-merge validation |
| `debug` | `skills/debug/SKILL.md` | Bug investigation |
| `research` | `skills/research/SKILL.md` | Domain research |

Add entries here when promoting a skill to named-route status (conscious promotion step — staleness is intentional).

> **HARD GATE — Core subagents must be dispatched before any implementation work.**
> If routing to team-lead/orchestrator (implement/feature/build/plan/wave keywords): verify core subagents are dispatched FIRST.
> Required roles: context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater
> If NOT dispatched → dispatch all 6 as concurrent Agent subagents (background peers optional) + run pre-flight checklist BEFORE routing any task.
> DO NOT plan. DO NOT dispatch work agents. DO NOT respond to user task until core setup is done.
> If ANY pre-flight checkbox fails → fix it first, then re-verify ALL from top.

## Routing Logic

### Level 0 — Multi-Department Detection (before keyword routing)

Check if `$ARGUMENTS` contains cross-department signals:

| Pattern | Action |
|---------|--------|
| Contains "dev + marketing" or "parallel" with department names | Multi-department parallel mode |
| Contains "status of" or "how is.*implemented" from non-dev context | Cross-department query |
| Contains "release notes" or "blog post about feature" | Sequential: dev brief → marketing |

**Multi-department parallel mode:**
1. Parse task into per-department sub-tasks
2. Show routing plan and ask confirmation
3. Spawn both Agent() calls in same message (parallel)
4. Collect outputs and present unified summary

**Sequential cross-department mode:**
1. Identify source dept (has the info) and consumer dept (needs it)
2. Spawn source agent: "Provide a Cross-Department Brief about {topic}"
3. Extract brief from output
4. Spawn consumer agent with brief injected as context
5. Present unified summary

If no cross-department signal detected, fall through to Level 1.

## Peer-Aware Routing

Before routing to a peer-eligible agent, check if a background peer is alive:

If a background peer named `{target}` is known to be alive (was dispatched in this session with `run_in_background=true` and has ACKed):
  → `SendMessage(to="{target}", ...)`
Else:
  → `Agent(subagent_type="{target}", name="{target}", ...)` — fresh single-use subagent (no `team_name` needed)

The wave slug (e.g., `bl-w42-pr1`) is the artifact directory key — set via `CLAUDE_WAVE_SLUG` env or derived from the git branch last segment. It determines `.planning/wave-{slug}/` where verdicts and context bundles live.

### Level 1 — Deterministic Keyword Rules (instant, 0 tokens)

Match `$ARGUMENTS` against these patterns in order. First match wins:

| Pattern | Route |
|---------|-------|
| `\b(bug\|error\|fix\|broken\|crash)\b` | `/debug` |
| `\b(test\|coverage\|benchmark)\b` | Peer-aware delegate to `test-specialist` ** |
| `\b(review\|PR\|pull request)\b` | `/review-pr` |
| `\b(research\|investigate\|explore)\b` | `/research` |
| `\b(decide\|choose\|compare\|tradeoff)\b` | `/decide` |
| `\b(verify\|check spec\|meets criteria)\b` | `/verify` |
| `\b(map\|architecture\|modules\|inventory)\b` | `/map-codebase` |
| `\b(pre-pr\|validate\|ready to merge)\b` | `/pre-pr` |
| `\b(note\|idea\|remember)\b` | `/note` |
| `\b(ui\|compose\|screen\|component)\b` | Peer-aware delegate to `ui-specialist` ** |
| `\b(audit\|quality)\b` | `/audit` |
| `\b(doc\|documentation\|update docs)\b` | Peer-aware delegate to `doc-updater` ** |
| `\b(context\|pattern\|lookup\|what exists)\b` | Peer-aware delegate to `context-provider` ** |
| `\b(domain\|model\|sealed\|data class)\b` | Peer-aware delegate to `domain-model-specialist` ** |
| `\b(data layer\|repository\|encoding)\b` | Peer-aware delegate to `data-layer-specialist` ** |
| `\b(prioritize\|roadmap\|features\|backlog)\b` | Agent(`product-strategist`) * |
| `\b(post\|blog\|social\|marketing\|content)\b` | Agent(`content-creator`) * |
| `\b(landing\|page\|conversion\|copy\|seo)\b` | Agent(`landing-page-strategist`) * |
| `\b(implement\|feature\|build\|scope\|plan\|execute\|wave)\b` | Act as main-context orchestrator (in-process per W31.6) *** |

\* Business agents are opt-in. If the agent doesn't exist in `.claude/agents/`, fall through to Level 2.
\** Use Peer-Aware Routing block above — SendMessage if peer is alive, else Agent peer-spawn.
\*** T-BUG-010: orchestrator MUST run in-process (main conversation), NEVER via `Agent()`. Sub-agents cannot spawn reliably at depth (Claude Code bug #31977). Per W31.6 canonical pattern, the main agent IS the team-lead. Steps: (1) Dispatch 6 core subagents as concurrent Agent calls (subagent_type=X, name=X — no TeamCreate, no team_name required), (2) Run pre-flight checklist, (3) Dispatch work with scope_doc_path. Load-bearing contract: disk artifacts (`arch-*-verdict.md`, `quality-gate-report.json`, `push-proof.json`).

### Level 2 — Frontmatter Discovery (if no Level 1 match)

1. Scan `.claude/agents/*.md` for `intent:` frontmatter
2. Match keywords in user description against intent arrays
3. If match found → suggest that agent
4. If no match → act as main-context orchestrator (in-process per W31.6 — see footnote ***)

## Dev Spawn First-Action Protocol

When team-lead spawns a dev specialist, the dev's FIRST action must be:
```
SendMessage(to="context-provider", summary="gate ack")
```

This satisfies the per-session CP gate (Bug #7 fixed: session-scoped, one consult unblocks all peers).
Include this instruction in every dev dispatch message from team-lead.

## 3-Phase Execution Model

When routing to team-lead (implement/wave keywords):
1. **Planning phase**: team-lead reads plan file, writes `.planning/PLAN.md` via Write tool (not SendMessage)
2. **Execution phase**: Architects dispatch devs wave by wave; each wave gated by architect APPROVE
3. **Quality Gate phase**: quality-gater runs all validators; session closes only on full PASS

quality-gater activation requires CP consultation first (same session gate as devs).

> WARNING (T-BUG-010): MUST run in main context only. Spawning as subagent causes Agent() tool loss (#31977). Execute team-lead playbook inline — do NOT use Agent() with team-lead as subagent_type.

## Steps

1. Parse task description from `$ARGUMENTS`
2. Run Level 0 multi-department detection
3. Run Level 1 keyword matching against the routing table above
4. If no Level 1 match, run Level 2 frontmatter discovery:
   - Read each `.claude/agents/*.md` file
   - Extract `intent:` array from YAML frontmatter
   - Score keyword overlap with `$ARGUMENTS`
   - Select highest-scoring agent (if any scores > 0)
5. Display the routing decision:

```
Routing: "{task}" -> {target skill or agent}
Reason: {matched keyword or intent}

Proceed? (y/n)
```

6. Wait for user confirmation before executing
7. On confirmation, invoke the matched skill or spawn the matched agent

## Notes

- Session naming: `session-{slug}` is the canonical convention shared with `/init-session --orchestrate <slug>` (BL-W32-07). Use the same slug for both commands in a session.
- Level 1 is checked first — it is instant and deterministic
- Level 2 only runs when Level 1 has no match
- **Before routing to any agent, verify it exists** in `.claude/agents/` — if not, fall through
- Business agents (product-strategist, content-creator, landing-page-strategist) are opt-in templates; they only exist if the project activated them via `/setup`
- `dev-lead` is a legacy template — only exists if the project copied it from `setup/agent-templates/`
- Always show the routing decision and ask for confirmation before executing
- If the user disagrees with routing, ask them to clarify or pick a target manually

## WARNING — T-BUG-010: Main Context Only

**MUST run in main context only. Spawning /work as a subagent causes Agent() tool loss (Claude Code bug #31977).**

- Do NOT invoke `/work` as a subagent with team-lead as the subagent_type — this breaks TeamCreate and Agent() tool availability
- /work acts in-process as main-context orchestrator (W31.6 pattern) — team-lead.md was retired in W31.6
- If you find yourself wanting to spawn /work as an Agent(), you are in the wrong process layer

## Orchestrator Safety Rule

**NEVER** spawn the orchestrator role itself via `Agent()`. The orchestrator needs the `Agent` tool which only works at the top-level process.

When routing to an orchestrator:
1. Act in-process as the main-context orchestrator (W31.6 canonical pattern — main agent IS the team-lead; no separate team-lead template to read)
2. Follow the inline steps from footnote ***: dispatch 6 core subagents (no `TeamCreate` or `team_name` needed), run pre-flight checklist, dispatch work
3. The orchestrator role executes **in-process**, not as a sub-agent (T-BUG-010 / Claude Code bug #31977)

`quality-gater` and `planner` are dispatched by the orchestrator as single-use Agent subagents — they DO NOT need `TeamCreate` or `team_name`.
