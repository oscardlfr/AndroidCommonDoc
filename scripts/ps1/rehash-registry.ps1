# Windows PowerShell wrapper for rehash-registry.sh
#
# Thin bridge — all logic lives in scripts/sh/rehash-registry.sh. This wrapper exists
# for cross-platform script parity (scripts/sh/ ↔ scripts/ps1/). Requires
# bash on PATH (Git for Windows provides it).
#
# Recompute skills/registry.json hashes

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'rehash-registry.sh'

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
