# Phase 6: Konsist Internal Tests - Research

**Researched:** 2026-03-13
**Domain:** Kotlin structural testing with Konsist, Gradle module isolation, architecture enforcement
**Confidence:** MEDIUM (classpath compatibility unvalidated; API patterns well-documented)

## Summary

Phase 6 implements structural validation of the AndroidCommonDoc toolkit's own Kotlin sources using Konsist 0.17.3. The toolkit has two Kotlin modules to scan: `detekt-rules/` (5 custom Detekt rules + 1 RuleSetProvider in `com.androidcommondoc.detekt` package) and `build-logic/` (1 extension class in `com.androidcommondoc.gradle` package). These are both standalone Gradle projects with their own `settings.gradle.kts`.

The primary risk is classpath conflict: Konsist 0.17.3 bundles `kotlin-compiler-embeddable:2.0.21` while the project uses Kotlin 2.3.10 and Detekt 2.0.0-alpha.2. The mitigation strategy is an isolated `konsist-tests/` JVM-only module that has NO Detekt plugin applied and uses `testImplementation` only for Konsist. Since `konsist-tests/` will be a standalone Gradle project (own `settings.gradle.kts`), the Detekt classpath in `detekt-rules/` and `build-logic/` remains completely separate -- no classpath can bleed across standalone Gradle builds.

The five test classes (DetektRuleStructureTest, ScriptParityTest, SkillStructureTest, PackageConventionTest, NamingConventionTest) combine Konsist's declaration API with architecture assertions and plain JUnit filesystem checks. Since `konsist-tests/` is a standalone project, `scopeFromProject()` would only see its own (empty) sources. Instead, `scopeFromDirectory("../detekt-rules/src/main/kotlin")` and `scopeFromDirectory("../build-logic/src/main/kotlin")` must be used to scan sibling modules via relative paths.

**Primary recommendation:** Create `konsist-tests/` as standalone JVM-only Gradle project with Konsist 0.17.3 as `testImplementation`, using `scopeFromDirectory()` with relative paths to scan `detekt-rules/` and `build-logic/`. Spike classpath compatibility first (Wave 0 canary test).

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **DetektRuleStructureTest** -- Rules follow naming conventions, have companion test classes, implement RuleSetProvider. Also validates provider completeness: every `*Rule` class in the rules package is registered in the RuleSetProvider (catches forgotten registrations).
- **ScriptParityTest** -- PS1/SH pairs exist for each user-facing script. Filesystem check, not Kotlin AST.
- **SkillStructureTest** -- SKILL.md files have required frontmatter sections. Filesystem/markdown validation.
- **PackageConventionTest** -- Packages match module names (e.g., classes in `detekt-rules` use `com.androidcommondoc.detekt`).
- **NamingConventionTest** -- Class suffixes match package expectations (e.g., `*Rule` in detekt package, `*Extension` in build-logic).
- Architecture enforcement approach: fixture-based for 5-layer demonstration + real toolkit code for module isolation
- Test fixtures with intentional violations in `src/test/resources/fixtures/`
- Violation messages must be actionable: name offending file, violated rule, AND remediation guidance
- Cross-file structural checks (4 selected): layer import violations, package placement, provider registration sync, test coverage structure
- Module configured with `outputs.upToDateWhen { false }` for never UP-TO-DATE
- `scopeFromModule()` or `scopeFromDirectory()` for precise scoping (not `scopeFromProject()`)
- Canary assertions in every test to prevent vacuous passes on empty scope

### Claude's Discretion
- Whether ScriptParity/SkillStructure use Konsist file API or plain JUnit
- Architecture enforcement approach: fixture design, real code validation strategy
- Classpath conflict resolution strategy and whether to spike first
- Separate Gradle build complexity trade-off if needed
- Test organization (by concern vs by module scanned)

