#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Per-module code metrics (LOC, files, public functions).

.DESCRIPTION
    Counts .kt files, LOC, test LOC, and public functions per module.
    Outputs JSON to stdout.

.PARAMETER ProjectRoot
    Path to the Gradle project root.

.PARAMETER Modules
    Comma-separated list of modules to scan. Empty scans all.

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./code-metrics.ps1 -ProjectRoot "C:\Projects\MyApp"
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [string]$Modules = "",

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: code-metrics.ps1 <project_root> [-Modules mod1,mod2]"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
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

    $modPath = ($mod -replace ':', '/').TrimStart('/')
    $fullPath = Join-Path $ProjectRoot $modPath
    if (-not (Test-Path $fullPath -PathType Container)) { continue }

    $prodLoc = 0
    $testLoc = 0
    $files = 0
    $publicFns = 0

    # Production files
    $prodFiles = Get-ChildItem -Path $fullPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '[\\/]build[\\/]' -and
            $_.FullName -notmatch '[\\/](test|androidTest|commonTest)[\\/]'
        }

    if ($prodFiles) {
        foreach ($f in $prodFiles) {
            $files++
            $lines = @(Get-Content $f.FullName -ErrorAction SilentlyContinue)
            $prodLoc += $lines.Count

            # Count public functions (fun declarations minus private/internal/protected)
            $allFns = @($lines | Where-Object { $_ -match '^\s*(public\s+)?fun\s+' }).Count
            $privateFns = @($lines | Where-Object { $_ -match '^\s*(private|internal|protected)\s+fun\s+' }).Count
            $publicFns += ($allFns - $privateFns)
        }
    }

    # Test files
    $testFiles = Get-ChildItem -Path $fullPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '[\\/]build[\\/]' -and
            $_.FullName -match '[\\/](test|androidTest|commonTest)[\\/]'
        }

    if ($testFiles) {
        foreach ($f in $testFiles) {
            $testLoc += @(Get-Content $f.FullName -ErrorAction SilentlyContinue).Count
        }
    }

    $results += @{
        name       = $mod
        prod_loc   = $prodLoc
        test_loc   = $testLoc
        files      = $files
        public_fns = $publicFns
    }
}

# --- Output ---
$modulesJson = ($results | ForEach-Object {
    "{`"name`":`"$($_.name)`",`"prod_loc`":$($_.prod_loc),`"test_loc`":$($_.test_loc),`"files`":$($_.files),`"public_fns`":$($_.public_fns)}"
}) -join ','

Write-Output "{`"modules`":[$modulesJson]}"
exit 0
