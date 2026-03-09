# T05: 10-doc-intelligence-detekt-generation 05

**Slice:** S06 — **Milestone:** M002

## Description

Build the generate-detekt-rules and ingest-content MCP tools, completing the Phase 10 tool surface.

Purpose: AI agents can trigger Detekt rule generation from pattern docs and ingest arbitrary content (Medium posts, LinkedIn articles, etc.) for pattern extraction. The generate tool bridges frontmatter rule definitions to compiled Kotlin rules. The ingest tool enables users to feed the system knowledge from any source.
Output: Two MCP tools registered in the tool index, with tests.

## Must-Haves

- [ ] "generate-detekt-rules MCP tool triggers rule generation pipeline and returns structured results"
- [ ] "ingest-content MCP tool accepts pasted text and routes extracted patterns to appropriate docs"
- [ ] "Unsupported URLs gracefully degrade with user prompt to paste content"
- [ ] "Content ingestion never auto-applies changes (suggest-and-approve flow)"
- [ ] "Both tools are registered in the MCP server tool index"

## Files

- `mcp-server/src/tools/generate-detekt-rules.ts`
- `mcp-server/src/tools/ingest-content.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/tools/generate-detekt-rules.test.ts`
- `mcp-server/tests/unit/tools/ingest-content.test.ts`
