# T04: 08-mcp-server 04

**Slice:** S04 — **Milestone:** M002

## Description

Complete the MCP server with full integration testing, GitHub Actions CI, README documentation, and a manual verification checkpoint to confirm Claude Code registration works on Windows.

Purpose: This is the capstone plan that wires everything together, adds CI quality enforcement, documents the server for adoption, and verifies the complete stack works end-to-end on Windows with no stdio corruption.

Output: Production-ready MCP server with CI, docs, and verified Claude Code registration.

## Must-Haves

- [ ] "claude mcp add registers the server and Claude Code can list tools, resources, and prompts"
- [ ] "Full integration test passes: server connects via InMemoryTransport and handles resource reads, tool invocations, and prompt retrieval"
- [ ] "GitHub Actions CI runs npm test and npm run lint on push/PR"
- [ ] "README.md documents setup, architecture, and API reference"
- [ ] "Server launches on Windows with no stdio corruption"

## Files

- `mcp-server/README.md`
- `.github/workflows/mcp-server-ci.yml`
- `mcp-server/tests/integration/stdio-transport.test.ts`
- `mcp-server/src/server.ts`
