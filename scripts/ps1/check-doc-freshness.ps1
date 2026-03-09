<#
.SYNOPSIS
    Checks doc freshness by comparing version references against versions-manifest.json.

.DESCRIPTION
    Lightweight CI script that reads versions-manifest.json and scans all docs/*.md
    files for version references in Library Versions headers. Compares each found
    version against the manifest and reports stale references.

    This is the fast CI path -- the full doc-code-drift-detector agent performs
    comprehensive drift detection, but this script only checks version staleness.

.PARAMETER ProjectRoot
    Path to the project root directory (default: repo root relative to script location)

.EXAMPLE
    ./check-doc-freshness.ps1

.EXAMPLE
    ./check-doc-freshness.ps1 -ProjectRoot "C:\Projects\AndroidCommonDoc"
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

# --- Resolve project root ---
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
}

$manifestPath = Join-Path $ProjectRoot "versions-manifest.json"
$docsDir = Join-Path $ProjectRoot "docs"

if (-not (Test-Path $manifestPath)) {
    Write-Error "versions-manifest.json not found at: $manifestPath"
    exit 2
}

if (-not (Test-Path $docsDir)) {
    Write-Error "docs/ directory not found at: $docsDir"
    exit 2
}

# --- Load manifest ---
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$versions = @{}
foreach ($prop in $manifest.versions.PSObject.Properties) {
    $versions[$prop.Name] = $prop.Value
}

# --- Library name mapping: doc text -> manifest key ---
# Maps common library name patterns found in doc headers to manifest keys
function Get-ManifestKey {
    param([string]$LibName)

    $lower = $LibName.ToLower().Trim()

    switch -Regex ($lower) {
        '^kotlin$'                    { return "kotlin" }
        '^agp$'                       { return "agp" }
        '^compose multiplatform$'     { return "compose-multiplatform" }
        '^compose desktop$'           { return "compose-multiplatform" }
        '^compose$'                   { return "compose-multiplatform" }
        '^koin$'                      { return "koin" }
        '^kotlinx-coroutines$'        { return "kotlinx-coroutines" }
        '^kotlinx-coroutines-test$'   { return "kotlinx-coroutines" }
        '^kover$'                     { return "kover" }
        '^mockk$'                     { return "mockk" }
        '^compose gradle plugin$'     { return "compose-gradle-plugin" }
        '^kmp gradle plugin$'         { return "kotlin" }
        '^detekt$'                    { return "detekt" }
        '^compose-rules$'            { return "compose-rules" }
        default                       { return $null }
    }
}

# --- Wildcard version comparison ---
# Returns $true if versions match, handling wildcards (x) in manifest versions
function Compare-VersionMatch {
    param(
        [string]$DocVersion,
        [string]$ManifestVersion
    )

    # If manifest version contains 'x', compare only up to the wildcard position
    if ($ManifestVersion -match 'x') {
        $manifestParts = $ManifestVersion -split '\.'
        $docParts = $DocVersion -split '\.'

        for ($i = 0; $i -lt $manifestParts.Length; $i++) {
            if ($manifestParts[$i] -eq 'x') {
                # Wildcard -- accept any value from this position onward
                return $true
            }
            if ($i -ge $docParts.Length) {
                return $false
            }
            if ($manifestParts[$i] -ne $docParts[$i]) {
                return $false
            }
        }
        return $true
    }

    # Exact comparison
    return ($DocVersion -eq $ManifestVersion)
}

# --- Scan docs ---
Write-Host "Doc Freshness Check"
Write-Host ""

$staleCount = 0
$okCount = 0
$docFiles = Get-ChildItem -Path $docsDir -Filter "*.md" | Sort-Object Name

foreach ($docFile in $docFiles) {
    $content = Get-Content $docFile.FullName
    $relPath = "docs/$($docFile.Name)"
    $docStale = @()

    foreach ($line in $content) {
        # Match the Library Versions header line
        if ($line -match '^\>\s*\*\*Library Versions\*\*:?\s*(.+)$') {
            $versionText = $matches[1]

            # Extract library-version pairs
            # Pattern: "LibName version" separated by commas
            # Examples: "Kotlin 2.3.10", "AGP 9.0.0", "Compose Multiplatform 1.7.x"
            $pairs = $versionText -split ',\s*'

            foreach ($pair in $pairs) {
                $pair = $pair.Trim()
                # Match: library name (possibly multi-word) followed by version number
                if ($pair -match '^(.+?)\s+(\d+\.\S+)') {
                    $libName = $matches[1].Trim()
                    $docVersion = $matches[2].Trim()

                    # Remove trailing punctuation if any
                    $docVersion = $docVersion -replace '[,;]+$', ''

                    $manifestKey = Get-ManifestKey -LibName $libName
                    if ($null -eq $manifestKey) {
                        # Not tracked in manifest -- skip
                        continue
                    }

                    if (-not $versions.ContainsKey($manifestKey)) {
                        # Key not in manifest versions -- skip
                        continue
                    }

                    $manifestVersion = $versions[$manifestKey]
                    $isMatch = Compare-VersionMatch -DocVersion $docVersion -ManifestVersion $manifestVersion

                    if (-not $isMatch) {
                        $docStale += "${libName}: found ${docVersion}, expected ${manifestVersion}"
                    }
                }
            }
        }
    }

    if ($docStale.Count -gt 0) {
        foreach ($issue in $docStale) {
            Write-Host "[STALE] $relPath -- $issue"
            $staleCount++
        }
    }
    else {
        Write-Host "[OK] $relPath -- all versions current"
        $okCount++
    }
}

Write-Host ""
if ($staleCount -eq 0) {
    Write-Host "Result: PASS (0 stale)"
    exit 0
}
else {
    Write-Host "Result: FAIL ($staleCount stale)"
    exit 1
}
