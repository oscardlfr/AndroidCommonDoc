#!/usr/bin/env powershell
<#
.SYNOPSIS
    Deterministic code pattern checks for KMP projects.

.DESCRIPTION
    Checks patterns that agents currently waste model tokens on.
    All checks are pure Select-String/Get-ChildItem -- no AI reasoning needed.

    Checks:
      cancellation-rethrow   CancellationException not rethrown in catch blocks
      mutable-shared-flow    MutableSharedFlow in non-test production code
      forbidden-jvm-imports  java.time.*, java.text.*, java.security.* in commonMain
      println-in-prod        println()/System.err.println() in production code
      todo-crash             TODO("Not yet implemented") crash points
      system-time            System.currentTimeMillis() in commonMain
      run-blocking           runBlocking outside test code
      global-scope           GlobalScope usage

.PARAMETER ProjectRoot
    Path to the project root. Defaults to current directory.

.PARAMETER ShowDetails
    Show detailed output including matched lines.

.PARAMETER Check
    Comma-separated list of checks to run. Empty runs all.

.PARAMETER Fix
    Attempt auto-fixes where possible (reserved for future use).

.EXAMPLE
    ./pattern-lint.ps1

.EXAMPLE
    ./pattern-lint.ps1 -ProjectRoot "../MyProject" -ShowDetails

.EXAMPLE
    ./pattern-lint.ps1 -Check "cancellation-rethrow,mutable-shared-flow"
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = (Get-Location).Path,

    [switch]$ShowDetails,

    [Parameter(Mandatory = $false)]
    [string]$Check = "",

    [switch]$Fix
)

$ErrorActionPreference = "Stop"

$Errors = 0
$Warnings = 0
$TotalChecks = 0

# --- Helpers ---

function Should-Run {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Check)) { return $true }
    return ",$Check," -match ",$Name,"
}

function Get-ProdKtFiles {
    <#
    .SYNOPSIS
        Returns production .kt files (excludes test dirs, build dirs, test/fake files).
    #>
    param([string]$BasePath)
    Get-ChildItem -Path $BasePath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '[\\/](test|androidTest|commonTest)[\\/]' -and
            $_.FullName -notmatch '[\\/]build[\\/]' -and
            $_.Name -notmatch '(Test|Fake|Mock)\.kt$'
        }
}

function Get-CommonMainKtFiles {
    <#
    .SYNOPSIS
        Returns .kt files in commonMain source sets.
    #>
    param([string]$BasePath)
    Get-ChildItem -Path $BasePath -Recurse -Include "*.kt" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -match '[\\/]commonMain[\\/]' -and
            $_.FullName -notmatch '[\\/]build[\\/]'
        }
}

function Scan-Prod {
    <#
    .SYNOPSIS
        Search production code for a pattern, return matching lines.
    #>
    param(
        [string]$BasePath,
        [string]$Pattern
    )
    $files = Get-ProdKtFiles -BasePath $BasePath
    if (-not $files -or $files.Count -eq 0) { return @() }
    $results = $files | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue
    if (-not $results) { return @() }
    return @($results)
}

function Report-Check {
    param(
        [string]$Name,
        [int]$Count,
        [string]$Severity  # ERROR or WARNING
    )
    $script:TotalChecks++
    if ($Count -eq 0) {
        Write-Host "  [OK] $Name" -ForegroundColor Green
    }
    elseif ($Severity -eq "ERROR") {
        Write-Host "  [FAIL] $Name -- $Count issues" -ForegroundColor Red
        $script:Errors += $Count
    }
    else {
        Write-Host "  [WARN] $Name -- $Count issues" -ForegroundColor Yellow
        $script:Warnings += $Count
    }
}

