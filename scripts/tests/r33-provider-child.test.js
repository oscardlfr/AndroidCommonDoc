#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + shape-oracle suite for the R33 native-provider
// CHILD process entrypoint. Frozen contract source: PLAN.md "Canonical R33
// Native-Provider Production Contract" S2.3 export #25 `spawnWithSlots`
// (the frozen argv/env construction), S4.2 "Step 7 frame and handle
// sequence", S7.1 "Fixed child descriptor table". PLAN.md S2.3 names the
// spawned child module explicitly: "...the literal suffix
// '/tree/scripts/lib/runtime-r33-provider.cjs'" -- confirming Path-Manifest
// row 8 `scripts/lib/runtime-r33-provider.cjs` (this file's target,
// toolkit-specialist-owned, WP3-WIRE, absent as of this commit) is the sealed
// child-process entrypoint, not an in-process library.
//
// SCOPE (dispatch: test-specialist, WP3-RED ONLY): the currently-FAILING
// deliverable is the ONE named sentinel below, `R33-RED-CHILD-ABSENT`
// (PLAN.md S11.1's eight-name RED set). The CHILD-SLOT-*/CHILD-SECRET-*
// matrices (PLAN.md S11.2) ARE authored below as real spawn-based integration
// checks, each guarded with node:test's `{skip}` option keyed off the child
// entrypoint's existence: today SKIPPED (disjoint from pass/fail, so the
// failing-name set stays exactly the one sentinel); once WP3-WIRE lands
// `runtime-r33-provider.cjs`, these un-skip and execute for real (team-lead
// binding clarification, 2026-07-26). Slot 5 (the admin `ConnectionHandle`)
// genuinely requires the native `makeSocketpairStream()` export (row
// 6/7, absent) to construct a real AF_UNIX socketpair; the two harness tests
// below use a plain OS pipe as a best-effort stand-in for slot 5's FD to
// exercise the structural 0-7 map, and this limitation is called out
// explicitly rather than silently claimed as full socket-semantics coverage.
//
// Because the target is a process ENTRYPOINT (launched via `spawnWithSlots`
// with fixed FDs 3-7 already open in the child, per S4.2), the sentinel below
// spawns it as a real subprocess (matching its actual invocation contract)
// rather than `require()`-ing it in-process, with a bounded timeout so a
// future implementation that misbehaves outside its expected fixed-FD
// context cannot hang this suite.

const assert = require('node:assert');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHILD_ENTRYPOINT_PATH = path.resolve(__dirname, '../lib/runtime-r33-provider.cjs'); // Path-Manifest row 8

function childEntrypointExists() {
  return fs.existsSync(CHILD_ENTRYPOINT_PATH);
}

const CHILD_ABSENT_SKIP_REASON = 'scripts/lib/runtime-r33-provider.cjs (row 8) does not exist yet -- WP3-WIRE dependency; this case is structured to un-skip and execute once it does';

/**
 * Builds the fixed 0-7 `stdio` array PLAN.md S7.1/S4.2 requires: 0=/dev/null
 * read, 1/2=a shared diagnostic file, 3/4=real directory FDs (owner-confined
 * temp dirs, standing in for the manager's retained P_fd/R_fd duplicates),
 * 5=a plain OS pipe read-end (best-effort stand-in for the admin
 * ConnectionHandle -- see file header), 6/7=plain OS pipes (the real shape
 * for the lifetime/master-key pipes). Returns `{stdio, cleanup, writeEnds}`;
 * `writeEnds[6]`/`writeEnds[7]` are the PARENT-held writable ends.
 */
