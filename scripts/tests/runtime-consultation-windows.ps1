#!/usr/bin/env pwsh
#
# runtime-consultation-windows.ps1 -- REAL, EXECUTABLE Windows W01-W12 conformance
# leg for the portable runtime-consultation core (Wave 1, portable-runtime-
# messaging-adapters, WP1/WP2). Grounded in PLAN.md's Windows W01-W12 crosswalk
# (~L1490-1508), the Race section (~L1429-1435), the "PS1 / SC-17 (Option 2)"
# section (~L1555-1567), the Frozen Production CLI ABI (~L750-796), and the
# Portable no-clobber primitive (~L679-683).
#
# THIS FILE RUNS ONLY ON windows-latest CI VIA A REAL pwsh INTERPRETER
# (invoked as: pwsh -NoLogo -NoProfile -NonInteractive -File
# scripts/tests/runtime-consultation-windows.ps1), per the required
# `runtime-consultation-windows.yml` reusable workflow. It was authored on a
# macOS host with NO local pwsh available -- every case below is written
# precisely against the frozen CLI ABI and the actual (fully read, all 2857
# lines) scripts/lib/runtime-consultation.cjs source, but has NEVER been
# locally executed. The windows-latest CI run is the FIRST real execution.
# SC-17 = PENDING_CI and closes only when this job passes at final PR HEAD.
#
# Structural (non-executing) parity note: scripts/tests/runtime-consultation-
# windows.bats proves the .sh/.ps1 wrappers exist and are thin argv->node
# forwarders via static text checks on macOS/Linux, plus a FEW behavioral W0x
# cases driven through the .sh wrapper (bash is available cross-platform).
# THIS file is the only one that ever invokes a live .ps1 process.
#
# CLI flags/env vars used below are frozen (PLAN.md ~L750-753, ~L1492) and were
# cross-checked directly against scripts/lib/runtime-consultation.cjs's own
# COMMAND_FLAGS table, genId()/nowIso()/resolveFixedClockState() implementation,
# and isTestCapability() gate -- not guessed:
#   --coordination-root --role --request --worker-session --timeout --mode
#   --fixed-ids --fixed-clock  (mode is bridge-CLI-only, unused here)
#   NODE_ENV=test + RUNTIME_CONSULTATION_TEST_CAPABILITY=<non-empty>  (test-capability gate)
#   RUNTIME_CONSULTATION_FAKE_CLOCK=<ISO>            (overrides the frozen base, default 2025-01-01T00:00:00.000Z)
#   RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS=<int>  (added once to the frozen base -- a single
#                                                       fixed instant, NEVER simulated elapsed time)
#   RUNTIME_CONSULTATION_ACL_PROBE=unverifiable        (gated by test capability plus BOTH fixed
#                                                       flags; forces the production ACL path to
#                                                       return indeterminate and fail closed)
#
# --fixed-ids: genId() returns a per-process monotonic counter, hex, zero-
# padded to 32 chars, starting at 0 ("0" * 32) and incrementing by 1 per call --
# NOT shared across process boundaries (two separate node invocations each
# start their own counter back at 0). --fixed-clock: nowIso() and
# cmdAwaitResult's deadline arithmetic both read a single frozen instant
# (RUNTIME_CONSULTATION_FAKE_CLOCK or the default base, PLUS
# RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS) -- this is a STATIC offset, not a
# ticking clock, which is exactly what lets W06 force an immediate
# DEADLINE_EXCEEDED with zero real sleep. acquireLock()'s own Date.now() call
# (the W11 transition-lock mutex) is a DELIBERATE, documented exception that
# always reads the real wall clock regardless of --fixed-clock -- so W11's
# orphan-lock sub-case genuinely waits out the real ~1200ms LOCK_MAX_WAIT_MS
# bound; that is the underlying primitive's own bounded-wait behavior, not an
# artificial sleep inserted by this test file.
#
# Command coverage (verified against the COMMANDS registry in
# scripts/lib/runtime-consultation.cjs, all 2857 lines read): root-init,
# root-validate, validate, publish-request, publish-blob, dispatch,
# record-delivery, claim, lease-heartbeat, takeover, publish-result,
# await-result, accept-result, transaction-ack, cancel, worker-stop,
# worker-stop-ack, cleanup.
#
# Git-identity note (load-bearing, empirically traced through the source, not
# assumed): computeRepoId/computeWorktreeId/computeSubjectHead all run
# `git -C <coordination-root> rev-parse ...`, so ANY subcommand that reaches
# cmdPublishRequest, cmdClaim, cmdPublishResult, or cmdAcceptResult REQUIRES
# --coordination-root to sit inside a real git working tree (git walks up from
# any subdirectory to find .git -- the coordination-root itself need not be the
# repo toplevel). cmdCancel, cmdTransactionAck, cmdTakeover, cmdAwaitResult do
# NOT call git. UPDATED (WP3 root-confinement, RCR-confine-*): cmdRootInit and
# cmdRootValidate NOW also call `git -C <coordination-root> rev-parse
# --show-toplevel` to confine the root to its own enclosing worktree -- W01,
# W03, W06's happy path, W08, and W09 below use New-GitFixtureRoot for exactly
# this reason (a plain non-git temp dir is correctly rejected SECURITY_INVALID).
# This file mirrors
# runtime-consultation-cli.bats's own already-empirically-verified fixture
# convention exactly: `git init -q` a FRESH throwaway directory per git-needing
# test (never nested inside this repo's own checkout), so every fixture is
# fully hermetic and git calls trivially resolve without touching the real repo.
#
# W01-W12 coverage map (see the bottom of this file for the executed test
# list; WP3 items are explicit, greppable skips, never faked):
#   W01  real (via .ps1 wrapper)      W02  real (via .ps1 wrapper)
#   W03  real (via .ps1 wrapper)      W04  real (via .ps1 wrapper)
#   W05  real (via .ps1 wrapper)      W06  real (via .ps1 wrapper, 4 cases)
#   W07a real (via .ps1 wrapper)      W07b real (deterministic app-server/mcp bridge)
#   W08  real publish-request (node + .sh-via-bash + .ps1, byte-identical stdout)
#   W09  real (Get-Acl allowlist, via .ps1 wrapper for root-init/root-validate)
#   W10a real (Everyone SID fail-closed)  W10b real (unverifiable probe fail-closed)
#   W11  real (two node processes race one .lock/, + a separate orphan-lock case)
#   W12  real (two node processes race the no-clobber primitive via `claim`)
#
# Invocation: pwsh -NoLogo -NoProfile -NonInteractive -File
#   scripts/tests/runtime-consultation-windows.ps1

