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
#   RUNTIME_CONSULTATION_ACL_PROBE=unverifiable        (gated the same way; NOT YET WIRED to any
#                                                       actual ACL-confinement logic in this WP1/WP2
#                                                       core -- confirmed by reading the full source;
#                                                       see the W10b skip reason below)
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
# repo toplevel). cmdCancel, cmdTransactionAck, cmdTakeover, cmdRootInit,
# cmdRootValidate, cmdAwaitResult do NOT call git. This file mirrors
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
#   W07a real (via .ps1 wrapper)      W07b SKIP (WP3: deterministic app-server/mcp bridge)
#   W08  real (node + .sh-via-bash + .ps1, byte-identical stdout)
#   W09  real (Get-Acl allowlist, via .ps1 wrapper for root-init/root-validate)
#   W10a SKIP (WP3: root-confinement ACL-rejection not yet implemented)
#   W10b SKIP (WP3: RUNTIME_CONSULTATION_ACL_PROBE not yet wired to any logic)
#   W11  real (two node processes race one .lock/, + a separate orphan-lock case)
#   W12  real (two node processes race the no-clobber primitive via `claim`)
#
# Invocation: pwsh -NoLogo -NoProfile -NonInteractive -File
#   scripts/tests/runtime-consultation-windows.ps1

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ─────────────────────────────────────────────────────────────────────────────
# Global paths / constants
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ImplPath = (Resolve-Path (Join-Path $PSScriptRoot '..\lib\runtime-consultation.cjs')).Path
$Ps1WrapperPath = (Resolve-Path (Join-Path $PSScriptRoot '..\ps1\runtime-consultation.ps1')).Path
$ShWrapperPath = (Resolve-Path (Join-Path $PSScriptRoot '..\sh\runtime-consultation.sh')).Path

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
  & git -C $dir init -q 2>&1 | Out-Null
  & git -C $dir config user.email 'ps1-windows-fixture@test.local' 2>&1 | Out-Null
  & git -C $dir config user.name 'PS1 Windows Fixture' 2>&1 | Out-Null
  & git -C $dir commit -q --allow-empty -m init 2>&1 | Out-Null
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

function New-SubjectBundleManifestFile {
  param([Parameter(Mandatory)][string]$Path)
  $manifest = [ordered]@{ schema = 'coordination/subject-bundle-manifest/v1'; entries = @() }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  ($manifest | ConvertTo-Json -Compress -Depth 4) | Set-Content -NoNewline -Encoding utf8 -Path $Path
  return $Path
}

