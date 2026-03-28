<!-- GENERATED from skills/benchmark/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run benchmarks across modules and show agent-friendly results summary. Detects available platforms and devices."
---

Run benchmarks across modules and show agent-friendly results summary. Detects available platforms and devices.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-benchmarks.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$config = "smoke"
$platform = "all"
$moduleFilter = "*"
$includeShared = $false

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--config" -and $i + 1 -lt $argList.Count) {
        $config = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--platform" -and $i + 1 -lt $argList.Count) {
        $platform = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--module-filter" -and $i + 1 -lt $argList.Count) {
        $moduleFilter = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--include-shared") {
        $includeShared = $true
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    Config = $config
    Platform = $platform
    ModuleFilter = $moduleFilter
}

if ($includeShared) { $params.IncludeShared = $true }

& "$commonDoc\scripts\ps1\run-benchmarks.ps1" @params
```
