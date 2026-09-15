---
scope: [workflow, ai-agents, runtime-adapter, multi-agent, portable-runtime]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-bridges
status: active
layer: L0
parent: agents-hub
category: agents
description: "Wave-1 host bridge contracts: Claude SendMessage/claude-agent, Codex app-server/MCP, and registered disk consumer, plus persistent dual-runtime session and sibling-worktree semantics"
version: 1
last_updated: "2026-08"
assumes_read: runtime-messaging-drivers
token_budget: 1500
---

# Runtime Messaging Bridges

Ground truth for this doc is `BACKLOG.md` Wave 1 § Persistent dual-runtime behavior, plus the per-driver "Required behavior" column in [runtime-messaging-drivers](runtime-messaging-drivers.md#activation-drivers-hard) (cross-referenced here, not duplicated).

A host-side supervisor owns process/session liveness — language models are not expected to block forever inside one inference call.

## Claude Bridge

- With Agent Teams/native roster capability, `ensureRole` creates or reuses exactly one canonical teammate per configured support role and parks it in `WAITING` between requests. `SendMessage` is only the notification transport after a healthy binding is proven — send only role + artifact path + kind/request id, never treat reply text as evidence.
- Without Agent Teams, the same project policy selects retained Codex, canonical single-use respawn+bundle rehydration, adapter MCP, or supervised disk fallback (the `claude-agent` driver) — no path silently assumes `TeamCreate` (see [ADR-001 §1.2](../adr/ADR-001-runtime-adapter-contract.md#12-teamcreate--team_name--obsolete-claude-legacy-runtime-primitive), the obsolete primitive this bridge never depends on).
- Claude workers may be parked in bounded wait cycles, woken by their native surface, and resumed against the configured coordination root.

## Codex Bridge

- `codex-app-server` / persistent thread wakes a parked Codex worker by starting the retained `session-run` only through the exact top-level-owned `supervisor-start` action/background task, then resumes the canonical worker from disk — never an operator/out-of-band launch.
- `codex-mcp` invokes Codex on demand from Claude or another MCP host; the sandboxed model stays read-only, the trusted host validates its correlated result envelope and is the sole publisher of `result/v2` — returned text alone is insufficient.

## Registered Disk Consumer

`runtime-spawn` wakes an already-supervised registered disk consumer through only its fixed allowlisted wake helper; it never starts a model or carries result content. `noop` plus disk polling completes only when a separately registered external supervisor/worker already exists; otherwise it deterministically times out.

## Session & Restart Semantics

- Either runtime can initiate a request by writing the same artifact; the other can answer without the user copying text between applications.
- Default mode sets `coordination_root=<worktree>/.planning/coordination`; exactly one root/version is authoritative per request. A legacy v1 adapter is read-only and may translate an observation into diagnostics, but it cannot mirror two authoritative copies or let a v1 marker satisfy v2 completion.
- **Sibling-worktree case**: `coordination_root` may be explicitly configured to a same-machine host-local directory shared by those worktrees. It must be canonicalized, symlink-safe, owner-confined (`0700`-equivalent where supported), explicitly granted to both runtimes, and keyed by a stable repository identity separate from worktree ids. Requests bind the reviewed subject snapshot exactly; different producer HEADs do not by themselves invalidate a result, but an undeclared or changed subject snapshot does.
- Cross-host/network federation remains deferred — a shared coordination root is a same-machine disk transport, not a broker.
- If only one runtime is running, the same protocol works through spawn/MCP/polling or terminates cleanly at its deadline.
- Session restart invalidates old native bindings. A healthy retained worker may be rediscovered; every other role is canonically respawned/reconnected and rehydrated from disk. Idle, dead, and ambiguous are distinct states.

## Related Docs

- [runtime-messaging-adapters](runtime-messaging-adapters.md) — hub
- [runtime-messaging-drivers](runtime-messaging-drivers.md) — activation driver table + fallback matrix these bridges implement
- [ADR-001 §4](../adr/ADR-001-runtime-adapter-contract.md#4-per-engine-adapter-matrix-constraint-4) — per-engine adapter matrix (spawn/send/status/... op mapping)
