# Windows PowerShell wrapper for qg-doc-validators.sh.
#
# Thin bridge — all logic lives in scripts/sh/qg-doc-validators.sh. This
# wrapper exists for cross-platform script parity (scripts/sh/ <-> scripts/ps1/).
# Requires bash on PATH (Git for Windows provides it).
#
# Runs QG doc-coverage validators (cross-refs + doc-structure vitest) and writes
# a combined JSON report to <project-root>/.androidcommondoc/doc-validator-report.json.
#
# Args:
#   --project-root <path>      Project root to validate (default: $PWD)
#   --toolkit-root <path>      L0 toolkit root with mcp-server/ (default: $ANDROID_COMMON_DOC or $PWD)
#   --only cross-refs|structure|all  Subchecks to run (default: all)
#   --output-format json|human       Output format (default: human)
#
# Exit codes:
#   0 = all executed subchecks PASS or SKIP
#   1 = bad arguments
#   2 = one or more subchecks FAIL

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'qg-doc-validators.sh'

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
