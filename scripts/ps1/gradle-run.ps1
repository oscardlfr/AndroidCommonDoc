#!/usr/bin/env powershell
<#
.SYNOPSIS
    Universal Gradle Runner with smart retry logic for KMP/Android projects.

.DESCRIPTION
    Implements intelligent retry strategy:
    - Attempt 1: Fast run
    - Attempt 2: Stop daemons + Clean + Run
    Automatically detects compilation errors vs environment issues (daemon crashes, OOM).

.PARAMETER ProjectRoot
    Path to the project root. Defaults to current directory.

.PARAMETER Module
    Module to run task on (e.g., "core:data", "feature:home"). Use "-" for root project.

.PARAMETER Task
    Gradle task to execute (e.g., "test", "desktopTest", "build").

.PARAMETER Platform
    Target platform: "auto" (detect), "android", "desktop". Default: auto.
    DEPRECATED: Use TestType instead for explicit test type selection.

.PARAMETER TestType
    Test type to run: "all", "common", "androidUnit", "androidInstrumented", "desktop".
    - all: Run all applicable test types
    - common: Run commonTest via desktopTest
    - androidUnit: Run androidUnitTest via testDebugUnitTest
    - androidInstrumented: Run androidInstrumentedTest via connectedDebugAndroidTest
    - desktop: Same as common (explicit)
    Default: auto-detect based on Platform parameter.

.PARAMETER SearchPattern
    Optional regex pattern to search in error output for additional context.

.PARAMETER AdditionalArgs
    Additional arguments to pass to Gradle.

.PARAMETER SkipCoverage
    Skip coverage report generation after tests.

.EXAMPLE
    ./gradle-run.ps1 -ProjectRoot "C:\Projects\MyApp" -Module "core:data" -Task "desktopTest"

.EXAMPLE
    ./gradle-run.ps1 -Module "core:domain" -Task "test" -Platform android
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = (Get-Location).Path,

    [Parameter(Position = 0)]
    [string]$Module = "",

    [Parameter(Position = 1)]
    [string]$Task = "",

    [Parameter(Mandatory = $false)]
    [ValidateSet("auto", "android", "desktop")]
    [string]$Platform = "auto",

    [Parameter(Mandatory = $false)]
    [ValidateSet("all", "common", "androidUnit", "androidInstrumented", "desktop")]
    [string]$TestType = "",

    [Parameter(Mandatory = $false)]
    [string]$SearchPattern = "",

    [Parameter(ValueFromRemainingArguments)]
    [string[]]$AdditionalArgs = @(),

    [Parameter(Mandatory = $false)]
    [switch]$SkipCoverage,

    [Parameter(Mandatory = $false)]
    [ValidateSet("jacoco", "kover", "auto", "none")]
    [string]$CoverageTool = "auto",

    [Parameter(Mandatory = $false)]
    [int]$Timeout = 300
)

$ErrorActionPreference = "Continue"
$global:startTime = Get-Date
$logFile = Join-Path $ProjectRoot "gradle-run-error.log"

# Source coverage detection library
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$scriptDir\lib\Coverage-Detect.ps1"

# Change to project directory
Push-Location $ProjectRoot

function Write-Step {
    param([string]$Message, [string]$Color = "Cyan")
    Write-Host ""
    Write-Host ">>> $Message" -ForegroundColor $Color
    Write-Host ""
}

function Get-ProjectType {
    param([string]$Root)

    # Check for KMP Desktop indicators
    if (Test-Path (Join-Path $Root "desktopApp")) {
        return "kmp-desktop"
    }
    # Check for pure Android
    if (Test-Path (Join-Path $Root "app/build.gradle.kts")) {
        return "android"
    }
    # Check settings for module hints
    $settingsPath = Join-Path $Root "settings.gradle.kts"
    if (Test-Path $settingsPath) {
        $settings = Get-Content $settingsPath -Raw
        if ($settings -match "desktopApp|iosApp|macosApp") {
            return "kmp-desktop"
        }
    }
    return "android"
}

function Get-TestTask {
    param([string]$ProjectType, [string]$RequestedPlatform)

    if ($RequestedPlatform -eq "desktop") {
        return "desktopTest"
    }
    if ($RequestedPlatform -eq "android") {
        return "testDebugUnitTest"
    }

    # Auto-detect
    if ($ProjectType -eq "kmp-desktop") {
        return "desktopTest"
    }
    return "testDebugUnitTest"
}

