#Requires -Version 7
<#
.SYNOPSIS
    Transform Dokka Markdown output into docs/api/ with YAML frontmatter.
.DESCRIPTION
    Creates hub docs per module and sub-docs per class/interface.
    Optional — exits gracefully if Dokka hasn't run.
.PARAMETER ProjectRoot
    Absolute path to the project root.
.PARAMETER InputDir
    Dokka output directory (default: build/dokka).
.PARAMETER OutputDir
    Output directory (default: docs/api).
.PARAMETER DryRun
    Show what would be generated without writing.
#>
param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [string]$InputDir,
    [string]$OutputDir,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not $InputDir) { $InputDir = Join-Path $ProjectRoot 'build/dokka' }
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot 'docs/api' }

if (-not (Test-Path $InputDir)) {
    Write-Host "i Dokka output not found at $InputDir"
    Write-Host "  Run './gradlew dokkaGenerate' first, or skip if Dokka is not configured."
    Write-Host "  This is optional - the doc integrity system works without Dokka."
    exit 0
}

$GeneratedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$ModulesProcessed = 0
$DocsGenerated = 0
$HubsGenerated = 0

function ConvertTo-Kebab($name) {
    ($name -creplace '([A-Z])', '-$1').ToLower().TrimStart('-') -replace '[^a-z0-9-]', '-' -replace '-+', '-' -replace '-$', ''
}

function Write-Frontmatter($slug, $module, $description, $isHub = $false) {
    $lastUpdated = (Get-Date).ToUniversalTime().ToString('yyyy-MM')
    $parent = if ($isHub) { 'api-hub' } else { "$module-api-hub" }
    @"
---
scope: [api, $module]
sources: [$module]
targets: [all]
slug: $slug
status: active
layer: L1
category: api
description: "$description"
version: 1
last_updated: "$lastUpdated"
generated: true
generated_from: dokka
generated_at: "$GeneratedAt"
parent: $parent
---

"@
}

Write-Host '## Dokka -> docs/api/ transformer'
Write-Host ''

foreach ($moduleDir in Get-ChildItem -Path $InputDir -Directory) {
    $moduleName = $moduleDir.Name
    $moduleSlug = ConvertTo-Kebab $moduleName
    $moduleOutput = Join-Path $OutputDir $moduleSlug

    Write-Host "Processing module: $moduleName"

    $mdFiles = Get-ChildItem -Path $moduleDir.FullName -Filter '*.md' -Recurse -File -ErrorAction SilentlyContinue
    if (-not $mdFiles -or $mdFiles.Count -eq 0) {
        Write-Host '  skip No markdown files'
        continue
    }

    if ($DryRun) {
        Write-Host "  [dry-run] Would create: $moduleOutput/"
        Write-Host "  [dry-run] Hub: ${moduleSlug}-hub.md"
        Write-Host "  [dry-run] Sub-docs: $($mdFiles.Count) files"
        $ModulesProcessed++
        $DocsGenerated += $mdFiles.Count + 1
        $HubsGenerated++
        continue
    }

    New-Item -ItemType Directory -Path $moduleOutput -Force | Out-Null

    # Hub doc
    $hubFile = Join-Path $OutputDir "${moduleSlug}-hub.md"
    $hubContent = Write-Frontmatter "${moduleSlug}-api-hub" $moduleName "API documentation hub for $moduleName module" $true
    $hubContent += "# $moduleName API`n`n"
    $hubContent += "Auto-generated from KDoc via Dokka. Do not edit manually.`n`n"
    $hubContent += "## Sub-documents`n`n"
    $hubContent += "| Class/Interface | Description |`n"
    $hubContent += "|----------------|-------------|`n"
    $HubsGenerated++

    foreach ($mdFile in $mdFiles) {
        $filename = [System.IO.Path]::GetFileNameWithoutExtension($mdFile.Name)
        $slug = ConvertTo-Kebab $filename
        $rawContent = Get-Content -Path $mdFile.FullName -Raw -ErrorAction SilentlyContinue
        if (-not $rawContent) { continue }

        $firstHeading = ($rawContent -split "`n" | Where-Object { $_ -match '^#' } | Select-Object -First 1) -replace '^#+\s*', ''
        if (-not $firstHeading) { $firstHeading = $filename }

        # Strip existing frontmatter
        $content = $rawContent -replace '(?s)^---.*?---\r?\n?', ''
        $lines = ($content -split "`n")
        if ($lines.Count -gt 280) {
            $content = ($lines | Select-Object -First 280) -join "`n"
            $content += "`n`n> Truncated at 280 lines. See source code for full documentation."
        }

        $subFile = Join-Path $moduleOutput "${slug}.md"
        $subContent = Write-Frontmatter "${moduleSlug}-${slug}" $moduleName $firstHeading
        $subContent += $content
        Set-Content -Path $subFile -Value $subContent -Encoding UTF8

        $hubContent += "| [$firstHeading](${moduleSlug}/${slug}.md) | $firstHeading |`n"
        $DocsGenerated++
    }

    Set-Content -Path $hubFile -Value $hubContent -Encoding UTF8
    $ModulesProcessed++
    Write-Host "  ok $moduleName`: hub + $($mdFiles.Count) sub-docs"
}

Write-Host ''
Write-Host '## Summary'
Write-Host "- Modules processed: $ModulesProcessed"
Write-Host "- Docs generated: $DocsGenerated ($HubsGenerated hubs + $($DocsGenerated - $HubsGenerated) sub-docs)"
Write-Host "- Output: $OutputDir"
if ($DryRun) { Write-Host '- Mode: DRY RUN (no files written)' }
