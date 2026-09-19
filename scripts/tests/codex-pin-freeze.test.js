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
const { spawnSync } = require('node:child_process');

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
  // The mode comparison is now BigInt on both sides, because `stat` is a
  // BigIntStats: the freeze's octal string is widened rather than the stat's
  // mode being narrowed, so the POSIX permission contract is byte-identical
  // while identity stays out of double precision.
  assert.match(src, /process\.platform !== 'win32' && BigInt\(parseInt\(freeze\.mode_octal, 8\)\) !== \(stat\.mode & 0o7777n\)/);
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
// fs.constants.O_NOFOLLOW is undefined there, so production falls back to
// `(fs.constants.O_NOFOLLOW || 0)` -- a pre-existing idiom this file did not
// introduce -- and the open cannot PREVENT following a symlink on that platform.
//
// What replaces it there is reactive rather than preventive, and it is real:
// following a symlink lands on a different filesystem object, so the dev/ino
// identity comparison immediately after the open refuses it before a single byte
// is trusted. `dev` and `ino` are populated cross-platform, unlike O_NOFOLLOW.
// CPF-09 exercises that exact code path.
//
// Being exact about what IS and IS NOT proven on Windows, because an earlier
// version of this comment claimed more than the evidence supported:
//   * Ordinary symlink substitution IS empirically proven there -- CPF-05 plants
//     a real fs.symlinkSync and passes on the Windows runner.
//   * The identity comparison that backstops THIS case is exercised by CPF-09 and
//     CPF-10 through injected fstat results, i.e. by simulation of the mismatch
//     rather than against a real symlink. Sound, but not empirical.
//   * So what remains unproven on Windows is narrow: a real symlink against this
//     specific defence-in-depth scenario, where the first lstat itself lies.
//     Tracked as a follow-up rather than asserted here, since asserting
//     O_NOFOLLOW on Windows would demand a guarantee the platform never offered.
test('CPF-08 a symlink swapped in after the lstat is refused by O_NOFOLLOW alone',
  { skip: process.platform === 'win32' ? 'O_NOFOLLOW is POSIX-only; on win32 the dev/ino check backstops this reactively (see comment)' : false },
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

// Rewritten for determinism after a Windows audit found it alternating between
// two different refusal reasons on the same HEAD. Two defects caused that:
//
//   * `real.ino + 1` mutated a double. A 64-bit Windows inode is its own
//     successor at that magnitude, so on Windows the "replacement" frequently
//     had the identical identity and the case passed or failed on whatever else
//     happened to differ.
//   * The override was GLOBAL, so it also reached the pinned executable's own
//     descriptor and could refuse with CODEX_PIN_TARGET_REBOUND instead of the
//     reason under test.
//
// Now the injection is scoped to the freeze descriptor alone and the two
// identities differ under every representation, so exactly one refusal is
// reachable. The loop asserts that in CI on every run rather than relying on
// anyone having run it repeatedly by hand.
test('CPF-09 a freeze replaced between the pathname check and the open is refused', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freezePath = writeFreeze(dir, freezeFor(target));

  const reasons = new Set();
  const REPEATS = 20;
  for (let i = 0; i < REPEATS; i += 1) {
    // lstat reports the file the caller vetted; the descriptor actually opened
    // belongs to a different inode -- a swap inside the check/open window.
    const pin = pinWithFreezeIdentity(freezePath, 424242n, 424243n);
    const out = withPin({ mode: 'genuine-pinned', freeze: freezePath },
      () => pin.validatePinnedCodexExecutable(target));
    assert.equal(out.ok, false);
    reasons.add(out.reason);
  }
  assert.deepEqual([...reasons], ['CODEX_PIN_FREEZE_INSECURE'],
    `${REPEATS} runs must all refuse for the same reason; saw ${[...reasons].join(', ')}`);
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

// ── Security identity must be compared in BigInt, never as a double ─────────
//
// fs.Stats exposes `ino` as a double unless `{ bigint: true }` is requested.
// Windows NTFS file IDs are 64-bit and routinely exceed Number.MAX_SAFE_INTEGER,
// so two genuinely different files collide once their identities are rounded.
// Measured on a real Windows runner: ino 28710447629357696 satisfies
// `ino + 1 === ino`, and across 500 freshly created files five pairs had
// distinct 64-bit ids that were indistinguishable as doubles.
//
// This is a production defect, not a test artefact. Every identity comparison
// that refuses a substituted file -- freeze record, pinned executable,
// protected host Codex pin -- compared dev/ino. As doubles, a swap into a
// nearby inode reads as the same file and is accepted.
//
// Scoping the injection to ONE descriptor matters as much as the values. The
// previous global fstatSync override also reached the pinned executable's
// descriptor, so the same case could refuse with CODEX_PIN_TARGET_REBOUND
// instead of the reason under test -- which is why it alternated between two
// outcomes on the same HEAD.

// A Stats-shaped clone with fields replaced; the prototype is preserved so
// isFile()/isSymbolicLink() keep working, and BigIntStats clone the same way.
function statWith(real, fields) {
  return Object.assign(Object.create(Object.getPrototypeOf(real)), real, fields);
}

// Reports `pathIno` for lstat of the freeze record and `fdIno` for fstat of the
// descriptor actually opened from it. Every other path and descriptor is
// untouched, so nothing else in the flow can produce the refusal.
function pinWithFreezeIdentity(freezePath, pathIno, fdIno) {
  let freezeFd = null;
  const canonicalFreeze = fs.realpathSync(freezePath);
  const isFreeze = (p) => {
    try { return fs.realpathSync(p) === canonicalFreeze; } catch (err) { return false; }
  };
  const pick = (opts, value) => ((opts && opts.bigint) ? value : Number(value));
  return pinWith({
    lstatSync(p, ...rest) {
      const real = fs.lstatSync(p, ...rest);
      return isFreeze(p) ? statWith(real, { ino: pick(rest[0], pathIno) }) : real;
    },
    openSync(p, ...rest) {
      const fd = fs.openSync(p, ...rest);
      if (isFreeze(p)) freezeFd = fd;
      return fd;
    },
    fstatSync(fd, ...rest) {
      const real = fs.fstatSync(fd, ...rest);
      if (freezeFd === null || fd !== freezeFd) return real;
      return statWith(real, { ino: pick(rest[0], fdIno) });
    },
  });
}

// Per-leg, because a whole-chain assertion is not a guard.
//
// readCodexPinFreeze compares identity three times: the opened descriptor
// against the vetted pathname, the descriptor against itself after the read,
// and the pathname against the descriptor after the read. A single case that
// merely reaches "refused" passes even when two of the three have regressed,
// because whichever leg still works catches it. Verified, not assumed: with
// only the first leg projected back to Number the earlier single-case version
// of this test stayed green, caught by the third leg instead.
//
// So each leg is driven in isolation, with the other two arranged to agree.
// Reverting any ONE of them to a Number comparison turns exactly its own case
// red.
function pinWithScriptedFreezeIdentity(freezePath, lstatInos, fstatInos) {
  let freezeFd = null;
  let lstatCall = 0;
  let fstatCall = 0;
  const canonicalFreeze = fs.realpathSync(freezePath);
  const isFreeze = (candidate) => {
    try { return fs.realpathSync(candidate) === canonicalFreeze; } catch (err) { return false; }
  };
  // Last value repeats, so a script shorter than the call count is still total.
  const at = (list, i) => list[Math.min(i, list.length - 1)];
  const pick = (opts, value) => ((opts && opts.bigint) ? value : Number(value));
  return pinWith({
    lstatSync(candidate, ...rest) {
      const real = fs.lstatSync(candidate, ...rest);
      if (!isFreeze(candidate)) return real;
      const value = at(lstatInos, lstatCall);
      lstatCall += 1;
      return statWith(real, { ino: pick(rest[0], value) });
    },
    openSync(candidate, ...rest) {
      const fd = fs.openSync(candidate, ...rest);
      if (isFreeze(candidate)) freezeFd = fd;
      return fd;
    },
    fstatSync(fd, ...rest) {
      const real = fs.fstatSync(fd, ...rest);
      if (freezeFd === null || fd !== freezeFd) return real;
      const value = at(fstatInos, fstatCall);
      fstatCall += 1;
      return statWith(real, { ino: pick(rest[0], value) });
    },
  });
}

// A real Windows inode from the audit. The double spacing at this magnitude is
// 4, so BASE+1n rounds to BASE: as doubles the two are the same file.
const COLLIDING_BASE = 28710447629357696n;
const COLLIDING_NEXT = COLLIDING_BASE + 1n;

test('CPF-18 double-colliding identities are refused at each of the three legs', () => {
  assert.equal(Number(COLLIDING_NEXT), Number(COLLIDING_BASE),
    'the fixture must be beyond double precision or none of this proves anything');
  assert.notEqual(COLLIDING_NEXT, COLLIDING_BASE);

  // [ lstat script, fstat script, which leg it isolates ]
  const legs = [
    [[COLLIDING_BASE, COLLIDING_NEXT], [COLLIDING_NEXT], 'opened descriptor vs vetted pathname'],
    [[COLLIDING_BASE], [COLLIDING_BASE, COLLIDING_NEXT], 'descriptor vs itself after the read'],
    [[COLLIDING_BASE, COLLIDING_NEXT], [COLLIDING_BASE], 'pathname vs descriptor after the read'],
  ];

  for (const [lstatInos, fstatInos, leg] of legs) {
    const dir = mkdir();
    const target = makeExecutable(dir, 'codex-binary-v1\n');
    const freezePath = writeFreeze(dir, freezeFor(target));
    const pin = pinWithScriptedFreezeIdentity(freezePath, lstatInos, fstatInos);
    const out = withPin({ mode: 'genuine-pinned', freeze: freezePath },
      () => pin.validatePinnedCodexExecutable(target));
    assert.equal(out.ok, false,
      `leg "${leg}" accepted two files whose 64-bit identities differ`);
    assert.equal(out.reason, 'CODEX_PIN_FREEZE_INSECURE', `leg "${leg}"`);
  }
});

// CPF-19: the protected copy must be an image the operating system can actually
// start. Naming it .exe on Windows is necessary but proves nothing by itself --
// only a real CreateProcess/libuv resolution does, and that is precisely the leg
// that was broken: an extensionless copy failed ERROR_FILE_NOT_FOUND, so the
// validated bytes never ran while every assertion about the path still passed.
//
// The executable under pin has to survive being COPIED, which rules out
// process.execPath here: Homebrew's node is a small launcher that dynamically
// links @rpath/libnode, so a copy outside its own directory dies in dyld before
// main(). Each platform therefore contributes something self-contained:
//
//   * win32 -- a real PE from System32. This is the case that matters, because
//     it is the platform whose loader refused an extensionless path.
//   * POSIX  -- a shebang script, which the kernel genuinely execve()s.
//
// Different images, identical contract: the copy resolves, starts, exits 0 and
// prints what it was supposed to print.
function launchableFixture(dir) {
  if (process.platform === 'win32') {
    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const source = path.join(dir, 'codex-under-pin.exe');
    // hostname.exe links only against system DLLs resolved by the standard
    // search order, so it still runs from a private directory.
    fs.copyFileSync(path.join(system32, 'hostname.exe'), source);
    return { source, args: [], check: (out) => out.length > 0 };
  }
  const source = path.join(dir, 'codex-under-pin');
  fs.writeFileSync(source, '#!/bin/sh\necho CPF19-LAUNCHED\n', { mode: 0o755 });
  fs.chmodSync(source, 0o755);
  return { source, args: [], check: (out) => out === 'CPF19-LAUNCHED' };
}

test('CPF-19 the protected copy is an image the OS actually launches', () => {
  const dir = mkdir();
  const { source, args, check } = launchableFixture(dir);

  // The fixture itself must be launchable, or the case proves nothing about the
  // copy. Fail loudly here rather than let a broken fixture read as a pass.
  const baseline = spawnSync(source, args, { shell: false, encoding: 'utf8' });
  assert.equal(baseline.status, 0,
    'fixture executable must run before the copy is tested; stderr=' + String(baseline.stderr).slice(0, 200));

  const freeze = writeFreeze(dir, freezeFor(source));
  const out = withPin({ mode: 'genuine-pinned', freeze }, () => validate(source));
  assert.equal(out.ok, true, out.reason);

  // Created, named by its digest, and not the mutable original.
  assert.notEqual(out.command, source);
  assert.equal(fs.existsSync(out.command), true, 'the protected copy must exist');
  assert.equal(
    path.basename(out.command),
    'codex-' + crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
      + (process.platform === 'win32' ? '.exe' : ''),
    'the copy must be named by its validated digest',
  );

  // The leg that matters: the platform resolves and starts it, shell:false,
  // exactly as the supervisor spawns it.
  const run = spawnSync(out.command, args, { shell: false, encoding: 'utf8' });
  assert.equal(run.error, undefined,
    'spawn must resolve the protected copy: ' + String(run.error));
  assert.equal(run.status, 0,
    'the protected copy must exit 0; stderr=' + String(run.stderr).slice(0, 200));
  assert.equal(check(String(run.stdout).trim()), true,
    'the launched image must be the pinned bytes, not another resolvable program');

  // Cleanup, against the real production store rather than a stand-in.
  const store = createPinnedImageStore({ fs, os, path, crypto, windowsPrivateDirectoryAcl });
  const bytes = fs.readFileSync(source);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const fd = fs.openSync(source, fs.constants.O_RDONLY);
  let copy;
  try { copy = store.materializePinnedCopy(fd, bytes.length, digest); } finally { fs.closeSync(fd); }
  assert.equal(copy.ok, true, copy.reason);
  const relaunched = spawnSync(copy.path, args, { shell: false, encoding: 'utf8' });
  assert.equal(relaunched.status, 0, 'a store-materialized copy must launch too');
  store.cleanupPinnedCopies();
  assert.equal(fs.existsSync(copy.path), false, 'cleanup must remove the copy it made');
});

// CPF-20: the post-read re-check must witness ANY metadata change, per field.
//
// The three re-check sites in this module each compared a hand-picked subset of
// the stat fields, and all three omitted ctimeNs. That matters because mtimeNs
// is attacker-settable: the owner of a file can rewrite it in place and then
// put the old modification time back with utimensat, leaving dev, ino, size,
// nlink and mtimeNs all identical across the read. On POSIX ctimeNs cannot be
// restored that way -- no standard call sets it directly, and the very act of
// resetting mtime moves it forward -- so it witnesses the rewrite there. On
// Windows ChangeTime IS a settable field (SetFileInformationByHandle with
// FileBasicInfo, given FILE_WRITE_ATTRIBUTES), so the same guarantee does not
// hold: comparing it there catches an ordinary rewrite, not a same-account
// actor who resets ChangeTime too. Platform-exact guarantee, not this file's
// job to restate: docs/agents/runtime-messaging-trust-boundaries.md.
//
// This is not a claim that the same-uid boundary is closed; it is not. The
// module's contract against that actor is DETECTION (see the threat-model
// header in app-server-pinned-image.cjs), and on POSIX a detection that a
// restored timestamp defeats is not the detection the contract promises; on
// Windows this field's detection is correspondingly narrower, not the boundary
// itself widening.
//
// Driven per FIELD rather than once, for the same reason CPF-18 is driven per
// leg. A single case proves only that some field is compared; it stays green
// while any other one carries it. Verified, not assumed: the first version of
// this test asserted only the ctimeNs case, and dropping mtimeNs or gid from
// IDENTITY_FIELDS left it green -- two fields shipped that nothing held up.
//
// Modelled by injection rather than by racing a real rewrite, because the race
// is non-deterministic and CPF-09 already paid for that lesson. Each injected
// pair is asserted to differ in its one target field and in NOTHING else, so a
// case cannot pass for an incidental reason.
function pinWithForgedField(freezePath, field, pairs) {
  let freezeFd = null;
  let fstatCall = 0;
  const canonicalFreeze = fs.realpathSync(freezePath);
  const isFreeze = (candidate) => {
    try { return fs.realpathSync(candidate) === canonicalFreeze; } catch (err) { return false; }
  };
  return pinWith({
    openSync(candidate, ...rest) {
      const fd = fs.openSync(candidate, ...rest);
      if (isFreeze(candidate)) freezeFd = fd;
      return fd;
    },
    fstatSync(fd, ...rest) {
      const real = fs.fstatSync(fd, ...rest);
      if (freezeFd === null || fd !== freezeFd) return real;
      const call = fstatCall;
      fstatCall += 1;
      // Call 0 is the opened descriptor, which the production code vets on its
      // own terms; every later one is a post-read re-check, and only those are
      // moved. +1n on mode touches the low permission bit, never S_IFMT, so
      // isFile() keeps answering truthfully.
      if (call === 0 || !(rest[0] && rest[0].bigint)) return real;
      const forged = statWith(real, { [field]: real[field] + 1n });
      pairs.push([real, forged]);
      return forged;
    },
  });
}

test('CPF-20 a post-read change is refused for every identity field', () => {
  // The flow must be able to PASS, or refusing anything proves nothing.
  const cleanDir = mkdir();
  const cleanTarget = makeExecutable(cleanDir, 'codex-binary-v1\n');
  const cleanFreeze = writeFreeze(cleanDir, freezeFor(cleanTarget));
  const clean = withPin({ mode: 'genuine-pinned', freeze: cleanFreeze },
    () => validate(cleanTarget));
  assert.equal(clean.ok, true, 'unforged flow must be accepted: ' + clean.reason);

  const fields = ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'ctimeNs', 'mtimeNs'];
  for (const field of fields) {
    const dir = mkdir();
    const target = makeExecutable(dir, 'codex-binary-v1\n');
    const freezePath = writeFreeze(dir, freezeFor(target));
    const pairs = [];
    const pin = pinWithForgedField(freezePath, field, pairs);
    const out = withPin({ mode: 'genuine-pinned', freeze: freezePath },
      () => pin.validatePinnedCodexExecutable(target));

    assert.equal(pairs.length > 0, true,
      'field "' + field + '": the harness never reached a post-read re-check');
    for (const [real, forged] of pairs) {
      assert.notEqual(forged[field], real[field],
        'field "' + field + '": the forged stat must actually move it');
      assert.equal(forged.isFile(), real.isFile(),
        'field "' + field + '": forging must not disturb the file type');
      for (const other of fields.filter((f) => f !== field)) {
        assert.equal(forged[other], real[other],
          'field "' + field + '": must be identical in ' + other + ', or the refusal is not about ' + field);
      }
    }

    assert.equal(out.ok, false,
      'field "' + field + '" changed under the descriptor and the record was still accepted');
    assert.equal(out.reason, 'CODEX_PIN_FREEZE_INSECURE', 'field "' + field + '"');
  }
});

// CPF-21: the OTHER two post-read re-checks, which nothing tested at all.
//
// readCodexPinFreeze is not the only place this module re-checks identity after
// a read. enforceCodexPinFreeze does it for the pinned executable, and
// readProtectedHostCodexPin does it for the host config.toml. Neither reason
// code -- CODEX_PIN_TARGET_CHANGED_DURING_READ, CODEX_CONFIG_CHANGED_DURING_READ
// -- appeared anywhere in this suite.
//
// That was not a hypothesis. Both `if` blocks were replaced with `if (false)`
// and the whole suite stayed green: either check could have been deleted
// outright and nothing would have said so. Widening IDENTITY_FIELDS without
// covering these would have meant shipping a change to two security paths that
// nothing exercises, while calling the change verified.
//
// Each leg forges ONE field on the post-read fstat of the descriptor that leg
// owns, and asserts its own distinct reason code -- not merely ok===false, so a
// refusal arriving from an unrelated earlier check cannot stand in for the one
// under test.
function pinWithForgedFd(fsOverrides, opts = {}) {
  const pinFs = Object.assign(Object.create(fs), fsOverrides);
  const { materializePinnedCopy, cleanupPinnedCopies } = createPinnedImageStore({
    fs: pinFs, os, path, crypto, windowsPrivateDirectoryAcl,
  });
  return createAppServerPin({
    fs: pinFs,
    path,
    crypto,
    os,
    isTestCapability: () => opts.testCapability === true,
    windowsPrivateDirectoryAcl,
    windowsAclSnapshotsEqual,
    materializePinnedCopy,
    cleanupPinnedCopies,
  });
}

// Forges `field` on every fstat of the descriptor opened for `watched`, after
// the first. Call 0 is the opened stat the production code vets on its own
// terms; only the post-read re-checks are moved.
function forgeAfterReadFstat(watched, field, pairs, extra = {}) {
  let watchedFd = null;
  let calls = 0;
  const canonical = fs.realpathSync(watched);
  const isWatched = (candidate) => {
    try { return fs.realpathSync(candidate) === canonical; } catch (err) { return false; }
  };
  return Object.assign({
    openSync(candidate, ...rest) {
      const fd = fs.openSync(candidate, ...rest);
      if (isWatched(candidate)) watchedFd = fd;
      return fd;
    },
    fstatSync(fd, ...rest) {
      const real = fs.fstatSync(fd, ...rest);
      if (watchedFd === null || fd !== watchedFd) return real;
      const call = calls;
      calls += 1;
      if (call === 0 || !(rest[0] && rest[0].bigint)) return real;
      const forged = statWith(real, { [field]: real[field] + 1n });
      pairs.push([real, forged]);
      return forged;
    },
  }, extra);
}

function assertForgedOnlyIn(pairs, field, label) {
  assert.equal(pairs.length > 0, true, label + ': the harness never reached a post-read re-check');
  for (const [real, forged] of pairs) {
    assert.notEqual(forged[field], real[field], label + ': the forged stat must move ' + field);
    for (const other of ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'ctimeNs', 'mtimeNs']) {
      if (other === field) continue;
      assert.equal(forged[other], real[other],
        label + ': must be identical in ' + other + ', or the refusal is not about ' + field);
    }
  }
}