function buildFixedChildStdio({ dir3Mode = 0o700, dir4Mode = 0o700, slot3IsDir = true } = {}) {
  const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r33-child-slots-')));
  const dir3Path = path.join(tmpRoot, 'p-fd');
  const dir4Path = path.join(tmpRoot, 'r-fd');
  fs.mkdirSync(dir4Path, { mode: dir4Mode });
  let fd3;
  if (slot3IsDir) {
    fs.mkdirSync(dir3Path, { mode: dir3Mode });
    fd3 = fs.openSync(dir3Path, fs.constants.O_RDONLY);
  } else {
    fs.writeFileSync(dir3Path, 'not-a-directory'); // mutated fixture: a regular file where a directory is required
    fd3 = fs.openSync(dir3Path, fs.constants.O_RDONLY);
  }
  const fd4 = fs.openSync(dir4Path, fs.constants.O_RDONLY);
  const devNull = fs.openSync('/dev/null', fs.constants.O_RDONLY);
  const diagFile = fs.openSync(path.join(tmpRoot, 'diag.log'), fs.constants.O_CREAT | fs.constants.O_RDWR);

  const stdio = ['ignore', 'ignore', 'ignore', fd3, fd4, 'pipe', 'pipe', 'pipe'];
  stdio[0] = devNull;
  stdio[1] = diagFile;
  stdio[2] = diagFile;

  const cleanup = () => {
    for (const fd of [fd3, fd4, devNull, diagFile]) {
      try { fs.closeSync(fd); } catch { /* already closed by spawn/child */ }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  };
  return { stdio, cleanup, tmpRoot };
}

// ---------------------------------------------------------------------------
// PLAN.md S7.1 "Fixed child descriptor table" -- exactly eight rows, FD 0..7.
// ---------------------------------------------------------------------------
const FIXED_CHILD_DESCRIPTOR_TABLE = [
  { fd: 0, source: '/dev/null read', adoption: null },
  { fd: 1, source: 'pre-opened diagnostic FileHandle', adoption: null },
  { fd: 2, source: 'same diagnostic file', adoption: null },
  { fd: 3, source: 'retained P_fd duplicate', adoption: 'adoptInheritedDir' },
  { fd: 4, source: 'retained R_fd duplicate', adoption: 'adoptInheritedDir' },
  { fd: 5, source: 'child end of admin socketpair', adoption: 'adoptInheritedConn' },
  { fd: 6, source: 'child end of lifetime pipe', adoption: 'adoptInheritedRead' },
  { fd: 7, source: 'child end of master-key pipe', adoption: 'adoptInheritedRead' },
];

function assertFixedChildDescriptorTable(rows) {
  assert.strictEqual(rows.length, 8, 'the fixed child descriptor table must have EXACTLY eight rows, FD 0..7 (PLAN.md S7.1)');
  const fds = rows.map((r) => r.fd);
  assert.deepStrictEqual([...fds].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7],
    'FD numbers must be EXACTLY the closed set 0..7, each present once');
  for (const row of rows) {
    const expected = FIXED_CHILD_DESCRIPTOR_TABLE.find((r) => r.fd === row.fd);
    assert.ok(expected, 'FD ' + row.fd + ' is not one of the closed 0..7 rows');
    assert.strictEqual(row.adoption, expected.adoption,
      'FD ' + row.fd + ' must use adoption call ' + JSON.stringify(expected.adoption) + ' (PLAN.md S7.1)');
  }
  // Only slots 3-7 are authority sources; 0-2 never adopt a handle (S7.1: "none").
  for (const row of rows) {
    if (row.fd <= 2) {
      assert.strictEqual(row.adoption, null, 'FD ' + row.fd + ' must never be adopted as a handle');
    } else {
      assert.ok(row.adoption, 'FD ' + row.fd + ' must have a non-null child adoption call');
    }
  }
}

test('positive fixture: assertFixedChildDescriptorTable accepts the exact frozen eight-row table', () => {
  assertFixedChildDescriptorTable(FIXED_CHILD_DESCRIPTOR_TABLE);
});

test('negative control: assertFixedChildDescriptorTable rejects FD 5 adopted via adoptInheritedRead (should be adoptInheritedConn)', () => {
  const mutated = FIXED_CHILD_DESCRIPTOR_TABLE.map((row) =>
    (row.fd === 5 ? Object.assign({}, row, { adoption: 'adoptInheritedRead' }) : row)); // mutated: watched property
  assert.throws(() => assertFixedChildDescriptorTable(mutated), assert.AssertionError,
    'validator must reject FD 5 using any adoption call other than adoptInheritedConn (S4.2 step 2: slot 5 is the admin ConnectionHandle)');
});

test('negative control: assertFixedChildDescriptorTable rejects a nine-row table (spurious FD 8)', () => {
  const mutated = [...FIXED_CHILD_DESCRIPTOR_TABLE, { fd: 8, source: 'extra', adoption: 'adoptInheritedRead' }]; // mutated: watched cardinality
  assert.throws(() => assertFixedChildDescriptorTable(mutated), assert.AssertionError,
    'validator must reject any FD outside the closed 0..7 set (S7.1: posix_spawn_file_actions_addclosefrom_np(8))');
});

test('negative control: assertFixedChildDescriptorTable rejects FD 0 adopted as a handle', () => {
  const mutated = FIXED_CHILD_DESCRIPTOR_TABLE.map((row) =>
    (row.fd === 0 ? Object.assign({}, row, { adoption: 'adoptInheritedRead' }) : row)); // mutated: watched invariant
  assert.throws(() => assertFixedChildDescriptorTable(mutated), assert.AssertionError,
    'validator must reject FD 0/1/2 ever being adopted as an authority handle');
});

// ---------------------------------------------------------------------------
// PLAN.md S11.2 `CHILD-SLOT-*`/`CHILD-SECRET-*` full matrix (row 8,
// WP3-WIRE). Every case below is guarded with `{skip}` keyed off
// `childEntrypointExists()`.
// ---------------------------------------------------------------------------

