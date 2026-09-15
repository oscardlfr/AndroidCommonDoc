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
  assert.equal(out.command, target);
  assert.deepEqual(out.args, ['app-server', '--listen', 'stdio://', '--strict-config']);
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
