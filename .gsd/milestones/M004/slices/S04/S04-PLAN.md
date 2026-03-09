# S04: Docs Content Quality

**Goal:** Extend MCP tooling with l0_refs cross-layer reference support and quality validation checks.
**Demo:** Extend MCP tooling with l0_refs cross-layer reference support and quality validation checks.

## Must-Haves


## Tasks

- [x] **T01: 14.2-docs-content-quality 01**
  - Extend MCP tooling with l0_refs cross-layer reference support and quality validation checks.

Purpose: Provide automated validation tools that subsequent plans use to verify their doc quality work. MCP tooling must be ready before any doc content changes begin.
Output: Extended PatternMetadata type, scanner l0_refs extraction, validate-doc-structure with size limits + l0_refs validation + frontmatter completeness scoring.
- [x] **T02: 14.2-docs-content-quality 02**
  - Split 8 oversized L0 standalone and sub-docs into hub+sub-doc format following the established pattern from Phase 14 Plan 02.

Purpose: Establish stable, size-compliant L0 reference targets that L1/L2 docs will reference via l0_refs. L0 must be split FIRST so l0_refs in L1/L2 point to stable slugs.
Output: 8 formerly-oversized L0 docs converted to hub+sub-doc format. All hubs under 100 lines, all sub-docs under 300 lines.
- [x] **T03: 14.2-docs-content-quality 03**
  - Complete L1 shared-kmp-libs doc quality: split 2 oversized docs, add missing frontmatter fields to 8 docs, and add l0_refs cross-layer references.

Purpose: L1 docs must reference L0 patterns via l0_refs instead of duplicating content. Missing frontmatter fields prevent MCP discovery and vault indexing.
Output: All L1 docs size-compliant, fully frontmatted, with l0_refs pointing to relevant L0 patterns.
- [x] **T04: 14.2-docs-content-quality 04**
  - Add full 10-field YAML frontmatter to all 33 active non-diagram DawSync docs that currently have category-only or no frontmatter.

Purpose: Without full frontmatter, DawSync docs are invisible to MCP discovery (find-pattern), vault indexing, and quality validation. This is the prerequisite for L2 splitting and l0_refs deduplication in subsequent plans.
Output: All 33 non-diagram DawSync active docs have complete frontmatter.
- [x] **T05: 14.2-docs-content-quality 05**
  - Add full 10-field YAML frontmatter to all 62 DawSync architecture diagram docs.

Purpose: Diagram docs currently have NO frontmatter at all, making them invisible to MCP tools and vault indexing. This is mechanical/templated work -- all diagrams share the same scope, sources, targets, and layer values.
Output: All 62 diagram docs have complete frontmatter following a consistent template.
- [x] **T06: 14.2-docs-content-quality 06**
  - Split the 5 largest DawSync docs (1667, 1619, 868, 648, 656 lines) into hub+sub-doc format following established pattern.

Purpose: These 5 docs are the most severely oversized, ranging from 648 to 1667 lines. They must be split before the remaining 13 oversized docs (Plan 08) to handle the hardest cases first.
Output: 5 massive docs converted to hub+sub-doc format, all within size limits.
- [x] **T07: 14.2-docs-content-quality 07**
  - Split remaining 13 oversized DawSync docs and add l0_refs cross-layer references + content deduplication across all L2 docs.

Purpose: Complete L2 size compliance and eliminate content duplication between L2 and L0 docs. After this plan, all DawSync docs are within size limits and properly cross-reference L0 generic patterns.
Output: All oversized L2 docs split, l0_refs added, duplicated content replaced with reference blocks.
- [x] **T08: 14.2-docs-content-quality 08**
  - Add frontmatter and delegation references to DawSync subproject docs (DawSyncWeb + SessionRecorder-VST3).

Purpose: Subproject docs currently have no frontmatter and no connection to parent project documentation. DawSyncWeb shares marketing/product/legal with DawSync parent. SessionRecorder-VST3 is a C++/JUCE project with domain-specific docs.
Output: All subproject docs frontmatted, delegating shared concerns to parent project.
- [x] **T09: 14.2-docs-content-quality 09**
  - Quality gate: validate doc quality across all 3 projects, re-sync vault, and human-verify Obsidian navigation.

Purpose: Ensure all Phase 14.2 work is correct, consistent, and properly reflected in the Obsidian vault. This is the final verification step before the phase is complete.
Output: All validation passing, vault re-synced, human-approved Obsidian navigation.

## Files Likely Touched

- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/src/tools/validate-doc-structure.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `mcp-server/tests/unit/tools/validate-doc-structure.test.ts`
- `mcp-server/tests/integration/doc-structure.test.ts`
- `docs/offline-first/offline-first-architecture.md`
- `docs/offline-first/offline-first-architecture-layers.md`
- `docs/offline-first/offline-first-architecture-conflict.md`
- `docs/offline-first/offline-first-sync.md`
- `docs/offline-first/offline-first-sync-queue.md`
- `docs/ui/viewmodel-state-management.md`
- `docs/ui/viewmodel-state-management-sealed.md`
- `docs/ui/viewmodel-state-management-stateflow.md`
- `docs/ui/viewmodel-events.md`
- `docs/ui/viewmodel-events-consumption.md`
- `docs/di/di-patterns.md`
- `docs/di/di-patterns-modules.md`
- `docs/di/di-patterns-testing.md`
- `docs/compose/compose-resources-configuration.md`
- `docs/compose/compose-resources-configuration-setup.md`
- `docs/storage/storage-patterns.md`
- `docs/storage/storage-patterns-implementation.md`
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
- `mcp-server/tests/integration/doc-structure.test.ts`
- `mcp-server/src/vault/sync-engine.ts`
- `mcp-server/src/vault/moc-generator.ts`