function Get-TestTaskByType {
    param(
        [string]$TestType,
        [string]$ProjectType
    )

    switch ($TestType) {
        "common" { return "desktopTest" }
        "androidUnit" { return "testDebugUnitTest" }
        "androidInstrumented" { return "connectedDebugAndroidTest" }
        "desktop" { return "desktopTest" }
        "all" {
            # For "all", return array of tasks to run
            if ($ProjectType -eq "kmp-desktop") {
                return @("desktopTest", "testDebugUnitTest")
            } else {
                return @("testDebugUnitTest")
            }
        }
        default {
            # Fallback to old logic
            return Get-TestTask -ProjectType $ProjectType -RequestedPlatform "auto"
        }
    }
}

function Get-CompilationErrors {
    param([string]$LogPath)
    if (-not (Test-Path $LogPath)) { return @() }

    # Broad regex to catch "e: [ksp]", "e: file:///", "e: ...", etc.
    $foundErrors = Get-Content $LogPath | Select-String -Pattern "^\s*e: " -Context 0, 3

    if ($foundErrors.Count -eq 0) {
        # Fallback: Look for "FAILED" messages
        $foundErrors = Get-Content $LogPath | Select-String -Pattern "FAILED" -Context 0, 2
    }

    if ($foundErrors.Count -eq 0) {
        # Fallback: Look for "What went wrong:" section
        $foundErrors = Get-Content $LogPath | Select-String -Pattern "What went wrong:" -Context 0, 10
    }

    return $foundErrors
}

function Show-Errors {
    param($Errors, $CustomPattern = "")

    if ($Errors.Count -eq 0 -and $CustomPattern -eq "") {
        Write-Host "  No structured Kotlin errors found." -ForegroundColor Gray
        return
    }

    if ($Errors.Count -gt 0) {
        Write-Host ""
        Write-Host "--- Compilation/Test Errors ---" -ForegroundColor Yellow

        $count = 0
        foreach ($matchInfo in $Errors) {
            if ($count -ge 20) { break }

            Write-Host "  $($matchInfo.Line.Trim())" -ForegroundColor Red

            if ($matchInfo.Context) {
                foreach ($ctxLine in $matchInfo.Context.PostContext) {
                    if ($ctxLine) {
                        Write-Host "    $($ctxLine.Trim())" -ForegroundColor Gray
                    }
                }
            }
            Write-Host ""
            $count++
        }
    }

    if ($CustomPattern -ne "") {
        Write-Host ""
        Write-Host "--- Custom Search: '$CustomPattern' ---" -ForegroundColor Cyan
        $matches = Get-Content $logFile | Select-String -Pattern $CustomPattern -Context 2, 5
        if ($matches.Count -eq 0) {
            Write-Host "  No matches found." -ForegroundColor Gray
        }
        else {
            foreach ($m in $matches) {
                Write-Host "  $($m.Line.Trim())" -ForegroundColor Magenta
                foreach ($ctx in $m.Context.PostContext) {
                    Write-Host "    $($ctx.Trim())" -ForegroundColor Gray
                }
                Write-Host ""
            }
        }
    }
}

function Test-DaemonError {
    param([string]$LogContent, [int]$ExitCode = 0)
    if ($ExitCode -eq 124) { return $true }  # Timeout
    if ($LogContent -match "DaemonDisappearedException") { return $true }
    if ($LogContent -match "Metaspace") { return $true }
    if ($LogContent -match "OutOfMemoryError") { return $true }
    if ($LogContent -match "TimeoutException") { return $true }
    if ($LogContent -match "GradleConnectionException") { return $true }
    if ($LogContent -match "The execution of .* failed") { return $true }
    return $false
}

