#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Scans SBOM files for known vulnerabilities using Trivy.

.DESCRIPTION
    Requires Trivy to be installed:
    - Windows (winget): winget install aquasecurity.trivy
    - Windows (scoop): scoop install trivy
    - macOS: brew install trivy
    - Linux: See https://aquasecurity.github.io/trivy/

.PARAMETER ProjectRoot
    Path to the project root. Required.

.PARAMETER Module
    Specific module to scan. If not provided, scans all bom-*.json files.

.PARAMETER Severity
    Minimum severity level to report. Default: "HIGH,CRITICAL"
    Options: CRITICAL, HIGH, MEDIUM, LOW (can combine with comma)

.EXAMPLE
    ./scan-sbom.ps1 -ProjectRoot "C:\Projects\MyApp"

.EXAMPLE
    ./scan-sbom.ps1 -ProjectRoot "C:\Projects\MyApp" -Module androidApp

.EXAMPLE
    ./scan-sbom.ps1 -ProjectRoot "C:\Projects\MyApp" -Severity "CRITICAL"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [Parameter(Mandatory = $false)]
    [string]$Module = "",

    [Parameter(Mandatory = $false)]
    [string]$Severity = "HIGH,CRITICAL"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Find Trivy executable
function Find-Trivy {
    # Check if trivy is in PATH
    $trivyCmd = Get-Command trivy -ErrorAction SilentlyContinue
    if ($trivyCmd) {
        return $trivyCmd.Source
    }

    # Check WinGet packages location (Windows)
    if ($env:LOCALAPPDATA) {
        $wingetPath = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter 'trivy.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($wingetPath) {
            return $wingetPath.FullName
        }
    }

    # Check scoop location (Windows)
    $scoopPath = "$env:USERPROFILE\scoop\shims\trivy.exe"
    if (Test-Path $scoopPath) {
        return $scoopPath
    }

    return $null
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SBOM Vulnerability Scanner (Trivy)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot" -ForegroundColor White
Write-Host "Severity filter: $Severity" -ForegroundColor White
Write-Host ""

# Find Trivy
$trivyPath = Find-Trivy
if (-not $trivyPath) {
    Write-Host "ERROR: Trivy is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Trivy using one of these methods:" -ForegroundColor Yellow
    Write-Host "  Windows (winget): winget install aquasecurity.trivy"
    Write-Host "  Windows (scoop):  scoop install trivy"
    Write-Host "  macOS:            brew install trivy"
    Write-Host "  Linux:            See https://aquasecurity.github.io/trivy/"
    exit 1
}

Write-Host "Using Trivy: $trivyPath" -ForegroundColor Gray
Write-Host ""

# Find SBOM files
$sbomFiles = @()

if ($Module -ne "") {
    # Search in specific module
    $modulePath = Join-Path $ProjectRoot $Module
    $sbomFiles = Get-ChildItem -Path $modulePath -Recurse -Filter "bom-*.json" -ErrorAction SilentlyContinue
} else {
    # Search entire project
    $sbomFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "bom-*.json" -ErrorAction SilentlyContinue
}

if ($sbomFiles.Count -eq 0) {
    Write-Host "No SBOM files found." -ForegroundColor Yellow
    Write-Host "Run /sbom first to generate SBOM files." -ForegroundColor Yellow
    exit 1
}

$totalVulnerabilities = 0
$results = @()

foreach ($sbom in $sbomFiles) {
    $relativePath = $sbom.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")
    Write-Host "Scanning: $relativePath" -ForegroundColor Yellow
    Write-Host ("-" * 60) -ForegroundColor DarkGray

    # Run Trivy and capture output
    $output = & $trivyPath sbom --severity $Severity $sbom.FullName 2>&1

    # Display output
    $output | ForEach-Object { Write-Host $_ }

    # Check for vulnerabilities in output
    if ($output -match "Total: (\d+)") {
        $count = [int]$Matches[1]
        if ($count -gt 0) {
            $totalVulnerabilities += $count
            $results += @{
                File = $relativePath
                Count = $count
            }
        }
    }

    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Scan Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Files scanned: $($sbomFiles.Count)" -ForegroundColor White

if ($totalVulnerabilities -gt 0) {
    Write-Host "Total vulnerabilities: $totalVulnerabilities" -ForegroundColor Red
    foreach ($r in $results) {
        Write-Host "  - $($r.File): $($r.Count) vulnerabilities" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Review the output above for details." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "No vulnerabilities found at severity: $Severity" -ForegroundColor Green
    exit 0
}
