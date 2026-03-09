#!/usr/bin/env powershell
<#
.SYNOPSIS
    Verify KMP package organization and detect forbidden imports.

.DESCRIPTION
    Validates Kotlin Multiplatform architecture by checking:
    - commonMain has no platform-specific imports
    - Platform source sets (androidMain, desktopMain, iosMain) use appropriate code
    - Pure Kotlin in platform sets that could be in commonMain

.PARAMETER ProjectRoot
    Path to the project root. Defaults to current directory.

.PARAMETER ModulePath
    Specific module to check. Empty for entire project.

.PARAMETER ShowDetails
    Show detailed output including matched lines.

.PARAMETER StrictMode
    Fail on warnings (potential misplacements) in addition to errors.

.EXAMPLE
    ./verify-kmp-packages.ps1 -ModulePath "core/data"

.EXAMPLE
    ./verify-kmp-packages.ps1 -ProjectRoot "../MyApp" -StrictMode -ShowDetails
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = (Get-Location).Path,

    [Parameter(Mandatory = $false)]
    [string]$ModulePath = "",

    [switch]$ShowDetails,
    [switch]$StrictMode
)

$ErrorCount = 0
$WarningCount = 0

$searchPath = if ($ModulePath -ne "") {
    Join-Path $ProjectRoot $ModulePath
} else {
    $ProjectRoot
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  KMP Package Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Path: $searchPath" -ForegroundColor White
Write-Host ""

# Define forbidden imports for commonMain
$ForbiddenInCommonMain = @(
    # Android
    @{ Pattern = "android\."; Description = "Android SDK" }
    @{ Pattern = "androidx\."; Description = "AndroidX" }
    @{ Pattern = "javax\.inject"; Description = "Java Inject (use Koin)" }
    @{ Pattern = "dagger\."; Description = "Dagger (use Koin)" }

    # JVM-only
    @{ Pattern = "java\.io\.File[^S]"; Description = "java.io.File (use Okio)" }
    @{ Pattern = "java\.nio\."; Description = "java.nio (use Okio)" }

    # Desktop-only
    @{ Pattern = "javax\.swing"; Description = "Swing UI" }
    @{ Pattern = "java\.awt"; Description = "AWT UI" }

    # iOS-only
    @{ Pattern = "platform\.Foundation"; Description = "iOS Foundation" }
    @{ Pattern = "platform\.UIKit"; Description = "iOS UIKit" }
    @{ Pattern = "platform\.darwin"; Description = "Darwin APIs" }

    # Frameworks
    @{ Pattern = "Room"; Description = "Room Database (use SQLDelight)" }
    @{ Pattern = "Retrofit"; Description = "Retrofit (use Ktor)" }
    @{ Pattern = "Firebase"; Description = "Firebase (platform-specific)" }
)

# Platform-specific patterns (expected in their respective source sets)
$PlatformPatterns = @{
    "androidMain" = @("android\.", "androidx\.", "javax\.inject")
    "desktopMain" = @("javax\.swing", "java\.awt", "javax\.sound")
    "iosMain" = @("platform\.Foundation", "platform\.UIKit", "platform\.darwin")
    "appleMain" = @("platform\.Foundation", "platform\.darwin")
    "jvmMain" = @("java\.io\.", "java\.nio\.", "javax\.")
}

# Find commonMain files
$commonMainDirs = @("commonMain", "shared")
$commonMainFiles = @()

foreach ($dir in $commonMainDirs) {
    $files = Get-ChildItem -Path $searchPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -match "[\\/]src[\\/]$dir[\\/]" -and
            $_.FullName -notmatch "[\\/]test[\\/]" -and
            $_.FullName -notmatch "[\\/]build[\\/]"
        }
    $commonMainFiles += $files
}

