# S05: Pattern Registry Discovery

**Goal:** Create the pattern registry core: type definitions, YAML frontmatter parser, directory scanner, and add YAML frontmatter to all 9 existing pattern docs.
**Demo:** Create the pattern registry core: type definitions, YAML frontmatter parser, directory scanner, and add YAML frontmatter to all 9 existing pattern docs.

## Must-Haves


## Tasks

- [x] **T01: 09-pattern-registry-discovery 01**
  - Create the pattern registry core: type definitions, YAML frontmatter parser, directory scanner, and add YAML frontmatter to all 9 existing pattern docs.

Purpose: This is the foundation for the entire registry system. Every subsequent plan depends on these types and the scanner's ability to discover docs with valid frontmatter. Adding frontmatter to existing docs makes them machine-parseable and queryable.

Output: Registry core modules (types, frontmatter parser, scanner) with tests, plus all 9 pattern docs enhanced with YAML frontmatter.
- [x] **T02: 09-pattern-registry-discovery 02**
  - Audit all 9 pattern docs for freshness against current official sources, fix stale references, and split the 4 largest docs (>400 lines) into focused, independently-loadable sub-docs for token-efficient agent consumption.

Purpose: Agents should load only the specific pattern slice they need (e.g., "coroutine testing" not "all testing"), and the registry launches with verified, current content. This directly serves the project's core value of token-efficiency.

Output: Audited pattern docs with current version references, plus 12 focused sub-docs split from the 4 largest originals.
- [x] **T03: 09-pattern-registry-discovery 03**
  - Implement the three-layer resolver (L0 > L1 > L2 with full replacement semantics) and project auto-discovery from settings.gradle.kts includeBuild paths.

Purpose: This enables per-project pattern customization without forking -- a consuming project can override any L0 pattern doc by placing a same-named file in their .androidcommondoc/docs/ directory, and the resolver picks the highest-priority version automatically.

Output: resolver.ts for layer resolution, project-discovery.ts for consumer detection, extended paths.ts with L1/L2 directory helpers.
- [x] **T04: 09-pattern-registry-discovery 04**
  - Evolve docs.ts from hardcoded KNOWN_DOCS to dynamic registry scanning, and implement the find-pattern MCP tool for metadata-based pattern discovery across the registry.

Purpose: Agents can now discover patterns by querying metadata (scope, sources, targets) instead of knowing exact doc names, and new docs are automatically available without code changes. This is the key MCP integration that makes the registry useful to AI agents.

Output: Registry-aware docs.ts (dynamic discovery, backward-compatible URIs), find-pattern tool with Zod schema and rate limiting.
- [x] **T05: 09-pattern-registry-discovery 05**
  - Wire all registry components together with integration tests and verify the complete flow: dynamic doc discovery, find-pattern search, layer resolution, and backward compatibility with existing MCP resources.

Purpose: This is the integration verification that proves the entire registry system works end-to-end. Plans 01-04 built the individual pieces; this plan wires them and validates the complete flow works as a cohesive system.

Output: Integration test suite for the registry, any wiring fixes needed, verified end-to-end registry operation.
- [x] **T06: 09-pattern-registry-discovery 06**
  - Audit DawSync/.claude/ agent docs for generic KMP/Android patterns, promote reusable patterns to AndroidCommonDoc L0 docs with YAML frontmatter, and set up DawSync/.androidcommondoc/docs/ for project-specific L1 overrides.

Purpose: This fulfills the locked "DawSync doc migration" decision from CONTEXT.md. DawSync's .claude/ agents contain patterns that benefit all KMP projects (e.g., error handling, data layer, testing). Generic patterns become L0 base docs; DawSync-specific patterns stay as L1 overrides. This ensures the registry launches with comprehensive, complete content.

Output: New L0 pattern docs in docs/ (with frontmatter), DawSync/.androidcommondoc/docs/ directory with L1 override docs.

## Files Likely Touched

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
- `docs/testing-patterns.md`
- `docs/compose-resources-patterns.md`
- `docs/offline-first-patterns.md`
- `docs/viewmodel-state-patterns.md`
- `docs/testing-patterns-coroutines.md`
- `docs/testing-patterns-fakes.md`
- `docs/testing-patterns-coverage.md`
- `docs/compose-resources-configuration.md`
- `docs/compose-resources-usage.md`
- `docs/compose-resources-troubleshooting.md`
- `docs/offline-first-architecture.md`
- `docs/offline-first-sync.md`
- `docs/offline-first-caching.md`
- `docs/viewmodel-state-management.md`
- `docs/viewmodel-navigation.md`
- `docs/viewmodel-events.md`
- `mcp-server/src/registry/resolver.ts`
- `mcp-server/src/registry/project-discovery.ts`
- `mcp-server/src/utils/paths.ts`
- `mcp-server/tests/unit/registry/resolver.test.ts`
- `mcp-server/tests/unit/registry/project-discovery.test.ts`
- `mcp-server/tests/unit/utils/paths.test.ts`
- `mcp-server/src/resources/docs.ts`
- `mcp-server/src/tools/find-pattern.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/resources/docs.test.ts`
- `mcp-server/tests/unit/tools/find-pattern.test.ts`
- `mcp-server/src/resources/index.ts`
- `mcp-server/src/server.ts`
- `mcp-server/src/index.ts`
- `mcp-server/tests/integration/registry-integration.test.ts`
- `mcp-server/src/resources/docs.ts`
- `docs/error-handling-patterns.md`
