<!-- GENERATED from skills/test-full/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run all tests sequentially with full coverage report. Use when asked to run the complete test suite or generate a full coverage report."
---

Run all tests sequentially with full coverage report. Use when asked to run the complete test suite or generate a full coverage report.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$includeShared = $false
$testType = ""
$moduleFilter = "*"
$maxFailures = 0
$minLines = 0
$skipTests = $false
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--test-type" -and $i + 1 -lt $argList.Count) {
        $testType = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--module-filter" -and $i + 1 -lt $argList.Count) {
        $moduleFilter = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--max-failures" -and $i + 1 -lt $argList.Count) {
        $maxFailures = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--skip-tests") {
        $skipTests = $true
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    ModuleFilter = $moduleFilter
    MaxFailures = $maxFailures
    MinMissedLines = $minLines
}

if ($testType -ne "") { $params.TestType = $testType }
if ($includeShared) { $params.IncludeShared = $true }
if ($skipTests) { $params.SkipTests = $true }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-parallel-coverage-suite.ps1" @params
```
