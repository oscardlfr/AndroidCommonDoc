---
phase: 12-ecosystem-vault-expansion
plan: 03
subsystem: vault
tags: [typescript, glob, sub-project, collector, version-catalog, L0, L1, L2, obsidian]

# Dependency graph
requires:
  - phase: 12-00
    provides: "Test stubs for vault unit tests"
  - phase: 12-02
    provides: "ProjectConfig, SubProjectConfig types, VaultConfig v1 schema, getDefaultGlobs, getDefaultExcludes"
provides:
  - "expandGlobs utility for glob-based file discovery"
  - "detectSubProjects utility for cross-tech sub-project auto-detection"
  - "parseVersionCatalog for libs.versions.toml markdown generation"
  - "Layer-aware collector with collectL0Sources, collectProjectSources, collectSubProjectSources, collectAll"
  - "classifyFile helper for sourceType/subdivision routing"
affects: [12-04, 12-05, 12-06, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Glob-to-regex conversion: ** -> any-depth, * -> single-segment, with special char escaping"
    - "Cross-tech sub-project detection: different build system signals vs parent"
    - "File classification by path: CLAUDE.md/AGENTS.md -> ai, .planning/codebase/ -> architecture, docs/ -> docs"
    - "Layer-first vault routing: L0-generic/, L1-ecosystem/, L2-apps/ directory prefixes"
    - "Simple TOML section parser for Gradle version catalog subset (no library dependency)"

key-files:
  created:
    - "mcp-server/src/vault/glob-expander.ts"
    - "mcp-server/src/vault/sub-project-detector.ts"
    - "mcp-server/src/vault/version-catalog-parser.ts"
  modified:
    - "mcp-server/src/vault/collector.ts"

key-decisions:
  - "Glob expander uses recursive directory walking with pattern-to-regex (no external minimatch/glob dependency)"
  - "SKIP_DIRS set for performance (build, node_modules, .gradle, dist, .git, .idea, .vscode, out)"
  - "Sub-project detector explicitly avoids treating Gradle sub-modules as sub-projects (Pitfall 7 anti-pattern)"
  - "File classification is a pure function classifyFile(relativePath) returning sourceType + subdivision"
  - "Version catalog parser handles focused TOML subset: versions, libraries with inline tables, plugins, multi-line bundle arrays"
  - "parseVersionCatalog returns null for missing files or empty catalogs (graceful opt-in)"
  - "Collector uses layer-first paths: L0-generic/patterns/, L1-ecosystem/{name}/docs/, L2-apps/{name}/ai/"

patterns-established:
  - "Glob pattern expansion: walk once, match many -- single directory scan with multiple pattern matching"
  - "Cross-tech detection: parent build system detection then different-tech signal matching in children"
  - "Layer routing function: getLayerDir(layer) maps Layer enum to directory prefix string"
  - "Configurable collection pipeline: expandGlobs + classifyFile + layer routing per ProjectConfig"

requirements-completed: [ECOV-01, ECOV-02, ECOV-03, ECOV-04, ECOV-07]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 12 Plan 03: Collector & Utilities Summary

**Glob expander, sub-project detector, version catalog parser, and layer-aware collector rewrite with configurable L0/L1/L2 routing and sub-project support**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T14:17:44Z
- **Completed:** 2026-03-14T14:23:21Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Created glob expander with recursive directory walking and pattern-to-regex matching supporting **, *, and literal patterns with deduplication and exclude filtering
- Created sub-project detector that identifies cross-tech sub-projects (CMakeLists.txt, package.json in Gradle parent, .git submodules) while explicitly avoiding the Gradle sub-module anti-pattern
- Created version catalog parser that generates readable markdown reference pages from libs.versions.toml (versions, libraries, plugins, bundles) with inline table and version.ref resolution
- Rewrote collector with four exported functions: collectL0Sources (patterns, skills, project knowledge), collectProjectSources (configurable globs), collectSubProjectSources (nested under parent), collectAll (orchestrator with auto-discovery and sub-project scanning)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create glob expander and sub-project detector utilities** - `ba18002` (feat)
2. **Task 2: Rewrite collector for configurable glob-based L0/L1/L2 collection** - `3d6e25e` (feat)
3. **Task 3: Create version catalog parser for libs.versions.toml** - `a02c7ab` (feat)

## Files Created/Modified
- `mcp-server/src/vault/glob-expander.ts` - Glob pattern expansion with recursive walking, pattern-to-regex, deduplication, exclude filtering
- `mcp-server/src/vault/sub-project-detector.ts` - Cross-tech sub-project detection with build system signal matching
- `mcp-server/src/vault/version-catalog-parser.ts` - Simple TOML parser for Gradle version catalogs generating markdown reference pages
- `mcp-server/src/vault/collector.ts` - Complete rewrite: layer-aware collection with configurable globs, L0/L1/L2 routing, sub-project support, version catalog integration

## Decisions Made
- Glob expander uses recursive directory walking with pattern-to-regex conversion (no external minimatch/glob dependency) -- keeps zero-dependency approach consistent with project philosophy
- SKIP_DIRS shared between glob expander and sub-project detector for consistent performance optimization
- Sub-project detector explicitly avoids treating Gradle sub-modules (build.gradle.kts in Gradle parent) as sub-projects -- this is the key anti-pattern identified in research Pitfall 7
- File classification is a pure function: classifyFile(relativePath) returns {sourceType, subdivision} enabling easy testing and predictable routing
- Version catalog parser handles the TOML subset used by Gradle catalogs (not full TOML spec) -- focused and maintainable
- parseVersionCatalog returns null for missing files or empty catalogs, making the features.versionCatalog flag a graceful opt-in
- Collector routes L0 to L0-generic/, L1 to L1-ecosystem/, L2 to L2-apps/ with ai/docs/planning subdivisions per project

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Collector provides all source collection for Plans 04-06 (transformer, MOC generator, sync engine rewrites)
- Remaining compilation errors in moc-generator.ts, sync-engine.ts are expected and will be fixed in Plans 04-05
- 30 test stubs across collector, glob-expander, and sub-project-detector ready for Plan 06 test implementation

## Self-Check: PASSED

- All 4 source files exist on disk
- All 3 task commits (ba18002, 3d6e25e, a02c7ab) found in git history
- All 4 files compile without errors
- 30/30 test stubs report as todo

---
*Phase: 12-ecosystem-vault-expansion*
*Completed: 2026-03-14*
