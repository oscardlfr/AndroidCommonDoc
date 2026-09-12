#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// FINAL CONTRACT RECONCILIATION follow-up: a permanent, re-runnable regression
// test for scripts/tests/lib/private-registry-tmpdir-preload.cjs -- replaces a
// prior one-time, manually-applied-and-reverted mutation test (reported only in
// prose during the mission that built the preload) with a durable, hash-bound
// proof that re-verifies on every suite run, never trusting a past manual claim.
//
// Deliberately does NOT require the preload directly at this file's own top
// level (that would consume ITS containment for the rest of this process,
// including node:test's own machinery) -- every check below drives it as a
// real, isolated child process instead.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PRELOAD_PATH = path.resolve(__dirname, 'lib', 'private-registry-tmpdir-preload.cjs');
const RLL_PATH = path.resolve(__dirname, '..', 'lib', 'runtime-role-lifecycle.cjs');

test('private-registry-tmpdir-preload: normal require establishes registryBaseDir() containment', () => {
  const r = spawnSync('node', ['-e', `
    const p = require(${JSON.stringify(PRELOAD_PATH)});
    const rll = require(${JSON.stringify(RLL_PATH)});
    for (const name of ['TEMP', 'TMP', 'TMPDIR']) {
      if (process.env[name] !== p.privateRoot) {
            process.stderr.write(name + ' did not adopt the private root\\n');
        process.exit(1);
      }
    }
    const base = rll.registryBaseDir();
    if (!base.startsWith(p.expectedRegistryBaseDirParent)) {
      process.stderr.write('NOT CONTAINED: ' + base + ' vs ' + p.expectedRegistryBaseDirParent + '\\n');
      process.exit(1);
    }
    process.exit(0);
  `], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'containment must hold: ' + JSON.stringify(r));
});

test('private-registry-tmpdir-preload: descendant Node processes inherit the same process-local registry capability', () => {
  const r = spawnSync('node', ['-e', `
    const { spawnSync } = require('node:child_process');
    const p = require(${JSON.stringify(PRELOAD_PATH)});
    const child = spawnSync(process.execPath, ['-e', ${JSON.stringify(`
      const os = require('node:os');
      const rll = require(${JSON.stringify(RLL_PATH)});
      const capabilityRoot = globalThis[Symbol.for('android-common-doc.runtime-private-registry-base')];
      process.stdout.write(JSON.stringify({ tmp: os.tmpdir(), capabilityRoot, registry: rll.registryBaseDir() }));
    `)}], { encoding: 'utf8', env: process.env });
    if (child.status !== 0) {
      process.stderr.write('descendant failed: ' + JSON.stringify(child));
      process.exit(1);
    }
    const observed = JSON.parse(child.stdout);
    if (observed.tmp !== p.privateRoot
        || observed.capabilityRoot !== p.expectedRegistryBaseDirParent
        || !observed.registry.startsWith(p.expectedRegistryBaseDirParent)) {
      process.stderr.write('descendant escaped: ' + JSON.stringify({ expected: p, observed }));
      process.exit(1);
    }
  `], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'descendant containment must hold: ' + JSON.stringify(r));
});

test('private-registry-tmpdir-preload: cleans up its private root on normal process exit', () => {
  const r = spawnSync('node', ['-e', `
    const fs = require('fs');
    const p = require(${JSON.stringify(PRELOAD_PATH)});
    fs.writeFileSync(require('path').join(p.privateRoot, 'marker.txt'), 'x');
    process.stdout.write(p.privateRoot);
  `], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  const privateRoot = r.stdout.trim();
  assert.ok(privateRoot.length > 0);
  assert.strictEqual(fs.existsSync(privateRoot), false, 'private root must not survive process exit: ' + privateRoot);
});

test('private-registry-tmpdir-preload: platform-aware mode guard remains fail-closed (hash-bound mutation proof)', () => {
  const original = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const originalHash = crypto.createHash('sha256').update(original).digest('hex');
  const target = "if (process.platform !== 'win32' && (rootStat.mode & 0o777) !== 0o700) {";
  // Enter this exact fatal branch unconditionally on every platform. A
  // comparison against the observed Windows mode is not deterministic: NTFS
  // can surface 0700 here, which would let the mutation test pass without
  // proving that this guard itself fails closed.
  const replacement = 'if (true) {';
  const mutated = original.replace(target, replacement);
  // If the exact source text this mutation targets has drifted, fail loudly
  // here rather than silently exercising a no-op mutation that would make
  // the assertions below pass for the wrong reason (this file's own
  // "instrument right, inference wrong" guard).
  assert.notStrictEqual(mutated, original, 'mutation target string not found in the real preload source -- this test is stale against scripts/tests/lib/private-registry-tmpdir-preload.cjs and must be updated to match it');

  const tmpCopy = path.join(os.tmpdir(), 'preload-mutation-test-' + crypto.randomBytes(8).toString('hex') + '.cjs');
  fs.writeFileSync(tmpCopy, mutated);
  try {
    const r = spawnSync('node', ['-e', `require(${JSON.stringify(tmpCopy)});`], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1, 'a mutated (broken) mode-check guard must exit 1, never silently succeed: ' + JSON.stringify(r));
    assert.match(r.stderr, /FATAL: private root has the wrong mode/, 'must fail via the mode-check guard specifically, not some other unrelated error: ' + r.stderr);
  } finally {
    fs.rmSync(tmpCopy, { force: true });
  }

  // Hash-bound proof: the REAL source file on disk was never touched by this
  // test -- the mutation only ever existed in the temp copy above.
  const afterHash = crypto.createHash('sha256').update(fs.readFileSync(PRELOAD_PATH, 'utf8')).digest('hex');
  assert.strictEqual(afterHash, originalHash, 'the real preload source must be byte-identical before and after this test');
});

test('private-registry-tmpdir-preload: fail-closed guard genuinely catches os.tmpdir() not adopting the override (hash-bound mutation proof)', () => {
  const original = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const originalHash = crypto.createHash('sha256').update(original).digest('hex');
  const target = "if (os.tmpdir() !== privateRoot) {";
  // Forces the check to see a mismatch unconditionally, simulating "the
  // override did not take" without needing to actually break the real
  // os.tmpdir()/TMPDIR platform behavior (not something a unit test can
  // safely fake) -- this proves the GUARD's OWN reaction to that condition
  // (fatal + exit 1), which is the part this codebase's own code controls
  // and is responsible for getting right.
  const mutated = original.replace(target, 'if (true) {');
  assert.notStrictEqual(mutated, original, 'mutation target string not found in the real preload source -- this test is stale against scripts/tests/lib/private-registry-tmpdir-preload.cjs and must be updated to match it');

  const tmpCopy = path.join(os.tmpdir(), 'preload-mutation-test-' + crypto.randomBytes(8).toString('hex') + '.cjs');
  fs.writeFileSync(tmpCopy, mutated);
  try {
    const r = spawnSync('node', ['-e', `require(${JSON.stringify(tmpCopy)});`], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1, 'a forced os.tmpdir()-mismatch must exit 1, never silently succeed: ' + JSON.stringify(r));
    assert.match(r.stderr, /FATAL: os\.tmpdir\(\) did not adopt/, 'must fail via the os.tmpdir() guard specifically, not some other unrelated error: ' + r.stderr);
  } finally {
    fs.rmSync(tmpCopy, { force: true });
  }

  const afterHash = crypto.createHash('sha256').update(fs.readFileSync(PRELOAD_PATH, 'utf8')).digest('hex');
  assert.strictEqual(afterHash, originalHash, 'the real preload source must be byte-identical before and after this test');
});
