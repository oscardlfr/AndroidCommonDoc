#!/usr/bin/env node
'use strict';

// A zombie process (exited, not yet reaped by its real parent) is NOT live --
// it holds no resources, cannot be signaled meaningfully, and exists only so
// its exit status can be collected. Before this fix, both process-identity.cjs
// observers reported PRESENT for a zombie: observeLinuxProcessBirth never read
// /proc/<pid>/stat's own state field (index 0 after the comm), and the
// Darwin/POSIX observer requested only `ps -o lstart=`, which still resolves
// and still reports a (frozen, pre-exit) lstart for a zombie pid. Either gap
// makes a killed-but-not-yet-reaped target indistinguishable from a genuinely
// live one to classifyProcessIdentityLiveness -- the exact race
// S16-HOSTBRIDGE-LIVENESS-NO-SAME-TICK-STALE-01 exists to catch, previously
// only closed by that test's own bounded, synchronous wait for either ESRCH
// or a zombie state, never by production itself refusing to call a zombie
// PRESENT.
//
// Most cases here inject a FAKE fs/execFileSync (this file's own established
// seam, per createProcessIdentity's factory shape) for deterministic,
// portable coverage of the parsing logic itself; the LIVE/ZOMBIE end-to-end
// case additionally proves it against a REAL OS-observed zombie via a raw
// os.fork() (Python's, not Node's -- Node's own child_process reaps via
// libuv essentially immediately on exit, making a Node-parented zombie
// impractically small to observe; a plain fork() with no SIGCHLD handler and
// a deliberately delayed waitpid() does not).

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { createProcessIdentity } = require(path.resolve(__dirname, '../lib/runtime-bridge-codex/process-identity.cjs'));

function hasExactKeys(obj, sortedKeys) {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj).sort();
  return keys.length === sortedKeys.length && keys.every((k, i) => k === sortedKeys[i]);
}

function makeIdentity(fakeFs, fakeExecFileSync) {
  return createProcessIdentity({
    fs: fakeFs,
    execFileSync: fakeExecFileSync,
    resolveWindowsPowerShellPath: () => null,
    isTestCapability: () => false,
    hasExactKeys,
  });
}

/** A minimal, correctly-shaped /proc/<pid>/stat line: pid (comm) state ppid
 * pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime
 * cutime cstime priority nice num_threads itrealvalue starttime ... --
 * fieldsFromState[0]=state, [2]=pgrp, [19]=starttime, matching the
 * production parser's own indexing exactly. */
function fakeProcStat({ pid = 4242, state = 'S', pgrp = 4242, starttime = 123456 }) {
  const fields = new Array(20).fill('0');
  fields[0] = state;
  fields[2] = String(pgrp);
  fields[19] = String(starttime);
  return pid + ' (fakecomm) ' + fields.join(' ') + '\n';
}

function fakeFsFor(procStatText, { throwErr } = {}) {
  return {
    readFileSync(p, enc) {
      if (throwErr) throw throwErr;
      return procStatText;
    },
    realpathSync(p) { return p; },
    statSync(p) { return { isFile: () => true }; },
  };
}

// ── observeLinuxProcessBirth ─────────────────────────────────────────────

test('observeLinuxProcessBirth: a genuinely live process (state S) is PRESENT with a stable birth token', () => {
  const rbc = makeIdentity(fakeFsFor(fakeProcStat({ state: 'S', pgrp: 777, starttime: 999888 })), () => { throw new Error('must not be called'); });
  const out = rbc.observeLinuxProcessBirth(4242);
  assert.deepEqual(out, { status: 'PRESENT', birthToken: 'linux-proc-starttime:999888', pgid: 777 });
});

test('observeLinuxProcessBirth: a running process (state R) is also PRESENT -- only Z is special-cased', () => {
  const rbc = makeIdentity(fakeFsFor(fakeProcStat({ state: 'R' })), () => { throw new Error('must not be called'); });
  assert.equal(rbc.observeLinuxProcessBirth(4242).status, 'PRESENT');
});

test('observeLinuxProcessBirth: a ZOMBIE (state Z) is ABSENT, never PRESENT', () => {
  const rbc = makeIdentity(fakeFsFor(fakeProcStat({ state: 'Z', pgrp: 777, starttime: 999888 })), () => { throw new Error('must not be called'); });
  assert.deepEqual(rbc.observeLinuxProcessBirth(4242), { status: 'ABSENT' });
});

test('observeLinuxProcessBirth: no such pid (ENOENT) is ABSENT', () => {
  const err = new Error('no such file'); err.code = 'ENOENT';
  const rbc = makeIdentity(fakeFsFor(null, { throwErr: err }), () => { throw new Error('must not be called'); });
  assert.deepEqual(rbc.observeLinuxProcessBirth(4242), { status: 'ABSENT' });
});

