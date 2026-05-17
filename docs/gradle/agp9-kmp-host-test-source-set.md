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

## See Also

- [gradle-patterns-agp9](gradle-patterns-agp9.md) — parent hub for AGP 9 module templates
- [gradle-patterns-conventions](gradle-patterns-conventions.md) — `KmpLibraryConventionPlugin` structure
- [agp9-consumer-rules-banned-directives](agp9-consumer-rules-banned-directives.md) — sibling AGP 9 doc
