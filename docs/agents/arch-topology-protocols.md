---
slug: arch-topology-protocols
category: agents
scope: [L0, L1, L2]
sources:
  - https://docs.anthropic.com/claude/docs/claude-code-agents
targets: []
description: "Topology protocols for arch-platform / arch-testing / arch-integration. Covers OBS-A Scope Extension HARD SELF-GATE (T-BUG-011) and Reporter Protocol with team-lead-liveness + team-lead fallback (T-BUG-012). Referenced from each architect template to keep templates under the 400-line cap."
---

# Architect Topology Protocols

Shared protocols for `arch-platform`, `arch-testing`, and `arch-integration`. Extracted from in-template text to keep each architect template within the 400-line budget. The architect templates reference this doc for the full rationale; the actionable rules live in both places.

## 1. Scope Extension Protocol — HARD SELF-GATE (T-BUG-011)

### Rule (hard-stop)

**Before you SendMessage to team-lead proposing any scope extension, run this 3-check self-gate. If ANY check fails → REFUSE extension, record finding in final verdict, do NOT message team-lead.**

1. **Wave-distance check**: is the target in your current wave or the adjacent wave (N or N+1)?
   - Target in wave N+2 or further → REFUSE. Record as "out-of-dispatch finding, separate wave needed". Do NOT message team-lead.
2. **Specialty check**: is the extension in YOUR architect specialty?
   - `arch-platform` = KMP / Gradle / DI / modules
   - `arch-testing` = TDD / coverage / test patterns
   - `arch-integration` = wiring / navigation / DI cross-cuts
   - Extension touches another architect's domain → REFUSE. Flag verdict as "cross-specialty finding; belongs to arch-{X}". Do NOT message team-lead.
3. **PLAN.md trigger check**: does the work clearly match a DIFFERENT wave's existing objective in PLAN.md?
   - YES → REFUSE auto-extension. team-lead will re-plan that wave when its turn comes; acting now overlaps.

**Only when ALL three checks pass AND the extension is strictly adjacent (N+1, same specialty, not already planned elsewhere)** may you request extension:

1. SendMessage to team-lead: `summary="scope extension request (adjacent, same specialty)", message="dispatch covers X; propose extending to Y because <evidence>. Wave distance: N→N+1. Specialty: same. PLAN.md trigger: none."`
2. Wait for explicit team-lead approval before touching Y.
3. If team-lead doesn't respond in 2 messages, DEFAULT to NOT extending — flag Y in final verdict as "out-of-dispatch finding, needs separate wave".

### FORBIDDEN

- Requesting extension to a non-adjacent wave (N+2 or further) — even with strong evidence
- Requesting extension into another architect's specialty — even if you spotted the issue first
- Treating this self-gate as informational guidance — it is a HARD STOP, not a suggestion

### Why this exists

L2 debug session (2026-04-18) caught `arch-platform` requesting `W0 → W3` extension (3-wave jump + cross-specialty to `ui-specialist` territory). team-lead's OBS-A enforcement rejected correctly (last line of defense worked), but `arch-platform` auto-gate did NOT pre-filter the request. The self-gate prevents wasted team-lead cycles and protects against cross-specialty overlap at the source. team-lead gate remains the last line of defense — this self-gate is the first.

The earlier OBS-A text described the procedure (SendMessage + wait) but allowed architects to *reach* step 1 freely — step 1 was the floor, not a ceiling. This version re-frames steps 1–3 as pre-flight checks BEFORE step 1 becomes reachable.

## 2. Reporter Protocol — team-lead liveness check + team-lead fallback (T-BUG-012)

### Rule (pre-flight check before every SendMessage to team-lead)

Your default recipient for verdicts/escalations is `team-lead`. **Before every SendMessage to `team-lead`, verify team-lead liveness.**

**Liveness check:**

1. Did you receive a shutdown notification from team-lead in this session? → team-lead is NOT alive.
2. Has team-lead failed to acknowledge any of your last 3 SendMessages? → team-lead is NOT alive.
3. Did team-lead clarify that team-lead has shut down and team-lead is the orchestrator? → team-lead is NOT alive.

**Routing:**

- team-lead alive → SendMessage to `team-lead` as normal.
- team-lead NOT alive → SendMessage to `team-lead` with summary prefix `[team-lead-absent]` so team-lead knows team-lead routing failed and takes orchestration.
- Uncertain → SendMessage to `team-lead` with summary prefix `[routing-check]` asking which recipient to use; do NOT guess.

### FORBIDDEN

- SendMessage to `team-lead` AFTER a team-lead shutdown notification — the message is lost, the report is not delivered
- Silently retrying team-lead 3+ times with no answer instead of falling back — report stays stuck, work appears unfinished
- Hardcoding `team-lead` as the ONLY valid recipient — the reporter shifts when team-lead shuts down

