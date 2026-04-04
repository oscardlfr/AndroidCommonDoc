---
name: test-full-parallel
description: "Run all tests in parallel with coverage. Use when asked to run the full test suite fast or with parallel execution."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/test-full-parallel
/test-full-parallel --include-shared
/test-full-parallel --module-filter "core:data"
/test-full-parallel --fresh-daemon
/test-full-parallel --skip-tests --min-lines 5
/test-full-parallel --coverage-only
/test-full-parallel --max-workers 4
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include the shared library project in test execution and report.
- `test-type` -- Test type: `common`, `desktop`, `androidUnit`, `all` (default: auto-detect).
- `module-filter` -- Filter modules by pattern (wildcards supported).
- `max-workers` -- Override Gradle worker count (default: auto based on CPU).
- `min-missed-lines` -- Only show classes with >= N missed lines (default: 0).
- `skip-tests` -- Skip test execution, regenerate report from existing data.
- `fresh-daemon` -- Stop existing Gradle daemons before starting.
- `coverage-only` -- Only run modules specified by `coverage-modules`.
- `coverage-modules` -- Comma-separated module patterns for coverage-only mode.
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `project-root` -- Path to the project root directory.

## Behavior

1. Auto-detect project type (KMP vs Android) for test task selection.
2. Discover all modules in the project (and the shared library if `--include-shared`).
3. Optionally stop existing Gradle daemons (`--fresh-daemon`).
4. Run tests using a SINGLE Gradle invocation with `--parallel` flag.
5. Reuse Gradle daemon across all modules (no per-module JVM cold starts).
6. Generate coverage report per module.
7. Produce consolidated coverage summary and gap analysis.
8. Save comprehensive Markdown report to `coverage-full-report.md`.

**Key difference vs /test-full:** Uses 1 Gradle invocation instead of N, achieving ~2-3x speedup.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$includeShared = $false
$testType = ""
$moduleFilter = "*"
$maxWorkers = 0
$minLines = 0
$skipTests = $false
$freshDaemon = $false
$coverageOnly = $false
$coverageModules = ""
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--test-type" -and $i + 1 -lt $argList.Count) {
        $testType = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--module-filter" -and $i + 1 -lt $argList.Count) {
        $moduleFilter = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--max-workers" -and $i + 1 -lt $argList.Count) {
        $maxWorkers = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--skip-tests") {
        $skipTests = $true
    } elseif ($arg -eq "--fresh-daemon") {
        $freshDaemon = $true
    } elseif ($arg -eq "--coverage-only") {
        $coverageOnly = $true
    } elseif ($arg -eq "--coverage-modules" -and $i + 1 -lt $argList.Count) {
        $coverageModules = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    ModuleFilter = $moduleFilter
    MinMissedLines = $minLines
}

if ($testType -ne "") { $params.TestType = $testType }
if ($includeShared) { $params.IncludeShared = $true }
if ($skipTests) { $params.SkipTests = $true }
if ($freshDaemon) { $params.FreshDaemon = $true }
if ($coverageOnly) { $params.CoverageOnly = $true }
if ($coverageModules -ne "") { $params.CoverageModules = $coverageModules }
if ($maxWorkers -gt 0) { $params.MaxWorkers = $maxWorkers }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-parallel-coverage-suite.ps1" @params
```

## Expected Output

**On success:**
- Console: Live progress with pass/fail/coverage per module
- Console: Module coverage summary table and coverage gaps
- File: `coverage-full-report.md` with complete breakdown

**On failure:**
- Test failure details
- Gradle build output for diagnosis

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-parallel-coverage-suite.sh`, `scripts/ps1/run-parallel-coverage-suite.ps1`
- Related: `/test-full` (sequential), `/coverage-full` (report only)
