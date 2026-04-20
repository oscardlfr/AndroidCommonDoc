---
name: test-full
description: "Run all tests sequentially with full coverage report. Use when asked to run the complete test suite or generate a full coverage report."
intent: [test, full, sequential, coverage, suite]
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/test-full
/test-full --include-shared
/test-full --module-filter "core-oauth*,core-error-oauth"
/test-full --test-type androidUnit
/test-full --skip-tests --min-lines 5
/test-full --benchmark
/test-full --benchmark --benchmark-config main
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include shared library modules in test execution and report.
- `test-type` -- Test type: `common`, `desktop`, `androidUnit`, `all` (default: auto-detect).
- `module-filter` -- Filter modules by pattern (wildcards supported, default: `*`).
- `min-missed-lines` -- Only show classes with >= N missed lines (default: 0).
- `skip-tests` -- Skip test execution, use existing coverage data.
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `benchmark` -- Run benchmarks after tests/coverage (default: off).
- `benchmark-config` -- Benchmark config: `smoke` (default), `main`, `stress`.
- `project-root` -- Path to the project root directory.

## Behavior

1. Auto-detect project type:
   - KMP app (has `desktopApp` folder) -- uses `desktopTest`.
   - KMP library (name contains `kmp` or `shared-kmp`) -- uses `desktopTest`.
   - KMP module (has `kotlin.multiplatform` + `jvm("desktop")`) -- uses `desktopTest`.
   - Android -- uses `testDebugUnitTest`.
2. Discover all modules in the project (and the shared library if `--include-shared`).
3. Run tests sequentially per module (1 Gradle invocation per module).
4. Generate coverage report per module.
5. Produce consolidated coverage summary and gap analysis.
6. Save comprehensive Markdown report to `coverage-full-report.md`.
7. If `--benchmark`: run benchmark suite, parse JSON results, save `benchmark-report.md`.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

> **Claude Code agents**: Always use the `macOS / Linux` path below, regardless of host OS.
> Claude Code agents run in bash (`/usr/bin/bash`) on all platforms including Windows.

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
$minLines = 0
$skipTests = $false
$coverageTool = ""
$benchmark = $false
$benchmarkConfig = "smoke"

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--test-type" -and $i + 1 -lt $argList.Count) {
        $testType = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--module-filter" -and $i + 1 -lt $argList.Count) {
        $moduleFilter = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--skip-tests") {
        $skipTests = $true
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--benchmark") {
        $benchmark = $true
    } elseif ($arg -eq "--benchmark-config" -and $i + 1 -lt $argList.Count) {
        $benchmarkConfig = $argList[$i + 1]; $i++
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
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }
if ($benchmark) { $params.Benchmark = $true; $params.BenchmarkConfig = $benchmarkConfig }

& "$commonDoc\scripts\ps1\run-parallel-coverage-suite.ps1" @params
```

## Expected Output

**On success:**
- Console: Per-module test results (pass/fail) and coverage percentage
- Console: Module coverage summary table
- Console: Coverage gaps with class names, missed percentages, and line ranges
- File: `coverage-full-report.md` with complete breakdown

**On failure:**
- Test failure details per module
- Gradle build output for diagnosis

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-parallel-coverage-suite.sh`, `scripts/ps1/run-parallel-coverage-suite.ps1`
- Related: `/test` (single module), `/coverage` (gap analysis), `/auto-cover` (auto-generate tests), `/benchmark` (standalone benchmarks)
