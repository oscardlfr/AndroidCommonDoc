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

> **HARD GATE — Session setup blocks ALL work.**
> If routing to `team-lead` (implement/feature/build/plan/wave keywords): verify session team exists FIRST.
> Check: does `~/.claude/teams/session-{slug}/` exist with all 6 peers alive?
> - context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater
> If NO → complete TeamCreate + all 6 peers + pre-flight checklist BEFORE routing any task.
> DO NOT plan. DO NOT dispatch. DO NOT respond to user task until session is ready.
> If ANY pre-flight checkbox fails → fix it first, then re-verify ALL from top.

## Stale Team Dir Check (run before TeamCreate)

Prior sessions leave stale dirs that force `-2`/`-3` suffixes on re-spawn.

```bash
ls ~/.claude/teams/ | grep "session-{slug}"
```

If `session-{slug}-2` or `session-{slug}-3` found → stale entry exists.

**Option A (preferred)**: Clean before TeamCreate:
```bash
rm -r ~/.claude/teams/session-{slug} 2>/dev/null || true
rm -r ~/.claude/teams/session-{slug}-2 2>/dev/null || true
```
Note: use `rm -r` NOT `rm -rf` (harness deny rule at `.claude/settings.json:L21` blocks `rm -rf *`; also `rm -r` errors visibly on wrong paths instead of silently succeeding).
If this errors "No such file or directory" — dir is already clean, proceed.

**Option B (fallback)**: Accept `-2`/`-3` suffix and send correction-message to all peers with actual team name.

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

### Level 1 — Deterministic Keyword Rules (instant, 0 tokens)

Match `$ARGUMENTS` against these patterns in order. First match wins:

| Pattern | Route |
|---------|-------|
| `\b(bug\|error\|fix\|broken\|crash)\b` | `/debug` |
| `\b(test\|coverage\|benchmark)\b` | Delegate to `test-specialist` agent |
| `\b(review\|PR\|pull request)\b` | `/review-pr` |
| `\b(research\|investigate\|explore)\b` | `/research` |
| `\b(decide\|choose\|compare\|tradeoff)\b` | `/decide` |
| `\b(verify\|check spec\|meets criteria)\b` | `/verify` |
| `\b(map\|architecture\|modules\|inventory)\b` | `/map-codebase` |
| `\b(pre-pr\|validate\|ready to merge)\b` | `/pre-pr` |
| `\b(note\|idea\|remember)\b` | `/note` |
| `\b(ui\|compose\|screen\|component)\b` | Delegate to `ui-specialist` agent |
| `\b(audit\|quality)\b` | `/audit` |
| `\b(doc\|documentation\|update docs)\b` | Delegate to `doc-updater` agent |
| `\b(context\|pattern\|lookup\|what exists)\b` | Delegate to `context-provider` agent |
| `\b(domain\|model\|sealed\|data class)\b` | Delegate to `domain-model-specialist` agent |
| `\b(data layer\|repository\|encoding)\b` | Delegate to `data-layer-specialist` agent |
| `\b(prioritize\|roadmap\|features\|backlog)\b` | Agent(`product-strategist`) * |
| `\b(post\|blog\|social\|marketing\|content)\b` | Agent(`content-creator`) * |
| `\b(landing\|page\|conversion\|copy\|seo)\b` | Agent(`landing-page-strategist`) * |
| `\b(implement\|feature\|build\|scope\|plan\|execute\|wave)\b` | Read `team-lead` template, act as team-lead (in-process) *** |

\* Business agents are opt-in. If the agent doesn't exist in `.claude/agents/`, fall through to Level 2.
\*** T-BUG-010: `team-lead` MUST run in-process (main conversation), NEVER via `Agent()`. Sub-agents cannot TeamCreate or spawn reliably. Read `.claude/agents/team-lead.md` and act as team-lead directly.

### Level 2 — Frontmatter Discovery (if no Level 1 match)

1. Scan `.claude/agents/*.md` for `intent:` frontmatter
2. Match keywords in user description against intent arrays
3. If match found → suggest that agent
4. If no match → read `.claude/agents/team-lead.md`, act as team-lead in-process

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

- Level 1 is checked first — it is instant and deterministic
- Level 2 only runs when Level 1 has no match
- **Before routing to any agent, verify it exists** in `.claude/agents/` — if not, fall through
- Business agents (product-strategist, content-creator, landing-page-strategist) are opt-in templates; they only exist if the project activated them via `/setup`
- `dev-lead` is a legacy template — only exists if the project copied it from `setup/agent-templates/`
- Always show the routing decision and ask for confirmation before executing
- If the user disagrees with routing, ask them to clarify or pick a target manually

## Orchestrator Safety Rule

**NEVER** spawn orchestrator agents (`team-lead`, `quality-gater`) via `Agent()`. These agents need `TeamCreate`, `TeamDelete`, and `Agent` tools which only work at the top-level process.

When routing to an orchestrator:
1. Read the agent's template from `.claude/agents/{name}.md`
2. Follow its instructions as the main Claude process
3. The agent acts **in-process**, not as a sub-agent
