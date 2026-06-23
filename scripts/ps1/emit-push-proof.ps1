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

# BOM-free UTF-8 encoder: [System.Text.Encoding]::UTF8 emits a BOM, breaking
# cross-platform digest parity and JSON parsers. Use this for all file writes.
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# -- Helpers -----------------------------------------------------------------
function Die([string]$msg, [int]$code = 2) {
    Write-Host "[emit-push-proof] ERROR: $msg" -ForegroundColor Red
    exit $code
}

function Invoke-Python([string]$script, [string[]]$args_list) {
    # Run inline Python via python3. Stderr passes through. Returns stdout string.
    $tmpFile = [System.IO.Path]::GetTempFileName() + '.py'
    try {
        [System.IO.File]::WriteAllText($tmpFile, $script, $utf8NoBom)
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

    # Required-role enforcement (P1): architects_consulted must cover all required_roles.
    $arbStep = @($manifestJson.required_steps) | Where-Object { $_.id -eq 'architect-deliberation' } | Select-Object -First 1
    $requiredRoles = if ($arbStep -and $arbStep.required_roles) { @($arbStep.required_roles) } else { @() }
    $consultedSet  = @($consulted) | ForEach-Object { $_.Trim() }
    foreach ($role in $requiredRoles) {
        if ($role -notin $consultedSet) {
            Die "deliberation-role-incomplete: required role '$role' absent from report.deliberation.architects_consulted ($($consultedSet -join ', '))"
        }
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

    # Required steps coverage: must be ran=true AND result=PASS. SKIP/not-ran/absent all fail.
    foreach ($rs in @($manifestJson.required_steps)) {
        $sid = $rs.id
        if (-not $steps.ContainsKey($sid)) {
            Die "step-coverage-gap: required step '$sid' absent from report steps[]"
        }
        $entry = $steps[$sid]
        if ($entry.result -ne 'PASS' -or -not $entry.ran) {
            Die "step-not-pass: required step '$sid' must be ran=true + result=PASS, got ran=$($entry.ran) result=$($entry.result)"
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
        $predTrue   = Invoke-Predicate $predicate $repoRoot $diffFiles
        $envAttest  = [bool]$cs.env_attested
        if ($predTrue -and $result -eq 'SKIP') {
            # env_attested steps: predicate-true + SKIP + non-empty reason is allowed --
            # the runtime env check is delegated to the quality-gater's attested reason.
            if (-not ($envAttest -and $reason)) {
                Die "inconsistent-skip: predicate '$predicate' is TRUE but step '$sid' shows SKIP in report"
            }
        }
        if ($predTrue -and $result -eq 'FAIL') {
            Die "mandatory-step-not-pass: predicate '$predicate' is TRUE but step '$sid' has result=FAIL"
        }
        # pred_true + PASS -> valid; pred_false + SKIP+reason -> valid; pred_false + PASS -> valid
        # env_attest + pred_true + SKIP+reason -> valid (runtime env delegated to attested reason)
    }

    Write-Host "[emit-push-proof] run-qg: validation PASS" -ForegroundColor Green

    # -- 3b. Verify arch verdict files (verdict->HEAD binding) -------------------
    # Mirrors bash step 3b: reads arch-*-verdict.md directly from .planning/wave-<slug>/.
    # Every matched file must carry APPROVED-VERIFY-FINAL and **HEAD**: == final HEAD.
    # No silent PREP-only skip: any matched file missing VERIFY-FINAL is a hard error.
    $waveDir = Join-Path (Join-Path $repoRoot '.planning') "wave-$waveSlug"
    if (-not (Test-Path $waveDir -PathType Container)) {
        Die "verdict-head-binding: wave dir not found: $waveDir"
    }

    $verdictFiles = @(Get-ChildItem $waveDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^arch-.*-verdict\.md$' } | Sort-Object Name)
    if ($verdictFiles.Count -eq 0) {
        Die "verdict-head-binding: no arch-*-verdict.md files found in $waveDir"
    }

    $headLineRe    = [regex]'(?m)^\*\*HEAD\*\*:\s*([0-9a-f]{40})'
    $artifactDigests = [ordered]@{}

    foreach ($vf in $verdictFiles) {
        $content = [System.IO.File]::ReadAllText($vf.FullName, $utf8NoBom)
        $fname   = $vf.Name

        # Must contain APPROVED-VERIFY-FINAL (no silent PREP-only skip)
        if ($content -notmatch 'APPROVED-VERIFY-FINAL') {
            Die "verdict-head-binding: $fname does not contain APPROVED-VERIFY-FINAL -- re-run VERIFY-FINAL at final HEAD"
        }
        # Must contain **HEAD**: <sha> matching final HEAD
        $headMatch = $headLineRe.Match($content)
        if (-not $headMatch.Success) {
            Die "verdict-head-binding: $fname missing **HEAD**: field -- re-run write-verdict.sh --phase verify-final at final HEAD"
        }
        $verdictHead = $headMatch.Groups[1].Value
        if ($verdictHead -ne $headSha) {
            Die "verdict-head-binding: $fname HEAD ($verdictHead) != final HEAD ($headSha) -- stale verdict, re-run VERIFY-FINAL"
        }
        # Digest the file (CRLF->LF)
        $artifactDigests[$fname] = Get-FileSha256 $vf.FullName
    }

    # Per-role verdict-file check (P1): each required_role must have a VERIFY-FINAL+HEAD-bound verdict.
    $verifiedFnames = [System.Collections.Generic.HashSet[string]]::new($artifactDigests.Keys)
    foreach ($role in $requiredRoles) {
        # required_roles carry the 'arch-' prefix (e.g. "arch-platform").
        # write-verdict.sh strips it via ${ROLE#arch-} -> file is "arch-platform-verdict.md".
        # Strip here too so "arch-$short-verdict.md" matches what write-verdict.sh produces.
        $short = if ($role.StartsWith('arch-')) { $role.Substring(5) } else { $role }
        $expectedFile = "arch-$short-verdict.md"
        if (-not $verifiedFnames.Contains($expectedFile)) {
            Die "deliberation-role-incomplete: required verdict file '$expectedFile' missing or not VERIFY-FINAL+HEAD-bound in $waveDir"
        }
    }

    Write-Host "[emit-push-proof] run-qg: verdict binding PASS ($($verdictFiles.Count) verdicts, all HEAD-bound)" -ForegroundColor Green

    # -- 4. Committed-tree integrity (Part 1: clean-tree + Part 2: registry) ----
    # Mirrors bash step 4: runs AFTER verdict->HEAD binding, BEFORE report_digest.

    # (A) Clean-tree assertion: git status --porcelain must be empty except
    #     paths matching ^\.claude/wave-quality-gates/ (QG sentinel files).
    $gitStatusOutput = $null
    try { $gitStatusOutput = (& git -C $repoRoot status --porcelain 2>$null) } catch {}
    $dirtyFail = $false
    foreach ($line in @($gitStatusOutput)) {
        if (-not $line -or $line.Trim() -eq '') { continue }
        # XY + space + path; extract path (3 chars prefix: XY + space)
        $path = if ($line.Length -gt 3) { $line.Substring(3) } else { $line.Trim() }
        if ($path -notmatch '^\.claude/wave-quality-gates/') {
            Write-Host "[emit-push-proof] DIRTY: $line" -ForegroundColor Yellow
            $dirtyFail = $true
        }
    }
    if ($dirtyFail) {
        Die "tracked artifact drift detected; commit regenerated artifact, re-seal verdicts, rerun QG."
    }

    # (B) Registry integrity: call shared script (same logic as CI skill-registry job).
    #     Pass --require-registry when the repo has a skills/ directory.
    $scriptsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'sh'
    $integrityScript = Join-Path $scriptsDir 'qg-registry-integrity.sh'
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($bash) {
        $riArgs = @('--project-root', $repoRoot)
        if (Test-Path (Join-Path $repoRoot 'skills') -PathType Container) {
            $riArgs += '--require-registry'
        }
        & $bash.Source $integrityScript @riArgs
        if ($LASTEXITCODE -ne 0) {
            Die "derived artifact drift detected; commit regenerated artifact, re-seal verdicts, rerun QG."
        }
    }
    elseif (Test-Path (Join-Path $repoRoot 'skills') -PathType Container) {
        Die "bash not found; cannot run registry integrity check against skills/ -- install bash or run from WSL/Git Bash."
    }

    # (D) Template size gate: block mint if any agent template exceeds its cap.
    #     Guard: only when setup/agent-templates/ exists (mirrors registry Test-Path skills guard).
    #     Repos/fixtures without the dir have no templates to size-check -- N/A, not a bypass.
    #     CWD-independent: pass explicit dirs matching repoRoot (mirrors --project-root pattern).
    #     Inline exit-code gate -- NOT a required_steps[] entry.
    $templatesDir = Join-Path $repoRoot 'setup' 'agent-templates'
    if (Test-Path $templatesDir -PathType Container) {
        $sizeScript = Join-Path $scriptsDir 'validate-agent-templates.sh'
        if ($bash) {
            & $bash.Source $sizeScript '--check' 'size-limits' `
                '--templates-dir' $templatesDir `
                '--agents-dir' (Join-Path $repoRoot '.claude' 'agents')
            if ($LASTEXITCODE -ne 0) {
                Die "agent template size cap exceeded; trim template, rerun QG."
            }
        }
        else {
            Die "bash not found; cannot run template size check against setup/agent-templates/ -- install bash or run from WSL/Git Bash."
        }
    }

    # (C) Record registry digest into artifact_digests (additive; schema_version stays 1).
    #     sha256(skills/registry.json, CRLF->LF). Merged before proof-write.
    $registryPath = Join-Path $repoRoot 'skills' 'registry.json'
    if (Test-Path $registryPath) {
        $regDigest = Get-FileSha256 $registryPath
        $artifactDigests['skills/registry.json'] = $regDigest
    }

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
    [System.IO.File]::WriteAllText($qgStampPath, $stampContent, $utf8NoBom)
    [System.IO.File]::WriteAllText($ppStampPath, $stampContent, $utf8NoBom)

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
    [System.IO.File]::WriteAllText($proofPath, $proofJson + "`n", $utf8NoBom)

    # -- 10. Append to push-proof.log (fail-OPEN) --------------------------------
    try {
        $logLine = '{"ts":"' + $nowTs + '","event":"push-proof-emitted","head":"' + $headSha + '","wave_slug":"' + $waveSlug + '","report_digest":"' + $reportDigest + '","worktree_id":"' + $worktreeId + '"}' + "`n"
        [System.IO.File]::AppendAllText($proofLog, $logLine, $utf8NoBom)
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
