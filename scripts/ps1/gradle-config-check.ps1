#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Check Gradle config hygiene (convention plugins, hardcoded versions).

.DESCRIPTION
    Checks for buildscript{} block usage, hardcoded dependency versions,
    and convention plugin adoption. Outputs JSON findings to stdout.

.PARAMETER ProjectRoot
    Path to the Gradle project root.

.PARAMETER Strict
    Enable strict checks (convention plugin usage verification).

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./gradle-config-check.ps1 -ProjectRoot "C:\Projects\MyApp" -Strict
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [switch]$Strict,

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: gradle-config-check.ps1 <project_root> [-Strict]"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
    exit 1
}

$findings = @()

function Add-Finding {
    param([string]$Module, [string]$Issue, [string]$Detail)
    $script:findings += @{ module = $Module; issue = $Issue; detail = $Detail }
}

# --- Get all build.gradle.kts files ---
$buildFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "build.gradle.kts" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '[\\/]build[\\/]' -and
        $_.FullName -notmatch '[\\/]\.gradle[\\/]'
    }

if (-not $buildFiles) {
    Write-Output '{"findings":[]}'
    exit 0
}

foreach ($bf in $buildFiles) {
    $content = Get-Content $bf.FullName -Raw -ErrorAction SilentlyContinue
    $relDir = (Split-Path $bf.FullName -Parent).Replace($ProjectRoot, "").TrimStart('\', '/')
    if ([string]::IsNullOrWhiteSpace($relDir)) { $relDir = "." }
    $module = $relDir -replace '\\', '/'

    # Check 1: buildscript {} blocks
    if ($content -match 'buildscript\s*\{') {
        Add-Finding -Module $module -Issue "buildscript_block" -Detail "Uses legacy buildscript{} block instead of plugins{} DSL"
    }

    # Check 2: Hardcoded versions in dependency declarations
    $depMatches = [regex]::Matches($content, '(implementation|api|compileOnly|runtimeOnly)\s*\(\s*"[^"]+:\d+\.[^"]*"')
    foreach ($dm in $depMatches) {
        $line = $dm.Value
        # Skip version catalog references
        if ($line -match 'libs\.|catalog\.|version\.ref') { continue }
        $detail = $line.Trim()
        if ($detail.Length -gt 120) { $detail = $detail.Substring(0, 120) }
        Add-Finding -Module $module -Issue "hardcoded_version" -Detail $detail
    }

    # Check 3: Excessive direct plugin applications
    $pluginCount = ([regex]::Matches($content, '^\s*id\s*\(', [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count
    if ($pluginCount -gt 10) {
        Add-Finding -Module $module -Issue "excessive_plugins" -Detail "Module applies $pluginCount plugins directly"
    }
}

# --- Strict mode checks ---
if ($Strict) {
    # Check for build-logic directory
    $buildLogicDir = Join-Path $ProjectRoot "build-logic"
    if (-not (Test-Path $buildLogicDir -PathType Container)) {
        Add-Finding -Module "project" -Issue "no_build_logic" -Detail "No build-logic/ directory found for convention plugins"
    }

    # Check modules not using convention plugins
    foreach ($bf in $buildFiles) {
        $content = Get-Content $bf.FullName -Raw -ErrorAction SilentlyContinue
        $relDir = (Split-Path $bf.FullName -Parent).Replace($ProjectRoot, "").TrimStart('\', '/')
        if ([string]::IsNullOrWhiteSpace($relDir) -or $relDir -eq ".") { continue }
        if ($relDir -match '^build-logic') { continue }
        $module = $relDir -replace '\\', '/'

        $hasConvention = $false
        if ($content -match 'id\s*\(\s*"[a-z]+\.(android|kotlin|kmp)\.') { $hasConvention = $true }
        if ($content -match 'alias\s*\(libs\.plugins\.') { $hasConvention = $true }

        if (-not $hasConvention -and $content -match 'plugins\s*\{') {
            Add-Finding -Module $module -Issue "no_convention_plugin" -Detail "Module does not use a convention plugin"
        }
    }
}

# --- Output ---
$findingsJson = ($findings | ForEach-Object {
    $det = $_.detail -replace '"', '\"'
    "{`"module`":`"$($_.module)`",`"issue`":`"$($_.issue)`",`"detail`":`"$det`"}"
}) -join ','

Write-Output "{`"findings`":[$findingsJson]}"
exit 0
