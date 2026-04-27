---
scope: [workflow, ai-agents, scope-extension, gates]
sources: [androidcommondoc]
targets: [all]
slug: scope-extension-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "Mechanical scope-extension gate: when architects hit out-of-scope blockers, request authorization via team-lead before committing. Hook at .claude/hooks/architect-scope-gate.js blocks Write/Edit calls on non-scoped files."
version: 1
last_updated: "2026-04"
assumes_read: tl-dispatch-topology, tl-verification-gates
---

# Scope Extension Protocol

When an architect needs to edit a file outside the current wave's declared scope, they MUST obtain explicit authorization from the team-lead before proceeding. The mechanical gate at `.claude/hooks/architect-scope-gate.js` enforces this — but the protocol defines the human-side workflow the gate is backing up.

## Why This Exists

Wave 20 produced two violations where architects edited out-of-scope files silently:

- Pre-emptive `.gitattributes` addition (scope: registry only)
- Option B row reorder in an unrelated doc

Both were authorized retroactively. The pattern of "I inferred it was OK" erodes the wave boundary discipline that keeps scope creep measurable. The hook mechanically blocks silent violations; this doc defines the authorization workflow.

## When Scope Extension Is Required

Any file not listed in the current wave's "Scope files (machine-readable)" subsection in `.planning/PLAN.md`.

| Scenario | Requires authorization? |
|----------|------------------------|
| File explicitly listed in PLAN.md scope section | No — proceed |
| File not listed, but "obviously related" | **Yes — always** |
| One-line bookkeeping edit (e.g., README count bump) | **Yes — always** |
| CI repair touching a shared config file | **Yes** (use escape hatch if urgent) |
| File in a different wave's scope section | **Yes — always** |

There are no exceptions based on edit size. A one-character change to an out-of-scope file still requires authorization.

## How to Request Authorization

When blocked by the gate (or before touching a file you recognize as out-of-scope):

**Step 1** — Send a structured authorization request to team-lead:

```
SendMessage(to="team-lead", summary="scope extension request: {filename}", message="""
**Blocker**: [why the current dispatch cannot proceed without this file]
**Root cause**: [which file needs editing outside current wave scope]
**Proposed fix**: [exact change — paste the diff or describe line-by-line]
**Scope delta**: [+N files — list each path]
**Why not defer**: [what breaks or blocks if this waits for a future wave]
""")
```

**Step 2** — Wait for explicit `AUTHORIZED` from team-lead. Do NOT:

- Re-read PLAN.md and infer authorization from plan text
- Proceed because the fix looks trivial
- Ask another architect to authorize (only team-lead can authorize)

**Step 3** — After `AUTHORIZED` arrives, proceed. The escape hatch (`SCOPE_GATE_DISABLE=1`) may be granted at this point for urgent cases.

## The Mechanical Gate

`.claude/hooks/architect-scope-gate.js` is a PreToolUse hook that:

1. Intercepts `Write` and `Edit` tool calls
2. Checks if the calling agent's `agent_type` starts with `arch-`
3. Reads `.planning/PLAN.md` and parses the "Scope files (machine-readable)" section
4. Compares the target file path against the parsed scope list
5. Blocks the call with an error if the file is not in scope

The hook runs silently when the file IS in scope — no overhead on the happy path.

## Escape Hatch: `SCOPE_GATE_DISABLE=1`

Set the env var to bypass the gate for a single session:

```bash
SCOPE_GATE_DISABLE=1 claude --agent arch-platform
```

Use ONLY when:
- Team-lead has explicitly authorized the bypass in a SendMessage
- The fix cannot wait for the normal authorization flow (e.g., CI is failing and blocking a deploy)

**The bypass always writes an audit entry:**

```
.planning/scope-gate-bypasses.log
```

Each entry includes: ISO timestamp, `agent_type`, target file path, and the agent's stated reason. This log is reviewed at each wave close. Unexplained bypasses → escalation to user.

## Scope Source Format

The gate parses bullet-list entries matching this pattern in PLAN.md:

```markdown
### Scope files (machine-readable)

- `path/to/file.md`
- `scripts/sh/example.sh`
- `.claude/hooks/architect-scope-gate.js`
```