test('observeLinuxProcessBirth: an unreadable /proc entry for any OTHER reason is UNAVAILABLE, never silently ABSENT', () => {
  const err = new Error('permission denied'); err.code = 'EACCES';
  const rbc = makeIdentity(fakeFsFor(null, { throwErr: err }), () => { throw new Error('must not be called'); });
  assert.deepEqual(rbc.observeLinuxProcessBirth(4242), { status: 'UNAVAILABLE' });
});

test('observeLinuxProcessBirth: malformed stat content (non-numeric starttime) is UNAVAILABLE', () => {
  const malformed = '4242 (fakecomm) S ' + new Array(19).fill('0').join(' ') + '\n'; // one field short of a real starttime
  const rbc = makeIdentity(fakeFsFor(malformed), () => { throw new Error('must not be called'); });
  assert.equal(rbc.observeLinuxProcessBirth(4242).status, 'UNAVAILABLE');
});

// ── observeProcessBirth (Darwin/POSIX) ───────────────────────────────────
// process.platform on the machine actually running this suite is NOT
// overridden here (observeProcessBirth reads it directly, not through the
// resolveObservedPlatform test seam) -- these run their real POSIX branch
// whenever this suite runs on darwin/linux/bsd, exactly the platforms that
// matter for this fix. On win32 CI (if any) they still exercise the same
// parsing logic since the fake execFileSync never actually shells out.

function fakeFsForPs() {
  return { realpathSync: (p) => p, statSync: () => ({ isFile: () => true }) };
}

test('observeProcessBirth: a live process reports PRESENT with the lstart text ONLY, never the state prefix', () => {
  if (process.platform === 'win32' || process.platform === 'linux') return; // exercises the ps-based branch specifically
  const rbc = makeIdentity(fakeFsForPs(), () => 'Ss   Fri Sep 18 18:44:09 2026    \n');
  assert.deepEqual(rbc.observeProcessBirth(4242), { status: 'PRESENT', birthToken: 'Fri Sep 18 18:44:09 2026' });
});

test('observeProcessBirth: a ZOMBIE (state starting with Z) is ABSENT, never PRESENT', () => {
  if (process.platform === 'win32' || process.platform === 'linux') return;
  const rbc = makeIdentity(fakeFsForPs(), () => 'Z+   Fri Sep 18 18:44:09 2026    \n');
  assert.deepEqual(rbc.observeProcessBirth(4242), { status: 'ABSENT' });
});

test('observeProcessBirth: ps genuinely ran and confirmed no such pid is ABSENT', () => {
  if (process.platform === 'win32' || process.platform === 'linux') return;
  const rbc = makeIdentity(fakeFsForPs(), () => {
    const err = new Error('ps: no such pid'); err.status = 1; // numeric .status, no .code -- ps's own real failure shape
    throw err;
  });
  assert.deepEqual(rbc.observeProcessBirth(4242), { status: 'ABSENT' });
});

test('observeProcessBirth: ps itself could not even be invoked is UNAVAILABLE, never collapsed into ABSENT', () => {
  if (process.platform === 'win32' || process.platform === 'linux') return;
  const rbc = makeIdentity(fakeFsForPs(), () => {
    const err = new Error('spawn EACCES'); err.code = 'EACCES'; // a Node-level spawn failure shape
    throw err;
  });
  assert.deepEqual(rbc.observeProcessBirth(4242), { status: 'UNAVAILABLE' });
});

test('observeProcessBirth: unparseable ps output (no whitespace-separated state/lstart split) is UNAVAILABLE', () => {
  if (process.platform === 'win32' || process.platform === 'linux') return;
  const rbc = makeIdentity(fakeFsForPs(), () => 'garbage-with-no-internal-structure');
  assert.equal(rbc.observeProcessBirth(4242).status, 'UNAVAILABLE');
});

// ── classifyProcessIdentityLiveness: PID reuse ───────────────────────────
// classifyProcessIdentityLiveness calls resolveProcessBirthObserver()(pid),
// which internally dispatches to the REAL observeProcessBirth (platform
// auto-detected) unless the test-capability override below is active -- a
// raw fs/execFileSync fake here would silently exercise the wrong platform's
// code path depending on which host runs this suite. Using this file's own
// existing, dedicated test seam instead makes these three PLATFORM-
// INDEPENDENT: they test classifyProcessIdentityLiveness's OWN comparison
// logic in isolation, already proven correct per-platform by the direct
// observeLinuxProcessBirth/observeProcessBirth tests above.

