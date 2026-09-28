# Windows PowerShell wrapper for list-valid-commit-tokens.sh.
#
# The launcher supplies separate consumer and toolkit roots. Keep GNU argument
# names intact while Git for Windows Bash executes the shared implementation.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgList
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path $PSScriptRoot -Parent
$shScript = Join-Path $scriptsRoot 'sh' 'list-valid-commit-tokens.sh'

if (-not (Test-Path $shScript)) {
    Write-Error "Companion bash script not found: $shScript"
    exit 2
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
    Write-Error 'bash not found on PATH. Install Git for Windows: https://git-scm.com/download/win'
    exit 2
}

if ($null -eq $ArgList) { $ArgList = @() }
& $bash.Source $shScript @ArgList
exit $LASTEXITCODE
