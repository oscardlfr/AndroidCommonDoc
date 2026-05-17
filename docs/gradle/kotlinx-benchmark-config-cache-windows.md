---
slug: kotlinx-benchmark-config-cache-windows
category: build
layer: L0
status: active
parent: gradle-patterns-agp9
scope: [gradle, build-config, benchmarks, config-cache, windows]
sources: [webfetch:github.com/Kotlin/kotlinx-benchmark/releases@2026-05-17]
targets: [desktop, jvm]
assumes_read: gradle-patterns-conventions
description: kotlinx-benchmark 0.4.17 (and earlier) is incompatible with Gradle config cache on Windows — Files.createTempFile at task execution time causes FileNotFoundException. Fix via notCompatibleWithConfigurationCache() on benchmark tasks. Also documents type-safe AllOpenExtension replacement for config-cache-hostile reflection block.
---

# kotlinx-benchmark: Config Cache + Windows Workaround

## Problem

kotlinx-benchmark 0.4.17 (latest as of 2026-05-17) does **not** fix Windows `%TEMP%` `FileNotFoundException` or Gradle config-cache incompatibility.

Root cause: `Utils.kt:12 writeParameters()` calls `Files.createTempFile("benchmarks", "txt")` at **task execution time**, not configuration time. Gradle config cache serializes task state at configuration time and replays it — any I/O at execution time that was not declared as a task input/output fails on cache replay.

On Windows, `%TEMP%` path resolution differs between configuration and execution phases, producing:

```
FileNotFoundException: C:\Users\...\AppData\Local\Temp\benchmarks*.txt (Access is denied)
```

**Version note:** Assume this applies to all kotlinx-benchmark versions until a release explicitly mentions `notCompatibleWithConfigurationCache` or `@DisableCachingByDefault` in its changelog. Do not assume a version bump fixes it.

## Fix 1 — Opt Out of Config Cache per Task (required)

In the benchmark convention plugin, mark all benchmark tasks as incompatible with config cache:

```kotlin
// build-logic/.../KmpBenchmarkConventionPlugin.kt
afterEvaluate {
    tasks.configureEach {
        if (name.endsWith("Benchmark") || name == "benchmarksReport") {
            notCompatibleWithConfigurationCache(
                "kotlinx-benchmark temp file caching"
            )
        }
    }
}
```

Task name pattern covering all three configurations (`main`, `smoke`, `stress`):
- `desktopBenchmark`
- `desktopSmokeBenchmark`
- `desktopStressBenchmark`
- `benchmarksReport`

## Fix 2 — Replace Reflection Block with Type-Safe AllOpenExtension (required)

The reflection-based `allopen` wiring is also config-cache hostile (reflective method invocation is not serializable):

```kotlin
// ❌ Config-cache hostile — do NOT use
extensions.findByName("allOpen")?.let { ext ->
    ext.javaClass.getMethod("annotation", String::class.java)
        .invoke(ext, "org.openjdk.jmh.annotations.State")
}
```

Replace with the type-safe extension:

```kotlin
// ✅ Config-cache safe
extensions.configure<AllOpenExtension> {
    annotation("org.openjdk.jmh.annotations.State")
}
```

Import: `org.jetbrains.kotlin.allopen.gradle.AllOpenExtension` (note: `kotlin` namespace, NOT `kotlinx`).

## Complete Convention Plugin (with both fixes)

```kotlin
// build-logic/.../KmpBenchmarkConventionPlugin.kt
import org.jetbrains.kotlin.allopen.gradle.AllOpenExtension

class KmpBenchmarkConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        with(pluginManager) {
            apply("org.jetbrains.kotlin.multiplatform")
            apply("com.android.kotlin.multiplatform.library")
            apply("org.jetbrains.kotlin.plugin.allopen")
            apply("org.jetbrains.kotlinx.benchmark")
        }
        extensions.configure<KotlinMultiplatformExtension> {
            jvm("desktop") { compilerOptions { jvmTarget.set(JvmTarget.JVM_21) } }
            macosArm64(); macosX64()
            applyDefaultHierarchyTemplate()
        }
        extensions.configure<AllOpenExtension> {
            annotation("org.openjdk.jmh.annotations.State")
        }
        val bExt = extensions.getByType(BenchmarksExtension::class.java)
        bExt.targets.register("desktop")
        bExt.configurations.named("main").configure {
            warmups = 10; iterations = 10; iterationTime = 2; iterationTimeUnit = "s"
            mode = "avgt"; outputTimeUnit = "ms"; reportFormat = "json"
            advanced("jvmForks", 2); advanced("nativeGCAfterIteration", true)
        }
        bExt.configurations.register("smoke").configure {
            warmups = 3; iterations = 3; iterationTime = 500; iterationTimeUnit = "ms"
            mode = "avgt"; outputTimeUnit = "ms"; reportFormat = "json"
        }
        bExt.configurations.register("stress").configure {
            warmups = 5; iterations = 20; iterationTime = 5; iterationTimeUnit = "s"
            mode = "avgt"; outputTimeUnit = "ms"; reportFormat = "json"
            advanced("nativeGCAfterIteration", true)
        }
        afterEvaluate {
            tasks.configureEach {
                if (name.endsWith("Benchmark") || name == "benchmarksReport") {
                    notCompatibleWithConfigurationCache(
                        "kotlinx-benchmark temp file caching"
                    )
                }
            }
        }
    }
}
```

## Anti-Patterns

- Assuming a kotlinx-benchmark version bump fixes the config-cache issue — check the changelog explicitly.
- Using `extensions.findByName("allOpen")` reflection — not config-cache safe and fragile against class loader changes.
- Applying `notCompatibleWithConfigurationCache` only to `desktopBenchmark` — `benchmarksReport` also needs it.

## L1 Evidence (BL-W47-prep Wave 2)

shared-kmp-libs B4 fix: convention plugin updated with both fixes. Confirmed on Windows (friction signal #44 — external research required; not covered by any prior L0 doc).

## See Also

- [testing-patterns-benchmarks](../testing/testing-patterns-benchmarks.md) — benchmark dispatcher selection, module layout
- [gradle-patterns-conventions](gradle-patterns-conventions.md) — convention plugin structure
- [gradle-patterns-agp9](gradle-patterns-agp9.md) — AGP 9 module templates
