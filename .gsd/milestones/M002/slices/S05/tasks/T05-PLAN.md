# T05: 09-pattern-registry-discovery 05

**Slice:** S05 — **Milestone:** M002

## Description

Wire all registry components together with integration tests and verify the complete flow: dynamic doc discovery, find-pattern search, layer resolution, and backward compatibility with existing MCP resources.

Purpose: This is the integration verification that proves the entire registry system works end-to-end. Plans 01-04 built the individual pieces; this plan wires them and validates the complete flow works as a cohesive system.

Output: Integration test suite for the registry, any wiring fixes needed, verified end-to-end registry operation.

## Must-Haves

- [ ] "End-to-end registry flow works: scanner discovers docs with frontmatter, find-pattern searches metadata, docs:// resources serve content"
- [ ] "find-pattern with project filter resolves L1 > L2 > L0 correctly when L1 docs exist"
- [ ] "All existing MCP tests still pass (no regressions from registry evolution)"
- [ ] "Registry discovers all pattern docs (9 originals + 12 sub-docs = 21 total, or 9 hubs + 12 sub-docs)"

## Files

- `mcp-server/tests/integration/registry-integration.test.ts`
- `mcp-server/src/resources/docs.ts`
