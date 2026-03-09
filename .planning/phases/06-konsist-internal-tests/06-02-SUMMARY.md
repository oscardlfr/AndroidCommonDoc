---
phase: 06-konsist-internal-tests
plan: 02
subsystem: testing
tags: [konsist, kotlin, naming-conventions, cross-file-checks, structural-testing, package-conventions]

# Dependency graph
requires:
  - phase: 06-konsist-internal-tests
    plan: 01
    provides: "konsist-tests/ module with ScopeFactory utility and classpath isolation"
provides:
  - "DetektRuleStructureTest: provider registration + test coverage cross-file checks (KONS-04)"
  - "PackageConventionTest: package placement + bidirectional module isolation (KONS-04)"
  - "NamingConventionTest: class suffix enforcement for Rule and Extension conventions (KONS-03)"
affects: [06-03-PLAN, 07-consumer-guard-tests]

# Tech tracking
tech-stack:
  added: []
  patterns: [cross-file-provider-registration-check, test-coverage-structure-check, bidirectional-module-isolation, naming-convention-bidirectional-check]

key-files:
  created:
    - konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/DetektRuleStructureTest.kt
    - konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/PackageConventionTest.kt
    - konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/NamingConventionTest.kt
  modified: []

key-decisions:
  - "AssertJ withFailMessage for cross-file checks where Konsist assertTrue lacks granularity"
  - "Bidirectional naming checks: both 'rules package classes end with Rule' AND 'Rule-suffixed classes reside in rules package'"

patterns-established:
  - "Cross-file provider registration: compare Rule class names against RuleSetProvider imports"
  - "Test coverage structure: match production *Rule classes to *RuleTest classes across scopes"
  - "Module isolation: assertFalse on file imports crossing module boundaries"
  - "Bidirectional naming: forward check (package -> suffix) AND reverse check (suffix -> package)"

requirements-completed: [KONS-03, KONS-04]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 6 Plan 2: Naming, Package, and Structure Tests Summary

**12 Konsist tests enforcing naming conventions (KONS-03) and cross-file structural integrity (KONS-04) across detekt-rules and build-logic modules with actionable violation messages**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T14:37:33Z
- **Completed:** 2026-03-13T14:40:05Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments
- 4 DetektRuleStructureTest checks: Rule suffix enforcement, RuleSetProvider existence, provider registration completeness (cross-file), test coverage structure (cross-file)
- 4 PackageConventionTest checks: package placement for both modules + bidirectional module isolation (no cross-imports)
- 4 NamingConventionTest checks: Rule suffix in rules package, reverse Rule-to-package check, RuleSetProvider placement, Extension suffix in build-logic
- All 12 tests pass against current codebase (5 rules + 5 tests + 1 provider + 1 extension)
- All violation messages are actionable: name offending class, state violated rule, provide remediation guidance

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DetektRuleStructureTest with provider registration and test coverage checks** - `dfba2f9` (feat)
2. **Task 2: Create PackageConventionTest and NamingConventionTest** - `db61645` (feat)

## Files Created/Modified
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/DetektRuleStructureTest.kt` - Provider registration sync, test coverage structure, Rule suffix, RuleSetProvider validation (130 lines)
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/PackageConventionTest.kt` - Package placement enforcement + bidirectional module isolation (72 lines)
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/NamingConventionTest.kt` - Class suffix conventions: Rule, Extension, RuleSetProvider placement (96 lines)

## Decisions Made
- Used AssertJ `withFailMessage` for cross-file checks (provider registration, test coverage) where Konsist's `assertTrue` lacks the granularity to produce good error messages for set-difference operations
- Implemented bidirectional naming checks: not just "classes in rules package end with Rule" but also "classes ending with Rule reside in a rules package" -- catches both directions of misplacement

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All KONS-03 (naming conventions) and KONS-04 (cross-file structural checks: provider registration, test coverage, package placement, module isolation) requirements validated
- 12 passing tests across 3 test classes using ScopeFactory from plan 06-01
- Ready for plan 06-03 (architecture fixture tests, ScriptParityTest, SkillStructureTest)

## Self-Check: PASSED

All 3 created files verified present. Both task commits (dfba2f9, db61645) confirmed in git log.

---
*Phase: 06-konsist-internal-tests*
*Completed: 2026-03-13*
