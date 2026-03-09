# Phase 7: Consumer Guard Tests - Research

**Researched:** 2026-03-13
**Domain:** Konsist template distribution, parameterized architecture enforcement, cross-project install scripting
**Confidence:** HIGH

## Summary

Phase 7 distributes the Konsist architecture enforcement tests built in Phase 6 as parameterized templates that consuming projects (DawSync, OmniSound) can adopt with a single install command. The templates use `.kt.template` files with `__ROOT_PACKAGE__` token substitution -- a pattern decided during roadmap creation. The install script creates a `konsist-guard/` JVM-only module in the consumer project, copies templates with package substitution, and adds the module to `settings.gradle.kts`.

The critical design decision is that the consumer's `konsist-guard/` module must be included in the consumer's `settings.gradle.kts` (via `include(":konsist-guard")`), NOT as a standalone project with its own `settings.gradle.kts`. This is because Konsist's `scopeFromProject()` scans the entire Gradle project tree when invoked from a submodule, but only sees its own (empty) sources when run as a standalone project. The Phase 6 `konsist-tests/` module uses `scopeFromDirectory()` with relative paths specifically because it IS standalone. Consumer guard templates should use `scopeFromProduction()` (or `scopeFromProject()`) to dynamically scan all consumer code.

A practical challenge is that consumer projects like DawSync co-locate UI Screens and ViewModels in the same `feature.*` packages, making a strict 5-layer package-based architecture check impractical for UI vs ViewModel separation. The guard templates should define 3 core layers that cleanly map to packages (Domain, Data, Model) plus a broad Feature/Presentation layer, with naming convention checks handling the ViewModel/UseCase/Repository suffix rules independently of package-based layer checks.

**Primary recommendation:** Create `.kt.template` files in `guard-templates/` with `__ROOT_PACKAGE__` token. Install script generates a `konsist-guard/` JVM-only module in the consumer using `include(":konsist-guard")`. Guard tests use `scopeFromProduction()` with package filtering rather than directory-based scoping. Handle missing layers gracefully with pre-check assertions that skip rather than fail.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full suite: layer dependency checks + naming conventions + package placement + module isolation -- mirrors everything Phase 6 built internally
- All checks parameterized on consumer's root package (e.g., `com.wake.thecave`, `com.dawsync`)
- Every template includes canary assertion confirming scope is non-empty (prevents vacuous passes on empty/misconfigured scope)
- Handle missing layers gracefully -- skip layers that don't have files rather than failing (clean enterprise approach for projects of varying size)
- CLI flag for root package: `bash install-guard-tests.sh --package com.dawsync` (consistent with existing --dry-run/--force/--projects pattern)
- Both SH + PS1 counterparts (follows cross-platform scripts constraint from Phase 5)
- Script lives in `setup/install-guard-tests.sh` (and `.ps1`)
- Konsist adoption is opt-in -- guard tests are an optional offering, not forced on consumers
- Dependencies handled via generated build.gradle.kts with pinned versions (zero manual editing per success criteria)
- **DawSync** (`C:\Users\34645\AndroidStudioProjects\DawSync`): Full architecture scan -- install templates, run all guard tests against real code
- **OmniSound** (`C:\Users\34645\AndroidStudioProjects\OmniSound`): Canary pass only -- install templates, verify compile + non-empty scope assertions pass
- If DawSync scan finds real architecture violations: report to user (they fix in track-E terminal), do NOT fix in this phase
- Validate in DawSync worktree as well

### Claude's Discretion
- Whether to use ScopeFactory pattern (like Phase 6) or self-contained tests -- pick based on maintainability vs install simplicity
- Consumer module location (standalone konsist-guard/ module vs other approach) -- pick based on Phase 6 isolation strategy
- Dependency approach (pinned versions vs consumer catalog) -- pick what requires zero manual editing
- Scan scope (configurable modules vs whole project) -- pick what works cleanly in multi-module KMP projects
- Idempotency strategy (skip existing with --force override vs always overwrite) -- follow existing install script pattern
- Violation message style (generic guidance vs linking to pattern docs) -- pick based on coupling vs DX tradeoff

