#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Unified setup for AndroidCommonDoc toolkit in a consuming project.

.DESCRIPTION
    Configures a consuming project with the full AndroidCommonDoc toolkit:
    convention plugin wiring, Claude Code hooks, skills, and Copilot prompts.
    All build file modifications use marker comments for idempotency and
    create .bak backups.

.PARAMETER ProjectRoot
    Path to the consuming project root (required).

.PARAMETER DryRun
    Preview changes without writing files.

.PARAMETER Force
    Overwrite existing files and configurations.

.PARAMETER SkipSkills
    Skip Claude Code skills installation.

.PARAMETER SkipCopilot
    Skip Copilot prompts and instructions installation.

.PARAMETER SkipHooks
    Skip Claude Code hooks installation.

.PARAMETER SkipGradle
    Skip Gradle build file modifications.

.PARAMETER Mode
    Hook severity: block or warn (default: block).

.EXAMPLE
    ./setup-toolkit.ps1 -ProjectRoot ..\MyApp
    # Full setup for MyApp project

.EXAMPLE
    ./setup-toolkit.ps1 -ProjectRoot ..\MyApp -DryRun
    # Preview what would be configured

.EXAMPLE
    ./setup-toolkit.ps1 -ProjectRoot ..\MyApp -SkipGradle -Mode warn
    # Skip Gradle modifications, use warn mode for hooks
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [switch]$DryRun,
    [switch]$Force,
    [switch]$SkipSkills,
    [switch]$SkipCopilot,
    [switch]$SkipHooks,
    [switch]$SkipGradle,

    [ValidateSet("block", "warn")]
    [string]$Mode = "block"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidCommonDoc = Split-Path -Parent $ScriptRoot

# --- ANDROID_COMMON_DOC env var guard ---
# Consuming projects use $env:ANDROID_COMMON_DOC at runtime (wrapper templates, hooks, etc.).
# Validate it's set and points to a real directory before doing any setup work.
if (-not $env:ANDROID_COMMON_DOC) {
    Write-Host "[ERROR] ANDROID_COMMON_DOC environment variable is not set." -ForegroundColor Red
    Write-Host "[ERROR] Set it to the path of your AndroidCommonDoc checkout:" -ForegroundColor Red
    Write-Host ""
    Write-Host '  $env:ANDROID_COMMON_DOC = "C:\path\to\AndroidCommonDoc"' -ForegroundColor Red
    Write-Host ""
    exit 1
}

if (-not (Test-Path $env:ANDROID_COMMON_DOC -PathType Container)) {
    Write-Host "[ERROR] ANDROID_COMMON_DOC points to a path that does not exist or is not a directory:" -ForegroundColor Red
    Write-Host "  $env:ANDROID_COMMON_DOC" -ForegroundColor Red
    Write-Host ""
    Write-Host "[ERROR] Check for typos or update the variable:" -ForegroundColor Red
    Write-Host '  $env:ANDROID_COMMON_DOC = "C:\path\to\AndroidCommonDoc"' -ForegroundColor Red
    Write-Host ""
    exit 1
}

# Resolve ProjectRoot to absolute path
$ProjectRoot = (Resolve-Path $ProjectRoot -ErrorAction Stop).Path
$ProjectName = Split-Path -Leaf $ProjectRoot

# Validate it's a Gradle project
$settingsKts = Join-Path $ProjectRoot "settings.gradle.kts"
$settingsGroovy = Join-Path $ProjectRoot "settings.gradle"

if (-not (Test-Path $settingsKts) -and -not (Test-Path $settingsGroovy)) {
    Write-Error "Not a Gradle project (no settings.gradle.kts or settings.gradle): $ProjectRoot"
    exit 1
}

$SettingsFile = if (Test-Path $settingsKts) { $settingsKts } else { $settingsGroovy }

# Parent directory for project discovery by sub-scripts
$ParentDir = Split-Path -Parent $AndroidCommonDoc

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AndroidCommonDoc Toolkit Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Common doc: $AndroidCommonDoc" -ForegroundColor White
Write-Host "Target project: $ProjectName ($ProjectRoot)" -ForegroundColor White
Write-Host "Mode: $Mode" -ForegroundColor White

