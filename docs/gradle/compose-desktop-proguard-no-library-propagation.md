---
slug: compose-desktop-proguard-no-library-propagation
title: "Compose Desktop ProGuard has no library-side auto-propagation"
description: "Why Compose Desktop ProGuard does NOT auto-propagate rules from library JARs — no META-INF/proguard/ discovery, no consumerKeepRules equivalent. Consumer app must explicitly wire every rule file via configurationFiles.from(...)."
category: gradle
layer: L0
status: active
scope: [gradle, build-config, proguard, compose-desktop, security]
sources: [local-file-inspection:configureJvmApplication.kt+AbstractProguardTask.kt+ProguardSettings.kt@2026-05-03, context7:compose-multiplatform@2026-05-03]
targets: [desktop]
parent: gradle-hub
---

## Compose Desktop ProGuard has no library-side auto-propagation

### The Problem

Android developers expect ProGuard/R8 rules from library modules to auto-propagate to the consumer app. In Android (AAR pipeline), `consumerKeepRules { publish = true }` causes rules to be merged into the consumer's R8 run automatically — no explicit consumer-side wiring needed.

**Compose Desktop ProGuard has no equivalent mechanism.** Rules defined in a library JAR are never auto-applied to the consumer's ProGuard run.

---

### Root Cause: No META-INF/proguard/ Discovery

The Android AAR pipeline auto-discovers ProGuard rules from `META-INF/proguard/` entries inside AAR files at merge time (AGP merge step). The Desktop JVM ProGuard pipeline has no equivalent discovery mechanism.

Triple-confirmed via:
- ProGuard 7.7.0 manual: no auto-discovery for JAR inputs
- `configureJvmApplication.kt` plugin source: no recursive JAR inspection
- Direct JAR inspection of `compose-runtime-desktop-1.10.0.jar`: zero `META-INF/proguard/` entries

### Root Cause: configurationFiles.from() Is the Only Wiring Mechanism

`AbstractProguardTask.kt` exposes a single `@InputFiles ConfigurableFileCollection` (`configurationFiles`). At execution time, each file is passed as `-include 'path'` to the ProGuard CLI. There is no publish/merge/discovery step — the consumer must explicitly call `configurationFiles.from(...)` for every rule file they want applied.

```kotlin
// In the consumer app's build.gradle.kts
compose.desktop {
    application {
        buildTypes.release.proguard {
            configurationFiles.from(
                project(":core-error").file("consumer-rules.pro"),
                project(":feature-x").file("consumer-rules.pro")
            )
        }
    }
}
```

---

### The ONE Exception: Compose Framework Rules

The Compose Multiplatform Gradle plugin ships a `defaultComposeProguardRules` configuration that is auto-applied for Compose framework classes (`androidx.compose.**`, `org.jetbrains.compose.**`). This covers the framework internals only.

**NOT covered by the default rules:**
- L1-specific sealed exception hierarchies
- `@Serializable` data classes from your modules
- Koin `Registration` objects
- Any library-specific FQN rules

---

### Android vs Desktop Asymmetry (Summary)

| Mechanism | Android (R8/AGP) | Desktop (ProGuard/CMP) |
|---|---|---|
| Library-side rule declaration | `consumerKeepRules { publish = true }` | Write `consumer-rules.pro` file |
| Auto-propagation to consumer | YES — AGP merges at build time | NO — never auto-applied |
| Consumer-side wiring required | NO | YES — `configurationFiles.from(...)` |
| Framework rules auto-applied | YES (R8 built-ins) | YES (Compose plugin default rules only) |

---

### Practical Guidance for L1 Libraries

1. **Each L1 module SHOULD ship a `consumer-rules.pro`** in its module root documenting keep rules for its public API surface.
2. **The consumer app (e.g., DawSync desktop) MUST explicitly wire** all relevant `consumer-rules.pro` files via `configurationFiles.from(...)`.
3. **The L1 convention plugin CANNOT auto-wire** consumer rules to downstream desktop apps — this is a fundamental ProGuard limitation, not a build system gap.
4. **Document this in your consumer app's ProGuard setup** to avoid future confusion when R8 behavior is incorrectly assumed for Desktop.

---

### ProGuard Version

Default: `7.7.0` (from `ProguardSettings.kt:DEFAULT_PROGUARD_VERSION`). Configurable via `version.set(...)` in the DSL.

---

### See Also

- [`agp9-consumer-rules-banned-directives`](agp9-consumer-rules-banned-directives.md) — Android AAR pipeline: which directives AGP 9 strips at merge time (complementary, Android-only)
- [`gradle-patterns-conventions`](gradle-patterns-conventions.md) — Convention plugin structure for L1 modules
