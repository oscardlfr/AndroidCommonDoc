---
name: test
description: "Run tests for a module with smart retry and error extraction. Use when asked to test a specific module or run unit tests."
intent: [test, unit, module, retry, errors]
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

& "$commonDoc\scripts\ps1\gradle-run.ps1" $ARGUMENTS

if ($LASTEXITCODE -ne 0) {
    & "$commonDoc\scripts\ps1\ai-error-extractor.ps1" -ProjectRoot (Get-Location).Path
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

## Runner

This skill invokes `gradle-run.sh` (Linux/macOS, in `scripts/sh/`) or `gradle-run.ps1` (Windows, in `scripts/ps1/`), a thin wrapper around `kmp-test-runner` v0.8.1 — the canonical npm CLI that owns retry, daemon management, and kover coverage logic. See [oscardlfr/kmp-test-runner](https://github.com/oscardlfr/kmp-test-runner#readme) for runner-level configuration.

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/gradle-run.sh`, `scripts/ps1/gradle-run.ps1`
- Script: `scripts/sh/ai-error-extractor.sh`, `scripts/ps1/ai-error-extractor.ps1`
