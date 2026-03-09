#Requires -Version 5.1
<#
.SYNOPSIS
    Validate string resource naming conventions.
.DESCRIPTION
    Checks: snake_case keys, required prefixes, {category}_{entity}_{descriptor} format,
    cross-module duplicates, Compose/Swift key sync.
#>
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$ModulePath = "",
    [switch]$StrictMode,
    [switch]$ShowDetails,
    [switch]$CheckSwiftSync,
    [ValidateSet("human", "json")]
    [string]$OutputFormat = "human"
)

$ErrorActionPreference = "Stop"

# ── Globals ───────────────────────────────────────────────────────────────────
$script:Errors = 0
$script:Warnings = 0
$script:FilesChecked = 0
$script:TotalKeys = 0
$script:ErrorMsgs = [System.Collections.ArrayList]::new()
$script:WarnMsgs = [System.Collections.ArrayList]::new()
$script:DuplicateMsgs = [System.Collections.ArrayList]::new()
$script:AllKeys = @{}

$KnownPrefixes = @("common_", "error_", "a11y_")

# ── Find strings.xml files ───────────────────────────────────────────────────
$searchRoot = $ProjectRoot
if ($ModulePath) {
    $searchRoot = Join-Path $ProjectRoot $ModulePath
}

$stringFiles = Get-ChildItem -Path $searchRoot -Recurse -Filter "strings.xml" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'composeResources[\\/]values[\\/]strings\.xml$' }

if (-not $stringFiles -or $stringFiles.Count -eq 0) {
    if ($OutputFormat -eq "json") {
        Write-Output '{"status":"skip","message":"No strings.xml files found","files_checked":0}'
    } else {
        Write-Output "No composeResources/values/strings.xml files found under: $searchRoot"
    }
    exit 0
}

# ── Lint a single strings.xml ────────────────────────────────────────────────
function Lint-File {
    param([System.IO.FileInfo]$File)

    $relPath = $File.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")
    $script:FilesChecked++
    $fileErrors = 0
    $fileWarnings = 0

    [xml]$doc = Get-Content -Path $File.FullName -Raw
    $strings = $doc.SelectNodes("//string[@name]")

    if (-not $strings -or $strings.Count -eq 0) { return }

    foreach ($node in $strings) {
        $key = $node.GetAttribute("name")
        $script:TotalKeys++

        # ── ERROR: camelCase detection ────────────────────────────────────
        if ($key -cmatch '[a-z][A-Z]') {
            [void]$script:ErrorMsgs.Add("ERROR [$relPath] Key '$key' uses camelCase -- must use snake_case")
            $fileErrors++
        }

        # ── ERROR: uppercase letters (non-camelCase) ──────────────────────
        if ($key -cmatch '[A-Z]' -and $key -cnotmatch '[a-z][A-Z]') {
            [void]$script:ErrorMsgs.Add("ERROR [$relPath] Key '$key' contains uppercase -- must use lowercase snake_case")
            $fileErrors++
        }

        # ── ERROR: invalid characters ─────────────────────────────────────
        if ($key -match '[^a-z0-9_]') {
            [void]$script:ErrorMsgs.Add("ERROR [$relPath] Key '$key' contains invalid characters -- only lowercase, digits, underscores allowed")
            $fileErrors++
        }

        # ── WARNING: missing known prefix ─────────────────────────────────
        $hasKnownPrefix = $false
        foreach ($prefix in $KnownPrefixes) {
            if ($key.StartsWith($prefix)) { $hasKnownPrefix = $true; break }
        }
        if (-not $hasKnownPrefix) {
            # Check for feature prefix (feature_something)
            if ($key -notmatch '^[a-z]+_.+') {
                [void]$script:WarnMsgs.Add("WARN  [$relPath] Key '$key' has no category prefix -- expected {category}_{entity}_{descriptor}")
                $fileWarnings++
            }
        }

        # ── WARNING: too few segments ─────────────────────────────────────
        $underscoreCount = ($key.ToCharArray() | Where-Object { $_ -eq '_' }).Count
        if ($underscoreCount -lt 1) {
            [void]$script:WarnMsgs.Add("WARN  [$relPath] Key '$key' has no underscore -- expected at least {category}_{descriptor}")
            $fileWarnings++
        }

        # ── Cross-module duplicate tracking ───────────────────────────────
        if ($script:AllKeys.ContainsKey($key)) {
            $prevFile = $script:AllKeys[$key]
            if ($prevFile -ne $relPath) {
                [void]$script:DuplicateMsgs.Add("WARN  Key '$key' defined in both '$prevFile' and '$relPath'")
            }
        } else {
            $script:AllKeys[$key] = $relPath
        }
    }

    $script:Errors += $fileErrors
    $script:Warnings += $fileWarnings
}