param([string]$CasePattern = '*')

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ─────────────────────────────────────────────────────────────────────────────
# Global paths / constants
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ImplPath = (Resolve-Path (Join-Path $PSScriptRoot '..\lib\runtime-consultation.cjs')).Path
$RllImplPath = (Resolve-Path (Join-Path $PSScriptRoot '..\lib\runtime-role-lifecycle.cjs')).Path
$BridgeImplPath = (Resolve-Path (Join-Path $PSScriptRoot '..\lib\runtime-bridge-codex.cjs')).Path
$PrivateRegistryPreloadPath = (Resolve-Path (Join-Path $PSScriptRoot 'lib\private-registry-tmpdir-preload.cjs')).Path
$ContextProviderGatePath = (Resolve-Path (Join-Path $PSScriptRoot '..\..\.claude\hooks\context-provider-gate.js')).Path
$Ps1WrapperPath = (Resolve-Path (Join-Path $PSScriptRoot '..\ps1\runtime-consultation.ps1')).Path
$ShWrapperPath = (Resolve-Path (Join-Path $PSScriptRoot '..\sh\runtime-consultation.sh')).Path
$BashPath = @(
  (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
  (Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $BashPath) { $BashPath = (Get-Command bash -ErrorAction Stop).Source }

# "Harness-created" test capability (PLAN.md ~L752-753, ~L796) -- distinct value
# from the bats suites' own TEST_CAPABILITY constants so suite-of-origin is
# obvious in any shared CI log output.
$TestCapability = 'ps1-runtime-consultation-windows-fixture-capability'

$WorkRoot = Join-Path ([IO.Path]::GetTempPath()) ("rcw-ps1-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$script:PassCount = 0
$script:FailCount = 0
$script:SkipCount = 0
$script:TestResults = @()

# ─────────────────────────────────────────────────────────────────────────────
# Generic filesystem / fixture helpers
# ─────────────────────────────────────────────────────────────────────────────

function New-Ps1TestTempDir {
  param([Parameter(Mandatory)][string]$Suffix)
  $dir = Join-Path $WorkRoot $Suffix
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

# Fresh, hermetic, throwaway git repository -- mirrors runtime-consultation-
# cli.bats's own `setup()` fixture convention exactly (git init -q; configure a
# local dummy identity; one empty initial commit) so that
# computeRepoId/computeWorktreeId/computeSubjectHead's `git -C <root> rev-parse`
# calls always resolve, independent of and never touching this repo's own
# checkout.
function New-GitFixtureRoot {
  param([Parameter(Mandatory)][string]$Suffix)
  $dir = New-Ps1TestTempDir -Suffix $Suffix
  & git -c core.longpaths=true -C $dir init -q 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git init failed for fixture path: $dir" }
  & git -c core.longpaths=true -C $dir config core.longpaths true 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git core.longpaths setup failed for fixture path: $dir" }
  & git -c core.longpaths=true -C $dir config user.email 'ps1-windows-fixture@test.local' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git user.email setup failed for fixture path: $dir" }
  & git -c core.longpaths=true -C $dir config user.name 'PS1 Windows Fixture' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git user.name setup failed for fixture path: $dir" }
  & git -c core.longpaths=true -C $dir commit -q --allow-empty -m init 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git initial commit failed for fixture path: $dir" }
  $planDir = Join-Path $dir '.planning\wave-ps1-windows-harness'
  New-Item -ItemType Directory -Force -Path $planDir | Out-Null
  '# Fixture PLAN for runtime-consultation-windows.ps1' |
    Set-Content -NoNewline -Encoding utf8 -Path (Join-Path $planDir 'PLAN.md')
  return $dir
}

# node-computed ISO-8601 timestamp (no sub-second component), offset from the
# REAL current instant by $OffsetSeconds. Delegated to node (rather than
# PowerShell's own Get-Date formatting) so the format is byte-identical to the
# CLI's own nowIso() -- `new Date(...).toISOString().replace(/\.\d{3}Z$/,'Z')` --
# with zero risk of a subtle pwsh-vs-JS ISO-format mismatch. Single-quoted so
# PowerShell never tries to interpolate the literal `$` in the JS regex.
function Get-IsoTimestamp {
  param([Parameter(Mandatory)][int]$OffsetSeconds)
  $expr = 'console.log(new Date(Date.now()+' + $OffsetSeconds + '*1000).toISOString().replace(/\.\d{3}Z$/,"Z"))'
  $result = & node -e $expr
  return ([string]$result).Trim()
}

function ConvertTo-Base64UrlFromUtf8String {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $b64 = [Convert]::ToBase64String($bytes)
  return $b64.TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function ConvertTo-ForwardSlashPath {
  param([Parameter(Mandatory)][string]$Path)
  return $Path.Replace('\', '/')
}

function ConvertTo-GitBashPath {
  param([Parameter(Mandatory)][string]$Path)
  $full = [IO.Path]::GetFullPath($Path).Replace('\', '/')
  if ($full -match '^([A-Za-z]):/(.*)$') {
    return '/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2]
  }
  return $full
}

function New-SubjectBundleManifestFile {
  param([Parameter(Mandatory)][string]$Path)
  $manifest = [ordered]@{ schema = 'coordination/subject-bundle-manifest/v1'; entries = @() }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  ($manifest | ConvertTo-Json -Compress -Depth 4) | Set-Content -NoNewline -Encoding utf8 -Path $Path
  return $Path
}

function New-PlanFixtureFile {
  param([Parameter(Mandatory)][string]$GitRoot, [Parameter(Mandatory)][string]$WaveSlug)
  # One discoverable PLAN per fixture repository. Multiple wave directories
  # make discoverPlan() correctly fail closed as ambiguous.
  $planDir = Join-Path $GitRoot '.planning\wave-ps1-windows-harness'
  New-Item -ItemType Directory -Force -Path $planDir | Out-Null
  $planPath = Join-Path $planDir 'PLAN.md'
  "# Fixture PLAN for runtime-consultation-windows.ps1`n`nThrowaway per-test fixture -- not the real Wave 1 PLAN.md.`n" |
    Set-Content -NoNewline -Encoding utf8 -Path $planPath
  return $planPath
}

# Builds the frozen `--intent` payload (target_role/question/expected_result_kind/
# expiry[/parent_request_id]) and returns its base64url encoding, exactly the
# shape decodeIntentOrThrow()/INTENT_FIELDS require.
function New-IntentBase64Url {
  param(
    [Parameter(Mandatory)][string]$TargetRole,
    [Parameter(Mandatory)][string]$Question,
    [Parameter(Mandatory)][string]$ExpectedResultKind,
    [Parameter(Mandatory)][string]$Expiry
  )
  $intent = [ordered]@{
    target_role = $TargetRole
    question = $Question
    expected_result_kind = $ExpectedResultKind
    expiry = $Expiry
  }
  $json = $intent | ConvertTo-Json -Compress -Depth 4
  return ConvertTo-Base64UrlFromUtf8String -Text $json
}

# ─────────────────────────────────────────────────────────────────────────────
# Child-process invocation helpers -- ALWAYS separate stdout/stderr files
# (PLAN.md ~L1492: "never merge-then-discard-one").
#
# CRITICAL pwsh idiom: scripts/ps1/runtime-consultation.ps1 ends with
# `exit $LASTEXITCODE`. Invoking a .ps1 file via the call operator (`&
# <path-to-script>.ps1`) runs it in a NEW SCOPE of the SAME PROCESS, not a new
# OS process -- so a bare `exit` inside it would terminate THIS ENTIRE test
# runner, not just that one case. Every wrapper invocation below therefore
# spawns `pwsh -File <wrapper>` as a genuinely separate child OS process via
# Start-Process, exactly as the real windows-latest CI job would invoke this
# very file itself. Only the direct-node and bash/.sh helpers call a natively
# separate executable, so they do not share this hazard -- but they use the
# same Start-Process plumbing for consistency and identical evidence capture.
# ─────────────────────────────────────────────────────────────────────────────

$script:InvocationCounter = 0

function Invoke-ChildProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [hashtable]$EnvVars = @{}
  )
  $script:InvocationCounter++
  $outFile = Join-Path $WorkRoot ("invoke-{0}.out" -f $script:InvocationCounter)
  $errFile = Join-Path $WorkRoot ("invoke-{0}.err" -f $script:InvocationCounter)

  # Start-Process flattens ArgumentList back into one command line and lets
  # Windows re-tokenize it, corrupting paths with spaces. ArgumentList on
  # ProcessStartInfo preserves every argv token as an independent value.
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($arg in $ArgumentList) { [void]$psi.ArgumentList.Add([string]$arg) }
  foreach ($k in $EnvVars.Keys) { $psi.Environment[$k] = [string]$EnvVars[$k] }

  $proc = [System.Diagnostics.Process]::new()
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $stdoutMemory = [IO.MemoryStream]::new()
  $stderrMemory = [IO.MemoryStream]::new()
  $stdoutCopy = $proc.StandardOutput.BaseStream.CopyToAsync($stdoutMemory)
  $stderrCopy = $proc.StandardError.BaseStream.CopyToAsync($stderrMemory)
  $proc.WaitForExit()
  [System.Threading.Tasks.Task]::WaitAll(@($stdoutCopy, $stderrCopy))
  $exitCode = $proc.ExitCode
  $stdoutBytes = $stdoutMemory.ToArray()
  $stderrBytes = $stderrMemory.ToArray()
  [IO.File]::WriteAllBytes($outFile, $stdoutBytes)
  [IO.File]::WriteAllBytes($errFile, $stderrBytes)
  $proc.Dispose()
  $stdoutMemory.Dispose()
  $stderrMemory.Dispose()

  # Deliberately plain, unambiguous direct assignments (never an if/else used
  # as an expression) -- PowerShell's pipeline-style value capture can unroll
  # an empty array result to $null, which would silently corrupt the
  # byte-exact comparisons this file relies on (W03/W08/Assert-BytesEqual).
  $stdoutBytes = [byte[]]$stdoutBytes
  $stderrBytes = [byte[]]$stderrBytes
  return [pscustomobject]@{
    ExitCode     = $exitCode
    Stdout       = [System.Text.Encoding]::UTF8.GetString($stdoutBytes)
    Stderr       = [System.Text.Encoding]::UTF8.GetString($stderrBytes)
    StdoutBytes  = $stdoutBytes
    StderrBytes  = $stderrBytes
    OutFile      = $outFile
    ErrFile      = $errFile
  }
}

$script:TargetBindingIds = @{}
$script:GrantMintScript = @'
const fs = require('fs');
const crypto = require('crypto');
const rll = require(process.argv[1]);
const rc = require(process.argv[2]);
const projectRoot = process.argv[3];
const subcommand = process.argv[4];
const role = process.argv[5];
const existingTargetBindingId = process.argv[6] === '-' ? null : process.argv[6];
const rest = process.argv.slice(7);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 && i + 1 < rest.length ? rest[i + 1] : undefined; };
const canonicalIso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const frozenNow = () => {
  const base = Date.parse(process.env.RUNTIME_CONSULTATION_FAKE_CLOCK || '2025-01-01T00:00:00.000Z');
  const advance = Number.parseInt(process.env.RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS || '0', 10);
  return canonicalIso(base + (Number.isFinite(advance) && advance > 0 ? advance : 0));
};
const rewrite = (recordPath, ttlMs, pinCreated) => {
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const realCreated = Date.parse(record.created_at);
  const frozen = Date.parse(frozenNow());
  record.created_at = pinCreated ? canonicalIso(frozen) : canonicalIso(Math.min(realCreated, frozen));
  record.expiry = canonicalIso((pinCreated ? frozen : Math.max(realCreated, frozen)) + ttlMs);
  fs.writeFileSync(recordPath, JSON.stringify(record));
};
const requester = new Set(['root-init','root-validate','publish-blob','publish-request','dispatch','record-delivery','takeover','await-result','accept-result','transaction-ack','cancel','worker-stop','cleanup','validate']);
const target = new Set(['claim','lease-heartbeat','publish-result','worker-stop-ack']);
if (!requester.has(subcommand) && !target.has(subcommand)) process.exit(4);
const worktreeId = rll.computeWorktreeId(projectRoot);
const plan = rll.discoverPlan(projectRoot);
if (!plan.ok) throw new Error('discoverPlan failed: ' + JSON.stringify(plan));
const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
const fixed = rest.includes('--fixed-clock');
let binding;
let authority;
let requestId = null;
let attemptId = null;
let leaseEpoch = null;
let flagName;
if (requester.has(subcommand)) {
  authority = 'requester'; flagName = '--requester-binding';
  const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'ps1-windows-harness-session' };
  const created = rll.createRequesterBinding(projectRoot, identity, 'ps1-windows-harness-agent', role, worktreeId, plan.planDigest, 3600);
  if (!created.ok) throw new Error('createRequesterBinding failed: ' + JSON.stringify(created));
  binding = created.binding;
  if (fixed) rewrite(rll.requesterBindingPathFor(projectRoot, binding.binding_id), 100 * 365 * 24 * 3600 * 1000, false);
  const scope = rc.resolveRequesterGrantScope(subcommand, {
    'coordination-root': flag('--coordination-root'), request: flag('--request'), kind: flag('--kind'),
  });
  if (scope.ok) { requestId = scope.requestId; attemptId = scope.attemptId; leaseEpoch = scope.leaseEpoch; }
} else {
  authority = 'target'; flagName = '--target-binding';
  if (existingTargetBindingId) {
    const checked = rll.validateRoleActorBindingFor(projectRoot, existingTargetBindingId, role, worktreeId, plan.planDigest);
    if (!checked.ok) throw new Error('validateRoleActorBindingFor failed: ' + JSON.stringify(checked));
    binding = checked.binding;
  } else {
    const created = rll.createRoleActorBinding(projectRoot, role, worktreeId, plan.planDigest, crypto.randomBytes(16).toString('hex'), 60);
    if (!created.ok) throw new Error('createRoleActorBinding failed: ' + JSON.stringify(created));
    binding = created.binding;
  }
  if (fixed) rewrite(rll.roleActorBindingPathFor(projectRoot, binding.binding_id), 100 * 365 * 24 * 3600 * 1000, false);
  requestId = subcommand === 'worker-stop-ack' ? null : flag('--request');
}
const minted = rll.mintRoleCommandGrant(projectRoot, binding, authority, subcommand, argvDigest, requestId, attemptId, leaseEpoch);
if (!minted.ok) throw new Error('mintRoleCommandGrant failed: ' + JSON.stringify(minted));
if (fixed) rewrite(rll.roleCommandGrantPathFor(projectRoot, minted.grantId), 30000, true);
process.stdout.write(JSON.stringify({ grantId: minted.grantId, flagName, bindingId: binding.binding_id }));
'@

function Resolve-ProjectRootFromCliArgs {
  param([Parameter(Mandatory)][string[]]$CliArgs)
  $idx = [Array]::IndexOf($CliArgs, '--coordination-root')
  if ($idx -lt 0 -or $idx + 1 -ge $CliArgs.Count) { return $null }
  $probe = [IO.Path]::GetFullPath($CliArgs[$idx + 1])
  while (-not (Test-Path -LiteralPath $probe)) {
    $parent = Split-Path -Parent $probe
    if (-not $parent -or $parent -eq $probe) { return $null }
    $probe = $parent
  }
  $gitRoot = & git -C $probe rev-parse --show-toplevel 2>$null
  $gitExit = $LASTEXITCODE
  if ($gitExit -ne 0 -or -not $gitRoot) { return $null }
  return ([IO.Path]::GetFullPath(([string]$gitRoot).Trim()))
}

function Add-OneShotGrant {
  param([Parameter(Mandatory)][string[]]$CliArgs, [hashtable]$EnvVars = @{})
  if ($CliArgs.Count -eq 0) { return $CliArgs }
  $requesterCommands = @('root-init','root-validate','publish-blob','publish-request','dispatch','record-delivery','takeover','await-result','accept-result','transaction-ack','cancel','worker-stop','cleanup','validate')
  $targetCommands = @('claim','lease-heartbeat','publish-result','worker-stop-ack')
  $command = $CliArgs[0]
  if (($requesterCommands -notcontains $command) -and ($targetCommands -notcontains $command)) { return $CliArgs }
  $projectRoot = Resolve-ProjectRootFromCliArgs -CliArgs $CliArgs
  if (-not $projectRoot) { throw "unable to resolve git project root for grant: $($CliArgs -join ' ')" }
  $role = 'arch-testing'
  $roleIdx = [Array]::IndexOf($CliArgs, '--role')
  if ($roleIdx -ge 0 -and $roleIdx + 1 -lt $CliArgs.Count) { $role = $CliArgs[$roleIdx + 1] }
  $cacheKey = "$projectRoot|$role"
  $existing = '-'
  if ($targetCommands -contains $command -and $script:TargetBindingIds.ContainsKey($cacheKey)) { $existing = $script:TargetBindingIds[$cacheKey] }
  $mint = Invoke-ChildProcess -FilePath 'node' -ArgumentList (@('-e', $script:GrantMintScript, $RllImplPath, $ImplPath, $projectRoot, $command, $role, $existing) + $CliArgs[1..($CliArgs.Count - 1)]) -EnvVars (Get-DefaultCapabilityEnv -Extra $EnvVars)
  if ($mint.ExitCode -ne 0) { throw "grant mint failed for $command`: $($mint.Stderr)" }
  $grant = $mint.Stdout | ConvertFrom-Json -ErrorAction Stop
  if ($targetCommands -contains $command) { $script:TargetBindingIds[$cacheKey] = $grant.bindingId }
  return @($CliArgs + @([string]$grant.flagName, [string]$grant.grantId))
}

function Get-DefaultCapabilityEnv {
  param([hashtable]$Extra = @{})
  $env = @{ NODE_ENV = 'test'; RUNTIME_CONSULTATION_TEST_CAPABILITY = $TestCapability }
  foreach ($k in $Extra.Keys) { $env[$k] = $Extra[$k] }
  return $env
}

# Invokes the REAL scripts/ps1/runtime-consultation.ps1 wrapper as a separate
# pwsh child process -- the primary entrypoint under test for W01-W07a/W09.
function Invoke-Wrapper {
  param([Parameter(Mandatory)][string[]]$CliArgs, [hashtable]$EnvVars = @{})
  $grantedArgs = Add-OneShotGrant -CliArgs $CliArgs -EnvVars $EnvVars
  $argList = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $Ps1WrapperPath) + $grantedArgs
  return Invoke-ChildProcess -FilePath 'pwsh' -ArgumentList $argList -EnvVars $EnvVars
}

# Invokes node directly against the impl (used by W08's 3-way comparison and by
# W11/W12, which race two NODE processes per this task's own dispatch wording).
function Invoke-NodeDirect {
  param([Parameter(Mandatory)][string[]]$CliArgs, [hashtable]$EnvVars = @{})
  $grantedArgs = Add-OneShotGrant -CliArgs $CliArgs -EnvVars $EnvVars
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList (@($ImplPath) + $grantedArgs) -EnvVars $EnvVars
}

# Invokes scripts/sh/runtime-consultation.sh via bash (Git for Windows' bash.exe,
# already required on windows-latest for the checkout step itself). Forward
# slashes are used for the script path AND every path-valued argument here
# specifically to sidestep MSYS/Git-Bash's own argv re-splitting and
# backslash-escaping conventions -- Node's path.resolve() normalizes either
# separator to the same canonical Windows absolute form, so this does not
# affect the byte-identical stdout comparison in W08 (see that test's own
# uncertainty note).
function Invoke-ShWrapperViaBash {
  param([Parameter(Mandatory)][string[]]$CliArgs, [hashtable]$EnvVars = @{})
  $shWrapperFwd = ConvertTo-GitBashPath -Path $ShWrapperPath
  $grantedArgs = Add-OneShotGrant -CliArgs $CliArgs -EnvVars $EnvVars
  return Invoke-ChildProcess -FilePath $BashPath -ArgumentList (@($shWrapperFwd) + $grantedArgs) -EnvVars $EnvVars
}

function New-SupervisorStartAction {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$Role,
    [Parameter(Mandatory)][string]$PrivateTemp
  )
  $scriptText = @'
const { spawnSync } = require('child_process');
const rll = require(process.argv[1]);
const projectRoot = process.argv[2];
const role = process.argv[3];
const contextProviderGate = process.argv[4];
const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'ps1-w07b-session' };
const worktreeId = rll.computeWorktreeId(projectRoot);
const plan = rll.discoverPlan(projectRoot);
if (!plan.ok) throw new Error('discoverPlan failed: ' + JSON.stringify(plan));
const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, plan.planDigest, 600);
if (!binding.ok) throw new Error('createMainOrchestratorBinding failed: ' + JSON.stringify(binding));
const crypto = require('crypto');
const argvDigest = crypto.createHash('sha256').update(Buffer.from('ensure:' + role, 'utf8')).digest('hex');
const grant = rll.mintLifecycleCommandGrant(projectRoot, binding.binding, argvDigest, role, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
if (!grant.ok) throw new Error('mintLifecycleCommandGrant failed: ' + JSON.stringify(grant));
const capabilityDiagnostic = {
  manifest: rll.getCapabilityManifest(projectRoot),
  startability: rll.resolveSupervisorStartability(projectRoot, 'codex-app-server'),
  testBackend: process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BACKEND || null,
};
const run = spawnSync(process.execPath, [process.argv[1], 'ensure', '--project-root', projectRoot, '--role', role, '--lifecycle-binding', grant.grantId], {
  encoding: 'utf8',
  env: Object.assign({}, process.env, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY,
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']),
    CODEX_CLI_PATH: process.execPath,
  }),
});
if (run.status !== 0) throw new Error('ensure failed: ' + run.stdout + run.stderr + ' diagnostics=' + JSON.stringify(capabilityDiagnostic));
const result = JSON.parse(run.stdout.trim().split(/\r?\n/).pop());
const action = result.actions.find((candidate) => candidate.kind === 'supervisor-start');
if (!action) throw new Error('ensure returned no supervisor-start action: ' + run.stdout);
const hookInput = {
  tool_name: 'Bash',
  tool_input: {
    command: action.payload.bridge_command,
    run_in_background: false,
    description: 'W07b real host-executor admission',
  },
  session_id: identity.runtime_session_key,
  agent_type: '',
  agent_id: '',
};
const hook = spawnSync(process.execPath, [contextProviderGate], {
  input: JSON.stringify(hookInput),
  encoding: 'utf8',
  env: Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_WAVE_SLUG: '',
  }),
});
if (hook.status !== 0) throw new Error('context-provider gate failed: ' + hook.stdout + hook.stderr);
const hookLines = hook.stdout.trim().split(/\r?\n/).filter(Boolean);
const hookBody = JSON.parse(hookLines[hookLines.length - 1]);
const decision = hookBody && hookBody.hookSpecificOutput;
if (!decision || decision.permissionDecision !== 'allow') {
  throw new Error('context-provider gate did not admit supervisor start: ' + hook.stdout + hook.stderr);
}
if (!decision.updatedInput || decision.updatedInput.command !== action.payload.bridge_command || decision.updatedInput.run_in_background !== true) {
  throw new Error('context-provider gate returned an invalid host-executor rewrite: ' + hook.stdout);
}
process.stdout.write(JSON.stringify(action));
'@
  $env = @{
    NODE_ENV = 'test'
    NODE_OPTIONS = "--require=$PrivateRegistryPreloadPath"
    ANDROID_COMMON_DOC_TEST_PRIVATE_REGISTRY_ROOT = $PrivateTemp
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'ps1-w07b-lifecycle-capability'
    RUNTIME_ROLE_LIFECYCLE_TEST_BACKEND = 'deterministic-app-server-v1'
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = '["codex-app-server"]'
    TEMP = $PrivateTemp
    TMP = $PrivateTemp
    TMPDIR = $PrivateTemp
  }
  $mint = Invoke-ChildProcess -FilePath 'node' -ArgumentList @(
    '-e', $scriptText, $RllImplPath, $ProjectRoot, $Role, $ContextProviderGatePath
  ) -EnvVars $env
  if ($mint.ExitCode -ne 0) { throw "unable to mint real supervisor-start action: $($mint.Stderr)" }
  return ($mint.Stdout | ConvertFrom-Json -DateKind String -ErrorAction Stop)
}

