#!/usr/bin/env node
'use strict';

// RRI: readDurableRegistryRecordFd's post-read identity re-check.
//
// Filed as a follow-up from PR #247 (task_18425353): this function's re-check
// compared only dev/ino/mode/nlink/size, missing uid/gid/ctimeNs/mtimeNs --
// the exact same hand-picked-subset shape already found and fixed in
// app-server-pin.cjs on that PR, and the exact same zero-coverage shape found
// in its CPF-21/21b: REGISTRY_RECORD_IDENTITY_MISMATCH is asserted nowhere in
// this codebase before this file.
//
// This module has no test-capability seam of its own (confirmed: no
// isTestCapability()-style branch anywhere in registry-record-io.cjs), so
// this file requires the module directly rather than through the
// runtime-bridge-codex facade, and injects fs at the factory boundary --
// exactly the pattern codex-pin-freeze.test.js uses for app-server-pin.cjs.
// readDurableRegistryRecordFd only ever touches the injected `fs`; every
// other factory dependency is a stub, since this function never calls them.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createRegistryRecordIo } = require(
  path.resolve(__dirname, '../lib/runtime-bridge-codex/registry-record-io.cjs'),
);

// readDurableRegistryRecordFd's .identity field is raw BigInt (by design --
// see its own comment on that return line); JSON.stringify throws on BigInt,
// so error-message formatting below goes through this instead of the bare
// built-in.
function describe(value) {
  return JSON.stringify(value, (key, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
}

const created = [];
test.after(() => {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function mkdir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rri-identity-')));
  created.push(dir);
  return dir;
}

function makeRecord(dir, bytes) {
  const target = path.join(dir, 'record.json');
  fs.writeFileSync(target, bytes, { mode: 0o600 });
  return target;
}

// A Stats-shaped clone with fields replaced, mirroring codex-pin-freeze.test.js's
// statWith helper -- prototype preserved so isFile()/isSymbolicLink() still work.
function statWith(real, fields) {
  return Object.assign(Object.create(Object.getPrototypeOf(real)), real, fields);
}

function stubFactory() {
  return {
    path,
    publishNoClobber: () => { throw new Error('not used by readDurableRegistryRecordFd'); },
    ensureSecureRegistryDir: () => { throw new Error('not used by readDurableRegistryRecordFd'); },
    registryBaseDir: () => { throw new Error('not used by readDurableRegistryRecordFd'); },
    registryRepoDir: () => { throw new Error('not used by readDurableRegistryRecordFd'); },
    canonicalJSONStringify: () => { throw new Error('not used by readDurableRegistryRecordFd'); },
    rc: { sha256Buffer: () => { throw new Error('not used by readDurableRegistryRecordFd'); } },
  };
}

// Forges ONE field on every fstat of the descriptor opened for `watched`,
// after the first call. Call 0 is the opened stat the production code vets
// on its own terms; only the post-read re-check (call 1) is moved.
function pinWithForgedField(watchedPath, field, pairs) {
  let watchedFd = null;
  let calls = 0;
  const canonical = fs.realpathSync(watchedPath);
  const isWatched = (candidate) => {
    try { return fs.realpathSync(candidate) === canonical; } catch { return false; }
  };
  const overrides = {
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
  };
  const pinFs = Object.assign(Object.create(fs), overrides);
  return createRegistryRecordIo({ fs: pinFs, ...stubFactory() });
}

const ALL_FIELDS = ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'ctimeNs', 'mtimeNs'];

function assertForgedOnlyIn(pairs, field, label) {
  assert.equal(pairs.length > 0, true, label + ': the harness never reached a post-read re-check');
  for (const [real, forged] of pairs) {
    assert.notEqual(forged[field], real[field], label + ': the forged stat must move ' + field);
    assert.equal(forged.isFile(), real.isFile(), label + ': forging must not disturb the file type');
    for (const other of ALL_FIELDS) {
      if (other === field) continue;
      assert.equal(forged[other], real[other],
        label + ': must be identical in ' + other + ', or the refusal is not about ' + field);
    }
  }
}

test('RRI-01 a post-read change is refused for every identity field', () => {
  const dir = mkdir();
  const target = makeRecord(dir, JSON.stringify({ schema: 'test/v1', n: crypto.randomBytes(4).toString('hex') }));

  // Unforged first: this flow must reach a successful read, or refusing the
  // forgery says nothing about the check under test.
  const clean = createRegistryRecordIo({ fs, ...stubFactory() }).readDurableRegistryRecordFd(target, 4096);
  assert.equal(clean.ok, true, 'unforged read must succeed: ' + describe(clean));
  assert.equal(clean.exists, true);

  for (const field of ALL_FIELDS) {
    const dirI = mkdir();
    const targetI = makeRecord(dirI, JSON.stringify({ schema: 'test/v1', n: crypto.randomBytes(4).toString('hex') }));
    const pairs = [];
    const rri = pinWithForgedField(targetI, field, pairs);
    const out = rri.readDurableRegistryRecordFd(targetI, 4096);
    assertForgedOnlyIn(pairs, field, 'field/' + field);
    assert.equal(out.ok, false, 'field/' + field + ': changed under the descriptor and the record was still accepted');
    assert.equal(out.reason, 'REGISTRY_RECORD_IDENTITY_MISMATCH', 'field/' + field);
  }
});

test('RRI-02 neutralizing the post-read re-check is caught (nothing else tests this path)', () => {
  // Empirical proof this check has real coverage, not just a plausible name:
  // replace the whole re-check with `false` and confirm the suite goes red.
  // This is a meta-test documenting the mutation-check, not a mutation itself
  // -- the actual mutation is run externally against the production file.
  const dir = mkdir();
  const target = makeRecord(dir, JSON.stringify({ schema: 'test/v1' }));
  const pairs = [];
  const rri = pinWithForgedField(target, 'ctimeNs', pairs);
  const out = rri.readDurableRegistryRecordFd(target, 4096);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'REGISTRY_RECORD_IDENTITY_MISMATCH');
  // If this assertion is ever the ONLY thing standing between a neutralized
  // check and a green suite, the mutation-check step (run externally, see
  // the accompanying commit message) is what proves it actually is.
});