test('CPF-21 the pinned executable is re-checked after its read', () => {
  const dir = mkdir();
  const target = makeExecutable(dir, 'codex-binary-v1\n');
  const freeze = writeFreeze(dir, freezeFor(target));

  // Unforged first: this flow must reach a successful validation, or refusing
  // the forgery says nothing about the check under test.
  const clean = withPin({ mode: 'genuine-pinned', freeze }, () => validate(target));
  assert.equal(clean.ok, true, 'unforged flow must be accepted: ' + clean.reason);

  // THE FLOOR: dev/ino/size, matching what this site actually compares. It
  // deliberately does NOT use IDENTITY_FIELDS -- the executable's bytes are
  // digest-bound twice (freeze comparison, then a re-hash of the materialized
  // copy), so widening the stat check here would catch nothing and would refuse
  // a legitimate launch whenever an antivirus touched the file's metadata
  // mid-read.
  for (const field of ['dev', 'ino', 'size']) {
    const pairs = [];
    const pin = pinWithForgedFd(forgeAfterReadFstat(target, field, pairs));
    const out = withPin({ mode: 'genuine-pinned', freeze },
      () => pin.validatePinnedCodexExecutable(target));
    assertForgedOnlyIn(pairs, field, 'executable/' + field);
    assert.equal(out.ok, false, 'executable/' + field + ': changed under the descriptor and was accepted');
    assert.equal(out.reason, 'CODEX_PIN_TARGET_CHANGED_DURING_READ', 'executable/' + field);
  }

  // THE CEILING, and the floor above is worth little without it.
  //
  // An earlier version of this case asserted only the floor and claimed in its
  // own comment that a future widening of this site "shows up as a test that
  // needs a decision". That claim was false, and was disproved rather than
  // doubted: widening the site back to the full identityUnchanged() left the
  // entire suite at 22/22. A superset check satisfies every floor assertion
  // silently -- refusing MORE than required never trips a test that only checks
  // that certain things are refused.
  //
  // So the narrow contract is asserted from both sides. ctimeNs is the field to
  // pick, being the one this whole feature exists for: forging it here must be
  // ACCEPTED, because this site is digest-backed and deliberately does not look.
  // Widening the site now turns this red and forces the decision to be made
  // again, which is what the comment claimed all along.
  const ceilingPairs = [];
  const ceilingPin = pinWithForgedFd(forgeAfterReadFstat(target, 'ctimeNs', ceilingPairs));
  const ceiling = withPin({ mode: 'genuine-pinned', freeze },
    () => ceilingPin.validatePinnedCodexExecutable(target));
  assertForgedOnlyIn(ceilingPairs, 'ctimeNs', 'executable/ceiling');
  assert.equal(ceiling.ok, true,
    'this site is digest-backed and must NOT compare ctimeNs; if it now does, that is a '
    + 'widening that needs deciding rather than inheriting: ' + ceiling.reason);
});

