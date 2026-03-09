# T01: 07-consumer-guard-tests 01

**Slice:** S03 — **Milestone:** M002

## Description

Create guard test templates and install scripts that distribute parameterized architecture enforcement to consuming projects.

Purpose: Enable any consuming project (DawSync, OmniSound, etc.) to adopt 5-layer architecture guard tests with a single `bash install-guard-tests.sh --package com.dawsync` command. Templates use `__ROOT_PACKAGE__` token substitution so the same tests work across all consumers.

Output: 6 `.kt.template` files in `guard-templates/`, 1 `build.gradle.kts.template`, and paired SH/PS1 install scripts in `setup/`.

## Must-Haves

- [ ] "Guard templates contain __ROOT_PACKAGE__ tokens that sed can substitute"
- [ ] "Every .kt.template has a canary assertion (require or assumeTrue) preventing vacuous passes"
- [ ] "Architecture checks skip missing layers gracefully (assumeTrue, not hard fail)"
- [ ] "Install script accepts --package flag and produces runnable Konsist test files"
- [ ] "Install script creates konsist-guard/ module with build.gradle.kts (pinned deps)"
- [ ] "Install script appends include(':konsist-guard') to consumer settings.gradle.kts idempotently"
- [ ] "Both SH and PS1 install scripts exist with matching functionality"

## Files

- `guard-templates/build.gradle.kts.template`
- `guard-templates/GuardScopeFactory.kt.template`
- `guard-templates/ArchitectureGuardTest.kt.template`
- `guard-templates/NamingGuardTest.kt.template`
- `guard-templates/PackageGuardTest.kt.template`
- `guard-templates/ModuleIsolationGuardTest.kt.template`
- `setup/install-guard-tests.sh`
- `setup/Install-GuardTests.ps1`
