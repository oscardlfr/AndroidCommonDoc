---
name: coverage
description: "Analyze test coverage gaps from existing data without running tests. Use when asked to check coverage or find untested code."
intent: [coverage, gaps, untested, analyze, report]
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/coverage
/coverage --module-filter "core:domain"
/coverage --module-filter "core:data" --min-lines 10
/coverage --coverage-tool kover
```

## Parameters

Uses parameters from `params.json`:
- `module-filter` -- Filter modules by pattern (default: all).
- `min-missed-lines` -- Minimum missed lines to include a class in the report (default: 5).
- `coverage-tool` -- Coverage tool to use: `jacoco`, `kover`, `auto`, `none`.
- `skip-tests` -- Always `true` for this skill; analyzes existing coverage data.
- `project-root` -- Path to the project root directory.

## Behavior

1. Use existing coverage data (does NOT run tests -- uses `--skip-tests` internally).
2. Parse coverage data per module using the specified coverage tool.
3. Generate gap analysis report with missed line numbers.
4. Save Markdown report to `coverage-full-report.md` in project root.

**CRITICAL:** Do NOT read XML coverage files directly. Do NOT parse JaCoCo/Kover reports manually. Do NOT explore `build/reports` folders. Trust the script output.

## Implementation

> **Claude Code agents**: Always use the `macOS / Linux` path below, regardless of host OS.
> Claude Code agents run in bash (`/usr/bin/bash`) on all platforms including Windows.

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-root "$(pwd)" --skip-tests --min-lines "${MIN_LINES:-5}" $ARGUMENTS
```

### Windows
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

## Expected Output

**On success:**
- Overall coverage percentage per module
- Lines needed to reach target
- Top files with coverage gaps:
  - File name and path
  - Current coverage %
  - Missed line ranges (e.g., L45-L52, L67)
- Markdown report saved to `coverage-full-report.md`

**On failure:**
- Script error message (do NOT attempt manual analysis)

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-parallel-coverage-suite.sh`, `scripts/ps1/run-parallel-coverage-suite.ps1`
