#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install GitHub Copilot prompt files to Android/KMP projects.

.DESCRIPTION
    Auto-discovers projects in AndroidStudioProjects and installs Copilot
    prompt files (.prompt.md), copilot-instructions.md, and instruction files
    from AndroidCommonDoc's copilot-templates directory.

.PARAMETER TargetPath
    Path to scan for projects. Defaults to parent of AndroidCommonDoc.

.PARAMETER Projects
    Specific project names to process. Empty means auto-discover all.

.PARAMETER Force
    Overwrite existing prompt files.

.PARAMETER SetEnvVar
    Set ANDROID_COMMON_DOC environment variable permanently.

.PARAMETER DryRun
    Preview changes without creating files.

.EXAMPLE
    ./Install-CopilotPrompts.ps1 -SetEnvVar
    # Sets env var and installs to all discovered projects

.EXAMPLE
    ./Install-CopilotPrompts.ps1 -Projects MyApp,MyProject,MyKmpLib
    # Install only to specific projects

.EXAMPLE
    ./Install-CopilotPrompts.ps1 -DryRun
    # Preview what would be created
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$TargetPath = "",

    [Parameter(Mandatory = $false)]
    [string[]]$Projects = @(),

    [switch]$Force,
    [switch]$SetEnvVar,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidCommonDoc = Split-Path -Parent $ScriptRoot

if ($TargetPath -eq "") {
    $TargetPath = Split-Path -Parent $AndroidCommonDoc
}

# --- Environment Variable Setup ---
function Set-AndroidCommonDocEnv {
    Write-Host "`nSetting ANDROID_COMMON_DOC environment variable..." -ForegroundColor Cyan

    [Environment]::SetEnvironmentVariable(
        "ANDROID_COMMON_DOC",
        $AndroidCommonDoc,
        [EnvironmentVariableTarget]::User
    )

    # Also set for current session
    $env:ANDROID_COMMON_DOC = $AndroidCommonDoc

    Write-Host "  Set to: $AndroidCommonDoc" -ForegroundColor Green
    Write-Host "  Note: Restart terminal for changes to take effect in new sessions" -ForegroundColor Yellow
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
            $projectInfo = Get-ProjectType -ProjectPath $projectDir

            $discovered += @{
                Name = $projectName
                Path = $projectDir
                Type = $projectInfo.Type
                IsKMP = $projectInfo.IsKMP
                IsLibrary = $projectInfo.IsLibrary
                Platforms = $projectInfo.Platforms
            }
        }
    }

    return $discovered
}

function Get-ProjectType {
    param([string]$ProjectPath)

    $result = @{
        Type = "android"
        IsKMP = $false
        IsLibrary = $false
        Platforms = @("android")
    }

    $projectName = Split-Path -Leaf $ProjectPath
    $settingsPath = Join-Path $ProjectPath "settings.gradle.kts"

    # Check if it's a library project
    if ($projectName -match "^(shared-libs|.*-lib|.*-library)$") {
        $result.IsLibrary = $true
    }

    # Check for KMP indicators by directory structure
    if (Test-Path (Join-Path $ProjectPath "desktopApp")) {
        $result.IsKMP = $true
        $result.Platforms += "desktop"
    }
    if (Test-Path (Join-Path $ProjectPath "iosApp")) {
        $result.IsKMP = $true
        $result.Platforms += "ios"
    }
    if (Test-Path (Join-Path $ProjectPath "macosApp")) {
        $result.IsKMP = $true
        $result.Platforms += "macos"
    }

    # Check settings.gradle.kts content
    if (Test-Path $settingsPath) {
        $content = Get-Content $settingsPath -Raw -ErrorAction SilentlyContinue

        if ($content) {
            if ($content -match "desktopApp|iosApp|macosApp|shared-kmp|commonMain") {
                $result.IsKMP = $true
            }

            if ($content -match "includeBuild.*shared-libs") {
                $result.Type = "kmp-composite"
            }
        }
    }

    # Check for commonMain directories
    $commonMainExists = Get-ChildItem -Path $ProjectPath -Recurse -Directory -Depth 5 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "commonMain" } |
        Select-Object -First 1

    if ($commonMainExists) {
        $result.IsKMP = $true
    }

    if ($result.IsKMP) {
        $result.Type = if ($result.IsLibrary) { "kmp-library" } else { "kmp" }
    }

    return $result
}

