---
scope: [build, gradle, coverage, kover]
sources: [kover, gradle]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: gradle-hub
token_budget: 1237
monitor_urls:
  - url: "https://github.com/gradle/gradle/releases"
    type: github-releases
    tier: 1
description: "Kover coverage configuration: setup, verification rules, task reference, integration with coverage skills (slug is 'publishing' for historical reasons -- content covers Kover coverage)"
slug: gradle-patterns-publishing
status: active
layer: L0
parent: gradle-patterns
category: gradle
rules:
  - id: flat-module-names
    type: naming-convention
    message: "Module names must be flat kebab-case (core-json-api), not nested (core:json:api) -- AGP 9+ bug"
    detect:
      forbidden_pattern: ".*:.*:.*"
      prefer: "flat-kebab-case"
    hand_written: false

---

# Kover Coverage Configuration

## Overview

Kover is the code coverage tool for Kotlin Multiplatform. It instruments JVM bytecode and generates XML/HTML reports consumed by the `/coverage` and `/coverage-full` skills.

**Core Principle**: Configure Kover once in convention plugins. Use `createVariant("combined")` to merge Android + Desktop coverage into a single report.

---

## 1. Version Catalog Entry

```toml
# libs.versions.toml (shared library is the version source of truth)
[versions]
kover = "0.9.1"

[plugins]
kover = { id = "org.jetbrains.kotlinx.kover", version.ref = "kover" }
```

## 2. Root build.gradle.kts

```kotlin
plugins {
    alias(libs.plugins.kover) apply false
}

subprojects {
    apply(plugin = "org.jetbrains.kotlinx.kover")
}

kover {
    reports {
        filters {
            excludes {
                classes(
                    "*ComposableSingletons*",
                    "*_Factory",
                    "*_HiltModules*",
                    "*BuildConfig",
                    "*_Impl",
                )
                packages(
                    "*.di",
                    "*.theme",
                    "*.navigation",
                )
            }
        }
    }
}
```

## 3. Module-Level Configuration (Convention Plugin)

```kotlin
class KmpLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlinx.kover")

            extensions.configure<KoverProjectExtension> {
                currentProject {
                    createVariant("combined") {
                        addWithDependencies("debug")  // Android
                        addWithDependencies("desktop") // Desktop JVM
                    }
                }
            }
        }
    }
}
```

## 4. Verification Rules

```kotlin
kover {
    reports {
        verify {
            rule("line-coverage") {
                minBound(80)
            }
            rule("branch-coverage") {
                entity = GroupingEntityType.APPLICATION
                minBound(70, aggregationForGroup = AggregationType.COVERED_PERCENTAGE,
                         coverageUnits = CoverageUnit.BRANCH)
            }
        }
    }
}
```

## 5. Gradle Tasks Reference

| Task | Description | Output |
|------|-------------|--------|
| `koverXmlReportDebug` | Generate XML report (Android debug) | `build/reports/kover/reportDebug.xml` |
| `koverXmlReportDesktop` | Generate XML report (Desktop JVM) | `build/reports/kover/reportDesktop.xml` |
| `koverHtmlReportDebug` | Generate HTML report (browsable) | `build/reports/kover/htmlDebug/` |
| `koverVerify` | Enforce coverage thresholds | Fails build if below minimum |
| `koverLog` | Print coverage to stdout | Console output |

## 6. Report Output Structure

```
module/build/reports/kover/
  reportDebug.xml        # Android variant
  reportDesktop.xml      # Desktop variant
  report.xml             # Fallback name (KMP single-target)
  htmlDebug/
      index.html         # Browsable HTML report
  htmlDesktop/
      index.html
```

The coverage scripts (`run-parallel-coverage-suite`) auto-detect XML reports in this order:
1. `reportDesktop.xml` (if Desktop target)
2. `reportDebug.xml` (if Android target)
3. `report.xml` (fallback)
4. Any `*.xml` in the kover directory

## 7. Integration with Coverage Skills

```
/test-full  -->  gradlew test + koverXml  -->  Kover XML reports
                                                      |
/coverage   -->  run-parallel-coverage    <-----------+
/coverage-full   --skip-tests
                      |
                 coverage-full-report.md
```

**Workflow:**
1. Run tests with Kover instrumentation: `/test-full` or `./gradlew test koverXmlReportDebug`
2. Analyze coverage from existing reports: `/coverage` (gaps only) or `/coverage-full` (complete)
3. Auto-generate tests for gaps: `/auto-cover`

## 8. Configuration via .test-config.json

```json
{
  "coverageThresholds": {
    "minimum": 70,
    "target": 90
  }
}
```

## 9. KMP-Specific Considerations

- **commonMain code** is covered when tests run on any target (JVM, Android, Desktop)
- **Platform-specific code** (androidMain, desktopMain) requires tests on that platform
- Use `createVariant("combined")` to merge coverage across Android + Desktop in a single report
- For composite builds (shared library), use `/coverage-full --include-shared` to aggregate

---

**Parent doc**: [gradle-patterns.md](gradle-patterns.md)