### Deferred Ideas (OUT OF SCOPE)
- **Conventional Commits enforcement** -- Git commit-msg hook. Not Konsist. -> Phase 9
- **Gitflow workflow validation** -- Branch naming rules. Not Konsist. -> Phase 9

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KONS-01 | Konsist 0.17.3 compatibility validated in isolated JVM module alongside Kotlin 2.3.10 | Standalone `konsist-tests/` module with own `settings.gradle.kts` eliminates classpath conflict with Detekt. Konsist bundles `kotlin-compiler-embeddable:2.0.21`; isolation ensures no version clash. Spike validation recommended as Wave 0. |
| KONS-02 | Layer dependency checks enforce 5-layer architecture | Konsist `assertArchitecture` API with `Layer("name", "package..")`, `dependsOn()`, `dependsOnNothing()`, `doesNotDependOn()`. Test fixtures in `src/test/resources/fixtures/` demonstrate detection. Real toolkit code validates detekt-rules/build-logic isolation. |
| KONS-03 | Naming convention checks enforce class suffixes and package placement | Konsist `classes().withNameEndingWith("Rule").assertTrue { it.resideInPackage("..") }` pattern. Combined with `withPackage()` filter for reverse checks. |
| KONS-04 | Cross-file structural checks complement Detekt | Four checks: (1) layer import violations via `assertArchitecture`, (2) package placement via `resideInPackage`, (3) provider registration sync via cross-referencing `*Rule` classes with RuleSetProvider imports, (4) test coverage structure via matching production classes to `*Test` classes. All require multi-file context Detekt cannot provide. |
| KONS-05 | Konsist tests run via `./gradlew test` with UP-TO-DATE bypass | `outputs.upToDateWhen { false }` on test task in `konsist-tests/build.gradle.kts`. Konsist docs explicitly recommend this pattern for isolated test modules. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Konsist | 0.17.3 | Kotlin structural/architectural testing | Purpose-built for Kotlin codebase consistency; winner of Kotlin Foundation Grants 2024; fluent API for declarations and architecture |
| JUnit 5 | 5.11.4 | Test framework | Already used in detekt-rules tests; Konsist integrates natively with JUnit5 |
| AssertJ | 3.27.3 | Fluent assertions for non-Konsist checks | Already used in detekt-rules tests; superior to JUnit assertions for complex checks |
| Kotlin JVM | 2.3.10 | Compilation target for konsist-tests module | Project standard; Konsist runs as testImplementation so compiler version mismatch is acceptable |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| kotlin-compiler-embeddable | 2.0.21 (transitive) | Konsist's internal Kotlin parser | Pulled transitively by Konsist; never declare directly |
| kotlinx-coroutines-core-jvm | 1.9.0 (transitive) | Konsist internal dependency | Pulled transitively; no direct use |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Konsist architecture checks | ArchUnit (JVM) | ArchUnit is Java-centric; Konsist is Kotlin-native with package/declaration awareness |
| Konsist for script parity | Plain JUnit File checks | ScriptParity and SkillStructure don't need AST parsing; plain JUnit is simpler |
| scopeFromDirectory | scopeFromProject | scopeFromProject only sees the current Gradle project; useless in standalone konsist-tests module |

**Installation (konsist-tests/build.gradle.kts):**
```kotlin
plugins {
    kotlin("jvm") version "2.3.10"
}

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
    outputs.upToDateWhen { false }  // KONS-05: never UP-TO-DATE
}
```

## Architecture Patterns

### Recommended Project Structure
```
konsist-tests/
├── build.gradle.kts           # Standalone JVM-only, Konsist testImplementation
├── settings.gradle.kts        # rootProject.name = "konsist-tests"
├── gradle/wrapper/            # Gradle 9.1.0 wrapper (match existing modules)
├── gradlew / gradlew.bat      # Wrapper scripts
└── src/
    └── test/
        ├── kotlin/
        │   └── com/androidcommondoc/konsist/
        │       ├── DetektRuleStructureTest.kt
        │       ├── ScriptParityTest.kt
        │       ├── SkillStructureTest.kt
        │       ├── PackageConventionTest.kt
        │       ├── NamingConventionTest.kt
        │       └── support/
        │           └── ScopeFactory.kt       # Centralized scope creation + canary assertions
        └── resources/
            └── fixtures/
                ├── layer-violation/           # 5-layer architecture violation fixtures
                │   ├── DataImportsUi.kt       # Data layer importing UI package
                │   └── ModelImportsDomain.kt  # Model importing Domain
                ├── naming-violation/
                │   ├── FooManager.kt          # Should be FooRepository
                │   └── BarHelper.kt           # Wrong suffix for package
                └── package-violation/
                    └── MisplacedRule.kt        # Rule class in wrong package
```

