#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Analyzes SBOM files for dependency statistics, licenses, and potential concerns.

.DESCRIPTION
    Parses CycloneDX JSON SBOM files and provides:
    - Component count and types
    - Top publishers and dependency groups
    - License distribution
    - Potential concerns (GPL, missing versions)

.PARAMETER ProjectRoot
    Path to the project root. Required.

.PARAMETER Module
    Specific module to analyze (e.g., androidApp). Optional.
    If not specified, analyzes the first SBOM found.

.PARAMETER SbomPath
    Direct path to a specific SBOM file. Overrides Module parameter.

.EXAMPLE
    ./analyze-sbom.ps1 -ProjectRoot "C:\Projects\MyApp"

.EXAMPLE
    ./analyze-sbom.ps1 -ProjectRoot "C:\Projects\MyApp" -Module androidApp

.EXAMPLE
    ./analyze-sbom.ps1 -ProjectRoot "C:\Projects\MyApp" -SbomPath "androidApp/build/reports/bom-android.json"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [Parameter(Mandatory = $false)]
    [string]$Module = "",

    [Parameter(Mandatory = $false)]
    [string]$SbomPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Find SBOM file
$sbomFile = $null

if ($SbomPath -ne "") {
    $fullPath = if ([System.IO.Path]::IsPathRooted($SbomPath)) {
        $SbomPath
    } else {
        Join-Path $ProjectRoot $SbomPath
    }

    if (Test-Path $fullPath) {
        $sbomFile = Get-Item $fullPath
    }
} elseif ($Module -ne "") {
    $modulePath = Join-Path $ProjectRoot $Module
    $sbomFile = Get-ChildItem -Path $modulePath -Recurse -Filter "bom-*.json" -ErrorAction SilentlyContinue | Select-Object -First 1
} else {
    $sbomFile = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "bom-*.json" -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $sbomFile -or -not (Test-Path $sbomFile.FullName)) {
    Write-Host "ERROR: No SBOM file found." -ForegroundColor Red
    Write-Host "Run /sbom first to generate SBOM files." -ForegroundColor Yellow
    exit 1
}

$relativePath = $sbomFile.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SBOM Analysis" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "File: $relativePath" -ForegroundColor White
Write-Host ""

# Parse SBOM
$sbom = Get-Content $sbomFile.FullName -Raw | ConvertFrom-Json

# Metadata
Write-Host "METADATA:" -ForegroundColor Yellow
Write-Host "  Generated:  $($sbom.metadata.timestamp)"
Write-Host "  Format:     $($sbom.bomFormat) v$($sbom.specVersion)"
Write-Host "  Component:  $($sbom.metadata.component.name)"
if ($sbom.serialNumber) {
    Write-Host "  Serial:     $($sbom.serialNumber)"
}
Write-Host ""

# Component stats
$components = $sbom.components

if (-not $components -or $components.Count -eq 0) {
    Write-Host "No components found in SBOM." -ForegroundColor Yellow
    exit 0
}

Write-Host "DEPENDENCIES:" -ForegroundColor Yellow
Write-Host "  Total components: $($components.Count)"

# Group by type
$byType = $components | Group-Object -Property type
foreach ($t in $byType) {
    Write-Host "  - $($t.Name): $($t.Count)"
}
Write-Host ""

# Top publishers
Write-Host "TOP PUBLISHERS:" -ForegroundColor Yellow
$byPublisher = $components | Where-Object { $_.publisher } | Group-Object -Property publisher | Sort-Object Count -Descending | Select-Object -First 10
if ($byPublisher.Count -gt 0) {
    foreach ($p in $byPublisher) {
        Write-Host "  $($p.Count.ToString().PadLeft(3)) - $($p.Name)"
    }
} else {
    Write-Host "  (no publisher info available)"
}
Write-Host ""

# Top dependency groups
Write-Host "TOP DEPENDENCY GROUPS:" -ForegroundColor Yellow
$byGroup = $components | Where-Object { $_.group } | Group-Object -Property group | Sort-Object Count -Descending | Select-Object -First 15
if ($byGroup.Count -gt 0) {
    foreach ($g in $byGroup) {
        Write-Host "  $($g.Count.ToString().PadLeft(3)) - $($g.Name)"
    }
} else {
    Write-Host "  (no group info available)"
}
Write-Host ""

# Licenses summary
Write-Host "LICENSES:" -ForegroundColor Yellow
$withLicense = $components | Where-Object { $_.licenses -and $_.licenses.Count -gt 0 }
$withoutLicense = $components | Where-Object { -not $_.licenses -or $_.licenses.Count -eq 0 }
Write-Host "  With license info:    $($withLicense.Count)"
Write-Host "  Without license info: $($withoutLicense.Count)"

# Common licenses
$allLicenses = @()
foreach ($c in $withLicense) {
    foreach ($lic in $c.licenses) {
        if ($lic.license.id) {
            $allLicenses += $lic.license.id
        } elseif ($lic.license.name) {
            $allLicenses += $lic.license.name
        }
    }
}

if ($allLicenses.Count -gt 0) {
    $licenseGroups = $allLicenses | Group-Object | Sort-Object Count -Descending | Select-Object -First 10
    Write-Host ""
    Write-Host "  Most common licenses:"
    foreach ($l in $licenseGroups) {
        Write-Host "    $($l.Count.ToString().PadLeft(3)) - $($l.Name)"
    }
}
Write-Host ""

# Potential concerns
Write-Host "POTENTIAL CONCERNS:" -ForegroundColor Yellow

# Check for GPL licenses
$gplComponents = $components | Where-Object {
    $_.licenses | Where-Object {
        $_.license.id -match "GPL" -or $_.license.name -match "GPL"
    }
}

if ($gplComponents.Count -gt 0) {
    Write-Host "  WARNING: $($gplComponents.Count) component(s) with GPL license" -ForegroundColor Red
    foreach ($gc in $gplComponents | Select-Object -First 5) {
        Write-Host "    - $($gc.group):$($gc.name)" -ForegroundColor DarkYellow
    }
    if ($gplComponents.Count -gt 5) {
        Write-Host "    ... and $($gplComponents.Count - 5) more" -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  [OK] No GPL-licensed dependencies" -ForegroundColor Green
}

# Check for unknown versions
$unknownVersion = $components | Where-Object { $_.version -eq "unspecified" -or -not $_.version }
if ($unknownVersion.Count -gt 0) {
    Write-Host "  [NOTE] $($unknownVersion.Count) component(s) with unspecified version" -ForegroundColor DarkYellow
} else {
    Write-Host "  [OK] All components have version specified" -ForegroundColor Green
}

# Check for deprecated components (if marked)
$deprecated = $components | Where-Object { $_.pedigree -and $_.pedigree.notes -match "deprecated" }
if ($deprecated.Count -gt 0) {
    Write-Host "  [WARN] $($deprecated.Count) deprecated component(s)" -ForegroundColor Yellow
}

Write-Host ""