### Why this exists

L2 debug session (2026-04-18) caught `arch-platform` routing a Wave 0 verdict to team-lead AFTER team-lead had explicitly shut down AND AFTER team-lead clarified routing explicitly. The template made `team-lead` a hardcoded default with no fallback path. The Reporter Protocol above makes liveness a pre-flight check and codifies the `[team-lead-absent]` fallback to team-lead.

This is different from OBS-A (T-BUG-011). OBS-A guards WHAT you propose. Reporter Protocol guards WHERE you send. A violation of either silently erodes coordination — OBS-A wastes team-lead cycles on invalid requests; Reporter Protocol drops reports into a dead mailbox.

## 3. Bash Search Anti-pattern (T-BUG-015)

### Rule (hard-stop)

`Bash` is in your tools for **git/gradle/test invocation only**. You may NOT use it for pattern searching.

**FORBIDDEN bash commands**:
- `grep`, `rg`, `ripgrep`, `ag`, `ack` — text/code pattern search
- `find`, `fd` — file pattern search
- `awk`, `sed` (when used to filter/match patterns)

These bypass the L0 PR #40 mechanical enforcement (Grep/Glob removed from architect frontmatter to force context-provider delegation). Using `bash grep` defeats the design — the rule intent was "no pattern searching from architects", and the tools removal was one mechanism. `Bash` is the leak.

### Correct path

```
SendMessage(to="context-provider",
  summary="search: <topic>",
  message="Find <pattern> in <scope>. Return <what you need>.")
```

context-provider has Read/Grep/Glob/Bash and is the curated knowledge layer. Architects pose questions; context-provider answers.

### Why this exists

L2 DawSync session (2026-04-18) caught arch-platform using `Bash grep` for pattern audits in Wave 0.7. The L0 PR #40 mechanical enforcement (Grep/Glob removed from architect frontmatter) was bypassed via Bash. Mechanical removal closed one door; Bash was the open window. This anti-pattern shuts the window.

The same pattern applies to dev specialists (test-specialist, ui-specialist, data-layer-specialist, domain-model-specialist) — devs ask their reporting architect, who asks context-provider. Devs running `bash grep` bypass the architect chain entirely, leaving the team without an audit trail.

team-lead (team-lead) has its own corollary: the **Search Dispatch Protocol** — when a user task involves pattern matching, route to context-provider FIRST and then dispatch to architect with results-as-input. Never dispatch to an architect with "use grep to find X".

## Cross-references

- Template reference: each architect template (arch-platform, arch-testing, arch-integration) references this doc in its OBS-A and Reporter Protocol sections and keeps an abridged actionable checklist inline.
- `.claude/agents/team-lead.md` — team-lead side of the OBS-A gate (independent enforcement, last line of defense)
- `mcp-server/tests/integration/topology-bugs.test.ts` — T-BUG-011, T-BUG-012 regression tests
- `setup/agent-templates/MIGRATIONS.json` — migration entries for `arch-platform@1.12.0`, `arch-testing@1.15.0`, `arch-integration@1.12.0`

## Pattern Chain Rationale (W27)

Architects are the pattern-chain gate, not MCP tool holders. context-provider holds `search-docs`, `find-pattern`, `module-health`. Devs do NOT have these tools and MUST NOT contact CP directly. The chain is: dev → SendMessage(to="arch-X") → arch → SendMessage(to="context-provider") → CP runs MCP tool → returns to arch → arch sends verified pattern to dev. W27 rolled back direct MCP from architect frontmatter because it bypassed this chain. This is a mechanical enforcement boundary, not a suggestion. Never short-circuit this chain.

## Library Behavior Uncertainty

When a bug or question depends on library behavior (Ktor, Room, Koin scoping, Compose lifecycle):
1. **Check context-provider first** — L0 docs may already cover this.
2. **Check library docs via Context7** — ask context-provider to fetch docs for the specific library + version.
3. **If still uncertain**: state uncertainty explicitly ("I believe X based on [source], verify with minimal test").
4. **Never document unverified library behavior as a pattern** — prior QG cycles on UnconfinedTestDispatcher happened this way.

## Scope Immutability Gate

Distinct from OBS-A (Scope Extension Protocol, which governs *requesting* scope additions). This gate governs *respecting* team-lead rulings on scope already decided.

Before any dispatch that could be interpreted as overriding a team-lead ruling:
1. Locate the explicit ruling in prior messages.
2. Quote it verbatim: "team-lead ruled: '{exact quote}'."
3. Assert: "No scope additions beyond this ruling."
4. Cannot locate a ruling → SendMessage team-lead for clarification first. Do NOT assume.

This prevents silent scope drift where an architect acts beyond authorized boundaries without acknowledging the constraint.
