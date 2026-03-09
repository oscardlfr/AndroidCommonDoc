#!/usr/bin/env powershell
<#
.SYNOPSIS
    Extracts actionable error information from Gradle logs and test results.

.DESCRIPTION
    Parses build output to extract:
    - Compilation errors with file locations
    - Test failures from JUnit XML results
    - Coverage gaps from coverage reports (Kover/JaCoCo)

    Outputs structured data optimized for AI agent fixes.

.PARAMETER ProjectRoot
    Path to the project root. Defaults to current directory.

.PARAMETER Module
    Module to analyze (e.g., "core:data", "feature:home").

.PARAMETER Platform
    Target platform for finding reports: "auto", "android", "desktop".

.PARAMETER IncludeStackTrace
    Include full stack traces in test failure output.

.PARAMETER JsonOutput
    Output results as JSON for programmatic consumption.

.EXAMPLE
    ./ai-error-extractor.ps1 -Module "core:data"

.EXAMPLE
    ./ai-error-extractor.ps1 -ProjectRoot "../MyApp" -Module "core:domain" -Platform desktop -JsonOutput
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = (Get-Location).Path,

    [Parameter(Mandatory = $true)]
    [string]$Module,

    [Parameter(Mandatory = $false)]
    [ValidateSet("auto", "android", "desktop")]
    [string]$Platform = "auto",

    [switch]$IncludeStackTrace,
    [switch]$JsonOutput
)

$ErrorActionPreference = "Continue"

# Source coverage detection library
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$scriptDir\lib\Coverage-Detect.ps1"

# Resolve paths
$ModulePath = Join-Path $ProjectRoot ($Module -replace ':', '/')

$Output = @{
    module = $Module
    projectRoot = $ProjectRoot
    platform = $Platform
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    compilationErrors = @()
    testFailures = @()
    coverageGaps = @()
    actionableItems = @()
}

function Get-ProjectType {
    param([string]$Root)
    if (Test-Path (Join-Path $Root "desktopApp")) { return "kmp-desktop" }
    return "android"
}

function Get-SuggestedFix {
    param([string]$ErrorMessage)

    $fixes = @{
        "Unresolved reference" = "Add missing import or check dependency"
        "Type mismatch" = "Verify parameter types match function signature"
        "Cannot access" = "Check visibility modifiers or add dependency"
        "No value passed for parameter" = "Add missing required parameter to function call"
        "Too many arguments" = "Remove extra arguments from function call"
        "Expecting" = "Fix syntax error - check brackets, braces, or keywords"
        "does not have" = "Check class/interface has the referenced member"
        "Duplicate" = "Remove duplicate declaration or rename one instance"
        "Constructor call expected" = "Change object instantiation to data class constructor"
        "Modifier 'suspend'" = "Make calling function suspend or wrap in coroutine scope"
    }

    foreach ($pattern in $fixes.Keys) {
        if ($ErrorMessage -match $pattern) {
            return $fixes[$pattern]
        }
    }

    return "Review error message and fix accordingly"
}

function Parse-GradleLog {
    param([string]$LogPath)

    if (-not (Test-Path $LogPath)) { return @() }

    $errors = [System.Collections.Generic.List[object]]::new()
    $content = Get-Content $LogPath

    foreach ($line in $content) {
        # Kotlin compilation error with file location
        if ($line -match 'e: file:///([^:]+):(\d+):(\d+): (.+)$') {
            $filePath = $matches[1] -replace '/', '\'
            $errors.Add(@{
                type = "compilation"
                severity = "ERROR"
                file = $filePath
                line = [int]$matches[2]
                column = [int]$matches[3]
                message = $matches[4].Trim()
                suggestedFix = Get-SuggestedFix -ErrorMessage $matches[4]
            })
        }
        # KSP errors
        elseif ($line -match 'e: \[ksp\] (.+)$') {
            $errors.Add(@{
                type = "ksp"
                severity = "ERROR"
                file = "unknown"
                line = 0
                column = 0
                message = $matches[1].Trim()
                suggestedFix = "Check KSP annotation processing configuration"
            })
        }
        # Unresolved reference (standalone)
        elseif ($line -match 'Unresolved reference: (.+)$') {
            $errors.Add(@{
                type = "compilation"
                severity = "ERROR"
                file = "unknown"
                line = 0
                column = 0
                message = "Unresolved reference: $($matches[1])"
                suggestedFix = "Add import for '$($matches[1])' or check if it exists in dependencies"
            })
        }
    }

    return $errors
}

