---
scope: [agents, workflow, runtime-adapter, multi-agent, portable-runtime]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-adapters
status: active
layer: L0
parent: agents-hub
category: agents
description: "Runtime-messaging-adapters hub: portable Wave-1 consultation system layering the disk-artifact floor, adapter contract, orchestrator role, and standalone/mixed operating modes"
version: 1
last_updated: "2026-09"
token_budget: 1400
---

# Runtime Messaging Adapters

Wave 1 (Portable Runtime Collaboration & Persistent Role Lifecycle, `BACKLOG.md`) restores live consultation between canonical support roles — architects, context-provider, doc-updater — over a portable disk-artifact floor, so the same protocol works whether the runtime is Claude Agent Teams, Claude without Agent Teams, a persistent Codex worker, Codex MCP, or disk-only fallback.

## Three-Layer System

1. **Authoritative disk-artifact floor** — validated artifacts under one configured `coordination_root`. A request/result/lease/acceptance record is the only evidence; adapter delivery, message text, an MCP return value, or a live peer saying "GO" is never evidence.
2. **Adapter contract** — the engine-agnostic 9-op `RuntimeAdapter` interface from [ADR-001 §3](../adr/ADR-001-runtime-adapter-contract.md#3-the-9-operation-adapter-interface-constraint-3), extended here with consultation dispatch/await semantics and versioned activation drivers (never a parallel `ConsultationAdapter` facade).
3. **Orchestrator role** — schedules, wakes, validates, and reports; it may not synthesize or impersonate an architect's or context-provider's answer.

ADR-001 §1 separately draws a three-*concept* distinction (portable orchestrator role vs. the obsolete `TeamCreate` primitive vs. preservable capabilities like `SendMessage`/background peers) that this system's adapter layer builds on directly.

## Architecture Map

All three runtime facades are thin **composition/CLI roots**, not owners of domain logic: each requires its own internal modules, wires them together by dependency injection, and re-exports the composed surface unchanged. None retains residual orchestration — the module-boundaries suites enforce this identically for all three.

| Facade (composition/CLI root) | Internal module directory, by responsibility | Physical LOC / max line | Modules | Public ABI |
|---|---|---|---|---|
| `scripts/lib/runtime-consultation.cjs` | `runtime-consultation/`: identity/argv/path primitives, durability, protocol, transactions, transition locks, host bridge, content publication, R33 conformance (deferred, see below), root lifecycle/ACL, grant registry and authority, routing/canonical-request construction, dispatch, CLI command controllers | 1,402 / 235 | 57 | 69 keys |
| `scripts/lib/runtime-role-lifecycle.cjs` | `runtime-role-lifecycle/`: bindings, actions, policy, authority, grants, recovery, root-source contract/bootstrap history, and Claude lifecycle observations | 1,500 / 283 | 63 | 271 keys |
| `scripts/lib/runtime-bridge-codex.cjs` | `runtime-bridge-codex/`: process admission, isolation, credentials and owned-child lifecycle, plus supervisor/connection engines, turn execution and read-view projection, internal-search/Context7 evidence retrieval, deterministic MCP loopback (test-only), and CLI command controllers | 1,018 / 282 | 84 | 50 keys (79 under test capability) |

Counts above are recalculated from disk, not hand-maintained prose — `scripts/tests/runtime-messaging-docs-drift.test.js` re-derives every number in this table straight from the module-boundaries suites and this file's own source text, and fails if either drifts from the other. For per-module names, dependency edges and exact reference-identity guarantees, the **source of truth is the three `scripts/tests/runtime-{consultation,role-lifecycle,bridge-codex}-module-boundaries.test.js` suites**, never this page: they pin the exact discovered module set per tree, assert no upward/sibling-cycle imports, and verify every public export is the literal composed reference, not a copy. Runtime authority state is facade/provider-local; consultation's deterministic fixed-id/fixed-clock CLI seam is intentionally process-scoped because each production CLI invocation is a fresh process.

## Compatibility Invariants

Every internal module across all three trees, enforced by its tree's own module-boundaries suite:

- **Frozen CommonJS ABI.** Each facade's public export set (`module.exports`) is closed and pinned by an exact key-count assertion (69 / 271 / 50 & 79 — see table above); an unreviewed export addition or removal fails that suite.
- **Closed, frozen factories.** Every internal module exports exactly one `createXxx(deps)` factory whose returned surface is `Object.freeze`d — never a mutable object leaking internal state.
- **Dependency injection only.** A module receives every collaborator it needs as an injected dependency from its facade; it never `require()`s a sibling module or the facade itself. The facade is the sole composition root per tree.
- **Per-instance state.** Two instances constructed from the same factory never share mutable state (timers, caches, registries) — proven by dedicated isolation tests, not merely assumed.
- **No upward imports, no cycles.** A module never imports its own facade, another tree's facade, or a sibling in a way that would create a cycle; dependency direction is strictly downward from the facade.
- **Readability ceilings.** Every module is ≤500 physical lines, ≤320 characters per line, and no single function body exceeds 500 lines; each facade is ≤1,500 physical lines, ≤320 characters per line. These ceilings are enforced recursively (every nested module, not an allowlist) so a future large-file regression fails CI rather than accumulating silently.
- **Cross-platform separation.** Module extraction itself is platform-neutral; only genuinely platform-specific concerns (Windows ACL checks, Windows process-birth observers) are explicitly scoped behind `process.platform` checks, never a whole module silently assuming one OS.
- **The local user account is a trust boundary.** Owner-confinement (0700 roots, owner checks, Windows owner-only ACLs) defends against *other* users on the host. Against a process already running as the SAME uid the contract is **detection, not prevention**: fd-binding, `O_NOFOLLOW`, and before/after identity re-checks prove tampering happened, they do not make it impossible. `root-lifecycle.cjs` names a same-uid attacker explicitly and answers with an identity re-check; `durability/write.cjs` answers a planted byte-identical file or hard link with fd-binding and a re-fstat compare; `app-server-pinned-image.cjs` executes a *verified isolated copy* — never described as immutable, because a same-uid process can still alter it between the final verification and the spawn. Any module claiming more than this is overclaiming, and POSIX/Win32 offer no portable primitive (`fexecve`, `memfd_create` + `F_SEAL_WRITE`) that Node exposes to deliver it.
- **Security identity is compared in BigInt, never as a double.** `fs.Stats` reports `dev`/`ino`/`mode`/`uid`/`nlink` as doubles unless `{ bigint: true }` is requested. Windows NTFS file IDs are 64-bit and routinely exceed `Number.MAX_SAFE_INTEGER`, so two genuinely different files become indistinguishable once rounded — measured on a real runner, ino `28710447629357696` satisfies `ino + 1 === ino`. Every identity, ownership, mode and timestamp comparison therefore uses bigint stats; only a byte length ever crosses to `Number`, and only after it is proven `<= Number.MAX_SAFE_INTEGER`.
- **Live-harness prohibition during offline maintenance.** Refactor/documentation/audit work never launches genuine-live certification, real agent workers, retained bridge sessions, or a real Codex app-server; verification uses injected fakes, temp fixtures and the accepted boundary/characterization suites.

L1/L2 distribution is part of the contract: `runtime-project-context.cjs` and the TypeScript sync engine recursively enumerate all three trees, reject symlinks, sort paths and bind the same digest. Their parity tests prevent a new internal module from working only in L0.

## Sub-documents

| Doc | Covers |
|---|---|
| [runtime-messaging-protocol](runtime-messaging-protocol.md) | `consult/v2`, `result/v2`, `inbox-ref/v1`, `cancel/v1`, `stop/v2` artifact shapes; the 6-step consultation loop |
| [runtime-messaging-state-machine](runtime-messaging-state-machine.md) | Transaction namespace, `attempt_id`+`lease_epoch` fencing, state transitions, takeover |
| [runtime-messaging-drivers](runtime-messaging-drivers.md) | Activation driver table, routing, fallback matrix, context7-preferred evidence policy, driver-fallback recovery |
| [runtime-messaging-bridges](runtime-messaging-bridges.md) | Host bridge contracts: Claude `SendMessage`/`claude-agent`, Codex app-server/MCP, registered disk consumer |
| [runtime-messaging-cp-writer](runtime-messaging-cp-writer.md) | context-provider's narrow result-publication boundary + PATTERN-GAP ingestion workflow |
| [runtime-messaging-modes](runtime-messaging-modes.md) | Standalone (Claude-only) vs mixed (Codex worker opt-in) operation, and the preconditions a consumer repository must satisfy |

## Current Measured Status (2026-09)

- **Mixed operation is live-qualified.** A real session drove the split support plane end to end: one
  batched `supervisor-start` owning the two opted-in Codex roles plus three native `role-spawn`
  actions, all five roles healthy, a correlated mixed-review verdict published by the retained Codex
  reviewer, and a documentation consultation answered through the toolkit's own MCP `search-docs`
  with all six correlated refs. Modes, preconditions and operating notes are in
  [runtime-messaging-modes](runtime-messaging-modes.md).
- **A parked role is a healthy role.** An admitted Claude-native role parks in `WAITING` once its
  startup turn ends; `READY`, `WAITING` and `BUSY` are all usable, and any check that demands exactly
  `READY` will be unsatisfiable in a plane that has finished starting.
- **Refusals are named on stderr**, never in the stdout envelope, whose schema is frozen and whose
  detail-code vocabulary is closed. Look for `[<command>] retained pair unresolved: …`,
  `[ensure] roles unavailable: <role>:<reason>` and `[session-run] transport stopped: …`.
- **R33 native** remains deferred and unclaimed; its own CI gate stays pending/opt-in.

## Historical Measured Status (2026-08)

- **context7-preferred** evidence policy shipped alongside the existing strict `context7-required` — detail in [runtime-messaging-drivers § Context7 Evidence Policy](runtime-messaging-drivers.md#context7-evidence-policy).
- **Driver fallback** (takeover-and-redispatch on lease loss) implemented and end-to-end verified, including a real inbox-ref `created_at` collision bug found and fixed this session — detail in [runtime-messaging-drivers § Driver Fallback](runtime-messaging-drivers.md#driver-fallback-takeover-and-redispatch).
- **Matrix 3** (live Codex app-server, real mission): GREEN (mailbox Sequence 48) — the real five-role support plane completed its disk-authoritative chain (`toolkit-specialist -> arch-platform -> context-provider -> same arch-platform -> original toolkit-specialist`) with a current accepted result, an ack, real cited Context7 evidence, and zero repository mutation. The earlier Matrix-3 execution blocker is superseded for this live path; the separate request-scoped human-consent/actor-auth hardening gap remains open in `BACKLOG.md` and is not required to classify the measured Matrix-3 run as GREEN.
- **M9-A** local E2E: GREEN `11/11` (Sequence 49), no skips, leaks or repository writes. Real Windows remote execution remains `PENDING_REAL_WINDOWS_REMOTE_EXECUTION` — local GREEN is not an overall M9-A or Windows GREEN claim.
- **Stabilization**: full native Bats `3198/3198` and Node `2611/2611` GREEN (Sequence 59); all previously observed Bats failures were investigated, none deleted, skipped, weakened or quarantined.
- **R33 native (M2-M5/M9-NATIVE)**: `PENDING_EXTERNAL_RELEASE` — does not block Wave 1 functional closure (`BACKLOG.md` § Backlog and memory impact).
- **Matrix 2** (2026-08-20): the accepted historical real-Context7 capability proof; re-validated read-only this session. It predates `context7-required`'s pattern-evidence enforcement (landed 2026-08-21) and should not be read as demonstrating that current enforcement path.

## Related Docs

- [ADR-001: Runtime Adapter Contract](../adr/ADR-001-runtime-adapter-contract.md) — the 9-op adapter interface this system extends; Appendix B covers the context7-preferred/driver-fallback addendum
- [coordination-artifact-schema](coordination-artifact-schema.md) — the v1 schemas this system's v2 protocol evolves from
