---
scope: [detekt, linting, configuration]
sources: [detekt]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: guides-hub
slug: detekt-config
status: active
layer: L0
parent: guides-hub
description: "Detekt config hierarchy: L0 baseline + L1 override model, rule catalog, and setup guide"
category: guides
monitor_urls:
  - url: "https://github.com/detekt/detekt/releases"
    type: github-releases
    tier: 2
---

# Detekt Configuration Guide

Explains the L0/L1 config hierarchy, how to consume AndroidCommonDoc rules in a consumer project, and how to add or override rules.

---

## Config Hierarchy

AndroidCommonDoc ships two Detekt config files:

| File | Purpose |
|------|---------|
| `detekt-l0-base.yml` | Baseline — all rules `active: true`. Distributed with the toolkit. |
| `config.yml` | Example L1 override — disable or reconfigure individual rules. |

### How merging works

Detekt merges configs left to right with `--config a.yml,b.yml`. The **last file wins** per leaf key via `CompositeConfig(lookFirst=b, lookSecond=a)`.

```bash
# L1 project — inherit L0 baseline, override only what you need
./gradlew detekt --config ~/.androidcommondoc/detekt-l0-base.yml,detekt.yml
```

L1 `detekt.yml` only needs to declare the rules it wants to change:

```yaml
# detekt.yml — L1 overrides only
AndroidCommonDoc:
  NoHardcodedDispatchersRule:
    active: false   # disabled for legacy module in migration

  NoMagicNumbersInUseCaseRule:
    active: true
    excludes: ['**/legacy/**']
```

Rules not mentioned in the L1 file inherit L0 defaults (all `active: true`).

---

## Rule Catalog

All 13 rules shipped by AndroidCommonDoc. Hand-written rules are AST-only (no type resolution).

### State & Exposure

| Rule | Detects | Source doc |
|------|---------|-----------|
| `SealedUiStateRule` | `UiState` declared as `data class` instead of `sealed interface` | viewmodel-state-management-sealed.md |
| `MutableStateFlowExposedRule` | `public val` of type `MutableStateFlow` in a `ViewModel` | viewmodel-state-management-stateflow.md |
| `WhileSubscribedTimeoutRule` | `stateIn` without `WhileSubscribed(5_000)` timeout | viewmodel-state-management-stateflow.md |

### ViewModel Boundaries

| Rule | Detects | Source doc |
|------|---------|-----------|
| `NoPlatformDepsInViewModelRule` | `android.content`, `UIKit`, `java.io.File` imports in ViewModel | viewmodel-state-management.md |
| `NoHardcodedStringsInViewModelRule` | String literals in ViewModel (use `StringResource`/`DynamicString`) | viewmodel-state-management.md |
| `NoHardcodedDispatchersRule` | `Dispatchers.IO/Main/Default` hardcoded in ViewModel or UseCase | testing-patterns-coroutines.md |

### Coroutine Safety

| Rule | Detects | Source doc |
|------|---------|-----------|
| `CancellationExceptionRethrowRule` | `catch(e: CancellationException)` without rethrow | error-handling-exceptions.md |
| `NoRunCatchingInCoroutineScopeRule` | `runCatching` inside coroutine scope (swallows `CancellationException`) | error-handling-exceptions.md |
| `NoSilentCatchRule` | `catch(Exception)` or `catch(Throwable)` without rethrowing or logging | error-handling-exceptions.md |
| `NoLaunchInInitRule` | `launch { }` inside `init { }` block (race condition risk) | testing-hub.md |

### Architecture Guards

| Rule | Detects | Source doc |
|------|---------|-----------|
| `NoChannelForUiEventsRule` | `Channel` used for UI events in ViewModel (use `SharedFlow`) | viewmodel-events.md |
| `NoChannelForNavigationRule` | `Channel` used for navigation events in ViewModel | navigation-patterns.md |
| `NoMagicNumbersInUseCaseRule` | Numeric literals in UseCase body (extract as named constants) | error-handling-result.md |

---

## Generating the Baseline

The baseline is generated automatically from frontmatter `rules:` sections via the MCP tool:

```bash
# In mcp-server/
npx ts-node src/generation/config-emitter.ts > ../detekt-rules/src/main/resources/config/detekt-l0-base.yml
```

Or via the `/generate-rules` Claude Code command — it shows a dry-run preview before writing.

---

## Adding a New Rule

1. Add `rules:` entry to the relevant pattern doc frontmatter with `hand_written: true` and `source_rule: YourRuleName.kt`.
2. Create `detekt-rules/src/main/kotlin/.../rules/YourRuleName.kt` — extend `Rule`, override `visitXxx`.
3. Create the companion test in `detekt-rules/src/test/kotlin/.../rules/YourRuleNameTest.kt`.
4. Register in `AndroidCommonDocRuleSetProvider.kt`.
5. Run `./gradlew :detekt-rules:test` — must be 100% green.
6. Re-run `/generate-rules` to regenerate `detekt-l0-base.yml` with the new rule included.

### AST-only constraint

All rules must work without type resolution (no `bindingContext`). This avoids [Detekt #8882](https://github.com/detekt/detekt/issues/8882) and keeps analysis fast. Use PSI visitor methods (`visitNamedFunction`, `visitClass`, `visitCallExpression`, etc.) only.

---

## Formatting Rules (detekt-formatting / ktlint)

Detekt ships a `detekt-formatting` plugin (1.x) / `detekt-rules-ktlint-wrapper` (2.0) that wraps ktlint rules. It covers indentation, trailing commas, import ordering, trailing whitespace, no semicolons, parameter wrapping.

**AndroidCommonDoc ships with `formattingRules = false` by default.** Enabling formatting rules in a legacy project typically produces 300+ violations that bury architecture issues. Enable it deliberately once the architecture baseline is clean.

For setup steps, YAML config examples, and Detekt 2.0 plugin/property renames, see:
**[docs/guides/detekt-migration-v2.md](detekt-migration-v2.md)**

---

## KMP — baseline per source set

In KMP projects, Detekt runs a separate task per source set. Each task expects its own baseline XML:

```
detekt-baseline.xml                       # jvm/android modules
detekt-baseline-commonMainSourceSet.xml   # commonMain
detekt-baseline-androidMainSourceSet.xml  # androidMain
```

Generate all at once:

```bash
./gradlew detektBaseline* --continue
```

In large KMP projects this can generate 100+ XML files — expected. Commit all of them. The `/setup` skill runs this automatically as Step 2.5.

> **Plugin note:** `androidcommondoc.toolkit` automatically maps each Detekt task to
> its correct per-source-set baseline and propagates config to all KMP source-set tasks
> via `tasks.withType(Detekt).configureEach`. See [detekt-migration-v2.md](detekt-migration-v2.md)
> for known limitations with Detekt 2.0-alpha.2.
