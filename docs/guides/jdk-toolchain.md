---
slug: jdk-toolchain
category: guides
scope: [L1, L2]
sources:
  - url: "https://docs.gradle.org/current/userguide/toolchains.html"
    type: doc-page
    tier: 1
targets: []
description: "Configure a Gradle Java toolchain so consumer projects auto-provision the correct JDK regardless of developer-local JAVA_HOME. Closes T-BUG-007 — KMP projects on AGP 9 + Kotlin 2.3+ require JDK 21 and fail silently on JDK 17."
---

# JDK Toolchain Setup (T-BUG-007)

## Problem

Projects consuming AndroidCommonDoc L0 patterns with AGP 9 and Kotlin 2.3+ require **JDK 21**. A developer whose `JAVA_HOME` points at JDK 17 sees `UnsupportedClassVersionError` on 58–67 modules with no up-front warning — the error surfaces mid-build, making onboarding opaque.

## Fix

Configure a Gradle Java toolchain in your convention plugin. Gradle will auto-provision the correct JDK via the Foojay resolver if it is not already present, regardless of `JAVA_HOME`.

### 1. Add Foojay resolver to settings

`settings.gradle.kts`:

```kotlin
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
```

### 2. Declare the toolchain in convention plugins

`build-logic/convention/src/main/kotlin/<project>.KmpLibraryConventionPlugin.kt` (or equivalent):

```kotlin
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.gradle.kotlin.dsl.configure

class KmpLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        // ... your existing KMP setup ...

        extensions.configure<JavaPluginExtension> {
            toolchain {
                languageVersion.set(JavaLanguageVersion.of(21))
            }
        }

        // If you have a KotlinMultiplatformExtension:
        extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinMultiplatformExtension> {
            jvmToolchain(21)
        }
    }
}
```

### 3. Verify

```bash
./gradlew --version
# Look for "Launcher JVM: 21.x.x"

./gradlew :some-module:compileKotlinDesktop
# Should pass even if JAVA_HOME points at JDK 17 —
# Gradle downloads JDK 21 to $HOME/.gradle/jdks on first run.
```

## Opting out (documentation-only path)

If you prefer not to adopt the toolchain, document your JDK 21 requirement clearly:

- Add a `.java-version` file at repo root with `21`
- Add a top-level `README.md` prerequisite line
- Add a `/setup` wizard check that runs `java -version` and warns on mismatch

This is strictly inferior to the toolchain — a developer can silently skip or misconfigure any of these — but lower-friction for quick prototypes.

## Cross-references

- `docs/gradle/gradle-patterns.md` — general Gradle conventions
- `setup/templates/build-logic/` — shipped convention plugin templates (consumer copies via `/sync-l0`)
- `.planning/intel/android-skills-catalog.md` — `/agp-9-upgrade` skill relates (AGP 9 is the driver for the JDK 21 requirement)