### Pattern 1: Centralized Scope Factory with Canary Assertions
**What:** A shared utility that creates scopes and immediately validates they are non-empty.
**When to use:** Every test that uses Konsist scopes (prevents vacuous passes).
**Example:**
```kotlin
// Source: Konsist docs + project convention
object ScopeFactory {
    /** Scope for detekt-rules production Kotlin sources */
    fun detektRulesScope(): KoScope {
        val scope = Konsist.scopeFromDirectory("../detekt-rules/src/main/kotlin")
        require(scope.files.toList().isNotEmpty()) {
            "Canary: detekt-rules scope is empty. Check path resolution."
        }
        return scope
    }

    /** Scope for build-logic production Kotlin sources */
    fun buildLogicScope(): KoScope {
        val scope = Konsist.scopeFromDirectory("../build-logic/src/main/kotlin")
        require(scope.files.toList().isNotEmpty()) {
            "Canary: build-logic scope is empty. Check path resolution."
        }
        return scope
    }

    /** Scope for test fixture files (intentional violations) */
    fun fixtureScope(fixturePath: String): KoScope {
        val scope = Konsist.scopeFromDirectory("src/test/resources/fixtures/$fixturePath")
        require(scope.files.toList().isNotEmpty()) {
            "Canary: fixture scope '$fixturePath' is empty. Check fixture files exist."
        }
        return scope
    }
}
```

### Pattern 2: Architecture Assertion with Layer Definitions
**What:** Konsist's `assertArchitecture` block with `Layer` definitions and dependency rules.
**When to use:** KONS-02 (5-layer architecture enforcement) and KONS-04 (cross-file layer import checks).
**Example:**
```kotlin
// Source: Konsist official docs - Architecture Assertion
@Test
fun `5-layer architecture dependencies are correct`() {
    val fixtureScope = ScopeFactory.fixtureScope("layer-violation")

    val ui = Layer("UI", "com.example.ui..")
    val viewmodel = Layer("ViewModel", "com.example.viewmodel..")
    val domain = Layer("Domain", "com.example.domain..")
    val data = Layer("Data", "com.example.data..")
    val model = Layer("Model", "com.example.model..")

    // This SHOULD fail because fixtures contain violations
    val exception = assertThrows<AssertionError> {
        fixtureScope.assertArchitecture {
            ui.dependsOn(viewmodel)
            viewmodel.dependsOn(domain)
            data.dependsOn(domain)
            domain.dependsOnNothing()
            model.dependsOnNothing()
        }
    }
    assertThat(exception.message).contains("Data")  // Violation detected
}
```

### Pattern 3: Declaration Check with Naming Convention
**What:** Filter classes by package or name suffix, assert naming/placement conventions.
**When to use:** KONS-03 (naming conventions) and KONS-04 (package placement).
**Example:**
```kotlin
// Source: Konsist official docs - Android Snippets
@Test
fun `classes in detekt rules package end with Rule or RuleSetProvider`() {
    ScopeFactory.detektRulesScope()
        .classes()
        .withPackage("com.androidcommondoc.detekt.rules..")
        .assertTrue(
            additionalMessage = "All classes in the rules package must end with 'Rule'. " +
                "If this is a helper/utility, move it to a separate package."
        ) {
            it.name.endsWith("Rule")
        }
}
```

### Pattern 4: Cross-File Provider Registration Check
**What:** Verify every `*Rule` class is registered in the RuleSetProvider by cross-referencing declarations.
**When to use:** KONS-04 cross-file structural check #3.
**Example:**
```kotlin
// Source: Custom pattern for this project
@Test
fun `every Rule class is registered in RuleSetProvider`() {
    val scope = ScopeFactory.detektRulesScope()

    val ruleClassNames = scope.classes()
        .withPackage("com.androidcommondoc.detekt.rules..")
        .filter { it.name.endsWith("Rule") }
        .map { it.name }
        .toSet()

    val providerFile = scope.files
        .first { it.name == "AndroidCommonDocRuleSetProvider" }

    val registeredImports = providerFile.imports
        .map { it.name.substringAfterLast(".") }
        .toSet()

    val unregistered = ruleClassNames - registeredImports
    assertThat(unregistered)
        .withFailMessage {
            "Rules not registered in RuleSetProvider: $unregistered. " +
                "Add import and ::ClassName to the instance() listOf() in " +
                "AndroidCommonDocRuleSetProvider.kt"
        }
        .isEmpty()
}
```

