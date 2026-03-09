# T03: 08-mcp-server 03

**Slice:** S04 — **Milestone:** M002

## Description

Implement all MCP validation tools (5 individual tools + validate-all meta-tool + setup-check) with the cross-platform script runner utility and rate limiter.

Purpose: This plan delivers the execution layer of the MCP server -- agents can invoke validation commands and receive structured JSON results instead of raw script output. The rate limiter provides defensive design against runaway agent loops (locked decision).

Output: 7 MCP tools wrapping existing validation scripts, a script runner utility, and a rate limiter -- all tested.

## Must-Haves

- [ ] "MCP client can list at least 6 validation tools"
- [ ] "MCP client can invoke check-doc-freshness and receive structured JSON (not raw script output)"
- [ ] "MCP client can invoke validate-all and receive combined results from all validation gates"
- [ ] "MCP client can invoke setup-check and receive project configuration status"
- [ ] "Script runner uses execFile (not exec) for security"
- [ ] "Script runner sets NO_COLOR=1 and timeout on all invocations"
- [ ] "Rate limiter prevents more than N tool invocations per minute"
- [ ] "Tool errors return structured error JSON (not crashes)"

## Files

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
