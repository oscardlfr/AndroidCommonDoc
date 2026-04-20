---
name: extract-errors
description: "Extract structured build and test errors from Gradle output. Use when a build or test fails and you need actionable error details."
intent: [errors, build, gradle, extract, failures, actionable]
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/extract-errors core:data
/extract-errors feature:home --platform desktop --json
/extract-errors core:domain --include-stacktrace
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Module that failed (required).
- `platform` -- Target platform for finding results: `android`, `desktop`.
- `json` -- Output as JSON for programmatic use.
- `include-stacktrace` -- Include full stack traces in output.
- `project-root` -- Path to the project root directory.

## Behavior

1. Locate the most recent Gradle build output for the specified module.
2. Extract compilation errors (HIGH priority):
   - File path, line number, column number.
   - Error message.
   - Suggested fix.
3. Extract test failures (HIGH priority):
   - Test class and method name.
   - Assertion/error message.
   - Stack trace location.
   - Suggested fix.
4. Extract coverage gaps (MEDIUM priority) from Kover or JaCoCo reports:
   - Files with low coverage.
   - Missed line ranges.
   - Suggested tests to add.
5. Format output as actionable items sorted by priority.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/ai-error-extractor.sh" --project-root "$(pwd)" --module "$MODULE" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\ai-error-extractor.ps1" -ProjectRoot (Get-Location).Path -Module "$MODULE" -Platform $PLATFORM -JsonOutput:$JSON -IncludeStackTrace:$INCLUDE_STACK
```

## Expected Output

**Structured actionable items:**
```
[1] HIGH - Fix compilation error
    Location: SnapshotRepository.kt:45:12
    Error: Unresolved reference: CoroutineScope
    Fix: Add import for 'CoroutineScope' or check if it exists in dependencies

[2] HIGH - Fix test failure
    Test: GetSnapshotsUseCaseTest.test_emptyList_returnsEmpty
    Message: expected: <[]> but was: <null>
    Fix: Update expected value or fix the implementation

[3] MEDIUM - Add test coverage
    File: WaveformAnalyzer.kt
    Lines: 45-52, 67
    Coverage: 65%
```

**Common suggested fix patterns:**

| Error Pattern | Suggested Fix |
|--------------|---------------|
| Unresolved reference | Add missing import or dependency |
| Type mismatch | Verify parameter types |
| Cannot access | Check visibility modifiers |
| NullPointerException | Add null check |
| expected but was | Update expected value or fix implementation |

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/ai-error-extractor.sh`, `scripts/ps1/ai-error-extractor.ps1`
- Related: `/test` (runs error extraction on failure)
