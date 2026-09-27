# Windows-native contract test for scripts/ps1/verify-push-proof.ps1.
#
# This test deliberately uses only PowerShell, .NET, and Git. It builds a real
# temporary repository and real proof artifacts, then executes the verifier in
# a child PowerShell process so its documented exit codes can be asserted.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Verifier = Join-Path (Split-Path -Parent $PSScriptRoot) 'ps1/verify-push-proof.ps1'
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$Repo = Join-Path $TempRoot ("androidcommondoc-verify-push-proof-{0}" -f [guid]::NewGuid().ToString('N'))
$Marker = Join-Path $Repo '.androidcommondoc-windows-test-fixture'
$Pwsh = (Get-Process -Id $PID).Path
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:Passed = 0

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Context
    )
    if ($Actual -ne $Expected) {
        throw "$Context`: expected '$Expected', got '$Actual'"
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory = $true)][string]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Context
    )
    if (-not $Actual.Contains($Expected, [System.StringComparison]::Ordinal)) {
        throw "$Context`: expected output to contain '$Expected'; output was:`n$Actual"
    }
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $output = & git @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed ($LASTEXITCODE): $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
}

function Get-NormalizedSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $normalized = [System.Collections.Generic.List[byte]]::new($bytes.Length)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        if ($i -lt ($bytes.Length - 1) -and $bytes[$i] -eq 0x0D -and $bytes[$i + 1] -eq 0x0A) {
            $normalized.Add(0x0A)
            $i++
        }
        else {
            $normalized.Add($bytes[$i])
        }
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (($sha.ComputeHash($normalized.ToArray()) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Write-Fixture {
    param([scriptblock]$Mutate)

    $manifest = [pscustomobject]@{
        manifest_version = 1
        required_steps = @(
            [pscustomobject]@{
                id = 'test-suite'
                evidence = [pscustomobject]@{
                    min_local_runs = 1
                    remote_merge_check = 'CI Gate'
                }
            }
        )
    }
    $report = [pscustomobject]@{
        schema_version = 1
        status = 'pass'
    }
    $proof = [pscustomobject]@{
        schema_version = 1
        head = $script:Head
        worktree_id = $script:WorktreeId
        generated_at = [System.DateTimeOffset]::UtcNow.ToString('o')
        manifest_version = 1
        steps_executed = @(
            [pscustomobject]@{
                step = 'test-suite'
                ran = $true
                result = 'PASS'
            }
        )
        report_digest = ''
        bats_evidence = [pscustomobject]@{
            head = $script:Head
            not_ok = 0
            scope = 'full'
            complete = $true
            total = 1
            expected = 1
            ok = 1
            agreement_count = 1
            run_ids = 'local-run-1'
            log_identities = [string]::new('a', 64)
        }
    }

    if ($Mutate) {
        & $Mutate $manifest $proof
    }

    $manifestPath = Join-Path $Repo 'quality-gate-manifest.json'
    $reportPath = Join-Path $Repo '.androidcommondoc/quality-gate-report.json'
    $proofPath = Join-Path $Repo '.androidcommondoc/push-proof.json'
    Write-Utf8Json -Path $manifestPath -Value $manifest
    Write-Utf8Json -Path $reportPath -Value $report
    $proof.report_digest = Get-NormalizedSha256 -Path $reportPath
    Write-Utf8Json -Path $proofPath -Value $proof
}

function Invoke-Verifier {
    $output = & $Pwsh -NoLogo -NoProfile -NonInteractive -File $Verifier `
        -PushedSha $script:Head -RepoRoot $Repo 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output | Out-String)
    }
}

function Test-Positive {
    Write-Fixture
    $result = Invoke-Verifier
    Assert-Equal -Actual $result.ExitCode -Expected 0 -Context 'valid proof exit code'
    Assert-Contains -Actual $result.Output -Expected 'verify-proof: PASS' -Context 'valid proof verdict'
    $script:Passed++
}

function Test-Negative {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Mutate,
        [Parameter(Mandatory = $true)][string]$Reason
    )
    Write-Fixture -Mutate $Mutate
    $result = Invoke-Verifier
    Assert-Equal -Actual $result.ExitCode -Expected 2 -Context "$Name exit code"
    Assert-Contains -Actual $result.Output -Expected $Reason -Context "$Name reason"
    $script:Passed++
}

try {
    if (-not (Test-Path -LiteralPath $Verifier -PathType Leaf)) {
        throw "Verifier not found: $Verifier"
    }
    [System.IO.Directory]::CreateDirectory($Repo) | Out-Null
    [System.IO.File]::WriteAllText($Marker, 'owned by verify-push-proof-windows.ps1', $Utf8NoBom)
    Invoke-Git -Arguments @('-C', $Repo, 'init', '--quiet') | Out-Null
    Invoke-Git -Arguments @('-C', $Repo, 'config', 'user.email', 'windows-test@example.invalid') | Out-Null
    Invoke-Git -Arguments @('-C', $Repo, 'config', 'user.name', 'Windows Contract Test') | Out-Null
    Invoke-Git -Arguments @('-C', $Repo, 'commit', '--allow-empty', '--quiet', '-m', 'test: initialize fixture') | Out-Null
    [System.IO.Directory]::CreateDirectory((Join-Path $Repo '.androidcommondoc')) | Out-Null
    $script:Head = (Invoke-Git -Arguments @('-C', $Repo, 'rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $script:WorktreeId = (Invoke-Git -Arguments @('-C', $Repo, 'rev-parse', '--show-toplevel') | Select-Object -First 1).Trim()

    Test-Positive
    Test-Negative -Name 'min_local_runs drift' -Reason 'manifest-evidence-drift' -Mutate {
        param($manifest, $proof)
        $manifest.required_steps[0].evidence.min_local_runs = 2
    }
    Test-Negative -Name 'remote_merge_check drift' -Reason 'manifest-evidence-drift' -Mutate {
        param($manifest, $proof)
        $manifest.required_steps[0].evidence.remote_merge_check = 'Legacy Double Local Run'
    }
    Test-Negative -Name 'zero local agreement' -Reason 'bats-evidence-agreement' -Mutate {
        param($manifest, $proof)
        $proof.bats_evidence.agreement_count = 0
    }
    Test-Negative -Name 'missing run_ids' -Reason 'bats-evidence-reused' -Mutate {
        param($manifest, $proof)
        $proof.bats_evidence.PSObject.Properties.Remove('run_ids')
    }
    Test-Negative -Name 'missing log_identities' -Reason 'bats-evidence-reused' -Mutate {
        param($manifest, $proof)
        $proof.bats_evidence.PSObject.Properties.Remove('log_identities')
    }
    Test-Negative -Name 'duplicate run_ids' -Reason 'bats-evidence-reused' -Mutate {
        param($manifest, $proof)
        $proof.bats_evidence.agreement_count = 2
        $proof.bats_evidence.run_ids = 'local-run-1,local-run-1'
        $proof.bats_evidence.log_identities = "{0},{1}" -f ([string]::new('a', 64)), ([string]::new('b', 64))
    }
    Test-Negative -Name 'duplicate log_identities' -Reason 'bats-evidence-reused' -Mutate {
        param($manifest, $proof)
        $proof.bats_evidence.agreement_count = 2
        $proof.bats_evidence.run_ids = 'local-run-1,local-run-2'
        $duplicate = [string]::new('c', 64)
        $proof.bats_evidence.log_identities = "$duplicate,$duplicate"
    }

    Write-Host "verify-push-proof Windows contract: PASS ($script:Passed cases)"
}
finally {
    $resolvedRepo = [System.IO.Path]::GetFullPath($Repo)
    if ((Test-Path -LiteralPath $Marker -PathType Leaf) -and
        $resolvedRepo.StartsWith($TempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        $resolvedRepo -ne $TempRoot) {
        Remove-Item -LiteralPath $resolvedRepo -Recurse -Force
    }
}