function Invoke-Gradle {
    param(
        [string]$TaskName,
        [string]$ModuleName,
        [string[]]$ExtraArgs,
        [bool]$CleanFirst = $false,
        [bool]$StopDaemonFirst = $false,
        [int]$TimeoutSec = 300
    )

    if ($StopDaemonFirst) {
        Write-Step "Strategy: Stopping Daemons + Clean + Run" "Magenta"
        Write-Host "Stopping Gradle daemons..." -ForegroundColor Gray
        & ./gradlew --stop 2>&1 | Out-Null
    }
    elseif ($CleanFirst) {
        Write-Step "Strategy: Clean + Run" "Magenta"
    }
    else {
        Write-Step "Strategy: Fast Run" "Magenta"
    }

    if ($CleanFirst -or $StopDaemonFirst) {
        Write-Host "Cleaning..." -ForegroundColor Gray
        if ($ModuleName -eq "-" -or $ModuleName -eq "") {
            & ./gradlew clean --console=plain 2>&1 | Out-Null
        }
        else {
            $cleanTask = ":$($ModuleName.Replace(':', ':')):clean"
            & ./gradlew $cleanTask --console=plain 2>&1 | Out-Null
        }
    }

    Write-Host "Running task: $TaskName (timeout: ${TimeoutSec}s)" -ForegroundColor Cyan

    if ($ModuleName -eq "-" -or $ModuleName -eq "") {
        $gradleTask = $TaskName
    }
    else {
        $gradleTask = ":$($ModuleName.Replace(':', ':')):$TaskName"
    }

    $allArgs = @($gradleTask, "--console=plain", "--stacktrace") + $ExtraArgs
    $tempLog = Join-Path $env:TEMP "gradle-run-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
    $gradleExe = Join-Path $ProjectRoot "gradlew.bat"
    $argString = ($allArgs -join " ")

    $proc = Start-Process -FilePath $gradleExe -ArgumentList $argString `
        -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru `
        -RedirectStandardOutput $tempLog -RedirectStandardError "$tempLog.err"

    $elapsed = 0
    $interval = 15

    while (-not $proc.HasExited) {
        Start-Sleep -Seconds $interval
        $elapsed += $interval

        $mins = [math]::Floor($elapsed / 60)
        $secs = $elapsed % 60
        Write-Host "  [${mins}m${secs}s] Still running..." -ForegroundColor DarkGray

        if ($elapsed -ge $TimeoutSec) {
            Write-Host "[TIMEOUT] Exceeded ${TimeoutSec}s! Killing..." -ForegroundColor Red
            $proc | Stop-Process -Force -ErrorAction SilentlyContinue
            Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -match "GradleWorkerMain" } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 2
            break
        }
    }

    # Ensure exit code is available after process completion
    if (-not ($elapsed -ge $TimeoutSec)) {
        $proc.WaitForExit()
    }

    $cmdOutput = if (Test-Path $tempLog) { Get-Content $tempLog -Raw } else { "" }
    Remove-Item $tempLog -Force -ErrorAction SilentlyContinue
    Remove-Item "$tempLog.err" -Force -ErrorAction SilentlyContinue

    $exitCode = if ($elapsed -ge $TimeoutSec) { 124 } else { $proc.ExitCode }

    return @{
        ExitCode = $exitCode
        Output   = $cmdOutput
        TimedOut = ($elapsed -ge $TimeoutSec)
    }
}

# --- Main Logic ---

