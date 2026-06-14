# emit-push-proof.ps1 -- PowerShell parity for scripts/sh/emit-push-proof.sh
#
# Canonical QG runner + proof emitter (run-qg subcommand).
# Full named-predicate dispatch mirroring the bash implementation.
# Digest computation is byte-identical to the bash: sha256(CRLF->LF normalized bytes).
#
# USAGE
#   emit-push-proof.ps1 -Subcommand run-qg [-Slug <wave-slug>] [-RepoRoot <path>]
#
# EXIT CODES
#   0  success
#   1  usage / argument error
#   2  integrity violation (manifest-drift, deliberation-absent, step-gap, etc.)
#
# Requires: git, python3 on PATH (used for JSON manipulation + digest parity).
# Fail-CLOSED on all integrity checks.
# Fail-OPEN ONLY on push-proof.log write failure.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('run-qg')]
    [string]$Subcommand,

    [string]$Slug = '',
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

# -- Constants ---------------------------------------------------------------
$MAX_AGE_SECS    = 1800
$SKEW_TOLERANCE  = 120

# -- Helpers -----------------------------------------------------------------
function Die([string]$msg, [int]$code = 2) {
    Write-Host "[emit-push-proof] ERROR: $msg" -ForegroundColor Red
    exit $code
}

function Invoke-Python([string]$script, [string[]]$args_list) {
    # Run inline Python via python3. Stderr passes through. Returns stdout string.
    $tmpFile = [System.IO.Path]::GetTempFileName() + '.py'
    try {
        [System.IO.File]::WriteAllText($tmpFile, $script, [System.Text.Encoding]::UTF8)
        $output = & python3 $tmpFile @args_list 2>&1
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        return ($output | Where-Object { $_ -is [string] }) -join "`n"
    }
    finally {
        Remove-Item $tmpFile -ErrorAction SilentlyContinue
    }
}

# -- SHA-256 (CRLF->LF, byte-identical to bash/python hashlib.sha256) -------
function Get-FileSha256([string]$filePath) {
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    # Normalize CRLF -> LF (same as bash: content.replace(b'\r\n', b'\n'))
    $normalized = [System.Collections.Generic.List[byte]]::new($bytes.Length)
    $i = 0
    while ($i -lt $bytes.Length) {
        if ($i -lt $bytes.Length - 1 -and $bytes[$i] -eq 0x0D -and $bytes[$i + 1] -eq 0x0A) {
            $normalized.Add(0x0A)
            $i += 2
        }
        else {
            $normalized.Add($bytes[$i])
            $i++
        }
    }
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash($normalized.ToArray())
    }
    finally {
        $sha256.Dispose()
    }
    return ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

# -- Canonical protocol_digest (mirrors manifest-digest.sh) -----------------
# sha256 of sorted-keys compact JSON of required_steps + conditional_steps, CRLF->LF
function Get-CanonicalDigest([string]$manifestPath) {
    $pyScript = @'
import json, hashlib, sys
manifest_path = sys.argv[1]
with open(manifest_path, 'r', encoding='utf-8') as f:
    manifest = json.load(f)
req  = json.dumps(manifest['required_steps'],   sort_keys=True, separators=(',', ':'))
cond = json.dumps(manifest['conditional_steps'], sort_keys=True, separators=(',', ':'))
combined = (req + cond).encode('utf-8').replace(b'\r\n', b'\n')
print(hashlib.sha256(combined).hexdigest())
'@
    return (Invoke-Python $pyScript @($manifestPath)).Trim()
}

# -- Slug resolution ---------------------------------------------------------
function Resolve-Slug([string]$repoRoot, [string]$slugOverride) {
    if ($slugOverride) { return $slugOverride }
    $envSlug = $env:CLAUDE_WAVE_SLUG
    if ($envSlug) { return $envSlug }
    $branch = $null
    try { $branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null) | Select-Object -First 1 } catch {}
    if (-not $branch) { $branch = '' }
    $slug = $branch -split '/' | Select-Object -Last 1
    if (-not $slug -or $slug -match '^(develop|master|main|HEAD)$') {
        Die "cannot resolve wave slug from branch '$branch'. Use -Slug."
    }
    return $slug
}

