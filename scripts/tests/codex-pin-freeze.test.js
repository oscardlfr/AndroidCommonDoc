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
  assert.ok(path.basename(out.command).endsWith(
    crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
  ), 'the copy name must be bound to the validated digest: ' + out.command);
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

function pinWith(fsOverrides) {
  return createAppServerPin({
    fs: Object.assign(Object.create(fs), fsOverrides),
    path,
    crypto,
    os,
    isTestCapability: () => false,
  });
}

test('CPF-08 a symlink swapped in after the lstat is refused by O_NOFOLLOW alone', () => {
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
