#!/usr/bin/env pwsh
#
# runtime-bridge-codex-windows.ps1 -- REAL, EXECUTABLE Windows coverage for the
# three new win32 ACL validate-mode checks being added to
# scripts/lib/runtime-bridge-codex.cjs (readProtectedHostCodexPin,
# validatePinnedCodexExecutable, readOwnedStableBuffer), closing the coverage
# gap arch-platform's NO-GO verdict flagged for this Wave (portable-runtime-
# messaging-adapters): scripts/tests/runtime-consultation-windows.ps1 is
# rigorous (real icacls.exe-planted ACLs, real Get-Acl confirmation, real pwsh
# execution on windows-latest CI) but is scoped only to runtime-
# consultation.cjs's CLI surface and never touches runtime-bridge-codex.cjs.
#
# THIS FILE RUNS ONLY ON windows-latest CI VIA A REAL pwsh INTERPRETER (same
# convention as its sibling: pwsh -NoLogo -NoProfile -NonInteractive -File
# scripts/tests/runtime-bridge-codex-windows.ps1), via a NEW
# runtime-bridge-codex-windows.yml reusable workflow mirroring runtime-
# consultation-windows.yml (see that file's own header for the general
# rationale for a real, executing Windows leg rather than a static parity
# check). Authored on the same host as its sibling and locally executed there
# against the actual pwsh 7.6.4 interpreter present on that host (unlike its
# sibling, which was never locally executable) -- see this file's own report
# for what that local run did and did not prove.
#
# RED-FIRST, PER PROJECT CONVENTION (true as of authoring, HEAD 60236c2): none
# of the three target functions has a `module.exports.__testOnly*` entry yet
# -- the full bottom-of-file `if (isTestCapability()) {...}` block was read in
# full (scripts/lib/runtime-bridge-codex.cjs L18879-18922) to confirm this --
# and the win32 branch for each of the three sites currently only SKIPS the
# pre-existing POSIX-only mode-bit check (`process.platform !== 'win32' &&
# ...`) with NO replacement Windows ACL check yet -- i.e. today, Windows gets
# NO directory-confinement enforcement at any of the three sites. Every ACCEPT
# and REJECT case below is written precisely against the frozen reason codes
# this task's own dispatch specifies and the actual (fully read) current
# source, but is EXPECTED TO FAIL TODAY for the right reason (the three
# `__testOnly*` exports are absent) -- not a mock, not a hollow pass. The
# three required test-only exports (toolkit-specialist's companion dispatch
# owns adding them, inside the existing `if (isTestCapability()) {...}` block,
# same convention as every other entry there):
#   module.exports.__testOnlyReadProtectedHostCodexPin = readProtectedHostCodexPin;
#   module.exports.__testOnlyValidatePinnedCodexExecutable = validatePinnedCodexExecutable;
#   module.exports.__testOnlyReadOwnedStableBuffer = readOwnedStableBuffer;
# (The three PLATFORM/structural cases below do NOT depend on these exports --
# they read raw source text -- so they can pass before the other six do; see
# the PLATFORM CASE note below for why that is expected and not a hollow
# pass.)
#
# ASSUMPTION (flagged per this task's own dispatch instruction -- confirm
# against toolkit-specialist's actual companion dispatch before treating
# Site1 as fully green): Site1 (readProtectedHostCodexPin) derives its
# ~/.codex path from `os.homedir()` with no parameter, so it needs its own
# test-only override seam to be pointed at a fixture directory. This file is
# written against the exact seam name this task's own dispatch proposes:
#   isTestCapability() && a non-empty process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME
# overrides the os.homedir() base, matching this file's existing double-gate
# convention for its other test seams (RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY
# itself, RUNTIME_BRIDGE_CODEX_TEST_PLATFORM, RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY
# -- all confirmed present in the current source). If toolkit-specialist lands
# a different literal env var name, Site1's three cases below need a one-line
# rename, nothing structural.
# Sites 2/3 (validatePinnedCodexExecutable, readOwnedStableBuffer) take their
# target path directly as a function argument/parameter and need no such seam
# -- this file constructs a fixture path itself and passes it straight
# through.
#
# INVOCATION: all three targets are internal functions, never CLI subcommands
# (confirmed by reading the file's `main()` dispatch and its unconditional
# `module.exports` object -- neither names any of the three) -- so this file
# never spawns the bridge as a CLI child. Instead it runs a tiny, per-function
# `node -e` snippet (same idiom as this suite family's own
# $script:GrantMintScript in runtime-consultation-windows.ps1) that
# `require()`s the real scripts/lib/runtime-bridge-codex.cjs, invokes the
# real `__testOnly*`-exported function with real arguments, and prints its
# real return value as one JSON line -- so the ACL logic under test is the
# actual production function body, never a reimplementation. readOwnedStableBuffer
# returns lstat fields as BigInt (fs.lstatSync(..., {bigint:true})); the
# invocation scripts below use a JSON.stringify replacer that stringifies
# BigInt rather than letting JSON.stringify throw on it.
#
# REASON CODES (per this task's dispatch, cross-checked against the current
# source's own existing literals):
#   Site1 readProtectedHostCodexPin      -> CODEX_CONFIG_DIR_INSECURE
#     (existing reason, currently returned by the POSIX-only mode-bit check on
#     `configDir` = path.join(os.homedir(), '.codex') -- distinct from the
#     file-level CODEX_CONFIG_FILE_INSECURE, which is out of this task's
#     scope)
#   Site2 validatePinnedCodexExecutable  -> CODEX_CLI_PATH_INSECURE
#     (existing reason, currently returned by the POSIX-only mode-bit check on
#     the pinned executable's OWN stat; this task's dispatch describes the new
#     win32 check as a "target directory" check, so this file targets
#     path.dirname(pinnedPath) -- the directory CONTAINING the pinned
#     executable -- not the executable file itself, which has no directory of
#     its own to misconfigure)
#   Site3 readOwnedStableBuffer          -> CREDENTIAL_SOURCE_DIR_INSECURE
#     (brand-new reason -- readOwnedStableBuffer currently has NO directory-
#     level check at all, only file-level mode/owner/nlink checks such as
#     CREDENTIAL_SOURCE_MODE_INVALID, unaffected/out of this task's scope;
#     this file targets path.dirname(filePath) -- the directory containing the
#     credential source file)
#
# PLATFORM CASE (c), per site -- WHY STRUCTURAL, NOT DYNAMIC: all three sites'
# existing POSIX-only checks are gated by raw `process.platform !== 'win32'`,
# never this file's own fakeable `resolveObservedPlatform()` /
# RUNTIME_BRIDGE_CODEX_TEST_PLATFORM seam (confirmed by reading each function
# body in full) -- deliberately, the same principle runtime-consultation-
# windows.ps1's own W10a case already documents ("process.platform is still
# authoritative for security" even when a seam claims otherwise). That means
# there is no honest way to dynamically fake "not win32" for these three
# checks from a real windows-latest host without reopening exactly the bypass
# W10a already guards against -- and this file can never physically execute on
# a real POSIX host either. So case (c) below is a REAL (non-mocked) but
# STRUCTURAL proof: it reads the actual on-disk scripts/lib/runtime-bridge-
# codex.cjs for real, on the CI host, and asserts the named function's own
# source text still references `process.platform` and still contains the
# pre-existing POSIX-relevant reason-code literal (i.e. the win32 addition
# extended the function rather than clobbering its POSIX branch). This is the
# same kind of technique this suite family already names explicitly elsewhere
# ("Structural (non-executing) parity note", runtime-consultation-windows.ps1's
# own header / runtime-consultation-windows.bats) rather than a new
# invention, and it is clearly distinguished here from cases (a)/(b), which
# are 100% real dynamic execution against real icacls.exe-planted ACLs --
# never a mock/stub standing in for the real Windows ACL API. Because the
# guard text and reason-code literals already exist pre-toolkit-specialist's
# change (confirmed by reading), these three structural cases are expected to
# PASS TODAY, unlike the six ACCEPT/REJECT cases -- they function as a
# regression guard against accidentally deleting the platform-scoping or the
# reason code while adding the new ACL logic, not as a RED-today proof of the
# new logic itself (see this file's own local-run report for confirmation of
# exactly this split).
#
# Invocation: pwsh -NoLogo -NoProfile -NonInteractive -File
#   scripts/tests/runtime-bridge-codex-windows.ps1