# -- Named-predicate evaluation (PLAN.md L38-51, mirrors Python block in .sh) -
function Invoke-Predicate([string]$predicate, [string]$repoRoot, [string[]]$diffFiles) {
    switch ($predicate) {
        'project_type_gradle_or_hybrid' {
            return (Test-Path (Join-Path $repoRoot 'settings.gradle')) -or
                   (Test-Path (Join-Path $repoRoot 'settings.gradle.kts'))
        }
        'project_type_node_or_hybrid' {
            if (Test-Path (Join-Path $repoRoot 'package.json')) { return $true }
            $subdirs = Get-ChildItem $repoRoot -Directory -ErrorAction SilentlyContinue
            foreach ($sub in $subdirs) {
                if (Test-Path (Join-Path $sub.FullName 'package.json')) { return $true }
            }
            return $false
        }
        'kt_files_changed' {
            return ($diffFiles | Where-Object { $_ -match '\.kt$' }).Count -gt 0
        }
        'kt_changed_and_gradle' {
            return (Invoke-Predicate 'kt_files_changed' $repoRoot $diffFiles) -and
                   (Invoke-Predicate 'project_type_gradle_or_hybrid' $repoRoot $diffFiles)
        }
        'task_is_code_changes' {
            $excludePattern = '^(docs/|.*\.md$|.*\.toml$|.*\.properties$|.*\.yml$|.*\.yaml$)'
            return ($diffFiles | Where-Object { $_ -and $_ -notmatch $excludePattern }).Count -gt 0
        }
        'kt_and_docs_api_and_gradle' {
            return (Invoke-Predicate 'kt_files_changed' $repoRoot $diffFiles) -and
                   (Test-Path (Join-Path (Join-Path $repoRoot 'docs') 'api')) -and
                   (Invoke-Predicate 'project_type_gradle_or_hybrid' $repoRoot $diffFiles)
        }
        'compose_ui_files_changed' {
            return ($diffFiles | Where-Object { $_ -match '(ui|compose)/.*\.kt$' }).Count -gt 0
        }
        'runtime_ui_available' {
            # Mechanical check only: baseline dir exists (same as bash).
            return Test-Path (Join-Path (Join-Path $repoRoot '.androidcommondoc') 'ui-baseline')
        }
        default {
            Die "unknown predicate '$predicate'"
        }
    }
}

