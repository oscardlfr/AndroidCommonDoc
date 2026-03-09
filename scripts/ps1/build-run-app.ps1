<#
.SYNOPSIS
    Build, install and run Android/Desktop apps with automatic log capture.

.DESCRIPTION
    Automates the complete debug workflow:
    - Android: build -> uninstall -> install -> clear logcat -> launch -> capture logs
    - Desktop: build and run with stdout capture

    AI AGENT NOTES:
    - Exit codes: 0=success, 1=build fail, 2=install fail, 3=launch fail, 4=no device
    - Use -OutputFormat json for machine-parseable output
    - Log files created: app_build.log, app_debug.log, app_full.log

.PARAMETER ProjectRoot
    Path to the project root. Required.

.PARAMETER Target
    Target platform: android, desktop, demo, prod. Auto-detected if omitted.

.PARAMETER Filter
    Comma-separated log tags to filter. Default: CLAUDE_DEBUG

.PARAMETER Device
    ADB device serial. Auto-selects if one device connected.

.PARAMETER Clean
    Force clean build before running.

.PARAMETER Flavor
    Android build flavor. Default: demo

.PARAMETER LogDuration
    How long to capture logs in seconds. Default: 30

.PARAMETER OutputFormat
    Output format: human (default) or json

.EXAMPLE
    ./build-run-app.ps1 -ProjectRoot "C:\Projects\MyProject\MyProject" -Target android -Filter "HUE,MQTT"

.EXAMPLE
    ./build-run-app.ps1 -ProjectRoot "C:\Projects\MyApp" -Target desktop
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectRoot,

    [string]$Target = "auto",
    [string]$Filter = "CLAUDE_DEBUG",
    [string]$Device = "",
    [switch]$Clean,
    [string]$Flavor = "demo",
    [int]$LogDuration = 30,
    [ValidateSet("human", "json")]
    [string]$OutputFormat = "human",
    [string]$Arguments = ""
)

$ErrorActionPreference = "Continue"
$Script:IsJson = $OutputFormat -eq "json"

# ============================================================================
# PARSE ARGUMENTS (from skill invocation)
# ============================================================================

if ($Arguments -and $Arguments.Trim() -ne "") {
    $argList = $Arguments -split '\s+' | Where-Object { $_ }

    for ($i = 0; $i -lt $argList.Count; $i++) {
        $arg = $argList[$i]
        switch -Regex ($arg) {
            "^--filter$" {
                if ($i + 1 -lt $argList.Count) { $Filter = $argList[$i + 1]; $i++ }
            }
            "^--device$" {
                if ($i + 1 -lt $argList.Count) { $Device = $argList[$i + 1]; $i++ }
            }
            "^--flavor$" {
                if ($i + 1 -lt $argList.Count) { $Flavor = $argList[$i + 1]; $i++ }
            }
            "^--clean$" { $Clean = $true }
            "^--json$" { $Script:IsJson = $true; $OutputFormat = "json" }
            "^--duration$" {
                if ($i + 1 -lt $argList.Count) { $LogDuration = [int]$argList[$i + 1]; $i++ }
            }
            "^(android|desktop|demo|prod)$" { $Target = $arg }
            default {
                if (-not $arg.StartsWith("-") -and $Target -eq "auto") {
                    $Target = $arg
                }
            }
        }
    }
}

# ============================================================================
# RESULT TRACKING
# ============================================================================

$Script:Result = @{
    projectRoot = $ProjectRoot
    projectName = (Split-Path $ProjectRoot -Leaf)
    target = $Target
    startTime = (Get-Date).ToString("o")
    endTime = $null
    status = "unknown"
    steps = @()
    logs = @{
        buildLog = ""
        debugLog = ""
        fullLog = ""
    }
    device = @{
        serial = ""
        model = ""
    }
    app = @{
        package = ""
        activity = ""
        apkPath = ""
    }
    errors = @()
}

# ============================================================================
# OUTPUT FUNCTIONS
# ============================================================================

