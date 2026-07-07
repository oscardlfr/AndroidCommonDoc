---
scope: [workflow, ai-agents, scope-extension, gates]
sources: [androidcommondoc]
targets: [all]
slug: scope-extension-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "Scope-extension discipline: touching files outside the wave's declared scope requires orchestrator authorization first. Architect writes to non-verdict files are blocked by architect-self-edit-gate.js + architect-bash-write-gate.js (the earlier per-file architect-scope-gate.js is retired/superseded)."
version: 1
last_updated: "2026-04"
assumes_read: tl-dispatch-topology, tl-verification-gates
---

# Scope Extension Protocol

Touching a file outside the current wave's declared scope requires explicit authorization from the orchestrator (team-lead role) before proceeding. This is a **discipline for whoever performs edits** — specialists (scoped by their dispatch artifact's authorized `files[]`) and the orchestrator. Architects are separately barred from writing any non-verdict file by `architect-self-edit-gate.js` (see Companion Hooks), so for an architect the rule is stronger still: raise the out-of-scope finding in your verdict; do not attempt the edit. The earlier per-file `architect-scope-gate.js` — a scope-LIST gate for architects — is **retired**: it became redundant once `architect-self-edit-gate.js` blocked architect writes wholesale.

## Why This Exists

Wave 20 produced two violations where architects edited out-of-scope files silently:

- Pre-emptive `.gitattributes` addition (scope: registry only)
- Option B row reorder in an unrelated doc

Both were authorized retroactively. The pattern of "I inferred it was OK" erodes the wave boundary discipline that keeps scope creep measurable. The architect write-boundary hooks (see Companion Hooks) block architect edits mechanically; this doc defines the authorization workflow for the agents that do write.

## When Scope Extension Is Required

Any file not listed in the current wave's "Scope files (machine-readable)" subsection in `.planning/wave-<slug>/PLAN.md`.

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

**Step 3** — After `AUTHORIZED` arrives, proceed. There is no env-flag escape hatch — the old `SCOPE_GATE_DISABLE=1` is retired and has no effect (see Escape Hatch (retired)); the edit is made by the orchestrator or a scoped specialist, not by the architect.

### Portable Mode

When no live `SendMessage` channel exists (portable/single-use runtime), Step 1 becomes: the requester writes a `request/v1` artifact to `requests/<kind>/<request_id>.json` (`kind` e.g. `scope-extension`) instead of the SendMessage call, carrying the same Blocker/Root cause/Proposed fix/Scope delta/Why-not-defer fields. Step 2's wait becomes: poll for the matching `approval/v1` artifact at `approvals/<request_id>.json` — the orchestrator resolves that exact `request_id`, never a glob over `approvals/`. Step 3 is unchanged: proceed only once the `approval/v1` artifact exists. Full schema: [coordination-artifact-schema](coordination-artifact-schema.md).

## The Mechanical Enforcement

The architect write-boundary is enforced by two wired `PreToolUse` hooks (see Companion Hooks), not by a per-file scope list:

1. `architect-self-edit-gate.js` blocks any `Write`/`Edit` by an `arch-*` agent to anything other than its own `.planning/wave*/arch-*-verdict.md` / `arch-*-cross-verify.md`. Architects therefore cannot edit source or docs at all — in-scope or out.
2. `architect-bash-write-gate.js` blocks the Bash write-bypass paths (heredoc, `sed -i`, redirect, `tee`) that could otherwise route around the first gate.

The retired `architect-scope-gate.js` used to compare an architect's edit target against the PLAN.md "Scope files" list. Once `architect-self-edit-gate.js` forbade architect writes wholesale, that per-file check was redundant and was removed. Scope discipline for the agents that *do* write — specialists and the orchestrator — is carried by the dispatch artifact's authorized `files[]` and the human authorization protocol above.

## Escape Hatch (retired)

The old `SCOPE_GATE_DISABLE=1` env bypass belonged to the retired `architect-scope-gate.js` and no longer has any effect. Architects have no self-edit bypass by design: an architect that needs a file changed raises it in its verdict, and the orchestrator (or a scoped specialist) makes the edit. Urgent cross-scope repairs go through the authorization protocol above, not an env flag.

## Scope Source Format

The gate parses bullet-list entries matching this pattern in PLAN.md:

```markdown
### Scope files (machine-readable)

- `path/to/file.md`
- `scripts/sh/example.sh`
- `.claude/hooks/premature-execution-gate.js`
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
arch-platform finds docs/agents/agents-hub.md needs a hub pointer (not in scope)
  → it cannot edit any file itself (architect-self-edit-gate); it raises the finding
  → SendMessage(to="team-lead", "scope extension request: agents-hub.md ...")
  → team-lead responds "AUTHORIZED" and dispatches a scoped specialist (or edits) to add it
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

Two wired `PreToolUse` hooks in `.claude/settings.json` enforce the architect-tool-boundary policy. Together they prevent architects from authoring code or docs through ANY tool path — architects detect, plan, and verify; specialists implement. (A third, `architect-scope-gate.js`, a per-file scope-list gate, was retired once the self-edit gate made it redundant — see The Mechanical Enforcement.)

| Hook | Trigger | Blocks |
|------|---------|--------|
| `architect-self-edit-gate.js` | `PreToolUse` on `Write`/`Edit` | Any source/template edit by `arch-*` agents — only `.planning/wave*/arch-*-verdict.md` and `.planning/wave*/arch-*-cross-verify.md` allowed |
| `architect-bash-write-gate.js` | `PreToolUse` on `Bash` | Bash bypass patterns: heredoc redirect, `sed -i`, `awk -i inplace`, `python -c open(...,'w')`, `python <<EOF` heredoc with `open(...,'w')`, `tee` to file, plain `>`/`>>` shell redirect. Exempt targets: `/tmp/*`, `$TMPDIR/*`, `/dev/null`, `/dev/std*`, `.planning/wave*/arch-*-verdict.md`, `.planning/wave*/arch-*-cross-verify.md`, `.androidcommondoc/audit-log.jsonl` |

When designing a new architect-class agent, audit it against the two active hooks: any tool the agent uses must satisfy each gate's contract.

Test coverage lives in `scripts/tests/architect-self-edit-gate.bats` and `scripts/tests/architect-bash-write-gate.bats`. (The retired `architect-scope-gate.js` test surface was removed with the hook.)

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
- The two active architect gates (`architect-self-edit-gate.js`, `architect-bash-write-gate.js`) are fail-closed with no env bypass — a needed cross-scope edit goes through the authorization protocol above, not a flag (retired `SCOPE_GATE_DISABLE=1` has no effect)
- Authorization request must include `**Why not defer**` — if you can defer, defer