# -- Subcommand: run-qg ------------------------------------------------------
function Invoke-RunQg {
    # -- Repo root ---------------------------------------------------------------
    if ($RepoRoot) {
        $repoRoot = $RepoRoot
    }
    else {
        $repoRoot = $null
        try { $repoRoot = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1 } catch {}
        if (-not $repoRoot) { $repoRoot = $PWD.Path }
    }

    $acdocDir      = Join-Path $repoRoot '.androidcommondoc'
    $manifestPath  = Join-Path $repoRoot 'quality-gate-manifest.json'
    $reportPath    = Join-Path $acdocDir 'quality-gate-report.json'
    $proofPath     = Join-Path $acdocDir 'push-proof.json'
    $proofLog      = Join-Path $acdocDir 'push-proof.log'
    $qgStampPath   = Join-Path $acdocDir 'quality-gate.stamp'
    $ppStampPath   = Join-Path $acdocDir 'pre-pr.stamp'

    # -- 1. Manifest-drift check -------------------------------------------------
    if (-not (Test-Path $manifestPath)) {
        Die "quality-gate-manifest.json not found at $manifestPath"
    }

    $storedDigest = (& python3 -c "import json,sys; print(json.load(open(sys.argv[1], encoding='utf-8'))['protocol_digest'])" $manifestPath 2>&1)
    if ($LASTEXITCODE -ne 0) { Die "failed to read protocol_digest from manifest" }
    $storedDigest  = ("$storedDigest").Trim()
    $derivedDigest = Get-CanonicalDigest $manifestPath

    if ($storedDigest -ne $derivedDigest) {
        Die ("manifest-drift -- protocol_digest mismatch.`n  Stored:  $storedDigest`n  Derived: $derivedDigest`nRegenerate quality-gate-manifest.json.")
    }

    # -- 2. Slug resolution ------------------------------------------------------
    $waveSlug = Resolve-Slug $repoRoot $Slug

    # -- 3. Load report + named-predicate enforcement + validation ---------------
    if (-not (Test-Path $reportPath)) {
        Die "quality-gate-report.json not found at $reportPath. Run /quality-gate (Steps 0-9) first."
    }

    # Compute head/base for predicate evaluation.
    # Use try/catch for git fallback chain (non-zero exit from native cmd can throw
    # under Stop ErrorActionPreference; suppress and fall through to next candidate).
    $headSha = $null
    try { $headSha = (& git -C $repoRoot rev-parse HEAD 2>$null) | Select-Object -First 1 } catch {}
    if (-not $headSha) { $headSha = 'UNKNOWN' }

    $baseSha = $null
    try { $baseSha = (& git -C $repoRoot merge-base HEAD origin/develop 2>$null) | Select-Object -First 1 } catch {}
    if (-not $baseSha) {
        try { $baseSha = (& git -C $repoRoot merge-base HEAD develop 2>$null) | Select-Object -First 1 } catch {}
    }
    if (-not $baseSha) {
        try { $baseSha = (& git -C $repoRoot rev-parse HEAD~1 2>$null) | Select-Object -First 1 } catch {}
    }
    if (-not $baseSha) { $baseSha = $headSha }

    $diffOutput = $null
    try { $diffOutput = (& git -C $repoRoot diff --name-only "${baseSha}...${headSha}" 2>$null) } catch {}
    [string[]]$diffFiles = if ($diffOutput) {
        $diffOutput | Where-Object { $_ -and $_.Trim() }
    }
    else { @() }

    # Load manifest + report for validation
    $manifestJson = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $reportJson   = Get-Content $reportPath   -Raw | ConvertFrom-Json

    # Deliberation evidence
    $delib = $reportJson.deliberation
    if (-not $delib) {
        Die "deliberation-evidence-absent: 'deliberation' block missing from report"
    }
    $consulted = $delib.architects_consulted
    if (-not $consulted -or @($consulted).Count -eq 0) {
        Die "deliberation-evidence-absent: deliberation.architects_consulted is empty"
    }
    if (-not $delib.incorporated_at) {
        Die "deliberation-evidence-absent: deliberation.incorporated_at is absent"
    }

    # Pre-PR coverage
    if (-not $reportJson.pre_pr_coverage) {
        Die "runtime-report-incomplete: pre_pr_coverage absent from report"
    }

    # Discovered rules
    $discovered = @($reportJson.discovered_rules)
    if (-not $discovered -or $discovered.Count -eq 0) {
        Die "runtime-report-incomplete: discovered_rules absent or empty"
    }
    foreach ($entry in $discovered) {
        if (-not $entry.verified_by) {
            Die "runtime-report-incomplete: discovered_rules entry missing verified_by: $($entry | ConvertTo-Json -Compress)"
        }
    }

    # Step index
    $steps = @{}
    foreach ($s in @($reportJson.steps)) {
        if ($s.step) { $steps[$s.step] = $s }
    }

    # Required steps coverage
    foreach ($rs in @($manifestJson.required_steps)) {
        $sid = $rs.id
        if (-not $steps.ContainsKey($sid)) {
            Die "step-coverage-gap: required step '$sid' absent from report steps[]"
        }
        $entry = $steps[$sid]
        if ($entry.ran -eq $true -and $entry.result -eq 'FAIL') {
            Die "step-failed: required step '$sid' has result=FAIL"
        }
    }

    # Conditional steps: structural coverage + predicate enforcement
    foreach ($cs in @($manifestJson.conditional_steps)) {
        $sid       = $cs.id
        $predicate = $cs.predicate
        if (-not $steps.ContainsKey($sid)) {
            Die "step-coverage-gap: conditional step '$sid' absent from report steps[]"
        }
        $entry  = $steps[$sid]
        $ran    = $entry.ran
        $result = $entry.result
        $reason = if ($entry.reason) { $entry.reason.Trim() } else { '' }

        if ($ran -eq $false -and $result -ne 'SKIP') {
            Die "unjustified-skip: step '$sid' ran=false but result='$result' (not SKIP)"
        }
        if ($result -eq 'SKIP' -and -not $reason) {
            Die "unjustified-skip: step '$sid' result=SKIP but reason is empty/missing"
        }
        if ($ran -eq $true -and $result -eq 'FAIL') {
            Die "step-failed: conditional step '$sid' has result=FAIL"
        }

        # Predicate enforcement (PLAN.md L56-66)
        $predTrue = Invoke-Predicate $predicate $repoRoot $diffFiles
        if ($predTrue -and $result -eq 'SKIP') {
            Die "inconsistent-skip: predicate '$predicate' is TRUE but step '$sid' shows SKIP in report"
        }
        if ($predTrue -and $result -eq 'FAIL') {
            Die "mandatory-step-not-pass: predicate '$predicate' is TRUE but step '$sid' has result=FAIL"
        }
        # pred_true + PASS -> valid; pred_false + SKIP+reason -> valid; pred_false + PASS -> valid
    }

    Write-Host "[emit-push-proof] run-qg: validation PASS" -ForegroundColor Green

    # -- 4. Verify arch verdict files (verdict->HEAD binding) --------------------
    # Mirrors bash step 4: resolves artifact_glob from manifest, globs wave-<slug>/
    # arch-*-verdict.md files, requires APPROVED-VERIFY-FINAL + HEAD == current HEAD.
    # Stale or missing final verdicts -> exit 2 (fail-CLOSED).
    $arbStep = @($manifestJson.required_steps) | Where-Object { $_.id -eq 'architect-deliberation' } | Select-Object -First 1
    if (-not $arbStep) { Die "manifest missing required_step 'architect-deliberation'" }

    $artifactGlob = $arbStep.artifact_glob
    if (-not $artifactGlob) { Die "manifest architect-deliberation step has no artifact_glob" }

    # Narrow glob to this wave's slug
    $waveGlob   = $artifactGlob -replace 'wave-\*', "wave-$waveSlug"
    $globPattern = Join-Path $repoRoot $waveGlob
    # PowerShell glob: resolve the directory + filename pattern separately
    $waveDir     = Split-Path $globPattern -Parent
    $filePattern = Split-Path $globPattern -Leaf
    $verdictFiles = @()
    if (Test-Path $waveDir) {
        $verdictFiles = @(Get-ChildItem $waveDir -Filter $filePattern -File -ErrorAction SilentlyContinue | Sort-Object Name)
    }

    if ($verdictFiles.Count -eq 0) {
        Die "deliberation-evidence-absent: no verdict files matched '$waveGlob' under repo root"
    }

    $statusFinalRe = [regex]'(?m)^\*\*Status\*\*:\s*APPROVED-VERIFY-FINAL\s*$'
    $headLineRe    = [regex]'(?m)^\*\*HEAD\*\*:\s*([0-9a-f]{40})\s*$'

    $finalCount      = 0
    $artifactDigests = [ordered]@{}

    foreach ($vf in $verdictFiles) {
        $raw = [System.IO.File]::ReadAllText($vf.FullName, [System.Text.Encoding]::UTF8)

        # Skip PREP-only files silently (same as bash)
        if (-not $statusFinalRe.IsMatch($raw)) { continue }

        $finalCount++
        $verdictName = $vf.BaseName  # e.g. arch-platform-verdict

        # HEAD binding check
        $headMatch = $headLineRe.Match($raw)
        if (-not $headMatch.Success) {
            Die "stale-verdict: $verdictName has APPROVED-VERIFY-FINAL but no **HEAD** line"
        }
        $verdictHead = $headMatch.Groups[1].Value
        if ($verdictHead -ne $headSha) {
            Die "stale-verdict: $verdictName HEAD ($verdictHead) != current HEAD ($headSha). Re-run verify-final after the final commit."
        }

        # sha256 of verdict file (CRLF->LF, same canonical precedent)
        $artifactDigests[$verdictName] = Get-FileSha256 $vf.FullName
    }

    if ($finalCount -eq 0) {
        Die "deliberation-evidence-absent: verdict files exist but none have APPROVED-VERIFY-FINAL status. Architects must run verify-final before pushing."
    }

    Write-Host "[emit-push-proof] run-qg: verdict binding PASS ($finalCount VERIFY-FINAL verdicts, all HEAD-bound)" -ForegroundColor Green

    # -- 5. Compute report_digest (sha256, CRLF->LF, byte-identical to bash) ----
    $reportDigest = Get-FileSha256 $reportPath

    # -- 6. Collect steps_executed (required steps) ------------------------------
    $stepsExecuted = [System.Collections.Generic.List[object]]::new()
    foreach ($rs in @($manifestJson.required_steps)) {
        $sid   = $rs.id
        $entry = $steps[$sid]
        $stepsExecuted.Add([PSCustomObject]@{
            step   = $sid
            result = if ($entry) { $entry.result } else { '' }
            ran    = [bool]($entry -and $entry.ran)
        })
    }

    # -- 7. Timestamps + identifiers ---------------------------------------------
    $nowTs           = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $worktreeId = $null
    try { $worktreeId = (& git -C $repoRoot rev-parse --show-toplevel 2>$null) | Select-Object -First 1 } catch {}
    if (-not $worktreeId) { $worktreeId = 'UNKNOWN' }
    $manifestVersion = [int]$manifestJson.manifest_version
    $branchName = $null
    try { $branchName = (& git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null) | Select-Object -First 1 } catch {}
    if (-not $branchName) { $branchName = 'UNKNOWN' }

    # -- 8. Write backward-compat stamps -----------------------------------------
    New-Item -ItemType Directory -Force -Path $acdocDir | Out-Null

    $stampContent = '{"verdict":"PASS","timestamp":"' + $nowTs + '","head":"' + $headSha + '","branch":"' + $branchName + '","source":"emit-push-proof.ps1 run-qg"}' + "`n"
    [System.IO.File]::WriteAllText($qgStampPath, $stampContent, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($ppStampPath, $stampContent, [System.Text.Encoding]::UTF8)

    # -- 9. Write push-proof.json (includes artifact_digests from step 4) --------
    $proof = [ordered]@{
        schema_version   = 1
        head             = $headSha
        worktree_id      = $worktreeId
        generated_at     = $nowTs
        wave_slug        = $waveSlug
        manifest_version = $manifestVersion
        steps_executed   = @($stepsExecuted)
        report_digest    = $reportDigest
        artifact_digests = $artifactDigests
    }

    $proofJson = $proof | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($proofPath, $proofJson + "`n", [System.Text.Encoding]::UTF8)

    # -- 10. Append to push-proof.log (fail-OPEN) --------------------------------
    try {
        $logLine = '{"ts":"' + $nowTs + '","event":"push-proof-emitted","head":"' + $headSha + '","wave_slug":"' + $waveSlug + '","report_digest":"' + $reportDigest + '","worktree_id":"' + $worktreeId + '"}' + "`n"
        [System.IO.File]::AppendAllText($proofLog, $logLine, [System.Text.Encoding]::UTF8)
    }
    catch {
        # Fail-OPEN: log write failure must not block a valid push
    }

    Write-Host "[emit-push-proof] run-qg: PASS -- proof minted at $proofPath; stamps written." -ForegroundColor Green
    exit 0
}

# -- Dispatch ----------------------------------------------------------------
switch ($Subcommand) {
    'run-qg' { Invoke-RunQg }
}
