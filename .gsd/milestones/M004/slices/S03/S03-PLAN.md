# S03: Docs Subdirectory Reorganization

**Goal:** Extend the pattern registry foundation to support subdirectory-based doc organization: add `category` field to PatternMetadata, make scanner recursive (handle docs in subdirectories), and extend find-pattern with --category filter.
**Demo:** Extend the pattern registry foundation to support subdirectory-based doc organization: add `category` field to PatternMetadata, make scanner recursive (handle docs in subdirectories), and extend find-pattern with --category filter.

## Must-Haves


## Tasks

- [x] **T01: 14.1-docs-subdirectory-reorganization 01**
  - Extend the pattern registry foundation to support subdirectory-based doc organization: add `category` field to PatternMetadata, make scanner recursive (handle docs in subdirectories), and extend find-pattern with --category filter.

Purpose: All downstream plans (L0/L1/L2 file moves, vault optimization) depend on the registry understanding category metadata and discovering docs inside subdirectories. This must be in place before any files are moved.

Output: Updated types.ts, recursive scanner.ts, extended find-pattern.ts, passing unit tests.
- [x] **T02: 14.1-docs-subdirectory-reorganization 02**
  - Reorganize all 42 AndroidCommonDoc (L0) docs into 13 domain-based subdirectories, add `category` frontmatter to all files, build the validate-doc-structure MCP tool, and generate docs/README.md.

Purpose: L0 is the foundation -- it must be reorganized first so the validate-doc-structure tool can be tested against real data, then reused for L1/L2 validation in later plans.

Output: L0 docs in subdirectories, category frontmatter on all files, working validate-doc-structure tool, generated README.md, atomic commit.
- [x] **T03: 14.1-docs-subdirectory-reorganization 03**
  - Reorganize all 27 shared-kmp-libs (L1) docs into 9 module-category subdirectories, rename 2 legacy uppercase files to lowercase-kebab-case, add frontmatter to 5 legacy files, add `category` field to all 22 existing-frontmatter docs, and generate docs/README.md.

Purpose: L1 module docs organized by category makes module-specific documentation instantly discoverable by AI agents working on shared-kmp-libs modules.

Output: L1 docs in subdirectories, renames complete, frontmatter on all files, README.md generated, atomic commit in shared-kmp-libs repo.
- [x] **T04: 14.1-docs-subdirectory-reorganization 04**
  - Fully restructure DawSync (L2) docs/ using the L0 core + L2 extensions pattern: move 10 flat .md files + 1 .pdf + 1 .drawio to target subdirectories, move CODEX_AUDITY/ to archive/, add `category` frontmatter to all DawSync docs (flat + existing subdirs), and generate docs/README.md.

Purpose: DawSync has a mixed structure (some subdirectories already exist, some files flat at root). This plan completes the restructuring so all docs are organized by domain.

Output: DawSync docs fully restructured, category frontmatter on all files, README.md generated, atomic commit in DawSync repo.
- [x] **T05: 14.1-docs-subdirectory-reorganization 05**
  - Optimize the Obsidian vault pipeline to mirror the new subdirectory structure: update collector routing for category-based paths, refactor MOC generator for category-grouped output, redesign Home.md, exclude archive/ from collection, create the /doc-reorganize skill, and update the doc template.

Purpose: The vault must reflect the reorganized source structure with category-grouped MOCs to reduce visual noise (user complaint about flat link walls). The /doc-reorganize skill makes this reorganization pattern reusable for future projects.

Output: Updated vault pipeline code, category-grouped MOCs, /doc-reorganize skill, updated doc-template.md.
- [x] **T06: 14.1-docs-subdirectory-reorganization 06**
  - Run end-to-end verification across all 3 projects: validate-doc-structure, vault re-sync with --init (clean slate for new paths), full test suite, and Obsidian human verification.

Purpose: Confirm the entire reorganization works correctly: docs discoverable, tools functional, vault reflects new structure, no regressions. This is the quality gate before phase completion.

Output: Passing integration tests, re-synced vault, verified Obsidian navigation, human approval.

## Files Likely Touched

- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/src/tools/find-pattern.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `mcp-server/tests/unit/tools/find-pattern.test.ts`
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
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `mcp-server/src/vault/collector.ts`
- `mcp-server/src/vault/moc-generator.ts`
- `mcp-server/src/vault/transformer.ts`
- `mcp-server/tests/unit/vault/collector.test.ts`
- `mcp-server/tests/unit/vault/moc-generator.test.ts`
- `mcp-server/tests/unit/vault/transformer.test.ts`
- `skills/doc-reorganize/SKILL.md`
- `docs/guides/doc-template.md`
- `mcp-server/tests/integration/doc-structure.test.ts`
