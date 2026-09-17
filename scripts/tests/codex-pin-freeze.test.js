'use strict';

// F-19: the Codex executable is frozen by DIGEST, not by version text.
//
// The gap this closes was observed first-hand on this machine: the pinned
// Codex binary's SHA-256 changed from ecad78db... to a1d2f191... inside a
// single session while `codex --version` kept reporting the identical string
// 0.154.0-alpha.6.2. Path/ownership/mode validation accepted the swap, because
// nothing ever hashed the bytes.
//
// The expected digest comes from a conductor-written freeze record, never from
// the file under validation -- recomputing the expectation from the same file
// would make the check a tautology that every substituted binary passes.

process.env.NODE_ENV = 'test';
process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = 'codex-pin-freeze-fixture';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const rbc = require(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'));
const validate = rbc.__testOnlyValidatePinnedCodexExecutable;

const FREEZE_SCHEMA = 'androidcommondoc/codex-executable-freeze/v1';
const created = [];

function mkdir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-freeze-')));
  created.push(dir);
  // On Windows, production requires the executable's parent directory to be
  // owner-confined (windowsPrivateDirectoryAcl ... mode: 'validate'), and a bare
  // mkdtemp under %TEMP% does not satisfy that on a CI runner -- every case
  // that got as far as the ACL probe failed CODEX_CLI_PATH_INSECURE. Applying
  // the ACL here makes the fixture represent a legitimately protected location
  // instead of weakening the contract to accept an unprotected one.
  if (process.platform === 'win32') {
    const acl = windowsPrivateDirectoryAcl(dir, { mode: 'ensure' });
    assert.equal(acl && acl.ok, true,
      'fixture directory must be owner-confined on Windows: ' + JSON.stringify(acl));
  }
  return dir;
}