# --- Skill Selection ---
function Get-SkillsForProjectType {
    param([hashtable]$ProjectInfo)

    # Base skills for all projects
    $skills = @("test", "test-full", "test-full-parallel", "test-changed", "coverage", "coverage-full", "extract-errors", "auto-cover")

    if ($ProjectInfo.IsKMP) {
        $skills += "verify-kmp"
        $skills += "sync-versions"
    }

    # Pattern validation for non-library projects
    if (-not $ProjectInfo.IsLibrary) {
        $skills += "validate-patterns"
    }

    # Run skill for runnable apps (not libraries)
    if (-not $ProjectInfo.IsLibrary) {
        $skills += "run"
    }

    # Android instrumented test skill (for projects with Android support)
    if (-not $ProjectInfo.IsLibrary) {
        $skills += "android-test"
    }

    # SBOM skills for non-library projects
    if (-not $ProjectInfo.IsLibrary) {
        $skills += "sbom"
        $skills += "sbom-scan"
        $skills += "sbom-analyze"
    }

    return $skills
}

# --- Template Processing ---
function Invoke-VariableSubstitution {
    param(
        [string]$Content,
        [string]$ProjectPath,
        [hashtable]$ProjectInfo
    )

    $projectName = Split-Path -Leaf $ProjectPath
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $platforms = $ProjectInfo.Platforms -join ", "

    $result = $Content `
        -replace "\{\{PROJECT_TYPE\}\}", $ProjectInfo.Type `
        -replace "\{\{PROJECT_NAME\}\}", $projectName `
        -replace "\{\{TIMESTAMP\}\}", $timestamp `
        -replace "\{\{PLATFORMS\}\}", $platforms

    return $result
}

