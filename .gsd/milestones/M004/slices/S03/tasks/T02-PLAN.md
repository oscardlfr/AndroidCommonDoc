# T02: 14.1-docs-subdirectory-reorganization 02

**Slice:** S03 — **Milestone:** M004

## Description

Reorganize all 42 AndroidCommonDoc (L0) docs into 13 domain-based subdirectories, add `category` frontmatter to all files, build the validate-doc-structure MCP tool, and generate docs/README.md.

Purpose: L0 is the foundation -- it must be reorganized first so the validate-doc-structure tool can be tested against real data, then reused for L1/L2 validation in later plans.

Output: L0 docs in subdirectories, category frontmatter on all files, working validate-doc-structure tool, generated README.md, atomic commit.

## Must-Haves

- [ ] "All 42 L0 docs have category frontmatter field"
- [ ] "All L0 docs live in correct domain-based subdirectories matching their category"
- [ ] "Hub+sub-doc groups are never split across subdirectories"
- [ ] "validate-doc-structure MCP tool validates category-subdir alignment"
- [ ] "validate-doc-structure --generate-index produces docs/README.md"
- [ ] "All internal cross-references between L0 docs resolve correctly"

## Files

- `docs/architecture/kmp-architecture.md`
- `docs/architecture/kmp-architecture-modules.md`
- `docs/architecture/kmp-architecture-sourceset.md`
- `docs/testing/testing-patterns.md`
- `docs/testing/testing-patterns-coroutines.md`
- `docs/testing/testing-patterns-coverage.md`
- `docs/testing/testing-patterns-fakes.md`
- `docs/testing/testing-patterns-schedulers.md`
- `docs/error-handling/error-handling-patterns.md`
- `docs/error-handling/error-handling-exceptions.md`
- `docs/error-handling/error-handling-result.md`
- `docs/error-handling/error-handling-ui.md`
- `docs/ui/ui-screen-patterns.md`
- `docs/ui/ui-screen-components.md`
- `docs/ui/ui-screen-navigation.md`
- `docs/ui/ui-screen-structure.md`
- `docs/ui/viewmodel-state-patterns.md`
- `docs/ui/viewmodel-events.md`
- `docs/ui/viewmodel-navigation.md`
- `docs/ui/viewmodel-state-management.md`
- `docs/gradle/gradle-patterns.md`
- `docs/gradle/gradle-patterns-conventions.md`
- `docs/gradle/gradle-patterns-dependencies.md`
- `docs/gradle/gradle-patterns-publishing.md`
- `docs/offline-first/offline-first-patterns.md`
- `docs/offline-first/offline-first-architecture.md`
- `docs/offline-first/offline-first-caching.md`
- `docs/offline-first/offline-first-sync.md`
- `docs/compose/compose-resources-patterns.md`
- `docs/compose/compose-resources-configuration.md`
- `docs/compose/compose-resources-troubleshooting.md`
- `docs/compose/compose-resources-usage.md`
- `docs/resources/resource-management-patterns.md`
- `docs/resources/resource-management-lifecycle.md`
- `docs/resources/resource-management-memory.md`
- `docs/di/di-patterns.md`
- `docs/navigation/navigation3-patterns.md`
- `docs/storage/storage-patterns.md`
- `docs/guides/doc-template.md`
- `docs/guides/agent-consumption-guide.md`
- `docs/guides/claude-code-workflow.md`
- `docs/archive/enterprise-integration-proposal.md`
- `mcp-server/src/tools/validate-doc-structure.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/tools/validate-doc-structure.test.ts`
