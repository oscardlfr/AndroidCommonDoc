<!-- GENERATED from skills/test-changed/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run tests only on modules with uncommitted changes. Use when asked to test changed files or run a quick pre-commit check."
---

Run tests only on modules with uncommitted changes. Use when asked to test changed files or run a quick pre-commit check.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-changed-modules-tests.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$includeShared = $false
$testType = ""
$stagedOnly = $false
$showModulesOnly = $false
$maxFailures = 0
$minLines = 0
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--test-type" -and $i + 1 -lt $argList.Count) {
        $testType = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--staged-only") {
        $stagedOnly = $true
    } elseif ($arg -eq "--show-modules") {
        $showModulesOnly = $true
    } elseif ($arg -eq "--max-failures" -and $i + 1 -lt $argList.Count) {
        $maxFailures = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    MaxFailures = $maxFailures
    MinMissedLines = $minLines
}

if ($testType -ne "") { $params.TestType = $testType }
if ($includeShared) { $params.IncludeShared = $true }
if ($stagedOnly) { $params.StagedOnly = $true }
if ($showModulesOnly) { $params.ShowModulesOnly = $true }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-changed-modules-tests.ps1" @params
```
