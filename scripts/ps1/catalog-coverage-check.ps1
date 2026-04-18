# Windows PowerShell wrapper for catalog-coverage-check.sh (T-BUG-009)
#
# Thin bridge — all logic lives in scripts/sh/catalog-coverage-check.sh.
# This wrapper exists for cross-platform script parity. Requires bash on
# PATH (Git for Windows provides it).
#
# Detects hardcoded Gradle dependency versions in *.gradle.kts files that
# could use a version catalog alias instead.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'catalog-coverage-check.sh'

if (-not (Test-Path $shScript)) {
    Write-Error "Companion bash script not found: $shScript"
    exit 2
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
    Write-Error "bash not found on PATH. Install Git for Windows: https://git-scm.com/download/win"
    exit 2
}

& $bash.Source $shScript @ArgList
exit $LASTEXITCODE
