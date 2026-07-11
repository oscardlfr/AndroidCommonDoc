# verify-push-proof.ps1 -- PowerShell parity for emit-push-proof.sh verify-proof subcommand.
#
# Cheap verifier for push-proof.json. Checks schema_version, head, worktree_id,
# generated_at freshness, manifest_version, steps_executed coverage, report_digest,
# bats_evidence binding (present, .head == pushed_sha -- Wave A Section A5b -- and,
# as of wave qg-artifact-binding's W7, the same completeness predicate run-qg
# persists: not_ok==0, scope=='full', complete==true, total==expected, ok>0).
#
# NOTE: despite an earlier version of this comment, this script is NOT installed
# as a git-layer pre-push hook on Windows -- install-git-hooks.ps1 installs no
# pre-push hook at all. The only installed git-layer pre-push hook, on any OS, is
# the bash pre-push-hook.sh via scripts/sh/install-git-hooks.sh. This script is a
# standalone/CI-adjacent verifier today; pwsh is confirmed absent from this
# project's macOS dev box, so it is exercised by static assertion only (see
# scripts/tests/emit-push-proof-template-size.bats's #EP-PS1-VERIFY).
#
# USAGE
#   verify-push-proof.ps1 -PushedSha <sha> [-RepoRoot <path>]
#
# EXIT CODES
#   0  PASS -- proof is valid and current
#   1  usage / argument error
#   2  integrity violation (stale, tampered, head mismatch, etc.)
#
# Mirrors the verify_proof() function in scripts/sh/emit-push-proof.sh (T3).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PushedSha,

    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

# -- Constants ---------------------------------------------------------------
$MAX_AGE_SECS   = 1800
$SKEW_TOLERANCE = 120

