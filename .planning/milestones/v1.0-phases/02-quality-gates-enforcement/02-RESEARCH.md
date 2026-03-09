# Phase 2: Quality Gates and Enforcement - Research

**Researched:** 2026-03-13
**Domain:** Static analysis (Detekt custom rules), quality gate agents, script parity testing, doc freshness tracking
**Confidence:** MEDIUM (Detekt version situation requires careful navigation; other areas HIGH)

## Summary

Phase 2 covers five workstreams: (1) custom Detekt rules enforcing 5 architecture patterns, (2) Compose Rules integration, (3) quality gate agent implementation, (4) doc freshness / version drift detection, and (5) script parity testing with token cost measurement.

The most consequential research finding is a **Detekt version compatibility blocker**: the project pins Kotlin 2.3.10, but Detekt 1.23.8 cannot parse Kotlin 2.3.x metadata (issue #8865 -- closed as "not planned"). The REQUIREMENTS.md states "Target 1.23.8 stable; migrate when Kotlin 2.3+ is mainstream," but Kotlin 2.3.10 IS already mainstream in this project. The only viable path is **Detekt 2.0.0-alpha.2**, which supports Kotlin 2.3.0 and AGP 9.0.0. This also means compose-rules must use version 0.5.6 (targets Detekt 2.0.0-alpha.2), not 0.4.28 (last Detekt 1.x-compatible version). The alpha status is acceptable because: (a) custom rules use AST-only analysis (no type resolution), minimizing exposure to alpha instability; (b) the custom rule API (`Rule`, `RuleSetProvider`, visitor pattern) is stable between 1.x and 2.x; (c) the alternative is no Detekt at all.

The remaining workstreams (quality gate agents, freshness tracking, script parity, token cost) are straightforward -- they build on Phase 1 assets (agent specs, params.json, SKILL.md files) using file parsing and comparison, with no external dependencies beyond what already exists.

**Primary recommendation:** Use Detekt 2.0.0-alpha.2 with AST-only custom rules (no type resolution), ship all 5 architecture rules with `error` severity, distribute as standalone JAR via `detektPlugins`, and use compose-rules 0.5.6 alongside.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- All 5 architecture patterns enforced: sealed UiState, CancellationException rethrow, no platform deps in ViewModels, WhileSubscribed(5000) timeout, no Channel for UI events
- All 5 ship in v1 -- enforcement matches what docs already promise
- Quality gates remain as Claude Code agents in `.claude/agents/`
- Both unified orchestrator AND individual gate invocation
- Unified report format: structured markdown text with sections per gate, pass/fail per check, overall status
- Cross-surface semantic drift detection (QUAL-02) folded into existing template-sync-validator agent
- Version manifest comparison approach for freshness tracking -- deterministic, no network needed
- Both agent (doc-code-drift-detector) AND lightweight script pair (PS1/SH for CI quick-check)
- Script parity testing (SCRP-03): static analysis -- parse PS1 param blocks and SH getopts/case
- Token cost data included as section in unified quality gate report -- computed on each run
- All 18 skills measured for token cost

### Claude's Discretion
- Detekt rule severity defaults (error vs warning per rule)
- Detekt rule distribution mechanism (standalone JAR, convention plugin, or hybrid)
- Compose Rules 0.5.6 integration approach with Detekt
- Deprecated API detection scope (versions only vs versions + APIs)
- Token cost metric definition and baseline comparison approach
- Quality gate agent internal implementation details
- Script parity test framework and output format

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PTRN-03 | Automated freshness tracking detects stale version references and deprecated API usage in docs | Version manifest approach; 8 docs with "Library Versions" headers; deterministic comparison against canonical versions |
| SCRP-03 | Automated parity test suite verifies PS1 and SH scripts produce identical behavior for same inputs | Static analysis of PS1 `param()` blocks vs SH `getopts`/`case`; params.json as canonical reference; 12 script pairs identified |
| LINT-01 | Custom Detekt rule set enforces top 5 architecture patterns | Detekt 2.0.0-alpha.2 with AST-only rules; all 5 patterns implementable without type resolution |
| LINT-03 | Compose Rules (mrmans0n 0.5.6) integrated for Compose-specific lint enforcement | compose-rules 0.5.6 targets Detekt 2.0.0-alpha.2; add via `detektPlugins`; 30+ Compose-specific rules |
| QUAL-01 | Quality gate agents validate internal consistency | 4 agent specs already defined; implement against existing output formats; unified orchestrator aggregates results |
| QUAL-02 | Automated cross-surface parameter drift detection | Folded into template-sync-validator agent; compare Claude commands vs Copilot prompts vs params.json |
| QUAL-03 | Token cost measurement per skill validates efficiency claims with actual data | 18 SKILL.md files; measure definition size (prompt + response tokens via token counting) |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Detekt | 2.0.0-alpha.2 | Static analysis framework for custom rules | Only version supporting Kotlin 2.3.x; 1.23.8 cannot parse 2.3.x metadata (#8865) |
| compose-rules | 0.5.6 | Compose-specific lint rules for Detekt | Targets Detekt 2.0.0-alpha.2; 30+ Compose rules; latest stable release |
| Kotlin | 2.3.10 | Language for custom rule implementation | Project standard from CLAUDE.md |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| detekt-test | 2.0.0-alpha.2 | Testing harness for custom Detekt rules | Unit testing each rule with `lint()` extension |
| detekt-api | 2.0.0-alpha.2 | API for extending Detekt (compileOnly) | Writing RuleSetProvider and Rule implementations |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Detekt 2.0.0-alpha.2 | Detekt 1.23.8 | Incompatible with Kotlin 2.3.10 -- metadata parse failures |
| compose-rules 0.5.6 | compose-rules 0.4.28 | 0.4.28 targets Detekt 1.x which is incompatible with Kotlin 2.3.10 |
| Detekt Gradle plugin | Detekt Compiler plugin | Compiler plugin runs during compilation (faster for type resolution), but alpha and experimental; Gradle plugin is more established even in 2.0 alpha |
| AST-only rules | Type-resolution rules | Type resolution triggers compilation of all Android variants in KMP monorepos (#8882: 24min vs 1min); AST-only avoids this entirely |

**Installation (for consuming projects):**
```kotlin
// build.gradle.kts (convention plugin or project-level)
plugins {
    id("dev.detekt") version "2.0.0-alpha.2"
}

dependencies {
    detektPlugins("io.nlopez.compose.rules:detekt:0.5.6")
    detektPlugins("com.example:androidcommondoc-detekt-rules:1.0.0") // custom rule JAR
}
```

**CRITICAL VERSION NOTE:** The REQUIREMENTS.md Out of Scope table says "Target 1.23.8 stable; migrate when Kotlin 2.3+ is mainstream." This is now overridden by reality -- the project already uses Kotlin 2.3.10, and Detekt 1.23.8 crashes on 2.3.x metadata. Detekt 2.0.0-alpha.2 is the minimum viable version.

## Architecture Patterns

### Recommended Project Structure for Custom Rules

```
detekt-rules/
├── build.gradle.kts              # Pure Kotlin module, detekt-api compileOnly
├── src/
│   ├── main/
│   │   ├── kotlin/
│   │   │   └── com/androidcommondoc/detekt/
│   │   │       ├── AndroidCommonDocRuleSetProvider.kt
│   │   │       └── rules/
│   │   │           ├── SealedUiStateRule.kt
│   │   │           ├── CancellationExceptionRethrowRule.kt
│   │   │           ├── NoPlatformDepsInViewModelRule.kt
│   │   │           ├── WhileSubscribedTimeoutRule.kt
│   │   │           └── NoChannelForUiEventsRule.kt
│   │   └── resources/
│   │       ├── META-INF/services/
│   │       │   └── dev.detekt.api.RuleSetProvider
│   │       └── config/
│   │           └── config.yml     # Default config (all rules active:true, severity:error)
│   └── test/
│       └── kotlin/
│           └── com/androidcommondoc/detekt/rules/
│               ├── SealedUiStateRuleTest.kt
│               ├── CancellationExceptionRethrowRuleTest.kt
│               ├── NoPlatformDepsInViewModelRuleTest.kt
│               ├── WhileSubscribedTimeoutRuleTest.kt
│               └── NoChannelForUiEventsRuleTest.kt
```

### Quality Gate Agent Structure

```
.claude/agents/
├── doc-code-drift-detector.md        # Existing spec (implement body)
├── script-parity-validator.md        # Existing spec (implement body)
├── skill-script-alignment.md         # Existing spec (implement body)
├── template-sync-validator.md        # Existing spec (add QUAL-02 cross-surface checks)
└── quality-gate-orchestrator.md      # NEW: unified orchestrator calling all 4

scripts/ps1/
├── check-doc-freshness.ps1           # Lightweight CI freshness check
scripts/sh/
├── check-doc-freshness.sh            # Matching SH pair
```

### Pattern 1: AST-Only Detekt Rule (No Type Resolution)

**What:** Custom rules that analyze code structure using Kotlin PSI (AST) without needing compiled type information.
**When to use:** Always for this project -- avoids the #8882 performance regression (24 min -> 1 min).
**Why it works for all 5 rules:** All 5 patterns can be detected structurally:

| Rule | AST Detection Strategy | Type Resolution Needed? |
|------|----------------------|------------------------|
| Sealed UiState | `visitClass()`: check classes named `*UiState` for `sealed` modifier | NO -- modifier is in syntax |
| CancellationException rethrow | `visitCatchSection()`: check catch clauses catching `CancellationException` for `throw` statement | NO -- exception name is textual |
| No platform deps in ViewModel | `visitImportDirective()`: flag `android.*`, `java.*`, `UIKit` imports in files containing `: ViewModel()` | NO -- imports are text |
| WhileSubscribed timeout | `visitCallExpression()`: find `stateIn()` calls, check for `WhileSubscribed(5000)` or `WhileSubscribed(5_000)` | NO -- literal text match |
| No Channel for UI events | `visitProperty()` + `visitImportDirective()`: flag `Channel` type usage in ViewModel classes, recommend `MutableSharedFlow` | NO -- import + text match |

**Example:**
```kotlin
// Source: Detekt extensions docs + AST visitor pattern
class SealedUiStateRule(config: Config) : Rule(config, "UiState must be a sealed interface") {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)
        val name = klass.name ?: return
        if (name.endsWith("UiState") && !klass.isSealed()) {
            report(
                Finding(
                    Entity.from(klass),
                    "UiState class '$name' must be a sealed interface, not a ${klass.getClassOrInterfaceKeyword()?.text ?: "class"}"
                )
            )
        }
    }
}
```

### Pattern 2: Version Manifest for Freshness Tracking

**What:** A JSON/YAML file mapping library names to current versions, compared against version strings in doc headers.
**When to use:** For deterministic, offline freshness detection (no network calls needed).

```json
// versions-manifest.json (derived from shared-kmp-libs catalog)
{
  "versions": {
    "kotlin": "2.3.10",
    "agp": "9.0.0",
    "compose-multiplatform": "1.7.x",
    "koin": "4.1.1",
    "kotlinx-coroutines": "1.10.2",
    "kover": "0.9.1",
    "compose-gradle-plugin": "1.10.0"
  }
}
```

The freshness check greps each `docs/*.md` for `> **Library Versions**:` lines, extracts version numbers, and compares against the manifest. Mismatches produce structured findings.

### Pattern 3: Static Script Parity Analysis

**What:** Parse PS1 `param()` blocks and SH `getopts`/`case` statements to extract parameter sets, then compare.
**When to use:** For SCRP-03 script parity validation without executing scripts.

The approach:
1. Read `skills/params.json` as the canonical parameter source
2. For each script pair, extract accepted parameters from source text
3. Compare: params.json expected parameters vs PS1 actual vs SH actual
4. Report mismatches per pair

### Anti-Patterns to Avoid

- **Type-resolution rules in KMP:** Issue #8882 causes 24x performance regression. All custom rules MUST use AST-only analysis.
- **Detekt 1.23.8 with Kotlin 2.3.x:** Crashes with metadata version mismatch. Do not attempt.
- **`detektAll` task in KMP monorepos:** Triggers compilation of all Android variants even for commonMain-only modules. Use source-set-specific tasks or the compiler plugin.
- **Executing scripts for parity testing:** Decision says static analysis only. Script execution introduces environment dependencies and flakiness.
- **Building version checks that require network:** Manifest approach was explicitly decided. No API calls to Maven Central or version catalogs at runtime.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Compose lint rules | Custom Compose checks | compose-rules 0.5.6 via `detektPlugins` | 30+ battle-tested rules covering naming, modifiers, state, previews |
| Detekt rule testing | Custom test harness | `detekt-test` `lint()` extension | Handles AST compilation, finding extraction, assertion helpers |
| Detekt ServiceLoader registration | Manual class loading | `META-INF/services/dev.detekt.api.RuleSetProvider` file | Standard Java ServiceLoader pattern; Detekt discovers rules automatically |
| Token counting | Custom tokenizer | Character/word heuristics or tiktoken approximation | Exact token counts require model-specific tokenizers; approximation (chars/4) is standard practice |
| PS1 parameter extraction | Regex from scratch | Parse `[CmdletBinding()]` + `param()` blocks | Well-defined PowerShell syntax; established parsing patterns |

**Key insight:** The custom Detekt rules are the only genuinely new code in this phase. Everything else is agent implementation (text parsing/comparison) building on Phase 1 specs.

## Common Pitfalls

### Pitfall 1: Detekt 2.0 Package Migration
**What goes wrong:** Custom rules import `io.gitlab.arturbosch.detekt.api.*` (1.x) but Detekt 2.0 moved everything to `dev.detekt.api.*`.
**Why it happens:** Most tutorials and StackOverflow answers reference the old 1.x package names.
**How to avoid:** All imports must use `dev.detekt.*` namespace. The `META-INF/services` file must reference `dev.detekt.api.RuleSetProvider`, not the old path.
**Warning signs:** `ClassNotFoundException` or `ServiceLoader` failures at runtime.

### Pitfall 2: Rules Disabled by Default
**What goes wrong:** Custom rules are added to a project but have no effect.
**Why it happens:** Detekt disables all custom rules by default. Without explicit `active: true` in configuration, they are silently ignored.
**How to avoid:** Ship a `config.yml` in the JAR's `resources/config/` directory with all rules set to `active: true`. Also document that consuming projects need a `Compose:` section for compose-rules.
**Warning signs:** Zero findings from custom rules despite known violations in test code.

### Pitfall 3: KMP Type Resolution Performance (#8882)
**What goes wrong:** Detekt analysis takes 24 minutes instead of 1 minute.
**Why it happens:** Type-resolution-enabled tasks compile all Android variants in KMP monorepos, including for modules with only commonMain.
**How to avoid:** Design ALL custom rules to use AST-only analysis (no `@RequiresTypeResolution` / `RequiresAnalysisApi`). This was explicitly called out as a research blocker in STATE.md.
**Warning signs:** `detektAll` triggering `compile*Kotlin` tasks for every Android variant.

### Pitfall 4: Detekt 2.0 API Breaking Changes
**What goes wrong:** Code written against tutorial examples fails to compile.
**Why it happens:** Detekt 2.0 changed `Issue` to `Finding2` (later renamed), removed `Severity` enum, changed `RuleSet` to factory pattern, made `Config` mandatory in constructors.
**How to avoid:** Reference the official 2.0.0-alpha.0 extensions docs, not 1.x tutorials. Use the `detekt-custom-rule-template` repo as starting point.
**Warning signs:** Compilation errors on `Issue`, `Severity`, or `RuleSet` classes.

### Pitfall 5: Agent Spec Output Format Mismatch
**What goes wrong:** Quality gate agent produces output that doesn't match the spec in `.claude/agents/`.
**Why it happens:** Implementation diverges from the detailed output format already defined in the agent spec files.
**How to avoid:** The 4 agent specs in `.claude/agents/` already define exact output formats (e.g., `[GAP]`, `[DRIFT]`, `[OK]`, `[MISMATCH]` prefixes). Implementation must match these verbatim.
**Warning signs:** Unified orchestrator can't parse individual gate results.

### Pitfall 6: Version String Matching Edge Cases
**What goes wrong:** Freshness check misses version references or produces false positives.
**Why it happens:** Version strings appear in various formats: `1.7.x` (wildcard), `1.10.2` (exact), `2.3.10` (exact), and some docs use ranges.
**How to avoid:** The manifest should support both exact versions and wildcards. Pattern matching must handle `x` as "any patch" and compare major.minor only for wildcard entries.
**Warning signs:** False positives on `Compose 1.7.x` when manifest says `1.7.3`.

## Code Examples

### Detekt 2.0 RuleSetProvider (verified pattern from official docs)

```kotlin
// Source: https://detekt.dev/docs/2.0.0-alpha.0/introduction/extensions/
package com.androidcommondoc.detekt

import dev.detekt.api.Config
import dev.detekt.api.RuleSet
import dev.detekt.api.RuleSetProvider

class AndroidCommonDocRuleSetProvider : RuleSetProvider {
    override val ruleSetId = RuleSet.Id("AndroidCommonDoc")

    override fun instance(config: Config): RuleSet = RuleSet(
        ruleSetId,
        listOf(
            ::SealedUiStateRule,
            ::CancellationExceptionRethrowRule,
            ::NoPlatformDepsInViewModelRule,
            ::WhileSubscribedTimeoutRule,
            ::NoChannelForUiEventsRule,
        )
    )
}
```

### CancellationException Rethrow Rule (AST-only)

```kotlin
// Pattern: visitCatchSection to find catch(e: CancellationException) without rethrow
class CancellationExceptionRethrowRule(config: Config) : Rule(
    config,
    "CancellationException must always be rethrown in catch blocks"
) {
    override fun visitCatchSection(catchClause: KtCatchClause) {
        super.visitCatchSection(catchClause)
        val caughtType = catchClause.catchParameter?.typeReference?.text ?: return

        // Check for CancellationException or bare Exception/Throwable (which catches it)
        if (caughtType in listOf("CancellationException", "Exception", "Throwable")) {
            val body = catchClause.catchBody ?: return
            val hasRethrow = body.children.any { child ->
                child is KtThrowExpression ||
                child.text.contains("throw") // simplified; real impl walks deeper
            }
            if (!hasRethrow && caughtType == "CancellationException") {
                report(Finding(Entity.from(catchClause), "CancellationException caught but not rethrown"))
            }
        }
    }
}
```

### Detekt Rule Test (using detekt-test)

```kotlin
// Source: https://detekt.dev/docs/2.0.0-alpha.0/introduction/extensions/
class SealedUiStateRuleTest {
    private val rule = SealedUiStateRule(Config.empty)

    @Test
    fun `reports non-sealed UiState`() {
        val code = """
            data class HomeUiState(val isLoading: Boolean)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("sealed interface")
    }

    @Test
    fun `accepts sealed interface UiState`() {
        val code = """
            sealed interface HomeUiState {
                data object Loading : HomeUiState
                data class Success(val items: List<String>) : HomeUiState
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
```

### Quality Gate Unified Report Format

```markdown
# Quality Gate Report

**Run:** 2026-03-13T14:30:00Z
**Status:** FAIL (2 gates failed)

## Script Parity
**Status:** PASS
PAIRING: 12/12 pairs matched
FLAGS: 45/45 parameters aligned
EXIT CODES: All consistent
OVERALL: 0 mismatches, 0 missing pairs, 12 clean pairs

## Skill-Script Alignment
**Status:** PASS
MAPPING: 16/16 commands mapped
FLAGS: All aligned
OVERALL: 0 broken, 0 drifted, 16 aligned

## Template Sync (includes Cross-Surface Drift)
**Status:** FAIL
COVERAGE: 1 missing copilot prompt
CROSS-SURFACE: 2 parameter name mismatches between Claude/Copilot
OVERALL: 1 missing, 2 drifted, 0 orphaned, 14 clean

## Doc-Code Drift
**Status:** FAIL
VERSIONS: 1 stale reference (AGP 8.x in gradle-patterns.md)
VALIDATION GAPS: 0
OVERALL: 0 gaps, 0 drifts, 1 stale, 7 clean

## Token Cost Summary
| Skill | Definition Tokens (approx) | Params | Implementation Lines |
|-------|---------------------------|--------|---------------------|
| test | 450 | 5 | 42 |
| coverage | 380 | 4 | 38 |
| ... | ... | ... | ... |
**Total across 18 skills:** ~7,200 tokens

## Overall
**FAIL** -- 2/5 gates failed. Fix template sync and doc freshness issues.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Detekt 1.23.8 stable | Detekt 2.0.0-alpha.2 | Dec 2024 (alpha.0) | Required for Kotlin 2.3.x; new package namespace `dev.detekt.*` |
| `io.gitlab.arturbosch.detekt` packages | `dev.detekt` packages | Detekt 2.0 | All imports, ServiceLoader files, Gradle plugin IDs changed |
| compose-rules 0.4.x (Detekt 1.x) | compose-rules 0.5.6 (Detekt 2.x) | Dec 2024 (0.5.0) | Incompatible with Detekt 1.x; required for Detekt 2.0 |
| Type resolution for semantic analysis | AST-only for KMP projects | Ongoing (#8882) | Type resolution causes 24x performance regression in KMP monorepos |
| `Issue` class for findings | `Finding` (simplified) in Detekt 2.0 | Detekt 2.0 | `Severity` enum removed; findings simplified |
| `RuleSet` with direct instances | `RuleSet` with rule factories | Detekt 2.0 | Constructor lambdas instead of instantiated rules |

**Deprecated/outdated:**
- Detekt 1.23.8: Cannot parse Kotlin 2.3.x metadata. Closed as "not planned" (#8865).
- `io.gitlab.arturbosch.detekt` Maven coordinates: Replaced by `dev.detekt` in 2.0.
- compose-rules 0.4.x: Only works with Detekt 1.x.

## Discretion Recommendations

### Detekt Rule Severity: ALL `error` (not `warning`)

**Rationale:** These rules enforce patterns the docs explicitly promise. A consuming project that adds the rule JAR should get build failures, not ignorable warnings. The success criteria specifically say "build failures for non-sealed UiState" etc. Individual projects can downgrade to `warning` in their `detekt.yml` if needed.

### Distribution: Standalone JAR via `detektPlugins`

**Rationale:** Convention plugin (LINT-02) is Phase 3 scope. For Phase 2, a standalone JAR is simpler and independently testable. The JAR lives in this project (AndroidCommonDoc) as a `detekt-rules/` module. Consuming projects add it via `detektPlugins("...")`. This also avoids coupling rule distribution to build-logic/ changes.

### Compose Rules Integration: Add via `detektPlugins` alongside custom rules

**Rationale:** Both compose-rules 0.5.6 and the custom rule JAR use the same `detektPlugins` mechanism. No conflicts -- they register as separate `RuleSetProvider`s. Consuming projects add both dependencies. A shared `detekt.yml` snippet (shipped with docs) enables both.

### Deprecated API Detection: Version numbers only (not code sample API usage)

**Rationale:** API deprecation detection across code samples would require type resolution or AST parsing of example code blocks (which are markdown fences, not compiled Kotlin). Version number comparison is deterministic and covers the primary freshness concern. API usage validation is better handled by the existing `/validate-patterns` skill.

### Token Cost Metric: Definition size in characters / 4 (approximate tokens)

**Rationale:** Exact token counts require model-specific tokenizers (tiktoken for Claude, etc.). The `chars/4` heuristic is the industry standard approximation. Measure: SKILL.md full content size, implementation block sizes (PS1 + SH), and params from params.json. Report as "approximate tokens." No manual baseline comparison needed -- the data speaks for itself across all 18 skills.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | JUnit 5 + detekt-test (for custom Detekt rules); Agent testing via invocation |
| Config file | `detekt-rules/build.gradle.kts` (new module) |
| Quick run command | `./gradlew :detekt-rules:test` |
| Full suite command | `./gradlew :detekt-rules:test` + manual agent invocation |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINT-01a | Sealed UiState enforcement | unit | `./gradlew :detekt-rules:test --tests "*SealedUiState*"` | Wave 0 |
| LINT-01b | CancellationException rethrow | unit | `./gradlew :detekt-rules:test --tests "*CancellationException*"` | Wave 0 |
| LINT-01c | No platform deps in ViewModel | unit | `./gradlew :detekt-rules:test --tests "*NoPlatformDeps*"` | Wave 0 |
| LINT-01d | WhileSubscribed timeout | unit | `./gradlew :detekt-rules:test --tests "*WhileSubscribed*"` | Wave 0 |
| LINT-01e | No Channel for UI events | unit | `./gradlew :detekt-rules:test --tests "*NoChannel*"` | Wave 0 |
| LINT-03 | compose-rules alongside custom rules | integration | Manual: add both to test project, run `./gradlew detekt` | Manual-only (requires consuming project setup) |
| PTRN-03 | Freshness tracking flags stale versions | smoke | Invoke doc-code-drift-detector agent; verify output contains expected stale items | Manual-only (agent invocation) |
| SCRP-03 | Script parity for same inputs | smoke | Invoke script-parity-validator agent; verify no false negatives on known parity | Manual-only (agent invocation) |
| QUAL-01 | Quality gate unified pass/fail | smoke | Invoke quality-gate-orchestrator; verify report format | Manual-only (agent invocation) |
| QUAL-02 | Cross-surface drift detection | smoke | Invoke template-sync-validator; verify cross-surface checks included | Manual-only (agent invocation) |
| QUAL-03 | Token cost per skill | smoke | Invoke quality-gate-orchestrator; verify token cost section present for 18 skills | Manual-only (agent invocation) |

### Sampling Rate
- **Per task commit:** `./gradlew :detekt-rules:test` (for Detekt rule tasks)
- **Per wave merge:** Full Detekt rule tests + manual agent spot-checks
- **Phase gate:** All Detekt rule tests green + all agent invocations produce expected output format

### Wave 0 Gaps
- [ ] `detekt-rules/` module -- entire module is new (build.gradle.kts, source, tests)
- [ ] `detekt-rules/build.gradle.kts` -- Kotlin JVM module with detekt-api compileOnly + detekt-test testImplementation
- [ ] 5 rule test files -- one per rule, each with positive and negative test cases
- [ ] Version manifest file -- `versions-manifest.json` for freshness tracking
- [ ] Quality gate orchestrator agent spec -- `.claude/agents/quality-gate-orchestrator.md`

## Open Questions

1. **Detekt 2.0 alpha stability for custom rules**
   - What we know: The custom rule API (Rule, RuleSetProvider, visitor pattern) is architecturally stable and unchanged in concept between 1.x and 2.x. Package names changed but the pattern is the same.
   - What's unclear: Whether the 2.0.0-alpha.2 `detekt-test` harness has any bugs that would affect rule testing.
   - Recommendation: Proceed with alpha.2. If `detekt-test` has issues, fall back to manual code snippet testing. The rules themselves are AST-only and low-risk.

2. **Detekt rules module location**
   - What we know: AndroidCommonDoc is a docs/scripts/skills project, not a compiled Kotlin project with Gradle modules.
   - What's unclear: Whether to add a `detekt-rules/` Gradle module to AndroidCommonDoc (making it a hybrid project) or maintain the rules in a separate repository.
   - Recommendation: Add `detekt-rules/` as a standalone Gradle module within AndroidCommonDoc. It needs its own `build.gradle.kts` and `settings.gradle.kts`. This keeps everything in one repo, matching the project's "single toolkit" philosophy. The JAR gets published to a local maven repo or shared via project dependency.

3. **Compose Rules configuration for consuming projects**
   - What we know: compose-rules 0.5.6 provides 30+ rules. All are configurable via `detekt.yml`.
   - What's unclear: Which subset of compose-rules should be enabled by default for this project's patterns.
   - Recommendation: Ship a recommended `detekt.yml` snippet in documentation. Enable all compose-rules by default; let consuming projects disable what they don't need.

## Sources

### Primary (HIGH confidence)
- [Detekt issue #8865](https://github.com/detekt/detekt/issues/8865) -- Detekt 1.23.8 incompatible with Kotlin 2.3.0 metadata
- [Detekt issue #8882](https://github.com/detekt/detekt/issues/8882) -- Type resolution 24x performance regression in KMP monorepos
- [Detekt 2.0 extensions docs](https://detekt.dev/docs/2.0.0-alpha.0/introduction/extensions/) -- Custom rule API for 2.0
- [Detekt 2.0 changelog](https://detekt.dev/changelog-2.0.0) -- Breaking changes, package migration, API changes
- [Detekt compatibility table](https://detekt.dev/docs/introduction/compatibility/) -- Version matrix (1.23.8 = Kotlin 2.0.21 max)
- [compose-rules GitHub releases](https://github.com/mrmans0n/compose-rules/releases) -- 0.5.6 targets Detekt 2.0.0-alpha.2
- [compose-rules Detekt setup](https://mrmans0n.github.io/compose-rules/detekt/) -- Integration instructions

### Secondary (MEDIUM confidence)
- [Detekt custom rule template](https://github.com/detekt/detekt-custom-rule-template) -- Starter project structure
- [Detekt compiler plugin docs](https://detekt.dev/docs/gettingstarted/compilerplugin/) -- Alternative integration for perf
- [Detekt Gradle plugin changes](https://plugins.gradle.org/plugin/dev.detekt/2.0.0-alpha.0) -- New plugin ID confirmation

### Tertiary (LOW confidence)
- [Detekt issue #8882 PR #9127](https://github.com/detekt/detekt/issues/8882) -- Mentioned as potential perf fix, not yet merged
- Various Medium/ProAndroidDev articles on custom Detekt rules -- General patterns, mostly 1.x era

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM -- Detekt 2.0 alpha is the only option but it's alpha; compose-rules 0.5.6 is stable
- Architecture: HIGH -- AST-only rule pattern is well-established; agent structure follows existing specs
- Pitfalls: HIGH -- Version incompatibility (#8865) and performance regression (#8882) are well-documented
- Quality gate agents: HIGH -- 4 specs already defined with exact output formats
- Script parity: HIGH -- Static analysis approach is straightforward given params.json exists
- Token cost: MEDIUM -- Approximation approach is standard but exact metric definition is discretionary

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (Detekt 2.0 may release beta or stable; compose-rules may update)
