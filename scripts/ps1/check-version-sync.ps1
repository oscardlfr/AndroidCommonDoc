<#
.SYNOPSIS
    Compares version catalogs between KMP projects to detect discrepancies.

.DESCRIPTION
    This script parses libs.versions.toml files from multiple projects and compares
    them against a source of truth (shared-libs by default). It reports:
    - Version discrepancies
    - Missing dependencies
    - Outdated versions

.PARAMETER SourceOfTruth
    Path to the project that defines canonical versions (default: shared-libs)

.PARAMETER Projects
    Array of project paths to compare against the source of truth

.PARAMETER OutputFormat
    Output format: 'human' for readable output, 'json' for structured output

.PARAMETER IgnoreExtra
    If set, don't report dependencies that exist only in consumer projects

.EXAMPLE
    ./check-version-sync.ps1 -Projects @("../MyApp", "../MyProject")

.EXAMPLE
    ./check-version-sync.ps1 -SourceOfTruth "../shared-libs" -Projects @("../MyApp") -OutputFormat json
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$SourceOfTruth = "../shared-libs",

    [Parameter(Mandatory = $false)]
    [string[]]$Projects = @(),

    [Parameter(Mandatory = $false)]
    [ValidateSet("human", "json")]
    [string]$OutputFormat = "human",

    [Parameter(Mandatory = $false)]
    [switch]$IgnoreExtra
)

$ErrorActionPreference = "Stop"

# Helper function to parse TOML version catalog
function Parse-VersionCatalog {
    param([string]$Path)

    $result = @{
        versions = @{}
        libraries = @{}
        plugins = @{}
    }

    if (-not (Test-Path $Path)) {
        Write-Warning "Version catalog not found: $Path"
        return $result
    }

    $content = Get-Content $Path -Raw
    $currentSection = ""

    foreach ($line in $content -split "`n") {
        $line = $line.Trim()

        # Skip empty lines and comments
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }

        # Detect section headers
        if ($line -match '^\[versions\]') {
            $currentSection = "versions"
            continue
        }
        elseif ($line -match '^\[libraries\]') {
            $currentSection = "libraries"
            continue
        }
        elseif ($line -match '^\[plugins\]') {
            $currentSection = "plugins"
            continue
        }
        elseif ($line -match '^\[bundles\]') {
            $currentSection = "bundles"
            continue
        }

        # Parse key-value pairs in versions section
        if ($currentSection -eq "versions" -and $line -match '^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"') {
            $key = $matches[1]
            $value = $matches[2]
            $result.versions[$key] = $value
        }
    }

    return $result
}

# Helper function to compare versions
function Compare-Versions {
    param(
        [string]$V1,
        [string]$V2
    )

    if ($V1 -eq $V2) { return 0 }

    # Simple version comparison (handles semantic versioning)
    try {
        $parts1 = $V1 -replace '-.*$', '' -split '\.'
        $parts2 = $V2 -replace '-.*$', '' -split '\.'

        for ($i = 0; $i -lt [Math]::Max($parts1.Length, $parts2.Length); $i++) {
            $p1 = if ($i -lt $parts1.Length) { [int]$parts1[$i] } else { 0 }
            $p2 = if ($i -lt $parts2.Length) { [int]$parts2[$i] } else { 0 }

            if ($p1 -lt $p2) { return -1 }
            if ($p1 -gt $p2) { return 1 }
        }
    }
    catch {
        # If parsing fails, do string comparison
        return [string]::Compare($V1, $V2)
    }

    return 0
}

# Resolve paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$baseDir = Split-Path -Parent $scriptDir

# Auto-detect projects if not specified
if ($Projects.Count -eq 0) {
    $parentDir = Split-Path -Parent $baseDir
    $potentialProjects = @(
        "$parentDir/MyApp",
        "$parentDir/MyProject/MyProject"
    )
    $Projects = $potentialProjects | Where-Object { Test-Path "$_/gradle/libs.versions.toml" }
}

# Resolve source of truth path
if (-not [System.IO.Path]::IsPathRooted($SourceOfTruth)) {
    $SourceOfTruth = Join-Path $baseDir $SourceOfTruth
}

$sourceTomlPath = Join-Path $SourceOfTruth "gradle/libs.versions.toml"

if (-not (Test-Path $sourceTomlPath)) {
    Write-Error "Source of truth not found: $sourceTomlPath"
    exit 2
}

# Parse source of truth
$sourceVersions = Parse-VersionCatalog -Path $sourceTomlPath
$sourceName = Split-Path -Leaf $SourceOfTruth

# Results container
$results = @{
    sourceOfTruth = $sourceName
    sourceVersions = $sourceVersions.versions
    projects = @()
    discrepancies = @()
    summary = @{
        totalProjects = $Projects.Count
        totalDiscrepancies = 0
        projectsWithIssues = 0
    }
}