function Start-CapturedProcess {
  param([Parameter(Mandatory)][string]$FilePath, [Parameter(Mandatory)][string[]]$ArgumentList, [hashtable]$EnvVars = @{})
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($arg in $ArgumentList) { [void]$psi.ArgumentList.Add([string]$arg) }
  foreach ($k in $EnvVars.Keys) { $psi.Environment[$k] = [string]$EnvVars[$k] }
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  [void]$process.Start()
  return [pscustomobject]@{ Process = $process; Stdout = $process.StandardOutput.ReadToEndAsync(); Stderr = $process.StandardError.ReadToEndAsync() }
}

function New-PublishedRequestFixture {
  param([Parameter(Mandatory)][string]$Suffix, [string]$Question = 'Windows race fixture')
  $gitRoot = New-GitFixtureRoot -Suffix $Suffix
  $coordRoot = Join-Path $gitRoot '.planning\coordination'
  $capEnv = Get-DefaultCapabilityEnv
  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $coordRoot) -EnvVars $capEnv
  if ($rInit.ExitCode -ne 0) { throw "fixture root-init failed: $($rInit.Stdout) $($rInit.Stderr)" }
  $planPath = New-PlanFixtureFile -GitRoot $gitRoot -WaveSlug $Suffix
  $bundlePath = Join-Path $gitRoot ".planning\subject-bundle-$Suffix.json"
  New-SubjectBundleManifestFile -Path $bundlePath | Out-Null
  $intent = New-IntentBase64Url -TargetRole 'arch-testing' -Question $Question -ExpectedResultKind 'PS1_WINDOWS_FIXTURE' -Expiry (Get-IsoTimestamp -OffsetSeconds 1800)
  $rPublish = Invoke-Wrapper -CliArgs @(
    'publish-request', '--coordination-root', $coordRoot, '--plan', $planPath,
    '--subject-bundle', $bundlePath, '--intent', $intent
  ) -EnvVars $capEnv
  if ($rPublish.ExitCode -ne 0) { throw "fixture publish-request failed: $($rPublish.Stdout) $($rPublish.Stderr)" }
  $parsed = Assert-CliResult -Stdout $rPublish.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'
  return [pscustomobject]@{ GitRoot = $gitRoot; CoordinationRoot = $coordRoot; RequestPath = $parsed.artifact_ref; CapabilityEnv = $capEnv }
}

# ─────────────────────────────────────────────────────────────────────────────
# Assertion helpers -- mirror runtime-consultation-cli.bats' / runtime-
# consultation-windows.bats' own _assert_cli_result / _assert_stdout_single_
# json_line / _assert_stderr_no_json helpers, translated to pwsh.
# ─────────────────────────────────────────────────────────────────────────────

$script:CliResultAllowedKeys = @(
  'schema', 'command', 'ok', 'status', 'code', 'request_id', 'artifact_ref',
  'detail_code', 'content_ref', 'activation_action'
)

# Parses $Stdout as the frozen coordination/cli-result/v1 envelope (PLAN.md
# ~L779-781): closed key set, literal schema, expected status, expected
# detail_code (pass '' to skip that one check), and ok/status consistency.
# Returns the parsed object so callers can pull request_id/artifact_ref/etc.
function Assert-CliResult {
  param(
    [Parameter(Mandatory)][string]$Stdout,
    [Parameter(Mandatory)][string]$ExpectedStatus,
    [string]$ExpectedDetail = ''
  )
  $data = $null
  try {
    $data = $Stdout | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "stdout is not valid JSON: $($_.Exception.Message) -- raw: $Stdout"
  }
  $keys = @($data.PSObject.Properties.Name)
  $extra = @($keys | Where-Object { $script:CliResultAllowedKeys -notcontains $_ })
  $missing = @($script:CliResultAllowedKeys | Where-Object { $keys -notcontains $_ })
  if ($extra.Count -gt 0) { throw "unexpected extra keys: $($extra -join ',')" }
  if ($missing.Count -gt 0) { throw "missing required keys: $($missing -join ',')" }
  if ($data.schema -ne 'coordination/cli-result/v1') { throw "wrong schema: $($data.schema)" }
  if ($data.status -ne $ExpectedStatus) { throw "expected status $ExpectedStatus got $($data.status) (full: $Stdout)" }
  if ($ExpectedDetail -and $data.detail_code -ne $ExpectedDetail) {
    throw "expected detail_code $ExpectedDetail got $($data.detail_code) (full: $Stdout)"
  }
  if ($data.ok -isnot [bool]) { throw "ok is not boolean" }
  if (($data.status -eq 'SUCCESS') -ne $data.ok) { throw "ok/status inconsistent" }
  return $data
}