### Pattern 5: Test Coverage Structure Check
**What:** Verify every production class has a corresponding `*Test` class.
**When to use:** KONS-04 cross-file structural check #4.
**Example:**
```kotlin
// Source: Custom pattern for this project
@Test
fun `every Rule has a corresponding Test class`() {
    val productionScope = Konsist.scopeFromDirectory("../detekt-rules/src/main/kotlin")
    val testScope = Konsist.scopeFromDirectory("../detekt-rules/src/test/kotlin")

    val productionClasses = productionScope.classes()
        .withPackage("com.androidcommondoc.detekt.rules..")
        .filter { it.name.endsWith("Rule") }
        .map { it.name }
        .toSet()

    val testClasses = testScope.classes()
        .filter { it.name.endsWith("Test") }
        .map { it.name.removeSuffix("Test") }
        .toSet()

    val untested = productionClasses - testClasses
    assertThat(untested)
        .withFailMessage {
            "Rules without test classes: $untested. " +
                "Create test class(es) in detekt-rules/src/test/kotlin/ " +
                "following the pattern: <RuleName>Test.kt"
        }
        .isEmpty()
}
```

### Anti-Patterns to Avoid
- **Using `scopeFromProject()` in standalone module:** In a standalone `konsist-tests/` with its own `settings.gradle.kts`, `scopeFromProject()` only sees `konsist-tests/` sources (which are empty in `main`). Always use `scopeFromDirectory()` with relative paths to sibling modules.
- **Applying Detekt plugin in konsist-tests module:** This would bring `kotlin-compiler-embeddable` from Detekt onto the same classpath as Konsist's bundled version, causing `ClassCastException`. The module must use `kotlin("jvm")` ONLY.
- **Hardcoding absolute paths:** Use relative paths (`../detekt-rules/src/main/kotlin`) so tests work regardless of checkout location.
- **Tests without canary assertions:** An empty scope makes all `assertTrue` calls vacuously pass. Always assert scope is non-empty before structural checks.
- **Using `strict = true` on `dependsOn()` without understanding:** Strict mode requires ALL files in a layer to have at least one import from the depended-on layer. For fixture tests this is fine; for real code it may be too restrictive.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Kotlin AST parsing | Custom regex/text parsing of .kt files | Konsist's declaration API (`classes()`, `imports`, `files`) | Konsist wraps `kotlin-compiler-embeddable` for proper AST; regex breaks on edge cases |
| Architecture layer enforcement | Import-checking scripts | Konsist `assertArchitecture` with `Layer` definitions | Konsist understands transitive dependencies and package hierarchies |
| Class naming validation | grep for class name patterns | Konsist `withNameEndingWith()` + `resideInPackage()` | Handles inner classes, companion objects, type aliases correctly |
| Test failure messages | JUnit `assertEquals` with manual string building | Konsist `additionalMessage` parameter + AssertJ `withFailMessage` | Built-in formatting includes file path, declaration name automatically |

**Key insight:** Konsist's value over hand-rolled checks is that it operates on the actual Kotlin AST (via kotlin-compiler-embeddable), not text patterns. This means it correctly handles multiline declarations, nested classes, import aliases, and other constructs that regex-based approaches miss.

## Common Pitfalls

### Pitfall 1: Empty Scope Vacuous Pass
**What goes wrong:** All `assertTrue` / `assertArchitecture` calls pass when scope contains zero files, giving false confidence.
**Why it happens:** Path resolution fails silently (wrong relative path, module not built, `scopeFromDirectory` returns empty scope without error).
**How to avoid:** Every test must start with a canary assertion: `require(scope.files.toList().isNotEmpty())`. Centralize in `ScopeFactory`.
**Warning signs:** Tests that "always pass" even when you know violations exist.