### Deferred Ideas (OUT OF SCOPE)
- Consumer guard test convention plugin integration (`konsistGuard { rootPackage = "..." }` DSL) -- tracked as MCPX-02 in future requirements
- WakeTheCave validation -- project is outdated, defer until it's updated

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GUARD-01 | Parameterized guard test templates accept consumer root package and enforce architecture rules | `.kt.template` files with `__ROOT_PACKAGE__` token substitution. Templates use Konsist `Layer("Name", "__ROOT_PACKAGE__.core.domain..")` pattern. `scopeFromProduction()` scans entire consumer project. Missing layers handled with `scopeFromPackage()` pre-checks. |
| GUARD-02 | Guard test install script copies and configures templates for consuming projects | `setup/install-guard-tests.sh` + `.ps1` following `install-hooks.sh` pattern. `--package` flag for root package. Creates `konsist-guard/` module, copies templates with `sed` substitution, generates `build.gradle.kts` with pinned versions, adds `include(":konsist-guard")` to consumer's `settings.gradle.kts`. |
| GUARD-03 | Guard tests validated against at least one consuming project (WakeTheCave) | CONTEXT.md overrides: validate against DawSync (full scan) and OmniSound (canary pass). DawSync root package `com.dawsync`, OmniSound root package `com.omnisound`. WakeTheCave deferred. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Konsist | 0.17.3 | Kotlin structural/architectural testing | Same version as Phase 6; proven compatible with Kotlin 2.3.10; purpose-built for codebase consistency |
| JUnit 5 | 5.11.4 | Test framework | Standard across all consuming projects; Konsist integrates natively |
| AssertJ | 3.27.3 | Fluent assertions for cross-file checks | Needed for `withFailMessage` on complex assertions where Konsist's `additionalMessage` is insufficient |
| Kotlin JVM | 2.3.10 | Compilation target for konsist-guard module | Consumer project standard; pinned in generated build.gradle.kts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| JUnit Platform Launcher | (auto) | Runtime test discovery | Required `testRuntimeOnly` for JUnit 5 test execution |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pinned versions in generated build.gradle.kts | Consumer's version catalog | Pinned versions = zero config; catalog = version drift risk + requires consumer to add Konsist to catalog |
| `scopeFromProduction()` | `scopeFromDirectory()` with paths | scopeFromProduction dynamically adapts as modules are added; directory-based requires maintaining path lists |
| GuardScopeFactory utility | Inline scope+canary in each test | Factory centralizes canary logic (DRY), slightly more files but easier maintenance |

