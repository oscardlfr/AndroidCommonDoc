#!/usr/bin/env powershell
<#
.SYNOPSIS
    Thin wrapper around kmp-test-runner v0.9.0 changed subcommand (BL-W32-06e).
    Replaces 274-line script that delegated to run-parallel-coverage-suite.ps1.
    Git change detection, module-to-path mapping, and test dispatch are now
    inside kmp-test-runner internals. L0 retains: -IncludeShared glue,
    -ShowModulesOnly → --dry-run translation, wrapper -DryRun echo,
    -ExcludeCoverage deprecation warning.

.PARAMETER ProjectRoot
    Path to the project root. Required.

.PARAMETER IncludeShared
    Include changes in shared-kmp-libs.

.PARAMETER TestType
    Test type: all | common | androidUnit | androidInstrumented | desktop.

.PARAMETER StagedOnly
    Only consider staged files (git add).

.PARAMETER ShowModulesOnly
    Show detected modules without running tests (maps to kmp-test changed --dry-run).

.PARAMETER MinMissedLines
    Min missed lines for gaps report. Default: 0.

.PARAMETER CoverageTool
    Coverage tool: jacoco | kover | auto | none.

.PARAMETER ExcludeCoverage
    DEPRECATED — translates to --exclude-modules.

.PARAMETER DryRun
    Print assembled kmp-test command to stdout, exit 0. No runner invocation.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [switch]$IncludeShared,
    [string]$TestType = "",
    [switch]$StagedOnly,
    [switch]$ShowModulesOnly,
    [int]$MinMissedLines = 0,
    [string]$CoverageTool = "",
    [string]$ExcludeCoverage = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$sharedRoot = "C:\Users\34645\AndroidStudioProjects\shared-kmp-libs"

# --- Deprecation warning ----------------------------------------------------- #
if ($ExcludeCoverage -ne "") {
    Write-Warning "WARNING: -ExcludeCoverage deprecated — degraded to --exclude-modules; tests will be skipped instead of just excluded from coverage. See GAP-05."
}

# --- Detection cascade ------------------------------------------------------- #
$kmpTestCmd = $null
if (Get-Command kmp-test -ErrorAction SilentlyContinue) {
    $kmpTestCmd = "kmp-test"
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
    $kmpTestCmd = "npx kmp-test-runner@0.9.0"
} else {
    Write-Error "ERROR: kmp-test-runner not found. Install: npm install -g kmp-test-runner@0.9.0"
    exit 1
}

# --- Build argument list ----------------------------------------------------- #
$cmdArgs = @("changed", "--project-root", $ProjectRoot)
if ($StagedOnly)              { $cmdArgs += "--staged-only" }
if ($ShowModulesOnly)         { $cmdArgs += "--dry-run" }
if ($TestType -ne "")         { $cmdArgs += @("--test-type", $TestType) }
if ($CoverageTool -ne "")     { $cmdArgs += @("--coverage-tool", $CoverageTool) }
if ($MinMissedLines -gt 0)    { $cmdArgs += @("--min-missed-lines", "$MinMissedLines") }
if ($ExcludeCoverage -ne "")  { $cmdArgs += @("--exclude-modules", $ExcludeCoverage) }

# -IncludeShared: pass shared-kmp-libs root so runner detects changes there
if ($IncludeShared) {
    $cmdArgs += @("--project-root", $sharedRoot)
}

# --- Wrapper -DryRun (Strategy A — arch-testing addendum) -------------------- #
# Echo assembled command to stdout, exit 0, NO runner invocation.
if ($DryRun) {
    Write-Host "DRY-RUN: $kmpTestCmd $($cmdArgs -join ' ')"
    exit 0
}

# --- Invoke runner ----------------------------------------------------------- #
if ($kmpTestCmd -match " ") {
    $parts = $kmpTestCmd -split " ", 2
    & $parts[0] $parts[1] @cmdArgs
} else {
    & $kmpTestCmd @cmdArgs
}
exit $LASTEXITCODE
