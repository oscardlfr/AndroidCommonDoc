# T01: 09-pattern-registry-discovery 01

**Slice:** S05 — **Milestone:** M002

## Description

Create the pattern registry core: type definitions, YAML frontmatter parser, directory scanner, and add YAML frontmatter to all 9 existing pattern docs.

Purpose: This is the foundation for the entire registry system. Every subsequent plan depends on these types and the scanner's ability to discover docs with valid frontmatter. Adding frontmatter to existing docs makes them machine-parseable and queryable.

Output: Registry core modules (types, frontmatter parser, scanner) with tests, plus all 9 pattern docs enhanced with YAML frontmatter.

## Must-Haves

- [ ] "Every pattern doc in docs/ has valid YAML frontmatter with scope, sources, and targets fields"
- [ ] "The registry scanner discovers all .md files with valid frontmatter (at least 9) by scanning the docs/ directory and parsing frontmatter"
- [ ] "Files without valid frontmatter (propuesta-integracion-enterprise.md) are silently skipped"

## Files

- `mcp-server/package.json`
- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/frontmatter.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/tests/unit/registry/frontmatter.test.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `docs/testing-patterns.md`
- `docs/kmp-architecture.md`
- `docs/compose-resources-patterns.md`
- `docs/gradle-patterns.md`
- `docs/offline-first-patterns.md`
- `docs/resource-management-patterns.md`
- `docs/ui-screen-patterns.md`
- `docs/viewmodel-state-patterns.md`
- `docs/enterprise-integration-proposal.md`
