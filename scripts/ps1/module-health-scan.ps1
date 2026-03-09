#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Per-module health metrics (source files, test files, LOC).

.DESCRIPTION
    Reads settings.gradle.kts to list modules, then counts test files,
    source files, and lines of code per module. Outputs JSON to stdout.

.PARAMETER ProjectRoot
    Path to the Gradle project root.

.PARAMETER Modules
    Comma-separated list of modules to scan. Empty scans all.

.PARAMETER Format
    Output format: json (default) or text.

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./module-health-scan.ps1 -ProjectRoot "C:\Projects\MyApp"

.EXAMPLE
    ./module-health-scan.ps1 -ProjectRoot "C:\Projects\MyApp" -Modules ":app,:core:domain"
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [string]$Modules = "",

    [ValidateSet("json", "text")]
    [string]$Format = "json",

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: module-health-scan.ps1 <project_root> [-Modules mod1,mod2] [-Format json|text]"
    Write-Host ""
    Write-Host "Scans Gradle modules for source/test file counts and lines of code."
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
    exit 1
}

if (-not (Test-Path $ProjectRoot -PathType Container)) {
    Write-Error "{`"error`":`"directory not found: $ProjectRoot`"}"
    exit 1
}

# --- Find settings file ---
$settingsFile = Join-Path $ProjectRoot "settings.gradle.kts"
if (-not (Test-Path $settingsFile)) {
    $settingsFile = Join-Path $ProjectRoot "settings.gradle"
}
if (-not (Test-Path $settingsFile)) {
    Write-Error '{"error":"settings.gradle.kts not found"}'
    exit 1
}

# --- Discover modules ---
$moduleFilter = @()
if (-not [string]::IsNullOrWhiteSpace($Modules)) {
    $moduleFilter = $Modules -split ','
}

$settingsContent = Get-Content $settingsFile -Raw
$discoveredModules = [regex]::Matches($settingsContent, 'include\s*\(\s*"([^"]+)"') |
    ForEach-Object { $_.Groups[1].Value }

$results = @()

foreach ($mod in $discoveredModules) {
    if ($moduleFilter.Count -gt 0 -and $mod -notin $moduleFilter) { continue }

    $modPath = $mod -replace ':', '/'
    $modPath = $modPath.TrimStart('/')
    $fullPath = Join-Path $ProjectRoot $modPath

    if (-not (Test-Path $fullPath -PathType Container)) { continue }

    $srcFiles = 0
    $testFiles = 0
    $loc = 0

    # Source files (exclude test dirs and build)
    $ktFiles = Get-ChildItem -Path $fullPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '[\\/]build[\\/]' -and
            $_.FullName -notmatch '[\\/](test|androidTest|commonTest)[\\/]'
        }

    if ($ktFiles) {
        foreach ($f in $ktFiles) {
            $srcFiles++
            $loc += @(Get-Content $f.FullName -ErrorAction SilentlyContinue).Count
        }
    }

    # Test files
    $testKtFiles = Get-ChildItem -Path $fullPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '[\\/]build[\\/]' -and
            $_.FullName -match '[\\/](test|androidTest|commonTest)[\\/]'
        }

    if ($testKtFiles) {
        $testFiles = @($testKtFiles).Count
    }

    $results += @{ name = $mod; src_files = $srcFiles; test_files = $testFiles; loc = $loc }
}

# --- Output ---
if ($Format -eq "text") {
    Write-Host "Module Health Scan: $(Split-Path $ProjectRoot -Leaf)"
    foreach ($r in $results) {
        Write-Host "  $($r.name): src=$($r.src_files) test=$($r.test_files) loc=$($r.loc)"
    }
}
else {
    $modulesJson = ($results | ForEach-Object {
        "{`"name`":`"$($_.name)`",`"src_files`":$($_.src_files),`"test_files`":$($_.test_files),`"loc`":$($_.loc)}"
    }) -join ','
    Write-Output "{`"modules`":[$modulesJson]}"
}

exit 0
