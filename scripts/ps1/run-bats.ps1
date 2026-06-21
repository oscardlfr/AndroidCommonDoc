# Windows PowerShell wrapper for run-bats.sh.
#
# Thin bridge — all logic lives in scripts/sh/run-bats.sh. This wrapper
# exists for cross-platform script parity (scripts/sh/ <-> scripts/ps1/).
# Requires bash on PATH (Git for Windows provides it).
#
# Runs npx bats and evaluates the output log authoritatively by ^not ok count
# (not by bats exit code). Accepts --log, --eval-only, --project-root, and
# trailing bats targets — all forwarded verbatim to the bash script.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'run-bats.sh'

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
