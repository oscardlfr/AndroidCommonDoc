---
scope: [build, gradle, convention-plugins, android-only]
sources: [android-gradle-plugin, kotlin-gradle-plugin]
targets: [android]
version: 1
last_updated: "2026-03-18"
assumes_read: gradle-patterns-conventions
token_budget: 580
description: "AndroidLibraryConventionPlugin para proyectos Android-only con AGP 8.x. Sin migración a AGP 9 requerida."
slug: gradle-patterns-android-only
status: active
layer: L0
parent: gradle-patterns-conventions
category: gradle
---

# Android-Only Convention Plugin (AGP 8.x)

## English

### When to use this instead of KmpLibraryConventionPlugin

Use `AndroidLibraryConventionPlugin` when:
- Your project targets **Android only** (no Desktop, iOS, or macOS)
- Your project uses **AGP 8.x** (`com.android.library` plugin)
- You are **not migrating** to AGP 9.0 (`com.android.kotlin.multiplatform.library`)

> The `flat-module-names` rule (nested modules → AGP 9+ circular dependency bug)
> **does not apply** to AGP 8.x projects. Nested module paths like `:core:api`
> are safe on AGP 8.x.

---

### Build-Logic structure for Android-only

```
build-logic/
  build.gradle.kts
  settings.gradle.kts
  src/main/kotlin/
      ProjectConfig.kt
      AndroidLibraryConventionPlugin.kt       ← primary convention plugin
      AndroidLibraryComposeConventionPlugin.kt ← for modules with Compose UI
```

---

### AndroidLibraryConventionPlugin (AGP 8.x)

```kotlin
class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            with(pluginManager) {
                apply("com.android.library")
                apply("org.jetbrains.kotlin.android")
            }

            extensions.configure<LibraryExtension> {
                compileSdk = ProjectConfig.compileSdk
                defaultConfig.minSdk = ProjectConfig.minSdk

                // JUnit5 platform — apply uniformly via convention plugin
                // so all modules get it, not just some
                testOptions {
                    unitTests.all {
                        it.useJUnitPlatform()
                    }
                }
            }

            // Standard test dependencies every module needs
            dependencies {
                val libs = extensions.getByType<VersionCatalogsExtension>()
                    .named("libs")
                add("testImplementation", libs.findLibrary("junit5-api").get())
                add("testRuntimeOnly", libs.findLibrary("junit5-engine").get())
                add("testImplementation", libs.findLibrary("kotlinx-coroutines-test").get())
                add("testImplementation", libs.findLibrary("turbine").get())
            }
        }
    }
}
```

### AndroidLibraryComposeConventionPlugin

```kotlin
class AndroidLibraryComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.android.library")
            pluginManager.apply("org.jetbrains.kotlin.android")
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")

            extensions.configure<LibraryExtension> {
                compileSdk = ProjectConfig.compileSdk
                defaultConfig.minSdk = ProjectConfig.minSdk
                buildFeatures.compose = true
            }
        }
    }
}
```

---

### libs.versions.toml additions for Android-only projects

```toml
[versions]
agp            = "8.9.1"
kotlin         = "2.3.0"
coroutines     = "1.10.2"
turbine        = "1.2.1"
junit5         = "6.0.3"
serialization  = "1.10.0"
mockk          = "1.14.9"
kover          = "0.9.4"
detekt         = "2.0.0-alpha.2"

[libraries]
junit5-api              = { module = "org.junit.jupiter:junit-jupiter-api",    version.ref = "junit5" }
junit5-engine           = { module = "org.junit.jupiter:junit-jupiter-engine", version.ref = "junit5" }
kotlinx-coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "coroutines" }
turbine                 = { module = "app.cash.turbine:turbine",               version.ref = "turbine" }
kotlinx-serialization   = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "serialization" }
mockk                   = { module = "io.mockk:mockk",                         version.ref = "mockk" }

[plugins]
android-library    = { id = "com.android.library",                       version.ref = "agp" }
kotlin-android     = { id = "org.jetbrains.kotlin.android",              version.ref = "kotlin" }
kotlin-compose     = { id = "org.jetbrains.kotlin.plugin.compose",       version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
kover              = { id = "org.jetbrains.kotlinx.kover",               version.ref = "kover" }
detekt             = { id = "io.gitlab.arturbosch.detekt",               version.ref = "detekt" }
```

---

### Module build.gradle.kts (Android-only)

```kotlin
plugins {
    alias(libs.plugins.android.library)       // com.android.library — AGP 8.x
    alias(libs.plugins.kotlin.android)
    // alias(libs.plugins.kotlin.compose)     // only for Compose modules
    // alias(libs.plugins.kotlin.serialization) // only for modules using JSON
}
```

