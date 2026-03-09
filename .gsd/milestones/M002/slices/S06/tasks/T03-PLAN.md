# T03: 10-doc-intelligence-detekt-generation 03

**Slice:** S06 — **Milestone:** M002

## Description

Build the review state tracking system and monitor-sources MCP tool that provides tiered source monitoring with review-aware filtering.

Purpose: Users can run source monitoring on demand or via CI, see only new findings (not previously reviewed ones), and approve/reject/defer findings. The MCP tool is the primary programmatic interface for AI agents.
Output: Review state persistence, report generator, monitor-sources MCP tool registered in tool index.

## Must-Haves

- [ ] "Review state persists accepted/rejected/deferred findings between runs"
- [ ] "Next monitoring run only shows new findings (reviewed findings are filtered)"
- [ ] "Deferred findings re-surface after configurable TTL (default 90 days)"
- [ ] "monitor-sources MCP tool returns structured JSON with findings, tier filter, and review-aware filtering"
- [ ] "Report generator produces tiered summary with severity counts"

## Files

- `mcp-server/src/monitoring/review-state.ts`
- `mcp-server/src/monitoring/report-generator.ts`
- `mcp-server/src/tools/monitor-sources.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/monitoring/review-state.test.ts`
- `mcp-server/tests/unit/monitoring/report-generator.test.ts`
- `mcp-server/tests/unit/tools/monitor-sources.test.ts`
