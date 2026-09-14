---
scope: [workflow, ai-agents, runtime-adapter, multi-agent, portable-runtime]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-modes
status: active
layer: L0
parent: agents-hub
category: agents
description: "How to run the support plane standalone (Claude-only) or mixed (with an opted-in Codex worker), and the preconditions a consumer repository must satisfy for either"
version: 1
last_updated: "2026-09"
assumes_read: runtime-messaging-bridges
token_budget: 1500
---

# Runtime Messaging Modes

Two supported shapes for the five-role support plane — `arch-integration`, `arch-platform`,
`arch-testing`, `context-provider`, `doc-updater`. Both use the same entrypoints, the same disk
artifacts and the same authority chain; they differ only in which driver serves which role.

## Standalone (Claude-only)

The default. `scripts/lib/runtime-collaboration-policy.json` pins the Claude lane
(`requested_host: "claude"`, `fallback: {mode: "deny", allowed: []}`) and names no opted-in Codex
roles, so every role resolves to `claude-sendmessage`.

`init-session` calls `ensure` for the five roles. Each absent role mints one `role-spawn` action;
the host admits it, and the role parks in `WAITING` once its startup turn ends. `WAITING` is a
healthy state — the plane is ready when every role is `READY`, `WAITING` or `BUSY`. Nothing Codex
is required, and no supervisor process exists.

## Mixed (Codex worker opt-in)

Add the roles you want served by a retained Codex worker:

```json
"selection": { "codex_worker_opt_in_roles": ["context-provider", "arch-platform"] }
```

`ensure` then splits the plane: the opted-in roles are collected into exactly **one** batched
`supervisor-start` action (runtime `host-process`), and the remaining roles keep their native
`role-spawn` actions. A five-role ensure therefore legitimately returns one batch action plus three
spawns — the supervisor owns a subset of the requested roles by construction, and that is the normal
shape, not an error.

The supervisor is started once, through `runtime-bridge-codex.cjs session-run` driven by the minted
action — never an operator or out-of-band launch. It provisions one owner-confined isolation root
per role, materializes that root's `config.toml`, spawns a real app-server child, proves the child's
birth provenance, initializes, logs in, starts a thread and completes a bootstrap turn before any
role is reported `READY`. It then stays resident and serves consultations and mixed reviews from its
own service loop until the session generation is retired.

## Preconditions

For either mode, the consumer repository needs:

- a git worktree (the worktree identity and `repo_id` come from it);
- exactly one discoverable `.planning/wave-*/PLAN.md` — its bytes are the `plan_digest` that scopes
  every binding, so editing the PLAN mid-session invalidates the current generation's bindings;
- an owner-confined `.planning/coordination` directory. `root-init` explicitly provisions or repairs
  it through the runtime's `mode:'ensure'` primitive; `root-validate` and `session-run` only validate
  and reject inherited or broadened ACLs rather than silently changing them;
- `mcp-server/build/` built, if documentation consultations will be used. The retained
  `context-provider` answers them by running `mcp-server/build/runtime-search-stdio.js` with its cwd
  set to the project root under consultation, so a repository with no `docs/` tree can only answer
  `BLOCKED` — that is a correct answer, not a failure.

Mixed mode additionally needs:

- a resolvable `CODEX_CLI_PATH` pointing at an app-server-capable Codex binary, and valid
  `~/.codex/auth.json` credentials. Both are re-derived from host evidence at start time; neither is
  taken from a self-asserted capability flag;
- room under the Windows path budget. The isolation root spends a fixed prefix on identity segments,
  and the child's own state databases fail to open if the resulting `CODEX_HOME` is too long. The
  bridge refuses an over-long root before writing anything durable rather than failing later.

## Operating notes

- A support role that has parked in `WAITING` is admitted and resumable. Treat it as available.
- `ensure` returning `READY` with **zero** actions is the signal `init-session` waits for; a
  `READY` that still carries actions is a contradiction and is rejected.
- Refusals are named on stderr (`[<command>] retained pair unresolved: <reason>`,
  `[ensure] roles unavailable: <role>:<reason>`, `[session-run] transport stopped: …`). The stdout
  envelope is a frozen schema with a closed detail-code vocabulary, so stderr is where the
  distinguishing reason lives.
