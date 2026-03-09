<!-- GENERATED from skills/android-test/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run Android instrumented tests with logcat capture. Use when asked to run device/emulator tests or connectedAndroidTest."
---

Run Android instrumented tests with logcat capture. Use when asked to run device/emulator tests or connectedAndroidTest.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-android-tests.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
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
