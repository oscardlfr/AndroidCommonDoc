#!/usr/bin/env node
'use strict';

// Signal-handling for run-bats-sharded.cjs: SIGINT/SIGTERM/SIGHUP must block
// new shards, signal every LIVE child's whole process group (not just the
// direct child -- run-bats.sh chains through npm/bats/bats-exec-suite/
// bats-exec-file/bats-exec-test, a real multi-level tree observed directly
// during this branch's own development), wait boundedly, escalate only
// survivors to SIGKILL, remove every run-scoped artifact this invocation
// created, and exit 128+signum without ever publishing a handoff production
// tooling could accept.
//
// Tested against a FAKE run-bats.sh, not the real one (instruction: do not
// touch or redesign the real script/protocol). The fake stands at a
// throwaway --project-root so plan-bats-shards.cjs (symlinked in, genuinely
// unmodified) still does real discovery/planning against a real *.bats file,
// but the "child" that actually runs is fully under this test's control:
// it proves it is alive by creating a marker file, a shim-like directory,
// and a TMPDIR-like directory, then either traps SIGTERM to clean all three
// up (the "graceful" case) or ignores SIGTERM entirely (the "stubborn"
// case, which must force this tool's own SIGKILL escalation to fire).
//
// Wait bounds are overridable via env vars specifically so this suite stays
// fast without changing production's own generous defaults.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');

const REAL_ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(REAL_ROOT, 'scripts', 'tools', 'run-bats-sharded.cjs');
const REAL_PLANNER = path.join(REAL_ROOT, 'scripts', 'tools', 'plan-bats-shards.cjs');
const rbs = require(TOOL);

