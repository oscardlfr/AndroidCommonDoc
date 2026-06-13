---
scope: [workflow, ai-agents, context-management]
sources: [androidcommondoc]
targets: [all]
slug: context-bundle-schema
status: active
layer: L0
parent: agents-hub
category: agents
description: "Context bundle schema: portable file-based contract for respawn/rotation context — storage, TTL, header format, PATTERNS-only rules, writer/consumer contracts"
version: 1
last_updated: "2026-06"
assumes_read: context-rotation-guide
token_budget: 1500
---

# Context Bundle Schema

File-based context bundles are the **primary contract** for handing structured context to context-exhausted or freshly respawned agents. They are plain markdown files — portable to any model/CLI that can read files. Hook-based injection (`SubagentStart` `additionalContext`) is an optional future adapter, never the carrier of this invariant.

## Storage & Naming

```
.planning/wave-{slug}/context-bundles/{role}.md
```

- `{slug}` = **last path-segment** of the branch (`${branch##*/}` / `branch.split('/').pop()`). `feature/payment-api` → `payment-api`; `codex/api-redesign` → `api-redesign`. `develop`, `master`, `main`, `HEAD`, and empty values are rejected. See Writer Contract below for full resolution-precedence order.
- `{role}` = the agent's **canonical name** (= `subagent_type`, e.g. `test-specialist`, `arch-platform`). Overflow peers use their indexed name (`test-specialist-2`).
- Wave dirs are gitignored (`.gitignore` `.planning/wave*/`) — bundles are session-scoped scratch, never committed.
- The `.planning/` path is **exempt from the CP read-gate** — a freshly spawned peer can read its bundle BEFORE its gate-ack to context-provider. Bundle read is therefore always the literal first action.

## TTL & Freshness (session-scoped)

- A bundle is valid ONLY for the wave named in its `wave_slug` header. Consumers MUST ignore a bundle whose `wave_slug` differs from the active wave slug.
- A stale or absent bundle is handled identically: state "no valid bundle found" to team-lead and proceed with the spawn prompt alone. No timer machinery exists — `created_at` is informational for forensics.
- Overwrite semantics: latest write wins. One bundle per role per wave.

## Header Format (YAML frontmatter, all fields required)

```markdown
---
bundle_role: test-specialist
wave_slug: bl-w47-bundles
plan_id: wave-bl-w47-bundles/PLAN.md#T4
created_at: 2026-06-12T19:30:00Z
written_by: context-provider via scripts/sh/write-bundle.sh
schema_version: 1
---
```

- `plan_id`: PLAN.md reference (optionally `#task-anchor`) tying the bundle to the wave plan.
- `schema_version`: bump on breaking header/body changes; consumers tolerate additive fields.

## Body Sections (exact order)

```markdown
## Patterns
- docs/testing/testing-patterns-dispatcher-scopes.md (slug: testing-patterns-dispatcher-scopes) — dispatcher injection rules for the task at hand
- docs/agents/agent-verdict-protocol.md (slug: agent-verdict-protocol) — verdict format you must follow

## Status Snapshot
- task: T4 (write-bundle bats) — state: IN-PROGRESS, 2/3 tests green
- last completed: happy-path test committed in <sha>
- pending on you: error-case test; READY-FOR-REVIEW message to team-lead

## Architect Addendum   <!-- architect-role bundles ONLY -->
- verdict state: APPROVED-PREP emitted (wave-{slug}/arch-platform-verdict.md); VERIFY-FINAL pending
- in-flight findings: F2 (MED) script arg validation unreviewed
- pending dispatches: toolkit-specialist awaiting C2 re-review
```

### Content Rules (HARD)

1. **PATTERNS-only**: doc references = path + frontmatter slug + one-line relevance. NEVER paste file contents, code blocks from the repo, or full doc bodies into a bundle.
2. **No work forecasts**: the Status Snapshot describes the bundle role's OWN current state — never predicted future work for other roles (spawn-prompt hygiene).
3. **Size cap**: body ≤ 60 lines. A bundle REPLACES inline spawn-prompt context; it must never regrow it.
4. **Architect Addendum** (architect roles only) absorbs the pre-rotate brief: current verdict state (PREP/FINAL emitted, file path), in-flight findings (id + severity + one line), pending dispatches awaiting that architect.

