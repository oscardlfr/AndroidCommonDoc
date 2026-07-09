# emit-push-proof.ps1 -- PowerShell parity for scripts/sh/emit-push-proof.sh
#
# run-qg is DISABLED in this PowerShell path (Wave A, Section A5a) pending evidence
# binding -- writing an untested security-critical PS1 evidence binding (bats_evidence,
# see scripts/sh/emit-push-proof.sh's Section A4) would violate the prove-it-works rule,
# since pwsh is not installed on the box this wave was implemented on. Divergence is
# deliberately pushed to the SAFE direction only: bash mints under the new binding,
# PowerShell refuses to mint at all rather than mint without it. Filed to BACKLOG:
# restore PS1 run-qg with evidence binding + parity tests on a box with pwsh.
#
# verify-push-proof.ps1 (the read-only verifier) is UNAFFECTED and gained the same
# bats_evidence 8th check as the bash verify-proof subcommand -- see that file.
#
# USAGE
#   emit-push-proof.ps1 -Subcommand run-qg [-Slug <wave-slug>] [-RepoRoot <path>]
#
# EXIT CODES
#   0  success (unreachable while run-qg is disabled)
#   1  usage / argument error
#   2  integrity violation (manifest-drift, deliberation-absent, step-gap, etc.) OR
#      run-qg disabled (this wave)
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

# NOTE: the helpers below (Invoke-Python, Get-FileSha256, Get-CanonicalDigest,
# Resolve-Slug, Invoke-Predicate) are retained, unused, for the future restoration
# of Invoke-RunQg (see BACKLOG) -- they are proven-correct and would otherwise have
# to be rewritten from scratch. Not dead code to delete; dead code to keep.

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

# -- Subcommand: run-qg (DISABLED, Wave A Section A5a — see header) ----------
function Invoke-RunQg {
    Write-Host "[emit-push-proof] run-qg is disabled in the PowerShell path pending evidence binding — use scripts/sh/emit-push-proof.sh" -ForegroundColor Red
    exit 2
}

# -- Dispatch ----------------------------------------------------------------
switch ($Subcommand) {
    'run-qg' { Invoke-RunQg }
}
