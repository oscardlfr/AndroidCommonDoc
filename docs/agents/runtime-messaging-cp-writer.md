---
scope: [workflow, ai-agents, context-provider, coordination, portable-runtime]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-cp-writer
status: active
layer: L0
parent: agents-hub
category: agents
description: "context-provider's one narrow Wave-1 write capability (publishing its own nested-consultation result/v2) and the PATTERN-GAP -> user-approved ingestion workflow it separately originates"
version: 1
last_updated: "2026-08"
assumes_read: runtime-messaging-protocol
token_budget: 900
---

# Runtime Messaging CP Writer

Ground truth for this doc is `BACKLOG.md` Wave 1's "narrowly confined context-provider result-publication path" (§ Included scope and probable files) and the PATTERN-GAP block in § Runtime consultation loop.

## Read-Only Boundary (HARD)

context-provider is a **leaf only** in the consultation graph — per [runtime-messaging-protocol § Mediated Specialist Path](runtime-messaging-protocol.md#mediated-specialist-path), it answers a nested request from an architect but never originates a consultation request to another role. Wave 1 adds exactly one narrow write capability: publishing its own `result/v2` for the active nested-consultation claim it is answering. Everywhere else, context-provider's read-only boundary is preserved unchanged — see [coordination-artifact-schema § CP-Consult Unblock](coordination-artifact-schema.md#cp-consult-unblock) and [ADR-001 §5.2](../adr/ADR-001-runtime-adapter-contract.md#52-execution-phase) ("CP stays read-only, so the gate reads the artifact itself rather than gaining a new writer hook").

## PATTERN-GAP Ingestion Workflow

context-provider's one other origination path is a separate documentation workflow, not a consultation:

```text
context-provider PATTERN-GAP
  -> request/v1 kind:ingestion
  -> orchestrator obtains explicit user approval/v1
  -> lifecycle wakes/reuses doc-updater
  -> search/deduplicate -> ingest -> validate -> write -> audit
  -> correlated result/v1 ingestion profile -> callback
```

Wave 1 preserves the generic v1 schemas but adds an ingestion-specific consumer that validates exact `request_id`, `request_kind:"ingestion"`, `approval_sha256`, `approver:"user"`, doc-updater authorship/target, disposition, audit status, and confined files. A generic uncorrelated `result/v1` cannot complete ingestion. Missing or denied approval means zero documentation writes; a second equivalent ingestion must take the deduplication path.

This doc set is itself a small instance of that gap: `consult/v2`/`result/v2` were previously undocumented outside `PLAN.md` and code — see [runtime-messaging-protocol](runtime-messaging-protocol.md).

## Related Docs

- [runtime-messaging-adapters](runtime-messaging-adapters.md) — hub
- [runtime-messaging-protocol](runtime-messaging-protocol.md) — the mediated specialist path context-provider answers into
- [coordination-artifact-schema](coordination-artifact-schema.md) — `request/v1`/`approval/v1` field-level contract
- [ingestion-loop](ingestion-loop.md) — the full PATTERN-GAP → doc-updater loop
