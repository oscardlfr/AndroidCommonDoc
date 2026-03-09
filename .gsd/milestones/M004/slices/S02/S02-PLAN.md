# S02: Doc Structure Consolidation

**Goal:** Define the standard documentation template, extend MCP types for new frontmatter fields, fix versions-manifest.
**Demo:** Define the standard documentation template, extend MCP types for new frontmatter fields, fix versions-manifest.

## Must-Haves


## Tasks

- [x] **T01: 14-doc-structure-consolidation 01**
  - Define the standard documentation template, extend MCP types for new frontmatter fields, fix versions-manifest.json, and create verification tooling.

Purpose: Everything else in Phase 14 depends on the template definition and type extensions. This plan establishes the contracts that all subsequent doc work implements against.
Output: doc-template.md (living L0 reference), extended PatternMetadata types, corrected versions-manifest.json, verification script
- [x] **T02: 14-doc-structure-consolidation 02**
  - Split 6 oversized L0 docs into hub+sub-doc format following the established pattern from testing-patterns.md and viewmodel-state-patterns.md.

Purpose: Bring all L0 docs within the 300-line limit for standalone docs and 100-line limit for hubs. Sub-docs become independently loadable units that agents can selectively load based on frontmatter metadata.
Output: 6 hub docs + ~14-18 sub-docs, all with full frontmatter
- [x] **T03: 14-doc-structure-consolidation 03**
  - Add monitor_urls to all 18 L0 docs that lack them, add layer/parent frontmatter fields to all existing docs, and archive the Spanish enterprise proposal duplicate.

Purpose: Bring all existing L0 docs to full template compliance -- consistent frontmatter, upstream monitoring configured, proper layer classification.
Output: All L0 docs fully template-compliant, enterprise proposal archived
- [x] **T04: 14-doc-structure-consolidation 04**
  - Promote 47 DawSync L0 candidates to AndroidCommonDoc: 8 web-quality skills (copy as-is), 6 generic agents (parameterize), 32 generic commands (create template system), and 1 workflow doc (partial extraction).

Purpose: Maximize L0/L1 coverage so L2 projects get value by delegation. These patterns are generic KMP/development patterns that should live at L0.
Output: 47 new files in AndroidCommonDoc (.agents/skills/, .claude/agents/, .claude/commands/)
- [x] **T05: 14-doc-structure-consolidation 05**
  - Create 4 new L0 docs for the highest-priority coverage gaps: Navigation3 patterns, DI patterns (framework-agnostic), an Agent Consumption Guide, and generic KMP storage patterns.

Purpose: Fill the 3 most critical coverage gaps identified in the Phase 13 audit (Navigation3, DI, storage concepts), plus create the essential meta-doc that explains how the L0/L1/L2 documentation system works for AI spec-driven development. The storage patterns L0 doc provides the generic conceptual foundation that Plan 14-07's L1 storage-guide.md maps to specific shared-kmp-libs modules.
Output: 4 new L0 pattern docs, all under 300 lines, with full frontmatter
- [x] **T06: 14-doc-structure-consolidation 06**
  - Write documentation for the 7 security and auth modules in shared-kmp-libs -- the highest priority documentation gaps identified in the Phase 13 audit. These are security-critical modules that are currently completely undocumented.

Purpose: Security modules are the most critical undocumented area in shared-kmp-libs. All 7 modules have 0 documentation. Given their security-critical nature, accurate API documentation (not guesses) is essential.
Output: 7 new L1 docs in shared-kmp-libs/docs/ with full frontmatter, following the standard template
- [x] **T07: 14-doc-structure-consolidation 07**
  - Write documentation for the 10 storage modules (decision guide + 5 individual docs + 1 thin-module group doc) and 9 error mapper modules (1 group template doc) in shared-kmp-libs.

Purpose: Storage modules are the second-highest priority gap (9 of 10 undocumented). The decision guide helps developers choose the right storage module and maps generic storage concepts from the L0 storage-patterns.md (created in Plan 14-05) to specific shared-kmp-libs modules. Error mappers all follow an identical pattern so 1 group template covers all 9.
Output: 8 new L1 docs in shared-kmp-libs/docs/
- [x] **T08: 14-doc-structure-consolidation 08**
  - Complete shared-kmp-libs documentation: update Foundation module READMEs (5), document I/O and Network (11 modules), Domain-Specific (8 modules), Firebase (3 modules), Others (4 modules), and create the comprehensive module catalog.

