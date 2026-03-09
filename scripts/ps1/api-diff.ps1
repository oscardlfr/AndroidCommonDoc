#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Detect public API changes between git refs.

.DESCRIPTION
    Runs git diff between branches, parses for public API changes
    (fun, class, interface, val, var), and classifies them as
    breaking, additions, or compatible.

.PARAMETER ProjectRoot
    Path to the git project root.

.PARAMETER Base
    Base git ref (default: main).

.PARAMETER Head
    Head git ref (default: HEAD).

.PARAMETER Scope
    Scope filter: commonMain or all (default: all).

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./api-diff.ps1 -ProjectRoot "C:\Projects\MyApp" -Base "main" -Head "feature/auth"
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [string]$Base = "main",

    [string]$Head = "HEAD",

    [ValidateSet("commonMain", "all")]
    [string]$Scope = "all",

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: api-diff.ps1 <project_root> [-Base main] [-Head HEAD] [-Scope commonMain|all]"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
    exit 1
}

# --- Get diff ---
$diffFilter = "*.kt"
if ($Scope -eq "commonMain") {
    $diffFilter = "*/commonMain/*.kt"
}

$diffOutput = ""
try {
    $diffOutput = & git -C $ProjectRoot diff "$Base...$Head" -- $diffFilter 2>$null
} catch {}

if ([string]::IsNullOrWhiteSpace($diffOutput)) {
    Write-Output '{"breaking":[],"additions":[],"compatible":0}'
    exit 0
}

$diffLines = $diffOutput -split "`n"

$apiPattern = '^\s*(public\s+)?(fun |class |interface |val |var |object |enum )'
$privatePattern = '(private|internal|protected)\s+'

$breaking = @()
$additions = @()
$compatible = 0

foreach ($line in $diffLines) {
    # Removed lines (breaking)
    if ($line -match '^-[^-]' -and $line -notmatch '^---') {
        $trimmed = $line.TrimStart('-').Trim()
        if ($trimmed -match $apiPattern -and $trimmed -notmatch $privatePattern) {
            $symbol = $trimmed -replace '\{.*', ''
            $breaking += @{ change = "removed"; symbol = $symbol.Trim() }
        }
    }
    # Added lines (additions)
    elseif ($line -match '^\+[^\+]' -and $line -notmatch '^\+\+\+') {
        $trimmed = $line.TrimStart('+').Trim()
        if ($trimmed -match $apiPattern -and $trimmed -notmatch $privatePattern) {
            $symbol = $trimmed -replace '\{.*', ''
            $additions += @{ change = "added"; symbol = $symbol.Trim() }
        }
        $compatible++
    }
}

# --- Output ---
$breakingJson = ($breaking | ForEach-Object {
    $sym = $_.symbol -replace '"', '\"'
    "{`"change`":`"$($_.change)`",`"symbol`":`"$sym`"}"
}) -join ','

$additionsJson = ($additions | ForEach-Object {
    $sym = $_.symbol -replace '"', '\"'
    "{`"change`":`"$($_.change)`",`"symbol`":`"$sym`"}"
}) -join ','

Write-Output "{`"breaking`":[$breakingJson],`"additions`":[$additionsJson],`"compatible`":$compatible}"
exit 0