if ($DryRun) {
    Write-Host "DRY RUN MODE -- no files will be modified" -ForegroundColor Yellow
}

# Track what was done
$stepsDone = @()
$stepsSkipped = @()
$stepsFailed = @()

$Marker = "// AndroidCommonDoc toolkit -- managed by setup script"

# ============================================================
# Step 1: Modify settings.gradle.kts (convention plugin wiring)
# ============================================================
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Cyan
Write-Host "  Step 1: Gradle settings (includeBuild)" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Cyan

if ($SkipGradle) {
    Write-Host "Skipped (-SkipGradle)" -ForegroundColor Yellow
    $stepsSkipped += "Step 1: Gradle settings"
} else {
    $content = Get-Content $SettingsFile -Raw -ErrorAction SilentlyContinue

    if ($content -and $content.Contains($Marker)) {
        Write-Host "Already configured (marker found), skipping" -ForegroundColor Gray
        $stepsSkipped += "Step 1: Gradle settings (already configured)"
    } else {
        # Calculate relative path from consuming project to build-logic/
        $buildLogicPath = Join-Path $AndroidCommonDoc "build-logic"
        $relPath = python3 -c "
import os, sys
consuming = sys.argv[1]
build_logic = sys.argv[2]
rel = os.path.relpath(build_logic, consuming)
print(rel.replace(os.sep, '/'))
" $ProjectRoot $buildLogicPath

        $includeLine = "includeBuild(`"$relPath`") $Marker"

        if ($DryRun) {
            Write-Host "[DRY RUN] Would insert into settings.gradle.kts:" -ForegroundColor Yellow
            Write-Host "  $includeLine" -ForegroundColor Yellow
        } else {
            # Backup
            Copy-Item -Path $SettingsFile -Destination "${SettingsFile}.bak" -Force
            Write-Host "Backed up: $(Split-Path -Leaf $SettingsFile) -> $(Split-Path -Leaf $SettingsFile).bak" -ForegroundColor Gray

            # Read lines and find insertion point
            $lines = Get-Content $SettingsFile
            $insertIdx = $lines.Count
            for ($i = 0; $i -lt $lines.Count; $i++) {
                $stripped = $lines[$i].Trim()
                if ($stripped.StartsWith("include(") -or $stripped.StartsWith("includeBuild(")) {
                    $insertIdx = $i
                    break
                }
            }

            $newLines = @()
            $newLines += $lines[0..($insertIdx - 1)]
            $newLines += $includeLine
            if ($insertIdx -lt $lines.Count) {
                $newLines += $lines[$insertIdx..($lines.Count - 1)]
            }

            Set-Content -Path $SettingsFile -Value ($newLines -join "`n") -Encoding UTF8 -NoNewline
            Write-Host "[OK] Inserted includeBuild for build-logic (relative path: $relPath)" -ForegroundColor Green
        }
        $stepsDone += "Step 1: Gradle settings (includeBuild)"
    }
}

# ============================================================
# Step 2: Modify module build.gradle.kts files (plugin application)
# ============================================================
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Cyan
Write-Host "  Step 2: Module build files (plugin ID)" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Cyan