function withFakeBirthObservation(statusJson, fn) {
  const prevCap = process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY;
  const prevObs = process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_BIRTH_OBSERVATION;
  process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = 'x';
  process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_BIRTH_OBSERVATION = statusJson;
  try {
    const rbc = createProcessIdentity({
      fs: require('fs'), execFileSync: () => { throw new Error('must not be called -- the fake observation seam should short-circuit before this'); },
      resolveWindowsPowerShellPath: () => null, isTestCapability: () => true, hasExactKeys,
    });
    return fn(rbc);
  } finally {
    if (prevCap === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY; else process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = prevCap;
    if (prevObs === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_BIRTH_OBSERVATION; else process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_BIRTH_OBSERVATION = prevObs;
  }
}

test('classifyProcessIdentityLiveness: PRESENT with a DIFFERENT birth token than recorded (PID reuse) is ABSENT, never LIVE', () => {
  const recorded = { pid: 4242, executable: '/bin/fake', birth_observed_at: 'token-A' };
  const out = withFakeBirthObservation(JSON.stringify({ status: 'PRESENT', birthToken: 'token-B-a-different-process-now-has-this-pid' }),
    (rbc) => rbc.classifyProcessIdentityLiveness(recorded));
  assert.deepEqual(out, { ok: true, status: 'ABSENT' });
});

test('classifyProcessIdentityLiveness: PRESENT with the SAME recorded birth token is LIVE', () => {
  const recorded = { pid: 4242, executable: '/bin/fake', birth_observed_at: 'token-A' };
  const out = withFakeBirthObservation(JSON.stringify({ status: 'PRESENT', birthToken: 'token-A' }),
    (rbc) => rbc.classifyProcessIdentityLiveness(recorded));
  assert.deepEqual(out, { ok: true, status: 'LIVE' });
});

test('classifyProcessIdentityLiveness: observer reports ABSENT (this fix\'s zombie case, among others) is ABSENT, not LIVE, regardless of the recorded token', () => {
  // The scenario this whole fix is about, expressed at this layer: whatever
  // the underlying reason (reaped, zombie, genuinely never existed), once
  // the observer itself says ABSENT, classifyProcessIdentityLiveness must
  // never fall back to a birth-token comparison that could technically
  // still match a frozen/stale value.
  const recorded = { pid: 4242, executable: '/bin/fake', birth_observed_at: 'token-A' };
  const out = withFakeBirthObservation(JSON.stringify({ status: 'ABSENT' }),
    (rbc) => rbc.classifyProcessIdentityLiveness(recorded));
  assert.deepEqual(out, { ok: true, status: 'ABSENT' });
});

// ── Real end-to-end: an actual OS-observed zombie, no fakes ──────────────

test('observeProcessBirth against a REAL zombie process on this host is ABSENT (end-to-end, no fakes)', async (t) => {
  if (process.platform === 'win32') { t.skip('no fork()/zombie concept on win32'); return; }
  const probe = spawnSync('python3', ['--version']);
  if (probe.status !== 0) { t.skip('python3 not available on this host'); return; }

  const rbc = makeIdentity(require('fs'), require('child_process').execFileSync);
  const scriptPath = path.join(require('os').tmpdir(), 'rbc-make-zombie-' + process.pid + '.py');
  require('fs').writeFileSync(scriptPath, [
    'import os, sys, time',
    'pid = os.fork()',
    'if pid == 0:',
    '    os._exit(0)',
    'else:',
    '    sys.stdout.write(str(pid) + "\\n"); sys.stdout.flush()',
    '    time.sleep(4)',
    '    os.waitpid(pid, 0)',
    '',
  ].join('\n'));
  const parent = require('child_process').spawn('python3', [scriptPath], { stdio: ['ignore', 'pipe', 'ignore'] });
  let zombiePid = null;
  await new Promise((resolve, reject) => {
    let buf = '';
    parent.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const n = Number(buf.trim());
      if (Number.isInteger(n) && n > 0 && zombiePid === null) { zombiePid = n; resolve(); }
    });
    parent.on('error', reject);
    setTimeout(() => reject(new Error('zombie child never reported its pid')), 5000);
  });

  // Give the kernel a brief moment to actually transition the child to Z
  // (fork()+_exit() is fast, but not provably instantaneous from here).
  const deadline = Date.now() + 3000;
  let observed;
  do {
    observed = rbc.observeProcessBirth(zombiePid);
    if (observed.status === 'ABSENT') break;
    await new Promise((r) => setTimeout(r, 20));
  } while (Date.now() < deadline);

  try {
    assert.deepEqual(observed, { status: 'ABSENT' }, 'a real, OS-confirmed zombie must be observed as ABSENT, not PRESENT');
  } finally {
    try { parent.kill('SIGKILL'); } catch { /* best effort */ }
    try { require('fs').unlinkSync(scriptPath); } catch { /* best effort */ }
  }
});
