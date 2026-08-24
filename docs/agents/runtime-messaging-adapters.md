---
scope: [agents, workflow, runtime-adapter, multi-agent, portable-runtime]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-adapters
status: active
layer: L0
parent: agents-hub
category: agents
description: "Runtime-messaging-adapters hub: portable Wave-1 consultation system layering the disk-artifact floor, the adapter contract, and the orchestrator role — links to protocol/state-machine/drivers/bridges/cp-writer sub-docs"
version: 1
last_updated: "2026-08"
token_budget: 800
---

# Runtime Messaging Adapters

Wave 1 (Portable Runtime Collaboration & Persistent Role Lifecycle, `BACKLOG.md`) restores live consultation between canonical support roles — architects, context-provider, doc-updater — over a portable disk-artifact floor, so the same protocol works whether the runtime is Claude Agent Teams, Claude without Agent Teams, a persistent Codex worker, Codex MCP, or disk-only fallback.

## Three-Layer System

1. **Authoritative disk-artifact floor** — validated artifacts under one configured `coordination_root`. A request/result/lease/acceptance record is the only evidence; adapter delivery, message text, an MCP return value, or a live peer saying "GO" is never evidence.
2. **Adapter contract** — the engine-agnostic 9-op `RuntimeAdapter` interface from [ADR-001 §3](../adr/ADR-001-runtime-adapter-contract.md#3-the-9-operation-adapter-interface-constraint-3), extended here with consultation dispatch/await semantics and versioned activation drivers (never a parallel `ConsultationAdapter` facade).
3. **Orchestrator role** — schedules, wakes, validates, and reports; it may not synthesize or impersonate an architect's or context-provider's answer.

ADR-001 §1 separately draws a three-*concept* distinction (portable orchestrator role vs. the obsolete `TeamCreate` primitive vs. preservable capabilities like `SendMessage`/background peers) that this system's adapter layer builds on directly.

## Sub-documents

| Doc | Covers |
|---|---|
| [runtime-messaging-protocol](runtime-messaging-protocol.md) | `consult/v2`, `result/v2`, `inbox-ref/v1`, `cancel/v1`, `stop/v2` artifact shapes; the 6-step consultation loop |
| [runtime-messaging-state-machine](runtime-messaging-state-machine.md) | Transaction namespace, `attempt_id`+`lease_epoch` fencing, state transitions, takeover |
| [runtime-messaging-drivers](runtime-messaging-drivers.md) | Activation driver table, routing, fallback matrix, context7-preferred evidence policy, driver-fallback recovery |
| [runtime-messaging-bridges](runtime-messaging-bridges.md) | Host bridge contracts: Claude `SendMessage`/`claude-agent`, Codex app-server/MCP, registered disk consumer |
| [runtime-messaging-cp-writer](runtime-messaging-cp-writer.md) | context-provider's narrow result-publication boundary + PATTERN-GAP ingestion workflow |

## Current Measured Status (2026-08)

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
