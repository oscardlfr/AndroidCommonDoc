#!/usr/bin/env node
'use strict';

// RED-first tests for scripts/lib/verdict-artifact-store.cjs (does not exist yet,
// P1 of wave structured-verdict-evidence-contract; see PLAN.md sec 3.6-3.7, T5-T9).
//
// REVISION (post toolkit-specialist/arch-testing sync). Confirmed-final export surface
// (toolkit-specialist, directly -- NOT relayed via arch-testing; attribution corrected
// here per arch-testing's own message-history check):
//   readConfinedFile(waveDir, targetPath) -> {bytes, resolvedPath}
//     Confinement + no-follow (walks every ancestor path component, not just the leaf --
//     see the Windows-junction finding below) + size-cap + CR/NUL rejection + single-
//     trailing-LF + fatal UTF-8 decode + nlink===1 (hard-link rejection, toolkit-
//     specialist's addendum). Used for EVERY confined read: verdict, request, evidence
//     alike. Schema/JSON-decode is NOT this function's job (see decodeRecord in
//     verdict-evidence-contract.test.cjs) -- it returns raw bytes.
//   acquireLock(targetPath) -> lockHandle / releaseLock(lockHandle)
//     mkdir-exclusive .lock sibling, 1200ms/40ms poll, never age-reclaimed.
//   fsyncDir(dirPath, platform) -> boolean
//     `platform` is an EXPLICIT parameter (not a bare process.platform read), so the
//     open-mode branch ('r+' win32 vs 'r' otherwise) is deterministically forceable
//     from a test on any single host. This lets both branches get REAL (non-mocked)
//     syscall coverage on ANY one machine, not just via P5's two-platform CI split --
//     see the dual assertions below (mode selected AND real outcome on this host).
//   publishNoClobber(waveDir, targetPath, bytes) -> receipt|throws
//   publishSupersede(waveDir, targetPath, bytes, expectedCurrentSha256) -> receipt|throws
//     RESOLVED (arch-platform, relayed by toolkit-specialist): both take waveDir and
//     self-check confinement via the same resolvePhysical+confine-check ahead of
//     touching targetPath, symmetric with readConfinedFile -- PLAN.md sec 3.7 scopes
//     "confined durable reads/writes" to both reads AND writes. Confinement RED cases
//     below apply directly to these two functions with waveDir as their first arg.
//   No lockTimeoutMs override was confirmed as part of either signature (3/4 positional
//   args only) -- the lock-timeout RED case below therefore exercises the real default
//   timeout (1200ms, mirroring transition-lock/lifecycle.cjs's LOCK_MAX_WAIT_MS) rather
//   than an invented override; that single test is expected to take just over 1.2s.
//   isAncestorCommit(ancestorSha, descendantSha, repoRoot) -> boolean
//     Real `git merge-base --is-ancestor`, tested here against a REAL git repo with
//     REAL commits (never faked/injected) -- mirrors this codebase's own CORE
//     NON-VACUITY MANDATE.
//   computeRequestId() -> string (32-char lowercase hex, 128-bit request_id).
//   REASON_CODES -- frozen 6-value array (PLAN.md sec 3.6, exact); every thrown error
//     carries `.reasonCode` set to one of these.
//
// Test-capability fault-injection seam (mirrors this codebase's OWN established
// RUNTIME_CONSULTATION_FAULT_*/isTestCapability() convention -- gated behind BOTH
// NODE_ENV==='test' AND VERDICT_ARTIFACT_STORE_TEST_CAPABILITY non-empty):
//   VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE=1   throw after temp write, before the
//                                                     atomic publish step.
//   VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP=1     swap the temp/target out from
//                                                     under the store's own fd-bound
//                                                     identity capture -> identity-drift.
//   VERDICT_ARTIFACT_STORE_FAULT_DURABILITY=1        simulate an fsync/rename failure
//                                                     -> durability-unproven.
//
// Windows-reparse-point finding (empirically confirmed on this native-Windows machine,
// reported to arch-testing): fs.lstatSync(junctionPath).isSymbolicLink() DOES return
// true for a real junction; fs.openSync(junctionPath, O_NOFOLLOW) does NOT reject one
// (unlike a POSIX symlink's reliable ELOOP); an unguarded mkdirSync(recursive:true)+
// writeFileSync DOES follow it and land bytes outside the intended root. readConfinedFile
// therefore MUST do an explicit per-component lstatSync().isSymbolicLink() walk before
// any mkdirSync/openSync, mirroring transition-lock/confinement.cjs's
// assertAncestorChainConfined (independently reimplemented, never imported).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../lib/verdict-artifact-store.cjs');
const store = require(STORE_PATH);