### Pitfall 2: Classpath Conflict with kotlin-compiler-embeddable
**What goes wrong:** `ClassCastException: org.jetbrains.kotlin.idea.KotlinFileType cannot be cast to com.intellij.openapi.fileTypes.FileType` or similar.
**Why it happens:** Multiple versions of `kotlin-compiler-embeddable` on the same classpath (Konsist bundles 2.0.21, Detekt uses its own, Kotlin Gradle plugin has yet another).
**How to avoid:** `konsist-tests/` must be a standalone Gradle project with NO Detekt plugin. Only `kotlin("jvm")` plugin + Konsist as `testImplementation`.
**Warning signs:** Build failures mentioning `ClassCastException` or `NoSuchMethodError` in `org.jetbrains.kotlin.*` classes.

### Pitfall 3: scopeFromProject() in Standalone Module
**What goes wrong:** Scope is empty or only contains konsist-tests' own (empty) production sources.
**Why it happens:** `scopeFromProject()` scans the current Gradle project root, which for a standalone module is `konsist-tests/` itself.
**How to avoid:** Use `scopeFromDirectory("../detekt-rules/src/main/kotlin")` to explicitly target sibling module sources.
**Warning signs:** Scope contains 0 files when you expect 6+ files from detekt-rules.

### Pitfall 4: Relative Path Resolution on Windows
**What goes wrong:** `scopeFromDirectory()` fails to find files because of backslash vs forward-slash path separator issues.
**Why it happens:** Windows uses `\` but Gradle/JVM typically normalize to `/`. The working directory for tests may differ between IDE and CLI.
**How to avoid:** Test with `./gradlew :konsist-tests:test` from project root. If issues arise, use `System.getProperty("user.dir")` to debug the working directory and adjust paths.
**Warning signs:** Tests pass in IDE but fail on CLI (or vice versa).

### Pitfall 5: Fixture Files Not Parsed as Kotlin
**What goes wrong:** Files in `src/test/resources/fixtures/` are not recognized by Konsist as Kotlin files.
**Why it happens:** Konsist's `scopeFromDirectory()` only picks up files with `.kt` extension. Resource files might be filtered differently.
**How to avoid:** Ensure fixture files have `.kt` extension. Verify with `scope.files.toList().forEach { println(it.path) }` during development.
**Warning signs:** Fixture scope is empty despite files existing in the directory.

### Pitfall 6: Architecture Assertions on Code Without Matching Packages
**What goes wrong:** `assertArchitecture` does nothing (no assertions triggered) when none of the scanned code has packages matching any defined Layer.
**Why it happens:** Layer packages like `"com.myapp.ui.."` don't match actual packages. Konsist silently skips files not matching any layer.
**How to avoid:** Fixture files MUST have `package` declarations matching the Layer definitions. Canary assertion on scope size after layer filtering.
**Warning signs:** Architecture test passes even with deliberately wrong imports in fixtures.

## Code Examples

### Complete DetektRuleStructureTest Pattern
```kotlin
// Source: Konsist docs + project-specific patterns
package com.androidcommondoc.konsist