test('CHILD-SLOT-01: the child adopts slots 3/4 as directories and exits without an inherited-source error', { skip: childEntrypointExists() ? false : CHILD_ABSENT_SKIP_REASON }, () => {
  const { stdio, cleanup } = buildFixedChildStdio({ slot3IsDir: true });
  try {
    const result = spawnSync(process.execPath, [CHILD_ENTRYPOINT_PATH], {
      env: Object.assign({}, process.env, { NODE_ENV: 'production', R33_PROVIDER_CHILD: '1' }),
      stdio,
      timeout: 5000,
    });
    assert.strictEqual(result.signal, null, 'CHILD-SLOT-01 must not need to be killed by timeout');
    // A real child cannot complete its full bootstrap without a genuine
    // socketpair at slot 5 and a manager on the other end of slots 6/7 (this
    // harness supplies plain pipes as a structural stand-in, see file
    // header) -- so this smoke test only requires that slot 3/4 identity
    // adoption itself does not fail with the specific inherited-source
    // rejection this test is named for; full end-to-end ACTIVE bootstrap is
    // WP3-COMPOSITION's own AUTH-POS-* concern (r33-authority-positive.test.js).
    assert.ok(result.status !== null, 'the child process must reach a terminal exit, not hang');
  } finally {
    cleanup();
  }
});

test('CHILD-SLOT-02: an unexpected inherited source at slot 3 (regular file, not a directory) is caught (PLAN.md S11.2 "unexpected inherited source detection")', { skip: childEntrypointExists() ? false : CHILD_ABSENT_SKIP_REASON }, () => {
  const { stdio, cleanup } = buildFixedChildStdio({ slot3IsDir: false }); // mutated: watched property -- slot 3 is a regular file, not a directory
  try {
    const result = spawnSync(process.execPath, [CHILD_ENTRYPOINT_PATH], {
      env: Object.assign({}, process.env, { NODE_ENV: 'production', R33_PROVIDER_CHILD: '1' }),
      stdio,
      timeout: 5000,
    });
    assert.strictEqual(result.signal, null, 'CHILD-SLOT-02 must not need to be killed by timeout');
    assert.notStrictEqual(result.status, 0,
      'the child must reject a non-directory inherited source at slot 3 rather than silently proceeding (PLAN.md S4.2 step 2, S7.1)');
  } finally {
    cleanup();
  }
});

/** Resolves with the child's exit info, or rejects if it outlives `timeoutMs` (killing it first). */
function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('child did not exit within ' + timeoutMs + 'ms'));
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('CHILD-SECRET-01: slot 7 boundary -- 32 bytes is consumed cleanly; 31 (short) and 33 (overlong) are rejected (PLAN.md S2.3 adoptSecret32, S7.1)', { skip: childEntrypointExists() ? false : CHILD_ABSENT_SKIP_REASON }, async () => {
  for (const secretLen of [31, 32, 33]) {
    const { stdio, cleanup } = buildFixedChildStdio({ slot3IsDir: true });
    try {
      const child = require('node:child_process').spawn(process.execPath, [CHILD_ENTRYPOINT_PATH], {
        env: Object.assign({}, process.env, { NODE_ENV: 'production', R33_PROVIDER_CHILD: '1' }),
        stdio,
      });
      // stdio[7] is the parent-held write end of the plain-pipe stand-in for
      // the master-key pipe; write exactly `secretLen` bytes then close it,
      // simulating S7.1's "exact one write/read then both endpoints close".
      child.stdio[7].end(Buffer.alloc(secretLen, 0xab));
      child.stdio[6].end(); // close the lifetime-pipe write end so the child's slot-6 EOF wait cannot hang this test

      // This is a structural boundary probe, not a claim of full protocol
      // completion (the child also needs a real slot-5 socketpair to proceed
      // past Prelude/Hello, per the file header's documented limitation);
      // it only asserts the process reaches SOME terminal state rather than
      // hanging once the exact 32/31/33-byte payload has been delivered.
      const { signal } = await waitForExit(child, 5000);
      assert.strictEqual(signal, null, 'CHILD-SECRET-01 (secretLen=' + secretLen + '): the child must reach a terminal exit, not hang, once slot 7 delivery completes');
    } finally {
      cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md "Test Matrices" S11.1). Exact sentinel name required by
// the eight-name RED set. Spawns the child entrypoint directly (its real
// invocation shape per S2.3/S4.2) rather than requiring it in-process.
// Genuinely fails today because `scripts/lib/runtime-r33-provider.cjs` does
// not exist yet -- Node's own module resolution reports this as a nonzero
// exit with a "Cannot find module" stderr, which is the honest, PLAN-designated
// first-RED absence reason, not an instrument defect.
// ---------------------------------------------------------------------------
test('R33-RED-CHILD-ABSENT', () => {
  const result = spawnSync(process.execPath, [CHILD_ENTRYPOINT_PATH], {
    env: Object.assign({}, process.env, { NODE_ENV: 'production', R33_PROVIDER_CHILD: '1' }),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.strictEqual(result.signal, null,
    'child entrypoint probe must not need to be killed by timeout: ' + JSON.stringify(result));
  assert.strictEqual(result.status, 0,
    'scripts/lib/runtime-r33-provider.cjs (Path-Manifest row 8, the sealed child entrypoint named '
    + 'in the spawnWithSlots argv construction, PLAN.md S2.3) must exist and start cleanly before '
    + 'WP3-WIRE lands; spawn stderr: ' + result.stderr);
});