function makeExecutable(dir, bytes, name = 'codex') {
  const target = path.join(dir, name);
  fs.writeFileSync(target, bytes, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  return target;
}

function freezeFor(target, overrides = {}) {
  const resolved = fs.realpathSync(target);
  const st = fs.lstatSync(resolved);
  return {
    schema: FREEZE_SCHEMA,
    executable_realpath: resolved,
    executable_sha256: crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex'),
    cli_version: 'codex-cli 0.154.0-alpha.6.2',
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    file_type: 'file',
    nlink: st.nlink,
    mode_octal: (st.mode & 0o7777).toString(8).padStart(3, '0'),
    ...overrides,
  };
}

function writeFreeze(dir, record) {
  const freezePath = path.join(dir, 'codex-freeze.json');
  fs.writeFileSync(freezePath, JSON.stringify(record), { mode: 0o600 });
  return freezePath;
}

function withPin(env, fn) {
  const prevMode = process.env.RUNTIME_BRIDGE_CODEX_PIN_MODE;
  const prevFreeze = process.env.RUNTIME_BRIDGE_CODEX_PIN_FREEZE;
  if (env.mode === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_PIN_MODE;
  else process.env.RUNTIME_BRIDGE_CODEX_PIN_MODE = env.mode;
  if (env.freeze === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_PIN_FREEZE;
  else process.env.RUNTIME_BRIDGE_CODEX_PIN_FREEZE = env.freeze;
  try { return fn(); } finally {
    if (prevMode === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_PIN_MODE;
    else process.env.RUNTIME_BRIDGE_CODEX_PIN_MODE = prevMode;
    if (prevFreeze === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_PIN_FREEZE;
    else process.env.RUNTIME_BRIDGE_CODEX_PIN_FREEZE = prevFreeze;
  }
}

test.after(() => {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

test('CPF-01 a matching digest resolves the spawn command', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freeze = writeFreeze(dir, freezeFor(target));
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(out.ok, true, out.reason);
  // The command is the protected copy of the VALIDATED bytes, not the mutable
  // pathname that was validated -- see CPF-12/13. It must still hash to the
  // digest the freeze pinned.
  assert.notEqual(out.command, target,
    'execution must not be bound to the mutable original path');
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(out.command)).digest('hex'),
    crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
    'the executed copy must be byte-identical to the validated bytes',
  );
  assert.deepEqual(out.args, ['app-server', '--listen', 'stdio://', '--strict-config']);
});

test('CPF-12 the executed copy lives in an owner-confined private directory', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freeze = writeFreeze(dir, freezeFor(target));
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(out.ok, true, out.reason);
  const copyStat = fs.lstatSync(out.command);
  assert.equal(copyStat.isFile(), true);
  assert.equal(copyStat.isSymbolicLink(), false);
  const dirStat = fs.lstatSync(path.dirname(out.command));
  assert.equal(dirStat.isDirectory(), true);
  if (process.platform !== 'win32') {
    assert.equal(dirStat.mode & 0o077, 0, 'the copy directory must not be group/other accessible');
    assert.equal(copyStat.mode & 0o077, 0, 'the copy itself must not be group/other accessible');
    assert.equal(copyStat.uid, process.getuid(), 'the copy must be owned by this user');
  }
  // Keyed by the validated digest, so a different binary can never reuse it.
  // Exact equality, not containment. `includes` would also accept
  // codex-<digest>-anything.exe, which production cannot currently produce but
  // which the assertion should not license either. Naming the whole expected
  // basename keeps the contract exact however the scheme evolves, and covers
  // the Windows .exe in the same breath -- libuv will not spawn an
  // extensionless path, so the suffix is part of the contract, not decoration.
  const expectDigest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  assert.equal(
    path.basename(out.command),
    'codex-' + expectDigest + (process.platform === 'win32' ? '.exe' : ''),
    'the copy name must be exactly its validated digest: ' + out.command,
  );
});

test('CPF-13 replacing or rewriting the original after validation does not change the executed bytes', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freeze = writeFreeze(dir, freezeFor(target));
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(out.ok, true, out.reason);
  const executedBefore = fs.readFileSync(out.command);

  // (a) rewrite the original in place
  fs.writeFileSync(target, 'codex-binary-EVIL\n', { mode: 0o755 });
  assert.deepEqual(fs.readFileSync(out.command), executedBefore,
    'an in-place rewrite of the original must not reach the executed image');

  // (b) replace the original with a different file entirely (new inode)
  const impostor = path.join(dir, 'impostor');
  fs.writeFileSync(impostor, 'codex-binary-IMPOSTOR\n', { mode: 0o755 });
  fs.renameSync(impostor, target);
  assert.deepEqual(fs.readFileSync(out.command), executedBefore,
    'replacing the original path must not reach the executed image');

  // And a re-validation now correctly refuses, because the pinned bytes are gone.
  const after = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'CODEX_PIN_DIGEST_DRIFT');
});

test('CPF-02 an identical version with a different digest is denied', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const record = freezeFor(target);
  const freeze = writeFreeze(dir, record);
  // Swap the bytes in place, exactly as an in-place upgrade would, and keep the
  // version string in the freeze identical. Only the digest distinguishes them.
  fs.writeFileSync(target, 'codex-binary-v2-DIFFERENT\n', { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_DIGEST_DRIFT');
});

test('CPF-03 genuine-pinned mode with no freeze is denied', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const out = withPin({ mode: 'genuine-pinned' }, () => validate(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_FREEZE_ABSENT');
});

test('CPF-04 a changed realpath is denied even when the bytes match', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const record = freezeFor(target);
  // Same content, different location: the freeze names one exact image.
  const moved = makeExecutable(dir, 'codex-binary-v1\n', 'codex-moved');
  const freeze = writeFreeze(dir, record);
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(moved));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_REALPATH_MISMATCH');
});

test('CPF-05 a symlinked substitution is denied', () => {
  const dir = mkdir();
  const real = makeExecutable(dir, 'codex-binary-v1\n');
  const record = freezeFor(real);
  const freeze = writeFreeze(dir, record);
  const decoy = makeExecutable(dir, 'codex-binary-EVIL\n', 'codex-decoy');
  const link = path.join(dir, 'codex-link');
  fs.symlinkSync(decoy, link);
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(link));
  assert.equal(out.ok, false);
  // The pre-existing symlink guard fires first; either way it must never resolve.
  assert.ok(
    ['CODEX_CLI_PATH_NOT_A_FILE', 'CODEX_PIN_REALPATH_MISMATCH'].includes(out.reason),
    `unexpected reason ${out.reason}`,
  );
});

