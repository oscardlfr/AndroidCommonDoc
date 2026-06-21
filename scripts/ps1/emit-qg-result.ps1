# Windows PowerShell wrapper for emit-qg-result.sh.
#
# Thin bridge — all logic lives in scripts/sh/emit-qg-result.sh. This wrapper
# exists for cross-platform script parity (scripts/sh/ <-> scripts/ps1/).
# Requires bash on PATH (Git for Windows provides it).
#
# Writes .planning/wave-<slug>/qg-result.json (gitignored) as the orchestrator-
# facing QG verdict signal. Does NOT touch push-proof.json or verify-proof.
# Accepts --init, --phase, --report, --bats-log, --out, --slug, --project-root
# — all forwarded verbatim to the bash script.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'emit-qg-result.sh'

if (-not (Test-Path $shScript)) {
    Write-Error "Companion bash script not found: $shScript"
    exit 2
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
    Write-Error "bash not found on PATH. Install Git for Windows: https://git-scm.com/download/win"
    exit 2
}

if ($null -eq $ArgList) { $ArgList = @() }

& $bash.Source $shScript @ArgList
exit $LASTEXITCODE