# Asserts $StdoutBytes is exactly one JSON object plus exactly one trailing LF
# and nothing after it -- no prose/second line/BOM (Frozen CLI ABI, PLAN.md
# ~L779, W03).
function Assert-StdoutSingleJsonLine {
  param([Parameter(Mandatory)][byte[]]$StdoutBytes)
  if ($StdoutBytes.Length -eq 0) { throw 'stdout is empty' }
  if ($StdoutBytes.Length -ge 3 -and $StdoutBytes[0] -eq 0xEF -and $StdoutBytes[1] -eq 0xBB -and $StdoutBytes[2] -eq 0xBF) {
    throw 'stdout begins with a UTF-8 BOM'
  }
  $lfCount = 0
  $lastLfIndex = -1
  for ($i = 0; $i -lt $StdoutBytes.Length; $i++) {
    if ($StdoutBytes[$i] -eq 0x0A) { $lfCount++; $lastLfIndex = $i }
  }
  if ($lfCount -ne 1) { throw "expected exactly one LF byte in stdout, found $lfCount" }
  if ($lastLfIndex -ne ($StdoutBytes.Length - 1)) { throw 'the single LF byte is not the final byte of stdout' }
}

# Asserts $StderrBytes never carries a bare JSON object (PLAN.md ~L779, W04).
# Empty stderr trivially passes.
function Assert-StderrNoBareJson {
  param([Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$StderrBytes)
  if ($StderrBytes.Length -eq 0) { return }
  $text = [System.Text.Encoding]::UTF8.GetString($StderrBytes)
  if ([string]::IsNullOrWhiteSpace($text)) { return }
  $isJson = $true
  try { [void]($text | ConvertFrom-Json -ErrorAction Stop) } catch { $isJson = $false }
  if ($isJson) { throw "stderr parsed as JSON -- must be diagnostics only: $text" }
}

function Assert-True {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-BytesEqual {
  param([Parameter(Mandatory)][byte[]]$A, [Parameter(Mandatory)][byte[]]$B, [Parameter(Mandatory)][string]$Message)
  if ($A.Length -ne $B.Length) { throw "$Message (length mismatch: $($A.Length) vs $($B.Length))" }
  for ($i = 0; $i -lt $A.Length; $i++) {
    if ($A[$i] -ne $B[$i]) { throw "$Message (first differing byte at index $i)" }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Test harness -- pass/fail/skip tally, TAP-ish summary, non-zero exit on any
# real (non-skipped) failure.
# ─────────────────────────────────────────────────────────────────────────────

function Invoke-Case {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Body)
  if ($Name -notlike $CasePattern) { return }
  Write-Host "--- RUNNING: $Name ---"
  try {
    & $Body
    $script:PassCount++
    $script:TestResults += [pscustomobject]@{ Name = $Name; Result = 'PASS'; Message = '' }
    Write-Host "PASS: $Name"
  } catch {
    $script:FailCount++
    $msg = $_.Exception.Message
    $script:TestResults += [pscustomobject]@{ Name = $Name; Result = 'FAIL'; Message = $msg }
    Write-Host "FAIL: $Name -- $msg"
  }
}

function Skip-Case {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Reason)
  $script:SkipCount++
  $script:TestResults += [pscustomobject]@{ Name = $Name; Result = 'SKIP'; Message = $Reason }
  Write-Host "SKIP: $Name -- $Reason"
}

# ══════════════════════════════════════════════════════════════════════════
# W01 argv & paths-with-spaces (PLAN.md ~L1496) -- via the .ps1 wrapper
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W01 wrapper: root-init then root-validate succeed against a --coordination-root path containing spaces' -Body {
  # WP3 root-confinement (RCR-confine-*): root-init/root-validate now require
  # --coordination-root to resolve inside a real git worktree, so this (like
  # W02/W07a/W09/W12) uses New-GitFixtureRoot rather than a plain temp dir --
  # the suffix itself still embeds the spaces this case exists to prove.
  $rootWithSpaces = New-GitFixtureRoot -Suffix 'w01 coordination root with spaces'
  $r1 = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $rootWithSpaces) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($r1.ExitCode -eq 0) "root-init exit code expected 0, got $($r1.ExitCode); stdout=$($r1.Stdout); stderr=$($r1.Stderr)"
  Assert-CliResult -Stdout $r1.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null
  Assert-StdoutSingleJsonLine -StdoutBytes $r1.StdoutBytes
  Assert-StderrNoBareJson -StderrBytes $r1.StderrBytes
  Assert-True (Test-Path $rootWithSpaces) "coordination root with spaces was not created: $rootWithSpaces"

  $r2 = Invoke-Wrapper -CliArgs @('root-validate', '--coordination-root', $rootWithSpaces) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($r2.ExitCode -eq 0) "root-validate exit code expected 0, got $($r2.ExitCode); stderr=$($r2.Stderr)"
  Assert-CliResult -Stdout $r2.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null
  Assert-StdoutSingleJsonLine -StdoutBytes $r2.StdoutBytes
  Assert-StderrNoBareJson -StderrBytes $r2.StderrBytes
}