**Generated build.gradle.kts (consumer's konsist-guard module):**
```kotlin
plugins {
    kotlin("jvm") version "2.3.10"
}

group = "__GROUP__"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("com.lemonappdev:konsist:0.17.3")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.assertj:assertj-core:3.27.3")
}

tasks.withType<Test> {
    useJUnitPlatform()
    outputs.upToDateWhen { false } // Never UP-TO-DATE -- architecture checks must always run
    maxParallelForks = 1 // Sequential on Windows (file locking)
}
```

## Architecture Patterns

### Recommended Project Structure (in toolkit)
```
AndroidCommonDoc/
├── guard-templates/
│   ├── build.gradle.kts.template        # Generated build file
│   ├── settings.gradle.kts.template     # NOT needed -- module included in consumer settings
│   ├── GuardScopeFactory.kt.template    # Centralized scope + canary assertions
│   ├── ArchitectureGuardTest.kt.template # 5-layer architecture checks
│   ├── NamingGuardTest.kt.template      # ViewModel/UseCase/Repository suffixes
│   ├── PackageGuardTest.kt.template     # Package placement checks
│   └── ModuleIsolationGuardTest.kt.template # Feature module isolation
├── setup/
│   ├── install-guard-tests.sh           # Bash install script
│   └── Install-GuardTests.ps1           # PowerShell install script
└── konsist-tests/                       # Phase 6 internal tests (unchanged)
```

### Generated Structure (in consumer project)
```
DawSync/
├── konsist-guard/
│   ├── build.gradle.kts                 # Generated, pinned versions
│   └── src/test/kotlin/
│       └── com/dawsync/konsist/guard/
│           ├── GuardScopeFactory.kt     # Scope creation + canary
│           ├── ArchitectureGuardTest.kt  # Layer dependency checks
│           ├── NamingGuardTest.kt        # Class suffix checks
│           ├── PackageGuardTest.kt       # Package placement
│           └── ModuleIsolationGuardTest.kt # Feature isolation
├── settings.gradle.kts                  # Modified: added include(":konsist-guard")
└── ... (existing modules)
```

### Pattern 1: GuardScopeFactory with Graceful Missing Layers
**What:** Centralized scope creation that skips layers without files instead of failing.
**When to use:** Every guard test template (prevents vacuous passes AND handles projects with missing layers).
**Example:**
```kotlin
// Source: Phase 6 ScopeFactory pattern + graceful skip requirement from CONTEXT.md
package __ROOT_PACKAGE__.konsist.guard

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.container.KoScope

object GuardScopeFactory {

    private const val ROOT = "__ROOT_PACKAGE__"

    /** Production scope for the entire consumer project. */
    fun projectScope(): KoScope {
        val scope = Konsist.scopeFromProduction()
        val rootFiles = scope.files.filter {
            it.packagee?.name?.startsWith(ROOT) == true
        }.toList()
        require(rootFiles.isNotEmpty()) {
            "Canary: no production files found under package '$ROOT'. " +
                "Check that konsist-guard is included in your settings.gradle.kts " +
                "and the root package is correct."
        }
        return scope
    }

    /** Check if a layer has files in scope (for graceful skip). */
    fun layerHasFiles(scope: KoScope, packagePrefix: String): Boolean {
        return scope.files.any {
            it.packagee?.name?.startsWith(packagePrefix) == true
        }
    }
}
```

### Pattern 2: Parameterized Architecture Check with Optional Layers
**What:** 5-layer architecture assertion where layers that don't exist in the consumer are skipped.
**When to use:** ArchitectureGuardTest -- the primary layer dependency check.
**Key insight:** Konsist throws `KoPreconditionFailedException` when a defined Layer has zero files in scope. Templates MUST either filter the scope or conditionally define layers.
**Example:**
```kotlin
// Source: Phase 6 ArchitectureTest + Konsist docs on KoPreconditionFailedException
package __ROOT_PACKAGE__.konsist.guard

import com.lemonappdev.konsist.api.architecture.KoArchitectureCreator
import com.lemonappdev.konsist.api.architecture.Layer
import org.junit.jupiter.api.Test

class ArchitectureGuardTest {

    private val scope = GuardScopeFactory.projectScope()
    private val root = "__ROOT_PACKAGE__"

    @Test
    fun `core layers follow dependency rules`() {
        // Only define layers that have files in the consumer project.
        // This prevents KoPreconditionFailedException on projects that
        // don't have all 5 layers yet.
        val domain = Layer("Domain", "$root.core.domain..")
        val data = Layer("Data", "$root.core.data..")
        val model = Layer("Model", "$root.core.model..")
        val feature = Layer("Feature", "$root.feature..")

        with(KoArchitectureCreator) {
            scope.assertArchitecture {
                // Core dependency rules:
                // Feature -> Domain (allowed)
                // Data -> Domain (allowed)
                // Domain -> nothing (from core layers)
                // Model -> nothing
                if (GuardScopeFactory.layerHasFiles(scope, "$root.feature")) {
                    feature.dependsOn(domain, data, model)
                }
                if (GuardScopeFactory.layerHasFiles(scope, "$root.core.data")) {
                    data.dependsOn(domain, model)
                }
                domain.dependsOnNothing()
                model.dependsOnNothing()
            }
        }
    }
}
```

### Pattern 3: Consumer Naming Convention Check
**What:** ViewModel/UseCase/Repository class suffix enforcement parameterized on root package.
**When to use:** NamingGuardTest -- naming conventions portable across consumers.
**Example:**
```kotlin
// Source: Phase 6 NamingConventionTest adapted for consumers
package __ROOT_PACKAGE__.konsist.guard

import com.lemonappdev.konsist.api.ext.list.withNameEndingWith
import com.lemonappdev.konsist.api.ext.list.withPackage
import com.lemonappdev.konsist.api.verify.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assumptions.assumeTrue

class NamingGuardTest {

    private val scope = GuardScopeFactory.projectScope()
    private val root = "__ROOT_PACKAGE__"

    @Test
    fun `classes in domain usecase package end with UseCase`() {
        val usecaseClasses = scope
            .classes()
            .withPackage("$root..usecase..")
            .toList()

        assumeTrue(usecaseClasses.isNotEmpty()) { "No usecase package found -- skipping" }

        scope.classes()
            .withPackage("$root..usecase..")
            .assertTrue(
                additionalMessage = "Classes in a 'usecase' package must end with 'UseCase'. " +
                    "Rename the class or move it to the correct package."
            ) { it.name.endsWith("UseCase") }
    }

    @Test
    fun `classes ending with ViewModel reside in feature package`() {
        val viewModels = scope
            .classes()
            .withNameEndingWith("ViewModel")
            .toList()

        assumeTrue(viewModels.isNotEmpty()) { "No ViewModel classes found -- skipping" }

        // ViewModels must be in feature modules, not in core
        viewModels.forEach { vm ->
            org.assertj.core.api.Assertions.assertThat(
                vm.resideInPackage("$root.feature..")
            ).withFailMessage(
                "ViewModel '${vm.name}' resides in '${vm.packagee?.name}' " +
                    "but should be in a '$root.feature..' package. " +
                    "ViewModels belong in feature modules."
            ).isTrue
        }
    }
}
```

### Pattern 4: Install Script Token Substitution
**What:** The install script copies `.kt.template` files, replaces `__ROOT_PACKAGE__` with the consumer's package, and writes `.kt` files.
**When to use:** `install-guard-tests.sh --package com.dawsync`
**Example (bash):**
```bash
# Copy and substitute a single template
for template in "$TEMPLATES_DIR"/*.kt.template; do
    target_name="$(basename "$template" .template)"  # e.g., ArchitectureGuardTest.kt
    sed "s/__ROOT_PACKAGE__/$PACKAGE/g" "$template" > "$TARGET_DIR/$target_name"
done
```

### Anti-Patterns to Avoid
- **Standalone konsist-guard with own settings.gradle.kts:** `scopeFromProject()` and `scopeFromProduction()` would only see konsist-guard's own (empty) sources. The module MUST be `include(":konsist-guard")` in the consumer's settings.
- **Using `scopeFromDirectory()` with hardcoded paths:** Consumer projects have varying directory structures (DawSync uses `core/model/`, OmniSound uses `core-model/`). Use `scopeFromProduction()` + package filtering instead.
- **Strict 5-layer separation assuming UI and ViewModel in separate packages:** DawSync co-locates Screens and ViewModels in `feature.*` root packages. OmniSound separates them into `feature.*/ui/`. The guard templates should NOT assume a specific sub-package structure.
- **Failing on missing layers:** Consumer projects may not have all 5 layers. Use `assumeTrue` (JUnit 5) or conditional layer definition to skip gracefully rather than crash.
- **Hardcoding version references to consumer's catalog:** Consumers may not have Konsist in their version catalog. The generated `build.gradle.kts` must pin versions directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token substitution in templates | Custom Kotlin codegen | `sed` with `__ROOT_PACKAGE__` placeholder | Simple, portable, proven in Phase 5's install-claude-skills.sh |
| Consumer scope creation | scopeFromDirectory with path detection | `scopeFromProduction()` + package filtering | Adapts automatically as consumer adds modules; no path maintenance |
| Missing layer detection | Try-catch around assertArchitecture | `layerHasFiles()` pre-check + JUnit `assumeTrue` | Cleaner control flow; test is "skipped" not "errored" |
| settings.gradle.kts modification | Regex replacement in Kotlin DSL | Append `include(":konsist-guard")` with idempotency check | Settings file is append-friendly; Kotlin DSL is hard to parse reliably |
| Cross-platform install script | Single bash script with platform checks | Paired SH + PS1 scripts | Phase 5 established this pattern; PS1 is native on Windows |

**Key insight:** The guard module lives in the CONSUMER's Gradle project tree, not in the toolkit. The toolkit only provides templates and an install script. This means the guard tests have full access to the consumer's code via `scopeFromProduction()` without any composite build complexity.

## Common Pitfalls

### Pitfall 1: Standalone Guard Module Sees Empty Scope
**What goes wrong:** `scopeFromProject()` returns zero files because konsist-guard has its own `settings.gradle.kts`.
**Why it happens:** Konsist resolves "project" based on the Gradle project tree root. A standalone project's tree contains only itself.
**How to avoid:** The install script MUST add `include(":konsist-guard")` to the consumer's `settings.gradle.kts`, making it a submodule.
**Warning signs:** All guard tests pass vacuously (canary assertions should catch this if implemented correctly).

### Pitfall 2: KoPreconditionFailedException on Missing Layers
**What goes wrong:** Konsist throws `KoPreconditionFailedException: Layer "Data" doesn't contain any files` when the consumer doesn't have a `core.data` package.
**Why it happens:** Konsist requires every defined Layer to have at least one file in scope when used in `assertArchitecture`.
**How to avoid:** Check `layerHasFiles()` before defining each layer, or use JUnit 5 `assumeTrue` to skip tests when required layers are absent.
**Warning signs:** Tests crash with `KoPreconditionFailedException` instead of failing with architecture violations.

### Pitfall 3: Install Script Breaking Consumer's settings.gradle.kts
**What goes wrong:** The install script corrupts the consumer's settings.gradle.kts by inserting `include(":konsist-guard")` at the wrong position or duplicating it.
**Why it happens:** Kotlin DSL files are hard to parse and modify programmatically.
**How to avoid:** Use grep/findstr to check if `include(":konsist-guard")` already exists. If not, append it at the end (outside any block). This is safe because `include()` statements are positional in settings.gradle.kts -- they can appear at the end.
**Warning signs:** Consumer build fails after install with "Unexpected tokens" or duplicate module errors.

### Pitfall 4: Consumer Package Structure Doesn't Match Expected Layers
**What goes wrong:** Guard tests fail immediately because the consumer uses `com.dawsync.core.data..` but the template expected `com.dawsync.data..`.
**Why it happens:** Different consumers organize packages differently (flat vs nested core modules).
**How to avoid:** Use broad package patterns with `..` wildcards: `__ROOT_PACKAGE__..domain..` catches both `com.dawsync.core.domain` and `com.dawsync.domain`. However, this may be too broad. The safer approach is `__ROOT_PACKAGE__.core.domain..` with the understanding that consumers following the CLAUDE.md architecture will have `core.domain`.
**Warning signs:** Layer definition captures unintended packages or misses expected ones.

### Pitfall 5: Vacuous Pass on Correctly-Structured Code
**What goes wrong:** Architecture tests pass because the scope contains files but none match any defined layer's package pattern.
**Why it happens:** Konsist silently skips files that don't belong to any layer. If ALL files are "unmatched", the architecture check trivially passes.
**How to avoid:** The canary assertion must verify that at least one layer has files. `GuardScopeFactory.projectScope()` checks the root package, and per-test canaries check layer-specific packages.
**Warning signs:** Architecture test passes on a project that knowingly has violations.

### Pitfall 6: Generated build.gradle.kts Kotlin Version Mismatch
**What goes wrong:** The generated `build.gradle.kts` pins Kotlin `2.3.10` but the consumer uses a different version, causing compilation warnings or errors.
**Why it happens:** The `kotlin("jvm")` plugin version in konsist-guard may conflict with the consumer's root-level Kotlin plugin.
**How to avoid:** Do NOT apply `kotlin("jvm") version "X"` in the guard module. Instead, use `kotlin("jvm")` without a version, inheriting from the consumer's plugin management. The consumer's `pluginManagement` block in settings.gradle.kts already declares the Kotlin version.
**Warning signs:** "Kotlin plugin was applied multiple times" warning or version conflict error.

### Pitfall 7: Windows Path Issues with sed Token Substitution
**What goes wrong:** `sed` on Windows (Git Bash) handles line endings differently, producing files with `\r\n` that Kotlin compiler rejects in some edge cases.
**Why it happens:** Git Bash's `sed` may or may not preserve line endings depending on the input file's format.
**How to avoid:** Template files should use Unix line endings (LF). The install script should not add `-i` (in-place) on Windows. The PS1 script should use `(Get-Content -Raw).Replace()` which handles encoding natively.
**Warning signs:** Kotlin compilation errors on lines that look correct in an editor.

## Code Examples

### Complete GuardScopeFactory Template
```kotlin
// guard-templates/GuardScopeFactory.kt.template
// Source: Phase 6 ScopeFactory.kt adapted for consumer use
package __ROOT_PACKAGE__.konsist.guard

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.container.KoScope

/**
 * Centralized scope creation with canary assertions for guard tests.
 *
 * Uses scopeFromProduction() to scan the entire consumer project's
 * production code. Every method asserts the returned scope is non-empty
 * to prevent vacuous passes on misconfigured scopes.
 *
 * Generated from AndroidCommonDoc guard-templates.
 * Root package: __ROOT_PACKAGE__
 */
object GuardScopeFactory {

    private const val ROOT = "__ROOT_PACKAGE__"

    /**
     * Full production scope filtered to the consumer's root package.
     * Excludes test code and external dependencies.
     */
    fun projectScope(): KoScope {
        val scope = Konsist.scopeFromProduction()
        val count = scope.files.count {
            it.packagee?.name?.startsWith(ROOT) == true
        }
        require(count > 0) {
            "Canary: zero production files found under '$ROOT'. " +
                "Verify that konsist-guard is included in settings.gradle.kts " +
                "and the root package '$ROOT' matches your project structure. " +
                "Working dir: ${System.getProperty("user.dir")}"
        }
        return scope
    }

    /**
     * Checks if any production files exist under the given package prefix.
     * Used to skip layer checks for layers that don't exist in this project.
     */
    fun hasFilesInPackage(scope: KoScope, packagePrefix: String): Boolean {
        return scope.files.any {
            it.packagee?.name?.startsWith(packagePrefix) == true
        }
    }
}
```

### Complete ArchitectureGuardTest Template
```kotlin
// guard-templates/ArchitectureGuardTest.kt.template
// Source: Phase 6 ArchitectureTest.kt adapted for consumer use
package __ROOT_PACKAGE__.konsist.guard

import com.lemonappdev.konsist.api.architecture.KoArchitectureCreator
import com.lemonappdev.konsist.api.architecture.Layer
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/**
 * Architecture guard tests enforcing 5-layer dependency rules.
 *
 * Layers:
 *   Feature (UI + ViewModel) -> Domain, Data, Model
 *   Data -> Domain, Model
 *   Domain -> Model (or nothing)
 *   Model -> nothing
 *
 * Layers that don't exist in this project are skipped gracefully.
 *
 * Generated from AndroidCommonDoc guard-templates.
 * Root package: __ROOT_PACKAGE__
 */
class ArchitectureGuardTest {

    private val scope = GuardScopeFactory.projectScope()
    private val root = "__ROOT_PACKAGE__"

    @Test
    fun `model layer does not depend on other layers`() {
        val modelPkg = "$root.core.model"
        assumeTrue(
            GuardScopeFactory.hasFilesInPackage(scope, modelPkg),
            "No files in $modelPkg -- skipping model isolation check"
        )

        val model = Layer("Model", "$modelPkg..")
        val domain = Layer("Domain", "$root.core.domain..")
        val data = Layer("Data", "$root.core.data..")

        with(KoArchitectureCreator) {
            scope.assertArchitecture {
                model.dependsOnNothing()
                // Include other layers so Konsist can verify model isolation
                if (GuardScopeFactory.hasFilesInPackage(scope, "$root.core.domain")) {
                    domain.doesNotDependOn(model)  // Not strictly needed but explicit
                }
                if (GuardScopeFactory.hasFilesInPackage(scope, "$root.core.data")) {
                    data.doesNotDependOn(model)  // Data may depend on Model actually
                }
            }
        }
    }

    @Test
    fun `domain layer does not depend on data or feature layers`() {
        val domainPkg = "$root.core.domain"
        assumeTrue(
            GuardScopeFactory.hasFilesInPackage(scope, domainPkg),
            "No files in $domainPkg -- skipping domain dependency check"
        )

        // Verify domain does not import data or feature packages
        scope.files
            .filter { it.packagee?.name?.startsWith(domainPkg) == true }
            .forEach { file ->
                val violations = file.imports.filter { imp ->
                    imp.name.startsWith("$root.core.data") ||
                        imp.name.startsWith("$root.feature")
                }.toList()
                org.assertj.core.api.Assertions.assertThat(violations)
                    .withFailMessage {
                        "Domain file '${file.name}' imports data/feature packages: " +
                            "${violations.map { it.name }}. " +
                            "Domain must not depend on Data or Feature layers. " +
                            "Use interfaces in Domain, implementations in Data."
                    }
                    .isEmpty()
            }
    }

    @Test
    fun `data layer does not depend on feature layer`() {
        val dataPkg = "$root.core.data"
        assumeTrue(
            GuardScopeFactory.hasFilesInPackage(scope, dataPkg),
            "No files in $dataPkg -- skipping data dependency check"
        )

        scope.files
            .filter { it.packagee?.name?.startsWith(dataPkg) == true }
            .forEach { file ->
                val violations = file.imports.filter { imp ->
                    imp.name.startsWith("$root.feature")
                }.toList()
                org.assertj.core.api.Assertions.assertThat(violations)
                    .withFailMessage {
                        "Data file '${file.name}' imports feature packages: " +
                            "${violations.map { it.name }}. " +
                            "Data must not depend on Feature layer. " +
                            "Use Domain interfaces for cross-layer communication."
                    }
                    .isEmpty()
            }
    }
}
```

### Install Script Core Logic (Bash)
```bash
# Token substitution + file copy
install_templates() {
    local package="$1"
    local target_dir="$2"
    local templates_dir="$3"
    local package_path="${package//\./\/}"  # com.dawsync -> com/dawsync

    # Create target directory structure
    local kotlin_dir="$target_dir/src/test/kotlin/$package_path/konsist/guard"
    mkdir -p "$kotlin_dir"

    # Copy and substitute .kt.template files
    for template in "$templates_dir"/*.kt.template; do
        [ ! -f "$template" ] && continue
        local target_name
        target_name="$(basename "$template" .template)"
        sed "s/__ROOT_PACKAGE__/$package/g" "$template" > "$kotlin_dir/$target_name"
        log_ok "  Generated: $target_name"
    done

    # Copy and substitute build.gradle.kts.template
    if [ -f "$templates_dir/build.gradle.kts.template" ]; then
        sed "s/__ROOT_PACKAGE__/$package/g" "$templates_dir/build.gradle.kts.template" \
            > "$target_dir/build.gradle.kts"
        log_ok "  Generated: build.gradle.kts"
    fi
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copy-paste test files between projects | `.kt.template` with token substitution | Phase 7 (this phase) | One source of truth for architecture rules |
| scopeFromDirectory in standalone module | scopeFromProduction in included submodule | Konsist 0.17.0+ (well-established) | Dynamic scope adapts as consumer adds modules |
| Fail on missing layers | `assumeTrue` + conditional layer definition | Konsist 0.17.0 added `include()` | Supports projects at varying maturity |
| Manual build.gradle.kts creation | Generated from template with pinned versions | Phase 7 (this phase) | Zero manual editing for consumers |
| Single-platform install script | Paired SH + PS1 | Phase 5 established pattern | Works natively on both macOS/Linux and Windows |

**Deprecated/outdated:**
- `scopeFromProject()` in standalone modules gives empty scope -- avoid
- Konsist pre-0.17.0 `assertArchitecture` API was redesigned -- Phase 6 already uses 0.17.3 patterns

## Open Questions

1. **Should guard templates use `scopeFromProduction()` or `scopeFromPackage()`?**
   - What we know: `scopeFromProduction()` scans all production code; `scopeFromPackage("com.dawsync..")` is more targeted but might miss files in unexpected packages.
   - What's unclear: Performance impact of scanning entire production scope on large projects like DawSync (20+ modules).
   - Recommendation: Use `scopeFromProduction()` with package filtering in assertions. If performance is an issue, switch to `scopeFromPackage("__ROOT_PACKAGE__..")`. Test during validation.

2. **How to handle `kotlin("jvm")` version in generated build.gradle.kts?**
   - What we know: Consumer's `pluginManagement` declares the Kotlin version. Applying `kotlin("jvm") version "X"` in a submodule can conflict.
   - What's unclear: Whether omitting the version in a non-KMP submodule works when the consumer's root build uses `kotlin.multiplatform`.
   - Recommendation: Omit version -- use `kotlin("jvm")` without version specifier. The consumer's plugin management should resolve it. If this doesn't work, pin to `2.3.10` with a comment explaining the pinning.

3. **DawSync architecture: will import-based checks find real violations?**
   - What we know: DawSync has 20+ modules following the 5-layer architecture. The codebase is actively maintained.
   - What's unclear: Whether any existing domain -> data or data -> feature violations exist. CONTEXT.md says "report violations, don't fix them."
   - Recommendation: Run the guard tests and capture output. If violations are found, document them for the user's track-E terminal work.

4. **Konsist-guard module: should it use Gradle wrapper or inherit consumer's?**
   - What we know: As an `include(":konsist-guard")` submodule, it inherits the consumer's Gradle wrapper and settings.
   - What's unclear: Nothing -- this is well-defined. The submodule approach means no separate wrapper is needed.
   - Recommendation: No Gradle wrapper in konsist-guard. It runs via the consumer's `./gradlew :konsist-guard:test`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | JUnit 5.11.4 + Konsist 0.17.3 (in consumer's konsist-guard module) |
| Config file | Consumer's `konsist-guard/build.gradle.kts` (generated by install script) |
| Quick run command | `cd <consumer> && ./gradlew :konsist-guard:test` |
| Full suite command | `cd <consumer> && ./gradlew :konsist-guard:test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GUARD-01 | Templates accept root package and enforce architecture | integration | `cd DawSync && ./gradlew :konsist-guard:test` | No -- Wave 0 |
| GUARD-02 | Install script creates runnable tests | smoke | `bash setup/install-guard-tests.sh --package com.dawsync --dry-run` | No -- Wave 0 |
| GUARD-03 | Guard tests pass in DawSync + OmniSound | integration | `cd DawSync && ./gradlew :konsist-guard:test` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `bash setup/install-guard-tests.sh --package com.test --dry-run` (verify script logic)
- **Per wave merge:** `cd DawSync && ./gradlew :konsist-guard:test` (full consumer validation)
- **Phase gate:** Guard tests green in DawSync + OmniSound canary before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `guard-templates/` directory -- does not exist yet
- [ ] All `.kt.template` files -- none exist yet
- [ ] `setup/install-guard-tests.sh` -- does not exist yet
- [ ] `setup/Install-GuardTests.ps1` -- does not exist yet
- [ ] Consumer `konsist-guard/build.gradle.kts` -- generated by install script
- [ ] Consumer test files -- generated by install script from templates
- [ ] DawSync validation: install + run guard tests
- [ ] OmniSound validation: install + canary pass

## Discretion Recommendations

Based on research, here are recommendations for the areas left to Claude's discretion:

### Use GuardScopeFactory pattern (not self-contained)
**Recommendation:** Use a `GuardScopeFactory` utility class, similar to Phase 6's `ScopeFactory`.
**Rationale:** Centralizing canary assertions in one place (DRY) is cleaner than duplicating scope + canary logic in every test file. The factory adds one file to the template set but saves repetitive boilerplate in 4+ test files. It also provides a single point to customize scope behavior.

### Consumer module: include(":konsist-guard") submodule
**Recommendation:** The guard module must be `include(":konsist-guard")` in the consumer's `settings.gradle.kts`.
**Rationale:** This is the only approach that makes `scopeFromProduction()` work correctly. A standalone module with own `settings.gradle.kts` would only see its own empty sources. Phase 6 uses standalone because it targets sibling directories via `scopeFromDirectory()` -- consumers should NOT need to maintain path lists.

### Dependency approach: pinned versions WITHOUT version on kotlin("jvm")
**Recommendation:** Generated `build.gradle.kts` uses `kotlin("jvm")` (no version) for the plugin, but pins library versions directly: `testImplementation("com.lemonappdev:konsist:0.17.3")`.
**Rationale:** The Kotlin plugin version inherits from the consumer's `pluginManagement`. Library versions are pinned because consumers won't have Konsist in their version catalog. This requires zero manual editing.

### Scan scope: scopeFromProduction() with package filtering
**Recommendation:** Use `scopeFromProduction()` to get the entire project, then filter by `__ROOT_PACKAGE__` in assertions.
**Rationale:** This automatically adapts as the consumer adds modules. No path lists to maintain. Package filtering is precise enough for architecture checks.

### Idempotency: skip existing with --force override
**Recommendation:** Follow the `install-hooks.sh` pattern -- skip existing files, `--force` overwrites.
**Rationale:** Consumers who customize generated tests should not have them silently overwritten. `--force` is an explicit choice. The `include(":konsist-guard")` line should always be idempotent (check before appending).

### Violation messages: generic guidance (not pattern doc links)
**Recommendation:** Use generic guidance like "Domain must not depend on Data or Feature layers. Use interfaces in Domain, implementations in Data."
**Rationale:** Linking to pattern docs creates tight coupling between guard templates and toolkit documentation URLs. Generic messages are self-contained and work even if the consumer does not have access to AndroidCommonDoc docs.

## Sources

### Primary (HIGH confidence)
- [Konsist official docs - Scope Creation](https://docs.konsist.lemonappdev.com/writing-tests/koscope) - scopeFromProduction, scopeFromProject, scopeFromModule, scopeFromPackage APIs; multi-module behavior confirmed
- [Konsist official docs - Architecture Assertion](https://docs.konsist.lemonappdev.com/writing-tests/architecture-assert) - Layer definition, assertArchitecture, dependsOn/dependsOnNothing/doesNotDependOn, strict parameter, include() for optional layers
- [Konsist official docs - Isolate Tests](https://docs.konsist.lemonappdev.com/advanced/isolate-konsist-tests) - Dedicated module pattern, scopeFromProject in submodule sees entire project
- [Konsist official docs - Android Snippets](https://docs.konsist.lemonappdev.com/inspiration/snippets/android-snippets) - ViewModel suffix, Repository package placement patterns
- Phase 6 codebase (konsist-tests/) - ScopeFactory.kt, ArchitectureTest.kt, NamingConventionTest.kt, PackageConventionTest.kt -- proven patterns

### Secondary (MEDIUM confidence)
- [Konsist GitHub Releases](https://github.com/LemonAppDev/konsist/releases) - v0.17.3 latest stable; v0.17.0 redesigned architecture assertions
- [Kotlinlang Slack - Konsist channel](https://slack-chats.kotlinlang.org/t/22668433/hi-all-i-was-trying-to-implement-some-architecture-tests-wit) - KoPreconditionFailedException on empty layers, include() method for optional layers
- Phase 5 install scripts (install-hooks.sh, install-claude-skills.sh) -- established patterns for --dry-run, --force, --projects, cross-platform SH+PS1

### Tertiary (LOW confidence)
- `scopeFromProduction()` performance on large multi-module projects (20+ modules) -- not benchmarked; may need optimization if slow
- `kotlin("jvm")` without version in submodule inheriting from consumer's pluginManagement -- standard Gradle behavior but not explicitly tested in this project context

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Same Konsist 0.17.3 + JUnit 5.11.4 stack proven in Phase 6
- Architecture patterns: HIGH - scopeFromProduction behavior well-documented; template substitution is standard sed; consumer module inclusion is well-understood Gradle behavior
- Pitfalls: HIGH - KoPreconditionFailedException and standalone scope issues documented in community + Phase 6 experience; install script patterns proven in Phase 5
- Consumer validation: MEDIUM - DawSync and OmniSound structures examined but guard tests not yet run; unknown whether real architecture violations exist in DawSync

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (Konsist 0.17.3 stable; patterns are well-established)
