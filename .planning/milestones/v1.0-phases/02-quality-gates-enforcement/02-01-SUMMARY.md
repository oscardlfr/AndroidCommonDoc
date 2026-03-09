---
phase: 02-quality-gates-enforcement
plan: 01
subsystem: testing
tags: [detekt, lint, architecture-rules, compose-rules, ast-analysis, kotlin]

# Dependency graph
requires:
  - phase: 01-stabilize-foundation
    provides: Pattern docs defining the 5 architecture conventions these rules enforce
provides:
  - Standalone detekt-rules JAR with 5 custom AST-only architecture enforcement rules
  - Gradle wrapper for independent module builds
  - compose-rules 0.5.6 co-existence verification via detektPlugins configuration
affects: [02-02, 02-03, 03-distribution-and-adoption]

# Tech tracking
tech-stack:
  added: [detekt 2.0.0-alpha.2, detekt-test 2.0.0-alpha.2, compose-rules 0.5.6, JUnit 5.11.4, AssertJ 3.27.3]
  patterns: [AST-only Detekt rule pattern, two-pass file-level analysis for context-dependent rules, ServiceLoader rule discovery]

key-files:
  created:
    - detekt-rules/build.gradle.kts
    - detekt-rules/settings.gradle.kts
    - detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/AndroidCommonDocRuleSetProvider.kt
    - detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/SealedUiStateRule.kt
    - detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/CancellationExceptionRethrowRule.kt
    - detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/NoPlatformDepsInViewModelRule.kt
    - detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/WhileSubscribedTimeoutRule.kt
    - detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/NoChannelForUiEventsRule.kt
    - detekt-rules/src/main/resources/META-INF/services/dev.detekt.api.RuleSetProvider
    - detekt-rules/src/main/resources/config/config.yml
    - detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/SealedUiStateRuleTest.kt
    - detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/CancellationExceptionRethrowRuleTest.kt
    - detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/NoPlatformDepsInViewModelRuleTest.kt
    - detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/WhileSubscribedTimeoutRuleTest.kt
    - detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/NoChannelForUiEventsRuleTest.kt
  modified: []

key-decisions:
  - "Detekt 2.0.0-alpha.2 API uses RuleSetId (not RuleSet.Id) and instance() without Config param -- fixed from research's speculative API"
  - "Added JUnit platform launcher as testRuntimeOnly to support Gradle 9.1 test execution"
  - "Gradle wrapper copied from shared-kmp-libs (Gradle 9.1.0) for standalone module builds"

patterns-established:
  - "AST-only Detekt rule: extend Rule(config, description), use visit* methods, report Finding(Entity.from(element), message)"
  - "Two-pass file analysis: visitKtFile collects state from visitClass and visitImportDirective, then reports in visitKtFile"
  - "ServiceLoader registration: META-INF/services/dev.detekt.api.RuleSetProvider with fully qualified class name"

requirements-completed: [LINT-01, LINT-03]

# Metrics
duration: 8min
completed: 2026-03-13
---

# Phase 2 Plan 1: Custom Detekt Rules Summary

**5 AST-only architecture enforcement rules for Detekt 2.0.0-alpha.2 with 26 TDD tests and compose-rules 0.5.6 co-existence**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-13T06:41:13Z
- **Completed:** 2026-03-13T06:49:35Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments
- Standalone detekt-rules Gradle module with build system, Gradle wrapper, and all infrastructure
- 5 custom Detekt rules enforcing sealed UiState, CancellationException rethrow, no platform deps in ViewModels, WhileSubscribed timeout, and no Channel for UI events
- 26 comprehensive tests (positive and negative cases) across all 5 rules, all passing
- compose-rules 0.5.6 verified resolving in detektPlugins configuration alongside custom rules
- All rules use AST-only analysis (no type resolution), avoiding #8882 24x performance regression

## Task Commits

Each task was committed atomically:

1. **Task 1: Create detekt-rules module skeleton** - `a2c893f` (chore)
2. **Task 2: Implement 5 rules with TDD tests** - `a2352b7` (feat)

