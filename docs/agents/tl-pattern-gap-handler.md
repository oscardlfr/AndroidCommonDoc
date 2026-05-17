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
version: 1
last_updated: "2026-05"
assumes_read: tl-ingestion-request-handler
token_budget: 600
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

## Origin

BL-W47-prep-10 C5 — friction signals #17, #28, #44 from L1 BL-W47p session showed agp9-kmp-host-test and kotlinx-benchmark ingestions could have been proactive if CP had signaled gaps early.