const TEST_ENV = Object.assign({}, process.env, {
  NODE_ENV: 'test',
  VERDICT_ARTIFACT_STORE_TEST_CAPABILITY: 'verdict-artifact-store.test.cjs',
});

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-store-'));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function withTestEnv(fn) {
  const priors = {};
  for (const key of Object.keys(TEST_ENV)) priors[key] = process.env[key];
  Object.assign(process.env, TEST_ENV);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(priors)) {
      if (priors[key] === undefined) delete process.env[key];
      else process.env[key] = priors[key];
    }
  }
}

function assertReasonCode(fn, expectedReasonCode) {
  assert.throws(fn, (err) => {
    assert.strictEqual(err.reasonCode, expectedReasonCode, `expected reasonCode=${expectedReasonCode}, got ${err.reasonCode} (${err.message})`);
    return true;
  });
}

function gitCommit(dir, message) {
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', message], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString('utf8').trim();
}

function initGitRepo() {
  const dir = freshRoot();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const c1 = gitCommit(dir, 'c1');
  const c2 = gitCommit(dir, 'c2');
  return { dir, c1, c2 };
}

// ── reason code closure ─────────────────────────────────────────────────────────────

test('REASON_CODES is exactly the 6 stable strings from PLAN.md sec 3.6', () => {
  assert.deepStrictEqual(store.REASON_CODES.slice().sort(), [
    'already-exists', 'compare-mismatch', 'confinement-failed',
    'durability-unproven', 'identity-drift', 'lock-timeout',
  ]);
  assert.ok(Object.isFrozen(store.REASON_CODES));
});

// ── readConfinedFile: happy path + byte-level RED cases ─────────────────────────────

test('GREEN baseline: readConfinedFile returns the exact bytes of a well-formed confined file', () => {
  const waveDir = freshRoot();
  const target = path.join(waveDir, 'record.json');
  const bytes = Buffer.from('{"n":1}\n', 'utf8');
  fs.writeFileSync(target, bytes);
  const result = store.readConfinedFile(waveDir, target);
  assert.strictEqual(result.bytes.toString('utf8'), bytes.toString('utf8'));
});

test('opaque evidence: readConfinedFile preserves invalid UTF-8 bytes without interpreting them', () => {
  const waveDir = freshRoot();
  const target = path.join(waveDir, 'opaque.bin');
  const bytes = Buffer.from([0xc3, 0x28, 0x0d, 0x00, 0x41]);
  fs.writeFileSync(target, bytes);
  assert.deepStrictEqual(store.readConfinedFile(waveDir, target).bytes, bytes);
});

test('RED: readConfinedFile rejects a file over the configured size cap', () => {
  const waveDir = freshRoot();
  const target = path.join(waveDir, 'big.bin');
  fs.writeFileSync(target, Buffer.alloc(11 * 1024 * 1024, 0x41)); // 11 MiB -- over every plausible configured cap
  assert.throws(() => store.readConfinedFile(waveDir, target));
});

test('RED: readConfinedFile rejects a hard-linked file (nlink !== 1)', () => {
  const waveDir = freshRoot();
  const target = path.join(waveDir, 'record.json');
  fs.writeFileSync(target, Buffer.from('{"a":1}\n', 'utf8'));
  const secondName = path.join(freshRoot(), 'second-link.json');
  fs.linkSync(target, secondName);
  assert.throws(() => store.readConfinedFile(waveDir, target));
});

// ── readConfinedFile: confinement / symlink / reparse (T8) ──────────────────────────