const created = [];
test.after(() => {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// Safety net, not the behavior under test: every test below sends its own
// signal only after its setup asserts succeed, so a failing setup assertion
// (thrown before that point) would otherwise leave the spawned orchestrator
// -- and, transitively, its own detached fixture process group -- running
// forever, orphaned once this file's node process exits. Observed for real:
// an earlier debugging run of this exact suite left 4 such orchestrators
// running against dead fixture roots, discovered only via a manual `ps`
// sweep. This does not affect what a passing test verifies; it only bounds
// the damage a failing one can do.
const spawnedChildren = [];
test.afterEach(() => {
  for (const child of spawnedChildren) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
  }
  spawnedChildren.length = 0;
  for (const root of created) {
    let dir;
    try { dir = path.join(root, '.androidcommondoc'); if (!fs.existsSync(dir)) continue; } catch { continue; }
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.alive')) continue;
      let pid;
      try { pid = Number(fs.readFileSync(path.join(dir, f), 'utf8').trim().split(' ')[1]); } catch { continue; }
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  }
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/** main() now freezes `git -C root rev-parse HEAD` before launching any
 * shard (validateShardResult holds every shard to that exact value, never
 * merely to each other's) -- a throwaway fixture root must therefore be a
 * real, minimal git repo, not just a plain directory, or main() fails before
 * ever reaching the behavior under test. */
function initFakeGitRepo(root) {
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed in fixture root: ' + r.stderr);
  };
  run(['init', '--quiet']);
  run(['config', 'user.email', 'rbs-signal-fixture@example.invalid']);
  run(['config', 'user.name', 'rbs-signal-fixture']);
  run(['commit', '--quiet', '--allow-empty', '-m', 'rbs-signal-fixture root']);
}

/** A throwaway project root: real planner (symlinked, untouched), a fake
 * run-bats.sh this test fully controls, one real *.bats file so discovery
 * has something to shard. */
function makeFakeProjectRoot(trapMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-signal-fixture-'));
  created.push(root);
  initFakeGitRepo(root);
  fs.mkdirSync(path.join(root, 'scripts', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'sh'), { recursive: true });
  fs.mkdirSync(path.join(root, 'suite'), { recursive: true });
  fs.symlinkSync(REAL_PLANNER, path.join(root, 'scripts', 'tools', 'plan-bats-shards.cjs'));
  fs.writeFileSync(path.join(root, 'suite', 'fake.bats'), '#!/usr/bin/env bats\n\n@test "irrelevant" {\n  true\n}\n');

  // Mirrors run-bats.sh's OWN real argv shape (--project-root, --log, then
  // file targets) closely enough for run-bats-sharded.cjs's spawn call and
  // stderr-parsing (extractHandoffPath) to work unmodified -- this test
  // exercises the orchestrator's real code path, not a stand-in for it.
  const fakeScript = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    'LOG=""',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    --log) LOG="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    // The real run-bats.sh writes bats' own TAP output to $LOG directly, so
    // it always exists once a shard is genuinely running. This fake script
    // must too: markerPathsFor() below discovers the shard's OWN paths by
    // matching the "suite-bats.shard0." prefix, and without a real anchor
    // file at that exact bare name, the marker/shim/tmpdir directories (which
    // share that same prefix) are themselves ambiguous candidates -- found
    // empirically: omitting this line made the harness fail every single
    // time, not flakily, because none of the three ever won a undefined
    // filesystem enumeration order against the thing it should have anchored on.
    'echo "TAP placeholder" > "$LOG"',
    'MARKER="${LOG}.alive"',
    'SHIM_DIR="${LOG}.shim"',
    'TMPDIR_LIKE="${LOG}.tmpdir"',
    'GRANDCHILD_MARKER="${LOG}.grandchild-alive"',
    'mkdir -p "$SHIM_DIR" "$TMPDIR_LIKE"',
    'echo "alive $$" > "$MARKER"',
    // A real grandchild, not just this one process: run-bats.sh's own real
    // descendant chain is bash -> npm -> bats -> bats-exec-suite ->
    // bats-exec-file -> bats-exec-test (observed directly during this
    // branch's development). Signaling only the direct child's PID -- not
    // its process GROUP -- would leave this exact shape of descendant
    // running as an orphan, which is precisely the defect detached:true plus
    // a negative-pid kill() exists to close. A fixture with no children of
    // its own could not tell the two apart: a lone process's "group" and
    // "itself" are the same thing, so this line is load-bearing for the test,
    // not decoration.
    '(echo "grandchild-alive $$" > "$GRANDCHILD_MARKER"; trap \'rm -f "$GRANDCHILD_MARKER"; exit 143\' TERM; while true; do sleep 0.05; done) &',
    'GRANDCHILD_PID=$!',
    'echo "$GRANDCHILD_PID" > "${LOG}.grandchild-pid"',
    trapMode === 'graceful'
      ? 'trap \'rm -f "$MARKER"; rm -rf "$SHIM_DIR" "$TMPDIR_LIKE"; exit 143\' TERM'
      : 'trap \'\' TERM',
    'while true; do sleep 0.05; done',
    '',
  ].join('\n');
  const scriptPath = path.join(root, 'scripts', 'sh', 'run-bats.sh');
  fs.writeFileSync(scriptPath, fakeScript, { mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);

  return root;
}

function runOrchestrator(root, extraEnv) {
  const child = spawn('node', [
    TOOL, '--project-root', root, '--suite-root', path.join(root, 'suite'),
    '--shard-count', '1', '--max-parallel', '1',
  ], {
    cwd: REAL_ROOT, // git hash-object needs a real repo underfoot; matches production's own un-cwd'd call
    env: Object.assign({}, process.env, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  // Drained (never left as an unread pipe -- exactly the class of bug this
  // whole signal-handling effort started from) and kept for diagnostics on
  // an assertion failure, not printed on the happy path.
  child.__stderr = '';
  child.stderr.on('data', (d) => { child.__stderr += d.toString('utf8'); });
  child.stdout.on('data', () => {});
  // Attached HERE, not lazily right before a test awaits it: the fix under
  // test can complete a full shutdown in well under 100ms (measured), so a
  // 'close' listener registered even one `await` later can genuinely miss
  // an event that already fired -- EventEmitter never replays a past event
  // to a listener added after the fact. Found the hard way: a test sending
  // a second signal 100ms after the first consistently timed out waiting for
  // 'close', even though child.exitCode was already set by the time the
  // second signal was sent -- the process had already exited; nothing was
  // listening yet.
  child.__closed = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  return child;
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function markerPathsFor(root) {
  // Matches the fake script's own derivation exactly: shard0's log path is
  // deterministic given shard-count=1, stamp aside -- discovered via glob
  // instead of recomputing the timestamp, since that is the orchestrator's
  // own implementation detail, not this test's to duplicate.
  const dir = path.join(root, '.androidcommondoc');
  if (!fs.existsSync(dir)) return { marker: null, shim: null, tmpdirLike: null, dir };
  // Matches the BARE shard log filename only (ends in .log, nothing after)
  // -- not merely a shared prefix, which .alive/.shim/.tmpdir also satisfy
  // and which made this discovery ambiguous depending on readdirSync's
  // unspecified enumeration order.
  const shardLog = fs.readdirSync(dir).find((f) => /^suite-bats\.shard0\.[^.]+\.log$/.test(f));
  if (!shardLog) return { marker: null, shim: null, tmpdirLike: null, dir };
  const base = path.join(dir, shardLog);
  return {
    marker: base + '.alive', shim: base + '.shim', tmpdirLike: base + '.tmpdir', dir, shardLogPath: base,
    grandchildMarker: base + '.grandchild-alive', grandchildPidFile: base + '.grandchild-pid',
  };
}

function readGrandchildPid(paths) {
  if (!paths.grandchildPidFile || !fs.existsSync(paths.grandchildPidFile)) return null;
  const n = Number(fs.readFileSync(paths.grandchildPidFile, 'utf8').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

for (const [label, signal, expectedExitCode] of [['SIGINT', 'SIGINT', 130], ['SIGTERM', 'SIGTERM', 143]]) {
  test(label + ' against a GRACEFUL child: blocks new shards, propagates to the whole process group, cleans up, publishes nothing, exits ' + expectedExitCode, async () => {
    const root = makeFakeProjectRoot('graceful');
    const child = runOrchestrator(root, { RUN_BATS_SHARDED_GRACEFUL_WAIT_MS: '3000', RUN_BATS_SHARDED_KILL_WAIT_MS: '1000' });

    let paths = markerPathsFor(root);
    const becameAlive = await waitFor(() => {
      paths = markerPathsFor(root);
      return paths.marker && fs.existsSync(paths.marker);
    }, { timeoutMs: 8000 });
    assert.equal(becameAlive, true, 'the fake child never proved it was alive -- the harness itself is broken, not the fix under test. orchestrator stderr: ' + child.__stderr);

    const aliveContent = fs.readFileSync(paths.marker, 'utf8').trim();
    const childPid = Number(aliveContent.split(' ')[1]);
    assert.ok(Number.isInteger(childPid) && childPid > 0, 'could not read a real child PID from the marker');
    assert.equal(isPidAlive(childPid), true, 'the marker exists but the PID it names is not actually running');

    // The grandchild (a genuine descendant of the direct child, backgrounded
    // with `&`) is the whole point: it proves the signal reaches the PROCESS
    // GROUP, not merely the one PID Node itself spawned. Waited for
    // separately since it is written a moment after the parent's own marker.
    const grandchildAppeared = await waitFor(() => fs.existsSync(paths.grandchildPidFile), { timeoutMs: 3000 });
    assert.equal(grandchildAppeared, true, 'the fixture\'s own grandchild never started -- harness bug, not the fix under test');
    const grandchildPid = readGrandchildPid(paths);
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, 'could not read the grandchild PID');
    assert.notEqual(grandchildPid, childPid, 'the "grandchild" is the same process as the parent -- the harness never actually forked a descendant');
    assert.equal(isPidAlive(grandchildPid), true, 'the grandchild marker exists but its PID is not actually running');

    child.kill(signal);

    const closed = await Promise.race([
      child.__closed.then(() => true),
      sleep(10000).then(() => false),
    ]);
    assert.equal(closed, true, 'the orchestrator itself did not exit within the bound after ' + signal);
    assert.equal(child.exitCode, expectedExitCode, 'wrong exit code for ' + signal);

    assert.equal(isPidAlive(grandchildPid), false,
      'the GRANDCHILD survived -- the signal reached only the direct child, not its whole process group');
    assert.equal(fs.existsSync(paths.grandchildMarker), false, 'the grandchild\'s own marker still exists');

    assert.equal(isPidAlive(childPid), false, 'the fake child process is still alive -- signal did not propagate to its process group');
    assert.equal(fs.existsSync(paths.marker), false, 'the liveness marker still exists');
    assert.equal(fs.existsSync(paths.shim), false, 'the shim-like directory still exists');
    assert.equal(fs.existsSync(paths.tmpdirLike), false, 'the TMPDIR-like directory still exists');
    assert.equal(fs.existsSync(paths.shardLogPath), false, 'the shard log this run started still exists');

    const handoffs = fs.existsSync(paths.dir) ? fs.readdirSync(paths.dir).filter((f) => f.startsWith('bats-result.')) : [];
    assert.deepEqual(handoffs, [], 'no handoff of any kind must exist after an aborted run -- production must never see something it could accept');
  });
}

test('a STUBBORN child (ignores SIGTERM) is escalated to SIGKILL, not left running forever', async () => {
  const root = makeFakeProjectRoot('stubborn');
  const child = runOrchestrator(root, { RUN_BATS_SHARDED_GRACEFUL_WAIT_MS: '500', RUN_BATS_SHARDED_KILL_WAIT_MS: '1500' });

  let paths = markerPathsFor(root);
  const becameAlive = await waitFor(() => {
    paths = markerPathsFor(root);
    return paths.marker && fs.existsSync(paths.marker);
  }, { timeoutMs: 8000 });
  assert.equal(becameAlive, true, 'harness setup failed before the behavior under test was even reached. orchestrator stderr: ' + child.__stderr);
  const childPid = Number(fs.readFileSync(paths.marker, 'utf8').trim().split(' ')[1]);

  const start = Date.now();
  child.kill('SIGINT');
  const closed = await Promise.race([
    child.__closed.then(() => true),
    sleep(10000).then(() => false),
  ]);
  const elapsedMs = Date.now() - start;

  assert.equal(closed, true, 'orchestrator never exited -- escalation did not happen, a stubborn child hangs the whole tool forever');
  // Must take at least the graceful window (it genuinely waited before
  // escalating) but nowhere near the 10s outer bound (escalation, not a hang).
  assert.ok(elapsedMs >= 450, 'exited suspiciously fast (' + elapsedMs + 'ms) -- did it even attempt the graceful phase before killing?');
  assert.ok(elapsedMs < 6000, 'took ' + elapsedMs + 'ms -- escalation is not actually bounded');
  assert.equal(isPidAlive(childPid), false, 'the stubborn child survived even SIGKILL to its process group');
});

test('a child that never confirms dead (signaling had no real effect) is reported as a survivor, never as "shutdown complete"', async () => {
  // Deliberately a DIRECT, in-process call to requestShutdown, not a real
  // subprocess: a synthetic liveChildren entry that isn't backed by any real
  // OS process can never be signaled away and can never fire a real 'close'
  // event to remove itself -- exactly "the kill had no effect on the real
  // target" (a stale/reused process-group id, a signal that silently
  // missed), reproduced deterministically instead of racing a real process's
  // actual death against an arbitrarily short wait bound (empirically tried
  // first: even a 1ms RUN_BATS_SHARDED_KILL_WAIT_MS still reliably lost to a
  // real SIGKILL's confirmation, because the poll loop's own granularity
  // guarantees at least one full wait tick regardless of how short the
  // nominal deadline is).
  const prevGraceful = process.env.RUN_BATS_SHARDED_GRACEFUL_WAIT_MS;
  const prevKill = process.env.RUN_BATS_SHARDED_KILL_WAIT_MS;
  process.env.RUN_BATS_SHARDED_GRACEFUL_WAIT_MS = '20';
  process.env.RUN_BATS_SHARDED_KILL_WAIT_MS = '20';
  try {
    const state = rbs.createRunState();
    const neverDies = { pid: 999999999 }; // astronomically unlikely to be a real pid on this machine
    state.liveChildren.add(neverDies);
    let stderrOut = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => { stderrOut += chunk; return origWrite(chunk, ...rest); };
    try {
      await rbs.requestShutdown(state, 'SIGTERM');
    } finally {
      process.stderr.write = origWrite;
    }
    assert.ok(stderrOut.includes('FATAL:') && stderrOut.includes('survived SIGKILL escalation'),
      'a child that never confirms dead must be reported as a survivor. stderr: ' + stderrOut);
    assert.ok(!stderrOut.includes('shutdown complete after'),
      'must never claim "shutdown complete" while a child is not confirmed dead. stderr: ' + stderrOut);
    assert.deepEqual(state.shutdownSurvivors, [999999999]);
    assert.equal(state.liveChildren.size, 1, 'the never-clearing entry must still be tracked, not silently dropped');
  } finally {
    if (prevGraceful === undefined) delete process.env.RUN_BATS_SHARDED_GRACEFUL_WAIT_MS; else process.env.RUN_BATS_SHARDED_GRACEFUL_WAIT_MS = prevGraceful;
    if (prevKill === undefined) delete process.env.RUN_BATS_SHARDED_KILL_WAIT_MS; else process.env.RUN_BATS_SHARDED_KILL_WAIT_MS = prevKill;
  }
});

test('win32 is refused fail-closed before touching anything -- no plan, no shard, no directory created', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-signal-win32-'));
  created.push(root);
  initFakeGitRepo(root);
  fs.mkdirSync(path.join(root, 'suite'), { recursive: true });
  fs.writeFileSync(path.join(root, 'suite', 'fake.bats'), '#!/usr/bin/env bats\n\n@test "irrelevant" {\n  true\n}\n');
  // Deliberately NOT creating scripts/tools/plan-bats-shards.cjs or
  // scripts/sh/run-bats.sh: if the win32 check is not the very first thing
  // main() does, this fixture would fail for an unrelated reason (a missing
  // planner) instead of proving the platform gate specifically.
  const child = runOrchestrator(root, { RUN_BATS_SHARDED_TEST_PLATFORM: 'win32' });
  const closed = await Promise.race([child.__closed.then(() => true), sleep(8000).then(() => false)]);
  assert.equal(closed, true, 'orchestrator never exited on win32. stderr: ' + child.__stderr);
  assert.equal(child.exitCode, 2, 'win32 must fail closed with a distinct, non-signal exit code');
  assert.ok(child.__stderr.includes('UNSUPPORTED_PLATFORM:win32'), 'stderr: ' + child.__stderr);
  assert.equal(fs.existsSync(path.join(root, '.androidcommondoc')), false,
    'must refuse before creating any run-scoped directory, not merely before publishing');
});

test('a spawn-level failure (unresolvable bash command) is reported as an ordinary shard failure, never an uncaught crash', async () => {
  const root = makeFakeProjectRoot('graceful');
  const child = runOrchestrator(root, {
    RUN_BATS_SHARDED_TEST_BASH_CMD: 'rbs-signal-test-nonexistent-command-xyz123',
  });
  const closed = await Promise.race([child.__closed.then(() => true), sleep(8000).then(() => false)]);
  assert.equal(closed, true, 'orchestrator never exited after a spawn-level failure -- likely an uncaught "error" event crash, not a graceful one. stderr: ' + child.__stderr);
  // A crash from an unhandled 'error' event is a Node fatal exception, never
  // one of this tool's own SIGNAL_EXIT_CODE values (129/130/143) -- and
  // main().catch()'s own generic path (FATAL: ...) sets exitCode 1, so
  // asserting a non-zero, non-signal code plus the absence of a raw
  // Node stack trace distinguishes "handled as an ordinary shard failure"
  // from "the process itself blew up".
  assert.notEqual(child.exitCode, 0, 'an unresolvable bash command must not be silently treated as success');
  assert.ok(!child.__stderr.includes('internal/child_process'),
    'must never surface as a raw uncaught Node exception. stderr: ' + child.__stderr);
});

test('a second signal while already shutting down does not restart teardown or double-publish', async () => {
  const root = makeFakeProjectRoot('graceful');
  const child = runOrchestrator(root, { RUN_BATS_SHARDED_GRACEFUL_WAIT_MS: '2000', RUN_BATS_SHARDED_KILL_WAIT_MS: '1000' });

  const becameAlive = await waitFor(() => {
    const p = markerPathsFor(root);
    return p.marker && fs.existsSync(p.marker);
  }, { timeoutMs: 8000 });
  assert.equal(becameAlive, true);

  // The two signals are sent close together deliberately -- the fix can
  // complete a full shutdown in well under 100ms (measured), so this is
  // exercising the SAME-tick idempotency guard (state.shutdownPromise already
  // set), not merely "a signal arrives after the process is long gone".
  child.kill('SIGINT');
  await sleep(100);
  child.kill('SIGTERM'); // must be a no-op: teardown already claimed by the first signal

  const closed = await Promise.race([
    child.__closed.then(() => true),
    sleep(10000).then(() => false),
  ]);
  assert.equal(closed, true, 'orchestrator stderr: ' + child.__stderr);
  // The FIRST signal wins and decides the exit code -- a second signal must
  // not restart the shutdown sequence with a different one.
  assert.equal(child.exitCode, 130, 'the second signal appears to have restarted teardown with its own exit code');

  const paths = markerPathsFor(root);
  const handoffs = fs.existsSync(paths.dir) ? fs.readdirSync(paths.dir).filter((f) => f.startsWith('bats-result.')) : [];
  assert.deepEqual(handoffs, [], 'no handoff must exist even after two overlapping signals');
});

test('a shard that finishes with a genuinely VALID handoff in the exact instant a signal arrives is still not aggregated or published', () => {
  // Mutation-found gap, not a hypothetical: an earlier version of this suite
  // passed even with `state.shuttingDown = true` deleted from requestShutdown,
  // because every fixture up to this point gets SHARD_HANDOFF_MISSING when
  // killed (a genuinely-terminated shard never gets to write one), and that
  // unrelated failure happened to produce the same observable exit code via a
  // different path. This test removes that coincidence: the fake shard
  // deliberately WINS the race and writes a fully valid, individually-
  // acceptable handoff (right BATS_TARGET_DIGEST, BATS_COMPLETE=true) at the
  // exact moment it receives SIGTERM -- so the only thing that can still
  // block publication is the shuttingDown check in main() itself, not an
  // accidental missing-file error.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-signal-race-'));
  created.push(root);
  initFakeGitRepo(root);
  fs.mkdirSync(path.join(root, 'scripts', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'sh'), { recursive: true });
  fs.mkdirSync(path.join(root, 'suite'), { recursive: true });
  fs.symlinkSync(REAL_PLANNER, path.join(root, 'scripts', 'tools', 'plan-bats-shards.cjs'));
  fs.writeFileSync(path.join(root, 'suite', 'fake.bats'), '#!/usr/bin/env bats\n\n@test "irrelevant" {\n  true\n}\n');

  const planRaw = spawnSync('node', [
    REAL_PLANNER, '--suite-root', path.join(root, 'suite'), '--shard-count', '1', '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(planRaw.status, 0, 'planning failed: ' + planRaw.stderr);
  const relFiles = JSON.parse(planRaw.stdout).shards[0].files;
  const targetDigest = rbs.computeTargetDigest(relFiles);
  // main() now freezes root's OWN HEAD before launching (not REAL_ROOT's --
  // this fixture root is its own git repo, wholly unrelated to this
  // worktree's), so the fabricated handoff must report THAT exact value or
  // validateShardResult's new SHARD_HEAD_DRIFTED check would reject it for a
  // completely different, unrelated reason than the one this test targets.
  // Captured once in JS, then baked into the trap as a literal -- avoids
  // embedding another live `git -C '<path>'` shell substitution inside the
  // already-elaborate single-quoted trap string.
  const fixtureHead = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  const fakeScript = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    'LOG=""',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    --log) LOG="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    // Genuine minimal TAP for exactly the one case in fake.bats, matching
    // BATS_TOTAL=1 below -- not a placeholder string. main()'s validation
    // loop runs BEFORE its shuttingDown re-check reachable only past that
    // loop, and renumberTap() would throw AGGREGATE_TAP_COUNT_MISMATCH on
    // non-TAP content; either failure reaches main()'s top-level catch and
    // coincidentally reproduces the same exit code via shutdownPromise,
    // masking whether the shuttingDown gate itself did anything -- found by
    // deliberately re-running this exact test against a reverted
    // `state.shuttingDown = true;` and seeing it stay green.
    'printf "1..1\\nok 1 irrelevant\\n" > "$LOG"',
    'MARKER="${LOG}.alive"',
    'echo "alive $$" > "$MARKER"',
    'RUNID="race-$$"',
    'HANDOFF=".androidcommondoc/bats-result.${RUNID}.env"',
    // Written entirely INSIDE the TERM trap: this handoff must not exist
    // before the signal arrives, so its presence afterward can only be
    // explained by "the shard finished writing it right as it was told to
    // stop" -- exactly the race this test exists to model.
    'trap \'{',
    '  printf "BATS_OK=1\\nBATS_NOT_OK=0\\nBATS_EXPECTED=1\\nBATS_TOTAL=1\\nBATS_COMPLETE=true\\nBATS_VERDICT=pass\\nBATS_LOG=%s\\nBATS_HEAD=%s\\nBATS_RUN_ID=%s\\nBATS_GENERATED_AT=%s\\nBATS_SCOPE=targeted\\nBATS_TARGET_DIGEST=%s\\nBATS_ENV_FINGERPRINT=test\\n" "$LOG" "' + fixtureHead + '" "$RUNID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "' + targetDigest + '" > "$HANDOFF";' + ' ' +
      // MUST be the "[run-bats]" prefix (the real script's own name), not
      // this orchestrator's "[run-bats-sharded]" prefix -- extractHandoffPath
      // greps for the former; the latter made extractPath() return null
      // unconditionally, which is a SEPARATE way to reach the same masking
      // bug described above (SHARD_HANDOFF_MISSING instead of a clean
      // aggregate). Found alongside it, same mutation-check run.
      'echo "[run-bats] handoff written: $(pwd)/$HANDOFF (verdict=pass complete=true)" >&2;' + ' ' +
      // A SEPARATE, persistent witness the test can check afterward: this
      // fixture's own "handoff written" line goes to the SHARD's stderr,
      // which runBatsShard() captures into a local variable that main() only
      // ever surfaces inside a thrown error's message -- it is never mirrored
      // onto the orchestrator's own stderr (what the test's child.__stderr
      // actually captures) on the clean shutdown path. Checking for that line
      // there would silently never find it, pass or fail, on ANY outcome --
      // an unfalsifiable assertion. This file sits outside every path
      // cleanupRunArtifacts touches (shardLogPaths/completedHandoffPaths/
      // aggregate*), so its survival proves the trap really ran independent
      // of whatever run-scoped cleanup correctly did to the handoff itself.
      'echo "RACE_HANDOFF_WRITTEN" > "${LOG}.race-evidence";' + ' ' +
      'rm -f "$MARKER"; exit 143; }\' TERM',
    'while true; do sleep 0.05; done',
    '',
  ].join('\n');
  const scriptPath = path.join(root, 'scripts', 'sh', 'run-bats.sh');
  fs.writeFileSync(scriptPath, fakeScript, { mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);

  return (async () => {
    const child = runOrchestrator(root, { RUN_BATS_SHARDED_GRACEFUL_WAIT_MS: '3000', RUN_BATS_SHARDED_KILL_WAIT_MS: '1000' });
    // Re-derived on every poll, not computed once: the shard's own log
    // filename is timestamped and doesn't exist at all until the orchestrator
    // creates it, so a one-shot markerPathsFor() call here would freeze
    // `paths.marker` at null forever and this wait would time out even on a
    // fully healthy run. Same reasoning as the GRACEFUL-child tests above.
    let paths = markerPathsFor(root);
    const becameAlive = await waitFor(() => {
      paths = markerPathsFor(root);
      return paths.marker && fs.existsSync(paths.marker);
    }, { timeoutMs: 8000 });
    assert.equal(becameAlive, true, 'harness setup failed. orchestrator stderr: ' + child.__stderr);

    child.kill('SIGTERM');
    const closed = await Promise.race([child.__closed.then(() => true), sleep(10000).then(() => false)]);
    assert.equal(closed, true, 'orchestrator did not exit. stderr: ' + child.__stderr);
    assert.equal(child.exitCode, 143, 'wrong exit code');

    // Proves the race genuinely happened -- and that main() recognized it as
    // a genuinely valid shard, not an unrelated structural failure -- via the
    // orchestrator's OWN stderr rather than the per-shard handoff file's
    // presence on disk: that file is CORRECTLY removed by cleanupRunArtifacts
    // as a run-scoped artifact once shutdown completes (see state.completedHandoffPaths),
    // so asserting it still exists would fail on a fully correct
    // implementation. Checked this the hard way: this exact assertion, written
    // against a since-fixed fixture bug (wrong "[run-bats-sharded]" prefix,
    // which extractHandoffPath's regex never matches, so main() never tracked
    // the file for cleanup and it survived on disk by accident), passed for
    // the wrong reason until the prefix was corrected.
    assert.ok(paths.shardLogPath && fs.existsSync(paths.shardLogPath + '.race-evidence'),
      'the fixture\'s TERM trap never ran to completion -- the race did not happen the way this test assumes. orchestrator stderr: ' + child.__stderr);
    assert.ok(!child.__stderr.includes('FATAL'),
      'main() threw for an unrelated structural reason instead of cleanly hitting the shuttingDown gate: ' + child.__stderr);

    const dir = path.join(root, '.androidcommondoc');
    const perShardHandoffs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^bats-result\.race-\d+\.env$/.test(f)) : [];
    assert.deepEqual(perShardHandoffs, [],
      'the per-shard handoff written during the race must be cleaned up too, not just left unpublished: found ' + JSON.stringify(perShardHandoffs));

    const aggregateHandoffs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^bats-result\..*-agg-.*\.env$/.test(f)) : [];
    assert.deepEqual(aggregateHandoffs, [],
      'an aggregate handoff was published even though the run was aborted by a signal -- the shuttingDown gate in main() did not hold, only an incidental missing-handoff error was preventing this before');
  })();
});
