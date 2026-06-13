---
scope: [agents, hooks, workflow]
sources: [androidcommondoc]
targets: [all]
slug: hook-authoring-conventions
status: active
layer: L0
parent: agents-hub
category: agents
version: 1
last_updated: "2026-06"
description: "Canonical authoring conventions for L0 PreToolUse/PostToolUse hook scripts: exit codes, stdin parsing, identity model, matching rules, and bypass pattern"
---

# Hook Authoring Conventions

Canonical conventions for writing `.claude/hooks/*.js` gate scripts in this repo. All new hooks MUST follow these patterns. When in doubt, read `premature-execution-gate.js`, `context-provider-gate.js`, or `push-authorization-gate.js` as reference implementations.

## Exit Codes

| Code | Meaning | Side-effect |
|------|---------|-------------|
| `0` | Allow / pass — tool call proceeds | None |
| `2` | Block — tool call rejected | Write `{ decision: 'block', reason: '...' }` JSON to **stdout** before exit |
| Any other | Treated as pass by harness | Hook failure must never block; fail-open |

**Blocking output format** (stdout only, before `process.exit(2)`):

```js
process.stdout.write(JSON.stringify({ decision: 'block', reason: '<message>' }));
process.exit(2);
```

The `reason` string is shown to the agent. Make it actionable: state what was blocked and how to unblock (e.g. which env var to set, which prerequisite to satisfy).

## Stdin Parsing Pattern

The harness writes a JSON event to the hook's stdin. Every hook MUST:

1. Set a **5-second timeout** that exits 0 (fail-open) if stdin never closes.
2. Accumulate data chunks, then parse in `process.stdin.on('end', ...)`.
3. Wrap all logic in `try/catch` → `process.exit(0)` on any error.

```js
let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    // ... gate logic ...
  } catch {
    process.exit(0); // fail-open on parse error
  }
});
```

**Fail-open is non-negotiable.** A hook that crashes or times out must never block the agent. Gate correctness is enforced by the happy path; the error path always allows.

## Identity Model

The harness populates `data.agent_type` and `data.agent_id` in the stdin JSON:

| Scenario | `agent_type` value | Notes |
|----------|--------------------|-------|
| Main orchestrator | `""` (empty string) | Always exempt from peer-only gates |
| Peer agent (TeamCreate) | The peer's **canonical NAME** (e.g. `"arch-platform"`) | Name set at spawn time |
| Subagent (Agent call) | The subagent's **TYPE** (e.g. `"planner"`) | Type from `subagent_type` field |

**`agent_id` rotates per wake (per respawn or session boundary)** — never use it as an attribution key. Use `agent_type` for all identity checks. This is why session-scoped gates write flags keyed on `session_id` (from `data.session_id`), not `agent_id`.

Empty `agent_type` reliably identifies the main orchestrator:

```js
const agentType = (data.agent_type || '').trim();
if (agentType === '') process.exit(0); // main orchestrator — always exempt
```

## Identity Matching Rules

Use `startsWith(canonical)` to tolerate indexed suffixes (e.g. `arch-platform-2`). Never use exact substring match over the full event payload — it fires on unrelated prose in command strings.

```js
// CORRECT — suffix-tolerant
const EXEMPT = ['context-provider', 'team-lead'];
if (EXEMPT.some(e => agentType.startsWith(e))) process.exit(0);

// WRONG — exact match misses -2/-3 suffixed peers
if (agentType === 'context-provider') process.exit(0);

// WRONG — substring match fires on command content
if (input.includes('context-provider')) process.exit(0);
```

## Bypass Environment Variables

Every gate MUST support a named bypass env var following the convention `<GATE_NAME>_BYPASS=1`. The variable is session-scoped and requires explicit user authorization.

```js
if (process.env.PUSH_AUTHORIZATION_BYPASS === '1') process.exit(0);
```

Name the bypass after the gate file (e.g. `push-authorization-gate.js` → `PUSH_AUTHORIZATION_BYPASS`). Document it in the hook file header comment.

Inline bypass tokens (strings embedded in the Bash command, e.g. `[PREMATURE_EXEC_BYPASS]`) are also valid for command-level escape, but env vars are preferred for session-wide bypass.

See `docs/guides/hook-bypass-recursive-pattern.md` for the recursive-gate problem that arises when gate-blocking strings appear in commit messages or PR bodies, and the pattern to avoid it.

## Reference Implementations

| Hook | What it demonstrates |
|------|---------------------|
| `premature-execution-gate.js` | Stdin parse, 5s timeout, `startsWith` subject matching, env bypass, `exit(2)` with JSON reason |
| `context-provider-gate.js` | Empty-`agent_type` main exemption, `startsWith` prefix exemption, session-scoped flag files, fail-open catch |
| `push-authorization-gate.js` | Identity-aware blocking (non-empty `agent_type` = block), stamp validation, `block()` helper, inline `{ decision, reason }` on stdout |