Or with convention plugin (preferred):

```kotlin
plugins {
    id("your.project.android.library")         // applies com.android.library + kotlin.android + test config
    // id("your.project.android.library.compose") // Compose variant
}
```

---

### Source set structure (Android-only vs KMP)

| | Android-only (AGP 8.x) | KMP (AGP 9.0) |
|---|---|---|
| Plugin | `com.android.library` | `com.android.kotlin.multiplatform.library` |
| DSL block | `android {}` | `androidLibrary {}` inside `kotlin {}` |
| Source sets | `src/main/kotlin/` | `src/androidMain/kotlin/` |
| Test sets | `src/test/kotlin/` | `src/commonTest/kotlin/` |
| Convention plugin | `AndroidLibraryConventionPlugin` | `KmpLibraryConventionPlugin` |
| Module naming | Nested OK (`:core:api`) | Flat required (`core-api`) — AGP 9+ bug |

---

### Migrating to Fakes (progressive — MockK → Fakes)

L0 recommends pure-Kotlin fakes in `commonTest` for KMP.
For Android-only projects: keep existing MockK tests, migrate progressively:

1. **Priority**: modules using `mockkStatic` or `mockkConstructor` — hardest to maintain
2. **Next**: modules whose tests run on JVM only — easiest to convert to fakes
3. **Keep MockK**: for tests that need partial mocking of platform types

```kotlin
// Fake (preferred for new tests)
class FakeUserRepository : UserRepository {
    var users: List<User> = emptyList()
    override suspend fun getUsers() = users
}

// MockK (legacy — migrate progressively)
val repo = mockk<UserRepository>()
every { repo.getUsers() } returns listOf(...)
```

---

**Parent doc**: [gradle-patterns-conventions.md](gradle-patterns-conventions.md)

---

## Castellano

### Cuándo usar este plugin en lugar de KmpLibraryConventionPlugin

Usa `AndroidLibraryConventionPlugin` cuando:
- Tu proyecto tiene como target **solo Android** (sin Desktop, iOS ni macOS)
- Usas **AGP 8.x** (plugin `com.android.library`)
- **No vas a migrar** a AGP 9.0 — no es obligatorio para adoptar L0

> La regla `flat-module-names` (módulos nested → bug de dependencias circulares en AGP 9+)
> **no aplica** a proyectos AGP 8.x. Rutas como `:core:api` son seguras en AGP 8.x.

---

### Estructura build-logic para Android-only

```
build-logic/
  build.gradle.kts
  settings.gradle.kts
  src/main/kotlin/
      ProjectConfig.kt
      AndroidLibraryConventionPlugin.kt
      AndroidLibraryComposeConventionPlugin.kt
```

---

### AndroidLibraryConventionPlugin (AGP 8.x)

```kotlin
class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            with(pluginManager) {
                apply("com.android.library")
                apply("org.jetbrains.kotlin.android")
            }

            extensions.configure<LibraryExtension> {
                compileSdk = ProjectConfig.compileSdk
                defaultConfig.minSdk = ProjectConfig.minSdk

                // JUnit5 — aplica uniformemente via convention plugin
                testOptions {
                    unitTests.all { it.useJUnitPlatform() }
                }
            }

            dependencies {
                val libs = extensions.getByType<VersionCatalogsExtension>().named("libs")
                add("testImplementation", libs.findLibrary("junit5-api").get())
                add("testRuntimeOnly", libs.findLibrary("junit5-engine").get())
                add("testImplementation", libs.findLibrary("kotlinx-coroutines-test").get())
                add("testImplementation", libs.findLibrary("turbine").get())
            }
        }
    }
}
```

---

### Tabla comparativa AGP 8.x vs AGP 9.0

| | Android-only (AGP 8.x) | KMP (AGP 9.0) |
|---|---|---|
| Plugin | `com.android.library` | `com.android.kotlin.multiplatform.library` |
| Bloque DSL | `android {}` | `androidLibrary {}` dentro de `kotlin {}` |
| Source sets | `src/main/kotlin/` | `src/androidMain/kotlin/` |
| Tests | `src/test/kotlin/` | `src/commonTest/kotlin/` |
| Convention plugin | `AndroidLibraryConventionPlugin` | `KmpLibraryConventionPlugin` |
| Módulos nested | ✅ OK (`:core:api`) | ❌ Bug AGP 9+ — usar flat (`core-api`) |
| Migración a L0 | ✅ Sin cambios de AGP | ✅ Requiere AGP 9+ |

**Parent doc**: [gradle-patterns-conventions.md](gradle-patterns-conventions.md)
