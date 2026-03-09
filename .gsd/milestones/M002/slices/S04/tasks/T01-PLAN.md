# T01: 08-mcp-server 01

**Slice:** S04 — **Milestone:** M002

## Description

Bootstrap the MCP server project with TypeScript compilation, all dev tooling, the server factory pattern, utility modules, and stub registration functions for resources/tools/prompts.

Purpose: Establish the compilable, testable foundation that Plans 02 and 03 build on. The server factory pattern (separate from transport) enables unit testing with InMemoryTransport. The stub registration functions define the interface contract that downstream plans implement.

Output: A working `mcp-server/` directory that compiles, passes linting, and has a server that starts on stdio (with empty handlers). Tests verify stdio cleanliness and utility modules.

## Must-Haves

- [ ] "Server process starts and connects via stdio transport without crashing"
- [ ] "Zero bytes appear on stdout before a JSON-RPC request is received (no console.log pollution)"
- [ ] "Logger utility only writes to stderr"
- [ ] "Path resolution finds toolkit root via ANDROID_COMMON_DOC env var or __dirname fallback"
- [ ] "TypeScript compiles clean with strict mode and ES Module resolution"
- [ ] "Vitest runs and passes with the test configuration"

## Files

- `mcp-server/package.json`
- `mcp-server/tsconfig.json`
- `mcp-server/vitest.config.ts`
- `mcp-server/eslint.config.mjs`
- `mcp-server/.prettierrc`
- `mcp-server/.gitignore`
- `mcp-server/src/index.ts`
- `mcp-server/src/server.ts`
- `mcp-server/src/utils/logger.ts`
- `mcp-server/src/utils/paths.ts`
- `mcp-server/src/types/results.ts`
- `mcp-server/src/resources/index.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/src/prompts/index.ts`
- `mcp-server/tests/unit/utils/logger.test.ts`
- `mcp-server/tests/unit/utils/paths.test.ts`
- `mcp-server/tests/integration/stdio-transport.test.ts`
