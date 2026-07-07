# Windows PowerShell wrapper for write-coordination-artifact.sh.
#
# Thin bridge — all logic lives in scripts/sh/write-coordination-artifact.sh. This
# wrapper exists for cross-platform script parity (scripts/sh/ <-> scripts/ps1/).
# Requires bash on PATH (Git for Windows provides it).
#
# Writes portable coordination artifacts (message, consult, result, request, approval,
# stop) under .planning/wave-<slug>/. Stdin (the optional kind-specific JSON body) is
# inherited/forwarded to the underlying bash process unchanged — this wrapper does not
# touch it, so piping a body in (e.g. `Get-Content body.json | .\write-coordination-artifact.ps1 ...`)
# behaves the same as on the bash side.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'write-coordination-artifact.sh'

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
