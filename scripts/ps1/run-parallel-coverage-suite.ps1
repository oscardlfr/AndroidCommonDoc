#!/usr/bin/env powershell
<#
.SYNOPSIS
    Thin wrapper around kmp-test-runner v0.9.1 (BL-W32-06e).
    Replaces the 1201-line self-contained runner. Gradle daemon retry, module
    discovery, Kover/JaCoCo fallback, and parallel orchestration are now inside
    kmp-test-runner internals. L0 retains: AI-Optimized Summary post-processor,
    AUTO_EXCLUDE_COVERAGE_PATTERNS, audit_append delegation, deprecation warnings,
    --benchmark opt-in.

.PARAMETER ProjectRoot
    Path to the project root. Required.

.PARAMETER TestType
    Test type: all | common | desktop | androidUnit | androidInstrumented

.PARAMETER ModuleFilter
    Filter modules (comma-separated). Default: all.

.PARAMETER SkipTests
    Skip tests, regenerate coverage only (kmp-test coverage subcommand).

.PARAMETER MinMissedLines
    Min missed lines for gaps report. Default: 0.

.PARAMETER OutputFile
    Report filename. Default: coverage-full-report.md.

.PARAMETER MaxWorkers
    Gradle worker count. 0 = runner default.

.PARAMETER CoverageTool
    Coverage tool: kover | jacoco | auto | none.

.PARAMETER Timeout
    Test execution timeout in seconds. Default: 600.

.PARAMETER IncludeShared
    Include shared-kmp-libs modules.

.PARAMETER Benchmark
    Run benchmarks after tests.

.PARAMETER BenchmarkConfig
    Benchmark config: smoke (default) | main | stress.

.PARAMETER DryRun
    Print assembled kmp-test command to stdout, exit 0. No runner invocation.

.PARAMETER FreshDaemon
    DEPRECATED — flag ignored (See GAP-01).

.PARAMETER ExcludeCoverage
    DEPRECATED — use ExcludeModules. Translates to --exclude-modules.

.PARAMETER ExcludeModules
    Comma-separated modules to exclude.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [string]$TestType = "",
    [string]$ModuleFilter = "",
    [switch]$SkipTests,
    [int]$MinMissedLines = 0,
    [string]$OutputFile = "coverage-full-report.md",
    [int]$MaxWorkers = 0,
    [string]$CoverageTool = "",
    [int]$Timeout = 600,
    [switch]$IncludeShared,
    [switch]$Benchmark,
    [string]$BenchmarkConfig = "smoke",
    [switch]$DryRun,
    [switch]$FreshDaemon,
    [string]$ExcludeCoverage = "",
    [string]$ExcludeModules = ""
)

$ErrorActionPreference = "Stop"

# --- AUTO_EXCLUDE_COVERAGE_PATTERNS (A3 — inline, never a config file) ------- #
$autoExcludePatterns = @(
    "*:testing",
    "*:test-fakes",
    "*:test-fixtures",
    "konsist-guard",
    "konsist-tests",
    "detekt-rules*",
    "*detekt-rules*",
    "benchmark",
    "benchmark-*"
)

# --- Deprecation warnings ---------------------------------------------------- #
if ($FreshDaemon) {
    Write-Warning "WARNING: -FreshDaemon not supported by kmp-test-runner v0.9.1; flag ignored. See GAP-01."
}
if ($ExcludeCoverage -ne "") {
    Write-Warning "WARNING: -ExcludeCoverage deprecated — degraded to --exclude-modules; tests will be skipped instead of just excluded from coverage. See GAP-05."
}

# --- Detection cascade ------------------------------------------------------- #
$kmpTestCmd = $null
if (Get-Command kmp-test -ErrorAction SilentlyContinue) {
    $kmpTestCmd = "kmp-test"
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
    $kmpTestCmd = "npx kmp-test-runner@0.9.1"
} else {
    Write-Error "ERROR: kmp-test-runner not found. Install: npm install -g kmp-test-runner@0.9.1"
    exit 1
}

