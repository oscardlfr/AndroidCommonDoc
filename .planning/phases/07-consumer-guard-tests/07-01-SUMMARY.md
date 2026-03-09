---
phase: 07-consumer-guard-tests
plan: 01
subsystem: testing
tags: [konsist, architecture-tests, guard-templates, install-scripts, token-substitution]

# Dependency graph
requires:
  - phase: 06-konsist-internal-tests
    provides: "Proven Konsist 0.17.3 patterns (ScopeFactory, ArchitectureTest, NamingConventionTest)"
provides:
  - "6 parameterized .kt.template files in guard-templates/ for consumer architecture enforcement"
  - "build.gradle.kts.template with pinned Konsist/JUnit/AssertJ versions"
  - "Paired SH/PS1 install scripts with --package token substitution"
affects: [07-consumer-guard-tests, consumer-projects]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "__ROOT_PACKAGE__ token substitution via sed/Replace for parameterized templates"
    - "Import-based architecture checks instead of Konsist assertArchitecture to avoid KoPreconditionFailedException"
    - "assumeTrue for graceful missing-layer skipping in guard tests"
    - "GuardScopeFactory with canary require(count > 0) assertion"

key-files:
  created:
    - guard-templates/build.gradle.kts.template
    - guard-templates/GuardScopeFactory.kt.template
    - guard-templates/ArchitectureGuardTest.kt.template
    - guard-templates/NamingGuardTest.kt.template
    - guard-templates/PackageGuardTest.kt.template
    - guard-templates/ModuleIsolationGuardTest.kt.template
    - setup/install-guard-tests.sh
    - setup/Install-GuardTests.ps1
  modified: []

key-decisions:
  - "Import-based architecture checks over Konsist Layer assertArchitecture to avoid KoPreconditionFailedException on empty layers"
  - "kotlin(jvm) without version in build template to inherit from consumer pluginManagement"
  - "Safe arithmetic $((VAR + 1)) instead of ((VAR++)) to avoid set -e exit on zero evaluation"

patterns-established:
  - "Guard template distribution: .kt.template + __ROOT_PACKAGE__ + sed substitution"
  - "Consumer module pattern: include(:konsist-guard) in consumer settings.gradle.kts"
  - "Paired SH/PS1 install scripts with --package, --target, --dry-run, --force flags"

requirements-completed: [GUARD-01, GUARD-02]

# Metrics
duration: 5min
completed: 2026-03-13
---

# Phase 7 Plan 1: Guard Templates and Install Scripts Summary

**6 parameterized Konsist guard templates with __ROOT_PACKAGE__ token substitution and paired SH/PS1 install scripts for consumer architecture enforcement**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T16:15:21Z
- **Completed:** 2026-03-13T16:20:46Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created 6 template files (5 .kt.template + 1 .kts.template) in guard-templates/ with __ROOT_PACKAGE__ tokens
- GuardScopeFactory has canary require(count > 0) assertion preventing vacuous passes
- Architecture checks use import-based analysis with assumeTrue for graceful missing-layer handling
- Paired SH + PS1 install scripts with full --package/--target/--dry-run/--force support
- Idempotent settings.gradle.kts modification (append include only if absent)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create guard test templates** - `153b62d` (feat)
2. **Task 2: Create install scripts (SH + PS1)** - `d93890c` (feat)

## Files Created/Modified
- `guard-templates/build.gradle.kts.template` - Generated build file with pinned Konsist 0.17.3, JUnit 5.11.4, AssertJ 3.27.3
- `guard-templates/GuardScopeFactory.kt.template` - Centralized scope creation with canary assertion
- `guard-templates/ArchitectureGuardTest.kt.template` - Import-based 3-layer dependency enforcement
- `guard-templates/NamingGuardTest.kt.template` - ViewModel/UseCase/Repository suffix checks
- `guard-templates/PackageGuardTest.kt.template` - Model purity + domain Android-free checks
- `guard-templates/ModuleIsolationGuardTest.kt.template` - Cross-feature import isolation
- `setup/install-guard-tests.sh` - Bash installer (201 lines) with colored logging
- `setup/Install-GuardTests.ps1` - PowerShell equivalent (193 lines) with matching params

## Decisions Made
- Used import-based architecture checks instead of Konsist assertArchitecture with Layer objects to avoid KoPreconditionFailedException when consumer projects have empty layers
- Omitted Kotlin version from build template plugin (`kotlin("jvm")` without version) to inherit from consumer's pluginManagement and avoid "Kotlin plugin applied multiple times" conflict
- Used `$((VAR + 1))` arithmetic instead of `((VAR++))` to prevent `set -e` exit on zero-evaluation (auto-fixed during Task 2)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed set -e arithmetic exit on ((INSTALLED++))**
- **Found during:** Task 2 (Install scripts)
- **Issue:** `((INSTALLED++))` returns exit code 1 when INSTALLED is 0 (bash treats 0 as falsy), causing `set -e` to abort the script
- **Fix:** Changed all `((VAR++))` to `VAR=$((VAR + 1))` which always returns exit code 0
- **Files modified:** setup/install-guard-tests.sh
- **Verification:** Dry-run completes successfully without premature exit
- **Committed in:** d93890c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was necessary for script correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed arithmetic bug.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Guard templates ready for consumer validation (Phase 7 Plan 2 if exists, or manual install)
- Install script tested with dry-run and real install against temporary directory
- DawSync validation: `bash setup/install-guard-tests.sh --package com.dawsync --target /path/to/DawSync`
- OmniSound canary: `bash setup/install-guard-tests.sh --package com.omnisound --target /path/to/OmniSound`

## Self-Check: PASSED

All 8 created files verified present. Both commit hashes (153b62d, d93890c) confirmed in git log.

---
*Phase: 07-consumer-guard-tests*
*Completed: 2026-03-13*
