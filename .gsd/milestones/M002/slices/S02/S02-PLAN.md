# S02: Konsist Internal Tests

**Goal:** Bootstrap the konsist-tests standalone JVM module, validate Konsist 0.
**Demo:** Bootstrap the konsist-tests standalone JVM module, validate Konsist 0.

## Must-Haves


## Tasks

- [x] **T01: 06-konsist-internal-tests 01**
  - Bootstrap the konsist-tests standalone JVM module, validate Konsist 0.17.3 classpath isolation alongside Kotlin 2.3.10, and create the shared ScopeFactory utility that all subsequent test classes depend on.

Purpose: This is the critical foundation -- if the classpath spike fails, the entire phase approach must change. Getting this right first de-risks everything else.
Output: A working konsist-tests/ Gradle module with passing canary tests and shared scope utilities.
- [x] **T02: 06-konsist-internal-tests 02**
  - Implement the three test classes that enforce naming conventions, package placement, and cross-file structural integrity of the toolkit's own Kotlin code.

Purpose: These tests catch the structural bugs Detekt cannot -- forgotten rule registrations, missing test classes, wrong package placement, incorrect class suffixes. They operate across multiple files which is exactly what single-file Detekt analysis misses.
Output: 3 passing test classes validating naming (KONS-03) and cross-file structure (KONS-04 partial: provider registration, test coverage, package placement).
- [x] **T03: 06-konsist-internal-tests 03**
  - Implement architecture enforcement with fixture-based 5-layer validation, module isolation checks on real code, and the filesystem-based ScriptParity and SkillStructure tests.

Purpose: This plan proves Konsist detects the structural violations that Detekt single-file analysis cannot -- layer boundary imports, package-based enforcement across files. The ScriptParity and SkillStructure tests complete the toolkit's structural validation coverage.
Output: Architecture test fixtures, ArchitectureTest (KONS-02 + KONS-04 layer import violations), ScriptParityTest, and SkillStructureTest -- all passing.
- [x] **T04: 06-konsist-internal-tests 04**
  - Close 3 verification gaps from 06-VERIFICATION.md: wire orphaned naming and package violation fixtures to negative tests, strengthen architecture error message assertions, and resolve ScriptParityTest known failure so the full test suite passes.

Purpose: ROADMAP SC #3 requires proof that FooManager causes a test failure. SC #2 requires error messages naming the offending file. "Run reliably" means BUILD SUCCESSFUL with no known-failing tests.
Output: All Konsist tests pass, all fixtures are exercised, all verification truths satisfied.

## Files Likely Touched

- `konsist-tests/build.gradle.kts`
- `konsist-tests/settings.gradle.kts`
- `konsist-tests/gradle/wrapper/gradle-wrapper.properties`
- `konsist-tests/gradlew`
- `konsist-tests/gradlew.bat`
- `konsist-tests/gradle/wrapper/gradle-wrapper.jar`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/support/ScopeFactory.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ClasspathSpikeTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/DetektRuleStructureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/PackageConventionTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/NamingConventionTest.kt`
- `konsist-tests/src/test/resources/fixtures/layer-violation/DataImportsUi.kt`
- `konsist-tests/src/test/resources/fixtures/layer-violation/ModelImportsDomain.kt`
- `konsist-tests/src/test/resources/fixtures/layer-violation/ValidDataLayer.kt`
- `konsist-tests/src/test/resources/fixtures/naming-violation/FooManager.kt`
- `konsist-tests/src/test/resources/fixtures/package-violation/MisplacedRule.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ArchitectureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ScriptParityTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/SkillStructureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/NamingConventionTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/PackageConventionTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ArchitectureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ScriptParityTest.kt`