function Get-TestResultsPath {
    param([string]$ModulePath, [string]$Platform, [string]$ProjectType)

    $paths = @()

    if ($Platform -eq "desktop" -or ($Platform -eq "auto" -and $ProjectType -eq "kmp-desktop")) {
        $paths += "$ModulePath/build/test-results/desktopTest"
    }
    if ($Platform -eq "android" -or $Platform -eq "auto") {
        $paths += "$ModulePath/build/test-results/testDebugUnitTest"
    }
    $paths += "$ModulePath/build/test-results"

    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-TestFailureSuggestedFix {
    param([string]$Message)

    $patterns = @{
        "expected.*but was" = "Update expected value or fix the implementation"
        "assertThat.*isInstanceOf" = "Check object type or update test expectation"
        "NullPointerException" = "Add null check or ensure object is initialized"
        "IndexOutOfBoundsException" = "Check array/list bounds before accessing"
        "ClassCastException" = "Verify object types match expected cast"
        "timeout" = "Increase timeout or optimize code performance"
        "mock.*not.*stubbed" = "Add stub for mock method call"
        "CancellationException" = "Ensure coroutine scope is properly managed"
    }

    foreach ($pattern in $patterns.Keys) {
        if ($Message -match $pattern) {
            return $patterns[$pattern]
        }
    }

    return "Review test failure message and adjust test or implementation"
}

function Get-TestFailures {
    param([string]$TestResultsPath)

    $failures = [System.Collections.Generic.List[object]]::new()

    if (-not $TestResultsPath -or -not (Test-Path $TestResultsPath)) {
        return $failures
    }

    $xmlFiles = Get-ChildItem -Path $TestResultsPath -Filter "TEST-*.xml" -Recurse -ErrorAction SilentlyContinue

    foreach ($xmlFile in $xmlFiles) {
        try {
            [xml]$xml = Get-Content $xmlFile.FullName

            foreach ($testcase in $xml.testsuite.testcase) {
                $failure = $testcase.failure
                $error = $testcase.error

                if ($failure -or $error) {
                    $failureInfo = if ($failure) { $failure } else { $error }
                    $failureType = if ($failure) { "assertion_failure" } else { "test_error" }

                    $stackLines = if ($failureInfo.'#text') {
                        ($failureInfo.'#text' -split "`n" | Select-Object -First 10)
                    } else { @() }

                    $fileLocation = @{ file = "unknown"; line = 0 }
                    foreach ($stackLine in $stackLines) {
                        if ($stackLine -match '([A-Za-z0-9_]+\.kt):(\d+)') {
                            $fileLocation = @{
                                file = $matches[1]
                                line = [int]$matches[2]
                            }
                            break
                        }
                    }

                    $failures.Add(@{
                        type = $failureType
                        severity = "FAILURE"
                        class = $testcase.classname
                        test = $testcase.name
                        message = $failureInfo.message
                        file = $fileLocation.file
                        line = $fileLocation.line
                        stackTrace = if ($IncludeStackTrace) { $failureInfo.'#text' } else { $null }
                        suggestedFix = Get-TestFailureSuggestedFix -Message $failureInfo.message
                    })
                }
            }
        }
        catch {
            Write-Warning "Failed to parse $($xmlFile.Name)"
        }
    }

    return $failures
}

function Get-CoverageGaps {
    param([string]$XmlPath)

    $gaps = [System.Collections.Generic.List[object]]::new()

    if (-not $XmlPath -or -not (Test-Path $XmlPath)) {
        return $gaps
    }

    try {
        [xml]$xml = Get-Content $XmlPath

        foreach ($package in $xml.report.package) {
            foreach ($sourcefile in $package.sourcefile) {
                $fileLineCounter = $sourcefile.counter | Where-Object { $_.type -eq "LINE" }

                if ($fileLineCounter -and [int]$fileLineCounter.missed -gt 0) {
                    $fileMissed = [int]$fileLineCounter.missed
                    $fileCovered = [int]$fileLineCounter.covered
                    $fileTotal = $fileMissed + $fileCovered

                    $missedLines = [System.Collections.Generic.List[int]]::new()
                    $missedRanges = [System.Collections.Generic.List[string]]::new()
                    $rangeStart = $null
                    $rangeEnd = $null

                    foreach ($line in ($sourcefile.line | Sort-Object { [int]$_.nr })) {
                        if ([int]$line.mi -gt 0 -and [int]$line.ci -eq 0) {
                            $lineNum = [int]$line.nr
                            $missedLines.Add($lineNum)

                            if ($null -eq $rangeStart) {
                                $rangeStart = $lineNum
                                $rangeEnd = $lineNum
                            }
                            elseif ($lineNum -eq $rangeEnd + 1) {
                                $rangeEnd = $lineNum
                            }
                            else {
                                $missedRanges.Add($(if ($rangeStart -eq $rangeEnd) { "$rangeStart" } else { "$rangeStart-$rangeEnd" }))
                                $rangeStart = $lineNum
                                $rangeEnd = $lineNum
                            }
                        }
                    }

                    if ($null -ne $rangeStart) {
                        $missedRanges.Add($(if ($rangeStart -eq $rangeEnd) { "$rangeStart" } else { "$rangeStart-$rangeEnd" }))
                    }

                    $gaps.Add(@{
                        type = "coverage_gap"
                        severity = "WARNING"
                        file = $sourcefile.name
                        package = ($package.name -replace '/', '.')
                        linesMissed = $fileMissed
                        linesTotal = $fileTotal
                        percentage = [math]::Round(($fileCovered / $fileTotal) * 100, 1)
                        missedLines = $missedLines
                        missedRanges = ($missedRanges -join ", ")
                        suggestedFix = "Add tests to cover lines: $($missedRanges -join ', ')"
                    })
                }
            }
        }

        $sortedGaps = $gaps | Sort-Object -Property linesMissed -Descending
        $gaps = [System.Collections.Generic.List[object]]::new()
        if ($sortedGaps) { foreach ($g in $sortedGaps) { $gaps.Add($g) } }
    }
    catch {
        Write-Warning "Failed to parse coverage XML"
    }

    return $gaps
}

# --- Main Logic ---

$projectType = Get-ProjectType -Root $ProjectRoot
if ($Platform -eq "auto") {
    $Platform = if ($projectType -eq "kmp-desktop") { "desktop" } else { "android" }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Error Extractor" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Module: $Module" -ForegroundColor White
Write-Host "Platform: $Platform" -ForegroundColor White
Write-Host ""

# Extract compilation errors from gradle log
$logPath = Join-Path $ProjectRoot "gradle-run-error.log"
if (Test-Path $logPath) {
    Write-Host "Extracting compilation errors..." -ForegroundColor White
    $Output.compilationErrors = Parse-GradleLog -LogPath $logPath
    $color = if ($Output.compilationErrors.Count -eq 0) { "Green" } else { "Yellow" }
    Write-Host "  Found: $($Output.compilationErrors.Count) error(s)" -ForegroundColor $color
}

# Extract test failures
Write-Host "Extracting test failures..." -ForegroundColor White
$testResultsPath = Get-TestResultsPath -ModulePath $ModulePath -Platform $Platform -ProjectType $projectType
$Output.testFailures = Get-TestFailures -TestResultsPath $testResultsPath
$color = if ($Output.testFailures.Count -eq 0) { "Green" } else { "Yellow" }
Write-Host "  Found: $($Output.testFailures.Count) failure(s)" -ForegroundColor $color

# Extract coverage gaps
Write-Host "Analyzing coverage gaps..." -ForegroundColor White
# Detect coverage tool for the module
$covBuildFile = Join-Path $ModulePath "build.gradle.kts"
$covTool = Detect-CoverageTool -BuildFilePath $covBuildFile
$isDesktop = ($Platform -eq "desktop")
$coverageXmlPath = Get-CoverageXmlPath -Tool $covTool -ModulePath $ModulePath -IsDesktop $isDesktop
$Output.coverageGaps = Get-CoverageGaps -XmlPath $coverageXmlPath
$color = if ($Output.coverageGaps.Count -eq 0) { "Green" } else { "Yellow" }
Write-Host "  Found: $($Output.coverageGaps.Count) file(s) with gaps" -ForegroundColor $color

# Generate actionable items
Write-Host ""
Write-Host "ACTIONABLE ITEMS:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$actionNum = 1

# Compilation errors (highest priority)
foreach ($err in $Output.compilationErrors) {
    $Output.actionableItems += @{
        priority = "HIGH"
        action = "Fix compilation error"
        location = "$($err.file):$($err.line)"
        description = $err.message
        suggestedFix = $err.suggestedFix
    }

    Write-Host "[$actionNum] HIGH - Fix compilation error" -ForegroundColor Red
    Write-Host "    Location: $($err.file):$($err.line):$($err.column)" -ForegroundColor Gray
    Write-Host "    Error: $($err.message)" -ForegroundColor Gray
    Write-Host "    Fix: $($err.suggestedFix)" -ForegroundColor Yellow
    Write-Host ""
    $actionNum++
}

# Test failures (high priority)
foreach ($fail in $Output.testFailures) {
    $Output.actionableItems += @{
        priority = "HIGH"
        action = "Fix test failure"
        location = "$($fail.class).$($fail.test)"
        description = $fail.message
        suggestedFix = $fail.suggestedFix
    }

    Write-Host "[$actionNum] HIGH - Fix test failure" -ForegroundColor Red
    Write-Host "    Test: $($fail.class).$($fail.test)" -ForegroundColor Gray
    Write-Host "    Message: $($fail.message)" -ForegroundColor Gray
    Write-Host "    Fix: $($fail.suggestedFix)" -ForegroundColor Yellow
    Write-Host ""
    $actionNum++
}

# Coverage gaps (lower priority, top 5)
$topGaps = $Output.coverageGaps | Select-Object -First 5
foreach ($gap in $topGaps) {
    $Output.actionableItems += @{
        priority = "MEDIUM"
        action = "Add test coverage"
        location = $gap.file
        description = "$($gap.linesMissed) uncovered lines ($($gap.percentage)% coverage)"
        suggestedFix = $gap.suggestedFix
    }

    Write-Host "[$actionNum] MEDIUM - Add test coverage" -ForegroundColor Yellow
    Write-Host "    File: $($gap.file)" -ForegroundColor Gray
    Write-Host "    Lines: $($gap.missedRanges)" -ForegroundColor Gray
    Write-Host "    Coverage: $($gap.percentage)%" -ForegroundColor Gray
    Write-Host ""
    $actionNum++
}

if ($Output.coverageGaps.Count -gt 5) {
    Write-Host "... and $($Output.coverageGaps.Count - 5) more files with coverage gaps" -ForegroundColor DarkGray
    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SUMMARY:" -ForegroundColor Cyan
$color = if ($Output.compilationErrors.Count -eq 0) { "Green" } else { "Red" }
Write-Host "  Compilation Errors: $($Output.compilationErrors.Count)" -ForegroundColor $color
$color = if ($Output.testFailures.Count -eq 0) { "Green" } else { "Red" }
Write-Host "  Test Failures: $($Output.testFailures.Count)" -ForegroundColor $color
$color = if ($Output.coverageGaps.Count -eq 0) { "Green" } else { "Yellow" }
Write-Host "  Coverage Gaps: $($Output.coverageGaps.Count) files" -ForegroundColor $color
Write-Host "  Total Actions: $($Output.actionableItems.Count)" -ForegroundColor Cyan
Write-Host ""

# JSON output if requested
if ($JsonOutput) {
    Write-Host "JSON OUTPUT:" -ForegroundColor Cyan
    $Output | ConvertTo-Json -Depth 10
}

# Exit code based on high priority items
$highPriorityCount = ($Output.actionableItems | Where-Object { $_.priority -eq "HIGH" }).Count
if ($highPriorityCount -gt 0) {
    exit 1
}
exit 0