# --- Installation ---
function Install-PromptsToProject {
    param(
        [hashtable]$ProjectInfo,
        [switch]$Force,
        [switch]$DryRun
    )

    $promptsDir = Join-Path $ProjectInfo.Path ".github\prompts"
    $instructionsDir = Join-Path $ProjectInfo.Path ".github\instructions"
    $copilotInstructionsTarget = Join-Path $ProjectInfo.Path ".github\copilot-instructions.md"

    Write-Host ""
    Write-Host "Project: $($ProjectInfo.Name)" -ForegroundColor Cyan
    Write-Host "  Path: $($ProjectInfo.Path)" -ForegroundColor Gray
    Write-Host "  Type: $($ProjectInfo.Type) | KMP: $($ProjectInfo.IsKMP) | Library: $($ProjectInfo.IsLibrary)" -ForegroundColor Gray

    # Determine which skills/prompts to install
    $skills = Get-SkillsForProjectType -ProjectInfo $ProjectInfo
    Write-Host "  Prompts: $($skills -join ', ')" -ForegroundColor White

    if ($DryRun) {
        Write-Host "  [DRY RUN] Would create: $promptsDir" -ForegroundColor Yellow
        foreach ($skill in $skills) {
            Write-Host "  [DRY RUN] Would create: $skill.prompt.md" -ForegroundColor Yellow
        }
        Write-Host "  [DRY RUN] Would create: .github/copilot-instructions.md" -ForegroundColor Yellow

        # Check for instruction files
        $instructionTemplates = Get-ChildItem -Path (Join-Path $templatesDir "instructions") -Filter "*.instructions.md" -ErrorAction SilentlyContinue
        foreach ($instrTemplate in $instructionTemplates) {
            Write-Host "  [DRY RUN] Would create: .github/instructions/$($instrTemplate.Name)" -ForegroundColor Yellow
        }

        # Check for copilot-instructions-generated.md
        $generatedInstructions = Join-Path $ScriptRoot "copilot-templates\copilot-instructions-generated.md"
        if (Test-Path $generatedInstructions) {
            Write-Host "  [DRY RUN] Would copy copilot-instructions-generated.md -> $($ProjectInfo.Name)/.github/copilot-instructions.md" -ForegroundColor Yellow
        } else {
            Write-Host "  [WARN] copilot-instructions-generated.md not found -- run adapters/generate-all.sh first to generate it" -ForegroundColor Yellow
        }
        return
    }

    # Create .github/prompts directory
    if (-not (Test-Path $promptsDir)) {
        New-Item -ItemType Directory -Path $promptsDir -Force | Out-Null
        Write-Host "  Created: $promptsDir" -ForegroundColor Green
    }

    $created = 0
    $skipped = 0

    # Install prompt files (filtered by skill selection)
    foreach ($skill in $skills) {
        $templatePath = Join-Path $templatesDir "$skill.prompt.md"

        if (-not (Test-Path $templatePath)) {
            # Not all skills have a corresponding prompt template -- skip silently
            continue
        }

        $targetPath = Join-Path $promptsDir "$skill.prompt.md"

        if ((Test-Path $targetPath) -and -not $Force) {
            Write-Host "  [SKIP] $skill.prompt.md (exists, use -Force to overwrite)" -ForegroundColor Yellow
            $skipped++
            continue
        }

        $template = Get-Content $templatePath -Raw
        $content = Invoke-VariableSubstitution -Content $template -ProjectPath $ProjectInfo.Path -ProjectInfo $ProjectInfo

        Set-Content -Path $targetPath -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  [OK] $skill.prompt.md" -ForegroundColor Green
        $created++
    }

    # Install copilot-instructions.md
    $copilotInstructionsTemplate = Join-Path $templatesDir "copilot-instructions.md"
    if (Test-Path $copilotInstructionsTemplate) {
        if ((Test-Path $copilotInstructionsTarget) -and -not $Force) {
            Write-Host "  [SKIP] copilot-instructions.md (exists, use -Force to overwrite)" -ForegroundColor Yellow
            $skipped++
        } else {
            $template = Get-Content $copilotInstructionsTemplate -Raw
            $content = Invoke-VariableSubstitution -Content $template -ProjectPath $ProjectInfo.Path -ProjectInfo $ProjectInfo

            # Ensure .github directory exists
            $githubDir = Join-Path $ProjectInfo.Path ".github"
            if (-not (Test-Path $githubDir)) {
                New-Item -ItemType Directory -Path $githubDir -Force | Out-Null
            }

            Set-Content -Path $copilotInstructionsTarget -Value $content -Encoding UTF8 -NoNewline
            Write-Host "  [OK] copilot-instructions.md" -ForegroundColor Green
            $created++
        }
    }

    # Install instruction files from instructions/ subdirectory
    $instructionTemplatesDir = Join-Path $templatesDir "instructions"
    if (Test-Path $instructionTemplatesDir) {
        $instructionTemplates = Get-ChildItem -Path $instructionTemplatesDir -Filter "*.instructions.md" -ErrorAction SilentlyContinue

        if ($instructionTemplates.Count -gt 0) {
            if (-not (Test-Path $instructionsDir)) {
                New-Item -ItemType Directory -Path $instructionsDir -Force | Out-Null
                Write-Host "  Created: $instructionsDir" -ForegroundColor Green
            }

            foreach ($instrTemplate in $instructionTemplates) {
                $instrTargetPath = Join-Path $instructionsDir $instrTemplate.Name

                if ((Test-Path $instrTargetPath) -and -not $Force) {
                    Write-Host "  [SKIP] instructions/$($instrTemplate.Name) (exists, use -Force to overwrite)" -ForegroundColor Yellow
                    $skipped++
                    continue
                }

                $template = Get-Content $instrTemplate.FullName -Raw
                $content = Invoke-VariableSubstitution -Content $template -ProjectPath $ProjectInfo.Path -ProjectInfo $ProjectInfo

                Set-Content -Path $instrTargetPath -Value $content -Encoding UTF8 -NoNewline
                Write-Host "  [OK] instructions/$($instrTemplate.Name)" -ForegroundColor Green
                $created++
            }
        }
    }

    # --- Deliver copilot-instructions-generated.md ---
    $generatedInstructions = Join-Path $ScriptRoot "copilot-templates\copilot-instructions-generated.md"

    if (Test-Path $generatedInstructions) {
        $targetGithubDir = Join-Path $ProjectInfo.Path ".github"
        $targetFile = Join-Path $targetGithubDir "copilot-instructions.md"

        if ((Test-Path $targetFile) -and -not $Force) {
            Write-Host "  copilot-instructions.md already exists in $($ProjectInfo.Name) (use -Force to overwrite)" -ForegroundColor Gray
        } else {
            if (-not (Test-Path $targetGithubDir)) {
                New-Item -ItemType Directory -Path $targetGithubDir -Force | Out-Null
            }
            if (Test-Path $targetFile) {
                Copy-Item -Path $targetFile -Destination "${targetFile}.bak" -Force
            }
            Copy-Item -Path $generatedInstructions -Destination $targetFile -Force
            Write-Host "  [OK] Installed copilot-instructions.md in $($ProjectInfo.Name)" -ForegroundColor Green
            $created++
        }
    } else {
        Write-Host "  [WARN] copilot-instructions-generated.md not found -- run adapters/generate-all.sh first to generate it" -ForegroundColor Yellow
        Write-Host "  [WARN] Skipping copilot-instructions.md delivery (other files were still installed)" -ForegroundColor Yellow
    }

    Write-Host "  Summary: $created created, $skipped skipped" -ForegroundColor White
}