import com.lemonappdev.konsist.api.Konsist
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class DetektRuleStructureTest {

    private val detektScope = ScopeFactory.detektRulesScope()

    @Test
    fun `every Rule class in rules package ends with Rule suffix`() {
        detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .assertTrue(
                additionalMessage = "Classes in the detekt rules package must end with 'Rule' suffix."
            ) {
                it.name.endsWith("Rule")
            }
    }

    @Test
    fun `RuleSetProvider exists and implements correct interface`() {
        val providers = detektScope
            .classes()
            .withNameEndingWith("RuleSetProvider")
            .toList()

        assertThat(providers).isNotEmpty
            .withFailMessage("No RuleSetProvider class found in detekt-rules module")
    }

    @Test
    fun `every Rule is registered in the RuleSetProvider`() {
        val ruleClasses = detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .filter { it.name.endsWith("Rule") }
            .map { it.name }
            .toSet()

        val providerFile = detektScope.files
            .first { it.name == "AndroidCommonDocRuleSetProvider" }

        val importedNames = providerFile.imports
            .map { it.name.substringAfterLast(".") }
            .toSet()

        val unregistered = ruleClasses - importedNames
        assertThat(unregistered)
            .withFailMessage {
                "Unregistered rules: $unregistered. " +
                    "Add them to AndroidCommonDocRuleSetProvider.instance() and import them."
            }
            .isEmpty()
    }

    @Test
    fun `every Rule class has a matching Test class`() {
        val testScope = Konsist.scopeFromDirectory("../detekt-rules/src/test/kotlin")
        require(testScope.files.toList().isNotEmpty()) {
            "Canary: detekt-rules test scope is empty"
        }

        val productionRules = detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .filter { it.name.endsWith("Rule") }
            .map { it.name }
            .toSet()

        val testClasses = testScope
            .classes()
            .filter { it.name.endsWith("Test") }
            .map { it.name.removeSuffix("Test") }
            .toSet()

        val untested = productionRules - testClasses
        assertThat(untested)
            .withFailMessage {
                "Rules without test classes: $untested. " +
                    "Create <RuleName>Test.kt in detekt-rules/src/test/kotlin/"
            }
            .isEmpty()
    }
}
```

### ScriptParityTest (Plain JUnit - No Konsist Needed)
```kotlin
// Source: Project convention - filesystem check
package com.androidcommondoc.konsist

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.io.File

class ScriptParityTest {
    private val projectRoot = File("..") // konsist-tests is one level deep

    @Test
    fun `every sh script has a matching ps1 script`() {
        val shDir = File(projectRoot, "scripts/sh")
        val ps1Dir = File(projectRoot, "scripts/ps1")

        require(shDir.exists()) { "scripts/sh/ directory not found at ${shDir.absolutePath}" }
        require(ps1Dir.exists()) { "scripts/ps1/ directory not found at ${ps1Dir.absolutePath}" }

        val shScripts = shDir.listFiles { f -> f.extension == "sh" && !f.isDirectory }
            ?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()
        val ps1Scripts = ps1Dir.listFiles { f -> f.extension == "ps1" && !f.isDirectory }
            ?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()

        require(shScripts.isNotEmpty()) { "Canary: no .sh scripts found" }

        val missingPs1 = shScripts - ps1Scripts
        val missingBash = ps1Scripts - shScripts

        assertThat(missingPs1)
            .withFailMessage {
                "SH scripts without PS1 counterpart: $missingPs1. " +
                    "Create matching .ps1 files in scripts/ps1/"
            }
            .isEmpty()

        assertThat(missingBash)
            .withFailMessage {
                "PS1 scripts without SH counterpart: $missingBash. " +
                    "Create matching .sh files in scripts/sh/"
            }
            .isEmpty()
    }
}
```

### Architecture Fixture Test (Proves 5-Layer Detection Works)
```kotlin
// Source: Konsist docs - Architecture Assertion
package com.androidcommondoc.konsist

import com.lemonappdev.konsist.api.architecture.Layer
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ArchitectureFixtureTest {

    @Test
    fun `fixture with data-imports-ui violation is detected`() {
        val fixtureScope = ScopeFactory.fixtureScope("layer-violation")

        val ui = Layer("UI", "com.example.ui..")
        val viewmodel = Layer("ViewModel", "com.example.viewmodel..")
        val domain = Layer("Domain", "com.example.domain..")
        val data = Layer("Data", "com.example.data..")
        val model = Layer("Model", "com.example.model..")

        val error = assertThrows<AssertionError> {
            fixtureScope.assertArchitecture {
                ui.dependsOn(viewmodel)
                viewmodel.dependsOn(domain)
                data.dependsOn(domain)
                domain.dependsOnNothing()
                model.dependsOnNothing()
            }
        }

        assertThat(error.message)
            .contains("Data")
            .contains("UI")
    }
}
```

### Module Isolation Check (Real Toolkit Code)
```kotlin
// Source: Project-specific - validates detekt-rules and build-logic stay isolated
@Test
fun `detekt-rules code does not import build-logic packages`() {
    ScopeFactory.detektRulesScope()
        .files
        .assertFalse(
            additionalMessage = "detekt-rules must not depend on build-logic. " +
                "These are separate Gradle modules with independent classpaths."
        ) {
            it.hasImport { import ->
                import.name.startsWith("com.androidcommondoc.gradle")
            }
        }
}

