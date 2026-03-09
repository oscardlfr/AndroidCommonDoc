#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Sync skills from marketplace and L0 to ~/.gsd/agent/skills/.

.DESCRIPTION
    Discovers skills from marketplace (~/.claude/skills/), L0 toolkit
    ($ANDROID_COMMON_DOC/skills/), and L0 agents. Computes SHA-256 hashes,
    compares against sync manifest, and copies new/changed files.

.PARAMETER DryRun
    Compute changes but do not copy files.

.PARAMETER Source
    Source filter: marketplace, l0, or all (default: all).

.PARAMETER Verbose
    List each file in details output.

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./sync-gsd-skills.ps1 -DryRun -Verbose

.EXAMPLE
    ./sync-gsd-skills.ps1 -Source l0
#>

param(
    [switch]$DryRun,

    [ValidateSet("marketplace", "l0", "all")]
    [string]$Source = "all",

    [switch]$Verbose,

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: sync-gsd-skills.ps1 [-DryRun] [-Source marketplace|l0|all] [-Verbose]"
    exit 0
}

# --- Resolve paths ---
$toolkitRoot = $env:ANDROID_COMMON_DOC
if ([string]::IsNullOrWhiteSpace($toolkitRoot)) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $toolkitRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
}

$gsdSkillsDir = Join-Path $env:USERPROFILE ".gsd" "agent" "skills"
$manifestFile = Join-Path $gsdSkillsDir ".sync-manifest.json"

$newCount = 0
$updatedCount = 0
$unchangedCount = 0
$details = @()

# --- Load existing manifest ---
$manifestHashes = @{}
if (Test-Path $manifestFile) {
    try {
        $manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
        foreach ($entry in $manifest.entries) {
            $manifestHashes[$entry.key] = $entry.sha256
        }
    }
    catch {}
}

# --- SHA-256 helper ---
function Get-FileSha256 {
    param([string]$FilePath)
    $hash = Get-FileHash -Path $FilePath -Algorithm SHA256
    return $hash.Hash.ToLower()
}

# --- Process a skill file ---
$manifestEntries = @()

function Process-SkillFile {
    param(
        [string]$FilePath,
        [string]$Category,
        [string]$Name
    )

    if (-not (Test-Path $FilePath)) { return }

    $key = "$Category/$Name"
    $hash = Get-FileSha256 -FilePath $FilePath
    $oldHash = $null
    if ($manifestHashes.ContainsKey($key)) {
        $oldHash = $manifestHashes[$key]
    }

    if ($hash -eq $oldHash) {
        $script:unchangedCount++
        if ($Verbose) {
            $script:details += @{ action = "unchanged"; name = $Name; source = $Category; sha256 = $hash }
        }
    }
    elseif ($null -eq $oldHash) {
        $script:newCount++
        $script:details += @{ action = "new"; name = $Name; source = $Category; sha256 = $hash }
    }
    else {
        $script:updatedCount++
        $script:details += @{ action = "updated"; name = $Name; source = $Category; sha256 = $hash }
    }

    # Copy file if not dry-run
    if (-not $DryRun) {
        $destDir = Join-Path $gsdSkillsDir $Category $Name
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -Path $FilePath -Destination (Join-Path $destDir "SKILL.md") -Force
    }

    $script:manifestEntries += @{ key = $key; sha256 = $hash; source = $FilePath }
}

# --- 1. Marketplace skills ---
if ($Source -eq "all" -or $Source -eq "marketplace") {
    $marketplacePath = Join-Path $env:USERPROFILE ".claude" "skills"
    if (Test-Path $marketplacePath) {
        $skillDirs = Get-ChildItem -Path $marketplacePath -Directory -ErrorAction SilentlyContinue
        foreach ($dir in $skillDirs) {
            $skillFile = Join-Path $dir.FullName "SKILL.md"
            if (Test-Path $skillFile) {
                Process-SkillFile -FilePath $skillFile -Category "marketplace" -Name $dir.Name
            }
        }
    }
}

# --- 2. L0 skills ---
if ($Source -eq "all" -or $Source -eq "l0") {
    $l0SkillsPath = Join-Path $toolkitRoot "skills"
    if (Test-Path $l0SkillsPath) {
        $skillDirs = Get-ChildItem -Path $l0SkillsPath -Directory -ErrorAction SilentlyContinue
        foreach ($dir in $skillDirs) {
            $skillFile = Join-Path $dir.FullName "SKILL.md"
            if (Test-Path $skillFile) {
                Process-SkillFile -FilePath $skillFile -Category "l0" -Name $dir.Name
            }
        }
    }

    # 3. L0 agents
    $agentsPath = Join-Path $toolkitRoot ".claude" "agents"
    if (Test-Path $agentsPath) {
        $agentFiles = Get-ChildItem -Path $agentsPath -Filter "*.md" -ErrorAction SilentlyContinue
        foreach ($af in $agentFiles) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($af.Name)
            Process-SkillFile -FilePath $af.FullName -Category "l0-agents" -Name $name
        }
    }
}

# --- Write manifest ---
if (-not $DryRun) {
    if (-not (Test-Path $gsdSkillsDir)) {
        New-Item -ItemType Directory -Path $gsdSkillsDir -Force | Out-Null
    }

    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $entriesJson = ($manifestEntries | ForEach-Object {
        $src = $_.source -replace '\\', '/' -replace '"', '\"'
        "{`"key`":`"$($_.key)`",`"sha256`":`"$($_.sha256)`",`"source`":`"$src`"}"
    }) -join ','

    $manifestJson = "{`"synced_at`":`"$ts`",`"entries`":[$entriesJson]}"
    Set-Content -Path $manifestFile -Value $manifestJson -Encoding UTF8
}

# --- Output ---
$detailsJson = ($details | ForEach-Object {
    "{`"action`":`"$($_.action)`",`"name`":`"$($_.name)`",`"source`":`"$($_.source)`",`"sha256`":`"$($_.sha256)`"}"
}) -join ','

Write-Output "{`"new`":$newCount,`"updated`":$updatedCount,`"unchanged`":$unchangedCount,`"details`":[$detailsJson]}"
exit 0
