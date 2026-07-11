---
scope: [workflow, ai-agents, pm, context-provider]
sources: [androidcommondoc]
targets: [main agent]
slug: tl-pattern-gap-handler
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead handler for PATTERN-GAP signals from context-provider: ask user approval or proceed without; dispatch ingestion on approval."
version: 2
last_updated: "2026-07"
assumes_read: tl-ingestion-request-handler
token_budget: 700
---

# tl-pattern-gap-handler

When context-provider emits `PATTERN-GAP: <topic>` (zero cached patterns + no related sub-docs in `docs/`), team-lead owns the resolution.

## Signal Shape

```
PATTERN-GAP: <topic>
Searched: <what CP searched for>
No results in: docs/, skills/, pattern index
```

## Resolution Protocol

1. **Present to user** via AskUserQuestion:
   > "context-provider found no L0 patterns for `<topic>`. Approve ingestion to add it to the toolkit, or proceed without patterns?"

2. **If user approves ingestion**:
   - Dispatch `doc-updater` with `ingest-content` MCP tool
   - Payload: `{ approved_by: "user", source_type: "context7"|"webfetch", topic, proposed_slug, proposed_category }`
   - Wait for doc-updater `{written_file, audit_status, follow_ups}` response
   - Notify context-provider that pattern is now available

3. **If user declines or proceeds without**:
   - Log decision: `PATTERN-GAP-SKIPPED: <topic>` in wave notes
   - Continue wave with no pattern guidance for the topic

**Portable fallback**: the load-bearing contract here too is the disk artifact, not the AskUserQuestion prompt — the approval above can equally be an `approval/v1` (`decision:"authorized"`, `request_kind:"ingestion"`, `approver: "user"`) written to `approvals/<request_id>.json` — which must reference a `request/v1` created (or referenced) first at `requests/<request_kind>/<request_id>.json`, since the approval links back to it — per [coordination-artifact-schema](coordination-artifact-schema.md); AskUserQuestion/SendMessage is the optional accelerator. Both this handler and [tl-ingestion-request-handler](tl-ingestion-request-handler.md) converge into the same doc-updater artifact triple (`request/v1` → `approval/v1` → `result/v1`) — one resolution shape underneath, regardless of which signal (`PATTERN-GAP` or `ingestion-request`) triggered it.

## Origin

BL-W47-prep-10 C5 — friction signals #17, #28, #44 from L1 BL-W47p session showed agp9-kmp-host-test and kotlinx-benchmark ingestions could have been proactive if CP had signaled gaps early.
