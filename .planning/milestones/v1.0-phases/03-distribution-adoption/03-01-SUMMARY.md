---
phase: 03-distribution-adoption
plan: 01
subsystem: infra
tags: [gradle, convention-plugin, detekt, compose-rules, kotlin-dsl, precompiled-script-plugin]

# Dependency graph
requires:
  - phase: 02-quality-gates
    provides: "Detekt custom rules module (detekt-rules/) with 5 architecture rules JAR"
provides:
  - "build-logic/ module with precompiled convention plugin androidcommondoc.toolkit"
  - "AndroidCommonDocExtension DSL for per-concern opt-out (detektRules, composeRules, testConfig)"
  - "Gradle wrapper (9.1.0) in build-logic/ for standalone verification"
affects: [03-02, 03-03, consuming-projects]

# Tech tracking
tech-stack:
  added: [kotlin-dsl, dev.detekt.gradle.plugin]
  patterns: [precompiled-script-plugin, extension-dsl-opt-out, composite-build-distribution]

key-files:
  created:
    - build-logic/settings.gradle.kts
    - build-logic/build.gradle.kts
    - build-logic/src/main/kotlin/com/androidcommondoc/gradle/AndroidCommonDocExtension.kt
    - build-logic/src/main/kotlin/androidcommondoc.toolkit.gradle.kts
  modified: []

key-decisions:
  - "Added Kotlin Gradle plugin (2.3.10) as implementation dependency -- Detekt plugin depends on KotlinBasePlugin, required for precompiled accessor generation"
  - "ANDROID_COMMON_DOC env var required for config/JAR resolution -- composite builds prevent relative path resolution from consuming project context"
  - "Graceful degradation: warning (not error) when rules JAR missing, skip config if file absent"

patterns-established:
  - "Convention plugin via precompiled script: filename becomes plugin ID (androidcommondoc.toolkit)"
  - "Extension DSL with Property<Boolean> and convention(true) defaults for opt-out"
  - "afterEvaluate for conditional detektPlugins to respect extension values set by consuming project"

requirements-completed: [LINT-02]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 3 Plan 01: Convention Plugin Summary

**Gradle convention plugin in build-logic/ with precompiled script plugin, AndroidCommonDocExtension DSL, and conditional Detekt + Compose Rules bundling**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T08:47:56Z
- **Completed:** 2026-03-13T08:50:19Z
- **Tasks:** 2
- **Files modified:** 4 created + 2 wrapper files

## Accomplishments
- Convention plugin module (`build-logic/`) with `kotlin-dsl` and Detekt 2.0 plugin dependency compiles successfully
- Extension DSL (`AndroidCommonDocExtension`) enables per-concern opt-out: `androidCommonDoc { detektRules.set(false) }`
- Precompiled script plugin conditionally applies custom rules JAR, Compose Rules 0.5.6, and test configuration (maxParallelForks=1, useJUnitPlatform)
- Clear error message when ANDROID_COMMON_DOC env var is missing, plus warning when rules JAR is not built

## Task Commits

Each task was committed atomically:

1. **Task 1: Create build-logic module with extension DSL** - `36449d5` (feat)
2. **Task 2: Create precompiled convention plugin script** - `8380ba6` (feat)

## Files Created/Modified
- `build-logic/settings.gradle.kts` - Module settings with rootProject.name = "build-logic"
- `build-logic/build.gradle.kts` - kotlin-dsl plugin, Detekt 2.0 and Kotlin Gradle plugin dependencies
- `build-logic/src/main/kotlin/com/androidcommondoc/gradle/AndroidCommonDocExtension.kt` - Extension DSL with three Boolean properties
- `build-logic/src/main/kotlin/androidcommondoc.toolkit.gradle.kts` - Precompiled convention plugin applying dev.detekt, extension, conditional dependencies, test config
- `build-logic/gradle/wrapper/*` - Gradle 9.1.0 wrapper (copied from detekt-rules)
- `build-logic/gradlew`, `build-logic/gradlew.bat` - Gradle wrapper scripts

## Decisions Made
- **Kotlin Gradle plugin as build-logic dependency:** Detekt's Gradle plugin transitively depends on `KotlinBasePlugin`. Without `org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.10` on the classpath, precompiled script plugin accessor generation fails. This is a Rule 3 auto-fix (blocking issue).
- **ANDROID_COMMON_DOC env var for path resolution:** In a composite build, the consuming project's `rootProject` is the consumer, not AndroidCommonDoc. An env var provides a stable absolute reference to the toolkit location for config and JAR resolution.
- **Graceful JAR/config handling:** Instead of failing when the rules JAR or config file is absent, the plugin logs a warning and continues. This supports incremental adoption -- a consumer can apply the plugin before building the rules JAR.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added Kotlin Gradle plugin dependency for accessor generation**
- **Found during:** Task 2 (precompiled convention plugin compilation)
- **Issue:** `./gradlew assemble` failed with "KotlinBasePlugin not found" during `generatePrecompiledScriptPluginAccessors` -- the Detekt Gradle plugin depends on the Kotlin Gradle plugin
- **Fix:** Added `implementation("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.10")` to build-logic/build.gradle.kts
- **Files modified:** build-logic/build.gradle.kts
- **Verification:** `./gradlew assemble` succeeds with BUILD SUCCESSFUL
- **Committed in:** 8380ba6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed blocking issue above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Convention plugin compiles and is ready for composite build inclusion by consuming projects
- Plans 03-02 (Claude Code hooks) and 03-03 (setup scripts) can reference the plugin ID `androidcommondoc.toolkit`
- Consuming projects will need: `includeBuild("../AndroidCommonDoc/build-logic")` in settings.gradle.kts and `id("androidcommondoc.toolkit")` in their module build.gradle.kts

## Self-Check: PASSED

All 6 created files verified present. Both task commits (36449d5, 8380ba6) confirmed in git log.

---
*Phase: 03-distribution-adoption*
*Completed: 2026-03-13*