@Test
fun `build-logic code does not import detekt rules packages`() {
    ScopeFactory.buildLogicScope()
        .files
        .assertFalse(
            additionalMessage = "build-logic must not directly import detekt rule implementations. " +
                "Use the JAR artifact via Gradle dependency instead."
        ) {
            it.hasImport { import ->
                import.name.startsWith("com.androidcommondoc.detekt.rules")
            }
        }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ArchUnit (Java) | Konsist (Kotlin-native) | 2023+ | Kotlin-aware AST, package/declaration-level checks, sealed class support |
| Konsist `kotlin-compiler` | Konsist `kotlin-compiler-embeddable` | v0.15.0+ | Reduced classpath conflicts via shaded/relocated classes |
| `dependsOn()` only | `dependsOn()` + `doesNotDependOn()` + `dependsOnNothing()` | v0.16.0+ | More expressive architecture assertions |
| Basic Layer() | Layer() with `strict` parameter on `dependsOn()` | v0.17.1 | Control whether dependency is optional or required |
| `include()` absent | `include()` for layers without explicit dependencies | v0.17.0+ | Layers can be monitored without declaring dependency rules |

**Deprecated/outdated:**
- Konsist pre-0.15.0 used `kotlin-compiler` (non-embeddable) which caused severe classpath issues
- Konsist `scopeFromProject()` behavior may change in composite builds; `scopeFromDirectory()` is safer

## Open Questions

1. **Does `scopeFromDirectory()` work with relative paths on Windows?**
   - What we know: Konsist docs show `scopeFromDirectory("app/domain")` (relative, forward slash). JVM normalizes paths internally.
   - What's unclear: Whether `../detekt-rules/src/main/kotlin` resolves correctly when Gradle sets the working directory to `konsist-tests/`.
   - Recommendation: Spike this in Wave 0 canary test. Fallback: compute absolute path via `File("../detekt-rules/src/main/kotlin").absolutePath`.

2. **Will Konsist 0.17.3 parse Kotlin 2.3.10 source files correctly?**
   - What we know: Konsist bundles `kotlin-compiler-embeddable:2.0.21` for parsing. Kotlin is generally backwards-compatible at the syntax level.
   - What's unclear: Whether Kotlin 2.3.10-specific syntax (if any) would fail to parse with the 2.0.21 parser.
   - Recommendation: The existing detekt-rules code uses standard Kotlin syntax (no bleeding-edge features). Risk is LOW. Spike will confirm.

3. **How does `assertArchitecture` report violations?**
   - What we know: Layer `name` parameter is "used for presenting architecture violation errors". `additionalMessage` is available on `assertTrue`/`assertFalse`.
   - What's unclear: Whether `assertArchitecture` itself supports `additionalMessage` or if the error format is Konsist-controlled.
   - Recommendation: If `assertArchitecture` error messages are insufficient, wrap in `assertThrows<AssertionError>` and re-throw with enhanced message. Test during spike.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | JUnit 5.11.4 + Konsist 0.17.3 |
| Config file | `konsist-tests/build.gradle.kts` (created in Wave 0) |
| Quick run command | `cd konsist-tests && ./gradlew test` |
| Full suite command | `cd konsist-tests && ./gradlew test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KONS-01 | Konsist 0.17.3 compiles and runs in isolated JVM module | smoke | `cd konsist-tests && ./gradlew test --tests "*.DetektRuleStructureTest"` | No - Wave 0 |
| KONS-02 | Layer dependency checks detect violations | unit | `cd konsist-tests && ./gradlew test --tests "*.ArchitectureFixtureTest"` | No - Wave 0 |
| KONS-03 | Naming convention checks enforce suffixes | unit | `cd konsist-tests && ./gradlew test --tests "*.NamingConventionTest"` | No - Wave 0 |
| KONS-04 | Cross-file structural checks (4 types) | unit | `cd konsist-tests && ./gradlew test --tests "*.DetektRuleStructureTest"` | No - Wave 0 |
| KONS-05 | Tests never show UP-TO-DATE | integration | Run `./gradlew test` twice, verify second run executes | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `cd konsist-tests && ./gradlew test`
- **Per wave merge:** `cd konsist-tests && ./gradlew test` (same -- single module)
- **Phase gate:** All konsist-tests pass before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `konsist-tests/build.gradle.kts` -- module does not exist yet
- [ ] `konsist-tests/settings.gradle.kts` -- module does not exist yet
- [ ] `konsist-tests/gradle/wrapper/` -- Gradle 9.1.0 wrapper
- [ ] `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ScopeFactory.kt` -- shared scope utility
- [ ] `konsist-tests/src/test/resources/fixtures/layer-violation/*.kt` -- architecture violation fixtures
- [ ] `konsist-tests/src/test/resources/fixtures/naming-violation/*.kt` -- naming violation fixtures
- [ ] All 5 test classes -- none exist yet
- [ ] **Classpath spike:** Verify `Konsist.scopeFromDirectory("../detekt-rules/src/main/kotlin")` resolves and returns non-empty scope

## Sources

### Primary (HIGH confidence)
- [Konsist official docs - Scope Creation](https://docs.konsist.lemonappdev.com/writing-tests/koscope) - scopeFromDirectory, scopeFromModule, scopeFromProject APIs
- [Konsist official docs - Architecture Assertion](https://docs.konsist.lemonappdev.com/writing-tests/architecture-assert) - Layer, assertArchitecture, dependsOn, doesNotDependOn APIs
- [Konsist official docs - Declaration Assert](https://docs.konsist.lemonappdev.com/writing-tests/declaration-assert) - assertTrue, assertFalse, additionalMessage parameter
- [Konsist official docs - Isolate Tests](https://docs.konsist.lemonappdev.com/advanced/isolate-konsist-tests) - Dedicated module pattern, outputs.upToDateWhen { false }
- [Konsist official docs - General Snippets](https://docs.konsist.lemonappdev.com/inspiration/snippets/general-snippets) - Naming, package, import verification patterns
- [Konsist official docs - Android Snippets](https://docs.konsist.lemonappdev.com/inspiration/snippets/android-snippets) - ViewModel, Repository naming conventions
- [Maven Central / Sonatype](https://central.sonatype.com/artifact/com.lemonappdev/konsist/0.17.3) - Konsist 0.17.3 transitive dependencies: kotlin-compiler-embeddable:2.0.21

### Secondary (MEDIUM confidence)
- [Konsist GitHub Releases](https://github.com/LemonAppDev/konsist/releases) - v0.17.3 release notes, v0.17.0 redesigned architecture assertions
- [Konsist GitHub Discussion #795](https://github.com/LemonAppDev/konsist/discussions/795) - Classpath conflict with Kotlin Gradle plugin, kotlin-compiler-embeddable migration
- [Detekt GitHub Issue #7883](https://github.com/detekt/detekt/issues/7883) - Detekt + kotlin-compiler-embeddable conflict with Kotlin 2.1+
- [Konsist Compatibility Page](https://docs.konsist.lemonappdev.com/help/compatibility) - Backwards compatible with Kotlin 1.8+, uses kotlin-compiler-embeddable:2.0.20 (docs slightly behind actual 2.0.21)

### Tertiary (LOW confidence)
- Relative path behavior of `scopeFromDirectory()` on Windows -- not explicitly documented; needs spike validation
- Konsist parsing of Kotlin 2.3.10 syntax with embedded 2.0.21 compiler -- theoretically safe but unverified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Konsist 0.17.3 is the correct and latest stable version; dependency setup is well-documented
- Architecture patterns: MEDIUM - Konsist API is well-documented but `scopeFromDirectory` relative path behavior in standalone module on Windows needs validation
- Pitfalls: HIGH - Classpath conflicts are well-documented in community issues; empty scope problem is a known gotcha
- Cross-file checks: MEDIUM - Provider registration and test coverage structure patterns are project-specific adaptations of Konsist's declaration API; not directly documented but follow standard patterns

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (Konsist 0.17.3 is stable; 1.0 not yet released)
