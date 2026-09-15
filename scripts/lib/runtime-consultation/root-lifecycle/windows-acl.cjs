'use strict';

// Windows owner-private-directory ACL observe/ensure/validate primitives (embedded PowerShell probe, SID allowlist).

function createWindowsAclModule({
  CliError,
  execFileSync,
  fs,
  isFixedClockActive,
  isFixedIdsActive,
  isPathWithin,
  isTestCapability,
  path,
}) {
// Ancestor-reparse-point investigation (arch-platform TOCTOU verdict, STEP 6,
// wave-portable-runtime-messaging-adapters): this script's Get-Acl/DirectoryInfo
// read below only inspects reparse-point status at the LEAF target path, and
// this module's own path.resolve() only does lexical dot/dot-dot collapsing,
// never symlink resolution -- so neither, on its own, proves an ancestor
// directory (e.g. a symlinked grandparent of a credential-pin directory)
// isn't silently redirecting the target elsewhere. Confirmed (not assumed):
// both this embedded PowerShell script's own filesystem access and the
// paired Node fs.* calls in the caller resolve ancestor reparse points
// identically, transparently, via the OS's own normal path resolution --
// O_NOFOLLOW / FILE_FLAG_OPEN_REPARSE_POINT-equivalent behavior only ever
// applies to the LAST path component, never an ancestor. Both sides therefore
// observe the same final resolved target; there is no ancestor-reparse-point
// bypass here, and no code change is needed for it.
const WINDOWS_PRIVATE_DIRECTORY_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$targetsJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:RUNTIME_ACL_TARGETS_BASE64))
$targetsPayload = $targetsJson | ConvertFrom-Json
$targets = @($targetsPayload.targets)
$mode = $env:RUNTIME_ACL_MODE
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$results = @()
foreach ($target in $targets) {
  $directoryInfo = [System.IO.DirectoryInfo]::new([string]$target)
  if ($mode -eq 'ensure' -and -not $directoryInfo.Exists) {
    [void][System.IO.Directory]::CreateDirectory([string]$target)
    $directoryInfo.Refresh()
  }
  if (-not $directoryInfo.Exists) { throw 'ACL target directory does not exist' }
  if (($directoryInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'ACL target directory is a reparse point'
  }
  if ($mode -eq 'ensure') {
    # Avoid rewriting an already-compliant DACL. Besides being unnecessary,
    # SetAccessControl briefly races concurrent registry readers on Windows.
    # The preflight uses the same acceptance predicate as the final result;
    # any missing/ambiguous property still takes the hardening path and is
    # re-read below before success can be reported.
    $existingAcl = [System.IO.FileSystemAclExtensions]::GetAccessControl(
      $directoryInfo,
      [System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Access
    )
    $existingOwnerSid = $existingAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $existingRules = @($existingAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $allowlist = @($currentSid.Value, 'S-1-5-18', 'S-1-5-32-544')
    $existingDisallowed = @($existingRules | Where-Object { $allowlist -notcontains $_.IdentityReference.Value })
    $existingNonAllow = @($existingRules | Where-Object { $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow })
    $fullMask = [int64][System.Security.AccessControl.FileSystemRights]::FullControl
    $existingCurrentFull = @($existingRules | Where-Object {
      $_.IdentityReference.Value -eq $currentSid.Value -and
      $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      (([int64]$_.FileSystemRights -band $fullMask) -eq $fullMask)
    }).Count -gt 0
    $alreadyPrivate = (
      $existingOwnerSid -eq $currentSid.Value -and
      [bool]$existingAcl.AreAccessRulesProtected -and
      $existingDisallowed.Count -eq 0 -and
      $existingNonAllow.Count -eq 0 -and
      $existingCurrentFull
    )
    if (-not $alreadyPrivate) {
      $security = [System.Security.AccessControl.DirectorySecurity]::new()
      $security.SetOwner($currentSid)
      $security.SetAccessRuleProtection($true, $false)
      $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $currentSid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      [void]$security.AddAccessRule($rule)
      [System.IO.FileSystemAclExtensions]::SetAccessControl($directoryInfo, $security)
    }
  }
  $acl = [System.IO.FileSystemAclExtensions]::GetAccessControl(
    $directoryInfo,
    [System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Access
  )
  $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  $allowlist = @($currentSid.Value, 'S-1-5-18', 'S-1-5-32-544')
  $aceSids = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
  $disallowed = @($aceSids | Where-Object { $allowlist -notcontains $_ } | Sort-Object -Unique)
  $nonAllow = @($rules | Where-Object { $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow })
  $fullMask = [int64][System.Security.AccessControl.FileSystemRights]::FullControl
  $currentFull = @($rules | Where-Object {
    $_.IdentityReference.Value -eq $currentSid.Value -and
    $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    (([int64]$_.FileSystemRights -band $fullMask) -eq $fullMask)
  }).Count -gt 0
  $results += [ordered]@{
    owner_sid = $ownerSid
    current_sid = $currentSid.Value
    protected = [bool]$acl.AreAccessRulesProtected
    current_full_control = [bool]$currentFull
    ace_sids = @($aceSids)
    disallowed_sids = @($disallowed)
    non_allow_count = $nonAllow.Count
  }
}
[Console]::Out.WriteLine(([ordered]@{ results = @($results) } | ConvertTo-Json -Compress -Depth 5))
`;

/**
 * Applies or validates the Windows owner-private directory ACL contract.
 * The result deliberately distinguishes an observed policy failure from an
 * indeterminate probe/tool failure so callers can fail closed without claiming
 * they observed an ACL violation they could not actually inspect.
 * @param {string|string[]} dirPath
 * @param {{mode:'ensure'|'validate'}} options
 * @returns {{ok:true,owner_sid:string,current_sid:string,protected:boolean,current_full_control:boolean,ace_sids:string[],disallowed_sids:string[]}|{ok:false,status:'failed'|'indeterminate',reason:string,disallowed_sids?:string[]}}
 */
// TOCTOU fix (arch-platform verdict, wave-portable-runtime-messaging-adapters):
// module-scoped call counter, keyed by the resolved target path(s), lets a
// test simulate a real attacker-timed ACL change between a caller's own
// before/after probes of the SAME path within one process -- production
// code never reads this counter or the env var it gates.
const __windowsAclProbeCallCounts = new Map();

/**
 * Resolve one installed Windows PowerShell host without trusting PATH. Prefer
 * supported PowerShell 7 because the legacy 5.1 CLR host can crash under the
 * sustained, process-isolated ACL workload used by the runtime. Every
 * candidate must remain inside its resolved installation root and be a real
 * regular file; legacy 5.1 is retained only as a compatibility fallback.
 *
 * @returns {string|null}
 */
function resolvedWindowsPowerShellPath() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  for (const programFilesRoot of [process.env.ProgramW6432, process.env.ProgramFiles]) {
    if (typeof programFilesRoot === 'string' && path.isAbsolute(programFilesRoot)) {
      candidates.push({ root: programFilesRoot, parts: ['PowerShell', '7', 'pwsh.exe'] });
    }
  }
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (typeof systemRoot === 'string' && path.isAbsolute(systemRoot)) {
    candidates.push({ root: systemRoot, parts: ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'] });
  }

  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const resolvedRoot = fs.realpathSync(candidate.root);
      const resolved = fs.realpathSync(path.join(resolvedRoot, ...candidate.parts));
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isPathWithin(resolvedRoot, resolved)) continue;
      const stat = fs.statSync(resolved);
      if (stat.isFile()) return resolved;
    } catch (err) {
      // Missing or unprovable candidates are unavailable, never guessed.
    }
  }
  return null;
}

function windowsPrivateDirectoryAcl(dirPath, options) {
  const mode = options && options.mode;
  if (mode !== 'ensure' && mode !== 'validate') {
    return { ok: false, status: 'indeterminate', reason: 'invalid-mode' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, status: 'indeterminate', reason: 'windows-acl-unavailable-on-platform' };
  }
  const isBatch = Array.isArray(dirPath);
  const rawPaths = isBatch ? dirPath : [dirPath];
  if (rawPaths.length === 0 || !rawPaths.every((item) => typeof item === 'string' && item.length > 0)) {
    return { ok: false, status: 'indeterminate', reason: 'invalid-target' };
  }
  const resolvedPaths = rawPaths.map((item) => path.resolve(item));
  const powershell = resolvedWindowsPowerShellPath();
  if (!powershell) {
    return { ok: false, status: 'indeterminate', reason: 'powershell-unavailable' };
  }
  let stdout;
  let probeError = null;
  const encoded = Buffer.from(WINDOWS_PRIVATE_DIRECTORY_ACL_SCRIPT, 'utf16le').toString('base64');
  const probeOptions = {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: Object.assign({}, process.env, {
      RUNTIME_ACL_MODE: mode,
      RUNTIME_ACL_TARGETS_BASE64: Buffer.from(JSON.stringify({ targets: resolvedPaths }), 'utf8').toString('base64'),
    }),
  };
  // PowerShell is an external security probe. A host-process startup failure
  // carries no authoritative ACL result, so retry it once with a completely
  // fresh process. A second failure remains indeterminate/fail-closed; parsed
  // insecure or malformed results are never retried or upgraded.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      stdout = execFileSync(
        powershell,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        probeOptions,
      );
      probeError = null;
      break;
    } catch (err) {
      probeError = err;
    }
  }
  if (probeError) return { ok: false, status: 'indeterminate', reason: 'acl-probe-error' };
  let observed;
  try {
    observed = JSON.parse(String(stdout).trim());
  } catch (err) {
    return { ok: false, status: 'indeterminate', reason: 'acl-probe-output-invalid' };
  }
  if (!observed || typeof observed !== 'object' || !Array.isArray(observed.results)
      || observed.results.length !== resolvedPaths.length) {
    return { ok: false, status: 'indeterminate', reason: 'acl-probe-output-invalid' };
  }
  const normalized = observed.results.map((entry) => normalizeWindowsAclObservation(entry));
  const failed = normalized.find((entry) => !entry.ok);
  if (failed) return failed;
  // TOCTOU fix (arch-platform verdict): on the 2nd+ call for this exact
  // resolved path within the process, under the test capability plus the
  // explicit drift flag, mutate an otherwise-unchanged ok:true snapshot so
  // only windowsAclSnapshotsEqual's own content comparison can catch it --
  // simulates an attacker changing the ACL between a caller's own before/
  // after probes without faking a real Windows ACL change.
  const aclProbeKey = resolvedPaths.join('|');
  const aclProbeCallCount = (__windowsAclProbeCallCounts.get(aclProbeKey) || 0) + 1;
  __windowsAclProbeCallCounts.set(aclProbeKey, aclProbeCallCount);
  if (isTestCapability() && process.env.RUNTIME_CONSULTATION_TEST_ACL_SNAPSHOT_DRIFT === '1' && aclProbeCallCount >= 2) {
    for (const entry of normalized) {
      if (entry.ok) entry.ace_sids = entry.ace_sids.concat('S-1-5-18').sort();
    }
  }
  return isBatch ? { ok: true, results: normalized } : normalized[0];
}

function normalizeWindowsAclObservation(observed) {
  if (
    !observed || typeof observed !== 'object'
    || typeof observed.owner_sid !== 'string'
    || typeof observed.current_sid !== 'string'
    || typeof observed.protected !== 'boolean'
    || typeof observed.current_full_control !== 'boolean'
    || !Array.isArray(observed.ace_sids)
    || !observed.ace_sids.every((sid) => typeof sid === 'string')
    || !Array.isArray(observed.disallowed_sids)
    || !observed.disallowed_sids.every((sid) => typeof sid === 'string')
    || !Number.isInteger(observed.non_allow_count)
  ) return { ok: false, status: 'indeterminate', reason: 'acl-probe-output-invalid' };
  if (observed.owner_sid !== observed.current_sid) {
    return { ok: false, status: 'failed', reason: 'wrong-owner' };
  }
  if (!observed.protected) {
    return { ok: false, status: 'failed', reason: 'inherited-acl' };
  }
  if (observed.disallowed_sids.length > 0) {
    return {
      ok: false,
      status: 'failed',
      reason: 'disallowed-principal',
      disallowed_sids: observed.disallowed_sids.slice().sort(),
    };
  }
  if (observed.non_allow_count !== 0) {
    return { ok: false, status: 'failed', reason: 'non-allow-ace' };
  }
  if (!observed.current_full_control) {
    return { ok: false, status: 'failed', reason: 'current-principal-not-full-control' };
  }
  return {
    ok: true,
    owner_sid: observed.owner_sid,
    current_sid: observed.current_sid,
    protected: observed.protected,
    current_full_control: observed.current_full_control,
    ace_sids: observed.ace_sids.slice().sort(),
    disallowed_sids: [],
  };
}

function assertWindowsRootAclProbeAvailable() {
  if (process.env.RUNTIME_CONSULTATION_ACL_PROBE !== 'unverifiable') return;
  if (!isTestCapability() || !isFixedIdsActive() || !isFixedClockActive()) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'RUNTIME_CONSULTATION_ACL_PROBE requires the test capability plus both --fixed-ids and --fixed-clock');
  }
  throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root ACL confinement is indeterminate (RUNTIME_CONSULTATION_ACL_PROBE=unverifiable)');
}

function assertWindowsPrivateDirectoryAcl(result, coordRoot) {
  if (result.ok) return;
  const suffix = Array.isArray(result.disallowed_sids) && result.disallowed_sids.length > 0
    ? ' [' + result.disallowed_sids.join(',') + ']'
    : '';
  throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root ACL confinement ' + result.status + ': ' + result.reason + suffix + ': ' + coordRoot);
}

function windowsAclSnapshotsEqual(left, right) {
  if (!left || !right || !left.ok || !right.ok) return false;
  return left.owner_sid === right.owner_sid
    && left.current_sid === right.current_sid
    && left.protected === right.protected
    && left.current_full_control === right.current_full_control
    && JSON.stringify(left.ace_sids) === JSON.stringify(right.ace_sids)
    && JSON.stringify(left.disallowed_sids) === JSON.stringify(right.disallowed_sids);
}

  return Object.freeze({
    WINDOWS_PRIVATE_DIRECTORY_ACL_SCRIPT,
    __windowsAclProbeCallCounts,
    assertWindowsPrivateDirectoryAcl,
    assertWindowsRootAclProbeAvailable,
    normalizeWindowsAclObservation,
    resolvedWindowsPowerShellPath,
    windowsAclSnapshotsEqual,
    windowsPrivateDirectoryAcl,
  });
}

module.exports = { createWindowsAclModule };