function Write-Step {
    param([string]$Step, [string]$Status, [string]$Message = "")

    $stepInfo = @{
        step = $Step
        status = $Status
        message = $Message
        timestamp = (Get-Date).ToString("o")
    }
    $Script:Result.steps += $stepInfo

    if (-not $Script:IsJson) {
        $icon = switch ($Status) {
            "start" { "[...]" }
            "success" { "[OK]" }
            "fail" { "[FAIL]" }
            "skip" { "[SKIP]" }
            default { "[?]" }
        }
        $color = switch ($Status) {
            "start" { "Yellow" }
            "success" { "Green" }
            "fail" { "Red" }
            "skip" { "DarkYellow" }
            default { "White" }
        }
        $text = if ($Message) { "$icon $Step - $Message" } else { "$icon $Step" }
        Write-Host $text -ForegroundColor $color
    }
}

function Write-Info {
    param([string]$Message)
    if (-not $Script:IsJson) {
        Write-Host "    $Message" -ForegroundColor Gray
    }
}

function Write-Error-Custom {
    param([string]$Message)
    $Script:Result.errors += $Message
    if (-not $Script:IsJson) {
        Write-Host "[ERROR] $Message" -ForegroundColor Red
    }
}

function Write-JsonResult {
    $Script:Result.endTime = (Get-Date).ToString("o")
    $Script:Result | ConvertTo-Json -Depth 10
}

# ============================================================================
# VALIDATION
# ============================================================================

