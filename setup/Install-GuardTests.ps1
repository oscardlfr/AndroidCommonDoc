#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install Konsist guard test templates into a consuming project.

.DESCRIPTION
    Copies parameterized guard test templates from AndroidCommonDoc into
    a consumer project's konsist-guard/ module. Replaces __ROOT_PACKAGE__
    tokens with the consumer's root package and adds the module to
    settings.gradle.kts.

.PARAMETER Package
    Consumer root package (required, e.g., com.example.myapp).

.PARAMETER TargetPath
    Consumer project directory. Defaults to current directory.

.PARAMETER Force
    Overwrite existing guard test files.

.PARAMETER DryRun
    Preview changes without creating files.

.EXAMPLE
    ./Install-GuardTests.ps1 -Package com.example.myapp

.EXAMPLE
    ./Install-GuardTests.ps1 -Package com.example.myapp -TargetPath C:\Projects\MyApp -DryRun

.EXAMPLE
    ./Install-GuardTests.ps1 -Package com.example.myapp -Force
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Package,

    [Parameter(Mandatory = $false)]
    [string]$TargetPath = "",

    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidCommonDoc = Split-Path -Parent $ScriptRoot
$TemplatesDir = Join-Path $AndroidCommonDoc "guard-templates"

if ($TargetPath -eq "") {
    $TargetPath = Get-Location
}

# --- Header ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Guard Test Template Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Validation ---
if (-not (Test-Path $TemplatesDir -PathType Container)) {
    Write-Host "[ERROR] Templates directory not found: $TemplatesDir" -ForegroundColor Red
    Write-Host "[ERROR] Ensure you are running from within the AndroidCommonDoc checkout." -ForegroundColor Red
    exit 1
}

$settingsKts = Join-Path $TargetPath "settings.gradle.kts"
$settingsGroovy = Join-Path $TargetPath "settings.gradle"
if (-not (Test-Path $settingsKts) -and -not (Test-Path $settingsGroovy)) {
    Write-Host "[ERROR] Target directory is not a Gradle project (no settings.gradle.kts found): $TargetPath" -ForegroundColor Red
    exit 1
}

# --- Detect Kotlin version from consumer's version catalog ---
$KotlinVersion = ""
$VersionsToml = Join-Path $TargetPath "gradle" "libs.versions.toml"
if (Test-Path $VersionsToml) {
    $versionLine = Select-String -Path $VersionsToml -Pattern '^\s*kotlin\s*=' | Select-Object -First 1
    if ($versionLine) {
        $KotlinVersion = $versionLine.Line -replace '.*"(.*)".*', '$1'
    }
}
if ($KotlinVersion -eq "") {
    $KotlinVersion = "2.3.10"
    Write-Host "[WARN] Could not detect Kotlin version from libs.versions.toml, using fallback: $KotlinVersion" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Detected Kotlin version: $KotlinVersion" -ForegroundColor Green
}

Write-Host "Root package:    $Package" -ForegroundColor White
Write-Host "Kotlin version:  $KotlinVersion" -ForegroundColor White
Write-Host "Target project:  $TargetPath" -ForegroundColor White
Write-Host "Templates dir:   $TemplatesDir" -ForegroundColor White
Write-Host "Dry run:         $DryRun" -ForegroundColor White
Write-Host "Force overwrite: $Force" -ForegroundColor White
Write-Host ""

# --- Compute paths ---
$PackagePath = $Package.Replace(".", [IO.Path]::DirectorySeparatorChar)
$TargetDir = Join-Path $TargetPath "konsist-guard"
$KotlinDir = Join-Path $TargetDir "src" "test" "kotlin" $PackagePath "konsist" "guard"

# Counters
$Installed = 0
$Skipped = 0
$Errors = 0

# --- Create directory structure ---
Write-Host "[INFO] Creating directory structure..." -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  [DRY RUN] Would create: $KotlinDir" -ForegroundColor Yellow
} else {
    New-Item -ItemType Directory -Path $KotlinDir -Force | Out-Null
    Write-Host "  [OK] Created: $KotlinDir" -ForegroundColor Green
}

# --- Copy and substitute .kt.template files ---
Write-Host "[INFO] Installing Kotlin guard test templates..." -ForegroundColor Cyan
$ktTemplates = Get-ChildItem -Path $TemplatesDir -Filter "*.kt.template" -ErrorAction SilentlyContinue