param([string]$CasePattern = '*')

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ─────────────────────────────────────────────────────────────────────────────
# Global paths / constants
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BridgeImplPath = (Resolve-Path (Join-Path $PSScriptRoot '..\lib\runtime-bridge-codex.cjs')).Path

# "Harness-created" test capability (same rationale as runtime-consultation-
# windows.ps1's own $TestCapability) -- a value distinct from every other
# suite's own TEST_CAPABILITY constant so suite-of-origin is obvious in any
# shared CI log output.
$TestCapability = 'ps1-runtime-bridge-codex-windows-fixture-capability'

$WorkRoot = Join-Path ([IO.Path]::GetTempPath()) ("rbcw-ps1-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$script:PassCount = 0
$script:FailCount = 0
$script:SkipCount = 0
$script:TestResults = @()

# ─────────────────────────────────────────────────────────────────────────────
# Generic fixture / process helpers -- copied verbatim (same proven behavior)
# from runtime-consultation-windows.ps1's own New-Ps1TestTempDir /
# Invoke-ChildProcess / Assert-True / Get-DefaultCapabilityEnv / Invoke-Case /
# Skip-Case, minus everything that file needs only for the frozen CLI ABI
# (git fixtures, role-lifecycle grant minting, the .ps1/.sh wrapper
# invokers, the CLI-result envelope asserters) -- this file never spawns the
# bridge as a CLI child, so none of that applies here.
# ─────────────────────────────────────────────────────────────────────────────

function New-Ps1TestTempDir {
  param([Parameter(Mandatory)][string]$Suffix)
  $dir = Join-Path $WorkRoot $Suffix
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

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
  # an empty array result to $null, which would silently corrupt downstream
  # byte/string handling.
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

function Assert-True {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Get-DefaultCapabilityEnv {
  param([hashtable]$Extra = @{})
  $env = @{ NODE_ENV = 'test'; RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = $TestCapability }
  foreach ($k in $Extra.Keys) { $env[$k] = $Extra[$k] }
  return $env
}

# TOCTOU fix (arch-platform verdict): windowsPrivateDirectoryAcl lives in
# runtime-consultation.cjs, a SEPARATE module from runtime-bridge-codex.cjs,
# with its own isTestCapability() gate keyed on RUNTIME_CONSULTATION_TEST_CAPABILITY
# -- distinct from this file's own RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY above.
# Confirmed with toolkit-specialist-toctou (module-scoped call counter keyed by
# resolvedPaths.join('|') inside windowsPrivateDirectoryAcl; on the 2nd+ call
# for the same resolved path within the process, RUNTIME_CONSULTATION_TEST_ACL_SNAPSHOT_DRIFT=1
# appends the allowlisted SID 'S-1-5-18' to that already-normalized ok:true
# result's ace_sids -- self-consistent, ok:true/disallowed_sids/non_allow_count/
# current_full_control all stay clean, only windowsAclSnapshotsEqual's own
# ace_sids content-diff catches it). Both capability env vars are REQUIRED
# together: without RUNTIME_CONSULTATION_TEST_CAPABILITY the drift seam never
# activates and a MISMATCH case would silently exercise plain production
# behavior instead (both probes agree, no rejection) -- a false green, not a
# real one.
function Get-AclSnapshotDriftEnv {
  param([hashtable]$Extra = @{})
  $env = Get-DefaultCapabilityEnv
  $env['RUNTIME_CONSULTATION_TEST_CAPABILITY'] = $TestCapability
  $env['RUNTIME_CONSULTATION_TEST_ACL_SNAPSHOT_DRIFT'] = '1'
  foreach ($k in $Extra.Keys) { $env[$k] = $Extra[$k] }
  return $env
}

# ─────────────────────────────────────────────────────────────────────────────
# Real Windows ACL fixture helpers -- real icacls.exe to plant, real Get-Acl
# (independent of icacls's own exit code) to confirm the fixture actually
# took effect before ever invoking production. Mirrors runtime-consultation-
# windows.ps1's own W09 (owner-confined allowlist assertion) and W10a
# (Everyone SID fixture, planted via icacls.exe then independently confirmed
# via Get-Acl) exactly.
# ─────────────────────────────────────────────────────────────────────────────

function Set-OwnerConfinedDirectoryAcl {
  param([Parameter(Mandatory)][string]$Path)
  $currentUserSid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  $r = Invoke-ChildProcess -FilePath 'icacls.exe' -ArgumentList @(
    $Path, '/inheritance:r', '/grant:r', ('*' + $currentUserSid + ':(OI)(CI)F')
  )
  Assert-True ($r.ExitCode -eq 0) "icacls failed to plant an owner-confined ACL on $Path : $($r.Stdout) $($r.Stderr)"
}

# Independent Get-Acl confirmation for the owner-confined fixture -- never
# trusts icacls's own exit code alone. Mirrors W09's own allowlist-of-current-
# user-only assertion.
function Assert-OwnerConfinedAcl {
  param([Parameter(Mandatory)][string]$Path)
  $currentUserSid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  $acl = Get-Acl -LiteralPath $Path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  Assert-True ($ownerSid -eq $currentUserSid) "fixture invalid: ACL owner on $Path is not the current user SID"
  Assert-True ($acl.AreAccessRulesProtected -eq $true) "fixture invalid: ACL on $Path still inherits access rules after /inheritance:r"
  foreach ($ace in $acl.Access) {
    $sid = $null
    try { $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $sid = $ace.IdentityReference.Value }
    Assert-True ($sid -eq $currentUserSid) "fixture invalid: unexpected principal $($ace.IdentityReference) ($sid) present on $Path after planting an owner-confined ACL"
  }
}

function Set-EveryoneFullControlDirectoryAcl {
  param([Parameter(Mandatory)][string]$Path)
  # Mirrors runtime-consultation-windows.ps1's own W10a fixture exactly:
  # additive grant of the World SID, object+container inherit, never a
  # replacement of the owner's own entry.
  $r = Invoke-ChildProcess -FilePath 'icacls.exe' -ArgumentList @($Path, '/grant', '*S-1-1-0:(OI)(CI)F')
  Assert-True ($r.ExitCode -eq 0) "icacls failed to install the deterministic Everyone SID fixture on $Path : $($r.Stdout) $($r.Stderr)"
}

function Assert-EveryoneAcePresent {
  param([Parameter(Mandatory)][string]$Path)
  $worldSid = 'S-1-1-0'
  $observedWorld = $false
  foreach ($ace in (Get-Acl -LiteralPath $Path).Access) {
    try {
      if ($ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $worldSid) { $observedWorld = $true }
    } catch { }
  }
  Assert-True $observedWorld "fixture invalid: Get-Acl did not independently observe the Everyone SID on $Path after icacls reported success"
}

# ─────────────────────────────────────────────────────────────────────────────
# Real invocation of the actual production functions, via a tiny per-function
# `node -e` snippet that require()s the real scripts/lib/runtime-bridge-codex.cjs
# and calls the real __testOnly*-exported function directly -- never a
# reimplementation of the ACL/stat logic under test. Each script fails loudly
# (nonzero exit, stderr message) if the expected export is absent, rather than
# silently returning a false pass -- the correct RED-today behavior.
# ─────────────────────────────────────────────────────────────────────────────

$script:Site1InvokeScript = @'
'use strict';
const mod = require(process.argv[1]);
const fn = mod.__testOnlyReadProtectedHostCodexPin;
if (typeof fn !== 'function') {
  process.stderr.write('export-missing:__testOnlyReadProtectedHostCodexPin\n');
  process.exit(1);
}
let result;
try {
  result = fn();
} catch (err) {
  process.stderr.write('threw:' + String((err && err.stack) || err) + '\n');
  process.exit(1);
}
const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
process.stdout.write(JSON.stringify(result === undefined ? null : result, replacer) + '\n');
'@

$script:Site2InvokeScript = @'
'use strict';
const mod = require(process.argv[1]);
const pinnedPath = process.argv[2];
const fn = mod.__testOnlyValidatePinnedCodexExecutable;
if (typeof fn !== 'function') {
  process.stderr.write('export-missing:__testOnlyValidatePinnedCodexExecutable\n');
  process.exit(1);
}
let result;
try {
  result = fn(pinnedPath);
} catch (err) {
  process.stderr.write('threw:' + String((err && err.stack) || err) + '\n');
  process.exit(1);
}
const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
process.stdout.write(JSON.stringify(result === undefined ? null : result, replacer) + '\n');
'@

$script:Site3InvokeScript = @'
'use strict';
const mod = require(process.argv[1]);
const filePath = process.argv[2];
const maxBytes = Number.parseInt(process.argv[3], 10);
const fn = mod.__testOnlyReadOwnedStableBuffer;
if (typeof fn !== 'function') {
  process.stderr.write('export-missing:__testOnlyReadOwnedStableBuffer\n');
  process.exit(1);
}
let result;
try {
  result = fn(filePath, maxBytes);
} catch (err) {
  process.stderr.write('threw:' + String((err && err.stack) || err) + '\n');
  process.exit(1);
}
const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
process.stdout.write(JSON.stringify(result === undefined ? null : result, replacer) + '\n');
'@

# Site 4 (r2ReadOwnedAuthFileSecurely) is NOT one of the original 3 sites this
# file's header documents -- it is a brand-new site added for TOCTOU coverage
# only (arch-platform verdict), reusing the __testOnlyR2ReadOwnedAuthFileSecurely
# export that already exists (confirmed by direct read of scripts/lib/
# runtime-bridge-codex.cjs:18945) rather than adding a new one. Single-argument
# invocation only (filePath) -- this function takes no maxBytes parameter.
$script:Site4InvokeScript = @'
'use strict';
const mod = require(process.argv[1]);
const filePath = process.argv[2];
const fn = mod.__testOnlyR2ReadOwnedAuthFileSecurely;
if (typeof fn !== 'function') {
  process.stderr.write('export-missing:__testOnlyR2ReadOwnedAuthFileSecurely\n');
  process.exit(1);
}
let result;
try {
  result = fn(filePath);
} catch (err) {
  process.stderr.write('threw:' + String((err && err.stack) || err) + '\n');
  process.exit(1);
}
const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
process.stdout.write(JSON.stringify(result === undefined ? null : result, replacer) + '\n');
'@

# Real (non-mocked) structural source-scan for the PLATFORM case -- see the
# file header's "PLATFORM CASE (c)" note for why this is a source-text proof
# rather than a dynamic one. Isolates the named top-level function's own body
# by finding its `function <name>(` declaration line (column 0, this file's
# own established style throughout runtime-bridge-codex.cjs) through the next
# column-0 `}` line, then checks for substrings within that isolated body
# only -- never a whole-file scan, so a coincidental match elsewhere in this
# 18000+ line file cannot produce a false pass. Extended (TOCTOU snapshot-
# mismatch coverage, arch-platform verdict) with a third field,
# hasSnapshotCompare, reused by the new SNAPSHOT cases below -- same
# isolated-body text, no separate scan.
$script:StructuralPlatformScopeScript = @'
'use strict';
const fs = require('fs');
const bridgePath = process.argv[1];
const functionName = process.argv[2];
const posixReasonLiteral = process.argv[3];
const source = fs.readFileSync(bridgePath, 'utf8');
const lines = source.split(/\r?\n/);
const startIdx = lines.findIndex((line) => line.startsWith('function ' + functionName + '('));
if (startIdx < 0) {
  process.stderr.write('function-not-found:' + functionName + '\n');
  process.exit(1);
}
let endIdx = -1;
for (let i = startIdx + 1; i < lines.length && i - startIdx <= 500; i++) {
  if (lines[i] === '}') { endIdx = i; break; }
}
if (endIdx < 0) {
  process.stderr.write('function-end-not-found-within-500-lines:' + functionName + '\n');
  process.exit(1);
}
const body = lines.slice(startIdx, endIdx + 1).join('\n');
const result = {
  ok: true,
  functionName,
  bodyLineCount: (endIdx - startIdx) + 1,
  hasPlatformGuard: body.indexOf('process.platform') >= 0,
  hasPosixReason: body.indexOf(posixReasonLiteral) >= 0,
  // TOCTOU fix (arch-platform verdict): the new before/after ACL-snapshot
  // re-validation compares two windowsPrivateDirectoryAcl probes via this
  // shared comparator -- its presence in a target function's own body is the
  // structural signal the re-validation was actually wired in, not merely
  // that the pre-existing single-probe check remains.
  hasSnapshotCompare: body.indexOf('windowsAclSnapshotsEqual') >= 0,
};
process.stdout.write(JSON.stringify(result) + '\n');
'@

function Invoke-Site1 {
  param([hashtable]$EnvVars = @{})
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList @('-e', $script:Site1InvokeScript, $BridgeImplPath) -EnvVars $EnvVars
}

function Invoke-Site2 {
  param([Parameter(Mandatory)][string]$PinnedPath, [hashtable]$EnvVars = @{})
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList @('-e', $script:Site2InvokeScript, $BridgeImplPath, $PinnedPath) -EnvVars $EnvVars
}

function Invoke-Site3 {
  param([Parameter(Mandatory)][string]$FilePath, [Parameter(Mandatory)][int]$MaxBytes, [hashtable]$EnvVars = @{})
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList @('-e', $script:Site3InvokeScript, $BridgeImplPath, $FilePath, [string]$MaxBytes) -EnvVars $EnvVars
}

function Invoke-Site4 {
  param([Parameter(Mandatory)][string]$FilePath, [hashtable]$EnvVars = @{})
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList @('-e', $script:Site4InvokeScript, $BridgeImplPath, $FilePath) -EnvVars $EnvVars
}

function Invoke-StructuralScan {
  param([Parameter(Mandatory)][string]$FunctionName, [Parameter(Mandatory)][string]$PosixReasonLiteral)
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList @('-e', $script:StructuralPlatformScopeScript, $BridgeImplPath, $FunctionName, $PosixReasonLiteral)
}

# ─────────────────────────────────────────────────────────────────────────────
# Assertion helpers for the {ok,reason,...} shape all three target functions
# return.
# ─────────────────────────────────────────────────────────────────────────────

function Assert-BridgeInvocationOk {
  param([Parameter(Mandatory)][object]$Result, [Parameter(Mandatory)][string]$Context)
  Assert-True ($Result.ExitCode -eq 0) "$Context invocation failed (exit $($Result.ExitCode)): $($Result.Stderr)"
  $data = $null
  try { $data = $Result.Stdout | ConvertFrom-Json -ErrorAction Stop } catch { throw "$Context stdout is not valid JSON: $($_.Exception.Message) -- raw: $($Result.Stdout)" }
  Assert-True ($null -ne $data -and $data.ok -eq $true) "$Context expected ok:true, got: $($Result.Stdout)"
  return $data
}

function Assert-BridgeInvocationRejected {
  param([Parameter(Mandatory)][object]$Result, [Parameter(Mandatory)][string]$Context, [Parameter(Mandatory)][string]$ExpectedReason)
  Assert-True ($Result.ExitCode -eq 0) "$Context invocation failed to return a clean ok:false (exit $($Result.ExitCode)): $($Result.Stderr)"
  $data = $null
  try { $data = $Result.Stdout | ConvertFrom-Json -ErrorAction Stop } catch { throw "$Context stdout is not valid JSON: $($_.Exception.Message) -- raw: $($Result.Stdout)" }
  Assert-True ($null -ne $data -and $data.ok -eq $false) "$Context expected ok:false, got: $($Result.Stdout)"
  Assert-True ($data.reason -eq $ExpectedReason) "$Context expected reason $ExpectedReason got $($data.reason) (full: $($Result.Stdout))"
  return $data
}

# ─────────────────────────────────────────────────────────────────────────────
# Test harness -- pass/fail/skip tally, TAP-ish summary, non-zero exit on any
# real (non-skipped) failure OR any skip (mirrors runtime-consultation-
# windows.ps1's own harness exactly: a skip is never silent). This file
# deliberately never calls Skip-Case -- every one of the cases below is
# always real and always runs on windows-latest; Skip-Case is kept only for
# structural parity with the harness convention this whole suite family
# shares.
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
# Site 1: readProtectedHostCodexPin -- os.homedir()-derived ~/.codex directory
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'Site1 ACCEPT: readProtectedHostCodexPin proceeds past the new win32 ~/.codex directory ACL check when the directory is owner-confined' -Body {
  $fakeHome = New-Ps1TestTempDir -Suffix 'site1-accept'
  $codexDir = Join-Path $fakeHome '.codex'
  New-Item -ItemType Directory -Force -Path $codexDir | Out-Null
  Set-OwnerConfinedDirectoryAcl -Path $codexDir
  Assert-OwnerConfinedAcl -Path $codexDir
  # Forward slashes only -- the production regex that parses this line
  # (`[^"\\\r\n]+` inside the quoted value) rejects backslashes outright, so a
  # native-style `C:\...` value would make this fixture malformed rather than
  # exercising the ACL check this case targets.
  $pinnedPath = 'C:/pinned/codex.exe'
  "CODEX_CLI_PATH = `"$pinnedPath`"`n" | Set-Content -NoNewline -Encoding utf8 -Path (Join-Path $codexDir 'config.toml')

  $envVars = Get-DefaultCapabilityEnv -Extra @{ RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = $fakeHome }
  $r = Invoke-Site1 -EnvVars $envVars
  $data = Assert-BridgeInvocationOk -Result $r -Context 'Site1 ACCEPT'
  Assert-True ($data.configured -eq $true) "Site1 ACCEPT expected configured:true, got: $($r.Stdout)"
  Assert-True ($data.path -ceq $pinnedPath) "Site1 ACCEPT expected path $pinnedPath got $($data.path)"
}

Invoke-Case -Name 'Site1 REJECT: readProtectedHostCodexPin rejects an Everyone-writable ~/.codex directory with CODEX_CONFIG_DIR_INSECURE and never trusts the (otherwise valid) file content' -Body {
  $fakeHome = New-Ps1TestTempDir -Suffix 'site1-reject'
  $codexDir = Join-Path $fakeHome '.codex'
  New-Item -ItemType Directory -Force -Path $codexDir | Out-Null
  # Content is well-formed and WOULD be accepted (see the ACCEPT case above)
  # if the directory ACL check were bypassed -- proves the rejection below is
  # genuinely gated by the ACL check, not incidentally caused by bad content.
  $pinnedPath = 'C:/pinned/codex.exe'
  "CODEX_CLI_PATH = `"$pinnedPath`"`n" | Set-Content -NoNewline -Encoding utf8 -Path (Join-Path $codexDir 'config.toml')
  Set-EveryoneFullControlDirectoryAcl -Path $codexDir
  Assert-EveryoneAcePresent -Path $codexDir

  $envVars = Get-DefaultCapabilityEnv -Extra @{ RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = $fakeHome }
  $r = Invoke-Site1 -EnvVars $envVars
  $data = Assert-BridgeInvocationRejected -Result $r -Context 'Site1 REJECT' -ExpectedReason 'CODEX_CONFIG_DIR_INSECURE'
  Assert-True ($null -eq $data.path) "Site1 REJECT must never surface the pinned path once the directory ACL is rejected -- got: $($r.Stdout)"
}

Invoke-Case -Name 'Site1 PLATFORM (structural, real source read): the win32 ~/.codex directory check is source-scoped by process.platform; the pre-existing POSIX CODEX_CONFIG_DIR_INSECURE reason remains textually present and reachable' -Body {
  $r = Invoke-StructuralScan -FunctionName 'readProtectedHostCodexPin' -PosixReasonLiteral 'CODEX_CONFIG_DIR_INSECURE'
  Assert-True ($r.ExitCode -eq 0) "structural scan failed: $($r.Stderr)"
  $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop
  Assert-True ($data.hasPlatformGuard -eq $true) 'readProtectedHostCodexPin no longer references process.platform -- the win32/POSIX split appears to have been removed'
  Assert-True ($data.hasPosixReason -eq $true) 'readProtectedHostCodexPin no longer contains CODEX_CONFIG_DIR_INSECURE in its own body -- the POSIX-reachable branch appears to have been deleted rather than extended'
}

Invoke-Case -Name 'Site1 SNAPSHOT (structural, real source read; RED-first pre-fix): readProtectedHostCodexPin re-probes the ~/.codex directory ACL a second time after the read and compares it via windowsAclSnapshotsEqual -- proves the TOCTOU before/after re-validation (arch-platform verdict) is actually wired in, not just the original single-probe gate' -Body {
  $r = Invoke-StructuralScan -FunctionName 'readProtectedHostCodexPin' -PosixReasonLiteral 'CODEX_CONFIG_DIR_INSECURE'
  Assert-True ($r.ExitCode -eq 0) "structural scan failed: $($r.Stderr)"
  $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop
  Assert-True ($data.hasSnapshotCompare -eq $true) 'readProtectedHostCodexPin does not yet reference windowsAclSnapshotsEqual in its own body -- the TOCTOU before/after ACL re-validation (arch-platform verdict) is not wired in yet'
}

Invoke-Case -Name 'Site1 MISMATCH (RED-first pre-fix): readProtectedHostCodexPin rejects with CODEX_CONFIG_DIR_CHANGED_DURING_READ when the ~/.codex directory ACL differs between the win32 pre-read probe and the new post-read re-probe, even though both probes individually observe an owner-confined ACL' -Body {
  $fakeHome = New-Ps1TestTempDir -Suffix 'site1-mismatch'
  $codexDir = Join-Path $fakeHome '.codex'
  New-Item -ItemType Directory -Force -Path $codexDir | Out-Null
  Set-OwnerConfinedDirectoryAcl -Path $codexDir
  Assert-OwnerConfinedAcl -Path $codexDir
  $pinnedPath = 'C:/pinned/codex.exe'
  "CODEX_CLI_PATH = `"$pinnedPath`"`n" | Set-Content -NoNewline -Encoding utf8 -Path (Join-Path $codexDir 'config.toml')

  $envVars = Get-AclSnapshotDriftEnv -Extra @{ RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = $fakeHome }
  $r = Invoke-Site1 -EnvVars $envVars
  $data = Assert-BridgeInvocationRejected -Result $r -Context 'Site1 MISMATCH' -ExpectedReason 'CODEX_CONFIG_DIR_CHANGED_DURING_READ'
  Assert-True ($null -eq $data.path) "Site1 MISMATCH must never surface the pinned path once the post-read ACL re-probe disagrees with the pre-read probe -- got: $($r.Stdout)"
}

# ══════════════════════════════════════════════════════════════════════════
# Site 2: validatePinnedCodexExecutable -- the directory CONTAINING the
# pinned CLI executable (path.dirname(pinnedPath)), passed directly as an
# argument -- no test-only path-resolution seam needed.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'Site2 ACCEPT: validatePinnedCodexExecutable proceeds past the new win32 containing-directory ACL check when the directory is owner-confined' -Body {
  $binDir = New-Ps1TestTempDir -Suffix 'site2-accept'
  $exePath = Join-Path $binDir 'codex.exe'
  'not-a-real-binary-fixture-marker' | Set-Content -NoNewline -Encoding utf8 -Path $exePath
  Set-OwnerConfinedDirectoryAcl -Path $binDir
  Assert-OwnerConfinedAcl -Path $binDir

  $r = Invoke-Site2 -PinnedPath $exePath -EnvVars (Get-DefaultCapabilityEnv)
  $data = Assert-BridgeInvocationOk -Result $r -Context 'Site2 ACCEPT'
  Assert-True ($data.command -ceq $exePath) "Site2 ACCEPT expected command $exePath got $($data.command)"
  # PLAN.md ~L921's frozen production spawn args (DEFAULT_APP_SERVER_SPAWN_ARGS) --
  # asserted verbatim since the file's own comment documents this array as frozen.
  $expectedArgs = @('app-server', '--listen', 'stdio://', '--strict-config')
  $actualArgs = @($data.args)
  Assert-True (($actualArgs -join '|') -eq ($expectedArgs -join '|')) "Site2 ACCEPT expected frozen spawn args $($expectedArgs -join ',') got $($actualArgs -join ',')"
}

Invoke-Case -Name 'Site2 REJECT: validatePinnedCodexExecutable rejects a pinned executable whose containing directory is Everyone-writable with CODEX_CLI_PATH_INSECURE' -Body {
  $binDir = New-Ps1TestTempDir -Suffix 'site2-reject'
  $exePath = Join-Path $binDir 'codex.exe'
  'not-a-real-binary-fixture-marker' | Set-Content -NoNewline -Encoding utf8 -Path $exePath
  Set-EveryoneFullControlDirectoryAcl -Path $binDir
  Assert-EveryoneAcePresent -Path $binDir

  $r = Invoke-Site2 -PinnedPath $exePath -EnvVars (Get-DefaultCapabilityEnv)
  Assert-BridgeInvocationRejected -Result $r -Context 'Site2 REJECT' -ExpectedReason 'CODEX_CLI_PATH_INSECURE' | Out-Null
}

Invoke-Case -Name 'Site2 PLATFORM (structural, real source read): the win32 containing-directory check is source-scoped by process.platform; the pre-existing POSIX CODEX_CLI_PATH_INSECURE reason remains textually present and reachable' -Body {
  $r = Invoke-StructuralScan -FunctionName 'validatePinnedCodexExecutable' -PosixReasonLiteral 'CODEX_CLI_PATH_INSECURE'
  Assert-True ($r.ExitCode -eq 0) "structural scan failed: $($r.Stderr)"
  $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop
  Assert-True ($data.hasPlatformGuard -eq $true) 'validatePinnedCodexExecutable no longer references process.platform -- the win32/POSIX split appears to have been removed'
  Assert-True ($data.hasPosixReason -eq $true) 'validatePinnedCodexExecutable no longer contains CODEX_CLI_PATH_INSECURE in its own body -- the POSIX-reachable branch appears to have been deleted rather than extended'
}

# ══════════════════════════════════════════════════════════════════════════
# Site 3: readOwnedStableBuffer -- the directory CONTAINING the credential
# source file (path.dirname(filePath)), passed directly as an argument -- no
# test-only path-resolution seam needed. Unlike Sites 1/2, this function has
# NO pre-existing directory-level check at all (only file-level mode/owner/
# nlink); CREDENTIAL_SOURCE_DIR_INSECURE is a brand-new reason. The PLATFORM
# case below therefore checks for the pre-existing FILE-level POSIX reason
# (CREDENTIAL_SOURCE_MODE_INVALID) remaining intact, not a POSIX directory
# equivalent -- there isn't one to compare against.
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'Site3 ACCEPT: readOwnedStableBuffer proceeds past the new win32 containing-directory ACL check when the directory is owner-confined' -Body {
  $credsDir = New-Ps1TestTempDir -Suffix 'site3-accept'
  $credsPath = Join-Path $credsDir 'auth.json'
  $marker = 'site3-accept-marker-' + [Guid]::NewGuid().ToString('N')
  $marker | Set-Content -NoNewline -Encoding utf8 -Path $credsPath
  Set-OwnerConfinedDirectoryAcl -Path $credsDir
  Assert-OwnerConfinedAcl -Path $credsDir

  $r = Invoke-Site3 -FilePath $credsPath -MaxBytes 65536 -EnvVars (Get-DefaultCapabilityEnv)
  $data = Assert-BridgeInvocationOk -Result $r -Context 'Site3 ACCEPT'
  Assert-True ($data.text -ceq $marker) "Site3 ACCEPT expected text $marker got $($data.text)"
}

Invoke-Case -Name 'Site3 REJECT: readOwnedStableBuffer rejects a credential file whose containing directory is Everyone-writable with CREDENTIAL_SOURCE_DIR_INSECURE and never reads/leaks the (otherwise valid) file content' -Body {
  $credsDir = New-Ps1TestTempDir -Suffix 'site3-reject'
  $credsPath = Join-Path $credsDir 'auth.json'
  $marker = 'site3-reject-marker-' + [Guid]::NewGuid().ToString('N')
  $marker | Set-Content -NoNewline -Encoding utf8 -Path $credsPath
  Set-EveryoneFullControlDirectoryAcl -Path $credsDir
  Assert-EveryoneAcePresent -Path $credsDir

  $r = Invoke-Site3 -FilePath $credsPath -MaxBytes 65536 -EnvVars (Get-DefaultCapabilityEnv)
  $data = Assert-BridgeInvocationRejected -Result $r -Context 'Site3 REJECT' -ExpectedReason 'CREDENTIAL_SOURCE_DIR_INSECURE'
  Assert-True ($null -eq $data.text) "Site3 REJECT must never surface file content once the directory ACL is rejected -- got: $($r.Stdout)"
}

Invoke-Case -Name 'Site3 PLATFORM (structural, real source read): the new win32 containing-directory check is source-scoped by process.platform; the pre-existing POSIX CREDENTIAL_SOURCE_MODE_INVALID (file-level) reason remains textually present and reachable' -Body {
  $r = Invoke-StructuralScan -FunctionName 'readOwnedStableBuffer' -PosixReasonLiteral 'CREDENTIAL_SOURCE_MODE_INVALID'
  Assert-True ($r.ExitCode -eq 0) "structural scan failed: $($r.Stderr)"
  $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop
  Assert-True ($data.hasPlatformGuard -eq $true) 'readOwnedStableBuffer no longer references process.platform -- the win32/POSIX split appears to have been removed'
  Assert-True ($data.hasPosixReason -eq $true) 'readOwnedStableBuffer no longer contains CREDENTIAL_SOURCE_MODE_INVALID in its own body -- the pre-existing POSIX file-level check appears to have been deleted rather than left in place alongside the new directory check'
}

Invoke-Case -Name 'Site3 SNAPSHOT (structural, real source read; RED-first pre-fix): readOwnedStableBuffer re-probes the containing directory ACL a second time after the read and compares it via windowsAclSnapshotsEqual -- proves the TOCTOU before/after re-validation (arch-platform verdict) is actually wired in, not just the original single-probe gate' -Body {
  $r = Invoke-StructuralScan -FunctionName 'readOwnedStableBuffer' -PosixReasonLiteral 'CREDENTIAL_SOURCE_MODE_INVALID'
  Assert-True ($r.ExitCode -eq 0) "structural scan failed: $($r.Stderr)"
  $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop
  Assert-True ($data.hasSnapshotCompare -eq $true) 'readOwnedStableBuffer does not yet reference windowsAclSnapshotsEqual in its own body -- the TOCTOU before/after ACL re-validation (arch-platform verdict) is not wired in yet'
}

Invoke-Case -Name 'Site3 MISMATCH (RED-first pre-fix): readOwnedStableBuffer rejects with CREDENTIAL_SOURCE_DIR_CHANGED_DURING_READ when the containing directory ACL differs between the win32 pre-read probe and the new post-read re-probe, even though both probes individually observe an owner-confined ACL' -Body {
  $credsDir = New-Ps1TestTempDir -Suffix 'site3-mismatch'
  $credsPath = Join-Path $credsDir 'auth.json'
  $marker = 'site3-mismatch-marker-' + [Guid]::NewGuid().ToString('N')
  $marker | Set-Content -NoNewline -Encoding utf8 -Path $credsPath
  Set-OwnerConfinedDirectoryAcl -Path $credsDir
  Assert-OwnerConfinedAcl -Path $credsDir

  $r = Invoke-Site3 -FilePath $credsPath -MaxBytes 65536 -EnvVars (Get-AclSnapshotDriftEnv)
  $data = Assert-BridgeInvocationRejected -Result $r -Context 'Site3 MISMATCH' -ExpectedReason 'CREDENTIAL_SOURCE_DIR_CHANGED_DURING_READ'
  Assert-True ($null -eq $data.text) "Site3 MISMATCH must never surface file content once the post-read ACL re-probe disagrees with the pre-read probe -- got: $($r.Stdout)"
}

# ══════════════════════════════════════════════════════════════════════════
# Site 4: r2ReadOwnedAuthFileSecurely -- NOT one of the original 3 sites this
# file's header documents; a brand-new site added for TOCTOU coverage only
# (arch-platform verdict). Takes the auth file path directly as its sole
# argument (no maxBytes) and probes path.dirname(filePath), same as Site3.
# This function returns bare {ok:false} on every failure path (no reason
# field anywhere in its own body, confirmed by direct read) -- so unlike
# Sites 1-3 there is no ACCEPT/REJECT/PLATFORM trio here, only the structural
# SNAPSHOT case (there is no POSIX reason literal to assert either, since
# none exists in this function -- PosixReasonLiteral is passed as an empty
# string, which trivially satisfies hasPosixReason and is deliberately never
# asserted on below).
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'Site4 SNAPSHOT (structural, real source read; RED-first pre-fix): r2ReadOwnedAuthFileSecurely re-probes the containing directory ACL a second time after the read and compares it via windowsAclSnapshotsEqual -- proves the TOCTOU before/after re-validation (arch-platform verdict) is actually wired in, not just the original single-probe gate' -Body {
  # 'r2ReadOwnedAuthFileSecurely-has-no-posix-reason-literal' is an inert
  # sentinel, not a real reason code -- Invoke-StructuralScan's own shared
  # PosixReasonLiteral parameter is Mandatory+[string], which real pwsh
  # (confirmed by local run) rejects for an empty string at the parameter-
  # binding stage before this case's body ever executes. This function has no
  # POSIX reason literal to check (see the Site 4 section header above), so
  # the resulting hasPosixReason field is deliberately never asserted below.
  $r = Invoke-StructuralScan -FunctionName 'r2ReadOwnedAuthFileSecurely' -PosixReasonLiteral 'r2ReadOwnedAuthFileSecurely-has-no-posix-reason-literal'
  Assert-True ($r.ExitCode -eq 0) "structural scan failed: $($r.Stderr)"
  $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop
  Assert-True ($data.hasSnapshotCompare -eq $true) 'r2ReadOwnedAuthFileSecurely does not yet reference windowsAclSnapshotsEqual in its own body -- the TOCTOU before/after ACL re-validation (arch-platform verdict) is not wired in yet'
}

Invoke-Case -Name 'Site4 MISMATCH (RED-first pre-fix): r2ReadOwnedAuthFileSecurely rejects with a bare ok:false when the containing directory ACL differs between the win32 pre-read probe and the new post-read re-probe, even though both probes individually observe an owner-confined ACL' -Body {
  $credsDir = New-Ps1TestTempDir -Suffix 'site4-mismatch'
  $credsPath = Join-Path $credsDir 'auth.json'
  $marker = 'site4-mismatch-marker-' + [Guid]::NewGuid().ToString('N')
  $marker | Set-Content -NoNewline -Encoding utf8 -Path $credsPath
  Set-OwnerConfinedDirectoryAcl -Path $credsDir
  Assert-OwnerConfinedAcl -Path $credsDir

  $r = Invoke-Site4 -FilePath $credsPath -EnvVars (Get-AclSnapshotDriftEnv)
  Assert-True ($r.ExitCode -eq 0) "Site4 MISMATCH invocation failed to return a clean ok:false (exit $($r.ExitCode)): $($r.Stderr)"
  $data = $null
  try { $data = $r.Stdout | ConvertFrom-Json -ErrorAction Stop } catch { throw "Site4 MISMATCH stdout is not valid JSON: $($_.Exception.Message) -- raw: $($r.Stdout)" }
  Assert-True ($null -ne $data -and $data.ok -eq $false) "Site4 MISMATCH expected ok:false, got: $($r.Stdout)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Summary + exit -- non-zero exit iff any REAL (non-skipped) case failed, or
# any case was skipped (mirrors runtime-consultation-windows.ps1's own
# harness: a skip is never silent).
# ─────────────────────────────────────────────────────────────────────────────

try {
  Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction Stop
} catch {
  $script:FailCount++
  $script:TestResults += [pscustomobject]@{ Result = 'FAIL'; Name = 'Harness cleanup removes the exact private work root'; Message = $_.Exception.Message }
}

Write-Host ''
Write-Host '==================== runtime-bridge-codex-windows.ps1 SUMMARY ===================='
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