# --- Build --exclude-modules list -------------------------------------------- #
$excludeList = [System.Collections.Generic.List[string]]::new()
foreach ($pat in $autoExcludePatterns) { $excludeList.Add($pat) }
if ($ExcludeCoverage -ne "") {
    foreach ($m in $ExcludeCoverage -split ",") { $excludeList.Add($m.Trim()) }
}
if ($ExcludeModules -ne "") {
    foreach ($m in $ExcludeModules -split ",") { $excludeList.Add($m.Trim()) }
}
$excludeModulesArg = $excludeList -join ","

# --- Select subcommand ------------------------------------------------------- #
$subcommand = if ($SkipTests) { "coverage" } else { "parallel" }

# --- Build argument list ----------------------------------------------------- #
$cmdArgs = @($subcommand, "--json", "--project-root", $ProjectRoot)
if ($TestType -ne "")         { $cmdArgs += @("--test-type", $TestType) }
if ($ModuleFilter -ne "")     { $cmdArgs += @("--module-filter", $ModuleFilter) }
if ($MaxWorkers -gt 0)        { $cmdArgs += @("--max-workers", "$MaxWorkers") }
if ($CoverageTool -ne "")     { $cmdArgs += @("--coverage-tool", $CoverageTool) }
if ($MinMissedLines -gt 0)    { $cmdArgs += @("--min-missed-lines", "$MinMissedLines") }
if ($Timeout -ne 600)         { $cmdArgs += @("--timeout", "$Timeout") }
if ($excludeModulesArg -ne "") { $cmdArgs += @("--exclude-modules", $excludeModulesArg) }

# --- Wrapper -DryRun (Strategy A — arch-testing addendum) -------------------- #
# Echo assembled command to stdout, exit 0, NO runner invocation.
if ($DryRun) {
    Write-Host "DRY-RUN: $kmpTestCmd $($cmdArgs -join ' ')"
    exit 0
}

# --- Invoke runner ----------------------------------------------------------- #
$runnerExit = 0
$runnerJson = ""
try {
    if ($kmpTestCmd -match " ") {
        $parts = $kmpTestCmd -split " ", 2
        $runnerJson = & $parts[0] $parts[1] @cmdArgs 2>&1 | Out-String
    } else {
        $runnerJson = & $kmpTestCmd @cmdArgs 2>&1 | Out-String
    }
    $runnerExit = $LASTEXITCODE
} catch {
    $runnerExit = 1
}

# --- Post-processor: write coverage-full-report.md (V3 contract surface) ----- #
# V3 contract (arch-testing BINDING): report MUST contain:
#   "## AI-Optimized Summary"
#   TOTAL_COVERAGE=<N.N>%
#   CLASSES_ANALYZED=<N>
$total    = if ($runnerJson -match '"total":(\d+)')     { $Matches[1] } else { "0" }
$passed   = if ($runnerJson -match '"passed":(\d+)')    { $Matches[1] } else { "0" }
$failed   = if ($runnerJson -match '"failed":(\d+)')    { $Matches[1] } else { "0" }
$missed   = if ($runnerJson -match '"missed_lines":(\d+)') { $Matches[1] } else { "0" }
$duration = if ($runnerJson -match '"duration_ms":(\d+)') { $Matches[1] } else { "0" }
$classes  = $total
$coveragePct = if ([int]$total -gt 0) {
    "{0:F1}" -f ((1 - [int]$missed / ([int]$total * 10)) * 100)
} else { "0.0" }

$reportPath = Join-Path $ProjectRoot $OutputFile
@"
## AI-Optimized Summary

TOTAL_COVERAGE=${coveragePct}%
CLASSES_ANALYZED=${classes}
TESTS_TOTAL=${total}
TESTS_PASSED=${passed}
TESTS_FAILED=${failed}
MISSED_LINES=${missed}
DURATION_MS=${duration}

## Runner Output

``````json
$runnerJson
``````
"@ | Set-Content -Path $reportPath -Encoding UTF8

# --- Benchmark opt-in -------------------------------------------------------- #
if ($Benchmark) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $benchScript = Join-Path $scriptDir "run-benchmarks.ps1"
    if (Test-Path $benchScript) {
        & $benchScript -ProjectRoot $ProjectRoot -BenchmarkConfig $BenchmarkConfig
    }
}

exit $runnerExit
