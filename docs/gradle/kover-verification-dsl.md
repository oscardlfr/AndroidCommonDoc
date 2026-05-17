---
scope: [gradle, kover, coverage, verification]
sources: [webfetch:kotlinx-kover@2026-05-17, as-built:shared-kmp-libs@2026-05-17]
targets: [android, desktop, jvm]
slug: kover-verification-dsl
status: active
layer: L0
category: gradle
description: "Kover 0.8.x+ verification rule DSL: CoverageUnit (replaces MetricType), minBound overloads, verify rule filter shape. Anti-pattern: MetricType.LINE (compile error in 0.9.x)."
version: 1
last_updated: "2026-05-17"
assumes_read: gradle-patterns-publishing
---

# Kover Verification DSL (0.8.x+)

Addendum to [gradle-patterns-publishing](gradle-patterns-publishing.md), which covers Kover auto-application and task reference. This doc focuses on the verify DSL shape and the breaking rename in 0.8.x+.

---

## CRITICAL: MetricType Does Not Exist in Kover 0.8.x+

```kotlin
// COMPILE ERROR in Kover 0.8.x+ (0.9.x included):
minBound(80, coverageUnits = kotlinx.kover.gradle.plugin.dsl.MetricType.LINE)
//                                                                   ^^^^^^^^^^
// error: unresolved reference: MetricType
```

**`MetricType` was renamed to `CoverageUnit` in Kover 0.8.0.** Any code referencing `MetricType` will fail to compile against Kover 0.9.x.

**Correct import:**
```kotlin
import kotlinx.kover.gradle.plugin.dsl.CoverageUnit  // LINE, INSTRUCTION, BRANCH
import kotlinx.kover.gradle.plugin.dsl.AggregationType
```

---

## minBound Overloads

Three overloads — single-arg is the common case:

```kotlin
// Overload 1: defaults to CoverageUnit.LINE + AggregationType.COVERED_PERCENTAGE
minBound(80)

// Overload 2: full explicit
minBound(
    minValue = 80,
    coverageUnits = CoverageUnit.LINE,
    aggregationForGroup = AggregationType.COVERED_PERCENTAGE,
)

// Overload 3: lazy provider (useful for reading threshold from .test-config.json)
minBound(provider { 80 })
```

---

## Verify Rule DSL Shape

```kotlin
kover {
    reports {
        verify {
            rule("line-coverage") {
                minBound(80)
            }
            rule("branch-coverage") {
                minBound(
                    minValue = 70,
                    coverageUnits = CoverageUnit.BRANCH,
                    aggregationForGroup = AggregationType.COVERED_PERCENTAGE,
                )
            }
        }
    }
}
```

**Important:** `filters {}` is a sibling of `verify {}` on `KoverReportsConfig`, **not** a child of `rule {}`. `KoverVerifyRule` has no `filters` member.

```kotlin
// WRONG — filters does not exist on KoverVerifyRule:
kover { reports { verify { rule("x") { filters { ... } } } } }

// CORRECT — filters is on reports { }, not on rule { }:
kover {
    reports {
        filters {
            excludes { classes("*BuildConfig", "*_Impl") }
        }
        verify {
            rule("x") { minBound(80) }
        }
    }
}
```

---

## Per-Class Coverage Floor (includes + excludes in filters)

```kotlin
kover {
    reports {
        filters {
            includes { classes("com.grinx.shared.core.encryption.*") }
            excludes { classes("*BuildConfig", "*ComposableSingletons*") }
        }
        verify {
            rule("encryption-coverage") {
                minBound(85)
            }
        }
    }
}
```

---

## CoverageUnit Enum Values

| Value | Meaning |
|-------|---------|
| `CoverageUnit.LINE` | Line coverage (default) |
| `CoverageUnit.INSTRUCTION` | JVM bytecode instruction coverage |
| `CoverageUnit.BRANCH` | Branch coverage (if/when paths) |

---

## Wave 3a Canonical Example

`core-encryption/build.gradle.kts` and `core-security-keys/build.gradle.kts` in `shared-kmp-libs` (PR #57, `bf694f16`) use 80%/85% floors with `minBound(Int)` single-arg form.

---

**See also:** [gradle-patterns-publishing](gradle-patterns-publishing.md) — Kover auto-application via convention plugin, task reference, `createVariant("combined")` for Android+Desktop merge.
