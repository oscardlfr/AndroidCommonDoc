# Windows PowerShell wrapper for skill-leak-check.sh.
#
# Thin bridge — all logic lives in scripts/sh/skill-leak-check.sh. This
# wrapper exists for cross-platform script parity (scripts/sh/ ↔ scripts/ps1/).
# Requires bash on PATH (Git for Windows provides it).
#
# Detects skill description leakage: Bash calls made when a skill wrapper
# exists for that operation. Reads .androidcommondoc/tool-use-log.jsonl.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'skill-leak-check.sh'

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
