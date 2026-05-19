#!/usr/bin/env powershell
<#
.SYNOPSIS
    Thin wrapper around kmp-test-runner v0.10.1 (BL-W32-06a).
    Replaces the 489-line self-contained runner. All daemon retry, Kover
    fallback, and JDK detection logic is now inside kmp-test-runner internals.

.PARAMETER ProjectRoot
    Path to the project root. Defaults to current directory.

.PARAMETER Module
    Module filter (e.g., :core-domain). Passed as --module-filter.

.PARAMETER TestType
    Test type: all|common|desktop|androidUnit|androidInstrumented.
    all|common|desktop → parallel subcommand.
    androidUnit|androidInstrumented → android subcommand.

.PARAMETER SkipCoverage
    Pass --no-coverage to kmp-test.

.PARAMETER CoverageTool
    Pass-through to --coverage-tool.

.PARAMETER Timeout
    Test execution timeout in seconds.

.PARAMETER DryRun
    Print constructed command, exit 0.
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = "",

    [Parameter(Position = 0)]
    [string]$Module = "",

    [Parameter(Mandatory = $false)]
    [string]$TestType = "",

    [Parameter(Mandatory = $false)]
    [switch]$SkipCoverage,

    [Parameter(Mandatory = $false)]
    [string]$CoverageTool = "",

    [Parameter(Mandatory = $false)]
    [string]$Timeout = "",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(ValueFromRemainingArguments)]
    [string[]]$PassthroughArgs = @()
)

$ErrorActionPreference = "Stop"

# --- Detection cascade ------------------------------------------------------- #
$kmpTestCmd = $null
if (Get-Command kmp-test -ErrorAction SilentlyContinue) {
    $kmpTestCmd = "kmp-test"
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
    $kmpTestCmd = "npx kmp-test-runner@0.10.1"
} else {
    Write-Error "ERROR: kmp-test-runner not found. Install: npm install -g kmp-test-runner@0.10.1"
    exit 1
}

# --- Subcommand selection ---------------------------------------------------- #
# all|common|desktop|"" → parallel
# androidUnit|androidInstrumented → android
$subcommand = switch ($TestType) {
    "androidUnit"          { "android" }
    "androidInstrumented"  { "android" }
    default                { "parallel" }
}

# --- Build argument list ----------------------------------------------------- #
$cmdArgs = @($subcommand)
if ($ProjectRoot -ne "")  { $cmdArgs += @("--project-root", $ProjectRoot) }
if ($Module -ne "")       { $cmdArgs += @("--module-filter", $Module) }
if ($TestType -ne "")     { $cmdArgs += @("--test-type", $TestType) }
if ($SkipCoverage)        { $cmdArgs += "--no-coverage" }
if ($CoverageTool -ne "") { $cmdArgs += @("--coverage-tool", $CoverageTool) }
if ($Timeout -ne "")      { $cmdArgs += @("--timeout", $Timeout) }
if ($DryRun)              { $cmdArgs += "--dry-run" }
if ($PassthroughArgs.Count -gt 0) { $cmdArgs += $PassthroughArgs }

if ($DryRun) {
    Write-Host "DRY-RUN: $kmpTestCmd $($cmdArgs -join ' ')"
    exit 0
}

# Split cmd if it contains spaces (npx case)
if ($kmpTestCmd -match " ") {
    $parts = $kmpTestCmd -split " ", 2
    & $parts[0] $parts[1] @cmdArgs
} else {
    & $kmpTestCmd @cmdArgs
}
exit $LASTEXITCODE
