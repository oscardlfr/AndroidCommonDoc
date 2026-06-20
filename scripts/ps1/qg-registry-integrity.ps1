# Windows PowerShell wrapper for qg-registry-integrity.sh.
#
# Thin bridge — all logic lives in scripts/sh/qg-registry-integrity.sh. This
# wrapper exists for cross-platform script parity (scripts/sh/ <-> scripts/ps1/).
# Requires bash on PATH (Git for Windows provides it).
#
# Runs QG registry integrity checks (hash drift + count compare + SKILL.md presence)
# and writes a 3-state JSON report to <project-root>/.androidcommondoc/registry-hash-report.json.
#
# Args:
#   --project-root <path>   Project root to validate (default: ANDROID_COMMON_DOC or script parent)
#   --require-registry      Missing skills/registry.json is exit 2, not n/a
#
# Exit codes:
#   0 = clean or n/a (no registry + flag not set)
#   1 = bad arguments
#   2 = drift detected (fail-closed)

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'qg-registry-integrity.sh'

if (-not (Test-Path $shScript)) {
    Write-Error "Companion bash script not found: $shScript"
    exit 1
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
    Write-Error "bash not found on PATH. Install Git for Windows: https://git-scm.com/download/win"
    exit 1
}

if ($null -eq $ArgList) { $ArgList = @() }

& $bash.Source $shScript @ArgList
exit $LASTEXITCODE
