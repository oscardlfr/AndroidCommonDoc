#Requires -Version 5.1
<#
.SYNOPSIS
    Verify parity between skills/ and setup/copilot-templates/.

.DESCRIPTION
    Checks:
      1. Every skill with copilot: true has a .prompt.md template
      2. No orphaned templates for skills with copilot: false or missing skills
      3. No templates with empty implementation blocks
      4. Skills have the copilot frontmatter field

.PARAMETER ProjectRoot
    Project root directory (default: auto-detect from script location)

.PARAMETER Fix
    Auto-fix by running copilot-adapter.sh --clean

.PARAMETER Verbose
    Show OK entries too

.EXAMPLE
    .\copilot-parity.ps1
    .\copilot-parity.ps1 -ProjectRoot C:\MyProject -Verbose
#>
param(
    [string]$ProjectRoot = "",
    [switch]$Fix,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = if ($env:ANDROID_COMMON_DOC) {
        $env:ANDROID_COMMON_DOC
    } else {
        (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
    }
}

$SkillsDir = Join-Path $ProjectRoot "skills"
$TemplatesDir = Join-Path $ProjectRoot "setup/copilot-templates"

$Missing = @()
$Orphaned = @()
$Empty = @()
$NoField = @()
$OkCount = 0

function Get-FrontmatterField {
    param([string]$FilePath, [string]$Field)
    $lines = Get-Content $FilePath -Encoding UTF8
    $inFm = $false
    foreach ($line in $lines) {
        if ($line -eq "---") {
            if (-not $inFm) { $inFm = $true; continue }
            else { return $null }
        }
        if ($inFm -and $line -match "^${Field}:\s*`"?(.+?)`"?\s*$") {
            return $Matches[1]
        }
    }
    return $null
}

Write-Host "Copilot Template Parity Check"
Write-Host "  Skills:    $SkillsDir"
Write-Host "  Templates: $TemplatesDir"
Write-Host ""

# --- Check 1: FRONTMATTER ---
Write-Host "FRONTMATTER:"
foreach ($skillDir in Get-ChildItem -Path $SkillsDir -Directory) {
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    if (-not (Test-Path $skillFile)) { continue }
    $name = $skillDir.Name

    $copilotVal = Get-FrontmatterField -FilePath $skillFile -Field "copilot"
    if (-not $copilotVal) {
        $NoField += $name
        Write-Host "  [MISSING] $name -- no 'copilot:' field in SKILL.md frontmatter"
    } elseif ($Verbose) {
        Write-Host "  [OK]      $name -- copilot: $copilotVal"
    }
}
Write-Host ""

# --- Check 2: COVERAGE ---
Write-Host "COVERAGE:"
foreach ($skillDir in Get-ChildItem -Path $SkillsDir -Directory) {
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    if (-not (Test-Path $skillFile)) { continue }

    $copilotVal = Get-FrontmatterField -FilePath $skillFile -Field "copilot"
    if ($copilotVal -ne "true") { continue }

    $name = Get-FrontmatterField -FilePath $skillFile -Field "name"
    if (-not $name) { $name = $skillDir.Name }

    $templateFile = Join-Path $TemplatesDir "$name.prompt.md"
    if (-not (Test-Path $templateFile)) {
        $Missing += $name
        Write-Host "  [MISSING] $name -- copilot: true but no template at $name.prompt.md"
    } else {
        $OkCount++
        if ($Verbose) { Write-Host "  [OK]      $name -- template exists" }
    }
}
Write-Host ""

# --- Check 3: ORPHAN ---
Write-Host "ORPHANED:"
$orphanFound = $false
$templates = Get-ChildItem -Path $TemplatesDir -Filter "*.prompt.md" -ErrorAction SilentlyContinue
foreach ($template in $templates) {
    $tname = $template.BaseName -replace '\.prompt$', ''

    $skillFound = $false
    $copilotVal = $null
    foreach ($skillDir in Get-ChildItem -Path $SkillsDir -Directory) {
        $skillFile = Join-Path $skillDir.FullName "SKILL.md"
        if (-not (Test-Path $skillFile)) { continue }
        $sname = Get-FrontmatterField -FilePath $skillFile -Field "name"
        if (-not $sname) { $sname = $skillDir.Name }
        if ($sname -eq $tname) {
            $skillFound = $true
            $copilotVal = Get-FrontmatterField -FilePath $skillFile -Field "copilot"
            break
        }
    }

    if (-not $skillFound) {
        $Orphaned += $tname
        Write-Host "  [ORPHAN]  $tname.prompt.md -- no matching skill found"
        $orphanFound = $true
    } elseif ($copilotVal -ne "true") {
        $Orphaned += $tname
        Write-Host "  [ORPHAN]  $tname.prompt.md -- skill has copilot: $copilotVal"
        $orphanFound = $true
    } elseif ($Verbose) {
        Write-Host "  [OK]      $tname.prompt.md"
    }
}
if (-not $orphanFound) {
    Write-Host "  [OK]      No orphaned templates"
}
Write-Host ""

# --- Check 4: EMPTY ---
Write-Host "EMPTY:"
$emptyFound = $false
foreach ($template in $templates) {
    $tname = $template.BaseName -replace '\.prompt$', ''
    $content = Get-Content $template.FullName -Raw -Encoding UTF8

    if ($content -match "## Instructions") {
        # Behavioral: check instructions have content
        $instructionsSection = ($content -split "## Instructions", 2)[1]
        if (-not $instructionsSection -or $instructionsSection.Trim().Length -eq 0) {
            $Empty += $tname
            Write-Host "  [EMPTY]   $tname.prompt.md -- instructions section is empty"
            $emptyFound = $true
        } elseif ($Verbose) {
            Write-Host "  [OK]      $tname.prompt.md -- has instruction content"
        }
    } elseif ($content -match "## Implementation") {
        # Scripted: check code blocks have content
        $hasContent = $content -match '```(?:bash|powershell)\r?\n(.+?)\r?\n```' -and $Matches[1].Trim().Length -gt 0
        if (-not $hasContent) {
            $Empty += $tname
            Write-Host "  [EMPTY]   $tname.prompt.md -- implementation code blocks are empty"
            $emptyFound = $true
        } elseif ($Verbose) {
            Write-Host "  [OK]      $tname.prompt.md -- has implementation content"
        }
    } else {
        $Empty += $tname
        Write-Host "  [EMPTY]   $tname.prompt.md -- no Implementation or Instructions section"
        $emptyFound = $true
    }
}
if (-not $emptyFound) {
    Write-Host "  [OK]      No empty templates"
}
Write-Host ""

# --- Summary ---
$TotalIssues = $Missing.Count + $Orphaned.Count + $Empty.Count + $NoField.Count

if ($TotalIssues -eq 0) {
    Write-Host "RESULT: PASS -- $OkCount skills with copilot: true, all templates valid"
    Write-Host "{`"status`":`"pass`",`"ok`":$OkCount,`"missing`":0,`"orphaned`":0,`"empty`":0,`"no_field`":0}"
    exit 0
}

Write-Host "RESULT: FAIL -- $TotalIssues issues found"
Write-Host "  Missing templates: $($Missing.Count)"
Write-Host "  Orphaned templates: $($Orphaned.Count)"
Write-Host "  Empty templates: $($Empty.Count)"
Write-Host "  Missing copilot field: $($NoField.Count)"

if ($Fix) {
    Write-Host ""
    Write-Host "Auto-fixing with copilot-adapter.sh --clean..."
    bash (Join-Path $ProjectRoot "adapters/copilot-adapter.sh") --clean
    Write-Host "Fix applied. Run this check again to verify."
}

Write-Host "{`"status`":`"fail`",`"ok`":$OkCount,`"missing`":$($Missing.Count),`"orphaned`":$($Orphaned.Count),`"empty`":$($Empty.Count),`"no_field`":$($NoField.Count)}"
exit 1
