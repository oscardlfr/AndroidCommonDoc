# T04: 06-konsist-internal-tests 04

**Slice:** S02 — **Milestone:** M002

## Description

Close 3 verification gaps from 06-VERIFICATION.md: wire orphaned naming and package violation fixtures to negative tests, strengthen architecture error message assertions, and resolve ScriptParityTest known failure so the full test suite passes.

Purpose: ROADMAP SC #3 requires proof that FooManager causes a test failure. SC #2 requires error messages naming the offending file. "Run reliably" means BUILD SUCCESSFUL with no known-failing tests.
Output: All Konsist tests pass, all fixtures are exercised, all verification truths satisfied.

## Must-Haves

- [ ] "A class named FooManager loaded from naming-violation fixture causes Konsist naming check to throw KoAssertionFailedException"
- [ ] "A class MisplacedRule in the wrong package loaded from package-violation fixture causes a package placement failure"
- [ ] "ArchitectureTest asserts the actual file name or import path in the error message (not just the layer name)"
- [ ] "cd konsist-tests && ./gradlew test produces BUILD SUCCESSFUL with all tests passing (no known-failing tests)"

## Files

- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/NamingConventionTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/PackageConventionTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ArchitectureTest.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ScriptParityTest.kt`
