# T04: 09-pattern-registry-discovery 04

**Slice:** S05 — **Milestone:** M002

## Description

Evolve docs.ts from hardcoded KNOWN_DOCS to dynamic registry scanning, and implement the find-pattern MCP tool for metadata-based pattern discovery across the registry.

Purpose: Agents can now discover patterns by querying metadata (scope, sources, targets) instead of knowing exact doc names, and new docs are automatically available without code changes. This is the key MCP integration that makes the registry useful to AI agents.

Output: Registry-aware docs.ts (dynamic discovery, backward-compatible URIs), find-pattern tool with Zod schema and rate limiting.

## Must-Haves

- [ ] "docs.ts discovers pattern docs dynamically from the registry scanner instead of hardcoded KNOWN_DOCS"
- [ ] "Existing docs://androidcommondoc/{slug} URIs still work (backward compatible)"
- [ ] "find-pattern tool searches registry metadata (scope, sources, targets) and returns matching entries"
- [ ] "find-pattern supports optional project filter for L1 resolution and 'all' for cross-project search"

## Files

- `mcp-server/src/resources/docs.ts`
- `mcp-server/src/tools/find-pattern.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/resources/docs.test.ts`
- `mcp-server/tests/unit/tools/find-pattern.test.ts`
- `mcp-server/src/resources/index.ts`
- `mcp-server/src/server.ts`
- `mcp-server/src/index.ts`
