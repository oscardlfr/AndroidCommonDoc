#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install Claude Code hook scripts into Android/KMP projects.

.DESCRIPTION
    Copies Detekt enforcement hooks (post-write and pre-commit) to consuming
    projects and merges hook configuration into .claude/settings.json.

.PARAMETER TargetPath
    Path to scan for projects. Defaults to parent of AndroidCommonDoc.

.PARAMETER Projects
    Specific project names to process. Empty means auto-discover all.

.PARAMETER Force
    Overwrite existing hook files and settings.

.PARAMETER Mode
    Hook severity: block or warn (default: block).

.PARAMETER DryRun
    Preview changes without creating files.

.EXAMPLE
    ./Install-Hooks.ps1
    # Installs hooks to all discovered projects in block mode

.EXAMPLE
    ./Install-Hooks.ps1 -Projects MyApp,MyProject -Mode warn
    # Install to specific projects in warn mode

.EXAMPLE
    ./Install-Hooks.ps1 -DryRun
    # Preview what would be installed
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$TargetPath = "",

    [Parameter(Mandatory = $false)]
    [string[]]$Projects = @(),

    [switch]$Force,

    [ValidateSet("block", "warn")]
    [string]$Mode = "block",

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidCommonDoc = Split-Path -Parent $ScriptRoot
$HooksDir = Join-Path $AndroidCommonDoc ".claude\hooks"

if ($TargetPath -eq "") {
    $TargetPath = Split-Path -Parent $AndroidCommonDoc
}

# --- ANDROID_COMMON_DOC env var guard ---
# Consuming projects use $env:ANDROID_COMMON_DOC at runtime (hooks reference central scripts).
# Validate it's set and points to a real directory before doing any install work.
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

# --- Project Discovery ---
function Get-AndroidProjects {
    param([string]$SearchPath)

    $discovered = @()

    Get-ChildItem -Path $SearchPath -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $projectDir = $_.FullName
        $projectName = $_.Name

        # Skip AndroidCommonDoc itself
        if ($projectName -eq "AndroidCommonDoc") { return }

        # Skip hidden directories
        if ($projectName.StartsWith(".")) { return }

        $settingsPath = Join-Path $projectDir "settings.gradle.kts"
        $buildPath = Join-Path $projectDir "build.gradle.kts"

        if ((Test-Path $settingsPath) -or (Test-Path $buildPath)) {
            $discovered += @{
                Name = $projectName
                Path = $projectDir
            }
        }
    }

    return $discovered
}

# --- JSON Merging ---
function Merge-HookSettings {
    param(
        [string]$SettingsPath,
        [string]$HookMode
    )

    # Load existing settings or create empty
    $settings = @{}
    if (Test-Path $SettingsPath) {
        $raw = Get-Content $SettingsPath -Raw -ErrorAction SilentlyContinue
        if ($raw) {
            $settings = $raw | ConvertFrom-Json -AsHashtable
        }
    }

    # Initialize hooks structure if absent
    if (-not $settings.ContainsKey("hooks")) {
        $settings["hooks"] = @{}
    }

    $hooks = $settings["hooks"]

    # Define hook entries
    $postWriteHook = @{
        matcher = "Write|Edit"
        hooks = @(@{
            type = "command"
            command = '\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-post-write.sh'
            timeout = 30
        })
    }

    $preCommitHook = @{
        matcher = "Bash"
        hooks = @(@{
            type = "command"
            command = '\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-pre-commit.sh'
            timeout = 60
        })
    }

    # --- Merge PostToolUse ---
    if (-not $hooks.ContainsKey("PostToolUse")) {
        $hooks["PostToolUse"] = @()
    }

    $hasPostWrite = $false
    foreach ($entry in $hooks["PostToolUse"]) {
        if ($entry.matcher -eq "Write|Edit") {
            foreach ($h in $entry.hooks) {
                if ($h.command -match "detekt-post-write") {
                    $hasPostWrite = $true
                    break
                }
            }
        }
        if ($hasPostWrite) { break }
    }

    if (-not $hasPostWrite) {
        $hooks["PostToolUse"] += $postWriteHook
    }

    # --- Merge PreToolUse ---
    if (-not $hooks.ContainsKey("PreToolUse")) {
        $hooks["PreToolUse"] = @()
    }

    $hasPreCommit = $false
    foreach ($entry in $hooks["PreToolUse"]) {
        if ($entry.matcher -eq "Bash") {
            foreach ($h in $entry.hooks) {
                if ($h.command -match "detekt-pre-commit") {
                    $hasPreCommit = $true
                    break
                }
            }
        }
        if ($hasPreCommit) { break }
    }

    if (-not $hasPreCommit) {
        $hooks["PreToolUse"] += $preCommitHook
    }

    $settings["hooks"] = $hooks

    # Write back with indentation
    $json = $settings | ConvertTo-Json -Depth 10
    Set-Content -Path $SettingsPath -Value $json -Encoding UTF8 -NoNewline

    return @{ PostWriteAdded = (-not $hasPostWrite); PreCommitAdded = (-not $hasPreCommit) }
}