# ══════════════════════════════════════════════════════════════════════════
# W02 UTF-8 & quoting (PLAN.md ~L1497) -- reuses the W07a-style valid
# publish-request fixture; question carries non-ASCII + JSON quote/backslash.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W02 wrapper: UTF-8 + JSON quote/backslash question round-trips byte-exact through base64url --intent' -Body {
  $gitRoot = New-GitFixtureRoot -Suffix 'w02-git'
  $coordRoot = Join-Path $gitRoot '.planning\coordination'
  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $coordRoot) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($rInit.ExitCode -eq 0) "root-init exit code expected 0, got $($rInit.ExitCode); stderr=$($rInit.Stderr)"

  $planPath = New-PlanFixtureFile -GitRoot $gitRoot -WaveSlug 'ps1winfixture-w02'
  $bundlePath = Join-Path $gitRoot '.planning\subject-bundle-w02.json'
  New-SubjectBundleManifestFile -Path $bundlePath | Out-Null

  $question = "W02 UTF-8+quote+backslash: h`u{00E9}llo w`u{00F6}rld `u{65E5}`u{672C}`u{8A9E} quote:`"embedded`" backslash:C:\path\to\file end"
  $expiry = Get-IsoTimestamp -OffsetSeconds 600
  $intentB64 = New-IntentBase64Url -TargetRole 'arch-testing' -Question $question -ExpectedResultKind 'PS1_WINDOWS_FIXTURE' -Expiry $expiry

  $rPub = Invoke-Wrapper -CliArgs @(
    'publish-request', '--coordination-root', $coordRoot, '--plan', $planPath,
    '--subject-bundle', $bundlePath, '--intent', $intentB64
  ) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($rPub.ExitCode -eq 0) "publish-request exit code expected 0, got $($rPub.ExitCode); stdout=$($rPub.Stdout) stderr=$($rPub.Stderr)"
  $parsed = Assert-CliResult -Stdout $rPub.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'
  Assert-StdoutSingleJsonLine -StdoutBytes $rPub.StdoutBytes
  Assert-StderrNoBareJson -StderrBytes $rPub.StderrBytes

  $requestPath = $parsed.artifact_ref
  Assert-True (Test-Path $requestPath) "publish-request's own artifact_ref does not exist on disk: $requestPath"
  $requestObj = Get-Content -Raw -Encoding utf8 -Path $requestPath | ConvertFrom-Json
  Assert-True ($requestObj.question -ceq $question) "byte-exact question mismatch. Expected: [$question] Got: [$($requestObj.question)]"
}

# ══════════════════════════════════════════════════════════════════════════
# W03 exactly one JSON on stdout (PLAN.md ~L1498) -- via the .ps1 wrapper
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W03 wrapper: root-init prints exactly one JSON object plus one trailing LF on stdout, no prose/second-line/BOM' -Body {
  # WP3 root-confinement: root-init now requires a git-worktree-confined root.
  $freshRoot = New-GitFixtureRoot -Suffix 'w03-coordination'
  $r = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $freshRoot) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($r.ExitCode -eq 0) "root-init exit code expected 0, got $($r.ExitCode); stderr=$($r.Stderr)"
  Assert-CliResult -Stdout $r.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null
  Assert-StdoutSingleJsonLine -StdoutBytes $r.StdoutBytes
  Assert-StderrNoBareJson -StderrBytes $r.StderrBytes
}

# ══════════════════════════════════════════════════════════════════════════
# W04 diagnostics only on stderr (PLAN.md ~L1499) -- via the .ps1 wrapper
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W04 wrapper: an error path (unknown subcommand) never emits a bare JSON object on stderr' -Body {
  $r = Invoke-Wrapper -CliArgs @('totally-not-a-real-subcommand-xyz') -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($r.ExitCode -eq 2) "expected exit code 2 (USAGE_ERROR), got $($r.ExitCode)"
  Assert-CliResult -Stdout $r.Stdout -ExpectedStatus 'USAGE_ERROR' -ExpectedDetail 'UNKNOWN_COMMAND' | Out-Null
  Assert-StdoutSingleJsonLine -StdoutBytes $r.StdoutBytes
  Assert-StderrNoBareJson -StderrBytes $r.StderrBytes
}

# ══════════════════════════════════════════════════════════════════════════
# W05 differentiated exit codes (PLAN.md ~L1500) -- via the .ps1 wrapper
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W05 wrapper: an unknown subcommand yields a nonzero exit code' -Body {
  $r = Invoke-Wrapper -CliArgs @('another-not-a-real-subcommand-abc') -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($r.ExitCode -ne 0) "expected a nonzero exit code, got $($r.ExitCode)"
}

# ══════════════════════════════════════════════════════════════════════════
# W06 success/validation-error/timeout/unknown-subcommand, pairwise distinct
# (PLAN.md ~L1501) -- via the .ps1 wrapper. Deadline-exceeded is forced via
# the fake-clock advance, NEVER a real sleep (see header note).
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W06 wrapper: success/validation-error/timeout/unknown-subcommand exit codes are pairwise distinct' -Body {
  # (a) happy path -- SUCCESS/rc0
  # WP3 root-confinement: root-init now requires a git-worktree-confined root.
  $freshRoot = New-GitFixtureRoot -Suffix 'w06-coordination'
  $rHappy = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $freshRoot) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-CliResult -Stdout $rHappy.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  # (b) validation error -- a missing root lexically inside the same git
  # worktree reaches root-validate's confinement checks and deterministically
  # returns INVALID/SECURITY_INVALID.
  $missingRoot = Join-Path $freshRoot 'missing-validation-root'
  $rBad = Invoke-Wrapper -CliArgs @('root-validate', '--coordination-root', $missingRoot) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-CliResult -Stdout $rBad.Stdout -ExpectedStatus 'INVALID' -ExpectedDetail 'SCHEMA_INVALID' | Out-Null

  # (c) forced deadline-exceeded via the fake-clock advance -- NEVER a real
  # sleep. await-result's deadlineBaseMs is FIXED_CLOCK_BASE_MS when
  # --fixed-clock is active; currentClockMs() reads
  # FIXED_CLOCK_BASE_MS+FIXED_CLOCK_ADVANCE_MS. Advancing far past the
  # 1-second --timeout forces the very first loop iteration's deadline check
  # to already be exceeded -- zero real elapsed wall-clock time.
  $timeoutFixture = New-PublishedRequestFixture -Suffix 'w06-timeout' -Question 'W06 forced timeout'
  $timeoutReqPath = $timeoutFixture.RequestPath
  $rTimeout = Invoke-Wrapper -CliArgs @(
    'await-result', '--coordination-root', $timeoutFixture.CoordinationRoot, '--request', $timeoutReqPath, '--timeout', '1', '--fixed-clock'
  ) -EnvVars (Get-DefaultCapabilityEnv -Extra @{ RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS = '999999999' })
  Assert-CliResult -Stdout $rTimeout.Stdout -ExpectedStatus 'TIMEOUT' -ExpectedDetail 'DEADLINE_EXCEEDED' | Out-Null

  # (d) unknown subcommand -- USAGE_ERROR/rc2
  $rUnknown = Invoke-Wrapper -CliArgs @('yet-another-not-a-real-subcommand') -EnvVars (Get-DefaultCapabilityEnv)
  Assert-CliResult -Stdout $rUnknown.Stdout -ExpectedStatus 'USAGE_ERROR' -ExpectedDetail 'UNKNOWN_COMMAND' | Out-Null

  $codes = @($rHappy.ExitCode, $rBad.ExitCode, $rTimeout.ExitCode, $rUnknown.ExitCode)
  $distinct = $codes | Select-Object -Unique
  Assert-True ($distinct.Count -eq 4) "expected 4 pairwise-distinct exit codes, got: $($codes -join ',')"
}

# ══════════════════════════════════════════════════════════════════════════
# W07a same-worktree E2E round trip (PLAN.md ~L1502) -- full publish->
# dispatch->claim->publish-result->await-result->accept-result->
# transaction-ack chain issued ENTIRELY via the .ps1 wrapper (each step a
# separate pwsh child process, per this file's Invoke-Wrapper helper).
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W07a wrapper: same-worktree publish->dispatch->claim->publish-result->await-result->accept-result->transaction-ack round trip entirely via the .ps1 wrapper' -Body {
  $gitRoot = New-GitFixtureRoot -Suffix 'w07a-git'
  $coordRoot = Join-Path $gitRoot '.planning\coordination'
  $capEnv = Get-DefaultCapabilityEnv

  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $coordRoot) -EnvVars $capEnv
  Assert-True ($rInit.ExitCode -eq 0) "root-init failed: $($rInit.Stdout) $($rInit.Stderr)"

  $planPath = New-PlanFixtureFile -GitRoot $gitRoot -WaveSlug 'ps1winfixture-w07a'
  $bundlePath = Join-Path $gitRoot '.planning\subject-bundle-w07a.json'
  New-SubjectBundleManifestFile -Path $bundlePath | Out-Null

  $expiry = Get-IsoTimestamp -OffsetSeconds 600
  $intentB64 = New-IntentBase64Url -TargetRole 'arch-testing' -Question 'W07a same-worktree E2E round trip fixture question' -ExpectedResultKind 'PS1_WINDOWS_FIXTURE' -Expiry $expiry

  $rPub = Invoke-Wrapper -CliArgs @(
    'publish-request', '--coordination-root', $coordRoot, '--plan', $planPath,
    '--subject-bundle', $bundlePath, '--intent', $intentB64
  ) -EnvVars $capEnv
  Assert-True ($rPub.ExitCode -eq 0) "publish-request failed: $($rPub.Stdout) $($rPub.Stderr)"
  $pubParsed = Assert-CliResult -Stdout $rPub.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'
  $requestPath = $pubParsed.artifact_ref
  Assert-True (Test-Path $requestPath) "request.json missing after publish-request: $requestPath"

  $rDispatch = Invoke-Wrapper -CliArgs @('dispatch', '--coordination-root', $coordRoot, '--request', $requestPath) -EnvVars $capEnv
  Assert-True ($rDispatch.ExitCode -eq 0) "dispatch failed: $($rDispatch.Stdout) $($rDispatch.Stderr)"
  $dispatchParsed = Assert-CliResult -Stdout $rDispatch.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'

  $rClaim = Invoke-Wrapper -CliArgs @('claim', '--coordination-root', $coordRoot, '--request', $requestPath, '--role', 'arch-testing') -EnvVars $capEnv
  Assert-True ($rClaim.ExitCode -eq 0) "claim failed: $($rClaim.Stdout) $($rClaim.Stderr)"
  $claimParsed = Assert-CliResult -Stdout $rClaim.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'
  $claimPath = $claimParsed.artifact_ref
  Assert-True (Test-Path $claimPath) "claim artifact missing after claim: $claimPath"

  $answerB64 = ConvertTo-Base64UrlFromUtf8String -Text 'W07a fixture answer content'
  $rResult = Invoke-Wrapper -CliArgs @(
    'publish-result', '--coordination-root', $coordRoot, '--request', $requestPath, '--claim', $claimPath, '--content', $answerB64
  ) -EnvVars $capEnv
  Assert-True ($rResult.ExitCode -eq 0) "publish-result failed: $($rResult.Stdout) $($rResult.Stderr)"
  $resultParsed = Assert-CliResult -Stdout $rResult.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'

  $rAwait = Invoke-Wrapper -CliArgs @('await-result', '--coordination-root', $coordRoot, '--request', $requestPath, '--timeout', '5') -EnvVars $capEnv
  Assert-True ($rAwait.ExitCode -eq 0) "await-result failed: $($rAwait.Stdout) $($rAwait.Stderr)"
  $awaitParsed = Assert-CliResult -Stdout $rAwait.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'

  $rAccept = Invoke-Wrapper -CliArgs @('accept-result', '--coordination-root', $coordRoot, '--request', $requestPath) -EnvVars $capEnv
  Assert-True ($rAccept.ExitCode -eq 0) "accept-result failed: $($rAccept.Stdout) $($rAccept.Stderr)"
  $acceptParsed = Assert-CliResult -Stdout $rAccept.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'

  $rAck = Invoke-Wrapper -CliArgs @('transaction-ack', '--coordination-root', $coordRoot, '--request', $requestPath, '--disposition', 'accepted') -EnvVars $capEnv
  Assert-True ($rAck.ExitCode -eq 0) "transaction-ack failed: $($rAck.Stdout) $($rAck.Stderr)"
  Assert-CliResult -Stdout $rAck.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  # request_id must stay consistent across every step of the chain.
  $requestIds = @($pubParsed.request_id, $dispatchParsed.request_id, $claimParsed.request_id, $resultParsed.request_id, $awaitParsed.request_id, $acceptParsed.request_id)
  $distinctIds = $requestIds | Select-Object -Unique
  Assert-True ($distinctIds.Count -eq 1) "request_id was not consistent across the round trip: $($requestIds -join ',')"

  # Disk-level cross-check beyond exit codes: accepted-result.json's
  # accepted_attempt_id must equal the WINNING claim's own attempt_id.
  $acceptedPath = $acceptParsed.artifact_ref
  Assert-True (Test-Path $acceptedPath) "accepted-result.json missing: $acceptedPath"
  $acceptedObj = Get-Content -Raw -Encoding utf8 -Path $acceptedPath | ConvertFrom-Json
  $claimObj = Get-Content -Raw -Encoding utf8 -Path $claimPath | ConvertFrom-Json
  Assert-True ($acceptedObj.accepted_attempt_id -ceq $claimObj.attempt_id) `
    "accepted-result accepted_attempt_id ($($acceptedObj.accepted_attempt_id)) does not match the winning claim's attempt_id ($($claimObj.attempt_id))"
}

# ══════════════════════════════════════════════════════════════════════════
# W08 Node/SH/PS1 equivalence (PLAN.md ~L1503) -- root-init --fixed-ids
# --fixed-clock is deterministic BY CONSTRUCTION (cmdRootInit never calls
# genId()/nowIso()), so a raw byte-diff of stdout across all three entrypoints
# is meaningful -- the real determinism proof, never a normalization fallback.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W08 node vs sh-wrapper(bash) vs ps1-wrapper equivalence: publish-request fixed IDs/clock is byte-identical' -Body {
  $gitRoot = New-GitFixtureRoot -Suffix 'w08-publish-request'
  $sharedRoot = Join-Path $gitRoot '.planning\coordination'
  $capEnv = Get-DefaultCapabilityEnv
  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $sharedRoot) -EnvVars $capEnv
  Assert-True ($rInit.ExitCode -eq 0) "W08 root-init failed: $($rInit.Stdout) $($rInit.Stderr)"
  $planPath = New-PlanFixtureFile -GitRoot $gitRoot -WaveSlug 'ps1-w08'
  $bundlePath = Join-Path $gitRoot '.planning\subject-bundle-w08.json'
  New-SubjectBundleManifestFile -Path $bundlePath | Out-Null
  $intent = New-IntentBase64Url -TargetRole 'arch-testing' -Question 'W08 deterministic request' -ExpectedResultKind 'PS1_W08' -Expiry '2025-01-01T00:10:00Z'
  $sharedRootFwd = ConvertTo-ForwardSlashPath -Path $sharedRoot
  $planFwd = ConvertTo-ForwardSlashPath -Path $planPath
  $bundleFwd = ConvertTo-ForwardSlashPath -Path $bundlePath
  $commonArgs = @(
    'publish-request', '--coordination-root', $sharedRootFwd, '--plan', $planFwd,
    '--subject-bundle', $bundleFwd, '--intent', $intent, '--fixed-ids', '--fixed-clock'
  )

  $rNode = Invoke-NodeDirect -CliArgs $commonArgs -EnvVars $capEnv
  Assert-True ($rNode.ExitCode -eq 0) "node-direct publish-request failed: $($rNode.Stdout) $($rNode.Stderr)"
  Assert-CliResult -Stdout $rNode.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null
  $rSh = $null
  try {
    $rSh = Invoke-ShWrapperViaBash -CliArgs $commonArgs -EnvVars $capEnv
  } catch {
    throw "bash was not invokable for the .sh wrapper leg of W08 (expected Git for Windows' bash.exe on PATH on windows-latest) -- underlying error: $($_.Exception.Message)"
  }
  Assert-True ($rSh.ExitCode -eq 0) "sh-wrapper(bash) publish-request failed: $($rSh.Stdout) $($rSh.Stderr)"
  Assert-CliResult -Stdout $rSh.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  $rPs1 = Invoke-Wrapper -CliArgs $commonArgs -EnvVars $capEnv
  Assert-True ($rPs1.ExitCode -eq 0) "ps1-wrapper publish-request failed: $($rPs1.Stdout) $($rPs1.Stderr)"
  Assert-CliResult -Stdout $rPs1.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  Assert-BytesEqual -A $rNode.StdoutBytes -B $rSh.StdoutBytes -Message 'node vs sh-wrapper(bash) stdout not byte-identical'
  Assert-BytesEqual -A $rSh.StdoutBytes -B $rPs1.StdoutBytes -Message 'sh-wrapper(bash) vs ps1-wrapper stdout not byte-identical'
  Assert-BytesEqual -A $rNode.StdoutBytes -B $rPs1.StdoutBytes -Message 'node vs ps1-wrapper stdout not byte-identical'
}

