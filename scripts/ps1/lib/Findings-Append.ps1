<#
.SYNOPSIS
    Append structured findings to findings-log.jsonl

.DESCRIPTION
    Parallel to findings-append.sh. Appends AuditFinding entries
    to .androidcommondoc/findings-log.jsonl with metadata (timestamp,
    run ID, git branch/commit).

.EXAMPLE
    . "$PSScriptRoot\lib\Findings-Append.ps1"
    Add-Finding -ProjectRoot $root -RunId $id -FindingJson '{"severity":"HIGH","category":"code-quality","check":"cancellation-exception-swallowed","title":"CancellationException swallowed","file":"core/data/src/commonMain/kotlin/SomeRepo.kt","line":42}'
#>

function Add-Finding {
    <#
    .SYNOPSIS
        Append a single AuditFinding entry to findings-log.jsonl.
    .PARAMETER ProjectRoot
        Absolute path to the project root.
    .PARAMETER RunId
        Unique identifier for this audit run.
    .PARAMETER FindingJson
        Pre-formatted AuditFinding JSON object (no surrounding envelope).
    #>
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$RunId,
        [Parameter(Mandatory)][string]$FindingJson
    )

    $auditDir = Join-Path $ProjectRoot ".androidcommondoc"
    $logFile  = Join-Path $auditDir "findings-log.jsonl"

    if (-not (Test-Path $auditDir)) {
        New-Item -ItemType Directory -Path $auditDir -Force -ErrorAction SilentlyContinue | Out-Null
        if (-not (Test-Path $auditDir)) { return }
    }

    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $branch = ""
    try { $branch = (git -C $ProjectRoot rev-parse --abbrev-ref HEAD 2>$null) } catch {}

    $commit = ""
    try { $commit = (git -C $ProjectRoot rev-parse --short HEAD 2>$null) } catch {}

    $line = '{"ts":"' + $ts + '","run_id":"' + $RunId + '","commit":"' + $commit + '","branch":"' + $branch + '","finding":' + $FindingJson + '}'
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Add-FindingBulk {
    <#
    .SYNOPSIS
        Append multiple AuditFinding entries to findings-log.jsonl.
        Accepts pipeline input -- one JSON string per line.
    .PARAMETER ProjectRoot
        Absolute path to the project root.
    .PARAMETER RunId
        Unique identifier for this audit run.
    .PARAMETER FindingJsonLines
        One or more pre-formatted AuditFinding JSON strings.
    #>
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$RunId,
        [Parameter(Mandatory, ValueFromPipeline)][string[]]$FindingJsonLines
    )

    begin {
        $auditDir = Join-Path $ProjectRoot ".androidcommondoc"
        $logFile  = Join-Path $auditDir "findings-log.jsonl"

        if (-not (Test-Path $auditDir)) {
            New-Item -ItemType Directory -Path $auditDir -Force -ErrorAction SilentlyContinue | Out-Null
            if (-not (Test-Path $auditDir)) { return }
        }

        $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

        $branch = ""
        try { $branch = (git -C $ProjectRoot rev-parse --abbrev-ref HEAD 2>$null) } catch {}

        $commit = ""
        try { $commit = (git -C $ProjectRoot rev-parse --short HEAD 2>$null) } catch {}
    }

    process {
        foreach ($findingJson in $FindingJsonLines) {
            if ([string]::IsNullOrWhiteSpace($findingJson)) { continue }
            $line = '{"ts":"' + $ts + '","run_id":"' + $RunId + '","commit":"' + $commit + '","branch":"' + $branch + '","finding":' + $findingJson + '}'
            Add-Content -Path $logFile -Value $line -Encoding UTF8
        }
    }
}
