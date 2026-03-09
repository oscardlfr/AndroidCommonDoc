# T03: 06-konsist-internal-tests 03

**Slice:** S02 — **Milestone:** M002

## Description

Implement architecture enforcement with fixture-based 5-layer validation, module isolation checks on real code, and the filesystem-based ScriptParity and SkillStructure tests.

Purpose: This plan proves Konsist detects the structural violations that Detekt single-file analysis cannot -- layer boundary imports, package-based enforcement across files. The ScriptParity and SkillStructure tests complete the toolkit's structural validation coverage.
Output: Architecture test fixtures, ArchitectureTest (KONS-02 + KONS-04 layer import violations), ScriptParityTest, and SkillStructureTest -- all passing.

## Must-Haves

- [ ] "A fixture with Data layer importing UI package causes assertArchitecture to fail, naming the offending layer"
- [ ] "A fixture with Model importing Domain causes assertArchitecture to fail"
- [ ] "detekt-rules code importing build-logic packages causes module isolation test to fail"
- [ ] "Every .sh script in scripts/sh/ has a matching .ps1 in scripts/ps1/ (and vice versa)"
- [ ] "Every SKILL.md file exists and has required frontmatter sections"
- [ ] "Architecture fixture tests detect at least 3 violation types Detekt cannot catch"

## Files

- `konsist-tests/src/test/resources/fixtures/layer-violation/DataImportsUi.kt`
- `konsist-tests/src/test/resources/fixtures/layer-violation/ModelImportsDomain.kt`
- `konsist-tests/src/test/resources/fixtures/layer-violation/ValidDataLayer.kt`
- `konsist-tests/src/test/resources/fixtures/naming-violation/FooManager.kt`
- `konsist-tests/src/test/resources/fixtures/package-violation/MisplacedRule.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ArchitectureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ScriptParityTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/SkillStructureTest.kt`
