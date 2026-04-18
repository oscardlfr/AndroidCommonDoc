---
scope: [gradle, build-config, conventions, dependencies]
sources: [gradle, agp, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
slug: gradle-hub
status: active
layer: L0
category: gradle
description: "Gradle category hub: KMP build configuration, convention plugins, dependency management. Supports AGP 8.x (Android-only) and AGP 9.0+ (KMP)."
version: 1
last_updated: "2026-03-18"
monitor_urls:
  - url: "https://github.com/gradle/gradle/releases"
    type: github-releases
    tier: 1
  - url: "https://github.com/JetBrains/kotlin/releases"
    type: github-releases
    tier: 1
    manifest_key: kotlin
  - url: "https://maven.google.com/web/index.html?q=com.android.tools.build#com.android.tools.build:gradle"
    type: maven-central
    tier: 1
    manifest_key: agp
  - url: "https://github.com/google/ksp/releases"
    type: github-releases
    tier: 1
    manifest_key: ksp
rules:
  - id: flat-module-names
    type: naming-convention
    message: "Module names must be flat kebab-case (core-json-api), not nested (core:json:api) -- AGP 9+ circular dependency bug. AGP 8.x projects are NOT affected."
    applies_to: [kmp, agp-9]
    detect:
      forbidden_pattern: ".*:.*:.*"
      prefer: "flat-kebab-case"
    hand_written: false

---

# Gradle

KMP and Android-only Gradle build configuration, convention plugins, and dependency management.

> **KMP (AGP 9.0+):** apply `KmpLibraryConventionPlugin`.  
> **Android-only (AGP 8.x):** apply `AndroidLibraryConventionPlugin` — no AGP migration required.

## Documents

| Document | Description |
|----------|-------------|
| [gradle-patterns](gradle-patterns.md) | Hub: version catalog, build config, platform detection |
| [gradle-patterns-conventions](gradle-patterns-conventions.md) | Convention plugins — KMP (AGP 9.0), Android-only (AGP 8.x), L0 toolkit distribution |
| [gradle-patterns-android-only](gradle-patterns-android-only.md) | AndroidLibraryConventionPlugin for AGP 8.x Android-only projects |
| [gradle-patterns-dependencies](gradle-patterns-dependencies.md) | Dependency management — version catalog, BOMs, transitive |
| [gradle-patterns-publishing](gradle-patterns-publishing.md) | Maven publishing — composite build, coordinates, signing |
| [gradle-patterns-agp9](gradle-patterns-agp9.md) | AGP 9.0+ module templates (`android create`), L0 post-processing, flat-module-names invariant |
| [dokka-markdown-plugin](dokka-markdown-plugin.md) | Dokka 2.2.x plugin — KDoc → `docs/api/*.md` with 14-field YAML frontmatter, content-hash drift detection |

## Key Rules

- **Flat module names** (`core-json-api` not `core:json:api`): AGP 9+ only — safe to ignore on AGP 8.x
- Version catalog (`libs.versions.toml`) as single source of truth
- `compileOnly` for optional Kotlin dependencies (e.g., `kotlinx.serialization`)