## Files Created/Modified
- `detekt-rules/build.gradle.kts` - Kotlin JVM module with detekt-api compileOnly, compose-rules detektPlugins, detekt-test + JUnit 5 test deps
- `detekt-rules/settings.gradle.kts` - Standalone module settings
- `detekt-rules/src/main/kotlin/.../AndroidCommonDocRuleSetProvider.kt` - ServiceLoader entry point registering all 5 rules
- `detekt-rules/src/main/kotlin/.../rules/SealedUiStateRule.kt` - Enforces sealed interface/class for *UiState types
- `detekt-rules/src/main/kotlin/.../rules/CancellationExceptionRethrowRule.kt` - Flags swallowed CancellationException including bare Exception/Throwable catch
- `detekt-rules/src/main/kotlin/.../rules/NoPlatformDepsInViewModelRule.kt` - Flags android.*/java.*/platform.* imports in ViewModel files
- `detekt-rules/src/main/kotlin/.../rules/WhileSubscribedTimeoutRule.kt` - Requires non-zero timeout for WhileSubscribed
- `detekt-rules/src/main/kotlin/.../rules/NoChannelForUiEventsRule.kt` - Flags Channel usage in ViewModels, recommends MutableSharedFlow
- `detekt-rules/src/main/resources/META-INF/services/dev.detekt.api.RuleSetProvider` - ServiceLoader registration
- `detekt-rules/src/main/resources/config/config.yml` - Default config with all 5 rules active
- `detekt-rules/src/test/kotlin/.../rules/*Test.kt` - 5 test files with 26 total test cases
- `detekt-rules/gradle/wrapper/*` - Gradle 9.1.0 wrapper for standalone builds
- `detekt-rules/gradlew`, `detekt-rules/gradlew.bat` - Gradle wrapper scripts

## Decisions Made
- Detekt 2.0.0-alpha.2 API differs from research speculation: `RuleSetId` is a standalone class (not `RuleSet.Id`), `instance()` takes no Config parameter. Fixed during implementation.
- Added `testRuntimeOnly("org.junit.platform:junit-platform-launcher")` required by Gradle 9.1 for JUnit 5 test execution.
- Gradle wrapper (9.1.0) copied from shared-kmp-libs for self-contained module builds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Detekt 2.0.0-alpha.2 API mismatch**
- **Found during:** Task 2 (compileKotlin)
- **Issue:** Research specified `RuleSet.Id("...")` and `instance(config: Config)`, but actual API uses `RuleSetId("...")` and `instance()` with no parameter
- **Fix:** Updated AndroidCommonDocRuleSetProvider to use correct API signatures
- **Files modified:** AndroidCommonDocRuleSetProvider.kt
- **Verification:** compileKotlin passes
- **Committed in:** a2352b7

**2. [Rule 3 - Blocking] Added missing detekt-test lint import**
- **Found during:** Task 2 (compileTestKotlin)
- **Issue:** `rule.lint(code)` extension function requires explicit import `dev.detekt.test.lint`
- **Fix:** Added import to all 5 test files
- **Files modified:** All 5 *Test.kt files
- **Verification:** compileTestKotlin passes
- **Committed in:** a2352b7

**3. [Rule 3 - Blocking] Added JUnit platform launcher dependency**
- **Found during:** Task 2 (test execution)
- **Issue:** Gradle 9.1 requires explicit `junit-platform-launcher` on test runtime classpath
- **Fix:** Added `testRuntimeOnly("org.junit.platform:junit-platform-launcher")` to build.gradle.kts
- **Files modified:** build.gradle.kts
- **Verification:** All 26 tests execute and pass
- **Committed in:** a2352b7

**4. [Rule 3 - Blocking] Added Gradle wrapper for standalone module**
- **Found during:** Task 2 (running tests)
- **Issue:** No gradlew in project root; standalone module needs its own wrapper
- **Fix:** Copied Gradle 9.1.0 wrapper from shared-kmp-libs
- **Files modified:** gradlew, gradlew.bat, gradle/wrapper/*
- **Verification:** `./gradlew test` runs successfully
- **Committed in:** a2352b7

---

**Total deviations:** 4 auto-fixed (4 blocking)
**Impact on plan:** All auto-fixes necessary for the module to compile and test. No scope creep. The research's speculative API was close but not exact for Detekt 2.0.0-alpha.2.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- detekt-rules JAR ready for consumption via `detektPlugins` in consuming projects
- compose-rules 0.5.6 co-existence verified -- consuming projects add both JARs
- Phase 2 Plan 2 (freshness tracking) and Plan 3 (quality gate agents) can proceed independently

## Self-Check: PASSED

- All 16 created files verified present on disk
- Both task commits (a2c893f, a2352b7) verified in git log
- 26 tests passing with 0 failures confirmed

---
*Phase: 02-quality-gates-enforcement*
*Completed: 2026-03-13*