# --- Main Execution ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Claude Code Hooks Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AndroidCommonDoc: $AndroidCommonDoc" -ForegroundColor White
Write-Host "Hooks source: $HooksDir" -ForegroundColor White
Write-Host "Mode: $Mode" -ForegroundColor White

# Validate hook scripts exist
$hookPostWrite = Join-Path $HooksDir "detekt-post-write.sh"
$hookPreCommit = Join-Path $HooksDir "detekt-pre-commit.sh"

if (-not (Test-Path $hookPostWrite)) {
    Write-Error "Post-write hook not found: $hookPostWrite"
    exit 1
}
if (-not (Test-Path $hookPreCommit)) {
    Write-Error "Pre-commit hook not found: $hookPreCommit"
    exit 1
}

Write-Host "Hook scripts found: detekt-post-write.sh, detekt-pre-commit.sh" -ForegroundColor Green

# Discover or filter projects
if ($Projects.Count -gt 0) {
    Write-Host "`nProcessing specified projects: $($Projects -join ', ')" -ForegroundColor Yellow
    $allProjects = @()

    foreach ($name in $Projects) {
        $path = Join-Path $TargetPath $name
        if (Test-Path $path) {
            $allProjects += @{
                Name = $name
                Path = $path
            }
        } else {
            Write-Warning "Project not found: $name at $path"
        }
    }
} else {
    Write-Host "`nDiscovering projects..." -ForegroundColor Yellow
    $allProjects = Get-AndroidProjects -SearchPath $TargetPath
}

Write-Host "Found $($allProjects.Count) project(s)" -ForegroundColor White

if ($allProjects.Count -eq 0) {
    Write-Warning "No projects found. Check path or specify projects with -Projects parameter."
    exit 0
}

$totalInstalled = 0
$totalSkipped = 0
$totalErrors = 0

foreach ($project in $allProjects) {
    $projectDir = $project.Path
    $targetHooksDir = Join-Path $projectDir ".claude\hooks"
    $settingsFile = Join-Path $projectDir ".claude\settings.json"

    Write-Host ""
    Write-Host "Project: $($project.Name)" -ForegroundColor Cyan
    Write-Host "  Path: $projectDir" -ForegroundColor Gray

    # --- Step 1: Copy hook scripts ---
    foreach ($hookFile in @($hookPostWrite, $hookPreCommit)) {
        $hookName = Split-Path -Leaf $hookFile
        $targetPath = Join-Path $targetHooksDir $hookName

        if ((Test-Path $targetPath) -and -not $Force) {
            Write-Host "  [SKIP] $hookName (exists, use -Force to overwrite)" -ForegroundColor Yellow
            $totalSkipped++
            continue
        }

        if ($DryRun) {
            Write-Host "  [DRY RUN] Would copy: $hookName -> $targetHooksDir\" -ForegroundColor Yellow
        } else {
            if (-not (Test-Path $targetHooksDir)) {
                New-Item -ItemType Directory -Path $targetHooksDir -Force | Out-Null
            }
            Copy-Item -Path $hookFile -Destination $targetPath -Force
            Write-Host "  [OK] Copied: $hookName" -ForegroundColor Green
        }
        $totalInstalled++
    }

    # --- Step 2: Merge hooks into .claude/settings.json ---
    if ($DryRun) {
        Write-Host "  [DRY RUN] Would merge hook config into settings.json" -ForegroundColor Yellow
    } else {
        # Ensure .claude directory exists
        $claudeDir = Join-Path $projectDir ".claude"
        if (-not (Test-Path $claudeDir)) {
            New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
        }

        # Backup existing settings.json
        if (Test-Path $settingsFile) {
            Copy-Item -Path $settingsFile -Destination "${settingsFile}.bak" -Force
            Write-Host "  Backed up: settings.json -> settings.json.bak" -ForegroundColor Gray
        }

        try {
            $result = Merge-HookSettings -SettingsPath $settingsFile -HookMode $Mode
            if ($result.PostWriteAdded -or $result.PreCommitAdded) {
                Write-Host "  [OK] Merged hook config into settings.json" -ForegroundColor Green
            } else {
                Write-Host "  [SKIP] Hook config already present in settings.json" -ForegroundColor Yellow
            }
            $totalInstalled++
        } catch {
            Write-Host "  [ERROR] Failed to merge hook config: $_" -ForegroundColor Red
            $totalErrors++
        }
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installed: $totalInstalled" -ForegroundColor White
Write-Host "  Skipped:   $totalSkipped" -ForegroundColor White
Write-Host "  Errors:    $totalErrors" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host ""
    Write-Host "This was a dry run. No files were written." -ForegroundColor Yellow
    Write-Host "Remove -DryRun to install for real." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Restart Claude Code session (or use /hooks to review) for hooks to take effect." -ForegroundColor Yellow
