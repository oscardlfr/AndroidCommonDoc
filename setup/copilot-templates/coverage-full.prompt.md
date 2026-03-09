<!-- GENERATED from skills/coverage-full/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Generate comprehensive coverage report across all modules. Use when asked for full project coverage overview or metrics."
---

Generate comprehensive coverage report across all modules. Use when asked for full project coverage overview or metrics.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-root "$(pwd)" --skip-tests $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$includeShared = $false
$minLines = 0
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    SkipTests = $true
    MinMissedLines = $minLines
}

if ($includeShared) { $params.IncludeShared = $true }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-parallel-coverage-suite.ps1" @params
```
