# Windows PowerShell wrapper for local-ci.sh.
#
# Thin bridge -- all logic lives in scripts/sh/local-ci.sh. This wrapper exists for cross-platform script parity
# (scripts/sh/ <-> scripts/ps1/). Requires bash on PATH (Git for Windows provides it).
#
# Runs what GitHub CI runs for the shell and hook tests, with the engine chosen in .androidcommondoc/local-ci.json
# (act, native or none). Accepts --project-root, --engine, --job, --shards, --max-parallel, --dry-run, -h/--help, all forwarded verbatim.
# Exit codes: 0 passed, 1 a test job failed, 2 usage/configuration/precondition error.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'local-ci.sh'

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