if (-not (Test-Path $ProjectRoot)) {
    Write-Error-Custom "Project path does not exist: $ProjectRoot"
    if ($Script:IsJson) { Write-JsonResult }
    exit 1
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

# ============================================================================
# PROJECT DETECTION
# ============================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Build & Run - $($Script:Result.projectName)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Detect project type
$hasDesktopApp = Test-Path (Join-Path $ProjectRoot "desktopApp")
$hasAndroidApp = Test-Path (Join-Path $ProjectRoot "app")
$hasAndroidAppModule = Test-Path (Join-Path $ProjectRoot "androidApp")

# Map target aliases
if ($Target -eq "demo" -or $Target -eq "prod") {
    $Flavor = $Target
    $Target = "android"
}

# Auto-detect target
if ($Target -eq "auto") {
    if ($hasAndroidApp -or $hasAndroidAppModule) {
        $Target = "android"
    } elseif ($hasDesktopApp) {
        $Target = "desktop"
    } else {
        Write-Error-Custom "Cannot auto-detect target. Specify: android or desktop"
        if ($Script:IsJson) { Write-JsonResult }
        exit 1
    }
}

$Script:Result.target = $Target
Write-Info "Target: $Target"

# ============================================================================
# ADB SETUP (Android only)
# ============================================================================

$ADB = ""
if ($Target -eq "android") {
    # Find ADB
    $androidSdk = $env:ANDROID_SDK_ROOT
    if (-not $androidSdk) { $androidSdk = $env:ANDROID_HOME }
    if (-not $androidSdk) { $androidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }

    $ADB = Join-Path $androidSdk "platform-tools/adb.exe"

    if (-not (Test-Path $ADB)) {
        Write-Error-Custom "ADB not found at: $ADB"
        if ($Script:IsJson) { Write-JsonResult }
        exit 4
    }

    Write-Info "ADB: $ADB"

    # Get devices
    $devices = & $ADB devices 2>&1 | Select-String -Pattern "^\S+\s+device$" | ForEach-Object {
        ($_ -split '\s+')[0]
    }

    if ($devices.Count -eq 0) {
        Write-Error-Custom "No Android devices connected"
        Write-Info "Connect a device or start an emulator"
        $Script:Result.status = "no_device"
        if ($Script:IsJson) { Write-JsonResult }
        exit 4
    }

    # Select device
    if ($Device -and $Device -ne "") {
        if ($devices -contains $Device) {
            $selectedDevice = $Device
        } else {
            Write-Error-Custom "Device not found: $Device"
            Write-Info "Available devices: $($devices -join ', ')"
            exit 4
        }
    } elseif ($devices.Count -eq 1) {
        $selectedDevice = $devices[0]
    } else {
        Write-Info "Multiple devices found: $($devices -join ', ')"
        $selectedDevice = $devices[0]
        Write-Info "Using first device: $selectedDevice"
    }

    $Script:Result.device.serial = $selectedDevice

    # Get device model
    $model = & $ADB -s $selectedDevice shell getprop ro.product.model 2>&1
    $Script:Result.device.model = $model.Trim()
    Write-Info "Device: $selectedDevice ($($Script:Result.device.model))"
}

# ============================================================================
# DETECT APP PACKAGE AND ACTIVITY
# ============================================================================

if ($Target -eq "android") {
    # Try to find AndroidManifest.xml
    $manifestPaths = @(
        (Join-Path $ProjectRoot "app/src/main/AndroidManifest.xml"),
        (Join-Path $ProjectRoot "androidApp/src/main/AndroidManifest.xml"),
        (Join-Path $ProjectRoot "androidApp/src/androidMain/AndroidManifest.xml")
    )

    $manifest = $manifestPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($manifest) {
        $content = Get-Content $manifest -Raw

        # Extract package
        if ($content -match 'package="([^"]+)"') {
            $basePackage = $Matches[1]
        }

        # Check for flavor suffix in build.gradle.kts
        $buildGradle = Join-Path (Split-Path $manifest -Parent) "../build.gradle.kts" | Resolve-Path -ErrorAction SilentlyContinue
        if (-not $buildGradle) {
            $buildGradle = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "build.gradle.kts" -Depth 2 |
                Where-Object { $_.DirectoryName -match "(app|androidApp)$" } |
                Select-Object -First 1 -ExpandProperty FullName
        }

        if ($buildGradle -and (Test-Path $buildGradle)) {
            $gradleContent = Get-Content $buildGradle -Raw

            # Look for applicationIdSuffix for demo flavor
            if ($Flavor -eq "demo" -and $gradleContent -match 'demo\s*\{[^}]*applicationIdSuffix\s*=\s*"([^"]+)"') {
                $suffix = $Matches[1]
                $Script:Result.app.package = "$basePackage$suffix"
            } elseif ($gradleContent -match 'applicationId\s*=\s*"([^"]+)"') {
                $Script:Result.app.package = $Matches[1]
                if ($Flavor -eq "demo") {
                    $Script:Result.app.package = "$($Script:Result.app.package).demo"
                }
            } else {
                $Script:Result.app.package = $basePackage
                if ($Flavor -eq "demo") {
                    $Script:Result.app.package = "$basePackage.demo"
                }
            }
        } else {
            $Script:Result.app.package = $basePackage
        }

        # Extract launcher activity
        if ($content -match '<activity[^>]*android:name="([^"]+)"[^>]*>[\s\S]*?<intent-filter>[\s\S]*?<action android:name="android.intent.action.MAIN"') {
            $activity = $Matches[1]
            if ($activity.StartsWith(".")) {
                $activity = "$basePackage$activity"
            } elseif (-not $activity.Contains(".")) {
                $activity = "$basePackage.$activity"
            }
            $Script:Result.app.activity = $activity
        }
    }

    # Fallback: detect package from AndroidManifest.xml
    if (-not $Script:Result.app.package) {
        $manifest = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "AndroidManifest.xml" -Depth 5 |
            Where-Object { $_.FullName -notmatch "build[/\\]" -and $_.FullName -match "src[/\\]main" } |
            Select-Object -First 1
        if ($manifest) {
            $content = Get-Content $manifest.FullName -Raw
            if ($content -match 'package="([^"]+)"') {
                $Script:Result.app.package = $Matches[1]
            }
        }
    }

    Write-Info "Package: $($Script:Result.app.package)"
    Write-Info "Activity: $($Script:Result.app.activity)"
}

# ============================================================================
# BUILD
# ============================================================================

Write-Host ""
Write-Step "BUILD" "start"

$buildTask = ""
$gradleArgs = @("--quiet", "--no-daemon")

if ($Clean) {
    $gradleArgs = @("clean") + $gradleArgs
    Write-Info "Clean build requested"
}

if ($Target -eq "android") {
    # Determine build task based on project structure
    if ($hasAndroidApp) {
        $flavorCapitalized = $Flavor.Substring(0,1).ToUpper() + $Flavor.Substring(1)
        $buildTask = ":app:assemble${flavorCapitalized}Debug"
    } elseif ($hasAndroidAppModule) {
        $buildTask = ":androidApp:assembleDebug"
    }
} else {
    # Desktop - just prepare, we'll run separately
    $buildTask = ":desktopApp:classes"
}

$gradleArgs = @($buildTask) + $gradleArgs

Write-Info "Task: ./gradlew $($gradleArgs -join ' ')"

$buildOutput = & ./gradlew @gradleArgs 2>&1
$buildExitCode = $LASTEXITCODE

if ($buildExitCode -ne 0) {
    Write-Step "BUILD" "fail" "Gradle build failed"

    # Save build log
    $buildLogPath = Join-Path $ProjectRoot "app_build.log"
    $buildOutput | Out-File -FilePath $buildLogPath -Encoding UTF8
    $Script:Result.logs.buildLog = $buildLogPath

    # Extract errors
    $errors = $buildOutput | Select-String -Pattern "(e: file:|error:|FAILURE)" | Select-Object -First 10
    foreach ($err in $errors) {
        Write-Info $err.Line
    }

    $Script:Result.status = "build_failed"
    if ($Script:IsJson) { Write-JsonResult }
    exit 1
}

Write-Step "BUILD" "success"

# ============================================================================
# FIND APK (Android only)
# ============================================================================

if ($Target -eq "android") {
    $apkSearchPaths = @(
        (Join-Path $ProjectRoot "app/build/outputs/apk/$Flavor/debug"),
        (Join-Path $ProjectRoot "app/build/outputs/apk/debug"),
        (Join-Path $ProjectRoot "androidApp/build/outputs/apk/debug")
    )

    $apkPath = ""
    foreach ($searchPath in $apkSearchPaths) {
        if (Test-Path $searchPath) {
            $apk = Get-ChildItem -Path $searchPath -Filter "*.apk" -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
            if ($apk) {
                $apkPath = $apk
                break
            }
        }
    }

    if (-not $apkPath) {
        Write-Error-Custom "APK not found in build outputs"
        $Script:Result.status = "apk_not_found"
        if ($Script:IsJson) { Write-JsonResult }
        exit 1
    }

    $Script:Result.app.apkPath = $apkPath
    Write-Info "APK: $apkPath"
}

# ============================================================================
# UNINSTALL & INSTALL (Android only)
# ============================================================================

if ($Target -eq "android") {
    Write-Host ""
    Write-Step "UNINSTALL" "start"

    $uninstallOutput = & $ADB -s $selectedDevice uninstall $Script:Result.app.package 2>&1

    if ($uninstallOutput -match "Success") {
        Write-Step "UNINSTALL" "success" "Removed existing app"
    } else {
        Write-Step "UNINSTALL" "skip" "App not installed"
    }

    Write-Host ""
    Write-Step "INSTALL" "start"

    $installOutput = & $ADB -s $selectedDevice install $apkPath 2>&1

    if ($LASTEXITCODE -ne 0 -or $installOutput -match "Failure") {
        Write-Step "INSTALL" "fail"

        # Parse install error
        if ($installOutput -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
            Write-Info "Signature mismatch - try: adb uninstall $($Script:Result.app.package)"
        } elseif ($installOutput -match "INSTALL_FAILED_VERSION_DOWNGRADE") {
            Write-Info "Version downgrade - uninstall first"
        } else {
            Write-Info ($installOutput | Out-String)
        }

        $Script:Result.status = "install_failed"
        if ($Script:IsJson) { Write-JsonResult }
        exit 2
    }

    Write-Step "INSTALL" "success"
}

# ============================================================================
# CLEAR LOGCAT & LAUNCH (Android only)
# ============================================================================

if ($Target -eq "android") {
    Write-Host ""
    Write-Step "CLEAR LOGCAT" "start"

    & $ADB -s $selectedDevice logcat -c 2>&1 | Out-Null

    Write-Step "CLEAR LOGCAT" "success"

    Write-Host ""
    Write-Step "LAUNCH" "start"

    $launchOutput = & $ADB -s $selectedDevice shell am start -n "$($Script:Result.app.package)/$($Script:Result.app.activity)" 2>&1

    if ($LASTEXITCODE -ne 0 -or $launchOutput -match "Error") {
        Write-Step "LAUNCH" "fail"
        Write-Info ($launchOutput | Out-String)

        $Script:Result.status = "launch_failed"
        if ($Script:IsJson) { Write-JsonResult }
        exit 3
    }

    Write-Step "LAUNCH" "success"

    # Verify app is in foreground
    Start-Sleep -Seconds 2
    $focusCheck = & $ADB -s $selectedDevice shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'" 2>&1

    if ($focusCheck -match $Script:Result.app.package) {
        Write-Info "App is in foreground"
    } else {
        Write-Info "Warning: App may have crashed immediately"
    }
}

# ============================================================================
# CAPTURE LOGS
# ============================================================================

Write-Host ""
Write-Step "CAPTURE LOGS" "start" "Filter: $Filter, Duration: ${LogDuration}s"

if ($Target -eq "android") {
    # Build grep pattern for filter
    $filterTags = $Filter -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    $grepPattern = ($filterTags -join '|')

    Write-Info "Capturing logs for $LogDuration seconds..."
    Write-Info "Filter pattern: $grepPattern"
    Write-Host ""
    Write-Host "--- Live Logs ---" -ForegroundColor Cyan

    # Capture filtered logs with timeout
    $debugLogPath = Join-Path $ProjectRoot "app_debug.log"
    $fullLogPath = Join-Path $ProjectRoot "app_full.log"

    # Start logcat in background
    $logcatJob = Start-Job -ScriptBlock {
        param($adb, $device, $duration)
        $deadline = (Get-Date).AddSeconds($duration)
        & $adb -s $device logcat -v time 2>&1 | ForEach-Object {
            $_
            if ((Get-Date) -gt $deadline) { break }
        }
    } -ArgumentList $ADB, $selectedDevice, $LogDuration

    # Wait and collect output
    $allLogs = @()
    $startTime = Get-Date

    while ((Get-Date) -lt $startTime.AddSeconds($LogDuration)) {
        $output = Receive-Job -Job $logcatJob -ErrorAction SilentlyContinue
        if ($output) {
            foreach ($line in $output) {
                $allLogs += $line
                # Print filtered lines to console
                if ($line -match $grepPattern) {
                    Write-Host $line -ForegroundColor Yellow
                }
            }
        }
        Start-Sleep -Milliseconds 500
    }

    Stop-Job -Job $logcatJob -ErrorAction SilentlyContinue
    $remainingOutput = Receive-Job -Job $logcatJob -ErrorAction SilentlyContinue
    if ($remainingOutput) { $allLogs += $remainingOutput }
    Remove-Job -Job $logcatJob -Force -ErrorAction SilentlyContinue

    # Also get any logs we might have missed
    $additionalLogs = & $ADB -s $selectedDevice logcat -d -v time 2>&1

    # Filter and save logs
    $filteredLogs = $allLogs + $additionalLogs | Where-Object { $_ -match $grepPattern }
    $filteredLogs | Out-File -FilePath $debugLogPath -Encoding UTF8

    # Save full logs (last 500 lines)
    ($allLogs + $additionalLogs) | Select-Object -Last 500 | Out-File -FilePath $fullLogPath -Encoding UTF8

    $Script:Result.logs.debugLog = $debugLogPath
    $Script:Result.logs.fullLog = $fullLogPath

    Write-Host ""
    Write-Host "--- End Logs ---" -ForegroundColor Cyan
    Write-Host ""

    Write-Step "CAPTURE LOGS" "success" "$($filteredLogs.Count) filtered lines captured"
    Write-Info "Debug log: $debugLogPath"
    Write-Info "Full log: $fullLogPath"

    # Check for crashes
    $crashes = $allLogs + $additionalLogs | Where-Object { $_ -match "FATAL|AndroidRuntime.*E/" }
    if ($crashes.Count -gt 0) {
        Write-Host ""
        Write-Host "!!! CRASH DETECTED !!!" -ForegroundColor Red
        $crashes | Select-Object -First 10 | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    }

} else {
    # Desktop - run with output capture
    Write-Info "Running desktop app..."
    Write-Host ""
    Write-Host "--- App Output ---" -ForegroundColor Cyan

    $desktopLogPath = Join-Path $ProjectRoot "app_debug.log"

    # Run the app
    $runOutput = & ./gradlew :desktopApp:run --quiet 2>&1
    $runOutput | Tee-Object -FilePath $desktopLogPath

    Write-Host ""
    Write-Host "--- End Output ---" -ForegroundColor Cyan

    $Script:Result.logs.debugLog = $desktopLogPath
    Write-Step "CAPTURE LOGS" "success"
}

# ============================================================================
# SUMMARY
# ============================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Run Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$Script:Result.status = "success"

Write-Host "Status: SUCCESS" -ForegroundColor Green
Write-Host "Target: $Target"
if ($Target -eq "android") {
    Write-Host "Device: $selectedDevice"
    Write-Host "Package: $($Script:Result.app.package)"
}
Write-Host ""
Write-Host "Log files:" -ForegroundColor Yellow
Write-Host "  Debug: $($Script:Result.logs.debugLog)"
if ($Script:Result.logs.fullLog) {
    Write-Host "  Full:  $($Script:Result.logs.fullLog)"
}

if ($Script:IsJson) { Write-JsonResult }
exit 0
