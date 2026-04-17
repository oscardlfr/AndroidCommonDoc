---
name: test
description: "Run tests for a module with smart retry and error extraction. Use when asked to test a specific module or run unit tests."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/test core:domain
/test core:data --test-type common
/test feature:home --test-type androidUnit
/test feature:devices --test-type androidInstrumented
/test core:model --test-type desktop --skip-coverage
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Gradle module path to test (e.g., `core:domain`, `feature:home`). Omit to run all.
- `test-type` -- Type of tests to run: `all`, `common`, `androidUnit`, `androidInstrumented`, `desktop`.
- `skip-coverage` -- Skip coverage report generation after tests.
- `coverage-tool` -- Coverage tool to use: `jacoco`, `kover`, `auto`, `none`.
- `project-root` -- Path to the project root directory.

## Behavior

1. Detect project type (KMP Desktop vs Android) from the project structure.
2. Determine the Gradle test task based on the `test-type` parameter:
   - `all` -- Run all applicable tests (default).
   - `common` -- Run `desktopTest` (cross-platform commonTest).
   - `androidUnit` -- Run `testDebugUnitTest` (Android JVM tests).
   - `androidInstrumented` -- Run `connectedDebugAndroidTest` (device/emulator tests).
   - `desktop` -- Run `desktopTest` (same as common, explicit).
3. Run tests with intelligent retry:
   - Attempt 1: Fast run.
   - Attempt 2: Stop daemons + Clean + Run (if daemon error detected).
4. Generate coverage report (unless `--skip-coverage` is set).
5. Extract errors if tests fail, providing actionable items with suggested fixes.

## Implementation

> **Claude Code agents**: Always use the `macOS / Linux` path below, regardless of host OS.
> Claude Code agents run in bash (`/usr/bin/bash`) on all platforms including Windows.

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"
"$COMMON_DOC/scripts/sh/gradle-run.sh" --project-root "$(pwd)" $ARGUMENTS
if [ $? -ne 0 ]; then
  "$COMMON_DOC/scripts/sh/ai-error-extractor.sh" --project-root "$(pwd)" --module "$MODULE"
fi
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$module = ""
$testType = "all"
$skipCoverage = $false
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--test-type" -and $i + 1 -lt $argList.Count) {
        $testType = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--skip-coverage") {
        $skipCoverage = $true
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    } elseif ($arg -notmatch "^--") {
        $module = $arg
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    Module = $module
    TestType = $testType
}

if ($skipCoverage) { $params.SkipCoverage = $true }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\gradle-run.ps1" @params

if ($LASTEXITCODE -ne 0) {
    & "$commonDoc\scripts\ps1\ai-error-extractor.ps1" -ProjectRoot (Get-Location).Path -Module $module
}
```

## Expected Output

**On success:**
- Test results summary (passed/failed/skipped counts)
- Coverage percentage per module (unless `--skip-coverage`)

**On failure:**
- Test failure details with file paths and line numbers
- Actionable items with suggested fixes (from error extractor)
- Exit code 1

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/gradle-run.sh`, `scripts/ps1/gradle-run.ps1`
- Script: `scripts/sh/ai-error-extractor.sh`, `scripts/ps1/ai-error-extractor.ps1`