test('CPF-06 non-pinned profiles keep exactly their current contract', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  // No freeze, no mode: resolves, exactly as before F-19.
  const out = withPin({}, () => validate(target));
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.command, target);
  // A stale freeze pointing elsewhere must ALSO be ignored when the mode is off,
  // proving enforcement is gated by the mode and not by mere file presence.
  const foreign = writeFreeze(dir, freezeFor(target, { executable_realpath: path.join(dir, 'nope') }));
  const off = withPin({ freeze: foreign }, () => validate(target));
  assert.equal(off.ok, true, off.reason);
});

test('CPF-07 pre-existing path/ownership contract is unchanged on every platform', () => {
  const dir = mkdir();
  assert.equal(validate('').reason, 'CODEX_CLI_PATH_UNSET');
  assert.equal(validate('relative/codex').reason, 'CODEX_CLI_PATH_NOT_ABSOLUTE');
  assert.equal(validate(path.join(dir, 'missing')).reason, 'CODEX_CLI_PATH_NOT_FOUND');
  assert.equal(validate(dir).reason, 'CODEX_CLI_PATH_NOT_A_FILE');
  // Windows keeps its ACL branch: assert the source still guards win32 the same
  // way, since this suite cannot execute that branch on darwin/linux.
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-bridge-codex/app-server-pin.cjs'), 'utf8');
  assert.match(src, /if \(process\.platform === 'win32'\) \{\s*\n\s*const acl = windowsPrivateDirectoryAcl\(path\.dirname\(pinnedPath\)/);
  assert.match(src, /process\.platform !== 'win32' && parseInt\(freeze\.mode_octal, 8\)/);
});

// ── Finding A: the freeze record is read through a validated DESCRIPTOR ───────
//
// The earlier reader lstat'd the PATHNAME and then readFileSync'd the PATHNAME,
// so anything could be substituted in between. These four cases drive each leg
// of the replacement deterministically by injecting an `fs` whose calls diverge
// exactly where a real race would -- a wall-clock race would be untestable.

const { createAppServerPin } = require(path.resolve(
  __dirname, '../lib/runtime-bridge-codex/app-server-pin.cjs',
));
const { createPinnedImageStore } = require(path.resolve(
  __dirname, '../lib/runtime-bridge-codex/app-server-pinned-image.cjs',
));
// The COMPOSED instances runtime-bridge-codex.cjs itself injects, so the helper
// below differs from production only in the fs fault it is exercising.
const { windowsPrivateDirectoryAcl, windowsAclSnapshotsEqual } = require(path.resolve(
  __dirname, '../lib/runtime-consultation.cjs',
));

// Every dependency the facade injects must be injected here too, with the
// SAME fs the overrides are applied to, so the only difference between this
// instance and production is the fault under test. Omitting any of them makes
// the helper diverge from production in a way no macOS or Linux run can see:
// validatePinnedCodexExecutable calls windowsPrivateDirectoryAcl behind
// `process.platform === 'win32'`, so a missing injection is a TypeError on
// Windows and invisible everywhere else. That is exactly how it shipped --
// caught only once this suite first ran on a real Windows runner.
function pinWith(fsOverrides) {
  const pinFs = Object.assign(Object.create(fs), fsOverrides);
  const { materializePinnedCopy, cleanupPinnedCopies } = createPinnedImageStore({
    fs: pinFs, os, path, crypto, windowsPrivateDirectoryAcl,
  });
  return createAppServerPin({
    fs: pinFs,
    path,
    crypto,
    os,
    isTestCapability: () => false,
    windowsPrivateDirectoryAcl,
    windowsAclSnapshotsEqual,
    materializePinnedCopy,
    cleanupPinnedCopies,
  });
}

// Guarded to POSIX because the MECHANISM under test does not exist on Windows:
// fs.constants.O_NOFOLLOW is undefined there, so the production code falls back
// to `| 0` and the open cannot refuse a symlink on that platform. This is not a
// contract going uncovered -- a swapped file IS still refused on Windows, by the
// fstat dev/ino identity comparison (CPF-09) and the post-read re-verification
// (CPF-10), both of which run and pass on the real Windows runner. Only this one
// mechanism is POSIX-exclusive, and asserting it on Windows would assert a
// guarantee the platform never offered.
test('CPF-08 a symlink swapped in after the lstat is refused by O_NOFOLLOW alone',
  { skip: process.platform === 'win32' ? 'O_NOFOLLOW is POSIX-only; covered on win32 by CPF-09/CPF-10' : false },
  () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const realFreeze = writeFreeze(dir, freezeFor(target));
  const linkPath = path.join(dir, 'freeze-link.json');
  fs.symlinkSync(realFreeze, linkPath);
  // The plain case is already caught by the pre-existing lstat isSymbolicLink()
  // guard, so it would pass with or without this finding's fix and proves
  // nothing about O_NOFOLLOW. Make lstat LIE -- report a regular file for a path
  // that is really a symlink, exactly what a swap inside the check/open window
  // looks like -- so the open is the only thing left that can refuse it.
  const pin = pinWith({
    lstatSync(p, ...rest) {
      const real = fs.lstatSync(p, ...rest);
      if (p !== linkPath) return real;
      const honest = fs.statSync(realFreeze);
      return Object.assign(Object.create(Object.getPrototypeOf(honest)), honest, {
        isSymbolicLink: () => false,
        isFile: () => true,
      });
    },
  });
  const out = withPin({ mode: 'genuine-pinned', freeze: linkPath },
    () => pin.validatePinnedCodexExecutable(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_FREEZE_INSECURE');
});

test('CPF-09 a freeze replaced between the pathname check and the open is refused', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freezePath = writeFreeze(dir, freezeFor(target));
  // lstat reports the file the caller vetted; the descriptor that is actually
  // opened belongs to a DIFFERENT inode -- exactly a swap inside the window.
  const pin = pinWith({
    fstatSync(fd) {
      const real = fs.fstatSync(fd);
      return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { ino: real.ino + 1 });
    },
  });
  const out = withPin({ mode: 'genuine-pinned', freeze: freezePath },
    () => pin.validatePinnedCodexExecutable(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_FREEZE_INSECURE');
});

test('CPF-10 a freeze mutated while it is being read is refused, never parsed', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freezePath = writeFreeze(dir, freezeFor(target));
  // First fstat (identity + size) matches; the post-read fstat reports a
  // different mtime, i.e. the bytes moved underneath the descriptor.
  let calls = 0;
  const pin = pinWith({
    fstatSync(fd) {
      const real = fs.fstatSync(fd);
      calls += 1;
      if (calls === 1) return real;
      return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { mtimeMs: real.mtimeMs + 1000 });
    },
  });
  const out = withPin({ mode: 'genuine-pinned', freeze: freezePath },
    () => pin.validatePinnedCodexExecutable(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_FREEZE_INSECURE');
});

test('CPF-11 a short read is refused rather than parsed optimistically', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freezePath = writeFreeze(dir, freezeFor(target));
  // Deliver one byte and then EOF: a truncated record must never reach JSON.parse.
  let served = 0;
  const pin = pinWith({
    readSync(fd, buffer, offset, length, position) {
      if (served > 0) return 0;
      served += 1;
      return fs.readSync(fd, buffer, offset, Math.min(1, length), position);
    },
  });
  const out = withPin({ mode: 'genuine-pinned', freeze: freezePath },
    () => pin.validatePinnedCodexExecutable(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_FREEZE_MALFORMED');
});

// CPF-14: the Windows ACL mode literal must be one the validator actually
// admits. `windows-acl.cjs` guards a CLOSED two-member enum ('ensure' applies
// the owner-only ACL, 'validate' only observes one) and answers anything else
// with reason 'invalid-mode' BEFORE it looks at the platform. That refusal is
// fail-closed, so a wrong literal never weakens anything -- it silently
// disables the pinned copy on Windows entirely, and no macOS or Linux run can
// see it because the branch is behind `process.platform === 'win32'`.
//
// Caught by arch-platform's review of this delta: the call site shipped
// { mode: 'enforce' }, which is not a member. The oracle here is the REAL
// validator, never a restatement of the enum in this file -- the literal the
// production call site actually passes is captured through the injected
// dependency and then fed to the genuine function. Reverting the fix to
// 'enforce' turns both halves red.
test('CPF-14 the pinned-copy directory asks the Windows ACL validator for a mode it admits', () => {
  const realAcl = windowsPrivateDirectoryAcl;

  const observedModes = [];
  const store = createPinnedImageStore({
    fs, os, path, crypto,
    windowsPrivateDirectoryAcl(dirPath, options) {
      observedModes.push(options && options.mode);
      return { ok: true, status: 'secure' };
    },
  });

  const source = path.join(mkdir(), 'codex-src');
  const bytes = Buffer.from('#!/bin/sh\necho pinned\n');
  fs.writeFileSync(source, bytes, { mode: 0o500 });
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');

  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const fd = fs.openSync(source, fs.constants.O_RDONLY);
  let copied;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    copied = store.materializePinnedCopy(fd, bytes.length, digest);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    fs.closeSync(fd);
  }

  // Half 1 -- the win32 branch was genuinely entered and the copy succeeded.
  // Without this the test would pass vacuously if the branch stopped running.
  assert.equal(observedModes.length, 1, 'the win32 ACL branch must run exactly once');
  assert.equal(copied.ok, true, copied.reason || 'the pinned copy must materialize on win32');

  // Half 2 -- the REAL validator must not reject that literal out of hand.
  // 'invalid-mode' is returned before the platform check, so this assertion is
  // meaningful on macOS and Linux, which is the whole point. The target is a
  // throwaway directory, never os.tmpdir(): on a real Windows runner 'ensure'
  // APPLIES an owner-only ACL, and doing that to the runner's temp root would
  // be a side effect on every other job sharing it.
  const verdict = realAcl(mkdir(), { mode: observedModes[0] });
  assert.notEqual(verdict.reason, 'invalid-mode',
    'mode ' + JSON.stringify(observedModes[0]) + ' is outside the closed enum windows-acl.cjs admits');
  assert.equal(observedModes[0], 'ensure',
    'a directory this module creates must have the owner-only ACL APPLIED, not merely observed');

  try { store.cleanupPinnedCopies(); } catch (err) { /* best effort */ }
});

// CPF-15: the fault-injection helper must build an instance with every
// dependency the facade injects. This is a regression guard for a real CI
// failure, not a hypothetical: pinWith originally omitted
// windowsPrivateDirectoryAcl, and validatePinnedCodexExecutable calls it from
// inside `process.platform === 'win32'`. So CPF-08..11 threw
// "TypeError: windowsPrivateDirectoryAcl is not a function" on Windows while
// passing on macOS and Linux, and nothing caught it until this suite first ran
// on a real Windows runner.
//
// Faking the platform reproduces that on any host. The assertion is deliberately
// about the SHAPE of the failure, not its reason: on a non-Windows host the real
// ACL probe cannot find PowerShell and legitimately refuses, which is a fine
// answer. A TypeError is not -- it means the instance was built wrong.
test('CPF-15 the fault-injection helper injects every dependency production does', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freeze = writeFreeze(dir, freezeFor(target));
  const pin = pinWith({});

  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  let out;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    out = withPin({ mode: 'genuine-pinned', freeze },
      () => pin.validatePinnedCodexExecutable(target));
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }

  // Reaching a verdict AT ALL is the point, and the comment above always said
  // so -- then the original assertion pinned a specific reason anyway and
  // contradicted it. CODEX_CLI_PATH_INSECURE is the right answer only off
  // Windows, where the ACL probe cannot find PowerShell and legitimately
  // refuses. On a real Windows runner, with a directory the fixture has
  // properly ACL-ed, the same branch legitimately SUCCEEDS -- which is equally
  // a verdict and equally proof that a real function was called. Assert the
  // shape only; a TypeError from a missing injection cannot produce it.
  assert.equal(typeof out, 'object');
  assert.equal(typeof out.ok, 'boolean',
    'the win32 ACL branch must produce a verdict, never a TypeError');
  if (out.ok === false) {
    assert.equal(typeof out.reason, 'string',
      'a refusal must carry a reason code');
  }
});

// CPF-16: the freeze record's containing directory is validated, not just the
// record. Raised by review after being disclosed as a deliberate deviation when
// the TOCTOU finding was closed -- a writable parent lets an attacker place a
// stable, correctly-shaped replacement before the first lstat, and while the
// realpath and digest binding still refuse a substituted executable, an
// attacker-chosen record can force the pinned launch to fail.
//
// Deliberately NOT platform-skipped. The mechanism differs by platform but the
// contract does not: on POSIX a group/world-writable directory is refused by
// the mode check, on Windows a directory with no owner-confined ACL is refused
// by the ACL probe. Same reason code either way, so one case covers both.
test('CPF-16 a freeze record in an unprotected directory is refused', () => {
  const safeDir = mkdir();
  const target = makeExecutable(safeDir, 'codex-binary-v1\n');

  // A directory deliberately left unprotected: mkdtemp WITHOUT the owner-only
  // ACL mkdir() applies on Windows, and loosened past the mode gate on POSIX.
  const looseDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-loose-')));
  created.push(looseDir);
  if (process.platform !== 'win32') fs.chmodSync(looseDir, 0o777);

  const freeze = path.join(looseDir, 'codex-freeze.json');
  fs.writeFileSync(freeze, JSON.stringify(freezeFor(target)), { mode: 0o600 });

  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CODEX_PIN_FREEZE_DIR_INSECURE',
    'a record whose parent anyone can write must be refused before it is read');
});