foreach ($template in $ktTemplates) {
    $targetName = $template.Name -replace '\.template$', ''
    $targetFile = Join-Path $KotlinDir $targetName

    if ((Test-Path $targetFile) -and -not $Force) {
        Write-Host "  [WARN] Skipping $targetName (exists, use -Force to overwrite)" -ForegroundColor Yellow
        $Skipped++
        continue
    }

    if ($DryRun) {
        Write-Host "  [DRY RUN] Would generate: $targetName" -ForegroundColor Yellow
    } else {
        $content = (Get-Content -Path $template.FullName -Raw).Replace("__ROOT_PACKAGE__", $Package).Replace("__KOTLIN_VERSION__", $KotlinVersion)
        Set-Content -Path $targetFile -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  [OK] Generated: $targetName" -ForegroundColor Green
    }
    $Installed++
}

# --- Copy and substitute build.gradle.kts.template ---
Write-Host "[INFO] Installing build configuration..." -ForegroundColor Cyan
$buildTemplate = Join-Path $TemplatesDir "build.gradle.kts.template"
$buildTarget = Join-Path $TargetDir "build.gradle.kts"

if (Test-Path $buildTemplate) {
    if ((Test-Path $buildTarget) -and -not $Force) {
        Write-Host "  [WARN] Skipping build.gradle.kts (exists, use -Force to overwrite)" -ForegroundColor Yellow
        $Skipped++
    } else {
        if ($DryRun) {
            Write-Host "  [DRY RUN] Would generate: build.gradle.kts" -ForegroundColor Yellow
        } else {
            $content = (Get-Content -Path $buildTemplate -Raw).Replace("__ROOT_PACKAGE__", $Package).Replace("__KOTLIN_VERSION__", $KotlinVersion)
            Set-Content -Path $buildTarget -Value $content -Encoding UTF8 -NoNewline
            Write-Host "  [OK] Generated: build.gradle.kts" -ForegroundColor Green
        }
        $Installed++
    }
} else {
    Write-Host "  [ERROR] build.gradle.kts.template not found in $TemplatesDir" -ForegroundColor Red
    $Errors++
}

# --- Modify consumer's settings.gradle.kts ---
Write-Host "[INFO] Checking settings.gradle.kts..." -ForegroundColor Cyan
$settingsFile = ""
if (Test-Path $settingsKts) {
    $settingsFile = $settingsKts
} elseif (Test-Path $settingsGroovy) {
    $settingsFile = $settingsGroovy
}

if ($settingsFile -ne "") {
    $settingsContent = Get-Content -Path $settingsFile -Raw -ErrorAction SilentlyContinue
    if ($settingsContent -and ($settingsContent -match 'include.*konsist-guard')) {
        Write-Host "  [WARN] include("":konsist-guard"") already present in $(Split-Path -Leaf $settingsFile)" -ForegroundColor Yellow
    } else {
        if ($DryRun) {
            Write-Host "  [DRY RUN] Would append include("":konsist-guard"") to $(Split-Path -Leaf $settingsFile)" -ForegroundColor Yellow
        } else {
            $appendText = "`n// Guard tests -- architecture enforcement via Konsist (generated by AndroidCommonDoc)`ninclude("":konsist-guard"")"
            Add-Content -Path $settingsFile -Value $appendText -Encoding UTF8
            Write-Host "  [OK] Appended include("":konsist-guard"") to $(Split-Path -Leaf $settingsFile)" -ForegroundColor Green
        }
    }
}

# --- Summary ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installed: $Installed" -ForegroundColor White
Write-Host "  Skipped:   $Skipped" -ForegroundColor White
Write-Host "  Errors:    $Errors" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host ""
    Write-Host "[INFO] This was a dry run. No files were written." -ForegroundColor Cyan
    Write-Host "[INFO] Remove -DryRun to install for real." -ForegroundColor Cyan
}

Write-Host ""
if (-not $DryRun -and $Errors -eq 0) {
    Write-Host "[OK] Guard tests installed successfully." -ForegroundColor Green
    Write-Host "[INFO] Run tests with: cd $TargetPath; ./gradlew :konsist-guard:test" -ForegroundColor Cyan
}
