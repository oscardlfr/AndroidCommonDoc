#!/usr/bin/env node
'use strict';

// RLDI: root-lifecycle.cjs's validateRootConfinement -- auditing it for the
// SAME "missing ctimeNs" shape found and fixed in app-server-pin.cjs and
// registry-record-io.cjs on PR #247/its follow-up (task_18425353), and
// recording why the conclusion here is DIFFERENT.
//
// validateRootConfinement's post-confinement re-check compares
// dev/ino/mode/uid/gid. It does NOT compare nlink, mtimeNs or ctimeNs, and
// unlike the other two sites, that is correct, not an oversight -- because
// this is a DIRECTORY identity check, not a file re-read.
//
// Probed empirically before writing anything: creating a plain file OR a
// subdirectory inside a directory changes that directory's own ctime AND
// mtime; a subdirectory additionally bumps nlink. dev/ino/mode/uid/gid --
// the exact fields this function already compares -- are untouched by
// either. coordRoot is a *coordination* root the file's own docstring says
// is reused across cooperating processes ("the WP3 bridge's own rendezvous
// root"), so legitimate sibling creation during the confinement window is
// plausible, not theoretical. Adding ctimeNs here would not close a gap --
// it would introduce the exact false-positive class already found once in
// this codebase for nlink (see feedback_stat_seal_exclude_nlink_directories
// in project memory), except triggered by ANY child entry, not only
// subdirectories.
//
// This file therefore does not change validateRootConfinement's comparison.
// It (a) pins the empirical facts above as an executable, permanently-
// checked assertion, so a future dev re-deriving "just add ctimeNs" fails
// loudly against real filesystem behavior instead of shipping a new
// false-positive; and (b) confirms the fields it DOES compare still catch a
// genuine identity swap.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CliError } = require(path.resolve(__dirname, '../lib/runtime-consultation/primitives.cjs'));
const { createRootLifecycle } = require(
  path.resolve(__dirname, '../lib/runtime-consultation/root-lifecycle/root-lifecycle.cjs'),
);

const created = [];
test.after(() => {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function mkroot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rldi-root-')));
  created.push(dir);
  fs.chmodSync(dir, 0o700);
  return dir;
}

function unreachable(label) {
  return () => { throw new Error(label + ': must not be called on this platform/path'); };
}

// assertRootConfinedToWorktree is the ONE seam this suite controls: it is
// where the real production call sits (a `git` subprocess, per the widened-
// TOCTOU-window comment on validateRootConfinement), so injecting a side
// effect here simulates "something happened during that real window" without
// needing a genuine, non-deterministic race.
function lifecycleWith(assertRootConfinedToWorktree) {
  return createRootLifecycle({
    CliError,
    assertRootConfinedToWorktree,
    assertWindowsPrivateDirectoryAcl: unreachable('assertWindowsPrivateDirectoryAcl'),
    assertWindowsRootAclProbeAvailable: unreachable('assertWindowsRootAclProbeAvailable'),
    fs,
    requireFlags: unreachable('requireFlags'),
    resolveAbsolute: unreachable('resolveAbsolute'),
    resolveEffectivePlatform: () => process.platform,
    windowsAclSnapshotsEqual: unreachable('windowsAclSnapshotsEqual'),
    windowsPrivateDirectoryAcl: unreachable('windowsPrivateDirectoryAcl'),
  });
}

test('RLDI-01 empirical: ordinary sibling creation inside a directory moves ctime/mtime/nlink but not dev/ino/mode/uid/gid', () => {
  const root = mkroot();
  const before = fs.lstatSync(root, { bigint: true });

  fs.writeFileSync(path.join(root, 'sibling-file.txt'), 'x');
  const afterFile = fs.lstatSync(root, { bigint: true });
  assert.notEqual(afterFile.ctimeNs, before.ctimeNs, 'creating a file inside the root must move its ctime -- if this now fails, the exclusion below needs re-deriving, not deleting');
  assert.notEqual(afterFile.mtimeNs, before.mtimeNs, 'creating a file inside the root must move its mtime');
  assert.equal(afterFile.dev, before.dev);
  assert.equal(afterFile.ino, before.ino);
  assert.equal(afterFile.mode, before.mode);
  assert.equal(afterFile.uid, before.uid);
  assert.equal(afterFile.gid, before.gid);

  fs.mkdirSync(path.join(root, 'sibling-dir'));
  const afterDir = fs.lstatSync(root, { bigint: true });
  assert.notEqual(afterDir.nlink, afterFile.nlink, 'creating a SUBDIRECTORY inside the root must bump its nlink (the same class of false positive already fixed once for directory identity seals)');
  assert.equal(afterDir.dev, before.dev);
  assert.equal(afterDir.ino, before.ino);
  assert.equal(afterDir.mode, before.mode);
  assert.equal(afterDir.uid, before.uid);
  assert.equal(afterDir.gid, before.gid);
});

test('RLDI-02 validateRootConfinement tolerates ordinary sibling creation during the confinement window', () => {
  const root = mkroot();
  // Simulates legitimate activity from another cooperating process landing
  // inside coordRoot during the real (git-subprocess-widened) window --
  // exactly the scenario RLDI-01 proves moves ctime/mtime/nlink.
  const confineWithSiblingChurn = (existingCoordRoot) => {
    fs.writeFileSync(path.join(existingCoordRoot, 'concurrent-writer.tmp'), 'x');
    fs.mkdirSync(path.join(existingCoordRoot, 'concurrent-subdir'));
    return true;
  };
  const lifecycle = lifecycleWith(confineWithSiblingChurn);
  const result = lifecycle.validateRootConfinement(root);
  assert.equal(result, root, 'ordinary concurrent activity inside the root must not be treated as tamper');
});

test('RLDI-03 validateRootConfinement still refuses a genuine identity swap (dev/ino/mode/uid/gid do their job)', () => {
  const root = mkroot();
  // A real ABA-adjacent swap: something else occupies the exact same path
  // with a different inode by the time the re-check runs -- the identity
  // fields this function DOES compare must still catch this.
  //
  // Deliberately NOT rmdirSync+mkdirSync at the same path: on Linux, an
  // immediately-freed inode number is commonly reused for the very next
  // allocation in the same directory (observed on real Linux CI, ext4-backed
  // /tmp), so the "swap" could silently keep the same ino and the test
  // wouldn't be exercising a swap at all -- a filesystem-dependent flake, not
  // a production defect. Creating the replacement at a SIBLING path first
  // guarantees a genuinely distinct inode allocation (no reuse question,
  // since it's not the just-freed slot), then renaming it into place leaves
  // something at the exact same path with a different identity, portably.
  const swapRoot = (existingCoordRoot) => {
    const replacement = fs.mkdtempSync(existingCoordRoot + '-swap-');
    fs.chmodSync(replacement, 0o700);
    fs.rmdirSync(existingCoordRoot);
    fs.renameSync(replacement, existingCoordRoot);
    return true;
  };
  const lifecycle = lifecycleWith(swapRoot);
  assert.throws(
    () => lifecycle.validateRootConfinement(root),
    (err) => err instanceof CliError && err.detailCode === 'SECURITY_INVALID' && /identity changed during validation/.test(err.message),
    'a genuine root swap during the confinement window must still be refused',
  );
});