# Compare each project
foreach ($projectPath in $Projects) {
    if (-not [System.IO.Path]::IsPathRooted($projectPath)) {
        $projectPath = Join-Path $baseDir $projectPath
    }

    $tomlPath = Join-Path $projectPath "gradle/libs.versions.toml"
    $projectName = Split-Path -Leaf $projectPath

    if (-not (Test-Path $tomlPath)) {
        Write-Warning "Version catalog not found for project: $projectName"
        continue
    }

    $projectVersions = Parse-VersionCatalog -Path $tomlPath

    $projectResult = @{
        name = $projectName
        path = $projectPath
        discrepancies = @()
        extraDependencies = @()
    }

    # Check for discrepancies (versions in both but different)
    foreach ($key in $sourceVersions.versions.Keys) {
        if ($projectVersions.versions.ContainsKey($key)) {
            $sourceValue = $sourceVersions.versions[$key]
            $projectValue = $projectVersions.versions[$key]

            if ($sourceValue -ne $projectValue) {
                $comparison = Compare-Versions -V1 $sourceValue -V2 $projectValue
                $status = if ($comparison -gt 0) { "outdated" } elseif ($comparison -lt 0) { "ahead" } else { "different" }

                $discrepancy = @{
                    dependency = $key
                    sourceVersion = $sourceValue
                    projectVersion = $projectValue
                    status = $status
                }

                $projectResult.discrepancies += $discrepancy
                $results.discrepancies += @{
                    project = $projectName
                    dependency = $key
                    sourceVersion = $sourceValue
                    projectVersion = $projectValue
                    status = $status
                }
            }
        }
    }

    # Check for extra dependencies (in project but not in source)
    if (-not $IgnoreExtra) {
        foreach ($key in $projectVersions.versions.Keys) {
            if (-not $sourceVersions.versions.ContainsKey($key)) {
                $projectResult.extraDependencies += @{
                    dependency = $key
                    version = $projectVersions.versions[$key]
                }
            }
        }
    }

    if ($projectResult.discrepancies.Count -gt 0 -or $projectResult.extraDependencies.Count -gt 0) {
        $results.summary.projectsWithIssues++
    }

    $results.summary.totalDiscrepancies += $projectResult.discrepancies.Count
    $results.projects += $projectResult
}

# Output results
if ($OutputFormat -eq "json") {
    $results | ConvertTo-Json -Depth 10
}
else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Version Sync Check Report" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Source of Truth: " -NoNewline
    Write-Host $sourceName -ForegroundColor Yellow
    Write-Host "Projects Checked: $($results.summary.totalProjects)"
    Write-Host ""

    if ($results.summary.totalDiscrepancies -eq 0 -and $results.summary.projectsWithIssues -eq 0) {
        Write-Host "All versions are in sync!" -ForegroundColor Green
        Write-Host ""
        exit 0
    }

    foreach ($project in $results.projects) {
        Write-Host "----------------------------------------"
        Write-Host "Project: " -NoNewline
        Write-Host $project.name -ForegroundColor Yellow

        if ($project.discrepancies.Count -eq 0 -and $project.extraDependencies.Count -eq 0) {
            Write-Host "  Status: " -NoNewline
            Write-Host "OK" -ForegroundColor Green
            continue
        }

        if ($project.discrepancies.Count -gt 0) {
            Write-Host ""
            Write-Host "  Version Discrepancies:" -ForegroundColor Red
            Write-Host "  ----------------------"

            foreach ($disc in $project.discrepancies) {
                $statusColor = switch ($disc.status) {
                    "outdated" { "Yellow" }
                    "ahead" { "Cyan" }
                    default { "Magenta" }
                }

                Write-Host "    $($disc.dependency): " -NoNewline
                Write-Host "$($disc.projectVersion)" -ForegroundColor $statusColor -NoNewline
                Write-Host " (source: $($disc.sourceVersion)) " -NoNewline
                Write-Host "[$($disc.status)]" -ForegroundColor $statusColor
            }
        }

        if ($project.extraDependencies.Count -gt 0) {
            Write-Host ""
            Write-Host "  Extra Dependencies (not in source):" -ForegroundColor DarkYellow
            Write-Host "  ------------------------------------"

            foreach ($extra in $project.extraDependencies) {
                Write-Host "    $($extra.dependency): $($extra.version)" -ForegroundColor DarkGray
            }
        }
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  Total Discrepancies: $($results.summary.totalDiscrepancies)"
    Write-Host "  Projects with Issues: $($results.summary.projectsWithIssues) / $($results.summary.totalProjects)"
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    if ($results.summary.totalDiscrepancies -gt 0) {
        Write-Host "Suggested Actions:" -ForegroundColor Yellow
        Write-Host "  1. Update project versions to match source of truth"
        Write-Host "  2. Or update source of truth if project has newer versions"
        Write-Host "  3. Run './gradlew build' after updating to verify compatibility"
        Write-Host ""
    }
}

# Exit code
if ($results.summary.totalDiscrepancies -gt 0) {
    exit 1
}
exit 0
