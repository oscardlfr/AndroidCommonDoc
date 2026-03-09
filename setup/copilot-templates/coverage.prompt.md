<!-- GENERATED from skills/coverage/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Analyze test coverage gaps from existing data without running tests. Use when asked to check coverage or find untested code."
---

Analyze test coverage gaps from existing data without running tests. Use when asked to check coverage or find untested code.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-root "$(pwd)" --skip-tests --min-lines "${MIN_LINES:-5}" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$moduleFilter = "*"
$minLines = 5
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--module-filter" -and $i + 1 -lt $argList.Count) {
        $moduleFilter = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    SkipTests = $true
    ModuleFilter = $moduleFilter
    MinMissedLines = $minLines
}

if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-parallel-coverage-suite.ps1" @params
```
