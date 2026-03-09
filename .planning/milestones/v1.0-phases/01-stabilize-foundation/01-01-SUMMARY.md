---
phase: 01-stabilize-foundation
plan: 01
subsystem: docs
tags: [pattern-docs, anti-patterns, kmp, compose, gradle, viewmodel, testing, offline-first]

# Dependency graph
requires:
  - phase: none
    provides: "First plan -- no dependencies"
provides:
  - "8 standardized pattern docs with consistent headers, anti-patterns, and pinned library versions"
  - "Verified pattern doc structure (Status, Last Updated, Aligned with, Platforms, Library Versions)"
  - "DON'T/DO anti-pattern pairs across all 7 architecture layers + kmp-architecture"
affects: [01-02, 01-03, 01-04, 02-quality-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verified pattern doc header: Status, Last Updated, Aligned with, Platforms, Library Versions"
    - "Anti-pattern format: DON'T (Anti-pattern) with BAD: explanation + DO (Correct) + Key insight one-liner"

key-files:
  created: []
  modified:
    - docs/viewmodel-state-patterns.md
    - docs/ui-screen-patterns.md
    - docs/testing-patterns.md
    - docs/gradle-patterns.md
    - docs/offline-first-patterns.md
    - docs/compose-resources-patterns.md
    - docs/resource-management-patterns.md
    - docs/kmp-architecture.md

key-decisions:
  - "Anti-pattern format uses DON'T/DO pairs with BAD: explanations and Key insight one-liners for maximum clarity"
  - "Library versions pinned in headers: Koin 4.1.1, kotlinx-coroutines 1.10.2, Compose 1.7.x, Kotlin 2.3.10, AGP 9.0.0, Kover 0.9.1, MockK 1.14.7"
  - "Existing technical content preserved -- only restructured for consistency and augmented with anti-patterns"

patterns-established:
  - "Pattern doc header: 5-field standard (Status, Last Updated, Aligned with, Platforms, Library Versions)"
  - "Anti-pattern sections: DON'T with BAD: + DO with source comment + Key insight one-liner"

requirements-completed: [PTRN-01, PTRN-02]

# Metrics
duration: 6min
completed: 2026-03-12
---

# Phase 1 Plan 01: Standardize Pattern Docs Summary

**All 8 pattern docs standardized with consistent 5-field headers, DON'T/DO anti-pattern pairs, and pinned library versions (Koin 4.1.1, Compose 1.7.x, Kotlin 2.3.10, AGP 9.0.0)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-12T22:32:32Z
- **Completed:** 2026-03-12T22:38:58Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- All 8 pattern docs now have standardized 5-field headers (Status, Last Updated, Aligned with, Platforms, Library Versions)
- Every doc contains explicit DON'T (Anti-pattern) / DO (Correct) pairs with BAD: explanations
- Library versions pinned in headers and aligned with actual code samples
- Key insight one-liners added after anti-pattern pairs for quick reference
- All 7 required architecture layers covered (ViewModel, UI, testing, Gradle, offline-first, compose resources, resource management) plus kmp-architecture

## Task Commits

Each task was committed atomically:

1. **Task 1: Standardize core pattern docs (ViewModel, UI, Testing, Gradle)** - `622528e` (feat)
2. **Task 2: Standardize remaining pattern docs (offline-first, compose-resources, resource-management, kmp-architecture)** - `ccf40b8` (feat)

## Files Created/Modified
- `docs/viewmodel-state-patterns.md` - Added Library Versions header, formatted anti-patterns for sealed UiState, Channel navigation, Dispatchers.Default in tests, platform deps in VM
- `docs/ui-screen-patterns.md` - Added Library Versions header, added business-logic-in-composable anti-pattern, formatted Channel navigation anti-pattern, formatted string resource anti-patterns
- `docs/testing-patterns.md` - Added Library Versions header, added runBlocking vs runTest anti-pattern, fakes vs mocks anti-pattern, CancellationException swallowing anti-pattern
- `docs/gradle-patterns.md` - Added full standardized header with overview, added nested module names and custom source set anti-patterns
- `docs/offline-first-patterns.md` - Added full standardized header with overview, added synchronous-first loading, raw network calls, missing conflict resolution anti-patterns
- `docs/compose-resources-patterns.md` - Added Library Versions header, added shared resources unique package anti-pattern, formatted existing anti-patterns
- `docs/resource-management-patterns.md` - Added full standardized header with overview, added focus-ignoring and GlobalScope anti-patterns
- `docs/kmp-architecture.md` - Added full standardized header with overview, enhanced duplicate code anti-patterns with DON'T/DO format, added nested module names and commonMain platform code anti-patterns

## Decisions Made
- Used DON'T/DO format (over existing WRONG/CORRECT) for consistency with the verified pattern doc structure from research
- Added Key insight one-liners after each anti-pattern pair to provide quick takeaway without reading full code
- Preserved all existing technical content -- only restructured and augmented, never rewrote

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
- Pre-existing unstaged change in `scripts/ps1/run-parallel-coverage-suite.ps1` (ProjectPath -> ProjectRoot rename) was present but not related to this plan. It was not staged or committed.

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- All 8 pattern docs are now in a consistent format ready to serve as the source of truth for downstream artifacts (skills, AGENTS.md, quality gates)
- Pattern doc structure is established as the template for any future docs
- Ready for Plan 02 (parameter manifest and naming drift fix)

## Self-Check: PASSED

- All 8 pattern doc files exist
- Both task commits verified (622528e, ccf40b8)
- SUMMARY.md created

---
*Phase: 01-stabilize-foundation*
*Completed: 2026-03-12*
