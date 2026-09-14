'use strict';

function createOwnedChildProvenance({
  fs,
  path,
  spawn,
  resolvedPsPath,
  observeWindowsProcessIdentity,
  observeLinuxProcessBirth,
  getIsolatedPathPosix,
}) {
  /**
   * P1-A (sequence123-codex-r129-binding.md section5, "Ownership and BORN"):
   * the owned-app-server BORN record's own pgid/os_birth_token pair, both
   * observed via the SAME trusted absolute `ps` surface as observeProcessBirth
   * above, but under this record's own additionally-required fixed observer
   * environment (`LC_ALL=C,LANG=C,TZ=UTC` and the existing fixed
   * ISOLATED_PATH_POSIX). Each individual probe is a genuinely owned, tracked
   * child handle (registered into the caller's own `observerJobs` Set for the
   * exact duration of its own bounded execution, exactly like every other
   * admitted job this coordinator later joins/reports on) bounded by the
   * LESSER of 2s and the caller's own remaining startup time -- never a fixed
   * 2s regardless of how little budget is actually left. Birth is observed
   * TWICE, bracketing the single pgid observation, and the two birth tokens
   * must agree byte-for-byte: any drift is treated as a genuine identity
   * inconsistency (a pid-reuse race), never trusted. Never signals the
   * INSPECTED pid itself (only the separate, short-lived `ps` probes
   * themselves are ever started/bounded/killed here). Returns {ok:false}
   * (never throws, never fabricates a value) if any observation is
   * unavailable, times out, or the two birth observations disagree.
   * @param {number} pid
   * @param {number} deadlineMs absolute ms epoch this coordinator's own remaining startup time expires at.
   * @param {Set<object>} observerJobs the coordinator's own admitted-job tracking Set.
   * @returns {Promise<{ok:true,birthToken:string,pgid:number}|{ok:false}>}
   */
  /**
   * P1-A / sequence145 correction (finding P1A-144-03): section5's own text
   * ("Bound each owned observer process by remaining startup time with 2s
   * maximum plus exact-handle termination/confirmation; track them as
   * admitted work") requires TWO distinct guarantees this rewrite keeps
   * structurally separate:
   * (1) THIS probe's own caller-facing Promise must always settle within the
   *     caller's remaining startup time (deadlineMs) -- observeOwnedChildBornProvenance
   *     must never hang.
   * (2) `observerJobs` membership -- the admitted-work tracking
   *     runOwnedStopTimeline's own stage2 join genuinely joins -- is removed
   *     ONLY once the exact handle has genuinely, actually emitted its own
   *     'exit'/'error' event. A confirmation TIMEOUT is resource uncertainty,
   *     never proof a potentially-still-live handle disappeared, so it must
   *     NEVER by itself untrack the handle -- doing so would let a live
   *     handle silently vanish from admitted-work accounting.
   * These two are handled by two separate functions below (resolvePromiseOnce
   * vs untrackOnGenuineSettlement) so a confirmation-timeout resolution can
   * settle (1) while deliberately leaving (2) untouched -- the SAME
   * 'exit'/'error' listeners remain registered throughout and will still
   * genuinely untrack the handle whenever (however much later) the real
   * event eventually fires.
   * @param {number} deadlineMs absolute ms epoch the caller's own remaining startup time
   *   expires at -- the post-signal confirmation bound is the LESSER of whatever remains of
   *   THIS and its own explicit per-observer ceiling (OBSERVER_KILL_CONFIRM_TIMEOUT_MS), never
   *   the full remaining window alone (a generous remaining budget must never let one probe's
   *   confirmation wait far longer than section5's own ~2s observer scale) and never an
   *   independent fixed constant ignoring the deadline either.
   */
  // P1-A / sequence146 correction (finding P1A-145-02): an explicit
  // per-observer confirmation ceiling, reintroduced -- the prior round's own
  // pure deadlineMs-derived confirm bound (finding P1A-144-03) correctly
  // stopped IGNORING the caller's remaining startup time, but a single probe
  // could then wait far beyond section5's own "2s maximum" per-observer scale
  // whenever that remaining window happened to be generous. Math.min against
  // THIS fixed ceiling (below) closes that gap without reopening the
  // original one: the confirmation bound is now the LESSER of "whatever
  // remains of the caller's own deadline" and "this small, fixed, ~1s
  // ceiling" -- never either alone.
  const OBSERVER_KILL_CONFIRM_TIMEOUT_MS = 1000;

  function runBoundedOwnedObserverProcess(psPath, args, fixedEnv, boundMs, observerJobs, deadlineMs) {
    return new Promise((resolve) => {
      let promiseSettled = false;
      let child;
      try {
        child = spawn(psPath, args, {
          shell: false, env: fixedEnv, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
        });
      } catch (err) {
        resolve({ ok: false });
        return;
      }
      observerJobs.add(child);
      let stdoutBytes = '';
      let killTimer = null;
      let killConfirmTimer = null;
      // P1-A / sequence145 correction (finding P1A-144-03): the ONLY action
      // that ever removes this exact handle from observerJobs -- called
      // exclusively by a genuine 'exit'/'error' event, never by a
      // confirmation timeout giving up on waiting for one.
      function untrackOnGenuineSettlement() {
        observerJobs.delete(child);
      }
      function resolvePromiseOnce(result) {
        if (promiseSettled) return;
        promiseSettled = true;
        if (killTimer) clearTimeout(killTimer);
        if (killConfirmTimer) clearTimeout(killConfirmTimer);
        resolve(result);
      }
      if (child.stdout) child.stdout.on('data', (chunk) => { stdoutBytes += chunk.toString('utf8'); });
      child.once('error', (err) => {
        untrackOnGenuineSettlement();
        resolvePromiseOnce({ ok: false });
      });
      child.once('exit', (code) => {
        untrackOnGenuineSettlement();
        resolvePromiseOnce(code === 0 ? { ok: true, text: stdoutBytes.trim() } : { ok: false });
      });
      killTimer = setTimeout(() => {
        // Exact-handle bounded termination: this OWN observer process only,
        // never the inspected pid -- mirrors stopOwnedAppServerChildBounded's
        // own confirmed-kill discipline, just without a cooperative TERM phase
        // first (a `ps` probe has no meaningful graceful-shutdown state).
        try { child.kill('SIGKILL'); } catch (err) { /* best-effort */ }
        // P1-A / sequence145-146 correction (findings P1A-144-03/P1A-145-02):
        // the confirmation window is the LESSER of whatever remains of the
        // caller's own deadlineMs (the initial kill-signal bound, boundMs
        // above, already draws from the SAME deadline too) and this probe's
        // own explicit OBSERVER_KILL_CONFIRM_TIMEOUT_MS ceiling -- never the
        // full remaining window alone (which could let one probe's
        // confirmation wait far longer than section5's own ~2s observer
        // scale whenever the caller's own remaining budget happens to be
        // generous) and never an independent fixed constant ignoring the
        // deadline either (the original finding this round re-corrects). If
        // the caller's own budget is already fully spent by the time the
        // kill fires, this settles at 0ms (immediately, next tick) rather
        // than borrowing extra time nothing authorized.
        const confirmBoundMs = Math.max(0, Math.min(OBSERVER_KILL_CONFIRM_TIMEOUT_MS, deadlineMs - Date.now()));
        killConfirmTimer = setTimeout(() => {
          // P1-A / sequence145 correction (finding P1A-144-03): resolves
          // THIS probe's own caller-facing Promise (observeOwnedChildBornProvenance
          // must never hang) but deliberately does NOT call
          // untrackOnGenuineSettlement -- observerJobs keeps this exact
          // handle admitted; a confirmation timeout is resource uncertainty,
          // never proof the handle actually disappeared. The 'exit'/'error'
          // listeners above remain registered and will still genuinely
          // untrack it the moment a real settlement eventually happens.
          resolvePromiseOnce({ ok: false });
        }, confirmBoundMs);
      }, Math.max(0, boundMs));
    });
  }

  /**
   * P1-A (sequence123-codex-r129-binding.md section5, "Ownership and BORN") /
   * sequence143 correction (finding P1A-142-03): the owned-app-server BORN
   * record's own pgid/os_birth_token/executable_path triple, ALL observed
   * against the exact CHILD pid this coordinator itself spawned -- never the
   * supervisor's own pid substituted for any of them. On Darwin/other
   * ps-based POSIX hosts, each probe is a genuinely owned, tracked child and
   * is bounded by the LESSER of 2s and the remaining startup time. On Linux,
   * the same facts come directly from the kernel-owned procfs records for the
   * PID, avoiding a basename-only `ps comm` result and any observer process.
   * Birth is observed TWICE, bracketing the PGID
   * and executable-identity observations, and BOTH birth reads must be
   * genuinely PRESENT and agree byte-for-byte -- a missing/absent second
   * observation is treated as a genuine proof failure, never silently
   * accepted (an absence is equally consistent with a race that stopped the
   * child before verification finished; runOwnedStopTimeline's own stage1
   * defers stopping any child still present in bornVerificationPending
   * specifically so this genuine child-pid observation never has to race it
   * in practice, but this function itself still fails closed defensively
   * either way, never trusting an unprovable absence). The executable
   * identity actually running is compared byte-for-byte against
   * `expectedExecutableIdentity` (this coordinator's own realpath'd spawn
   * command) -- a mismatch is a genuine proof failure, never silently
   * ignored. Never signals the INSPECTED pid itself (only the separate,
   * short-lived `ps` probes on ps-based hosts are ever started/bounded/killed
   * here). Returns {ok:false} (never throws, never fabricates a value) if
   * any observation is unavailable, times out, is absent, or disagrees.
   * @param {number} pid the exact owned child's own pid.
   * @param {string} expectedExecutableIdentity the realpath this coordinator itself asked to spawn.
   * @param {number} deadlineMs absolute ms epoch this coordinator's own remaining startup time expires at.
   * @param {Set<object>} observerJobs the coordinator's own admitted-job tracking Set.
   * @returns {Promise<{ok:true,birthToken:string,pgid:number,executableIdentity:string}|{ok:false}>}
   */
  async function observeOwnedChildBornProvenance(pid, expectedExecutableIdentity, deadlineMs, observerJobs) {
    if (process.platform === 'win32') {
      const remainingBound = () => Math.max(1, Math.min(2000, deadlineMs - Date.now()));
      // Each rejection names its own step. The acceptance conditions below are IDENTICAL to the
      // ones this branch has always enforced -- two PRESENT observations, a stable birth token, a
      // stable observed executable, and an exact match against the host-approved executable. Only
      // the failure DESCRIPTION changed, so a live rejection can be told apart from the others.
      const firstBoundMs = remainingBound();
      const first = observeWindowsProcessIdentity(pid, firstBoundMs);
      if (first.status !== 'PRESENT') {
        return {
          ok: false,
          reason: 'first-observation-' + String(first.status).toLowerCase(),
          subReason: first.subReason || null,
          detail: { pid, boundMs: firstBoundMs, latencyMs: first.latencyMs },
        };
      }
      const secondBoundMs = remainingBound();
      const second = observeWindowsProcessIdentity(pid, secondBoundMs);
      if (second.status !== 'PRESENT') {
        return {
          ok: false,
          reason: 'second-observation-' + String(second.status).toLowerCase(),
          subReason: second.subReason || null,
          detail: { pid, boundMs: secondBoundMs, latencyMs: second.latencyMs, firstLatencyMs: first.latencyMs },
        };
      }
      if (second.birthToken !== first.birthToken) {
        return { ok: false, reason: 'birth-token-drift', subReason: null, detail: { pid } };
      }
      if (second.executableIdentity.toLowerCase() !== first.executableIdentity.toLowerCase()) {
        return { ok: false, reason: 'observed-executable-drift', subReason: null, detail: { pid } };
      }
      if (first.executableIdentity.toLowerCase() !== expectedExecutableIdentity.toLowerCase()) {
        return {
          ok: false,
          reason: 'expected-executable-mismatch',
          subReason: null,
          detail: { pid, observed: first.executableIdentity, expected: expectedExecutableIdentity },
        };
      }
      // Windows has no POSIX process-group id. The schema keeps one positive
      // process scope identifier across platforms; on Windows the exact owned
      // child PID is that scope and shutdown remains handle/PID based.
      return {
        ok: true, birthToken: first.birthToken, pgid: pid, executableIdentity: first.executableIdentity,
      };
    }
    if (process.platform === 'linux') {
      const first = observeLinuxProcessBirth(pid);
      if (first.status !== 'PRESENT') return { ok: false };
      let executableIdentity;
      try {
        executableIdentity = fs.realpathSync('/proc/' + String(pid) + '/exe');
      } catch (err) {
        return { ok: false };
      }
      if (executableIdentity !== expectedExecutableIdentity) return { ok: false };
      const second = observeLinuxProcessBirth(pid);
      if (
        second.status !== 'PRESENT' || second.birthToken !== first.birthToken
        || second.pgid !== first.pgid
      ) return { ok: false };
      return {
        ok: true, birthToken: first.birthToken, pgid: first.pgid, executableIdentity,
      };
    }
    const psPath = resolvedPsPath();
    if (!psPath) return { ok: false };
    const fixedEnv = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', PATH: getIsolatedPathPosix() };
    const boundNow = () => Math.max(0, Math.min(2000, deadlineMs - Date.now()));

    const firstBirth = await runBoundedOwnedObserverProcess(psPath, ['-o', 'lstart=', '-p', String(pid)], fixedEnv, boundNow(), observerJobs, deadlineMs);
    if (!firstBirth.ok || firstBirth.text.length === 0) return { ok: false };

    // P1-A (section5) / sequence143 correction (finding P1A-142-03): PGID is
    // now observed against the exact CHILD pid section5 requires -- a prior
    // round incorrectly substituted the supervisor's own pid here to dodge a
    // race against this SAME coordinator's own concurrent stage1. That race
    // is now closed architecturally instead (stage1 defers stopping any
    // child still present in bornVerificationPending -- see
    // runOwnedStopTimeline's own stage1 comment), so this genuine
    // child-pid-based observation section5 requires never actually needs to
    // race stage1 in practice.
    const pgidObservation = await runBoundedOwnedObserverProcess(psPath, ['-o', 'pgid=', '-p', String(pid)], fixedEnv, boundNow(), observerJobs, deadlineMs);
    const parsedPgid = pgidObservation.ok ? parseInt(pgidObservation.text, 10) : NaN;
    if (!Number.isInteger(parsedPgid) || parsedPgid <= 0) return { ok: false };

    // P1-A (section5): "match the host-approved executable to observed BORN
    // provenance". Linux returns through its procfs branch above; macOS uses
    // the trusted `ps` surface, `-o comm=`. Empirically confirmed
    // (both against a plain, non-symlink binary and a real spawned Node child
    // launched via a symlinked `node` on PATH -- exactly what
    // resolveAppServerSpawnCommand's own `command -v`-style resolution can
    // legitimately hand back) that macOS `ps -o comm=` reports the exec path
    // AS INVOKED, not eagerly dereferenced -- so a byte-for-byte compare
    // against expectedExecutableIdentity (already realpath'd by the caller)
    // would spuriously fail for a perfectly genuine BORN child spawned via a
    // symlinked path (e.g. a homebrew/nvm-managed `node`). Both sides are
    // therefore realpath'd here before comparison, so this proves the SAME
    // canonical on-disk executable regardless of which convention `ps` or
    // resolveAppServerSpawnCommand happen to use. A comm value that no longer
    // resolves (process already gone, or ps reported something unresolvable)
    // is a genuine proof failure, never a crash.
    let observedExecutableRealpath;
    const executableObservation = await runBoundedOwnedObserverProcess(psPath, ['-o', 'comm=', '-p', String(pid)], fixedEnv, boundNow(), observerJobs, deadlineMs);
    if (!executableObservation.ok || executableObservation.text.length === 0) return { ok: false };
    try {
      observedExecutableRealpath = fs.realpathSync(executableObservation.text);
    } catch (err) {
      return { ok: false };
    }
    if (observedExecutableRealpath !== expectedExecutableIdentity) return { ok: false };

    // P1-A (section5): "Reobserve birth around PGID and require consistency
    // with the original BORN observation" -- a SECOND, independent lstart=
    // read, bracketing the pgid=/comm= reads, must be genuinely PRESENT and
    // agree byte-for-byte with the first. sequence143 correction (finding
    // P1A-142-03): a missing/absent second observation is now itself treated
    // as a genuine proof failure ("do not... accept missing reobservation")
    // -- never silently accepted as "no reuse risk" the way a prior round
    // did; the honest response to an unprovable reobservation is to fail
    // this whole probe closed, never to fabricate a completed proof from an
    // incomplete one.
    const secondBirth = await runBoundedOwnedObserverProcess(psPath, ['-o', 'lstart=', '-p', String(pid)], fixedEnv, boundNow(), observerJobs, deadlineMs);
    if (!secondBirth.ok || secondBirth.text.length === 0 || secondBirth.text !== firstBirth.text) return { ok: false };

    return { ok: true, birthToken: firstBirth.text, pgid: parsedPgid, executableIdentity: observedExecutableRealpath };
  }

  return Object.freeze({ runBoundedOwnedObserverProcess, observeOwnedChildBornProvenance });
}

module.exports = Object.freeze({ createOwnedChildProvenance });
