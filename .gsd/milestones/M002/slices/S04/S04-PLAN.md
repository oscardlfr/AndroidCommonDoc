# S04: Mcp Server

**Goal:** Bootstrap the MCP server project with TypeScript compilation, all dev tooling, the server factory pattern, utility modules, and stub registration functions for resources/tools/prompts.
**Demo:** Bootstrap the MCP server project with TypeScript compilation, all dev tooling, the server factory pattern, utility modules, and stub registration functions for resources/tools/prompts.

## Must-Haves


## Tasks

- [x] **T01: 08-mcp-server 01**
  - Bootstrap the MCP server project with TypeScript compilation, all dev tooling, the server factory pattern, utility modules, and stub registration functions for resources/tools/prompts.

Purpose: Establish the compilable, testable foundation that Plans 02 and 03 build on. The server factory pattern (separate from transport) enables unit testing with InMemoryTransport. The stub registration functions define the interface contract that downstream plans implement.

Output: A working `mcp-server/` directory that compiles, passes linting, and has a server that starts on stdio (with empty handlers). Tests verify stdio cleanliness and utility modules.
- [x] **T02: 08-mcp-server 02**
  - Implement all MCP resources (pattern docs, skills, changelog) and MCP prompts (architecture review, PR review, onboarding) with full test coverage.

Purpose: This plan delivers the read-only content layer of the MCP server -- agents can discover and read all pattern documentation, skill definitions, and retrieve structured prompts for architecture review workflows.

Output: 9 pattern doc resources, dynamic skill resources, changelog resource, 3 prompt templates -- all tested via InMemoryTransport.
- [x] **T03: 08-mcp-server 03**
  - Implement all MCP validation tools (5 individual tools + validate-all meta-tool + setup-check) with the cross-platform script runner utility and rate limiter.

Purpose: This plan delivers the execution layer of the MCP server -- agents can invoke validation commands and receive structured JSON results instead of raw script output. The rate limiter provides defensive design against runaway agent loops (locked decision).

Output: 7 MCP tools wrapping existing validation scripts, a script runner utility, and a rate limiter -- all tested.
- [x] **T04: 08-mcp-server 04**
  - Complete the MCP server with full integration testing, GitHub Actions CI, README documentation, and a manual verification checkpoint to confirm Claude Code registration works on Windows.

Purpose: This is the capstone plan that wires everything together, adds CI quality enforcement, documents the server for adoption, and verifies the complete stack works end-to-end on Windows with no stdio corruption.

Output: Production-ready MCP server with CI, docs, and verified Claude Code registration.

## Files Likely Touched

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
- `mcp-server/src/resources/docs.ts`
- `mcp-server/src/resources/skills.ts`
- `mcp-server/src/resources/changelog.ts`
- `mcp-server/src/resources/index.ts`
- `mcp-server/src/prompts/architecture-review.ts`
- `mcp-server/src/prompts/pr-review.ts`
- `mcp-server/src/prompts/onboarding.ts`
- `mcp-server/src/prompts/index.ts`
- `mcp-server/tests/unit/resources/docs.test.ts`
- `mcp-server/tests/unit/resources/skills.test.ts`
- `mcp-server/tests/unit/resources/changelog.test.ts`
- `mcp-server/tests/unit/prompts/architecture-review.test.ts`
- `mcp-server/tests/unit/prompts/pr-review.test.ts`
- `mcp-server/tests/unit/prompts/onboarding.test.ts`
- `docs/enterprise-integration-proposal.md`
- `mcp-server/src/utils/script-runner.ts`
- `mcp-server/src/utils/rate-limiter.ts`
- `mcp-server/src/tools/check-freshness.ts`
- `mcp-server/src/tools/verify-kmp.ts`
- `mcp-server/src/tools/check-version-sync.ts`
- `mcp-server/src/tools/script-parity.ts`
- `mcp-server/src/tools/setup-check.ts`
- `mcp-server/src/tools/validate-all.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/utils/script-runner.test.ts`
- `mcp-server/tests/unit/utils/rate-limiter.test.ts`
- `mcp-server/tests/unit/tools/validate-all.test.ts`
- `mcp-server/tests/unit/tools/check-freshness.test.ts`
- `mcp-server/tests/unit/tools/setup-check.test.ts`
- `mcp-server/README.md`
- `.github/workflows/mcp-server-ci.yml`
- `mcp-server/tests/integration/stdio-transport.test.ts`
- `mcp-server/src/server.ts`
