#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Build module dependency graph from Gradle project() deps.

.DESCRIPTION
    Parses settings.gradle.kts and build.gradle.kts files to build an
    adjacency list from project() dependencies. Detects cycles and leaf modules.

.PARAMETER ProjectRoot
    Path to the Gradle project root.

.PARAMETER Output
    Output mode: adjacency (JSON, default) or mermaid.

.PARAMETER DetectCycles
    Enable cycle detection in the dependency graph.

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./module-deps-graph.ps1 -ProjectRoot "C:\Projects\MyApp" -DetectCycles
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [ValidateSet("adjacency", "mermaid")]
    [string]$Output = "adjacency",

    [switch]$DetectCycles,

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: module-deps-graph.ps1 <project_root> [-Output adjacency|mermaid] [-DetectCycles]"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
    exit 1
}

$settingsFile = Join-Path $ProjectRoot "settings.gradle.kts"
if (-not (Test-Path $settingsFile)) {
    $settingsFile = Join-Path $ProjectRoot "settings.gradle"
}

# --- Discover modules ---
$settingsContent = Get-Content $settingsFile -Raw
$discoveredModules = [regex]::Matches($settingsContent, 'include\s*\(\s*"([^"]+)"') |
    ForEach-Object { $_.Groups[1].Value }

$adjacency = @{}
foreach ($mod in $discoveredModules) {
    $adjacency[$mod] = @()
}

# --- Parse dependencies ---
foreach ($mod in $discoveredModules) {
    $modPath = ($mod -replace ':', '/').TrimStart('/')
    $buildFile = Join-Path $ProjectRoot $modPath "build.gradle.kts"

    if (-not (Test-Path $buildFile)) { continue }

    $buildContent = Get-Content $buildFile -Raw
    $deps = [regex]::Matches($buildContent, 'project\s*\(\s*"([^"]+)"') |
        ForEach-Object { $_.Groups[1].Value }

    if ($deps) {
        $adjacency[$mod] = @($deps)
    }
}

# --- Leaf modules (no outgoing deps) ---
$leafModules = @()
foreach ($mod in $discoveredModules) {
    if ($adjacency[$mod].Count -eq 0) {
        $leafModules += $mod
    }
}

# --- Cycle detection ---
$cycles = @()
if ($DetectCycles) {
    $visited = @{}
    $recStack = @{}

    function Find-Cycles {
        param([string]$Node, [System.Collections.ArrayList]$Path)

        $visited[$Node] = $true
        $recStack[$Node] = $true
        [void]$Path.Add($Node)

        foreach ($neighbor in $adjacency[$Node]) {
            if ($recStack.ContainsKey($neighbor) -and $recStack[$neighbor]) {
                $idx = $Path.IndexOf($neighbor)
                if ($idx -ge 0) {
                    $cycle = @($Path[$idx..($Path.Count - 1)]) + @($neighbor)
                    $script:cycles += ,@($cycle)
                }
            }
            elseif (-not $visited.ContainsKey($neighbor) -or -not $visited[$neighbor]) {
                Find-Cycles -Node $neighbor -Path $Path
            }
        }

        $Path.RemoveAt($Path.Count - 1)
        $recStack[$Node] = $false
    }

    foreach ($mod in $discoveredModules) {
        if (-not $visited.ContainsKey($mod) -or -not $visited[$mod]) {
            $path = [System.Collections.ArrayList]::new()
            Find-Cycles -Node $mod -Path $path
        }
    }
}

# --- Output ---
if ($Output -eq "mermaid") {
    Write-Output "graph TD"
    foreach ($mod in $discoveredModules) {
        $safeId = ($mod -replace ':', '_').TrimStart('_')
        foreach ($dep in $adjacency[$mod]) {
            $safeDep = ($dep -replace ':', '_').TrimStart('_')
            Write-Output "    ${safeId}[`"$mod`"] --> ${safeDep}[`"$dep`"]"
        }
    }
}
else {
    # Build adjacency JSON
    $adjParts = @()
    foreach ($mod in $discoveredModules) {
        $depsJson = ($adjacency[$mod] | ForEach-Object { "`"$_`"" }) -join ','
        $adjParts += "`"$mod`":[$depsJson]"
    }
    $adjJson = "{$($adjParts -join ',')}"

    # Build cycles JSON
    $cyclesJson = "[]"
    if ($cycles.Count -gt 0) {
        $cycleStrs = $cycles | ForEach-Object {
            $inner = ($_ | ForEach-Object { "`"$_`"" }) -join ','
            "[$inner]"
        }
        $cyclesJson = "[$($cycleStrs -join ',')]"
    }

    # Build leaves JSON
    $leavesJson = ($leafModules | ForEach-Object { "`"$_`"" }) -join ','

    Write-Output "{`"adjacency`":$adjJson,`"cycles`":$cyclesJson,`"leaf_modules`":[$leavesJson]}"
}

exit 0