Purpose: Achieve full 52-module documentation coverage for shared-kmp-libs. This plan covers the remaining ~30 modules not handled by Plans 06 (security) and 07 (storage/error mappers).
Output: 6-7 new L1 docs + 5 updated READMEs + module catalog
- [x] **T09: 14-doc-structure-consolidation 09**
  - Consolidate DawSync documentation per the Phase 13 audit manifest: archive 12 superseded docs, fix version inconsistencies, create thin L0 delegates for 47 promoted files, establish 3 L2>L1 overrides, audit 62 architecture diagrams, and assess 38 overlapping docs.

Purpose: Transform DawSync docs from a disorganized 223-file corpus into a properly layered L2 documentation set that delegates to L0/L1 for generic patterns and retains only project-specific content.
Output: Consolidated DawSync docs/ with archives, delegates, overrides, and fixed versions
- [x] **T10: 14-doc-structure-consolidation 10**
  - Update vault-config.json for new L0 directories, re-sync the Obsidian vault, and run the full quality gate to verify no regressions across the entire documentation ecosystem.

Purpose: Final verification that all Phase 14 changes are coherent -- the vault reflects the consolidated structure, the MCP server handles new frontmatter fields, and quality gates pass.
Output: Updated vault, quality gate report, phase complete

## Files Likely Touched

- `versions-manifest.json`
- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `docs/doc-template.md`
- `.planning/phases/14-doc-structure-consolidation/verify-doc-compliance.cjs`
- `docs/error-handling-patterns.md`
- `docs/error-handling-result.md`
- `docs/error-handling-exceptions.md`
- `docs/error-handling-ui.md`
- `docs/gradle-patterns.md`
- `docs/gradle-patterns-dependencies.md`
- `docs/gradle-patterns-conventions.md`
- `docs/gradle-patterns-publishing.md`
- `docs/kmp-architecture.md`
- `docs/kmp-architecture-sourceset.md`
- `docs/kmp-architecture-modules.md`
- `docs/resource-management-patterns.md`
- `docs/resource-management-lifecycle.md`
- `docs/resource-management-memory.md`
- `docs/testing-patterns-coroutines.md`
- `docs/testing-patterns-schedulers.md`
- `docs/ui-screen-patterns.md`
- `docs/ui-screen-structure.md`
- `docs/ui-screen-navigation.md`
- `docs/ui-screen-components.md`
- `docs/compose-resources-patterns.md`
- `docs/compose-resources-configuration.md`
- `docs/compose-resources-usage.md`
- `docs/compose-resources-troubleshooting.md`
- `docs/offline-first-patterns.md`
- `docs/offline-first-architecture.md`
- `docs/offline-first-sync.md`
- `docs/offline-first-caching.md`
- `docs/viewmodel-state-patterns.md`
- `docs/viewmodel-state-management.md`
- `docs/viewmodel-events.md`
- `docs/viewmodel-navigation.md`
- `docs/testing-patterns.md`
- `docs/testing-patterns-fakes.md`
- `docs/testing-patterns-coverage.md`
- `docs/enterprise-integration-proposal.md`
- `docs/propuesta-integracion-enterprise.md`
- `docs/doc-template.md`
- `.agents/skills/accessibility/SKILL.md`
- `.agents/skills/best-practices/SKILL.md`
- `.agents/skills/core-web-vitals/SKILL.md`
- `.agents/skills/performance/SKILL.md`
- `.agents/skills/seo/SKILL.md`
- `.agents/skills/web-quality-audit/SKILL.md`
- `.claude/agents/beta-readiness-agent.md`
- `.claude/agents/cross-platform-validator.md`
- `.claude/agents/doc-alignment-agent.md`
- `.claude/agents/release-guardian-agent.md`
- `.claude/agents/test-specialist.md`
- `.claude/agents/ui-specialist.md`
- `.claude/commands/test.md`
- `.claude/commands/coverage.md`
- `.claude/commands/build.md`
- `.claude/commands/ [plus 29 additional command files per audit manifest]`
- `docs/claude-code-workflow.md`
- `docs/navigation3-patterns.md`
- `docs/di-patterns.md`
- `docs/agent-consumption-guide.md`
- `docs/storage-patterns.md`
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
- `~/.androidcommondoc/vault-config.json`
