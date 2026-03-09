---
phase: 12-ecosystem-vault-expansion
plan: 00
subsystem: testing
tags: [vitest, todo-stubs, vault, layer-first, behavioral-contracts]

# Dependency graph
requires:
  - phase: 11-notebooklm-integration
    provides: "Existing vault test files and production vault modules"
provides:
  - "92 .todo() behavioral contracts across 10 test files"
  - "Test scaffolding for Plans 02-06 implementation"
  - "2 new test files: glob-expander.test.ts, sub-project-detector.test.ts"
affects: [12-02, 12-03, 12-04, 12-05, 12-06, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "it.todo() stubs for behavioral contracts before implementation (Nyquist Wave 0)"

key-files:
  created:
    - mcp-server/tests/unit/vault/glob-expander.test.ts
    - mcp-server/tests/unit/vault/sub-project-detector.test.ts
  modified:
    - mcp-server/tests/unit/vault/config.test.ts
    - mcp-server/tests/unit/vault/collector.test.ts
    - mcp-server/tests/unit/vault/transformer.test.ts
    - mcp-server/tests/unit/vault/tag-generator.test.ts
    - mcp-server/tests/unit/vault/wikilink-generator.test.ts
    - mcp-server/tests/unit/vault/moc-generator.test.ts
    - mcp-server/tests/unit/vault/vault-writer.test.ts
    - mcp-server/tests/integration/vault-sync.test.ts

key-decisions:
  - "No source imports in stubs -- source files will be rewritten in Plans 02-06, imports would fail"
  - "92 todos across 10 files covering all ECOV requirements"

patterns-established:
  - "Nyquist Wave 0: all test stubs exist before any production code changes"

requirements-completed: [ECOV-01, ECOV-02, ECOV-03, ECOV-04, ECOV-05, ECOV-06, ECOV-07]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 12 Plan 00: Test Stub Scaffolding Summary

**92 Vitest .todo() behavioral contracts across 10 test files defining layer-first vault expansion contracts for Plans 02-07**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-14T14:09:36Z
- **Completed:** 2026-03-14T14:11:41Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Created 2 new test files (glob-expander, sub-project-detector) for Phase 12 features
- Rewrote 7 existing Phase 11 test files as .todo() stubs for Phase 12 layer-first contracts
- Rewrote 1 integration test file for the layer-first e2e pipeline
- All 92 .todo() tests parse and run without errors in Vitest (0 failures, 92 todos)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create stub test files for vault unit tests (7 rewrites + 2 new)** - `49b6999` (test)
2. **Task 2: Create stub integration test for layer-first e2e pipeline** - `cbe6b89` (test)

## Files Created/Modified
- `mcp-server/tests/unit/vault/glob-expander.test.ts` - NEW: 8 todos for glob expansion (literal, wildcard, double-star, excludes, deduplication)
- `mcp-server/tests/unit/vault/sub-project-detector.test.ts` - NEW: 7 todos for cross-tech sub-project detection, Gradle exclusion
- `mcp-server/tests/unit/vault/config.test.ts` - REWRITE: 12 todos for ProjectConfig schema, defaults, migration
- `mcp-server/tests/unit/vault/collector.test.ts` - REWRITE: 15 todos for L0/L1/L2 collection, globs, sub-projects
- `mcp-server/tests/unit/vault/transformer.test.ts` - REWRITE: 8 todos for layer-first paths, slug disambiguation
- `mcp-server/tests/unit/vault/tag-generator.test.ts` - REWRITE: 5 todos for architecture/ecosystem/app tags
- `mcp-server/tests/unit/vault/wikilink-generator.test.ts` - REWRITE: 5 todos for display-text format with project-prefixed slugs
- `mcp-server/tests/unit/vault/moc-generator.test.ts` - REWRITE: 13 todos for Home.md, ecosystem groupings, 7 MOC pages
- `mcp-server/tests/unit/vault/vault-writer.test.ts` - REWRITE: 6 todos for clean-slate migration, layer-first directories
- `mcp-server/tests/integration/vault-sync.test.ts` - REWRITE: 14 todos for full layer-first pipeline e2e

## Decisions Made
- No source imports in stub files -- source modules will be rewritten in Plans 02-06, importing them now would cause failures
- 92 behavioral contracts (exceeding the 50+ minimum from the plan) ensure comprehensive coverage of all ECOV requirements

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 10 test stub files ready for Plans 02-06 to implement against
- Plan 07 (test rewrite) can use these stubs as the starting point for full test implementations
- Behavioral contracts define clear acceptance criteria for each module's new behavior

## Self-Check: PASSED

All 11 claimed files verified present. Both task commits verified in git log.

---
*Phase: 12-ecosystem-vault-expansion*
*Completed: 2026-03-14*
