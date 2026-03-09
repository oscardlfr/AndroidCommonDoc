# T03: 07-consumer-guard-tests 03

**Slice:** S03 — **Milestone:** M002

## Description

Close two verification gaps from 07-VERIFICATION.md: (1) fix REQUIREMENTS.md GUARD-03 to name DawSync/OmniSound as the validated consumers instead of WakeTheCave, and (2) add the missing __KOTLIN_VERSION__ token to build.gradle.kts.template so the Kotlin version auto-detection in install scripts actually applies.

Purpose: The verification report found a documentation inconsistency (GUARD-03 naming WakeTheCave when DawSync/OmniSound were validated per user decision) and a dead code path (scripts detect Kotlin version but template has no token to receive it). Both are cleanup issues, not functional failures.

Output: Updated REQUIREMENTS.md, updated build.gradle.kts.template with __KOTLIN_VERSION__ token. No consumer re-installation needed (existing consumers already work with pluginManagement resolution).

## Must-Haves

- [ ] "REQUIREMENTS.md GUARD-03 names DawSync and OmniSound as the validated consumers, matching what was actually done"
- [ ] "build.gradle.kts.template contains __KOTLIN_VERSION__ token in the kotlin(jvm) plugin declaration"
- [ ] "Running install script against a consumer with libs.versions.toml produces a build.gradle.kts with the detected Kotlin version pinned"

## Files

- `guard-templates/build.gradle.kts.template`
- `setup/install-guard-tests.sh`
- `setup/Install-GuardTests.ps1`
- `.planning/REQUIREMENTS.md`
