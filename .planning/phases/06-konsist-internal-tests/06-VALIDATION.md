---
phase: 6
slug: konsist-internal-tests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | JUnit 5.11.4 + Konsist 0.17.3 |
| **Config file** | `konsist-tests/build.gradle.kts` (created in Wave 0) |
| **Quick run command** | `cd konsist-tests && ./gradlew test` |
| **Full suite command** | `cd konsist-tests && ./gradlew test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd konsist-tests && ./gradlew test`
- **After every plan wave:** Run `cd konsist-tests && ./gradlew test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | KONS-01 | smoke | `cd konsist-tests && ./gradlew test --tests "*.DetektRuleStructureTest"` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 0 | KONS-01 | smoke | `cd konsist-tests && ./gradlew test --tests "*.DetektRuleStructureTest"` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | KONS-02 | unit | `cd konsist-tests && ./gradlew test --tests "*.ArchitectureFixtureTest"` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | KONS-03 | unit | `cd konsist-tests && ./gradlew test --tests "*.NamingConventionTest"` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 1 | KONS-04 | unit | `cd konsist-tests && ./gradlew test --tests "*.DetektRuleStructureTest"` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 1 | KONS-04 | unit | `cd konsist-tests && ./gradlew test --tests "*.PackageConventionTest"` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 2 | KONS-05 | integration | Run `./gradlew test` twice, verify second run executes | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `konsist-tests/build.gradle.kts` — Standalone JVM-only module with Konsist testImplementation
- [ ] `konsist-tests/settings.gradle.kts` — rootProject.name = "konsist-tests"
- [ ] `konsist-tests/gradle/wrapper/` — Gradle 9.1.0 wrapper
- [ ] `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/support/ScopeFactory.kt` — Centralized scope creation + canary assertions
- [ ] `konsist-tests/src/test/resources/fixtures/layer-violation/*.kt` — Architecture violation fixture files
- [ ] `konsist-tests/src/test/resources/fixtures/naming-violation/*.kt` — Naming violation fixture files
- [ ] `konsist-tests/src/test/resources/fixtures/package-violation/*.kt` — Package violation fixture files
- [ ] **Classpath spike:** Verify `Konsist.scopeFromDirectory("../detekt-rules/src/main/kotlin")` resolves and returns non-empty scope

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tests never show UP-TO-DATE | KONS-05 | Gradle caching behavior requires observing consecutive runs | Run `cd konsist-tests && ./gradlew test` twice; verify second run shows test execution, not UP-TO-DATE |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
