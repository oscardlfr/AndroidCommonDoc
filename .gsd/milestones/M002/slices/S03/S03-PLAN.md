# S03: Consumer Guard Tests

**Goal:** Create guard test templates and install scripts that distribute parameterized architecture enforcement to consuming projects.
**Demo:** Create guard test templates and install scripts that distribute parameterized architecture enforcement to consuming projects.

## Must-Haves


## Tasks

- [x] **T01: 07-consumer-guard-tests 01**
  - Create guard test templates and install scripts that distribute parameterized architecture enforcement to consuming projects.

Purpose: Enable any consuming project (DawSync, OmniSound, etc.) to adopt 5-layer architecture guard tests with a single `bash install-guard-tests.sh --package com.dawsync` command. Templates use `__ROOT_PACKAGE__` token substitution so the same tests work across all consumers.

Output: 6 `.kt.template` files in `guard-templates/`, 1 `build.gradle.kts.template`, and paired SH/PS1 install scripts in `setup/`.
- [x] **T02: 07-consumer-guard-tests 02**
  - Validate guard templates by installing them in DawSync (full architecture scan), DawSync worktree track-E (canary pass on feature branch), and OmniSound (canary pass), proving the end-to-end flow works from install to test execution across multiple consumers and worktrees.

Purpose: GUARD-03 requires validation against at least one consuming project. DawSync gets a full scan (all guard tests run against real code). The DawSync worktree at `.claude/worktrees/track-E` (branch: `feature/precloud-full-test-coverage-wave`) gets a separate install to validate that guard tests work in git worktree checkouts -- per user decision "Validate in DawSync worktree as well." OmniSound gets a canary pass (templates install and scope assertions confirm non-empty). Any architecture violations found in DawSync are reported to the user for fix in their track-E terminal -- we do NOT fix consumer code in this phase.

Output: konsist-guard/ modules installed and validated in DawSync (main + worktree) and OmniSound. Checkpoint for violation triage.
- [x] **T03: 07-consumer-guard-tests 03**
  - Close two verification gaps from 07-VERIFICATION.md: (1) fix REQUIREMENTS.md GUARD-03 to name DawSync/OmniSound as the validated consumers instead of WakeTheCave, and (2) add the missing __KOTLIN_VERSION__ token to build.gradle.kts.template so the Kotlin version auto-detection in install scripts actually applies.

Purpose: The verification report found a documentation inconsistency (GUARD-03 naming WakeTheCave when DawSync/OmniSound were validated per user decision) and a dead code path (scripts detect Kotlin version but template has no token to receive it). Both are cleanup issues, not functional failures.

Output: Updated REQUIREMENTS.md, updated build.gradle.kts.template with __KOTLIN_VERSION__ token. No consumer re-installation needed (existing consumers already work with pluginManagement resolution).

## Files Likely Touched

- `guard-templates/build.gradle.kts.template`
- `guard-templates/GuardScopeFactory.kt.template`
- `guard-templates/ArchitectureGuardTest.kt.template`
- `guard-templates/NamingGuardTest.kt.template`
- `guard-templates/PackageGuardTest.kt.template`
- `guard-templates/ModuleIsolationGuardTest.kt.template`
- `setup/install-guard-tests.sh`
- `setup/Install-GuardTests.ps1`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `guard-templates/build.gradle.kts.template`
- `setup/install-guard-tests.sh`
- `setup/Install-GuardTests.ps1`
- `.planning/REQUIREMENTS.md`
