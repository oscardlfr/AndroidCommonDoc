# T02: 08-mcp-server 02

**Slice:** S04 — **Milestone:** M002

## Description

Implement all MCP resources (pattern docs, skills, changelog) and MCP prompts (architecture review, PR review, onboarding) with full test coverage.

Purpose: This plan delivers the read-only content layer of the MCP server -- agents can discover and read all pattern documentation, skill definitions, and retrieve structured prompts for architecture review workflows.

Output: 9 pattern doc resources, dynamic skill resources, changelog resource, 3 prompt templates -- all tested via InMemoryTransport.

## Must-Haves

- [ ] "MCP client can list all 9 pattern doc resources and read their full Markdown content"
- [ ] "MCP client can list skill resources and read any SKILL.md content"
- [ ] "MCP client can read a changelog resource showing recent toolkit changes"
- [ ] "MCP client can retrieve architecture-review prompt with code argument"
- [ ] "MCP client can retrieve pr-review prompt with diff argument"
- [ ] "MCP client can retrieve onboarding prompt for new developer guidance"
- [ ] "All pattern docs are in English (Spanish doc translated)"

## Files

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
