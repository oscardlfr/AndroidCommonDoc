'use strict';

function createProcessIdentity({
  fs,
  execFileSync,
  resolveWindowsPowerShellPath,
  isTestCapability,
  hasExactKeys,
}) {
  const PID_IDENTITY_KEYS = Object.freeze(['birth_observed_at', 'executable', 'pid'].sort());

  // ── ProcessIdentityProvider (injectable) ────────────────────────────────────
  // Production: real OS-observed process-birth (`ps -o lstart=`, POSIX) plus a
  // resolved executable identity -- a self-reported `Date.now()` timestamp
  // proves nothing an external reader couldn't fabricate just as easily, so it
  // is never used here. Point D.4: `ps` is resolved from a FIXED, absolute
  // candidate list -- never bare `'ps'` via `PATH`, which an attacker- or
  // environment-controlled PATH could substitute ahead of the real system
  // binary (the exact same risk class the sibling module's own
  // resolvedNodePath() already guards against for `node`). Absence (no
  // candidate resolves, or `process.execPath` cannot itself be
  // realpath-validated) is reported honestly as `null`, never fabricated and
  // never silently defaulted to an unresolved/unproven value. Tests inject a
  // deterministic value via the SAME `NODE_ENV=test` +
  // `RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY` double-gate this file's other test
  // seams use, plus their own dedicated
  // `RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY` JSON payload.

  const PS_ABSOLUTE_CANDIDATES = Object.freeze(['/bin/ps', '/usr/bin/ps']);
  let cachedResolvedPsPath; // undefined = not yet resolved; null = proven absent.

  /** First realpath-validated, regular-file candidate from PS_ABSOLUTE_CANDIDATES, or null. Memoized -- the filesystem layout is invariant for the life of this process. */
  function resolvedPsPath() {
    if (cachedResolvedPsPath !== undefined) return cachedResolvedPsPath;
    cachedResolvedPsPath = null;
    for (const candidate of PS_ABSOLUTE_CANDIDATES) {
      let real;
      try {
        real = fs.realpathSync(candidate);
      } catch (err) {
        continue; // absent -- try the next candidate.
      }
      let st;
      try {
        st = fs.statSync(real);
      } catch (err) {
        continue;
      }
      if (st.isFile()) { cachedResolvedPsPath = real; break; }
    }
    return cachedResolvedPsPath;
  }

  /**
   * HARD NO-GO RESPONSE Block D (Group A): real OS-observed process birth
   * timestamp via `ps -o lstart=` -- extracted so requireProvenChildIdentity
   * (below) can hold a spawned CHILD's pid to the IDENTICAL standard this
   * function already applies to the SUPERVISOR's own identity, never a
   * second, structurally weaker reimplementation (a bare JS-side
   * Date.now()/toISOString() only records when THIS process's own code
   * happened to run the check -- nothing the OS itself can independently
   * confirm about the target pid, and useless for later detecting PID reuse).
   * Returns null (never throws) if no ps candidate resolves (Windows, a
   * minimal POSIX host) or the pid's birth is otherwise unprovable -- callers
   * treat null as honestly absent, never fabricated.
   */
  function observedProcessBirthTime(pid) {
    if (process.platform === 'win32') {
      const observed = observeWindowsProcessBirth(pid);
      return observed.status === 'PRESENT' ? observed.birthToken : null;
    }
    if (process.platform === 'linux') {
      const observed = observeLinuxProcessBirth(pid);
      return observed.status === 'PRESENT' ? observed.birthToken : null;
    }
    const psPath = resolvedPsPath();
    if (!psPath) return null;
    try {
      const out = execFileSync(psPath, ['-o', 'lstart=', '-p', String(pid)],
        { encoding: 'utf8', windowsHide: true }).trim();
      return out.length > 0 ? out : null;
    } catch (err) {
      return null;
    }
  }

  function resolvedWindowsPowerShellPath() {
    return resolveWindowsPowerShellPath();
  }

  let ownWindowsProcessBirthToken = null;

  function observeWindowsProcessIdentity(pid, timeoutMs) {
    const powerShellPath = resolvedWindowsPowerShellPath();
    if (!powerShellPath || !Number.isInteger(pid) || pid <= 0) {
      return { status: 'UNAVAILABLE', subReason: !powerShellPath ? 'powershell-unresolved' : 'pid-invalid' };
    }
    const command = [
      '$p = Get-Process -Id ' + String(pid) + ' -ErrorAction SilentlyContinue',
      'if ($null -eq $p) { exit 3 }',
      '$payload = [ordered]@{ birth = $p.StartTime.ToUniversalTime().ToString("o"); executable = $p.Path }',
      '[Console]::Out.Write(($payload | ConvertTo-Json -Compress))',
    ].join('; ');
    // Every non-PRESENT return additionally carries `subReason` and `latencyMs`. A bare
    // UNAVAILABLE could previously mean a killed-at-timeout PowerShell, a PowerShell error, an
    // unparseable payload or an unresolvable executable path -- all indistinguishable once the
    // caller collapsed them into a single {ok:false}. `status` semantics are unchanged.
    const observationStartedAt = Date.now();
    try {
      const out = execFileSync(powerShellPath, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command,
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2000,
      }).trim();
      const parsed = JSON.parse(out);
      if (
        !parsed || typeof parsed.birth !== 'string' || parsed.birth.length === 0
        || typeof parsed.executable !== 'string' || parsed.executable.length === 0
      ) return { status: 'UNAVAILABLE', subReason: 'payload-invalid', latencyMs: Date.now() - observationStartedAt };
      let executableIdentity;
      try { executableIdentity = fs.realpathSync(parsed.executable); }
      catch (err) {
        return {
          status: 'UNAVAILABLE', subReason: 'executable-realpath-failed',
          latencyMs: Date.now() - observationStartedAt, observedExecutable: parsed.executable,
        };
      }
      return {
        status: 'PRESENT', birthToken: parsed.birth, executableIdentity,
        latencyMs: Date.now() - observationStartedAt,
      };
    } catch (err) {
      const latencyMs = Date.now() - observationStartedAt;
      if (err && err.status === 3) return { status: 'ABSENT', subReason: 'process-absent', latencyMs };
      return {
        status: 'UNAVAILABLE',
        subReason: err && err.killed ? 'powershell-timeout-killed' : 'powershell-error',
        latencyMs,
        timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2000,
      };
    }
  }

  function observeWindowsProcessBirth(pid) {
    if (pid === process.pid && ownWindowsProcessBirthToken !== null) {
      return { status: 'PRESENT', birthToken: ownWindowsProcessBirthToken };
    }
    const observed = observeWindowsProcessIdentity(pid, 2000);
    if (observed.status === 'PRESENT' && pid === process.pid) {
      ownWindowsProcessBirthToken = observed.birthToken;
    }
    return observed.status === 'PRESENT'
      ? { status: 'PRESENT', birthToken: observed.birthToken }
      : observed;
  }

  /**
   * Linux process identity comes from procfs rather than spawning ps(1).
   * `/proc/<pid>/stat` field 22 is the kernel start-time tick, stable for the
   * lifetime of that exact process and different after PID reuse; field 5 is
   * its process-group id.  The command name is parenthesized and may contain
   * spaces or `)`, so parse from the final `) ` delimiter before indexing the
   * remaining fields (which begin at stat field 3).
   */
  function observeLinuxProcessBirth(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return { status: 'UNAVAILABLE' };
    let statText;
    try {
      statText = fs.readFileSync('/proc/' + String(pid) + '/stat', 'utf8');
    } catch (err) {
      return err && err.code === 'ENOENT' ? { status: 'ABSENT' } : { status: 'UNAVAILABLE' };
    }
    const commandEnd = statText.lastIndexOf(') ');
    if (commandEnd < 0) return { status: 'UNAVAILABLE' };
    const fieldsFromState = statText.slice(commandEnd + 2).trim().split(/\s+/);
    const pgid = Number(fieldsFromState[2]);
    const startTicks = fieldsFromState[19];
    if (!Number.isInteger(pgid) || pgid <= 0 || typeof startTicks !== 'string' || !/^\d+$/.test(startTicks)) {
      return { status: 'UNAVAILABLE' };
    }
    return { status: 'PRESENT', birthToken: 'linux-proc-starttime:' + startTicks, pgid };
  }

  /**
   * ROUND 10 (Block E): a closed, 3-way result distinguishing a genuinely
   * PRESENT (with its observed birth token), definitively ABSENT (ps ran and
   * itself confirmed no such pid), or UNAVAILABLE (ps could not be resolved or
   * invoked, or errored for any reason OTHER than "no such pid") observation.
   * observedProcessBirthTime's own `string|null` surface (above) collapses
   * ABSENT and UNAVAILABLE into the SAME null value -- fine for its own
   * write-time-recording caller (defaultProcessIdentityProvider: "we simply
   * have nothing to record" is an honest degradation there), but WRONG for an
   * authorization decision, where an UNAVAILABLE observation was silently
   * treated as if it were a confirmed ABSENT one, letting destructive recovery
   * proceed on NO independent evidence at all whenever ps itself was broken.
   * Empirically confirmed (direct execFileSync probing, not assumed): ps
   * genuinely invoked against a valid-but-nonexistent pid throws with a
   * numeric `.status` and no Node-level spawn `.code` -- a real, positive
   * absence signal; a genuine spawn-level failure (bad path, EACCES, ...)
   * throws with `.code` set and `.status` null/undefined.
   * @param {number} pid
   * @returns {{status:'PRESENT',birthToken:string}|{status:'ABSENT'}|{status:'UNAVAILABLE'}}
   */
  // M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1: NO-GO Correction B's TTL cache
  // here (and the later queueMicrotask-scoped memo that replaced it) are both
  // gone. Neither survives a synchronous external mutation between two calls
  // in the same process (e.g. a spawnSync-based kill/file-edit run by the same
  // caller between two resolves) -- the microtask-scoped memo's own safety
  // argument ("nothing can change mid-synchronous-execution") only holds for
  // facts intrinsic to this process; it does not hold for OS/filesystem state
  // this process's own synchronous code can mutate out from under itself.
  // S16-HOSTBRIDGE-LIVENESS-NO-SAME-TICK-STALE-01 is the discriminating
  // regression test. The redundant per-call ps spawn this removal reintroduces
  // is addressed at its actual source: resolveLiveCodexAppServerWorkerUncached
  // proves processOwner.pid_identity byte-identical to owner.pid_identity
  // before ever reaching the second liveness check, so that check now reuses
  // the first call's already-proven result instead of re-deriving it (dead-
  // code elimination within one synchronous call, not a cache of past external
  // state -- see that function, below).
  function observeProcessBirth(pid) {
    if (process.platform === 'win32') return observeWindowsProcessBirth(pid);
    if (process.platform === 'linux') return observeLinuxProcessBirth(pid);
    const psPath = resolvedPsPath();
    if (!psPath) return { status: 'UNAVAILABLE' };
    try {
      const out = execFileSync(psPath, ['-o', 'lstart=', '-p', String(pid)],
        { encoding: 'utf8', windowsHide: true }).trim();
      return out.length > 0 ? { status: 'PRESENT', birthToken: out } : { status: 'ABSENT' };
    } catch (err) {
      return (err && typeof err.status === 'number' && !err.code) ? { status: 'ABSENT' } : { status: 'UNAVAILABLE' };
    }
  }



  /**
   * Test-only override, same double-gate as this file's other seams
   * (resolveProcessIdentityProvider, resolveObservedPlatform) -- never
   * production-caller-substitutable. reapTombstonedRoot's own `deps.
   * livenessProbe` stays the ONE intentionally-injectable seam in this whole
   * chain; this independent cross-check must not be equally foolable by a
   * malicious or buggy caller, or it stops being independent at all.
   */
  function resolveProcessBirthObserver() {
    if (!isTestCapability()) return observeProcessBirth;
    const raw = process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_BIRTH_OBSERVATION;
    // No override requested at all (capability active, but this specific seam
    // not exercised) -- falls back to the real observer, same as every other
    // test-only seam in this file.
    if (typeof raw !== 'string' || raw.length === 0) return observeProcessBirth;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // ROUND 10.1 (P2): an override WAS requested but is not even valid JSON
      // -- this is a malformed override, not "no override" -- fails closed to
      // UNAVAILABLE rather than silently using the real observer.
      return () => ({ status: 'UNAVAILABLE' });
    }
    if (parsed && parsed.status === 'ABSENT') return () => ({ status: 'ABSENT' });
    if (parsed && parsed.status === 'UNAVAILABLE') return () => ({ status: 'UNAVAILABLE' });
    if (parsed && parsed.status === 'PRESENT' && typeof parsed.birthToken === 'string' && parsed.birthToken.length > 0) {
      return () => ({ status: 'PRESENT', birthToken: parsed.birthToken });
    }
    // ROUND 10.1 (P2): any other shape (an unknown status string, or PRESENT
    // without a valid non-empty birthToken) is a malformed/unknown override --
    // previously this was returned to the caller AS-IS, and since the only two
    // reaper-side branches explicitly check for 'UNAVAILABLE' and 'PRESENT',
    // anything else (a typo, an unrecognized status) silently fell through
    // BOTH checks and was treated as though it were a confirmed ABSENT,
    // exactly the "authorize on no real evidence" gap Block E itself exists
    // to close. Fails closed to UNAVAILABLE, never silently equivalent to
    // ABSENT.
    return () => ({ status: 'UNAVAILABLE' });
  }

  // M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1 follow-up: removing every TTL/
  // cross-call cache above (measured, empirically -- ROOT-INGRESS-E2E hung
  // past 10 minutes under the real five-role plane, reproducing the exact
  // starvation NO-GO Correction B originally measured) reintroduced the
  // redundant-ps-spawn cost at the one call shape that is genuinely provably
  // redundant: classifyProcessIdentityLiveness asked about THIS OWN PROCESS's
  // pid. A process's own birth cannot change while it is the one executing
  // this comparison -- querying `ps` about ourselves a second, third, or
  // hundredth time can only ever re-observe the identical fact. This is a
  // pure, immutable derivation (permitted), never a cache of externally
  // mutable state (forbidden): it holds our OWN observed birth only, computed
  // AT MOST ONCE for the entire process lifetime (no TTL, no invalidation, no
  // reuse of a DECISION about anyone else). It goes through the SAME
  // resolveProcessBirthObserver() test seam as every other observation, so a
  // test-injected fake for our own pid is still honored, not bypassed. The
  // full PID-reuse cross-check below (observed birth token vs. the RECORDED
  // one) still runs unconditionally on every call, self or not -- this only
  // skips the OS round trip for a fact that cannot have changed, never the
  // comparison itself.
  let ownProcessBirthObservationOnce = null;
  function resolveOwnProcessBirthObservation() {
    if (ownProcessBirthObservationOnce === null) {
      ownProcessBirthObservationOnce = resolveProcessBirthObserver()(process.pid);
    }
    return ownProcessBirthObservationOnce;
  }

  /**
   * Three-way exact process-identity liveness. A PID reuse (PRESENT with a
   * different birth token) proves the recorded supervisor is ABSENT; an
   * unavailable observer is never collapsed into absence.
   */
  function classifyProcessIdentityLiveness(pidIdentity) {
    if (
      !pidIdentity || !hasExactKeys(pidIdentity, PID_IDENTITY_KEYS)
      || !Number.isInteger(pidIdentity.pid) || pidIdentity.pid <= 0
      || typeof pidIdentity.executable !== 'string' || pidIdentity.executable.length === 0
      || typeof pidIdentity.birth_observed_at !== 'string' || pidIdentity.birth_observed_at.length === 0
    ) return { ok: false, status: 'INDETERMINATE', reason: 'pid-identity-invalid' };
    const observed = pidIdentity.pid === process.pid
      ? resolveOwnProcessBirthObservation()
      : resolveProcessBirthObserver()(pidIdentity.pid);
    if (!observed || observed.status === 'UNAVAILABLE') {
      return { ok: true, status: 'INDETERMINATE' };
    }
    if (observed.status === 'ABSENT') return { ok: true, status: 'ABSENT' };
    if (observed.status !== 'PRESENT' || typeof observed.birthToken !== 'string') {
      return { ok: true, status: 'INDETERMINATE' };
    }
    return observed.birthToken === pidIdentity.birth_observed_at
      ? { ok: true, status: 'LIVE' }
      : { ok: true, status: 'ABSENT' };
  }

  function defaultProcessIdentityProvider() {
    const pid = process.pid;
    let executable = null;
    try {
      executable = fs.realpathSync(process.execPath);
    } catch (err) {
      executable = null; // point D.4: fail closed, never fall back to the unresolved path.
    }
    const birthObservedAt = observedProcessBirthTime(pid);
    return { pid, executable, birth_observed_at: birthObservedAt };
  }

  /** Test-overridable observed platform (same double-gate as this file's other seams), so win32 rejection is exercisable without a real Windows host. */
  function resolveObservedPlatform() {
    if (!isTestCapability()) return process.platform;
    const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_PLATFORM;
    if (typeof raw !== 'string' || raw.length === 0) return process.platform;
    return raw;
  }

  function resolveProcessIdentityProvider() {
    if (!isTestCapability()) return defaultProcessIdentityProvider;
    const raw = process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY;
    if (typeof raw !== 'string' || raw.length === 0) return defaultProcessIdentityProvider;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return defaultProcessIdentityProvider;
    }
    if (!parsed || typeof parsed.executable !== 'string') return defaultProcessIdentityProvider;
    // W07b must correlate the durable supervisor owner with the PID of the
    // independently-spawned bridge process. The literal is recognized only
    // inside this function's existing NODE_ENV + private-capability gate;
    // normal numeric fixtures retain their exact prior behavior. "self"
    // returns the COMPLETE defaultProcessIdentityProvider() result (real
    // pid, real realpath-observed executable, real OS-observed birth) --
    // never a real pid paired with fabricated executable/birth. A mixed
    // identity fails its own later re-observation: classifyProcessIdentity
    // Liveness re-derives the OS birth token for this exact pid and compares
    // it against the STORED birth_observed_at field, so a fabricated birth
    // string can never match the genuinely-observed one and the worker is
    // correctly classified ABSENT, not LIVE -- self-defeating for a seam
    // whose entire purpose is proving a genuinely live, owned identity.
    if (parsed.pid === 'self') {
      return defaultProcessIdentityProvider;
    }
    if (typeof parsed.pid !== 'number') return defaultProcessIdentityProvider;
    return () => parsed;
  }



  /**
   * Point E hard gate: a valid pid, an OBSERVED (non-empty) executable, and a
   * NON-EMPTY process-birth are all REQUIRED before any claim consumption or
   * owner write. Windows uses the fixed, realpath-validated system PowerShell
   * observer above to read Get-Process.StartTime for the exact PID; POSIX uses
   * the fixed absolute ps candidates. If either platform cannot prove the
   * executable or birth token, the shared checks below still fail closed --
   * no platform is permitted to proceed with a null or fabricated identity.
   * @returns {{ok:true,pidIdentity:object}|{ok:false,reason:string}}
   */
  function requireProvenProcessIdentity() {
    const identityProvider = resolveProcessIdentityProvider();
    const pidIdentity = identityProvider();
    if (!pidIdentity || !Number.isInteger(pidIdentity.pid) || pidIdentity.pid <= 0) {
      return { ok: false, reason: 'process-identity-pid-unprovable' };
    }
    if (typeof pidIdentity.executable !== 'string' || pidIdentity.executable.length === 0) {
      return { ok: false, reason: 'process-identity-executable-unprovable' };
    }
    if (typeof pidIdentity.birth_observed_at !== 'string' || pidIdentity.birth_observed_at.length === 0) {
      return { ok: false, reason: 'process-identity-birth-unprovable' };
    }
    return { ok: true, pidIdentity };
  }

  return Object.freeze({
    PID_IDENTITY_KEYS, resolvedPsPath, observedProcessBirthTime, resolvedWindowsPowerShellPath,
    observeWindowsProcessIdentity, observeWindowsProcessBirth, observeLinuxProcessBirth, observeProcessBirth,
    resolveProcessBirthObserver, classifyProcessIdentityLiveness, defaultProcessIdentityProvider,
    resolveObservedPlatform, resolveProcessIdentityProvider, requireProvenProcessIdentity,
  });
}

module.exports = Object.freeze({ createProcessIdentity });