# ── Swift sync check ─────────────────────────────────────────────────────────
function Check-SwiftSync {
    $xcstringFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "*.xcstrings" -File -ErrorAction SilentlyContinue

    if (-not $xcstringFiles -or $xcstringFiles.Count -eq 0) {
        [void]$script:WarnMsgs.Add("WARN  No .xcstrings files found -- Swift sync check skipped")
        return
    }

    $composeKeys = $script:AllKeys.Keys | Sort-Object

    foreach ($xcfile in $xcstringFiles) {
        $relXcFile = $xcfile.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")
        $content = Get-Content -Path $xcfile.FullName -Raw
        $swiftKeys = [regex]::Matches($content, '"([a-z][a-z0-9_]+)"(?=\s*:)') |
            ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

        # Keys in Compose but not in Swift
        $missingInSwift = $composeKeys | Where-Object { $_ -notin $swiftKeys }
        foreach ($k in $missingInSwift) {
            [void]$script:WarnMsgs.Add("WARN  Key '$k' exists in Compose resources but missing from '$relXcFile'")
            $script:Warnings++
        }

        # Keys in Swift but not in Compose
        $missingInCompose = $swiftKeys | Where-Object { $_ -notin $composeKeys }
        foreach ($k in $missingInCompose) {
            [void]$script:WarnMsgs.Add("WARN  Key '$k' exists in '$relXcFile' but missing from Compose resources")
            $script:Warnings++
        }
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────
foreach ($f in $stringFiles) {
    Lint-File -File $f
}

if ($CheckSwiftSync) {
    Check-SwiftSync
}

# ── Output ────────────────────────────────────────────────────────────────────
if ($OutputFormat -eq "json") {
    $exitCode = 0
    if ($script:Errors -gt 0) { $exitCode = 1 }
    if ($StrictMode -and $script:Warnings -gt 0) { $exitCode = 1 }

    $status = if ($exitCode -eq 0) { "pass" } else { "fail" }
    $result = @{
        status        = $status
        files_checked = $script:FilesChecked
        total_keys    = $script:TotalKeys
        errors        = $script:Errors
        warnings      = $script:Warnings
        duplicates    = $script:DuplicateMsgs.Count
    } | ConvertTo-Json -Compress
    Write-Output $result
    exit $exitCode
}

# Human-readable output
Write-Output "=== Resource Lint Report ==="
Write-Output "Files checked: $($script:FilesChecked)"
Write-Output "Total keys:    $($script:TotalKeys)"
Write-Output ""

if ($script:ErrorMsgs.Count -gt 0) {
    Write-Output "-- ERRORS --------------------------------------------------"
    foreach ($msg in $script:ErrorMsgs) { Write-Output "  $msg" }
    Write-Output ""
}

if ($script:DuplicateMsgs.Count -gt 0) {
    Write-Output "-- DUPLICATES ----------------------------------------------"
    foreach ($msg in $script:DuplicateMsgs) { Write-Output "  $msg" }
    Write-Output ""
}

if ($script:WarnMsgs.Count -gt 0 -and ($ShowDetails -or $StrictMode)) {
    Write-Output "-- WARNINGS ------------------------------------------------"
    foreach ($msg in $script:WarnMsgs) { Write-Output "  $msg" }
    Write-Output ""
}

Write-Output "-- SUMMARY -------------------------------------------------"
Write-Output "Errors:     $($script:Errors)"
Write-Output "Warnings:   $($script:Warnings)"
Write-Output "Duplicates: $($script:DuplicateMsgs.Count)"

if ($script:Errors -gt 0) {
    Write-Output "Status:     FAILED"
    exit 1
} elseif ($StrictMode -and $script:Warnings -gt 0) {
    Write-Output "Status:     FAILED (strict mode)"
    exit 1
} else {
    Write-Output "Status:     PASSED"
    exit 0
}
