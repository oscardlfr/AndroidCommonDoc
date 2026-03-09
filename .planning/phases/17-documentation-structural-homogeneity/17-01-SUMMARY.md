---
phase: 17-documentation-structural-homogeneity
plan: 01
subsystem: vault-sync
tags: [dedup, collector, transformer, vault-pipeline, naming-convention]

requires:
  - phase: 16-vault-resync
    provides: vault sync pipeline (collector, transformer, writer)
provides:
  - "Source-path deduplication in collector (no double-writes)"
  - "Pre-materialization dedup gate (detectDuplicates)"
  - "Filename normalization to lowercase-kebab-case in transformer"
  - "Default excludes for .planning/research/ and .planning/codebase/"
affects: [17-02, 17-03, 17-04, 17-05, 17-06]

tech-stack:
  added: []
  patterns:
    - "Pre-materialization validation gate in sync pipeline"
    - "Source-path dedup via normalized Set in collector"
    - "Vault path normalization (UPPERCASE_SNAKE to lowercase-kebab)"

key-files:
  created:
    - mcp-server/tests/unit/vault/sync-engine.test.ts
  modified:
    - mcp-server/src/vault/collector.ts
    - mcp-server/src/vault/config.ts
    - mcp-server/src/vault/transformer.ts
    - mcp-server/src/vault/sync-engine.ts
    - mcp-server/tests/unit/vault/collector.test.ts
    - mcp-server/tests/unit/vault/config.test.ts
    - mcp-server/tests/unit/vault/transformer.test.ts

key-decisions:
  - "Removed .planning/codebase/**/*.md from default collect globs -- L0 handles via collectL0Sources, L1/L2 excluded by default"
  - "Added dedup both in collectProjectSources and collectAll for defense-in-depth"
  - "detectDuplicates checks case-insensitive path collisions AND same-source multi-path"

patterns-established:
  - "Pre-materialization gate: validate entries before writeVault"
  - "Source dedup by normalized absolute filepath (case-insensitive)"

requirements-completed: [P17-BUG, P17-DEDUP, P17-EXCLUDE, P17-NAMING]

duration: 5min
completed: 2026-03-16
---

# Phase 17 Plan 01: Vault Bug Fixes Summary

**Fixed collector double-write bug, added .planning/research and .planning/codebase excludes, pre-materialization dedup gate, and UPPERCASE_SNAKE to lowercase-kebab filename normalization**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-16T19:19:14Z
- **Completed:** 2026-03-16T19:24:12Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Fixed the collector double-write bug that caused 64 duplicate files in Phase 16 vault sync
- Added source-path deduplication in both collectProjectSources and collectAll (defense-in-depth)
- Added .planning/research/** and .planning/codebase/** to default excludes, preventing UPPERCASE planning files from leaking into vault
- Created detectDuplicates() pre-materialization gate that aborts sync on case-insensitive path collisions or same-source multi-path
- Added normalizeVaultPath() in transformer to convert UPPERCASE_SNAKE filenames to lowercase-kebab-case
- Updated vault-config.json with correct excludeGlobs for DawSync and DawSyncWeb
- Full test suite passes: 621 tests across 53 files, zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix collector double-write bug and excludeGlobs** - `336f6e3` (fix)
2. **Task 2: Add pre-materialization dedup gate and naming normalization** - `df3f786` (feat)

## Files Created/Modified
- `mcp-server/src/vault/collector.ts` - Added source-path dedup in collectProjectSources and collectAll
- `mcp-server/src/vault/config.ts` - Added .planning/research/** and .planning/codebase/** to default excludes, removed .planning/codebase/**/*.md from default globs
- `mcp-server/src/vault/transformer.ts` - Added normalizeFilename/normalizeVaultPath for lowercase-kebab-case normalization
- `mcp-server/src/vault/sync-engine.ts` - Added detectDuplicates() function and pre-materialization gate in runPipeline
- `mcp-server/tests/unit/vault/collector.test.ts` - Tests for dedup and .planning exclusion
- `mcp-server/tests/unit/vault/config.test.ts` - Tests for updated excludes and globs
- `mcp-server/tests/unit/vault/transformer.test.ts` - Tests for UPPERCASE to lowercase-kebab normalization
- `mcp-server/tests/unit/vault/sync-engine.test.ts` - Tests for detectDuplicates (5 test cases)

## Decisions Made
- Removed `.planning/codebase/**/*.md` from default collect globs: L0 collectL0Sources handles its own codebase collection; L1/L2 projects should not collect .planning/codebase/ files (they leak UPPERCASE duplicates)
- Added dedup in both collectProjectSources AND collectAll for defense-in-depth (belt and suspenders)
- detectDuplicates checks two dimensions: case-insensitive vault path collisions AND same vault_source mapped to multiple paths

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing test that expected .planning/codebase in default globs**
- **Found during:** Task 1
- **Issue:** Existing test "excludes .planning/phases/** but not .planning/codebase/**" expected codebase in globs and NOT in excludes
- **Fix:** Updated test to expect codebase NOT in globs and IN excludes (reflects new behavior)
- **Files modified:** mcp-server/tests/unit/vault/config.test.ts
- **Committed in:** 336f6e3

**2. [Rule 1 - Bug] Updated existing test for .planning/codebase L2 collection**
- **Found during:** Task 1
- **Issue:** Existing test "classified as architecture in planning/ subdivision" expected codebase files to be collected for L2 projects
- **Fix:** Changed test to verify codebase is excluded by default, added companion test showing explicit collectGlobs override still works
- **Files modified:** mcp-server/tests/unit/vault/collector.test.ts
- **Committed in:** 336f6e3

---

**Total deviations:** 2 auto-fixed (2 bugs in existing tests)
**Impact on plan:** Tests had to reflect the new behavior. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Vault pipeline now dedup-safe and naming-normalized
- Ready for Plan 02 (validate-vault MCP tool) and subsequent source doc restructuring
- vault-config.json updated with correct excludes for DawSync/DawSyncWeb

---
*Phase: 17-documentation-structural-homogeneity*
*Completed: 2026-03-16*