if ($commonMainFiles.Count -gt 0) {
    Write-Host "Checking commonMain/shared packages..." -ForegroundColor Yellow
    Write-Host "Found $($commonMainFiles.Count) Kotlin files" -ForegroundColor White
    Write-Host ""

    foreach ($file in $commonMainFiles) {
        $relativePath = $file.FullName.Replace($ProjectRoot, "").TrimStart('\', '/')
        $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue

        if (-not $content) { continue }

        foreach ($forbidden in $ForbiddenInCommonMain) {
            if ($content -match "import\s+$($forbidden.Pattern)") {
                $ErrorCount++
                Write-Host "[ERROR] $relativePath" -ForegroundColor Red
                Write-Host "        Forbidden import: $($forbidden.Description)" -ForegroundColor DarkRed

                if ($ShowDetails) {
                    $lines = $content -split "`n" | Select-String -Pattern $forbidden.Pattern
                    foreach ($line in $lines | Select-Object -First 3) {
                        Write-Host "        Line $($line.LineNumber): $($line.Line.Trim())" -ForegroundColor DarkGray
                    }
                }
                Write-Host ""
            }
        }
    }

    if ($ErrorCount -eq 0) {
        Write-Host "[OK] All commonMain/shared files are KMP-compatible" -ForegroundColor Green
    }
}
else {
    Write-Host "[INFO] No commonMain/shared packages found" -ForegroundColor Gray
}

Write-Host ""

# Check platform source sets for misplaced pure Kotlin
$platformDirs = @("androidMain", "desktopMain", "iosMain", "appleMain", "jvmMain")

foreach ($platformDir in $platformDirs) {
    $platformFiles = Get-ChildItem -Path $searchPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -match "[\\/]src[\\/]$platformDir[\\/]" -and
            $_.FullName -notmatch "[\\/]test[\\/]" -and
            $_.FullName -notmatch "[\\/]build[\\/]"
        }

    if ($platformFiles.Count -eq 0) { continue }

    Write-Host "Checking $platformDir for misplaced pure Kotlin..." -ForegroundColor Yellow
    Write-Host "Found $($platformFiles.Count) Kotlin files" -ForegroundColor White
    Write-Host ""

    $expectedPatterns = $PlatformPatterns[$platformDir]

    foreach ($file in $platformFiles) {
        $relativePath = $file.FullName.Replace($ProjectRoot, "").TrimStart('\', '/')
        $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue

        if (-not $content) { continue }

        # Check if file has expect/actual (legitimate platform code)
        if ($content -match "\bactual\s+(fun|class|interface|val|var|typealias)") {
            continue # This is legitimate platform-specific implementation
        }

        # Check if file uses any platform-specific APIs
        $hasPlatformCode = $false
        foreach ($pattern in $expectedPatterns) {
            if ($content -match $pattern) {
                $hasPlatformCode = $true
                break
            }
        }

        if (-not $hasPlatformCode) {
            $WarningCount++
            Write-Host "[WARN] $relativePath" -ForegroundColor Yellow
            Write-Host "       Pure Kotlin file in $platformDir - consider moving to commonMain" -ForegroundColor DarkYellow

            if ($ShowDetails) {
                Write-Host "       No platform-specific imports found" -ForegroundColor DarkGray
            }
            Write-Host ""
        }
    }
}

# Check for expect declarations without actual implementations
Write-Host ""
Write-Host "Checking expect/actual consistency..." -ForegroundColor Yellow

$expectFiles = Get-ChildItem -Path $searchPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -match "[\\/]src[\\/]commonMain[\\/]" -and
        $_.FullName -notmatch "[\\/]build[\\/]"
    }

$expectDeclarations = @()
foreach ($file in $expectFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match "expect\s+(fun|class|interface)\s+(\w+)") {
        $expectDeclarations += @{
            File = $file.FullName
            Name = $matches[2]
            Type = $matches[1]
        }
    }
}

if ($expectDeclarations.Count -gt 0) {
    Write-Host "Found $($expectDeclarations.Count) expect declaration(s)" -ForegroundColor White

    foreach ($expect in $expectDeclarations) {
        # Check for actual implementations
        $actualFound = $false
        foreach ($platformDir in $platformDirs) {
            $actualFiles = Get-ChildItem -Path $searchPath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match "[\\/]src[\\/]$platformDir[\\/]" }

            foreach ($actualFile in $actualFiles) {
                $actualContent = Get-Content $actualFile.FullName -Raw -ErrorAction SilentlyContinue
                if ($actualContent -match "actual\s+$($expect.Type)\s+$($expect.Name)") {
                    $actualFound = $true
                    break
                }
            }
            if ($actualFound) { break }
        }

        if (-not $actualFound -and $ShowDetails) {
            Write-Host "  [?] expect $($expect.Type) $($expect.Name) - no actual found (may be in composite build)" -ForegroundColor DarkYellow
        }
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($commonMainFiles.Count -gt 0) {
    Write-Host "commonMain/shared files checked: $($commonMainFiles.Count)" -ForegroundColor White
    $color = if ($ErrorCount -gt 0) { "Red" } else { "Green" }
    Write-Host "KMP violations: $ErrorCount" -ForegroundColor $color
}

$color = if ($WarningCount -gt 0) { "Yellow" } else { "Green" }
Write-Host "Potential misplacements: $WarningCount" -ForegroundColor $color

Write-Host ""

if ($ErrorCount -gt 0) {
    Write-Host "[FAILED] KMP verification failed" -ForegroundColor Red
    Write-Host "Action: Move files with forbidden imports to platform-specific source sets" -ForegroundColor Red
    exit 1
}
elseif ($WarningCount -gt 0 -and $StrictMode) {
    Write-Host "[FAILED] KMP verification failed (strict mode)" -ForegroundColor Yellow
    Write-Host "Action: Consider moving pure Kotlin files from platform sets to commonMain" -ForegroundColor Yellow
    exit 1
}
elseif ($WarningCount -gt 0) {
    Write-Host "[PASSED with warnings] KMP verification passed" -ForegroundColor Yellow
    Write-Host "Recommendation: Consider moving pure Kotlin files to commonMain" -ForegroundColor Yellow
    exit 0
}
else {
    Write-Host "[PASSED] KMP verification passed" -ForegroundColor Green
    exit 0
}
