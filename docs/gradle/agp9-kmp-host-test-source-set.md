---
slug: agp9-kmp-host-test-source-set
category: build
layer: L0
status: active
parent: gradle-patterns-agp9
scope: [gradle, build-config, agp9, kmp, testing]
sources: [webfetch:android.googlesource.com/platform/tools/base/+/refs/heads/mirror-goog-studio-main/build-system/gradle-api/src/main/java/com/android/build/api/dsl/KotlinMultiplatformAndroidLibraryExtension.kt@2026-05-17]
targets: [android]
assumes_read: gradle-patterns-agp9
description: AGP 9 KMP plugin source set DSL for android test targets — androidHostTest (JVM) and androidDeviceTest (emulator). Documents withHostTestBuilder / withDeviceTestBuilder and the anti-pattern of using AGP 8.x names (androidUnitTest, androidTest).
---

# AGP 9 KMP: Android Test Source Sets

Plugin: `com.android.kotlin.multiplatform.library` (AGP 9+)

## Source Set Inventory

| Source set | Directory on disk | Run target | Enabled by |
|---|---|---|---|
| `androidMain` | `src/androidMain/` | production | default |
| `androidDeviceTest` | `src/androidInstrumentedTest/` | device / emulator | `withDeviceTestBuilder {}` |
| `androidHostTest` | `src/androidHostTest/` | JVM host (no device) | `withHostTestBuilder {}` |

## DSL Pattern

```kotlin
kotlin {
    androidLibrary {
        // Device tests (emulator / physical device):
        withDeviceTestBuilder {
            sourceSetTreeName = "test"  // androidDeviceTest inherits from commonTest
        }
        // Host tests (JVM, no device):
        withHostTestBuilder {
            // can be empty; creates androidHostTest source set
        }
    }

    sourceSets {
        val androidDeviceTest by getting {
            dependencies {
                implementation(libs.androidx.test.runner)
                implementation(libs.androidx.test.ext.junit)
            }
        }
        val androidHostTest by getting {
            dependencies {
                implementation(libs.mockk)
            }
        }
    }
}
```

## Anti-Patterns

- `androidUnitTest` — AGP 8.x classic `com.android.library` name; **does not exist** in `com.android.kotlin.multiplatform.library`.
- `androidTest` — same; AGP 8.x classic only.
- AGP KMP emits a warning when it finds `src/androidUnitTest/` or `src/androidTest/` directories without `withHostTestBuilder`: _"The '\$sourceSetName' source directory exists, but android host tests are not enabled"_.
- Files placed in these directories are **silently never compiled** — no build error, tests simply don't run.

## L1 Evidence (BL-W47-prep Wave 1)

shared-kmp-libs had orphan files in `androidUnitTest/` and `androidInstrumentedTest/` that were never compiled. Wave 1 resolved these by migrating to `androidHostTest` / `androidDeviceTest` or deleting dead files, and adding `withDeviceTestBuilder {}` / `withHostTestBuilder {}` as needed.

## Compile Task Names — KGP vs AGP 9 KMP

The `android.kotlin.multiplatform.library` plugin (AGP 9 KMP) uses different Gradle task names from the standard KGP plugin. Using the wrong name in exit-criteria or CI scripts will produce "Task not found" errors without any compilation occurring.

| Target | KGP plugin task | AGP 9 KMP plugin task |
|--------|----------------|----------------------|
| Android main source | `compileKotlinAndroid` | **`compileAndroidMain`** |
| Android debug | `compileDebugKotlin` | **`compileDebugAndroidMain`** |
| Android release | `compileReleaseKotlin` | **`compileReleaseAndroidMain`** |
| Desktop (JVM) | `compileKotlinDesktop` | `compileKotlinDesktop` (same) |
| iOS x64 | `compileKotlinIosX64` | `compileKotlinIosX64` (same) |
| Common | `compileKotlinMetadata` | `compileKotlinMetadata` (same) |

**Rule**: For any module using `android.kotlin.multiplatform.library`, specialist exit-criteria and PM briefs MUST use `compileAndroidMain`, NOT `compileKotlinAndroid`.

**Verification**: CI `.github/workflows/ci.yml:164` has always used the correct `compileAndroidMain` form — treat that as the canonical reference.

```bash
# WRONG — task does not exist for AGP 9 KMP
./gradlew :core-auth-biometric:compileKotlinAndroid

# CORRECT
./gradlew :core-auth-biometric:compileAndroidMain
```

## Source Sets vs Runnable Test Tasks

`commonTest` is a KMP **source set**, not a runnable Gradle task. Running `./gradlew :module:commonTest` will fail with "Task not found".

Tests declared in `commonTest` are compiled into each platform-specific test binary and run under the platform's own test task:

| Source set | Runnable task (AGP 9 KMP) | Notes |
|-----------|--------------------------|-------|
| `commonTest` | `:module:desktopTest` | Default hierarchy: desktopTest inherits commonTest |
| `commonTest` | `:module:androidDeviceTest` | When instrumented test source set is present |
| `androidDeviceTest` | `:module:androidDeviceTest` | Requires physical device or emulator |
| `desktopTest` | `:module:desktopTest` | Runs on JVM; safest CI fallback |

**Canonical brief phrasing**: "verify commonTest sources pass via `:module:desktopTest`" — NOT "run commonTest".

```bash
# WRONG — commonTest is a source set, not a task
./gradlew :core-auth-biometric:commonTest

# CORRECT
./gradlew :core-auth-biometric:desktopTest
```

## androidDeviceTest Task Semantics

| Task | Semantics | Device required | CI-safe |
|------|-----------|----------------|---------|
| `compileAndroidDeviceTest` | Compile-only — verifies sources compile | NO | YES |
| `assembleAndroidTest` | Assembles test APK | NO (build only) | YES (but slow) |
| `connectedAndroidTest` | Full test execution on device/emulator | YES | LOCAL-ONLY (macOS runner 10× cost) |

**Rule**: use `compileAndroidDeviceTest` for compile verification in specialist briefs. Reserve `connectedAndroidTest` for local manual verification only.

```bash
# WRONG — assembles full test APK; slower than needed for compile check
./gradlew :core-auth-biometric:assembleAndroidTest

# CORRECT — pure compile check; no device, no APK assembly
./gradlew :core-auth-biometric:compileAndroidDeviceTest

# LOCAL-ONLY — full test execution (requires emulator/device)
./gradlew :core-auth-biometric:connectedAndroidTest
```

## :check as the Definitive K/N Validation Task

`:desktopTest` verifies JVM compilation and runs commonTest sources on JVM. It does NOT validate Kotlin/Native constraints — K/N-specific restrictions (e.g., `@Throws` must include `CancellationException`, backtick names cannot contain `()`) only surface when Apple targets are compiled.

Use `:check` as the definitive cross-platform validation gate for any commonTest or commonMain change:

```bash
# Definitive all-target gate — compiles + tests every configured target
./gradlew :module:check
```

**Rule**: any brief specifying commonTest changes with backtick function names or `@Throws` on `suspend fun` MUST include `:check` in exit-criteria, not only `:desktopTest`.

## See Also

- [gradle-patterns-agp9](gradle-patterns-agp9.md) — parent hub for AGP 9 module templates
- [gradle-patterns-conventions](gradle-patterns-conventions.md) — `KmpLibraryConventionPlugin` structure
- [agp9-consumer-rules-banned-directives](agp9-consumer-rules-banned-directives.md) — sibling AGP 9 doc
