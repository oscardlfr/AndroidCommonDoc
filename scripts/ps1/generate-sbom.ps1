#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Generates SBOM (Software Bill of Materials) for KMP/Android projects.

.DESCRIPTION
    Uses CycloneDX Gradle plugin to generate JSON SBOM files.
    Auto-detects modules with CycloneDX configured, or generates for specific module.

.PARAMETER ProjectRoot
    Path to the project root. Required.

.PARAMETER Module
    Specific module to generate SBOM for (e.g., androidApp, desktopApp).
    If not specified, generates for all detected modules.

.PARAMETER All
    Explicitly generate for all detected modules.

.EXAMPLE
    ./generate-sbom.ps1 -ProjectRoot "C:\Projects\MyApp"

.EXAMPLE
    ./generate-sbom.ps1 -ProjectRoot "C:\Projects\MyApp" -Module androidApp

.EXAMPLE
    ./generate-sbom.ps1 -ProjectRoot "C:\Projects\MyApp" -All
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [Parameter(Mandatory = $false)]
    [string]$Module = "",

    [switch]$All
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Auto-detect modules with CycloneDX configured
function Get-SbomModules {
    param([string]$Root)

    $modules = @()

    # Common deliverable module patterns
    $candidates = @("androidApp", "desktopApp", "shared-ios", "app", "iosApp", "macosApp")

    foreach ($candidate in $candidates) {
        $modulePath = Join-Path $Root $candidate
        $buildFile = Join-Path $modulePath "build.gradle.kts"

        if (Test-Path $buildFile) {
            $content = Get-Content $buildFile -Raw -ErrorAction SilentlyContinue
            if ($content -match "cyclonedx") {
                $modules += $candidate
            }
        }
    }

    return $modules
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SBOM Generator (CycloneDX)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot" -ForegroundColor White
Write-Host ""

Push-Location $ProjectRoot

try {
    # Determine which modules to process
    $modulesToProcess = @()

    if ($Module -ne "") {
        $modulesToProcess = @($Module)
    } else {
        $modulesToProcess = Get-SbomModules -Root $ProjectRoot
    }

    if ($modulesToProcess.Count -eq 0) {
        Write-Host "No modules with CycloneDX configuration found." -ForegroundColor Yellow
        Write-Host "Ensure your build.gradle.kts includes the cyclonedx plugin." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Modules to process: $($modulesToProcess -join ', ')" -ForegroundColor White
    Write-Host ""

    $successCount = 0
    $failCount = 0

    foreach ($mod in $modulesToProcess) {
        Write-Host "Generating SBOM for $mod..." -ForegroundColor Yellow

        & ./gradlew ":${mod}:cyclonedxDirectBom" --quiet 2>&1 | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] $mod" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "  [ERROR] Failed to generate SBOM for $mod" -ForegroundColor Red
            $failCount++
        }
    }

    Write-Host ""
    Write-Host "Generated SBOM files:" -ForegroundColor Cyan

    $sbomFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "bom-*.json" -ErrorAction SilentlyContinue

    if ($sbomFiles.Count -gt 0) {
        foreach ($file in $sbomFiles) {
            $relativePath = $file.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")
            $size = "{0:N1} KB" -f ($file.Length / 1KB)
            Write-Host "  - $relativePath ($size)" -ForegroundColor White
        }
    } else {
        Write-Host "  (no SBOM files found)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Summary: $successCount succeeded, $failCount failed" -ForegroundColor $(if ($failCount -gt 0) { "Yellow" } else { "Green" })

    if ($failCount -gt 0) {
        exit 1
    }
}
finally {
    Pop-Location
}
