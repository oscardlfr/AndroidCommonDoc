# T02: 06-konsist-internal-tests 02

**Slice:** S02 — **Milestone:** M002

## Description

Implement the three test classes that enforce naming conventions, package placement, and cross-file structural integrity of the toolkit's own Kotlin code.

Purpose: These tests catch the structural bugs Detekt cannot -- forgotten rule registrations, missing test classes, wrong package placement, incorrect class suffixes. They operate across multiple files which is exactly what single-file Detekt analysis misses.
Output: 3 passing test classes validating naming (KONS-03) and cross-file structure (KONS-04 partial: provider registration, test coverage, package placement).

## Must-Haves

- [ ] "A class named FooManager in the detekt rules package causes NamingConventionTest to fail with a message naming the offending class and suggesting the correct suffix"
- [ ] "A Rule class missing from the RuleSetProvider causes DetektRuleStructureTest provider registration check to fail with the unregistered class name"
- [ ] "A Rule class without a corresponding Test class causes DetektRuleStructureTest test coverage check to fail naming the untested rule"
- [ ] "All 5 existing Rule classes pass naming convention checks (they already follow conventions)"
- [ ] "detekt-rules classes reside in com.androidcommondoc.detekt package; build-logic classes reside in com.androidcommondoc.gradle package"

## Files

- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/DetektRuleStructureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/PackageConventionTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/NamingConventionTest.kt`