function New-PlanFixtureFile {
  param([Parameter(Mandatory)][string]$GitRoot, [Parameter(Mandatory)][string]$WaveSlug)
  $planDir = Join-Path $GitRoot (".planning\wave-" + $WaveSlug)
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

  $previous = @{}
  foreach ($k in $EnvVars.Keys) {
    $previous[$k] = [System.Environment]::GetEnvironmentVariable($k)
    [System.Environment]::SetEnvironmentVariable($k, [string]$EnvVars[$k])
  }
  try {
    $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
      -WorkingDirectory $RepoRoot -RedirectStandardOutput $outFile -RedirectStandardError $errFile `
      -NoNewWindow -PassThru
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
  } finally {
    foreach ($k in $EnvVars.Keys) {
      [System.Environment]::SetEnvironmentVariable($k, $previous[$k])
    }
  }

  # Deliberately plain, unambiguous direct assignments (never an if/else used
  # as an expression) -- PowerShell's pipeline-style value capture can unroll
  # an empty array result to $null, which would silently corrupt the
  # byte-exact comparisons this file relies on (W03/W08/Assert-BytesEqual).
  $stdoutBytes = [byte[]]@()
  if (Test-Path $outFile) { $stdoutBytes = [IO.File]::ReadAllBytes($outFile) }
  $stderrBytes = [byte[]]@()
  if (Test-Path $errFile) { $stderrBytes = [IO.File]::ReadAllBytes($errFile) }
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
  $argList = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $Ps1WrapperPath) + $CliArgs
  return Invoke-ChildProcess -FilePath 'pwsh' -ArgumentList $argList -EnvVars $EnvVars
}

# Invokes node directly against the impl (used by W08's 3-way comparison and by
# W11/W12, which race two NODE processes per this task's own dispatch wording).
function Invoke-NodeDirect {
  param([Parameter(Mandatory)][string[]]$CliArgs, [hashtable]$EnvVars = @{})
  return Invoke-ChildProcess -FilePath 'node' -ArgumentList (@($ImplPath) + $CliArgs) -EnvVars $EnvVars
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
  $shWrapperFwd = ConvertTo-ForwardSlashPath -Path $ShWrapperPath
  return Invoke-ChildProcess -FilePath 'bash' -ArgumentList (@($shWrapperFwd) + $CliArgs) -EnvVars $EnvVars
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
  param([Parameter(Mandatory)][byte[]]$StderrBytes)
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
  $rootWithSpaces = Join-Path $WorkRoot 'w01 coordination root with spaces'
  $r1 = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $rootWithSpaces) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-True ($r1.ExitCode -eq 0) "root-init exit code expected 0, got $($r1.ExitCode); stderr=$($r1.Stderr)"
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
  $freshRoot = Join-Path $WorkRoot 'w03-coordination'
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
  $freshRoot = Join-Path $WorkRoot 'w06-coordination'
  $rHappy = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $freshRoot) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-CliResult -Stdout $rHappy.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  # (b) malformed/unresolvable request -- `claim` against a --request path whose
  # request.json does not exist. readRequestForTxnOrCorrelationInvalid() throws
  # CORRELATION_INVALID (INVALID/rc3) BEFORE any git call is reached, so no
  # git-backed root is required for this sub-case.
  $missingReqPath = Join-Path (New-Ps1TestTempDir -Suffix 'w06-missing-req') 'transactions\nope\request.json'
  $rBad = Invoke-Wrapper -CliArgs @(
    'claim', '--coordination-root', $freshRoot, '--request', $missingReqPath, '--role', 'w06-role'
  ) -EnvVars (Get-DefaultCapabilityEnv)
  Assert-CliResult -Stdout $rBad.Stdout -ExpectedStatus 'INVALID' -ExpectedDetail 'CORRELATION_INVALID' | Out-Null

  # (c) forced deadline-exceeded via the fake-clock advance -- NEVER a real
  # sleep. await-result's deadlineBaseMs is FIXED_CLOCK_BASE_MS when
  # --fixed-clock is active; currentClockMs() reads
  # FIXED_CLOCK_BASE_MS+FIXED_CLOCK_ADVANCE_MS. Advancing far past the
  # 1-second --timeout forces the very first loop iteration's deadline check
  # to already be exceeded -- zero real elapsed wall-clock time.
  $timeoutReqDir = New-Ps1TestTempDir -Suffix 'w06-timeout-req'
  $timeoutReqPath = Join-Path $timeoutReqDir 'request.json'
  '{}' | Set-Content -NoNewline -Encoding utf8 -Path $timeoutReqPath
  $rTimeout = Invoke-Wrapper -CliArgs @(
    'await-result', '--coordination-root', $freshRoot, '--request', $timeoutReqPath, '--timeout', '1', '--fixed-clock'
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

Invoke-Case -Name 'W08 node vs sh-wrapper(bash) vs ps1-wrapper equivalence: root-init --fixed-ids --fixed-clock produces byte-identical cli-result/v1 stdout via all three entrypoints' -Body {
  $sharedRoot = Join-Path $WorkRoot 'w08-coordination'
  $capEnv = Get-DefaultCapabilityEnv

  $rNode = Invoke-NodeDirect -CliArgs @('root-init', '--coordination-root', $sharedRoot, '--fixed-ids', '--fixed-clock') -EnvVars $capEnv
  Assert-True ($rNode.ExitCode -eq 0) "node-direct root-init failed: $($rNode.Stdout) $($rNode.Stderr)"
  Assert-CliResult -Stdout $rNode.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  # Forward slashes for the bash/.sh leg only (script path + coordination-root
  # value) -- sidesteps MSYS/Git-Bash's own argv re-splitting/backslash-
  # escaping conventions. Node's path.resolve() normalizes either separator to
  # the same canonical Windows absolute form, so artifact_ref still matches
  # byte-for-byte across all three entrypoints (see this file's header note).
  $sharedRootFwd = ConvertTo-ForwardSlashPath -Path $sharedRoot
  $rSh = $null
  try {
    $rSh = Invoke-ShWrapperViaBash -CliArgs @('root-init', '--coordination-root', $sharedRootFwd, '--fixed-ids', '--fixed-clock') -EnvVars $capEnv
  } catch {
    throw "bash was not invokable for the .sh wrapper leg of W08 (expected Git for Windows' bash.exe on PATH on windows-latest) -- underlying error: $($_.Exception.Message)"
  }
  Assert-True ($rSh.ExitCode -eq 0) "sh-wrapper(bash) root-init failed: $($rSh.Stdout) $($rSh.Stderr)"
  Assert-CliResult -Stdout $rSh.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  $rPs1 = Invoke-Wrapper -CliArgs @('root-init', '--coordination-root', $sharedRoot, '--fixed-ids', '--fixed-clock') -EnvVars $capEnv
  Assert-True ($rPs1.ExitCode -eq 0) "ps1-wrapper root-init failed: $($rPs1.Stdout) $($rPs1.Stderr)"
  Assert-CliResult -Stdout $rPs1.Stdout -ExpectedStatus 'SUCCESS' -ExpectedDetail 'NONE' | Out-Null

  Assert-BytesEqual -A $rNode.StdoutBytes -B $rSh.StdoutBytes -Message 'node vs sh-wrapper(bash) stdout not byte-identical'
  Assert-BytesEqual -A $rSh.StdoutBytes -B $rPs1.StdoutBytes -Message 'sh-wrapper(bash) vs ps1-wrapper stdout not byte-identical'
  Assert-BytesEqual -A $rNode.StdoutBytes -B $rPs1.StdoutBytes -Message 'node vs ps1-wrapper stdout not byte-identical'
}

# ══════════════════════════════════════════════════════════════════════════
# W09 root/registry owner-confined ACL (PLAN.md ~L1504) -- via the .ps1
# wrapper for root-init/root-validate; the ACL allowlist assertion itself is
# performed directly by THIS test via Get-Acl (see this file's own report for
# the load-bearing caveat: cmdRootInit's chmod is a documented Windows no-op
# and cmdRootValidate performs NO ACL check at all in the current WP1/WP2
# core -- the real confinement proof here is entirely this pwsh-side check).
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W09 wrapper: root/registry owner-confined ACL contains only the frozen allowlisted SIDs' -Body {
  $root = Join-Path $WorkRoot 'w09-coordination'
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

  $acl = Get-Acl -Path $root
  $violations = @()
  foreach ($ace in $acl.Access) {
    $sid = $null
    try {
      $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
      $sid = $ace.IdentityReference.Value
    }
    if ($allowedSids -notcontains $sid) {
      $violations += "$($ace.IdentityReference) ($sid)"
    }
  }
  Assert-True ($violations.Count -eq 0) "ACL on $root contains non-allowlisted principal(s): $($violations -join '; ')"

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
  $previous = @{}
  foreach ($k in $EnvVars.Keys) {
    $previous[$k] = [System.Environment]::GetEnvironmentVariable($k)
    [System.Environment]::SetEnvironmentVariable($k, [string]$EnvVars[$k])
  }
  try {
    $p1 = Start-Process -FilePath 'node' -ArgumentList (@($ImplPath) + $CliArgs) -WorkingDirectory $RepoRoot -RedirectStandardOutput $out1 -RedirectStandardError $err1 -NoNewWindow -PassThru
    $p2 = Start-Process -FilePath 'node' -ArgumentList (@($ImplPath) + $CliArgs) -WorkingDirectory $RepoRoot -RedirectStandardOutput $out2 -RedirectStandardError $err2 -NoNewWindow -PassThru
    $p1.WaitForExit()
    $p2.WaitForExit()
  } finally {
    foreach ($k in $EnvVars.Keys) { [System.Environment]::SetEnvironmentVariable($k, $previous[$k]) }
  }
  $r1 = [pscustomobject]@{ ExitCode = $p1.ExitCode; Stdout = [IO.File]::ReadAllText($out1); Stderr = [IO.File]::ReadAllText($err1) }
  $r2 = [pscustomobject]@{ ExitCode = $p2.ExitCode; Stdout = [IO.File]::ReadAllText($out2); Stderr = [IO.File]::ReadAllText($err2) }
  return @($r1, $r2)
}

# ══════════════════════════════════════════════════════════════════════════
# W11 multiprocess transition lock (PLAN.md ~L1507; Race section ~L1429-1435;
# SC-9) -- two REAL node processes race one fresh .lock/ (exactly one
# acquires, the live holder is never reclaimed), plus a SEPARATE orphan-lock
# sub-case (bounded timeout+STOP, never age-reclaim).
# ══════════════════════════════════════════════════════════════════════════

Invoke-Case -Name 'W11a two node processes race the same fresh .lock/: exactly one publishes cancel.json, the other observes it already cancelled' -Body {
  $reqDir = New-Ps1TestTempDir -Suffix 'w11a-req'
  $reqPath = Join-Path $reqDir 'request.json'
  '{"request_id":"w11afixturerequest"}' | Set-Content -NoNewline -Encoding utf8 -Path $reqPath
  $coordRoot = New-Ps1TestTempDir -Suffix 'w11a-coordination'
  $capEnv = Get-DefaultCapabilityEnv

  # cmdCancel never calls git (unlike cmdClaim/cmdPublishResult/cmdAcceptResult),
  # so no git-backed fixture root is required for this sub-case.
  $cliArgs = @('cancel', '--coordination-root', $coordRoot, '--request', $reqPath, '--reason', 'explicit', '--fixed-ids', '--fixed-clock')
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
  $reqDir = New-Ps1TestTempDir -Suffix 'w11b-req'
  $reqPath = Join-Path $reqDir 'request.json'
  '{"request_id":"w11bfixturerequest"}' | Set-Content -NoNewline -Encoding utf8 -Path $reqPath
  $coordRoot = New-Ps1TestTempDir -Suffix 'w11b-coordination'
  # Simulates an abandoned/crashed lock holder: pre-create .lock/ ourselves; it
  # is never released by anyone in this test.
  $lockDir = Join-Path $reqDir '.lock'
  New-Item -ItemType Directory -Force -Path $lockDir | Out-Null

  $capEnv = Get-DefaultCapabilityEnv
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
  # cmdClaim calls computeWorktreeId(coordRoot) -- a real git call -- so this
  # sub-case (unlike W11) needs a git-backed fixture root.
  $gitRoot = New-GitFixtureRoot -Suffix 'w12-git'
  $coordRoot = Join-Path $gitRoot '.planning\coordination'
  $planRoot = Join-Path $coordRoot 'w12fakerepo\w12fakewave\w12fakeplandigest'
  # The directory name under transactions/ MUST equal the request.json's own
  # request_id field: validateClaimV1 (used below) independently RE-DERIVES
  # txnDir as planRoot/transactions/<request_id-from-the-claim-file>, it does
  # not simply trust wherever cmdClaim's own --request happened to point.
  $w12RequestId = 'w12reqfixture'
  $reqDir = Join-Path $planRoot ('transactions\' + $w12RequestId)
  New-Item -ItemType Directory -Force -Path $reqDir | Out-Null
  $reqPath = Join-Path $reqDir 'request.json'

  $expiry = Get-IsoTimestamp -OffsetSeconds 1800
  $fixedHexAttempt = '1' * 64
  $fixedHexProfileDigest = 'b' * 64
  $requestFixture = [ordered]@{
    request_id = $w12RequestId
    initial_attempt_id = $fixedHexAttempt
    initial_lease_epoch = 0
    target_role_profile_digest = $fixedHexProfileDigest
    expiry = $expiry
  }
  ($requestFixture | ConvertTo-Json -Compress -Depth 4) | Set-Content -NoNewline -Encoding utf8 -Path $reqPath

  $capEnv = Get-DefaultCapabilityEnv
  $cliArgs = @('claim', '--coordination-root', $coordRoot, '--request', $reqPath, '--role', 'w12-racer', '--fixed-ids', '--fixed-clock')
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
  $hardlinkOutput = & fsutil hardlink list $claimPath
  $hardlinkLines = @($hardlinkOutput | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  Assert-True ($hardlinkLines.Count -eq 1) "expected exactly one hard link (nlink==1) for the winning claim file, fsutil reported $($hardlinkLines.Count): $($hardlinkLines -join ' | ')"

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
  $claimsDir = Join-Path $reqDir 'claims'
  $leftoverTemps = @(Get-ChildItem -Path $claimsDir -Filter '*.tmp-owner*' -ErrorAction SilentlyContinue)
  Assert-True ($leftoverTemps.Count -eq 0) "leftover no-clobber temp file(s) found in $claimsDir : $($leftoverTemps.Name -join ', ')"
}

# ══════════════════════════════════════════════════════════════════════════
# WP3-dependent families -- explicit, greppable skips. Each names the exact
# missing WP3 feature (verified by reading the full current source, not
# assumed) so a future task can un-skip it once that feature lands. Never
# faked/worked around.
# ══════════════════════════════════════════════════════════════════════════

Skip-Case -Name 'W07b same-worktree deterministic app-server/mcp rendezvous (session-run --test-backend deterministic-app-server-v1 + claude-mcp-launch --test-frontend deterministic-mcp-client-v1)' `
  -Reason 'WP3: requires scripts/lib/runtime-bridge-codex.cjs (session-run/claude-mcp-launch subcommands). Confirmed by reading the full 2857-line scripts/lib/runtime-consultation.cjs: its COMMANDS registry has no session-run/claude-mcp-launch/mcp-serve/runtime-spawn/worker-cleanup/conformance handlers -- that is a separate bridge file this dispatch does not own. W07a above already proves the same-worktree publish->dispatch->claim->publish-result->await-result->accept-result->transaction-ack round trip entirely via the .ps1 wrapper; this sub-case is purely the WP3 deterministic backend-rendezvous mechanism layered on top of it.'

Skip-Case -Name 'W10a ACL-insecure (world-SID icacls */S-1-1-0:(OI)(CI)F) rejected fail-closed' `
  -Reason 'WP3: root-confinement ACL-rejection logic does not exist yet. Confirmed by reading cmdRootValidate in the current WP1/WP2 core: it only calls fs.statSync(coordRoot) and checks isDirectory() -- zero ACL/SID inspection. Constructing the world-SID icacls fixture now would only prove this test file''s OWN external Get-Acl probe (as W09 above already does for the confined-baseline case); it would not prove root-validate itself rejects an insecure ACL, since root-validate has no such check to exercise. Deferred to WP3 root-confinement work in cmdRootValidate.'

Skip-Case -Name 'W10b ACL-unverifiable (RUNTIME_CONSULTATION_ACL_PROBE=unverifiable) disables sibling shared-root mode fail-closed' `
  -Reason 'WP3: RUNTIME_CONSULTATION_ACL_PROBE is gated in parseFlags() (rejected outside NODE_ENV=test + the harness test capability, mirroring --fixed-ids/--fixed-clock) but its VALUE is never read anywhere else in the source -- confirmed by reading the full 2857-line file: no ACL-confinement/indeterminate branch consults this variable. The seam exists and is guarded against production misuse; it is not yet wired to any actual behavior. Deferred to WP3 root-confinement.'

# ─────────────────────────────────────────────────────────────────────────────
# Summary + exit -- non-zero exit iff any REAL (non-skipped) case failed.
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '==================== runtime-consultation-windows.ps1 SUMMARY ===================='
foreach ($r in $script:TestResults) {
  Write-Host ("{0,-6} {1}" -f $r.Result, $r.Name)
  if ($r.Result -eq 'FAIL') { Write-Host ("       -> {0}" -f $r.Message) }
}
Write-Host '====================================================================================='
Write-Host "PASS=$script:PassCount FAIL=$script:FailCount SKIP=$script:SkipCount TOTAL=$($script:TestResults.Count)"

try {
  Remove-Item -Recurse -Force -Path $WorkRoot -ErrorAction SilentlyContinue
} catch {
  Write-Host "WARN: cleanup of $WorkRoot failed (non-fatal): $($_.Exception.Message)"
}

if ($script:FailCount -gt 0) {
  Write-Host 'RESULT: FAIL'
  exit 1
} else {
  Write-Host 'RESULT: PASS'
  exit 0
}