test('CPF-21b the host config is re-checked after its read', () => {
  const home = mkdir();
  const configDir = path.join(home, '.codex');
  fs.mkdirSync(configDir, { mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  const configPath = path.join(configDir, 'config.toml');
  const pinnedCli = makeExecutable(home, 'codex-binary-v1\n', 'codex-cli');
  // TOML basic strings (double-quoted) forbid backslashes -- production's own
  // regex excludes them deliberately, and its comment says literal strings are
  // the native way to spell a Windows path. So a win32 fixture MUST use the
  // literal form; a double-quoted `C:\...` parses as CODEX_CONFIG_PIN_MALFORMED
  // and the case fails at its clean-path guard. Found by the Windows CI job on a
  // real runner, not by reading the regex -- which is what that job is for.
  const quote = process.platform === 'win32' ? "'" : '"';
  fs.writeFileSync(configPath, 'CODEX_CLI_PATH = ' + quote + pinnedCli + quote + '\n', { mode: 0o600 });
  fs.chmodSync(configPath, 0o600);
  if (process.platform === 'win32') {
    const acl = windowsPrivateDirectoryAcl(configDir, { mode: 'ensure' });
    assert.equal(acl && acl.ok, true, 'fixture config dir must be owner-confined on Windows');
  }

  const prevHome = process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME;
  process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = home;
  try {
    // Unforged first, same reason as above.
    const cleanPin = pinWithForgedFd({}, { testCapability: true });
    const clean = cleanPin.readProtectedHostCodexPin();
    assert.equal(clean.ok, true, 'unforged config read must succeed: ' + clean.reason);
    assert.equal(clean.configured, true, 'the fixture config must actually be read');

    // All nine. config.toml has no digest behind it, so this stat comparison is
    // the sole integrity guard and every field in the list must be held up here
    // rather than only at site 1. The first version of this loop covered six --
    // dropping 'size' from IDENTITY_FIELDS left it green while CPF-20 caught it,
    // so a regression narrowing THIS site alone would have slipped past.
    for (const field of ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'ctimeNs', 'mtimeNs']) {
      const pairs = [];
      const pin = pinWithForgedFd(forgeAfterReadFstat(configPath, field, pairs), { testCapability: true });
      const out = pin.readProtectedHostCodexPin();
      assertForgedOnlyIn(pairs, field, 'config/' + field);
      assert.equal(out.ok, false, 'config/' + field + ': changed under the descriptor and was accepted');
      assert.equal(out.reason, 'CODEX_CONFIG_CHANGED_DURING_READ', 'config/' + field);
    }
  } finally {
    if (prevHome === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME;
    else process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = prevHome;
  }
});

// CPF-22/23/24: the config.toml parser's own reason codes, which had zero
// coverage anywhere in this codebase before this file. Found alongside the
// CODEX_CONFIG_PIN_MALFORMED backstop below: arch-testing traced the parsing
// loop and found it sat OUTSIDE readProtectedHostCodexPin's own try/catch, so
// a future regression in the `if (!match) return` guard would surface as an
// uncaught TypeError, not a reason code. That backstop is production code
// now (app-server-pin.cjs); these three cases are the coverage gap itself.
function configWith(home, tomlBody) {
  const configDir = path.join(home, '.codex');
  fs.mkdirSync(configDir, { mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  const configPath = path.join(configDir, 'config.toml');
  fs.writeFileSync(configPath, tomlBody, { mode: 0o600 });
  fs.chmodSync(configPath, 0o600);
  if (process.platform === 'win32') {
    const acl = windowsPrivateDirectoryAcl(configDir, { mode: 'ensure' });
    assert.equal(acl && acl.ok, true, 'fixture config dir must be owner-confined on Windows');
  }
  return configPath;
}

function withCodexHome(home, fn) {
  const prevHome = process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME;
  process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = home;
  try { return fn(); } finally {
    if (prevHome === undefined) delete process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME;
    else process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME = prevHome;
  }
}

test('CPF-22 a malformed CODEX_CLI_PATH line is refused, not thrown', () => {
  const home = mkdir();
  // Unquoted value: matches the "line starts an assignment" probe but not the
  // full grammar, so it must reach CODEX_CONFIG_PIN_MALFORMED via the `if
  // (!match) return` guard -- the exact guard whose removal the backstop now
  // catches.
  configWith(home, 'CODEX_CLI_PATH = not-a-valid-toml-string\n');
  const out = withCodexHome(home, () => pinWithForgedFd({}, { testCapability: true }).readProtectedHostCodexPin());
  assert.equal(out.ok, false, 'a malformed CODEX_CLI_PATH line was accepted');
  assert.equal(out.reason, 'CODEX_CONFIG_PIN_MALFORMED');
});

test('CPF-23 a config with no CODEX_CLI_PATH assignment is refused as absent', () => {
  const home = mkdir();
  configWith(home, '# codex config -- no CLI pin set\nmodel = "gpt-5-codex"\n');
  const out = withCodexHome(home, () => pinWithForgedFd({}, { testCapability: true }).readProtectedHostCodexPin());
  assert.equal(out.ok, false, 'a config with no CODEX_CLI_PATH assignment was accepted');
  assert.equal(out.reason, 'CODEX_CONFIG_PIN_ABSENT');
});

test('CPF-24 a config with two CODEX_CLI_PATH assignments is refused as ambiguous', () => {
  const home = mkdir();
  const first = makeExecutable(home, 'codex-binary-v1\n', 'codex-cli-a');
  const second = makeExecutable(home, 'codex-binary-v2\n', 'codex-cli-b');
  // Same win32 quoting rule as the fixture above: TOML basic (double-quoted)
  // strings forbid backslashes, so a raw win32 path needs the literal
  // (single-quoted) form or it parses as CODEX_CONFIG_PIN_MALFORMED instead
  // of reaching the ambiguous-count check this test targets.
  const quote = process.platform === 'win32' ? "'" : '"';
  configWith(home, 'CODEX_CLI_PATH = ' + quote + first + quote + '\nCODEX_CLI_PATH = ' + quote + second + quote + '\n');
  const out = withCodexHome(home, () => pinWithForgedFd({}, { testCapability: true }).readProtectedHostCodexPin());
  assert.equal(out.ok, false, 'two CODEX_CLI_PATH assignments were silently accepted (which one would run?)');
  assert.equal(out.reason, 'CODEX_CONFIG_PIN_AMBIGUOUS');
});
