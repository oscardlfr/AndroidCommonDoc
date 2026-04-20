---
name: android-test
description: "Run Android instrumented tests with logcat capture. Use when asked to run device/emulator tests or connectedAndroidTest."
intent: [android, test, instrumented, emulator, device, logcat]
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/android-test
/android-test core:database
/android-test --device emulator-5554
/android-test --skip-app --flavor demo
/android-test core:data --auto-retry
/android-test --list
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Specific module to test (e.g., `core:data`, `feature:auth`). Tests all androidTest modules if omitted.
- `device` -- Target device ID. Auto-detected if omitted.
- `flavor` -- Build flavor for modules with productFlavors (e.g., `demo`, `prod`).
- `skip-app` -- Skip E2E app module tests (faster iteration).
- `verbose` -- Show detailed logcat output on failure.
- `auto-retry` -- Retry failed modules once before reporting failure.
- `clear-data` -- Clear app data before tests (useful with `--auto-retry`).
- `list-only` -- List discovered modules without running tests.
- `project-root` -- Path to the project root directory.

## Behavior

1. Detect connected devices via ADB (auto-select first available).
2. Discover modules with `src/androidTest/` directory.
3. Detect project type (KMP vs pure Android).
4. Run tests via `connectedAndroidTest` (or `connected{Flavor}DebugAndroidTest`).
5. Capture logcat filtered by package for each module.
6. Extract errors to JSON for autonomous diagnosis.
7. Generate JSON summary (`summary.json`) for machine parsing.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-android-tests.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$module = ""
$device = ""
$flavor = ""
$skipApp = $false
$verbose = $false
$autoRetry = $false
$clearData = $false
$listOnly = $false

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--device" -and $i + 1 -lt $argList.Count) {
        $device = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--flavor" -and $i + 1 -lt $argList.Count) {
        $flavor = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--skip-app") {
        $skipApp = $true
    } elseif ($arg -eq "--verbose") {
        $verbose = $true
    } elseif ($arg -eq "--auto-retry") {
        $autoRetry = $true
    } elseif ($arg -eq "--clear-data") {
        $clearData = $true
    } elseif ($arg -eq "--list") {
        $listOnly = $true
    } elseif (-not $arg.StartsWith("-") -and -not $module) {
        $module = $arg
    }
}

$params = @{ ProjectRoot = (Get-Location).Path }
if ($module) { $params.ModuleFilter = $module }
if ($device) { $params.Device = $device }
if ($flavor) { $params.Flavor = $flavor }
if ($skipApp) { $params.SkipApp = $true }
if ($verbose) { $params.Verbose = $true }
if ($autoRetry) { $params.AutoRetry = $true }
if ($clearData) { $params.ClearData = $true }
if ($listOnly) { $params.ListOnly = $true }

& "$commonDoc\scripts\ps1\run-android-tests.ps1" @params
```

## Expected Output

**On success:**
- Test results per module (pass/fail/skip counts)
- JSON summary in `androidtest-logs/{timestamp}/summary.json`

**On failure:**
- Error details in `androidtest-logs/{timestamp}/{module}_errors.json`
- Logcat output in `androidtest-logs/{timestamp}/{module}_logcat.log`

**Output files (in `androidtest-logs/{timestamp}/`):**
- `{module}.log` -- Full Gradle output
- `{module}_logcat.log` -- Filtered logcat for module
- `{module}_errors.json` -- Extracted errors (on failure)
- `summary.json` -- Machine-readable summary

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-android-tests.sh`, `scripts/ps1/run-android-tests.ps1`
- Related: `/test` (unit tests), `/test-full` (all tests)