test('RED: readConfinedFile rejects a targetPath that lexically escapes waveDir', () => {
  const waveDir = freshRoot();
  const outside = path.join(freshRoot(), 'outside.json');
  fs.writeFileSync(outside, Buffer.from('{}\n'));
  assertReasonCode(() => store.readConfinedFile(waveDir, outside), 'confinement-failed');
});

test('canonical confinement treats a parent-path alias and its real path as the same wave directory', () => {
  const container = freshRoot();
  const realParent = path.join(container, 'real-parent');
  const aliasParent = path.join(container, 'alias-parent');
  fs.mkdirSync(realParent);
  fs.symlinkSync(realParent, aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
  const logicalWave = path.join(aliasParent, 'wave-demo');
  fs.mkdirSync(logicalWave);
  const canonicalTarget = path.join(fs.realpathSync(logicalWave), 'record.json');
  fs.writeFileSync(canonicalTarget, Buffer.from('{}\n'));
  assert.strictEqual(store.readConfinedFile(logicalWave, canonicalTarget).bytes.toString('utf8'), '{}\n');
});

test('RED: readConfinedFile rejects a `..` traversal segment', () => {
  const waveDir = freshRoot();
  const escaping = path.join(waveDir, '..', 'escaped.json');
  assertReasonCode(() => store.readConfinedFile(waveDir, escaping), 'confinement-failed');
});

test('RED: readConfinedFile rejects when an ancestor path component is a symlink (POSIX)', { skip: process.platform === 'win32' ? 'POSIX-symlink case; Windows junction case covered separately below' : false }, () => {
  const waveDir = freshRoot();
  const evilDir = freshRoot();
  fs.writeFileSync(path.join(evilDir, 'record.json'), Buffer.from('{}\n'));
  const linkPath = path.join(waveDir, 'link');
  fs.symlinkSync(evilDir, linkPath);
  assertReasonCode(() => store.readConfinedFile(waveDir, path.join(linkPath, 'record.json')), 'confinement-failed');
});

test('RED: readConfinedFile rejects when an ancestor path component is a Windows junction', { skip: process.platform !== 'win32' ? 'Windows-native junction case; this leg is not win32' : false }, () => {
  // Empirically confirmed on this machine (see header + report to arch-testing):
  // isSymbolicLink() correctly flags a real junction; O_NOFOLLOW alone does not.
  const waveDir = freshRoot();
  const evilDir = freshRoot();
  fs.writeFileSync(path.join(evilDir, 'record.json'), Buffer.from('{}\n'));
  const junctionPath = path.join(waveDir, 'link');
  fs.symlinkSync(evilDir, junctionPath, 'junction');
  assertReasonCode(() => store.readConfinedFile(waveDir, path.join(junctionPath, 'record.json')), 'confinement-failed');
});

test('RED: readConfinedFile rejects a leaf that is itself a symlink', { skip: process.platform === 'win32' ? 'POSIX-symlink case; leaf reparse covered by the junction ancestor case on Windows' : false }, () => {
  const waveDir = freshRoot();
  const evilFile = path.join(freshRoot(), 'evil.json');
  fs.writeFileSync(evilFile, Buffer.from('evil\n'));
  const leafSymlink = path.join(waveDir, 'record.json');
  fs.symlinkSync(evilFile, leafSymlink);
  assertReasonCode(() => store.readConfinedFile(waveDir, leafSymlink), 'confinement-failed');
});

// ── fsyncDir: injectable platform param, both branches, real outcomes ──────────────

function withOpenSyncModeCapture(fn) {
  const original = fs.openSync;
  let capturedMode;
  fs.openSync = function patched(p, mode, ...rest) {
    capturedMode = mode;
    return original.call(fs, p, mode, ...rest);
  };
  try {
    return { result: fn(), capturedMode: () => capturedMode };
  } finally {
    fs.openSync = original;
  }
}

test('fsyncDir: platform="win32" selects a read-write ("r+") directory handle', () => {
  const dir = freshRoot();
  const { capturedMode } = withOpenSyncModeCapture(() => store.fsyncDir(dir, 'win32'));
  assert.strictEqual(capturedMode(), 'r+');
});

test('fsyncDir: a non-win32 platform value selects a read-only ("r") directory handle', () => {
  const dir = freshRoot();
  const { capturedMode } = withOpenSyncModeCapture(() => store.fsyncDir(dir, 'linux'));
  assert.strictEqual(capturedMode(), 'r');
});

test('fsyncDir: forcing platform="win32" on this native-Windows host genuinely succeeds (real r+ handle, real FlushFileBuffers)', { skip: process.platform !== 'win32' ? 'this leg is native-Windows only' : false }, () => {
  const dir = freshRoot();
  assert.strictEqual(store.fsyncDir(dir, 'win32'), true);
});

test('fsyncDir: forcing a POSIX platform value on this native-Windows host genuinely fails closed (real r-only handle cannot FlushFileBuffers)', { skip: process.platform !== 'win32' ? 'this leg is native-Windows only' : false }, () => {
  const dir = freshRoot();
  assert.strictEqual(store.fsyncDir(dir, 'linux'), false, 'proves the platform param drives a REAL different syscall outcome, not just an unused label');
});

test('fsyncDir: forcing platform="linux" on a POSIX host genuinely succeeds (real r-only handle)', { skip: process.platform === 'win32' ? 'this leg is POSIX-native only; proven on the Linux CI-equivalent profile (PLAN.md P5)' : false }, () => {
  const dir = freshRoot();
  assert.strictEqual(store.fsyncDir(dir, 'linux'), true);
});

test('fsyncDir: forcing platform="win32" on a POSIX host genuinely fails closed (real r+ open on a directory is typically EISDIR on POSIX)', { skip: process.platform === 'win32' ? 'this leg is POSIX-native only; proven on the Linux CI-equivalent profile (PLAN.md P5)' : false }, () => {
  const dir = freshRoot();
  assert.strictEqual(store.fsyncDir(dir, 'win32'), false);
});

// ── isAncestorCommit: real git, no faking ────────────────────────────────────────────

test('isAncestorCommit: true for a genuine ancestor and for a commit relative to itself, false for the reverse', () => {
  const { dir, c1, c2 } = initGitRepo();
  assert.strictEqual(store.isAncestorCommit(c1, c2, dir), true);
  assert.strictEqual(store.isAncestorCommit(c1, c1, dir), true, 'a commit is its own ancestor per git merge-base --is-ancestor semantics');
  assert.strictEqual(store.isAncestorCommit(c2, c1, dir), false);
});

test('isAncestorCommit: false for two commits on unrelated (orphan) histories', () => {
  const { dir, c1 } = initGitRepo();
  execFileSync('git', ['checkout', '-q', '--orphan', 'unrelated'], { cwd: dir });
  const orphanHead = gitCommit(dir, 'orphan-root');
  assert.strictEqual(store.isAncestorCommit(c1, orphanHead, dir), false);
});

// ── computeRequestId ─────────────────────────────────────────────────────────────────

test('computeRequestId returns 128-bit (32 lowercase hex) values, genuinely random across calls', () => {
  const a = store.computeRequestId();
  const b = store.computeRequestId();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.match(b, /^[0-9a-f]{32}$/);
  assert.notStrictEqual(a, b);
});

// ── publishNoClobber / publishSupersede: happy path ─────────────────────────────────

test('GREEN baseline: publishNoClobber on an absent target succeeds and is readable back', () => {
  const waveDir = freshRoot();
  const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
  const bytes = Buffer.from('{"schema":"verdict/v1"}\n', 'utf8');
  const result = store.publishNoClobber(waveDir, targetPath, bytes);
  assert.strictEqual(result.sha256, sha256(bytes));
  assert.strictEqual(store.readConfinedFile(waveDir, targetPath).bytes.toString('utf8'), bytes.toString('utf8'));
  assert.strictEqual(fs.statSync(targetPath).nlink, 1, 'the publication temp hard link must be removed before the target is consumed');
  const secondTarget = path.join(waveDir, 'arch-platform-verdict-prep.json');
  store.publishNoClobber(waveDir, secondTarget, bytes);
  assert.strictEqual(fs.existsSync(secondTarget), true, 'releasing one target lock must not poison later publications');
});

test('GREEN baseline: publishSupersede with the correct expected-current-sha256 replaces the target', () => {
  const waveDir = freshRoot();
  const targetPath = path.join(waveDir, 'arch-testing-verdict-verify-final.json');
  const v1 = Buffer.from('{"n":1}\n', 'utf8');
  const v2 = Buffer.from('{"n":2}\n', 'utf8');
  store.publishNoClobber(waveDir, targetPath, v1);
  const result = store.publishSupersede(waveDir, targetPath, v2, sha256(v1));
  assert.strictEqual(result.sha256, sha256(v2));
  assert.strictEqual(fs.readFileSync(targetPath).toString('utf8'), v2.toString('utf8'));
});

// ── T5/no-clobber, T6/CAS ───────────────────────────────────────────────────────────

test('RED: publishNoClobber on an already-existing target rejects already-exists', () => {
  const waveDir = freshRoot();
  const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
  store.publishNoClobber(waveDir, targetPath, Buffer.from('{"n":1}\n'));
  assertReasonCode(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{"n":2}\n')), 'already-exists');
  assert.strictEqual(fs.readFileSync(targetPath).toString('utf8'), '{"n":1}\n', 'the original target must be untouched');
});

test('RED: stale CAS digest (mutation check: exact-digest-match only, one-hex-char-diff rejects)', () => {
  const waveDir = freshRoot();
  const targetPath = path.join(waveDir, 'arch-testing-verdict-verify-final.json');
  const v1 = Buffer.from('{"n":1}\n');
  store.publishNoClobber(waveDir, targetPath, v1);
  const real = sha256(v1);
  const oneCharOff = (real[0] === '0' ? '1' : '0') + real.slice(1);
  assertReasonCode(() => store.publishSupersede(waveDir, targetPath, Buffer.from('{"n":2}\n'), oneCharOff), 'compare-mismatch');
  assert.strictEqual(fs.readFileSync(targetPath).toString('utf8'), '{"n":1}\n');
});

test('RED: publishSupersede against a target that does not exist rejects (nothing to compare against)', () => {
  const waveDir = freshRoot();
  const targetPath = path.join(waveDir, 'arch-testing-verdict-verify-final.json');
  assertReasonCode(() => store.publishSupersede(waveDir, targetPath, Buffer.from('{"n":1}\n'), sha256(Buffer.from('anything'))), 'compare-mismatch');
});

// ── T8: confinement on the write path (waveDir param confirmed final) ──────────────

test('RED: publishNoClobber rejects a targetPath escaping its intended waveDir via `..`', () => {
  const waveDir = freshRoot();
  const escaping = path.join(waveDir, '..', 'escaped-verdict.json');
  assertReasonCode(() => store.publishNoClobber(waveDir, escaping, Buffer.from('{}\n')), 'confinement-failed');
  assert.strictEqual(fs.existsSync(escaping), false);
});

test('RED: publishNoClobber rejects a targetPath lexically outside waveDir entirely', () => {
  const waveDir = freshRoot();
  const outsideTarget = path.join(freshRoot(), 'arch-testing-verdict-prep.json');
  assertReasonCode(() => store.publishNoClobber(waveDir, outsideTarget, Buffer.from('{}\n')), 'confinement-failed');
  assert.strictEqual(fs.existsSync(outsideTarget), false);
});

test('RED: publishNoClobber rejects writing through a Windows junction ancestor component', { skip: process.platform !== 'win32' ? 'Windows-native junction case; this leg is not win32' : false }, () => {
  const waveDir = freshRoot();
  const evilDir = freshRoot();
  const junctionPath = path.join(waveDir, 'link');
  fs.symlinkSync(evilDir, junctionPath, 'junction');
  const targetPath = path.join(junctionPath, 'nested', 'arch-testing-verdict-prep.json');
  assertReasonCode(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n')), 'confinement-failed');
  assert.strictEqual(fs.existsSync(path.join(evilDir, 'nested')), false, 'must never write through the junction into evilDir');
});

test('RED: publishNoClobber rejects writing through a POSIX symlink ancestor component', { skip: process.platform === 'win32' ? 'POSIX-symlink case; Windows junction case covered separately above' : false }, () => {
  const waveDir = freshRoot();
  const evilDir = freshRoot();
  const linkPath = path.join(waveDir, 'link');
  fs.symlinkSync(evilDir, linkPath);
  const targetPath = path.join(linkPath, 'nested', 'arch-testing-verdict-prep.json');
  assertReasonCode(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n')), 'confinement-failed');
  assert.strictEqual(fs.existsSync(path.join(evilDir, 'nested')), false, 'must never write through the symlink into evilDir');
});

// ── T7: durability, partial write (fault-injected) ──────────────────────────────────

test('RED: durability failure (fault-injected fsync/rename error) fails closed with durability-unproven', () => {
  withTestEnv(() => {
    process.env.VERDICT_ARTIFACT_STORE_FAULT_DURABILITY = '1';
    try {
      const waveDir = freshRoot();
      const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
      assertReasonCode(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n')), 'durability-unproven');
    } finally {
      delete process.env.VERDICT_ARTIFACT_STORE_FAULT_DURABILITY;
    }
  });
});

test('RED: partial write leaves no observable partial file (simulated crash mid-write)', () => {
  withTestEnv(() => {
    process.env.VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE = '1';
    try {
      const waveDir = freshRoot();
      const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
      assert.throws(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n')));
      assert.strictEqual(fs.existsSync(targetPath), false, 'no partial/renamed target may ever become observable');
      const leftovers = fs.existsSync(waveDir) ? fs.readdirSync(waveDir) : [];
      assert.deepStrictEqual(leftovers.filter((name) => !name.startsWith('.')), [], 'no visible leftover may remain after a crashed publish');
    } finally {
      delete process.env.VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE;
    }
  });
});

test('RED: identity drift (TOCTOU) -- a fault-injected swap between fd-bound capture and re-verify is detected', () => {
  withTestEnv(() => {
    process.env.VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP = '1';
    try {
      const waveDir = freshRoot();
      const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
      assertReasonCode(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n')), 'identity-drift');
    } finally {
      delete process.env.VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP;
    }
  });
});

// ── P1 gap-fix (arch-testing, 2026-09-21): publishSupersede fault-injection parity ──
// Read verdict-artifact-store.cjs directly before writing these: publishSupersede
// (lines 210-238) has NO CRASH_MID_WRITE check, NO IDENTITY_SWAP check, and discards
// writeTempSync's `identity` return value entirely (`const { tempPath } = writeTempSync(...)`)
// -- no post-rename fd-bound identity re-verification at all, unlike publishNoClobber's
// equivalent check at lines 193-203. durability-unproven IS already correctly wired
// (shared fsyncDir, which itself checks VERDICT_ARTIFACT_STORE_FAULT_DURABILITY) -- the
// third test below is a lower-priority symmetry/regression-guard case that is expected
// to pass immediately, not a RED case, per arch-testing's own framing.

test('RED (P1 gap-fix): publishSupersede ignores CRASH_MID_WRITE -- must throw and leave the original v1 completely untouched (CAS-safety)', () => {
  withTestEnv(() => {
    const waveDir = freshRoot();
    const targetPath = path.join(waveDir, 'arch-testing-verdict-verify-final.json');
    const v1 = Buffer.from('{"n":1}\n');
    store.publishNoClobber(waveDir, targetPath, v1);
    process.env.VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE = '1';
    try {
      assert.throws(() => store.publishSupersede(waveDir, targetPath, Buffer.from('{"n":2}\n'), sha256(v1)));
      assert.strictEqual(
        fs.readFileSync(targetPath).toString('utf8'), '{"n":1}\n',
        'a crashed supersede must never corrupt or partially-apply the new content over the old -- this is the more interesting assertion than the first-publish case',
      );
    } finally {
      delete process.env.VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE;
    }
  });
});

test('RED (P1 gap-fix): publishSupersede ignores IDENTITY_SWAP -- must throw reasonCode identity-drift', () => {
  withTestEnv(() => {
    const waveDir = freshRoot();
    const targetPath = path.join(waveDir, 'arch-testing-verdict-verify-final.json');
    const v1 = Buffer.from('{"n":1}\n');
    store.publishNoClobber(waveDir, targetPath, v1);
    process.env.VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP = '1';
    try {
      assertReasonCode(() => store.publishSupersede(waveDir, targetPath, Buffer.from('{"n":2}\n'), sha256(v1)), 'identity-drift');
    } finally {
      delete process.env.VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP;
    }
  });
});

test('symmetry/regression-guard (expected to already pass, not RED -- fsyncDir is shared and already wired correctly): publishSupersede durability failure fails closed with durability-unproven', () => {
  withTestEnv(() => {
    const waveDir = freshRoot();
    const targetPath = path.join(waveDir, 'arch-testing-verdict-verify-final.json');
    const v1 = Buffer.from('{"n":1}\n');
    store.publishNoClobber(waveDir, targetPath, v1);
    process.env.VERDICT_ARTIFACT_STORE_FAULT_DURABILITY = '1';
    try {
      assertReasonCode(() => store.publishSupersede(waveDir, targetPath, Buffer.from('{"n":2}\n'), sha256(v1)), 'durability-unproven');
    } finally {
      delete process.env.VERDICT_ARTIFACT_STORE_FAULT_DURABILITY;
    }
  });
});

// ── T5: lock timeout (real acquireLock/releaseLock, in-process, deterministic) ──────

test('RED: lock timeout -- a second caller fails closed while the lock is genuinely held (real default ~1200ms timeout, no invented override)', { timeout: 10000 }, () => {
  withTestEnv(() => {
    const waveDir = freshRoot();
    const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
    const lockHandle = store.acquireLock(targetPath);
    try {
      assertReasonCode(() => store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n')), 'lock-timeout');
    } finally {
      store.releaseLock(lockHandle);
    }
    // Once released, an ordinary call must succeed -- proves the timeout path didn't
    // corrupt lock state for subsequent legitimate callers.
    const result = store.publishNoClobber(waveDir, targetPath, Buffer.from('{}\n'));
    assert.strictEqual(result.sha256, sha256(Buffer.from('{}\n')));
  });
});

// ── T5: concurrent no-clobber writers, exactly one wins (genuine cross-process race) ─

test('RED: concurrent no-clobber writers -- two real processes race for the same target, exactly one wins', async () => {
  const waveDir = freshRoot();
  const targetPath = path.join(waveDir, 'arch-testing-verdict-prep.json');
  const workerPath = path.join(waveDir, '__worker-publish-no-clobber.cjs');
  fs.writeFileSync(workerPath, [
    "const store = require(" + JSON.stringify(STORE_PATH) + ");",
    "try {",
    "  const result = store.publishNoClobber(process.argv[2], process.argv[3], Buffer.from(process.argv[4], 'utf8'));",
    "  process.stdout.write(JSON.stringify({ ok: true, sha256: result.sha256 }));",
    "  process.exit(0);",
    "} catch (err) {",
    "  process.stdout.write(JSON.stringify({ ok: false, reasonCode: err && err.reasonCode || null }));",
    "  process.exit(1);",
    "}",
  ].join('\n'));

  function spawnWorker(bytes) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [workerPath, waveDir, targetPath, bytes], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.on('exit', (code) => resolve({ code, stdout }));
    });
  }

  const [a, b] = await Promise.all([spawnWorker('{"writer":"a"}\n'), spawnWorker('{"writer":"b"}\n')]);
  const results = [a, b].map((r) => Object.assign(JSON.parse(r.stdout), { code: r.code }));
  const winners = results.filter((r) => r.ok === true);
  const losers = results.filter((r) => r.ok === false);
  assert.strictEqual(winners.length, 1, 'exactly one concurrent first-publisher must win: ' + JSON.stringify(results));
  assert.strictEqual(losers.length, 1);
  assert.strictEqual(losers[0].reasonCode, 'already-exists');
  assert.strictEqual(winners[0].sha256, sha256(fs.readFileSync(targetPath)));
});
