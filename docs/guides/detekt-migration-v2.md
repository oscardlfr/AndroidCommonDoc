---
scope: [detekt, linting, migration, ktlint]
sources: [detekt]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
slug: detekt-migration-v2
status: active
layer: L0
parent: detekt-config
description: "Detekt 2.0 migration: plugin renames, property renames, config.validation, KMP baselines, ktlint wrapper"
category: guides
---

# Detekt 2.0 Migration Guide

Migration reference for projects upgrading from Detekt 1.x to 2.0. Covers plugin coordinates, ktlint wrapper, config.validation, property renames, and KMP per-source-set baselines.

---

## Formatting plugin rename

| Version | Dependency | YAML section |
|---------|-----------|-------------|
| 1.x | `io.gitlab.arturbosch.detekt:detekt-formatting:$v` | `formatting:` |
| 2.0 | `dev.detekt:detekt-rules-ktlint-wrapper:$v` | `ktlint:` |

### Detekt 1.x

```kotlin
detektPlugins("io.gitlab.arturbosch.detekt:detekt-formatting:$detektVersion")
```

```yaml
formatting:
  active: true
  android: true
  autoCorrect: true
  Indentation:
    active: true
    indentSize: 4
  TrailingCommaOnCallSite:
    active: true
  TrailingCommaOnDeclarationSite:
    active: true
  ImportOrdering:
    active: true
  NoTrailingSpaces:
    active: true
  NoConsecutiveBlankLines:
    active: true
  NoSemicolons:
    active: true
```

### Detekt 2.0

```kotlin
detektPlugins("dev.detekt:detekt-rules-ktlint-wrapper:$detektVersion")
```

```yaml
ktlint:
  active: true
  KtlintStandardIndentation:
    active: true
  KtlintStandardTrailingCommaOnCallSite:
    active: true
  KtlintStandardTrailingCommaOnDeclarationSite:
    active: true
  KtlintStandardImportOrdering:
    active: true
  KtlintStandardNoTrailingSpaces:
    active: true
  KtlintStandardNoConsecutiveBlankLines:
    active: true
  KtlintStandardNoSemicolons:
    active: true
```

> **Trap:** The `formatting:` section with 1.x rule names is **silently ignored** in Detekt 2.0 — no error, but no formatting rules run. Check your version before configuring.

### .editorconfig

Without `.editorconfig`, ktlint defaults to 2-space indent. Add at project root:

```ini
[*.{kt,kts}]
indent_size = 4
max_line_length = 120
```

---

## config.validation

Detekt 2.0 enables `config.validation: true` by default. Standard rules with 1.x property names cause a build failure.

The AndroidCommonDoc `detekt-l0-base.yml` only declares `AndroidCommonDoc:` rules — passes validation cleanly. For your `detekt.yml`:

```yaml
config:
  validation: true
  excludes: ['AndroidCommonDoc']   # suppress for custom rule set, keep for standard
```

### Property renames

Eight commonly-used properties were renamed. With `validation: false` these failed silently — the rule appeared active but had no effect.

| Rule | 1.x property | 2.0 property |
|------|-------------|-------------|
| `ForbiddenImport` | `imports` | `forbiddenImports` |
| `ForbiddenComment` | `values` | `comments` |
| `CognitiveComplexMethod` | `threshold` | `allowedComplexity` |
| `LongMethod` | `threshold` | `allowedLines` |
| `LongParameterList` | `functionThreshold` | `allowedFunctionParameters` |
| `NestedBlockDepth` | `threshold` | `allowedDepth` |
| `TooManyFunctions` | `thresholdInFiles` | `allowedOperationsInFiles` |
| `ComplexCondition` | `threshold` | `allowedOperations` |

Migration example:

```yaml
# 1.x
style:
  ForbiddenImport:
    imports:
      - value: 'kotlinx.coroutines.GlobalScope'
        reason: 'Use structured concurrency'
  ForbiddenComment:
    values: ['TODO:', 'FIXME:']

# 2.0
style:
  ForbiddenImport:
    forbiddenImports:
      - value: 'kotlinx.coroutines.GlobalScope'
        reason: 'Use structured concurrency'
  ForbiddenComment:
    comments: ['TODO:', 'FIXME:']
```

---

## KMP — baseline per source set

In Detekt 2.0 + KMP, per-source-set tasks (`detektCommonMainSourceSet`, `detektAndroidMainSourceSet`, etc.) each expect their own baseline XML:

```
detekt-baseline.xml                       # jvm/android modules
detekt-baseline-commonMainSourceSet.xml   # commonMain
detekt-baseline-androidMainSourceSet.xml  # androidMain
detekt-baseline-desktopMainSourceSet.xml  # desktopMain
```

Generate all source-set baselines:

```bash
./gradlew detektBaseline* --continue
```

In large KMP projects this can produce 100+ XML files — expected. Commit all of them.

> **Plugin note:** `androidcommondoc.toolkit` automatically maps each `Detekt` task to
> its correct per-source-set baseline and propagates `buildUponDefaultConfig`,
> L0+L1 config, and the rules JAR to all KMP source-set tasks via
> `tasks.withType(Detekt).configureEach`. No manual per-source-set configuration needed.

### Known limitation — Detekt 2.0-alpha.2

Standard rules (`style`, `complexity`) may not run on per-source-set tasks in Detekt 2.0-alpha.2 even with `buildUponDefaultConfig = true`. This appears to be a bug in the alpha. Custom L0 rules (AndroidCommonDoc JAR) and ktlint rules are unaffected. Track: [detekt/detekt](https://github.com/detekt/detekt/issues).