Rules:
- Paths MUST be wrapped in backticks
- One path per bullet
- Relative to project root (no leading `/`)
- The subsection heading MUST be exactly `### Scope files (machine-readable)`

The planner template owns this format contract. When adding a wave to PLAN.md, the planner MUST include this subsection or the gate treats the wave as having zero scope (all writes blocked).

## Examples

**Correct flow:**

```
arch-platform hits gate on docs/agents/agents-hub.md (not in scope)
  → SendMessage(to="team-lead", "scope extension request: agents-hub.md ...")
  → team-lead responds: "AUTHORIZED — add hub pointer for scope-extension-protocol.md"
  → arch-platform proceeds
```

**Wrong — silent inference:**

```
arch-platform reads PLAN.md, sees "Doc update" mentioned in wave description
  → infers agents-hub.md is implicitly in scope
  → proceeds without authorization
  ❌ Gate blocks this — "mentioned in description" ≠ listed in scope section
```

**Wrong — trivial edit bypass:**

```
arch-integration: "it's just a one-liner in CHANGELOG.md, not worth blocking"
  → edits CHANGELOG.md without asking
  ❌ Size of change is irrelevant — scope boundary is the criterion
```

**Wrong — commit and hope:**

```
arch-testing commits out-of-scope changes with scope change buried in a large diff
  → hopes reviewer doesn't notice
  ❌ Audit log + wave-close review catches this; retroactive authorization costs more time
```

## Companion Hooks (Architect Tool Boundary)

`architect-scope-gate.js` is one of three companion hooks that mechanically enforce the architect-tool-boundary policy. All three are wired into `.claude/settings.json` under `PreToolUse`. Together they prevent architects from authoring code or docs through ANY tool path — architects detect, plan, and verify; specialists implement.

| Hook | Trigger | Blocks |
|------|---------|--------|
| `architect-scope-gate.js` | `PreToolUse` on `Write`/`Edit` | Out-of-scope file edits (this doc) |
| `architect-self-edit-gate.js` | `PreToolUse` on `Write`/`Edit` | Any source/template edit by `arch-*` agents — only `.planning/wave*/arch-*-verdict.md` allowed |
| `architect-bash-write-gate.js` | `PreToolUse` on `Bash` | Bash bypass patterns: heredoc redirect, `sed -i`, `awk -i inplace`, `python -c open(...,'w')`, `python <<EOF` heredoc with `open(...,'w')`, `tee` to file, plain `>`/`>>` shell redirect. Exempt targets: `/tmp/*`, `$TMPDIR/*`, `/dev/null`, `/dev/std*`, `.planning/wave*/arch-*-verdict.md`, `.androidcommondoc/audit-log.jsonl` |

When designing a new architect-class agent, audit it against all three hooks: any tool the agent uses must satisfy each gate's contract.

Test coverage lives in `scripts/tests/architect-self-edit-gate.bats` (5 tests) and `scripts/tests/architect-bash-write-gate.bats` (23 tests). The scope-gate test surface is integration-tested via the `scope-extension-protocol` Vitest suite.

## Relationship to Other Patterns

| Pattern | Relevance |
|---------|-----------|
| [`tl-dispatch-topology`](tl-dispatch-topology.md) | team-lead dispatch rules and pre-dispatch topology gate — this protocol applies at the architect layer, downstream of team-lead dispatch |
| [`tl-verification-gates`](tl-verification-gates.md) | Architect APPROVE/ESCALATE verdicts — scope violations discovered here trigger ESCALATE, not silent fix |
| Memory: `feedback_scope_extension_protocol` | Historical context: Wave 20 incidents that prompted this protocol |
| Memory: `feedback_amend_requires_explicit_user_request` | Related: architect dispatch ≠ user authorization for amend-class changes |
| Memory: `feedback_architect_writes_code.md` | Recurring root pattern that motivated all three companion hooks |

## Rules

- NEVER self-authorize a scope extension by re-reading plan text
- NEVER use "it's just a one-liner" as justification
- ALL `SCOPE_GATE_DISABLE=1` usages appear in the bypass log — no invisible bypasses
- Bypass log is reviewed at every wave close without exception
- Authorization request must include `**Why not defer**` — if you can defer, defer
