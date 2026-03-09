# S06: Doc Intelligence Detekt Generation

**Goal:** Extend the pattern registry schema with monitoring and rule definition types, then build the core monitoring engine that fetches upstream sources and detects changes.
**Demo:** Extend the pattern registry schema with monitoring and rule definition types, then build the core monitoring engine that fetches upstream sources and detects changes.

## Must-Haves


## Tasks

- [x] **T01: 10-doc-intelligence-detekt-generation 01**
  - Extend the pattern registry schema with monitoring and rule definition types, then build the core monitoring engine that fetches upstream sources and detects changes.

Purpose: Establishes the data model and engine that all downstream plans depend on -- types for monitor_urls and rules in frontmatter, plus the HTTP fetching and diff detection logic.
Output: Extended registry types, updated scanner, monitoring engine (source-checker + change-detector), frontmatter additions on key docs.
- [x] **T02: 10-doc-intelligence-detekt-generation 02**
  - Build the Detekt rule generation engine: parse rule definitions from pattern doc frontmatter and emit Kotlin source code for AST-only Detekt rules with companion tests.

Purpose: Creates the code generation pipeline that transforms YAML rule definitions in pattern docs into compilable Kotlin Detekt rules and tests, matching the exact patterns of the 5 existing hand-written rules.
Output: rule-parser, kotlin-emitter, test-emitter, config-emitter modules with full test coverage.
- [x] **T03: 10-doc-intelligence-detekt-generation 03**
  - Build the review state tracking system and monitor-sources MCP tool that provides tiered source monitoring with review-aware filtering.

Purpose: Users can run source monitoring on demand or via CI, see only new findings (not previously reviewed ones), and approve/reject/defer findings. The MCP tool is the primary programmatic interface for AI agents.
Output: Review state persistence, report generator, monitor-sources MCP tool registered in tool index.
- [x] **T04: 10-doc-intelligence-detekt-generation 04**
  - Create the generated rules directory structure in the detekt-rules module and build the writer module that orchestrates the full rule generation pipeline (parse frontmatter -> emit Kotlin -> write files -> update provider registration).

Purpose: Bridges the TypeScript generation engine (Plan 02) with the Kotlin detekt-rules module, producing actual .kt files that compile alongside the 5 existing hand-written rules.
Output: generated/ directories in detekt-rules, writer module that orchestrates end-to-end generation.
- [x] **T05: 10-doc-intelligence-detekt-generation 05**
  - Build the generate-detekt-rules and ingest-content MCP tools, completing the Phase 10 tool surface.

Purpose: AI agents can trigger Detekt rule generation from pattern docs and ingest arbitrary content (Medium posts, LinkedIn articles, etc.) for pattern extraction. The generate tool bridges frontmatter rule definitions to compiled Kotlin rules. The ingest tool enables users to feed the system knowledge from any source.
Output: Two MCP tools registered in the tool index, with tests.
- [x] **T06: 10-doc-intelligence-detekt-generation 06**
  - Create three new skills for AI agent access, a CLI entrypoint for CI use, and a GitHub Actions cron workflow for scheduled monitoring.

Purpose: Completes the multi-tool surface (MCP tools + skills + CI) so monitoring and rule generation are accessible from Claude Code, Copilot, and automated CI pipelines. Skills follow existing SKILL.md format.
Output: 3 skills, CI workflow, CLI entrypoint.
- [x] **T07: 10-doc-intelligence-detekt-generation 07**
  - v1.1 milestone audit and cleanup: consolidate overlapping tools, remove dead code, update all documentation to reflect current state, verify convention compliance, and generate CHANGELOG.md.

Purpose: Phase 10 is the last functional phase of v1.1. This plan ensures the repository is professional, consistent, and fully documented before milestone closure. No stale references, no dead code, no drift between docs and reality.
Output: Clean repository, accurate docs, CHANGELOG.md, end-to-end verification.

## Files Likely Touched

- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/src/monitoring/source-checker.ts`
- `mcp-server/src/monitoring/change-detector.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `mcp-server/tests/unit/monitoring/source-checker.test.ts`
- `mcp-server/tests/unit/monitoring/change-detector.test.ts`
- `docs/viewmodel-state-patterns.md`
- `docs/testing-patterns.md`
- `docs/kmp-architecture.md`
- `docs/gradle-patterns.md`
- `docs/error-handling-patterns.md`
- `mcp-server/src/generation/rule-parser.ts`
- `mcp-server/src/generation/kotlin-emitter.ts`
- `mcp-server/src/generation/test-emitter.ts`
- `mcp-server/src/generation/config-emitter.ts`
- `mcp-server/tests/unit/generation/rule-parser.test.ts`
- `mcp-server/tests/unit/generation/kotlin-emitter.test.ts`
- `mcp-server/tests/unit/generation/test-emitter.test.ts`
- `mcp-server/src/monitoring/review-state.ts`
- `mcp-server/src/monitoring/report-generator.ts`
- `mcp-server/src/tools/monitor-sources.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/monitoring/review-state.test.ts`
- `mcp-server/tests/unit/monitoring/report-generator.test.ts`
- `mcp-server/tests/unit/tools/monitor-sources.test.ts`
- `detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/generated/.gitkeep`
- `detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/generated/.gitkeep`
- `mcp-server/src/generation/writer.ts`
- `mcp-server/tests/unit/generation/writer.test.ts`
- `mcp-server/src/tools/generate-detekt-rules.ts`
- `mcp-server/src/tools/ingest-content.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/tools/generate-detekt-rules.test.ts`
- `mcp-server/tests/unit/tools/ingest-content.test.ts`
- `skills/monitor-docs/SKILL.md`
- `skills/generate-rules/SKILL.md`
- `skills/ingest-content/SKILL.md`
- `.github/workflows/doc-monitor.yml`
- `mcp-server/src/cli/monitor-sources.ts`
- `mcp-server/package.json`
- `mcp-server/src/tools/check-freshness.ts`
- `mcp-server/src/tools/index.ts`
- `README.md`
- `AGENTS.md`
- `CHANGELOG.md`
- `mcp-server/tests/integration/server.test.ts`