if ($SkipGradle) {
    Write-Host "Skipped (-SkipGradle)" -ForegroundColor Yellow
    $stepsSkipped += "Step 2: Module build files"
} else {
    $pluginLine = "    id(`"androidcommondoc.toolkit`") $Marker"
    $modulesModified = 0

    $buildFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "build.gradle.kts" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "\\build\\" -and $_.FullName -notmatch "\\.gradle\\" -and $_.FullName -notmatch "\\build-logic\\" }

    foreach ($buildFile in $buildFiles) {
        $buildContent = Get-Content $buildFile.FullName -Raw -ErrorAction SilentlyContinue
        if (-not $buildContent) { continue }

        # Check if it applies Android or KMP plugins
        if ($buildContent -notmatch "(com\.android\.application|com\.android\.library|kotlin\.multiplatform)") {
            continue
        }

        # Check if already has our marker
        if ($buildContent.Contains($Marker)) {
            $relFile = $buildFile.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")
            Write-Host "  Already configured: $relFile" -ForegroundColor Gray
            continue
        }

        $relFile = $buildFile.FullName.Replace($ProjectRoot, "").TrimStart("\", "/")

        if ($DryRun) {
            Write-Host "  [DRY RUN] Would modify: $relFile" -ForegroundColor Yellow
        } else {
            # Backup
            Copy-Item -Path $buildFile.FullName -Destination "$($buildFile.FullName).bak" -Force

            # Insert plugin ID inside plugins { } block
            $lines = Get-Content $buildFile.FullName
            $inPlugins = $false
            $braceDepth = 0
            $insertIdx = -1

            for ($i = 0; $i -lt $lines.Count; $i++) {
                $stripped = $lines[$i].Trim()

                if ($stripped -match "plugins" -and $stripped.Contains("{")) {
                    $inPlugins = $true
                    $openCount = ($stripped.ToCharArray() | Where-Object { $_ -eq "{" }).Count
                    $closeCount = ($stripped.ToCharArray() | Where-Object { $_ -eq "}" }).Count
                    $braceDepth = $openCount - $closeCount
                    if ($braceDepth -le 0) {
                        $inPlugins = $false
                    }
                    continue
                }

                if ($inPlugins) {
                    $openCount = ($stripped.ToCharArray() | Where-Object { $_ -eq "{" }).Count
                    $closeCount = ($stripped.ToCharArray() | Where-Object { $_ -eq "}" }).Count
                    $braceDepth += $openCount - $closeCount
                    if ($braceDepth -le 0) {
                        $insertIdx = $i
                        break
                    }
                }
            }

            if ($insertIdx -ge 0) {
                $newLines = @()
                if ($insertIdx -gt 0) {
                    $newLines += $lines[0..($insertIdx - 1)]
                }
                $newLines += $pluginLine
                $newLines += $lines[$insertIdx..($lines.Count - 1)]

                Set-Content -Path $buildFile.FullName -Value ($newLines -join "`n") -Encoding UTF8 -NoNewline
                Write-Host "  [OK] Modified: $relFile" -ForegroundColor Green
                $modulesModified++
            }
        }
    }

    if ($modulesModified -gt 0 -or $DryRun) {
        $stepsDone += "Step 2: Module build files ($modulesModified modified)"
    } else {
        $stepsSkipped += "Step 2: Module build files (none found or all configured)"
    }
}

# ============================================================
# Step 3: Sync L0 skills (registry-based materialization)
# ============================================================
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Cyan
Write-Host "  Step 3: L0 Skill Sync" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Cyan

if ($SkipSkills) {
    Write-Host "Skipped (-SkipSkills)" -ForegroundColor Yellow
    $stepsSkipped += "Step 3: L0 Skill Sync"
} else {
    $syncCli = Join-Path $AndroidCommonDoc "mcp-server\src\sync\sync-l0-cli.ts"
    if (-not (Test-Path $syncCli)) {
        Write-Host "[ERROR] Sync CLI not found: $syncCli" -ForegroundColor Red
        $stepsFailed += "Step 3: L0 Skill Sync (CLI not found)"
    } else {
        if ($DryRun) {
            Write-Host "[DRY RUN] Would run: npx tsx $syncCli --project-root $ProjectRoot --l0-root $AndroidCommonDoc" -ForegroundColor Yellow
            $stepsDone += "Step 3: L0 Skill Sync (dry run)"
        } else {
            Write-Host "Running L0 sync engine..." -ForegroundColor Cyan
            Push-Location (Join-Path $AndroidCommonDoc "mcp-server")
            try {
                & npx tsx $syncCli --project-root $ProjectRoot --l0-root $AndroidCommonDoc
                $stepsDone += "Step 3: L0 Skill Sync"
            } catch {
                Write-Host "[WARN] Sync returned non-zero" -ForegroundColor Yellow
                $stepsDone += "Step 3: L0 Skill Sync (partial)"
            } finally {
                Pop-Location
            }
        }
    }
}

