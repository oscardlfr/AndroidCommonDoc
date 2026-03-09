#Requires -Version 5.1
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    Validate DB migration sequences and flag destructive operations.

.DESCRIPTION
    Auto-detects Room or SQLDelight, validates migration version sequences,
    and flags destructive operations (DROP TABLE, DROP COLUMN).

.PARAMETER ProjectRoot
    Path to the project root.

.PARAMETER DbType
    Database type: room, sqldelight, or auto (default: auto).

.PARAMETER Help
    Show usage information.

.EXAMPLE
    ./migration-check.ps1 -ProjectRoot "C:\Projects\MyApp"
#>

param(
    [Parameter(Position = 0)]
    [string]$ProjectRoot = "",

    [ValidateSet("room", "sqldelight", "auto")]
    [string]$DbType = "auto",

    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: migration-check.ps1 <project_root> [-DbType room|sqldelight|auto]"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Error '{"error":"project_root is required"}'
    exit 1
}

# --- Auto-detect DB type ---
if ($DbType -eq "auto") {
    $sqmFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "*.sq" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' }

    if ($sqmFiles -and @($sqmFiles).Count -gt 0) {
        $DbType = "sqldelight"
    }
    else {
        $gradleFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "*.kts", "*.gradle" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' }
        $foundRoom = $false
        if ($gradleFiles) {
            foreach ($gf in $gradleFiles) {
                $content = Get-Content $gf.FullName -Raw -ErrorAction SilentlyContinue
                if ($content -match 'androidx\.room') { $foundRoom = $true; break }
            }
        }
        if ($foundRoom) { $DbType = "room" }
        else {
            Write-Output '{"db_type":"none","migrations":[],"gaps":[],"destructive":[]}'
            exit 0
        }
    }
}

$migrations = @()
$destructive = @()
$versions = @()

if ($DbType -eq "room") {
    # Room: look for Migration(X, Y) patterns in .kt files
    $ktFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' }

    if ($ktFiles) {
        foreach ($f in $ktFiles) {
            $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
            $migMatches = [regex]::Matches($content, 'Migration\s*\(\s*(\d+)\s*,\s*(\d+)')
            foreach ($m in $migMatches) {
                $from = [int]$m.Groups[1].Value
                $to = [int]$m.Groups[2].Value
                $relFile = $f.FullName.Replace($ProjectRoot, "").TrimStart('\', '/') -replace '\\', '/'
                $migrations += @{ from = $from; to = $to; file = $relFile }
                $versions += $from
                $versions += $to
            }

            # Check for destructive ops
            $dropMatches = [regex]::Matches($content, '(?i)DROP\s+(TABLE|COLUMN)\s+(\w+)')
            foreach ($dm in $dropMatches) {
                $relFile = $f.FullName.Replace($ProjectRoot, "").TrimStart('\', '/') -replace '\\', '/'
                $destructive += @{ file = $relFile; operation = $dm.Value }
            }
        }
    }
}
elseif ($DbType -eq "sqldelight") {
    # SQLDelight: .sqm migration files
    $sqmFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Include "*.sqm" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/]build[\\/]' } |
        Sort-Object Name

    if ($sqmFiles) {
        foreach ($f in $sqmFiles) {
            $verMatch = [regex]::Match($f.Name, '(\d+)')
            if ($verMatch.Success) {
                $version = [int]$verMatch.Groups[1].Value
                $relFile = $f.FullName.Replace($ProjectRoot, "").TrimStart('\', '/') -replace '\\', '/'
                $migrations += @{ version = $version; file = $relFile }
                $versions += $version

                $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
                $dropMatches = [regex]::Matches($content, '(?i)DROP\s+(TABLE|COLUMN)\s+(\w+)')
                foreach ($dm in $dropMatches) {
                    $destructive += @{ file = $relFile; operation = $dm.Value }
                }
            }
        }
    }
}

# --- Check for gaps ---
$gaps = @()
if ($versions.Count -gt 0) {
    $sortedVersions = $versions | Sort-Object -Unique
    for ($i = 1; $i -lt $sortedVersions.Count; $i++) {
        $prev = $sortedVersions[$i - 1]
        $curr = $sortedVersions[$i]
        $expected = $prev + 1
        if ($curr -ne $expected) {
            $gaps += @{ expected = $expected; found = $curr }
        }
    }
}

# --- Output ---
if ($DbType -eq "room") {
    $migJson = ($migrations | ForEach-Object {
        "{`"from`":$($_.from),`"to`":$($_.to),`"file`":`"$($_.file)`"}"
    }) -join ','
}
else {
    $migJson = ($migrations | ForEach-Object {
        "{`"version`":$($_.version),`"file`":`"$($_.file)`"}"
    }) -join ','
}

$gapsJson = ($gaps | ForEach-Object {
    "{`"expected`":$($_.expected),`"found`":$($_.found)}"
}) -join ','

$destJson = ($destructive | ForEach-Object {
    $op = $_.operation -replace '"', '\"'
    "{`"file`":`"$($_.file)`",`"operation`":`"$op`"}"
}) -join ','

Write-Output "{`"db_type`":`"$DbType`",`"migrations`":[$migJson],`"gaps`":[$gapsJson],`"destructive`":[$destJson]}"
exit 0