// CPF-17: two independent stores must not share a copy directory, and one
// tearing down must not touch the other's verified copy.
//
// This is the property the per-process directory exists to provide. It replaced
// a single `acd-codex-pinned-<uid>` shared by every bridge process for one user,
// where a peer exiting between our verification and the supervisor's spawn ran
// its own cleanup and could delete the pathname we had just verified -- the
// descriptor is closed by then, and unlink protection only starts once the child
// is running.
//
// arch-testing confirmed the property empirically with its own throwaway probe
// during review and noted that nothing in the committed suite proved it: the
// existing cases pass whether or not the directories are shared, because each
// happens to use one instance. That is coverage by coincidence, so here is the
// direct proof.
test('CPF-17 independent stores do not share a copy directory or each other\'s cleanup', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const bytes = fs.readFileSync(target);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');

  const makeStore = () => createPinnedImageStore({
    fs, os, path, crypto, windowsPrivateDirectoryAcl,
  });
  const a = makeStore();
  const b = makeStore();

  const open = () => fs.openSync(target, fs.constants.O_RDONLY);
  const fdA = open();
  const fdB = open();
  let copyA;
  let copyB;
  try {
    copyA = a.materializePinnedCopy(fdA, bytes.length, digest);
    copyB = b.materializePinnedCopy(fdB, bytes.length, digest);
  } finally {
    fs.closeSync(fdA);
    fs.closeSync(fdB);
  }

  assert.equal(copyA.ok, true, copyA.reason);
  assert.equal(copyB.ok, true, copyB.reason);
  assert.notEqual(path.dirname(copyA.path), path.dirname(copyB.path),
    'two stores must not share one copy directory');

  // B tearing down is exactly the peer-exit scenario. A's copy must survive it
  // intact and still verify, not merely still exist.
  b.cleanupPinnedCopies();
  assert.equal(fs.existsSync(copyB.path), false, 'B must clean up its own copy');
  assert.equal(fs.existsSync(copyA.path), true,
    'a peer teardown must not remove another store\'s verified copy');
  assert.equal(a.verifyPinnedCopy(copyA.path, digest).ok, true,
    'A\'s copy must still verify after B tore down');

  a.cleanupPinnedCopies();
  assert.equal(fs.existsSync(copyA.path), false, 'A must clean up its own copy');
});