# ============================================================
# Step 4: Install Copilot prompts and instructions
# ============================================================
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Cyan
Write-Host "  Step 4: Copilot prompts & instructions" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Cyan

if ($SkipCopilot) {
    Write-Host "Skipped (-SkipCopilot)" -ForegroundColor Yellow
    $stepsSkipped += "Step 4: Copilot prompts & instructions"
} else {
    $copilotScript = Join-Path $ScriptRoot "Install-CopilotPrompts.ps1"
    if (-not (Test-Path $copilotScript)) {
        Write-Host "[ERROR] Copilot prompts installer not found: $copilotScript" -ForegroundColor Red
        $stepsFailed += "Step 4: Copilot prompts (script not found)"
    } else {
        $copilotArgs = @{
            Projects = @($ProjectName)
        }
        if ($Force) { $copilotArgs["Force"] = $true }
        if ($DryRun) { $copilotArgs["DryRun"] = $true }

        & $copilotScript @copilotArgs
        $stepsDone += "Step 4: Copilot prompts"
    }
}

# ============================================================
# Step 5: Install Claude Code hooks
# ============================================================
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Cyan
Write-Host "  Step 5: Claude Code hooks" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Cyan

if ($SkipHooks) {
    Write-Host "Skipped (-SkipHooks)" -ForegroundColor Yellow
    $stepsSkipped += "Step 5: Claude Code hooks"
} else {
    $hooksScript = Join-Path $ScriptRoot "Install-Hooks.ps1"
    if (-not (Test-Path $hooksScript)) {
        Write-Host "[ERROR] Hooks installer not found: $hooksScript" -ForegroundColor Red
        $stepsFailed += "Step 5: Claude Code hooks (script not found)"
    } else {
        $hooksArgs = @{
            Projects = @($ProjectName)
            Mode = $Mode
        }
        if ($Force) { $hooksArgs["Force"] = $true }
        if ($DryRun) { $hooksArgs["DryRun"] = $true }

        & $hooksScript @hooksArgs
        $stepsDone += "Step 5: Claude Code hooks"
    }
}

# ============================================================
# Step 6: Summary
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete: $ProjectName" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($stepsDone.Count -gt 0) {
    Write-Host ""
    Write-Host "  Completed:" -ForegroundColor White
    foreach ($step in $stepsDone) {
        Write-Host "    + $step" -ForegroundColor Green
    }
}

if ($stepsSkipped.Count -gt 0) {
    Write-Host ""
    Write-Host "  Skipped:" -ForegroundColor White
    foreach ($step in $stepsSkipped) {
        Write-Host "    - $step" -ForegroundColor Yellow
    }
}

if ($stepsFailed.Count -gt 0) {
    Write-Host ""
    Write-Host "  Failed:" -ForegroundColor White
    foreach ($step in $stepsFailed) {
        Write-Host "    ! $step" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Set ANDROID_COMMON_DOC environment variable (if not already set):" -ForegroundColor White
Write-Host "       `$env:ANDROID_COMMON_DOC = `"$AndroidCommonDoc`"" -ForegroundColor White
Write-Host ""
Write-Host "  2. Build detekt-rules JAR:" -ForegroundColor White
Write-Host "       cd $AndroidCommonDoc\detekt-rules; .\gradlew assemble" -ForegroundColor White
Write-Host ""
Write-Host "  3. Sync Gradle in your project (for convention plugin)" -ForegroundColor White
Write-Host ""
Write-Host "  4. Restart Claude Code session for hooks to take effect" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Selective Adoption" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Individual scripts for partial setup:" -ForegroundColor White
Write-Host "    cd $AndroidCommonDoc\mcp-server; npx tsx src\sync\sync-l0-cli.ts --project-root PROJECT --l0-root $AndroidCommonDoc" -ForegroundColor White
Write-Host "    .\Install-CopilotPrompts.ps1 -DryRun" -ForegroundColor White
Write-Host "    .\Install-Hooks.ps1 -DryRun" -ForegroundColor White
Write-Host ""