# ══════════════════════════════════════════════════════════════════════════
# W09 root/registry owner-confined ACL (PLAN.md ~L1504) -- via the .ps1
# wrapper for root-init/root-validate; the ACL allowlist assertion itself is
# performed independently by THIS test via Get-Acl after production's own
# SID/DACL validation succeeds.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W09 wrapper: root/registry owner-confined ACL contains only the frozen allowlisted SIDs' -Body {
  # WP3 root-confinement: root-init now requires a git-worktree-confined root.
  $root = New-GitFixtureRoot -Suffix 'w09-coordination'
  $capEnv = Get-DefaultCapabilityEnv
  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $root) -EnvVars $capEnv
  Assert-True ($rInit.ExitCode -eq 0) "root-init failed: $($rInit.Stdout) $($rInit.Stderr)"

  $currentUserSid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  # Frozen allowlist (PLAN.md ~L1504): current user/owner (full control) plus,
  # when present, S-1-5-18 (LocalSystem) and S-1-5-32-544 (Administrators) --
  # and NO other named principal. Deliberately NOT padded with any other
  # commonly-inherited SID (e.g. BUILTIN\Users, CREATOR OWNER) -- if the real
  # windows-latest runner's inherited ACL includes one, this MUST show up as a
  # genuine, informative failure rather than being silently allowlisted away.
  $allowedSids = @($currentUserSid, 'S-1-5-18', 'S-1-5-32-544')

  $acl = Get-Acl -LiteralPath $root
  $ownerSid = ([System.Security.Principal.NTAccount]::new($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  Assert-True ($ownerSid -eq $currentUserSid) "ACL owner on $root is not the current user SID"
  Assert-True ($acl.AreAccessRulesProtected -eq $true) "ACL on $root still inherits access rules"
  $violations = @()
  $currentUserFullControl = $false
  foreach ($ace in $acl.Access) {
    $sid = $null
    try {
      $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
      $sid = $ace.IdentityReference.Value
    }
    if ($ace.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
      $violations += "non-allow ACE: $($ace.IdentityReference) ($sid) $($ace.AccessControlType)"
    } elseif ($allowedSids -notcontains $sid) {
      $violations += "$($ace.IdentityReference) ($sid)"
    }
    if ($sid -eq $currentUserSid -and (($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)) {
      $currentUserFullControl = $true
    }
  }
  Assert-True ($violations.Count -eq 0) "ACL on $root contains non-allowlisted principal(s): $($violations -join '; ')"
  Assert-True $currentUserFullControl "ACL on $root does not grant current user FullControl"

  $rValidate = Invoke-Wrapper -CliArgs @('root-validate', '--coordination-root', $root) -EnvVars $capEnv
  Assert-True ($rValidate.ExitCode -eq 0) "root-validate failed: $($rValidate.Stdout) $($rValidate.Stderr)"
  Assert-CliResult -Stdout $rValidate.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null
}

# ─────────────────────────────────────────────────────────────────────────────
# Racer helper for W11/W12 -- launches TWO REAL node processes (per this task's
# own dispatch wording: "two Node processes"), back-to-back with no
# intervening work as the "barrier", waits for both, returns both results.
# ─────────────────────────────────────────────────────────────────────────────

function Invoke-TwoRacerNodeProcesses {
  param([Parameter(Mandatory)][string[]]$CliArgs, [hashtable]$EnvVars = @{})
  $script:InvocationCounter++
  $tag = $script:InvocationCounter
  $out1 = Join-Path $WorkRoot ("racer-{0}-1.out" -f $tag); $err1 = Join-Path $WorkRoot ("racer-{0}-1.err" -f $tag)
  $out2 = Join-Path $WorkRoot ("racer-{0}-2.out" -f $tag); $err2 = Join-Path $WorkRoot ("racer-{0}-2.err" -f $tag)
  $args1 = Add-OneShotGrant -CliArgs $CliArgs -EnvVars $EnvVars
  $args2 = Add-OneShotGrant -CliArgs $CliArgs -EnvVars $EnvVars
  $run1 = Start-CapturedProcess -FilePath 'node' -ArgumentList (@($ImplPath) + $args1) -EnvVars $EnvVars
  $run2 = Start-CapturedProcess -FilePath 'node' -ArgumentList (@($ImplPath) + $args2) -EnvVars $EnvVars
  $run1.Process.WaitForExit()
  $run2.Process.WaitForExit()
  $stdout1 = $run1.Stdout.GetAwaiter().GetResult(); $stderr1 = $run1.Stderr.GetAwaiter().GetResult()
  $stdout2 = $run2.Stdout.GetAwaiter().GetResult(); $stderr2 = $run2.Stderr.GetAwaiter().GetResult()
  [IO.File]::WriteAllText($out1, $stdout1); [IO.File]::WriteAllText($err1, $stderr1)
  [IO.File]::WriteAllText($out2, $stdout2); [IO.File]::WriteAllText($err2, $stderr2)
  $r1 = [pscustomobject]@{ ExitCode = $run1.Process.ExitCode; Stdout = $stdout1; Stderr = $stderr1 }
  $r2 = [pscustomobject]@{ ExitCode = $run2.Process.ExitCode; Stdout = $stdout2; Stderr = $stderr2 }
  $run1.Process.Dispose(); $run2.Process.Dispose()
  return @($r1, $r2)
}

# ══════════════════════════════════════════════════════════════════════════
# W11 multiprocess transition lock (PLAN.md ~L1507; Race section ~L1429-1435;
# SC-9) -- two REAL node processes race one fresh .lock/ (exactly one
# acquires, the live holder is never reclaimed), plus a SEPARATE orphan-lock
# sub-case (bounded timeout+STOP, never age-reclaim).
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W11a two node processes race the same fresh .lock/: exactly one publishes cancel.json, the other observes it already cancelled' -Body {
  $fixture = New-PublishedRequestFixture -Suffix 'w11a' -Question 'W11 live-holder race'
  $reqPath = $fixture.RequestPath
  $reqDir = Split-Path -Parent $reqPath
  $coordRoot = $fixture.CoordinationRoot
  $capEnv = $fixture.CapabilityEnv
  $cliArgs = @('cancel', '--coordination-root', $coordRoot, '--request', $reqPath, '--reason', 'explicit')
  $racers = Invoke-TwoRacerNodeProcesses -CliArgs $cliArgs -EnvVars $capEnv

  $winners = @($racers | Where-Object { $_.ExitCode -eq 0 })
  $losers = @($racers | Where-Object { $_.ExitCode -ne 0 })
  Assert-True ($winners.Count -eq 1) "expected exactly one winner (rc0), got $($winners.Count) of 2. r1=$($racers[0].ExitCode)/$($racers[0].Stdout) r2=$($racers[1].ExitCode)/$($racers[1].Stdout)"
  Assert-True ($losers.Count -eq 1) "expected exactly one loser (nonzero rc), got $($losers.Count) of 2"
  Assert-CliResult -Stdout $winners[0].Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null
  # The loser enters its OWN critical section only after the winner released
  # the lock, observes cancel.json already published, and is rejected as an
  # already-cancelled transaction -- never a silent second success, never a
  # corrupted/merged write.
  Assert-CliResult -Stdout $losers[0].Stdout -ExpectedStatus 'CANCELLED' -ExpectedDetail 'TRANSACTION_CANCELLED' | Out-Null

  $lockDir = Join-Path $reqDir '.lock'
  Assert-True (-not (Test-Path $lockDir)) "the .lock/ directory was not cleaned up after both racers completed: $lockDir"
}

Invoke-Case -Name 'W11b node: an orphan .lock/ (pre-created, never released) causes a bounded TIMEOUT/STOP, never an age-based reclaim' -Body {
  $fixture = New-PublishedRequestFixture -Suffix 'w11b' -Question 'W11 orphan lock'
  $reqPath = $fixture.RequestPath
  $reqDir = Split-Path -Parent $reqPath
  $coordRoot = $fixture.CoordinationRoot
  # Simulates an abandoned/crashed lock holder: pre-create .lock/ ourselves; it
  # is never released by anyone in this test.
  $lockDir = Join-Path $reqDir '.lock'
  New-Item -ItemType Directory -Force -Path $lockDir | Out-Null

  $capEnv = $fixture.CapabilityEnv
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-NodeDirect -CliArgs @('cancel', '--coordination-root', $coordRoot, '--request', $reqPath, '--reason', 'explicit') -EnvVars $capEnv
  $sw.Stop()

  # acquireLock()'s Date.now() ALWAYS reads the real wall clock -- a
  # deliberate, source-commented exception to --fixed-clock -- and
  # LOCK_MAX_WAIT_MS is a real 1200ms constant, so this is a genuine ~1.2s
  # wait built into the primitive itself, not an artificial sleep this test
  # inserted. Loose bounds below account for timer-granularity slop and a
  # generous hang-guard.
  Assert-True ($sw.ElapsedMilliseconds -ge 1000) "orphan-lock acquisition returned too fast ($($sw.ElapsedMilliseconds)ms) to have gone through the bounded ~1200ms wait"
  Assert-True ($sw.ElapsedMilliseconds -lt 30000) "orphan-lock acquisition took $($sw.ElapsedMilliseconds)ms -- looks like a hang, not a bounded timeout"

  # WP2-verdict fix (cascade from this cycle's test-specialist dispatch): acquireLock's
  # transition-lock timeout now names the specific DEADLINE_EXCEEDED literal instead of
  # the old bare NONE (mirrors the same closed-detail_code-on-failure rule already
  # enforced for await-result's own TIMEOUT case). CI-only file -- this edit is a
  # source-read-verified assertion correction, not empirically re-run against pwsh here.
  Assert-CliResult -Stdout $r.Stdout -ExpectedStatus 'TIMEOUT' -ExpectedDetail 'DEADLINE_EXCEEDED' | Out-Null
  Assert-True (Test-Path $lockDir) "the pre-existing orphan .lock/ was removed/reclaimed by the failed acquirer -- it must remain exactly as it was (no age-based reclaim): $lockDir"
}

# ══════════════════════════════════════════════════════════════════════════
# W12 multiprocess no-clobber + durability (PLAN.md ~L1508; SC-9/17) -- two
# REAL node processes race `claim`'s publishNoClobber() write to the SAME
# claims/<attempt_id>.json target (deterministic via --fixed-ids --fixed-clock,
# so both racers construct byte-identical payloads and the ONLY question is
# link order): exactly one wins, loser EEXIST/AUTHORITY_INVALID, winner
# durable at nlink==1.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W12 two node processes race the no-clobber publish primitive via claim: exactly one wins whole, loser EEXIST/AUTHORITY_INVALID, winner durable at nlink==1' -Body {
  $fixture = New-PublishedRequestFixture -Suffix 'w12' -Question 'W12 no-clobber race'
  $coordRoot = $fixture.CoordinationRoot
  $reqPath = $fixture.RequestPath
  $reqDir = Split-Path -Parent $reqPath
  $requestFixture = Get-Content -Raw -Encoding utf8 -LiteralPath $reqPath | ConvertFrom-Json
  $fixedHexAttempt = $requestFixture.initial_attempt_id
  $capEnv = $fixture.CapabilityEnv
  $dispatch = Invoke-Wrapper -CliArgs @('dispatch', '--coordination-root', $coordRoot, '--request', $reqPath) -EnvVars $capEnv
  Assert-True ($dispatch.ExitCode -eq 0) "W12 dispatch failed: $($dispatch.Stdout) $($dispatch.Stderr)"
  $cliArgs = @('claim', '--coordination-root', $coordRoot, '--request', $reqPath, '--role', 'arch-testing')
  $racers = Invoke-TwoRacerNodeProcesses -CliArgs $cliArgs -EnvVars $capEnv

  $winners = @($racers | Where-Object { $_.ExitCode -eq 0 })
  $losers = @($racers | Where-Object { $_.ExitCode -ne 0 })
  Assert-True ($winners.Count -eq 1) "expected exactly one winner (rc0), got $($winners.Count) of 2. r1=$($racers[0].ExitCode)/$($racers[0].Stdout) r2=$($racers[1].ExitCode)/$($racers[1].Stdout)"
  Assert-True ($losers.Count -eq 1) "expected exactly one loser (nonzero rc), got $($losers.Count) of 2"
  $winnerParsed = Assert-CliResult -Stdout $winners[0].Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE'
  Assert-CliResult -Stdout $losers[0].Stdout -ExpectedStatus 'INVALID' -ExpectedDetail 'AUTHORITY_INVALID' | Out-Null

  $claimPath = $winnerParsed.artifact_ref
  Assert-True (Test-Path $claimPath) "winning claim artifact missing: $claimPath"
  $claimObj = Get-Content -Raw -Encoding utf8 -Path $claimPath | ConvertFrom-Json
  Assert-True ($claimObj.attempt_id -ceq $fixedHexAttempt) 'winning claim attempt_id does not match the fixture initial_attempt_id'

  # nlink==1 post-race, via a genuine Windows-native mechanism (fsutil
  # hardlink list enumerates every hard link sharing the same file record) --
  # proves "nlink1 implies barrier-1-durable target". NOTE (uncertainty this
  # file flags explicitly): the transient nlink==2 window itself is NOT
  # independently observable from this external, unsynchronized vantage point
  # -- that would need in-process instrumentation inside the node source,
  # which is out of this single-owned file's scope.
  $claimPathNative = [IO.Path]::GetFullPath(([string]$claimPath).Replace('/', '\'))
  Assert-True (Test-Path -LiteralPath $claimPathNative -PathType Leaf) "winning claim path does not resolve before fsutil: raw=$claimPath native=$claimPathNative"
  Assert-True ($claimPathNative.Length -gt 260) "W12 canonical claim path did not cross legacy MAX_PATH: length=$($claimPathNative.Length) path=$claimPathNative"
  $claimsDir = Split-Path -Parent $claimPathNative
  # fsutil itself still uses legacy path parsing for this subcommand. The
  # canonical transaction path is intentionally >260 chars, so expose the
  # same claims directory through one short, verified, temporary junction;
  # fsutil still enumerates the underlying file's real volume-relative name.
  $publicRootW12 = [IO.Path]::GetFullPath((Join-Path $env:SystemDrive 'Users\Public'))
  $junctionPath = [IO.Path]::GetFullPath((Join-Path $publicRootW12 ('w12-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
  Assert-True ((Split-Path -Parent $junctionPath) -eq $publicRootW12) 'W12 junction escaped its exact temporary parent'
  $hardlinkOutput = @()
  $hardlinkExit = -1
  try {
    New-Item -ItemType Junction -Path $junctionPath -Target $claimsDir -ErrorAction Stop | Out-Null
    $fsutilClaimPath = Join-Path $junctionPath (Split-Path -Leaf $claimPathNative)
    $hardlinkOutput = & fsutil hardlink list $fsutilClaimPath 2>&1
    $hardlinkExit = $LASTEXITCODE
  } finally {
    if (Test-Path -LiteralPath $junctionPath) { Remove-Item -LiteralPath $junctionPath -Force -ErrorAction Stop }
  }
  Assert-True ($hardlinkExit -eq 0) "fsutil hardlink list failed for $claimPathNative with exit $hardlinkExit`: $($hardlinkOutput -join ' | ')"
  $hardlinkLines = @($hardlinkOutput | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  Assert-True ($hardlinkLines.Count -eq 1) "expected exactly one hard link (nlink==1) for the winning claim file, fsutil reported $($hardlinkLines.Count): $($hardlinkLines -join ' | ')"
  $expectedClaimPath = $claimPathNative
  $reportedClaimPath = ([string]$hardlinkLines[0]).Trim()
  if ($reportedClaimPath.StartsWith('\')) { $reportedClaimPath = ([IO.Path]::GetPathRoot($expectedClaimPath)).TrimEnd('\') + $reportedClaimPath }
  $reportedClaimPath = [IO.Path]::GetFullPath($reportedClaimPath)
  Assert-True ([string]::Equals($reportedClaimPath, $expectedClaimPath, [StringComparison]::OrdinalIgnoreCase)) "fsutil's sole hardlink is not the exact winning claim path: expected=$expectedClaimPath actual=$reportedClaimPath"

  # Production-consumer cross-check: `validate --kind claim-v1` itself calls
  # assertDurable() (stat.nlink !== 1 => DURABILITY_UNPROVEN) -- if the winning
  # file were ever left in a non-durable state, THIS is the real reader that
  # would reject it, not just this test's own fsutil probe.
  $rValidate = Invoke-NodeDirect -CliArgs @('validate', '--coordination-root', $coordRoot, '--kind', 'claim-v1', '--artifact', $claimPath) -EnvVars $capEnv
  Assert-True ($rValidate.ExitCode -eq 0) "validate --kind claim-v1 rejected the winning claim artifact: $($rValidate.Stdout) $($rValidate.Stderr)"
  Assert-CliResult -Stdout $rValidate.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  # No leftover .tmp-owner temp files from either racer (the winner unlinks its
  # own temp after barrier 1; the loser's catch-block unlinks its temp
  # immediately on EEXIST).
  $leftoverTemps = @(Get-ChildItem -LiteralPath $claimsDir -Filter '*.tmp-owner*' -ErrorAction Stop)
  Assert-True ($leftoverTemps.Count -eq 0) "leftover no-clobber temp file(s) found in $claimsDir : $($leftoverTemps.Name -join ', ')"
}

# ══════════════════════════════════════════════════════════════════════════
# WP3-dependent families -- explicit, greppable skips. Each names the exact
# missing WP3 feature (verified by reading the full current source, not
# assumed) so a future task can un-skip it once that feature lands. Never
# faked/worked around.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W07b deterministic backend/frontend attach reuses one supervisor, owner, scheduler and PID identity; replay is rejected' -Body {
  $gitRoot = New-GitFixtureRoot -Suffix 'w07b-deterministic-bridge'
  $fixtureLib = Join-Path $gitRoot 'scripts\lib'
  $fixtureSetupTemplates = Join-Path $gitRoot 'setup\agent-templates'
  $fixtureClaudeAgents = Join-Path $gitRoot '.claude\agents'
  New-Item -ItemType Directory -Force -Path $fixtureLib, $fixtureSetupTemplates, $fixtureClaudeAgents | Out-Null
  Copy-Item -Recurse -Force -Path (Join-Path $RepoRoot 'scripts\lib\*') -Destination $fixtureLib
  Copy-Item -Recurse -Force -Path (Join-Path $RepoRoot 'setup\agent-templates\*') -Destination $fixtureSetupTemplates
  Copy-Item -Recurse -Force -Path (Join-Path $RepoRoot '.claude\agents\*') -Destination $fixtureClaudeAgents
  $fixtureBridgePath = Join-Path $fixtureLib 'runtime-bridge-codex.cjs'
  $publicRoot = [IO.Path]::GetFullPath((Join-Path $env:SystemDrive 'Users\Public'))
  $w07bPrivateTemp = [IO.Path]::GetFullPath((Join-Path $publicRoot ('w7-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
  Assert-True ((Split-Path -Parent $w07bPrivateTemp) -eq $publicRoot) 'W07b private temp escaped the intended public parent'
  New-Item -ItemType Directory -Path $w07bPrivateTemp | Out-Null
  $coordRoot = Join-Path $gitRoot '.planning\coordination'
  $capEnv = Get-DefaultCapabilityEnv
  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $coordRoot) -EnvVars $capEnv
  Assert-True ($rInit.ExitCode -eq 0) "W07b root-init failed: $($rInit.Stdout) $($rInit.Stderr)"

  $planPath = New-PlanFixtureFile -GitRoot $gitRoot -WaveSlug 'ps1-w07b'
  $bundlePath = Join-Path $gitRoot '.planning\subject-bundle-w07b.json'
  New-SubjectBundleManifestFile -Path $bundlePath | Out-Null
  $expiry = Get-IsoTimestamp -OffsetSeconds 600
  $intent = New-IntentBase64Url -TargetRole 'verifier' -Question 'W07b deterministic frontend attach' -ExpectedResultKind 'PS1_WINDOWS_FIXTURE' -Expiry $expiry
  $rPublish = Invoke-Wrapper -CliArgs @(
    'publish-request', '--coordination-root', $coordRoot, '--plan', $planPath,
    '--subject-bundle', $bundlePath, '--intent', $intent
  ) -EnvVars $capEnv
  Assert-True ($rPublish.ExitCode -eq 0) "W07b publish-request failed: $($rPublish.Stdout) $($rPublish.Stderr)"
  $requestPath = (Assert-CliResult -Stdout $rPublish.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE').artifact_ref

  $action = New-SupervisorStartAction -ProjectRoot $gitRoot -Role 'verifier' -PrivateTemp $w07bPrivateTemp
  $sessionArgs = @($action.payload.bridge_argv | Select-Object -Skip 1) + @('--test-backend', 'deterministic-app-server-v1')
  $bridgeEnv = @{
    NODE_ENV = 'test'
    NODE_OPTIONS = "--require=$PrivateRegistryPreloadPath"
    ANDROID_COMMON_DOC_TEST_PRIVATE_REGISTRY_ROOT = $w07bPrivateTemp
    RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = 'ps1-w07b-bridge-capability'
    RUNTIME_CONSULTATION_TEST_CAPABILITY = $TestCapability
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'ps1-w07b-lifecycle-capability'
    RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = 'ps1-w07b-batch-ready-capability'
    TEMP = $w07bPrivateTemp
    TMP = $w07bPrivateTemp
    TMPDIR = $w07bPrivateTemp
  }
  # Execute the immutable action's own resolved Node and bridge paths. The
  # fixture copy is byte-identical but intentionally has a different path;
  # using it here would correctly fail the production argv/path correlation.
  $session = Start-CapturedProcess -FilePath ([string]$action.payload.bridge_argv[0]) -ArgumentList $sessionArgs -EnvVars $bridgeEnv
  try {
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $descriptorFiles = @()
    do {
      $descriptorFiles = @(Get-ChildItem -LiteralPath $w07bPrivateTemp -Recurse -File -Filter 'deterministic-mcp-loopback.json' -ErrorAction SilentlyContinue)
      if ($descriptorFiles.Count -eq 1) { break }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $readyDeadline -and -not $session.Process.HasExited)
    if ($descriptorFiles.Count -ne 1) {
      $sessionStatus = if ($session.Process.HasExited) { "exited:$($session.Process.ExitCode)" } else { 'running' }
      $sessionStdout = if ($session.Process.HasExited) { $session.Stdout.GetAwaiter().GetResult() } else { '' }
      $sessionStderr = if ($session.Process.HasExited) { $session.Stderr.GetAwaiter().GetResult() } else { '' }
      throw "W07b supervisor did not publish exactly one READY loopback descriptor; found $($descriptorFiles.Count); session=$sessionStatus stdout=$sessionStdout stderr=$sessionStderr"
    }

    $frontend = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      $frontend = Invoke-ChildProcess -FilePath 'node' -ArgumentList @(
        ([string]$action.payload.bridge_argv[1]), 'claude-mcp-launch', '--coordination-root', $coordRoot,
        '--request', $requestPath, '--test-frontend', 'deterministic-mcp-client-v1'
      ) -EnvVars $bridgeEnv
      if ($frontend.ExitCode -eq 0) { break }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline -and -not $session.Process.HasExited)
    if ($frontend.ExitCode -ne 0) {
      $sessionStatus = if ($session.Process.HasExited) { "exited:$($session.Process.ExitCode)" } else { 'running' }
      $sessionStdout = if ($session.Process.HasExited) { $session.Stdout.GetAwaiter().GetResult() } else { '' }
      $sessionStderr = if ($session.Process.HasExited) { $session.Stderr.GetAwaiter().GetResult() } else { '' }
      $txnTree = @(Get-ChildItem -LiteralPath (Split-Path -Parent $requestPath) -Recurse -Force | ForEach-Object { $_.FullName.Substring((Split-Path -Parent $requestPath).Length) }) -join '|'
      $activationDebug = @(Get-ChildItem -LiteralPath (Join-Path (Split-Path -Parent $requestPath) 'activations') -File -Filter '*.json' | ForEach-Object { Get-Content -Raw -Encoding utf8 -LiteralPath $_.FullName }) -join '|'
      throw "deterministic frontend never attached: $($frontend.Stdout) $($frontend.Stderr); session=$sessionStatus stdout=$sessionStdout stderr=$sessionStderr txn=$txnTree activation=$activationDebug"
    }
    $attached = $frontend.Stdout | ConvertFrom-Json -ErrorAction Stop
    Assert-True ($attached.schema -eq 'coordination/bridge-result/v1') 'W07b frontend returned the wrong schema'
    Assert-True ($attached.command -eq 'claude-mcp-launch' -and $attached.ok -eq $true) 'W07b frontend did not report claude-mcp-launch success'
    Assert-True ($attached.reason -eq 'deterministic-mcp-rendezvous-attached') 'W07b frontend returned the wrong attach reason'
    Assert-True ((@($attached.PSObject.Properties.Name | Sort-Object) -join ',') -eq 'artifact_ref,child_instance_id,child_pid_identity,command,ok,reason,result_attempt_id,result_sha256,schema,supervisor_instance_id,worker_session_id') 'W07b frontend output is not closed or contains self-reported spawn/scheduler fields'
    Assert-True ($attached.supervisor_instance_id -match '^[a-f0-9]{32,}$') 'W07b supervisor identity is absent'
    Assert-True ($attached.worker_session_id -match '^[a-f0-9]{32,}$') 'W07b worker session identity is absent'
    Assert-True ($attached.child_instance_id -eq $attached.worker_session_id) 'W07b child instance and worker session do not identify the same retained child'
    Assert-True ($null -ne ($attached.child_pid_identity.pid -as [long]) -and [long]$attached.child_pid_identity.pid -gt 0) 'W07b child PID identity is absent'
    Assert-True ([long]$attached.child_pid_identity.pid -ne [long]$session.Process.Id) 'W07b substituted the supervisor PID for the backend child PID'
    Assert-True (-not [string]::IsNullOrWhiteSpace($attached.child_pid_identity.executable)) 'W07b child executable identity is absent'
    Assert-True (-not [string]::IsNullOrWhiteSpace($attached.child_pid_identity.birth_observed_at)) 'W07b child birth identity is absent'
    Assert-True ($null -ne (Get-Process -Id ([long]$attached.child_pid_identity.pid) -ErrorAction Stop)) 'W07b child PID is not live after the rendezvous'

    $artifact = Get-Content -Raw -Encoding utf8 -LiteralPath $attached.artifact_ref | ConvertFrom-Json
    Assert-True ($artifact.schema -eq 'coordination/deterministic-mcp-rendezvous/v2') 'W07b evidence is not v2'
    Assert-True ((@($artifact.PSObject.Properties.Name | Sort-Object) -join ',') -eq 'child_instance_id,child_pid_identity,child_record_sha256,completed_at,expected_result_kind,loopback_host,loopback_port,nonce,request_id,request_sha256,result_attempt_id,result_content,result_sha256,schema,supervisor_instance_id,worker_session_id') 'W07b evidence is not closed or contains self-reported spawn/scheduler fields'
    Assert-True ($artifact.worker_session_id -eq $attached.worker_session_id) 'W07b artifact worker-session correlation mismatch'
    Assert-True ($artifact.supervisor_instance_id -eq $attached.supervisor_instance_id) 'W07b artifact supervisor correlation mismatch'
    Assert-True ($artifact.child_pid_identity.pid -eq $attached.child_pid_identity.pid) 'W07b artifact child PID correlation mismatch'
    Assert-True ($artifact.result_content -eq 'deterministic-answer:PS1_WINDOWS_FIXTURE') 'W07b did not observe the deterministic backend answer through the canonical result chain'
    Assert-True ($artifact.loopback_host -eq '127.0.0.1' -and [int]$artifact.loopback_port -gt 0) 'W07b did not prove a real loopback exchange'

    $instanceRecords = @(Get-ChildItem -LiteralPath $w07bPrivateTemp -Recurse -File -Filter '*.json' | Where-Object { $_.Directory.Name -eq 'instances' })
    Assert-True ($instanceRecords.Count -eq 1) "W07b expected exactly one retained BORN child record, found $($instanceRecords.Count)"
    $childRecord = Get-Content -Raw -Encoding utf8 -LiteralPath $instanceRecords[0].FullName | ConvertFrom-Json
    Assert-True ($childRecord.instance_id -eq $attached.child_instance_id) 'W07b evidence does not identify the independently discovered BORN record'
    Assert-True ([long]$childRecord.pid -eq [long]$attached.child_pid_identity.pid) 'W07b evidence PID does not match the independently discovered BORN record'
    Assert-True ($childRecord.process_kind -eq 'app-server-worker' -and $childRecord.driver -eq 'codex-app-server') 'W07b BORN record is not the supervised app-server child'

    # The lifecycle registry is user-private at every authority-bearing level,
    # not merely at whichever leaf happened to be written last. The shared
    # test-private registry container may contain several principals, so
    # confinement begins at this run's single hashed-principal directory.
    $runtimeContainer = Join-Path $w07bPrivateTemp 'registry'
    $principalDirs = @(Get-ChildItem -LiteralPath $runtimeContainer -Directory -ErrorAction Stop)
    Assert-True ($principalDirs.Count -eq 1) "W07b expected one runtime principal directory, found $($principalDirs.Count)"
    $registryDirs = @($principalDirs[0]) + @(Get-ChildItem -LiteralPath $principalDirs[0].FullName -Directory -Recurse -ErrorAction Stop)
    $currentSid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
    $allowedRegistrySids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($registryDir in $registryDirs) {
      $registryAcl = Get-Acl -LiteralPath $registryDir.FullName
      if ($registryDir.FullName -eq $principalDirs[0].FullName) {
        Assert-True $registryAcl.AreAccessRulesProtected "runtime registry principal boundary still inherits ACLs: $($registryDir.FullName)"
      }
      $registryOwnerSid = ([System.Security.Principal.NTAccount]::new($registryAcl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
      Assert-True ($registryOwnerSid -eq $currentSid) "runtime registry directory has the wrong owner: $($registryDir.FullName) $registryOwnerSid"
      foreach ($ace in $registryAcl.Access) {
        $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        Assert-True ($ace.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) "runtime registry contains a non-Allow ACE: $($registryDir.FullName) $sid"
        Assert-True ($allowedRegistrySids -contains $sid) "runtime registry contains a disallowed SID: $($registryDir.FullName) $sid"
      }
    }

    $replay = Invoke-ChildProcess -FilePath 'node' -ArgumentList @(
      ([string]$action.payload.bridge_argv[1]), 'claude-mcp-launch', '--coordination-root', $coordRoot,
      '--request', $requestPath, '--test-frontend', 'deterministic-mcp-client-v1'
    ) -EnvVars $bridgeEnv
    Assert-True ($replay.ExitCode -eq 3) "W07b replay expected rc3, got $($replay.ExitCode)"
    Assert-True ($replay.Stderr.Contains('deterministic-mcp-rendezvous-replay')) "W07b replay did not emit the sealed rejection reason: $($replay.Stdout) $($replay.Stderr)"
  } finally {
    if (-not $session.Process.HasExited) { $session.Process.Kill($true) }
    [void]$session.Process.WaitForExit(5000)
    $session.Process.Dispose()
    if ((Split-Path -Parent ([IO.Path]::GetFullPath($w07bPrivateTemp))) -eq $publicRoot) {
      Remove-Item -LiteralPath $w07bPrivateTemp -Recurse -Force -ErrorAction Stop
    }
  }
}

Invoke-Case -Name 'W10a ACL-insecure: Everyone SID full-control grant is rejected fail-closed by production root-validate' -Body {
  $root = New-GitFixtureRoot -Suffix 'w10a-acl-insecure'
  $capEnv = Get-DefaultCapabilityEnv
  $rInit = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $root) -EnvVars $capEnv
  Assert-True ($rInit.ExitCode -eq 0) "root-init failed before W10a ACL mutation: $($rInit.Stdout) $($rInit.Stderr)"

  $aclMutation = Invoke-ChildProcess -FilePath 'icacls.exe' -ArgumentList @(
    $root, '/grant', '*S-1-1-0:(OI)(CI)F'
  )
  Assert-True ($aclMutation.ExitCode -eq 0) "icacls failed to install the deterministic Everyone SID fixture: $($aclMutation.Stdout) $($aclMutation.Stderr)"

  $worldSid = 'S-1-1-0'
  $observedWorld = $false
  foreach ($ace in (Get-Acl -LiteralPath $root).Access) {
    try {
      if ($ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $worldSid) {
        $observedWorld = $true
      }
    } catch { }
  }
  Assert-True $observedWorld 'W10a fixture invalid: Get-Acl did not observe the Everyone SID after icacls succeeded'

  # The capability-gated cross-platform seam must never suppress the native
  # Windows SID/DACL check. Even while it claims "linux", process.platform is
  # still authoritative for security and the world ACE remains rejected.
  $forcedPlatformEnv = Get-DefaultCapabilityEnv -Extra @{
    RUNTIME_CONSULTATION_FORCE_PLATFORM = 'linux'
  }
  $rValidate = Invoke-Wrapper -CliArgs @('root-validate', '--coordination-root', $root) -EnvVars $forcedPlatformEnv
  Assert-True ($rValidate.ExitCode -ne 0) 'production accepted an Everyone-writable shared coordination root'
  Assert-CliResult -Stdout $rValidate.Stdout -ExpectedStatus 'INVALID' -ExpectedDetail 'SECURITY_INVALID' | Out-Null
}

Invoke-Case -Name 'W10b ACL-unverifiable: production reports indeterminate and disables sibling/shared-root use fail-closed' -Body {
  $root = New-GitFixtureRoot -Suffix 'w10b-acl-unverifiable'
  $baseEnv = Get-DefaultCapabilityEnv
  $rInit = Invoke-Wrapper -CliArgs @(
    'root-init', '--coordination-root', $root, '--fixed-ids', '--fixed-clock'
  ) -EnvVars $baseEnv
  Assert-True ($rInit.ExitCode -eq 0) "root-init failed before W10b probe: $($rInit.Stdout) $($rInit.Stderr)"

  $probeEnv = Get-DefaultCapabilityEnv -Extra @{
    RUNTIME_CONSULTATION_ACL_PROBE = 'unverifiable'
  }
  $missingFixedClock = Invoke-Wrapper -CliArgs @(
    'root-validate', '--coordination-root', $root, '--fixed-ids'
  ) -EnvVars $probeEnv
  Assert-True ($missingFixedClock.ExitCode -eq 3) 'ACL probe seam was accepted without both fixed flags'
  Assert-CliResult -Stdout $missingFixedClock.Stdout -ExpectedStatus 'INVALID' -ExpectedDetail 'INVALID_ARGUMENT' | Out-Null

  $rValidate = Invoke-Wrapper -CliArgs @(
    'root-validate', '--coordination-root', $root, '--fixed-ids', '--fixed-clock'
  ) -EnvVars $probeEnv
  Assert-True ($rValidate.ExitCode -ne 0) 'production treated an unverifiable ACL as confined/shared-root-capable'
  Assert-CliResult -Stdout $rValidate.Stdout -ExpectedStatus 'INVALID' -ExpectedDetail 'SECURITY_INVALID' | Out-Null
}

# ─────────────────────────────────────────────────────────────────────────────
# Summary + exit -- non-zero exit iff any REAL (non-skipped) case failed.
# ─────────────────────────────────────────────────────────────────────────────

try {
  Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction Stop
} catch {
  $script:FailCount++
  $script:TestResults += [pscustomobject]@{ Result = 'FAIL'; Name = 'Harness cleanup removes the exact private work root'; Message = $_.Exception.Message }
}

Write-Host ''
Write-Host '==================== runtime-consultation-windows.ps1 SUMMARY ===================='
foreach ($r in $script:TestResults) {
  Write-Host ("{0,-6} {1}" -f $r.Result, $r.Name)
  if ($r.Result -eq 'FAIL') { Write-Host ("       -> {0}" -f $r.Message) }
}
Write-Host '====================================================================================='
Write-Host "PASS=$script:PassCount FAIL=$script:FailCount SKIP=$script:SkipCount TOTAL=$($script:TestResults.Count)"

if ($script:FailCount -gt 0 -or $script:SkipCount -gt 0) {
  Write-Host 'RESULT: FAIL'
  exit 1
} else {
  Write-Host 'RESULT: PASS'
  exit 0
}