# --- Main Execution ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GitHub Copilot Prompts Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AndroidCommonDoc: $AndroidCommonDoc" -ForegroundColor White
Write-Host "Search Path: $TargetPath" -ForegroundColor White

# Set environment variable if requested
if ($SetEnvVar) {
    Set-AndroidCommonDocEnv
}

# --- ANDROID_COMMON_DOC env var guard ---
# Consuming projects use $env:ANDROID_COMMON_DOC at runtime (wrapper templates reference this path).
# Placed after -SetEnvVar processing so users can set the variable first, then the guard validates it.
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

# Verify templates exist
$templatesDir = Join-Path $ScriptRoot "copilot-templates"
if (-not (Test-Path $templatesDir)) {
    Write-Error "Templates directory not found: $templatesDir"
    exit 1
}

$templateCount = (Get-ChildItem -Path $templatesDir -Filter "*.prompt.md" -ErrorAction SilentlyContinue).Count
Write-Host "Prompt templates found: $templateCount" -ForegroundColor White

# Count instruction templates
$instructionTemplatesDir = Join-Path $templatesDir "instructions"
$instructionCount = 0
if (Test-Path $instructionTemplatesDir) {
    $instructionCount = (Get-ChildItem -Path $instructionTemplatesDir -Filter "*.instructions.md" -ErrorAction SilentlyContinue).Count
}
Write-Host "Instruction templates found: $instructionCount" -ForegroundColor White

# Check for copilot-instructions.md template
$hasCopilotInstructions = Test-Path (Join-Path $templatesDir "copilot-instructions.md")
Write-Host "Copilot instructions template: $hasCopilotInstructions" -ForegroundColor White

# Discover or filter projects
if ($Projects.Count -gt 0) {
    # Specific projects
    Write-Host "`nProcessing specified projects: $($Projects -join ', ')" -ForegroundColor Yellow
    $allProjects = @()

    foreach ($name in $Projects) {
        $path = Join-Path $TargetPath $name
        if (Test-Path $path) {
            $info = Get-ProjectType -ProjectPath $path
            $allProjects += @{
                Name = $name
                Path = $path
                Type = $info.Type
                IsKMP = $info.IsKMP
                IsLibrary = $info.IsLibrary
                Platforms = $info.Platforms
            }
        } else {
            Write-Warning "Project not found: $name at $path"
        }
    }
} else {
    # Auto-discover
    Write-Host "`nDiscovering projects..." -ForegroundColor Yellow
    $allProjects = Get-AndroidProjects -SearchPath $TargetPath
}

Write-Host "Found $($allProjects.Count) project(s)" -ForegroundColor White

if ($allProjects.Count -eq 0) {
    Write-Warning "No projects found. Check path or specify projects with -Projects parameter."
    exit 0
}

# Install to each project
foreach ($project in $allProjects) {
    Install-PromptsToProject -ProjectInfo $project -Force:$Force -DryRun:$DryRun
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $DryRun) {
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Ensure env var is set: `$env:ANDROID_COMMON_DOC" -ForegroundColor White
    Write-Host "  2. Restart VS Code / GitHub Copilot in each project" -ForegroundColor White
    Write-Host "  3. Prompt files available in .github/prompts/" -ForegroundColor White
    Write-Host "  4. Instructions loaded from .github/instructions/" -ForegroundColor White
}
