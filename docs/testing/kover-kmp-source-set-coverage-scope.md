---
category: testing
scope: [kover, kmp, android, coverage, instrumented-tests]
sources: [Wave 3c friction #113, Wave 3a AndroidKeyProvider precedent, kover-verification-dsl]
targets: [android, desktop]
slug: kover-kmp-source-set-coverage-scope
status: draft
layer: L0
description: "Kover KMP platform scope: instruments JVM compilation variant only. androidMain-only classes cannot be measured by koverVerify. Required exclude pattern + local-only connectedAndroidTest verification strategy."
version: 1
last_updated: "2026-05-19"
monitor_urls:
  - url: "https://kotlin.github.io/kotlinx-kover/"
    type: doc-page
    tier: 2
l0_refs: [kover-verification-dsl, testing-patterns-coverage, biometric-android-device-test-patterns]
---

# Kover KMP Source Set Coverage Scope

Kover for KMP instruments only the **JVM compilation variant**. This means coverage data from `connectedAndroidTest` (instrumented tests running on a physical device or emulator) is **never** aggregated into `koverVerify`.

## What Kover Measures in KMP

| Source set | Kover instruments? | Test task that covers it |
|-----------|-------------------|-------------------------|
| `commonMain` | YES (via desktopTest JVM run) | `:module:desktopTest` |
| `desktopMain` / `jvmMain` | YES | `:module:desktopTest` |
| `androidMain` (androidMain-only classes) | **NO** | `connectedAndroidTest` (local only) |
| `androidMain` (classes also in commonMain) | YES (via JVM compilation) | `:module:desktopTest` |

Key rule: a class that only exists in `androidMain` is **never** instrumented by Kover. Including it in `koverVerify` scope will always report near-0% coverage and fail the floor gate, even when tests pass on device.

## Required Exclude Pattern

Exclude all androidMain-only classes from Kover scope in the module's `build.gradle.kts`:

```kotlin
kover {
    reports {
        filters {
            excludes {
                classes(
                    // androidMain-only — not instrumented by Kover JVM variant
                    // coverage verified locally via connectedAndroidTest
                    "*AndroidBiometricAuth*",
                    "*AndroidKeyProvider*",   // Wave 3a precedent
                )
            }
        }
        verify {
            rule("biometric coverage — commonMain scope only") {
                minBound(80)
            }
        }
    }
}
```

The comment "androidMain-only — not instrumented by Kover JVM variant" is required to explain WHY the exclusion exists. Without it, the exclusion looks like a coverage cheat.

## Verification Strategy for androidMain-only Classes

Coverage for androidMain-only classes is verified locally via `connectedAndroidTest`:

```bash
# LOCAL-ONLY — requires emulator or physical device
./gradlew :module:connectedAndroidTest
```

This is intentionally NOT in CI (macOS runner 10× cost). Coverage verification for androidMain-only classes is a local developer gate, not a CI gate.

## Anti-Pattern — Including androidMain-only in koverVerify Scope

```kotlin
// WRONG — will always fail; androidMain is not JVM-instrumented
kover {
    reports {
        verify {
            rule {
                // AndroidBiometricAuth is androidMain-only; Kover sees 0% coverage
                minBound(80) // FAILS: actual 9.82% despite 14 passing device tests
            }
        }
    }
}
```

The failure symptom is `koverVerify` reporting near-0% (e.g., 9.82%) for the androidMain class, regardless of how many instrumented tests pass on device.

## Identification — Is a Class androidMain-only?

A class is androidMain-only when ALL of the following are true:

1. It lives in `src/androidMain/kotlin/...`
2. It has no `expect` declaration in `commonMain` that compiles to desktop/JVM
3. It imports Android APIs (`android.*`, `androidx.*`) that have no JVM stub

Quick check: if `./gradlew :module:compileKotlinDesktop` does not compile the class (it's absent from the desktop compilation), it is androidMain-only and must be excluded from Kover scope.

## Precedents in This Codebase

| Module | Class excluded | Wave | Reason |
|--------|---------------|------|--------|
| `core-security-keys` | `AndroidKeyProvider` | Wave 3a | androidMain-only; no JVM equivalent |
| `core-auth-biometric` | `AndroidBiometricAuth` | Wave 3c | androidMain-only; BiometricPrompt is Android-only |
