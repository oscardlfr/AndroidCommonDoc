#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Find unused Android string resources.

.DESCRIPTION
    Extracts <string name="X"> entries from strings.xml files and checks
    for references (R.string.X, Res.string.X, @string/X) in .kt and .xml files.

.PARAMETER ProjectRoot
    Path to the project root.

.PARAMETER Module
    Optional module path to restrict the search.

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./unused-strings.ps1 -ProjectRoot "C:\Projects\MyApp"
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [string]$Module = "",

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: unused-strings.ps1 <project_root> [-Module <path>]"
    Write-Host ""
    Write-Host "Finds string resources not referenced in .kt or .xml files."
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
    exit 1
}

$searchRoot = $ProjectRoot
if (-not [string]::IsNullOrWhiteSpace($Module)) {
    $searchRoot = Join-Path $ProjectRoot $Module
}

if (-not (Test-Path $searchRoot -PathType Container)) {
    Write-Error "{`"error`":`"directory not found: $searchRoot`"}"
    exit 1
}

# --- Find strings.xml files ---
$stringFiles = Get-ChildItem -Path $searchRoot -Recurse -Filter "strings.xml" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' }

if (-not $stringFiles -or @($stringFiles).Count -eq 0) {
    Write-Output '{"total":0,"unused_count":0,"unused":[]}'
    exit 0
}

# --- Extract string names ---
$stringEntries = @{}  # name -> file
foreach ($sf in $stringFiles) {
    $content = Get-Content $sf.FullName -Raw -ErrorAction SilentlyContinue
    $matches_found = [regex]::Matches($content, '<string\s+name="([^"]+)"')
    foreach ($m in $matches_found) {
        $name = $m.Groups[1].Value
        $stringEntries[$name] = $sf.FullName
    }
}

$total = $stringEntries.Count

# --- Get all .kt and .xml files for reference checking ---
$ktFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' }
$xmlFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "*.xml" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' -and $_.Name -ne "strings.xml" }

# Pre-load all file contents for faster searching
$allKtContent = ""
if ($ktFiles) {
    $allKtContent = ($ktFiles | ForEach-Object { Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue }) -join "`n"
}
$allXmlContent = ""
if ($xmlFiles) {
    $allXmlContent = ($xmlFiles | ForEach-Object { Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue }) -join "`n"
}

# --- Check references ---
$unused = @()
foreach ($name in $stringEntries.Keys) {
    $found = $false

    # Check R.string.X or Res.string.X in Kotlin
    if ($allKtContent -match "R\.string\.$name\b|Res\.string\.$name\b") {
        $found = $true
    }

    # Check @string/X in XML
    if (-not $found -and $allXmlContent -match "@string/$name") {
        $found = $true
    }

    if (-not $found) {
        $relFile = $stringEntries[$name]
        try { $relFile = $stringEntries[$name].Replace($ProjectRoot, "").TrimStart('\', '/') } catch {}
        $unused += @{ name = $name; file = $relFile }
    }
}

# --- Output ---
$unusedJson = ($unused | ForEach-Object {
    "{`"name`":`"$($_.name)`",`"file`":`"$($_.file -replace '\\', '/')`"}"
}) -join ','

Write-Output "{`"total`":$total,`"unused_count`":$($unused.Count),`"unused`":[$unusedJson]}"
exit 0
