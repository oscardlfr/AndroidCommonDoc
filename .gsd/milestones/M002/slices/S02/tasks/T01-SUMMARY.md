---
id: T01
parent: S02
milestone: M002
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 
blocker_discovered: false
---
# T01: 06-konsist-internal-tests 01

**# Phase 6 Plan 1: Module Bootstrap Summary**

## What Happened

# Phase 6 Plan 1: Module Bootstrap Summary

**Konsist 0.17.3 classpath spike validated in isolated JVM module with ScopeFactory utility scanning detekt-rules (6 files) and build-logic (1 file) via relative paths**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T14:30:07Z
- **Completed:** 2026-03-13T14:34:15Z
- **Tasks:** 2
- **Files modified:** 6 created

## Accomplishments
- Konsist 0.17.3 resolves with kotlin-compiler-embeddable:2.0.21 transitive -- no classpath conflict with Kotlin 2.3.10
- ScopeFactory provides 4 scope methods (detektRules, detektRulesTest, buildLogic, fixture) with canary assertions preventing vacuous passes
- 3 canary tests pass: scope resolution, AndroidCommonDocExtension class discovery, Kotlin 2.3.10 source parsing
- UP-TO-DATE bypass confirmed: test task re-executes on every invocation (KONS-05)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create konsist-tests module with Gradle wrapper and UP-TO-DATE bypass** - `2d29b9e` (feat)
2. **Task 2: Create ScopeFactory utility and ClasspathSpikeTest canary** - `d77b992` (feat)

## Files Created/Modified
- `konsist-tests/build.gradle.kts` - Standalone JVM module with Konsist 0.17.3 testImplementation, UP-TO-DATE bypass
- `konsist-tests/settings.gradle.kts` - Standalone project declaration (rootProject.name = "konsist-tests")
- `konsist-tests/gradle/wrapper/gradle-wrapper.properties` - Gradle 9.1.0 wrapper config
- `konsist-tests/gradle/wrapper/gradle-wrapper.jar` - Gradle wrapper binary
- `konsist-tests/gradlew` - Unix wrapper script
- `konsist-tests/gradlew.bat` - Windows wrapper script
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/support/ScopeFactory.kt` - Centralized scope creation with canary assertions
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ClasspathSpikeTest.kt` - 3 canary tests proving classpath isolation

## Decisions Made
- **Relative paths for scopeFromDirectory:** Konsist internally prepends its project root to the directory argument. Passing an absolute canonical path caused path duplication on Windows (e.g., `konsist-tests\C:\Users\...\detekt-rules\...`). Using relative paths (`../detekt-rules/src/main/kotlin`) resolves correctly.
- **Separate directory validation:** Validate directory existence via `java.io.File` before passing to `Konsist.scopeFromDirectory()` to provide clear error messages rather than Konsist's internal concatenation errors.
- **No Detekt plugin in konsist-tests:** Only `kotlin("jvm")` plugin applied. Detekt would bring a second `kotlin-compiler-embeddable` version onto the classpath, causing ClassCastException.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed absolute path duplication in Konsist scopeFromDirectory**
- **Found during:** Task 2 (ScopeFactory creation)
- **Issue:** Plan suggested using `File.canonicalPath` (absolute) for Konsist's scopeFromDirectory. Konsist internally prepends its project root, causing path duplication on Windows: `konsist-tests\C:\Users\...\detekt-rules\...`
- **Fix:** Pass relative paths directly to Konsist; validate directory existence separately via `java.io.File`
- **Files modified:** `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/support/ScopeFactory.kt`
- **Verification:** All 3 canary tests pass
- **Committed in:** d77b992 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for Windows compatibility. No scope creep.

## Issues Encountered
- Konsist's `scopeFromDirectory` appends the given path to its internal project root. The plan's fallback approach of using `File.canonicalPath` for absolute paths actually caused the failure. Resolved by keeping paths relative and validating existence separately.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- konsist-tests/ module is fully operational with Konsist 0.17.3
- ScopeFactory ready for use by plans 06-02 (DetektRuleStructure, PackageConvention, NamingConvention tests) and 06-03 (Architecture fixtures, module isolation tests)
- Classpath isolation VALIDATED -- no blocker for remaining Phase 6 plans
- Open question from research answered: relative paths with `..` segments work correctly on Windows with Konsist

## Self-Check: PASSED

All 9 files verified present. Both task commits (2d29b9e, d77b992) confirmed in git log.

---
*Phase: 06-konsist-internal-tests*
*Completed: 2026-03-13*