function Show-Details {
    param(
        [object[]]$Results,
        [int]$MaxLines = 10
    )
    if (-not $ShowDetails) { return }
    if (-not $Results -or $Results.Count -eq 0) { return }
    $Results | Select-Object -First $MaxLines | ForEach-Object {
        $rel = $_.Path
        try { $rel = $_.Path.Replace($ProjectRoot, "").TrimStart('\', '/') } catch {}
        Write-Host "    ${rel}:$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor DarkGray
    }
}

# --- Header ---

Write-Host "Pattern Lint -- $(Split-Path $ProjectRoot -Leaf)" -ForegroundColor Cyan
Write-Host ""

# --- Check 1: CancellationException not rethrown ---
if (Should-Run "cancellation-rethrow") {
    $ceResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'catch\s*\([^)]*:\s*(Exception|Throwable)\)'
    $ceCount = $ceResults.Count
    Report-Check -Name "cancellation-rethrow" -Count $ceCount -Severity "ERROR"
    Show-Details -Results $ceResults
}

# --- Check 2: MutableSharedFlow in production code ---
if (Should-Run "mutable-shared-flow") {
    $msfResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'MutableSharedFlow'
    $msfCount = $msfResults.Count
    Report-Check -Name "mutable-shared-flow" -Count $msfCount -Severity "WARNING"
    Show-Details -Results $msfResults
}

# --- Check 3: Forbidden JVM imports in commonMain ---
if (Should-Run "forbidden-jvm-imports") {
    $jvmCount = 0
    $jvmAllResults = @()
    $commonFiles = Get-CommonMainKtFiles -BasePath $ProjectRoot
    if ($commonFiles -and $commonFiles.Count -gt 0) {
        foreach ($pattern in @('import java\.time', 'import java\.text', 'import java\.security')) {
            $hits = $commonFiles | Select-String -Pattern $pattern -ErrorAction SilentlyContinue
            if ($hits) {
                $jvmCount += @($hits).Count
                $jvmAllResults += @($hits)
            }
        }
    }
    Report-Check -Name "forbidden-jvm-imports" -Count $jvmCount -Severity "ERROR"
    Show-Details -Results $jvmAllResults -MaxLines 15
}

# --- Check 4: println in production code ---
if (Should-Run "println-in-prod") {
    $printlnResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'println\('
    $syserrResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'System\.err\.println'
    $sysoutResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'System\.out\.print'
    $totalPrint = $printlnResults.Count + $syserrResults.Count + $sysoutResults.Count
    $allPrintResults = @() + $printlnResults + $syserrResults + $sysoutResults
    Report-Check -Name "println-in-prod" -Count $totalPrint -Severity "WARNING"
    Show-Details -Results $allPrintResults
}

# --- Check 5: TODO("Not yet implemented") crash points ---
if (Should-Run "todo-crash") {
    $todoResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'TODO\("Not yet implemented"\)'
    $todoCount = $todoResults.Count
    Report-Check -Name "todo-crash" -Count $todoCount -Severity "ERROR"
    Show-Details -Results $todoResults
}

# --- Check 6: System.currentTimeMillis() in commonMain ---
if (Should-Run "system-time") {
    $timeCount = 0
    $timeResults = @()
    $commonFiles2 = Get-CommonMainKtFiles -BasePath $ProjectRoot
    if ($commonFiles2 -and $commonFiles2.Count -gt 0) {
        $hits = $commonFiles2 | Select-String -Pattern 'System\.currentTimeMillis' -ErrorAction SilentlyContinue
        if ($hits) {
            $timeCount = @($hits).Count
            $timeResults = @($hits)
        }
    }
    Report-Check -Name "system-time" -Count $timeCount -Severity "ERROR"
    Show-Details -Results $timeResults
}

# --- Check 7: runBlocking outside test code ---
if (Should-Run "run-blocking") {
    $rbResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'runBlocking'
    $rbCount = $rbResults.Count
    Report-Check -Name "run-blocking" -Count $rbCount -Severity "WARNING"
    Show-Details -Results $rbResults
}

# --- Check 8: GlobalScope usage ---
if (Should-Run "global-scope") {
    $gsResults = Scan-Prod -BasePath $ProjectRoot -Pattern 'GlobalScope'
    $gsCount = $gsResults.Count
    Report-Check -Name "global-scope" -Count $gsCount -Severity "WARNING"
    Show-Details -Results $gsResults
}

# --- Summary ---

Write-Host ""
$Total = $Errors + $Warnings

if ($Total -eq 0) {
    Write-Host "PASS -- all $TotalChecks checks clean" -ForegroundColor Green
    $Result = "pass"
}
elseif ($Errors -gt 0) {
    Write-Host "FAIL -- $Errors errors, $Warnings warnings across $TotalChecks checks" -ForegroundColor Red
    $Result = "fail"
}
else {
    Write-Host "WARN -- $Warnings warnings across $TotalChecks checks" -ForegroundColor Yellow
    $Result = "warn"
}

# --- Append to audit log ---
$auditDir = Join-Path $ProjectRoot ".androidcommondoc"
$logFile = Join-Path $auditDir "audit-log.jsonl"

if (-not (Test-Path $auditDir)) {
    New-Item -ItemType Directory -Path $auditDir -Force -ErrorAction SilentlyContinue | Out-Null
}

$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$branch = ""
try { $branch = (git -C $ProjectRoot rev-parse --abbrev-ref HEAD 2>$null) } catch {}
$commit = ""
try { $commit = (git -C $ProjectRoot rev-parse --short HEAD 2>$null) } catch {}
$projectName = Split-Path $ProjectRoot -Leaf

$layer = ""
$manifestPath = Join-Path $ProjectRoot "l0-manifest.json"
if (Test-Path $manifestPath) {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $layer = $manifest.layer
    } catch {}
}

$auditLine = '{"ts":"' + $ts + '","event":"pattern_lint","result":"' + $Result + '","project":"' + $projectName + '","layer":"' + $layer + '","branch":"' + $branch + '","commit":"' + $commit + '","errors":' + $Errors + ',"warnings":' + $Warnings + ',"checks":' + $TotalChecks + '}'
Add-Content -Path $logFile -Value $auditLine -Encoding UTF8

# --- Exit code ---
if ($Errors -gt 0) {
    exit 1
}
exit 0