try {
    if ($Task -eq "") {
        Write-Host "Usage: ./gradle-run.ps1 [-ProjectRoot <path>] <module> <task> [args...]" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Examples:" -ForegroundColor Cyan
        Write-Host "  ./gradle-run.ps1 core:data desktopTest"
        Write-Host "  ./gradle-run.ps1 -ProjectRoot ../MyApp core:domain test"
        Write-Host "  ./gradle-run.ps1 - build   # Root project build"
        exit 1
    }

    $projectType = Get-ProjectType -Root $ProjectRoot
    Write-Host "Project Type: $projectType" -ForegroundColor DarkGray

    # Resolve test task if generic "test" was requested
    if ($Task -eq "test") {
        if ($TestType -ne "") {
            $resolvedTask = Get-TestTaskByType -TestType $TestType -ProjectType $projectType
            if ($resolvedTask -is [Array]) {
                # "all" was specified - run multiple test types
                Write-Host "Test Type 'all' specified - will run: $($resolvedTask -join ', ')" -ForegroundColor Cyan
                $Task = $resolvedTask[0]  # Start with first task
            } else {
                $Task = $resolvedTask
            }
            Write-Host "Test Type: $TestType -> Task: $Task" -ForegroundColor DarkGray
        } else {
            $Task = Get-TestTask -ProjectType $projectType -RequestedPlatform $Platform
            Write-Host "Resolved Task: $Task" -ForegroundColor DarkGray
        }
    }

    $attempt = 1
    $maxAttempts = 2

    while ($attempt -le $maxAttempts) {
        $clean = $false
        $stop = $false

        if ($attempt -eq 2) {
            $clean = $true; $stop = $true
            # Also stop shared-libs daemons (composite build)
            $sharedPath = Join-Path (Split-Path $ProjectRoot -Parent) "shared-libs"
            if (Test-Path $sharedPath) {
                Write-Host "Stopping shared-libs daemons..." -ForegroundColor Gray
                Push-Location $sharedPath
                & ./gradlew --stop 2>&1 | Out-Null
                & ./gradlew clean --console=plain 2>&1 | Out-Null
                Pop-Location
            }
        }

        $result = Invoke-Gradle -TaskName $Task -ModuleName $Module -ExtraArgs $AdditionalArgs -CleanFirst $clean -StopDaemonFirst $stop -TimeoutSec $Timeout

        if ($result.ExitCode -eq 0) {
            $totalDuration = (Get-Date) - $global:startTime
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "  BUILD SUCCESSFUL" -ForegroundColor Green
            Write-Host "  Total Duration: $($totalDuration.ToString('mm\:ss'))" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green

            # Generate coverage report if this was a test task
            if (-not $SkipCoverage -and $Task -match "test" -and $Module -ne "-" -and $Module -ne "") {
                # Resolve coverage tool
                $covTool = $CoverageTool
                if ($covTool -eq "auto") {
                    $buildFile = Join-Path $ProjectRoot ($Module -replace ':', '/') "build.gradle.kts"
                    $covTool = Detect-CoverageTool -BuildFilePath $buildFile
                }
                $isDesktop = ($Platform -eq "desktop" -or $projectType -eq "kmp-desktop")
                $covTaskName = Get-CoverageGradleTask -Tool $covTool -TestType "" -IsDesktop $isDesktop
                if ($covTaskName) {
                    Write-Host ""
                    $displayName = Get-CoverageDisplayName -Tool $covTool
                    Write-Host "Generating coverage report ($displayName)..." -ForegroundColor Cyan
                    $fullCovTask = ":$($Module.Replace(':', ':')):$covTaskName"
                    & ./gradlew $fullCovTask --console=plain 2>&1 | Out-Null

                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "Coverage report generated." -ForegroundColor Green
                    } elseif ($covTool -eq "kover") {
                        # Kover task name may vary — try fallbacks
                        $fallbackTasks = @("koverXmlReportDesktop", "koverXmlReport", "koverXmlReportDebug")
                        if (-not $isDesktop) {
                            $fallbackTasks = @("koverXmlReportDebug", "koverXmlReport", "koverXmlReportDesktop")
                        }
                        foreach ($fb in $fallbackTasks) {
                            if ($fb -eq $covTaskName) { continue }
                            & ./gradlew ":${Module}:${fb}" --console=plain 2>&1 | Out-Null
                            if ($LASTEXITCODE -eq 0) {
                                Write-Host "Coverage report generated (via $fb)." -ForegroundColor Green
                                break
                            }
                        }
                    }
                }
            }
            exit 0
        }

        # Analysis
        $result.Output | Out-File $logFile -Encoding UTF8

        $isDaemon = Test-DaemonError -LogContent $result.Output -ExitCode $result.ExitCode

        Write-Host "Attempt $attempt failed. (Exit Code: $($result.ExitCode))" -ForegroundColor Red

        if ($attempt -lt $maxAttempts) {
            if ($isDaemon) {
                Write-Host "Detected Daemon/Resource error. Escalating..." -ForegroundColor Yellow
                $attempt = 3 # Jump to full reset
                continue
            }

            Write-Host "Retrying..." -ForegroundColor Yellow
        }

        $attempt++
    }

    # Timeout-specific reporting
    if ($result.TimedOut) {
        Write-Host ""
        Write-Host "[TIMEOUT] Module $Module timed out after ${Timeout}s" -ForegroundColor Red
        Write-Host "[TIMEOUT] Possible causes: infinite loop, deadlock, OOM" -ForegroundColor Yellow
        Write-Host "[TIMEOUT] Try: /unlock-tests --clean --module $Module" -ForegroundColor Yellow
    }

    # Final Failure
    Write-Host ""
    Write-Host "Final Attempt Failed." -ForegroundColor Red
    Write-Host "Full log saved to: $logFile" -ForegroundColor Yellow

    # Show errors
    $finalErrors = @()
    if ($Task -match "test") {
        $finalErrors += Get-Content $logFile | Select-String -Pattern "AssertionError" -Context 0, 10
    }
    $finalErrors += Get-CompilationErrors -LogPath $logFile

    Show-Errors -Errors $finalErrors -CustomPattern $SearchPattern

    exit 1
}
finally {
    Pop-Location
}