# -- Helpers -----------------------------------------------------------------
function Die([string]$msg, [int]$code = 2) {
    Write-Host "[emit-push-proof] ERROR: $msg" -ForegroundColor Red
    exit $code
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

# -- Main --------------------------------------------------------------------
if (-not $PushedSha) { Die "--pushed-sha / -PushedSha is required" 1 }

# Repo root
if ($RepoRoot) {
    $repoRoot = $RepoRoot
}
else {
    $repoRoot = $null
    try { $repoRoot = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1 } catch {}
    if (-not $repoRoot) { $repoRoot = $PWD.Path }
}

$acdocDir     = Join-Path $repoRoot '.androidcommondoc'
$manifestPath = Join-Path $repoRoot 'quality-gate-manifest.json'
$reportPath   = Join-Path $acdocDir 'quality-gate-report.json'
$proofPath    = Join-Path $acdocDir 'push-proof.json'

# -- 1. File existence checks ------------------------------------------------
if (-not (Test-Path $proofPath)) {
    Die "push-proof.json not found at $proofPath. Run /quality-gate first."
}
if (-not (Test-Path $manifestPath)) {
    Die "quality-gate-manifest.json not found at $manifestPath"
}
if (-not (Test-Path $reportPath)) {
    Die "quality-gate-report.json not found at $reportPath"
}

# -- 2. Load proof -----------------------------------------------------------
try {
    $proofJson = Get-Content $proofPath -Raw
    $proof = $proofJson | ConvertFrom-Json
}
catch {
    Die "push-proof.json unreadable/malformed: $_"
}

# -- 3. Schema version -------------------------------------------------------
if ($proof.schema_version -ne 1) {
    Die "push-proof.json schema_version unknown: $($proof.schema_version)"
}

# -- 4. head == pushed_sha ---------------------------------------------------
if ($proof.head -ne $PushedSha) {
    Die "proof head ($($proof.head)) != pushed SHA ($PushedSha)"
}

# -- 5. worktree_id ----------------------------------------------------------
$worktreeId = $null
try { $worktreeId = (& git -C $repoRoot rev-parse --show-toplevel 2>$null) | Select-Object -First 1 } catch {}
if (-not $worktreeId) { $worktreeId = 'UNKNOWN' }
if ($proof.worktree_id -ne $worktreeId) {
    Die "proof worktree_id ($($proof.worktree_id)) != current worktree ($worktreeId)"
}

# -- 6. Freshness (<=1800s, >=-120s skew) ------------------------------------
$ts = $proof.generated_at
if (-not $ts) { Die "push-proof.json generated_at is absent" }

try {
    $epoch = [System.DateTimeOffset]::Parse($ts).ToUnixTimeSeconds()
}
catch {
    Die "push-proof.json generated_at unparseable: '$ts'"
}

$now = [System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$age = $now - $epoch
if ($age -lt -$SKEW_TOLERANCE) {
    Die "push-proof.json has future timestamp (skew=$(-$age)s, max allowed=${SKEW_TOLERANCE}s)"
}
if ($age -gt $MAX_AGE_SECS) {
    Die "push-proof.json stale ($([int]($age / 60)) min old, max $([int]($MAX_AGE_SECS / 60)) min)"
}

# -- 7. manifest_version match -----------------------------------------------
try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
}
catch {
    Die "quality-gate-manifest.json unreadable/malformed: $_"
}
if ($proof.manifest_version -ne $manifest.manifest_version) {
    Die "manifest_version mismatch: proof=$($proof.manifest_version) manifest=$($manifest.manifest_version)"
}

# -- 8. steps_executed covers all required_steps with PASS ------------------
$executed = @{}
foreach ($s in @($proof.steps_executed)) {
    if ($s.step) { $executed[$s.step] = $s }
}
foreach ($rs in @($manifest.required_steps)) {
    $sid = $rs.id
    if (-not $executed.ContainsKey($sid)) {
        Die "step-coverage-gap: required step '$sid' absent from proof steps_executed"
    }
    if ($executed[$sid].result -ne 'PASS') {
        Die "step-coverage-gap: required step '$sid' not PASS in proof (result=$($executed[$sid].result))"
    }
}

# -- 9. report_digest: recompute sha256(report, CRLF->LF) -------------------
$recomputed = Get-FileSha256 $reportPath
if ($recomputed -ne $proof.report_digest) {
    Die "report_digest mismatch: stored=$($proof.report_digest) recomputed=$recomputed; quality-gate-report.json may have been tampered with post-mint"
}

# -- 10. bats_evidence binding: present + head matches pushed_sha -----------
# Mirrors the bash verify_proof's 9th check (its own comment-numbering counts "Load
# proof" as step 1) and push-authorization-gate.js's in-JS fallback -- all three
# verifiers now carry equivalent rigor. A half-done evidence binding would mint
# correctly but verify permissively; this closes that gap.
if (-not $proof.bats_evidence) {
    Die "bats_evidence missing from push-proof.json -- proof was minted before this wave's evidence binding, or evidence was stripped. Re-run /quality-gate."
}
if ($proof.bats_evidence.head -ne $PushedSha) {
    Die "bats_evidence.head ($($proof.bats_evidence.head)) != pushed SHA ($PushedSha) -- proof's test-suite evidence does not correspond to the pushed commit"
}

# -- 11-15. bats_evidence completeness (wave qg-artifact-binding, W7) --------
# The SAME predicate bash verify_proof() and push-authorization-gate.js's in-JS
# fallback re-derive: not_ok==0 && scope=='full' && complete==true &&
# total==expected && ok>0. A half-done completeness binding would mint correctly
# but verify permissively for these five fields too, same rationale as -- 10.
if ($proof.bats_evidence.not_ok -ne 0) {
    Die "bats-evidence-dirty: bats_evidence.not_ok ($($proof.bats_evidence.not_ok)) != 0"
}
if ($proof.bats_evidence.scope -ne 'full') {
    Die "bats-evidence-scope: bats_evidence.scope ($($proof.bats_evidence.scope)) != 'full'"
}
if ($proof.bats_evidence.complete -ne $true) {
    Die "bats-evidence-incomplete: bats_evidence.complete ($($proof.bats_evidence.complete)) is not true"
}
if ($proof.bats_evidence.total -ne $proof.bats_evidence.expected) {
    Die "bats-evidence-count-mismatch: bats_evidence.total ($($proof.bats_evidence.total)) != bats_evidence.expected ($($proof.bats_evidence.expected))"
}
if (-not ($proof.bats_evidence.ok -gt 0)) {
    Die "bats-evidence-floor: bats_evidence.ok ($($proof.bats_evidence.ok)) fails sanity floor (must be > 0)"
}

Write-Host "[emit-push-proof] verify-proof: PASS" -ForegroundColor Green
exit 0