## Writer Contract

Bundles are written by **context-provider on team-lead dispatch** — CP's tool surface stays read-only (manifest ABI rule `CONTEXT_PROVIDER_READ_ONLY`: Write/Edit/Agent banned). The single sanctioned write path is the portable script, invoked via Bash:

```bash
bash scripts/sh/write-bundle.sh --role test-specialist \
  --plan-id "wave-bl-w47-bundles/PLAN.md#T4" <<'BODY'
## Patterns
- ...

## Status Snapshot
- ...
BODY
```

- This flag+stdin interface is CANONICAL — it supersedes any positional-arg sketch in wave PLAN.md files.
- Body arrives on stdin; the script authors the YAML header (UTC `created_at`, slug resolution) and writes `context-bundles/{role}.md`, creating directories as needed.
- Slug resolution order: `--slug` flag → `CLAUDE_WAVE_SLUG` env → git branch **last-segment** (`${branch##*/}`); `develop`, `master`, `main`, `HEAD`, and empty values are rejected. Unresolvable slug = error (exit ≠ 0), never a guess. Note: `subagent-start-context-bundle.js` resolves last-segment only — `CLAUDE_WAVE_SLUG` does not persist to the SubagentStart event, so env is intentionally omitted there.
- The script writes ONLY under `.planning/wave-{slug}/context-bundles/` — any other target is out of contract. CP's Bash tool is authorized for THIS script invocation only; every other write-capable Bash call remains banned under `CONTEXT_PROVIDER_READ_ONLY`.
- Portability: in non-Claude environments any file-capable agent may run the same script — the schema, not the orchestrator, is the contract.

## Consumer Contract (spawn-prompt mandate)

Every spawn/respawn prompt for a role that has (or may have) a bundle MUST open with this line:

> **FIRST: Read your bundle at `.planning/wave-{slug}/context-bundles/{role}.md` before any other action (then gate-ack to context-provider). If it is absent or its `wave_slug` does not match the active wave, report "no valid bundle" to team-lead and proceed without it.**

Sole exception to the gate-ack half: `context-provider` itself — it is the gate's oracle and cannot ack itself; its prompts carry only the bundle-read half.

Spawn points carrying the mandate: [tl-session-setup](tl-session-setup.md), [tl-session-start](tl-session-start.md), [main-agent-orchestration-guide](main-agent-orchestration-guide.md), [context-rotation-guide](context-rotation-guide.md) §3, [team-topology](team-topology.md), [tl-phase-execution](tl-phase-execution.md).

## Relationship to Kill-Then-Respawn Rotation

1. team-lead decides to rotate role X → dispatches CP: `write_bundle(X, plan_id, status_snapshot)`.
2. CP writes the bundle (script above) and confirms the path.
3. team-lead kills properly: `shutdown_request` → VERIFY member entry gone from team config (escalate to user if it lingers).
4. team-lead respawns the **CANONICAL name** with the spawn-prompt mandate; the fresh peer reads the bundle as its first action.

The bundle is written BEFORE the kill — a dead peer cannot be queried for its state. NEVER spawn an indexed `-2` replacement instead of rotating (dead-inbox routing; see [context-rotation-guide](context-rotation-guide.md) §3 anti-pattern).

## Related Docs

- [context-rotation-guide](context-rotation-guide.md) — rotation strategies this schema plugs into
- [tl-session-setup](tl-session-setup.md) — Phase 2 spawn prompts
- [context-provider-adoption-hooks](context-provider-adoption-hooks.md) — CP gate + PATTERNS-only boundary
- [agent-verdict-protocol](agent-verdict-protocol.md) — verdict state mirrored in Architect Addendum
