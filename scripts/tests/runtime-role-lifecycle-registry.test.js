#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- see that file's own
// doc comment for why (registryBaseDir() is os.tmpdir()-rooted and shared
// with real production registry data on this machine without this).
require('./lib/private-registry-tmpdir-preload.cjs');

// WP3 unit-level coverage for runtime-role-lifecycle.cjs's host-private registry
// foundation (identity, plan discovery, secure dir/record I/O, SessionGeneration-
// Provider, MainOrchestratorBinding, lifecycle-command-grant/v1). This file tests
// the INTERNAL JS APIs directly (node:test, node:assert) -- the sibling
// runtime-role-lifecycle.bats drives the CLI envelope surface; this file drives
// the registry internals those handlers are built on, the same split as
// runtime-consultation-cli.test.js vs runtime-consultation-cli.bats/protocol.bats.
//
// House style matches runtime-consultation-cli.test.js: CommonJS require,
// node:assert, `node --test`, one fixture temp dir per test (mkdtemp+git init),
// always cleaned up in a finally block.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-registry-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL Registry Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function writePlanFixture(projectRoot, waveSlug) {
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  const planPath = path.join(waveDir, 'PLAN.md');
  fs.writeFileSync(planPath, '# fixture plan for runtime-role-lifecycle-registry.test.js\n');
  return planPath;
}

// ── Identity ─────────────────────────────────────────────────────────────────

test('computeRepoId/computeWorktreeId: deterministic 64-hex digests, stable across calls', () => {
  const dir = makeGitProject();
  try {
    const repoId1 = rll.computeRepoId(dir);
    const repoId2 = rll.computeRepoId(dir);
    assert.strictEqual(repoId1, repoId2, 'repo_id must be stable across calls');
    assert.match(repoId1, /^[0-9a-f]{64}$/, 'repo_id must be a 64-hex sha256');
    const worktreeId = rll.computeWorktreeId(dir);
    assert.match(worktreeId, /^[0-9a-f]{64}$/, 'worktree_id must be a 64-hex sha256');
    assert.notStrictEqual(repoId1, worktreeId, 'repo_id and worktree_id must be independently derived');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('computeRepoId: two DIFFERENT git repos get different repo_ids', () => {
  const dirA = makeGitProject();
  const dirB = makeGitProject();
  try {
    assert.notStrictEqual(rll.computeRepoId(dirA), rll.computeRepoId(dirB));
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

// Point 2.1 (R4): coordination_root_id must be IDENTICAL before and after
// root-init, even when the project root is reached through a symlinked
// path component -- explicitly reproduced under `/tmp` (a REAL symlink to
// `/private/tmp` on macOS, the exact scenario named in this correction),
// never `os.tmpdir()` (which macOS resolves to `/var/folders/...`,
// side-stepping the symlink this test exists to exercise).
test('computeCoordinationRootId: stable IDENTICALLY before and after the coordination-root directory exists, even under a symlinked path component (/tmp on macOS) (point 2.1)', () => {
  const dir = fs.mkdtempSync(path.join('/tmp', 'rll-coordid-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-coordid-test@test.local']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL CoordId Test']);
    execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);

    // Pre-root-init: the coordination-root directory does not exist yet.
    assert.strictEqual(fs.existsSync(path.join(dir, '.planning', 'coordination')), false);
    const idBefore = rll.computeCoordinationRootId(dir);
    assert.match(idBefore, /^[0-9a-f]{64}$/);

    // Simulate root-init: create the confinement-valid (real dir, 0700,
    // not a symlink) coordination root.
    fs.mkdirSync(path.join(dir, '.planning', 'coordination'), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(dir, '.planning', 'coordination'), 0o700);

    const idAfter = rll.computeCoordinationRootId(dir);
    assert.strictEqual(idAfter, idBefore, 'coordination_root_id must be IDENTICAL before and after root-init, even under a symlinked /tmp');

    // Sanity: this dir is genuinely reached through a symlink on this
    // platform (skip the symlink-specific assertion, never the whole
    // test, on a host where /tmp happens not to be one).
    let realTmp;
    try { realTmp = fs.realpathSync('/tmp'); } catch (err) { realTmp = '/tmp'; }
    if (realTmp !== '/tmp') {
      assert.notStrictEqual(dir, fs.realpathSync(dir), 'fixture sanity: this run genuinely exercises a symlinked path component');
    }
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('computeCoordinationRootId: stable IDENTICALLY before and after root-init even when `.planning` itself is a VALID INTERNAL symlink (not merely an external alias of the whole projectRoot prefix) (R4 round 2, point 2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-coordid-internal-symlink-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-coordid-internal-test@test.local']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL CoordId Internal Test']);
    execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);

    // .planning itself (a project-owned ANCESTOR of the coordination root,
    // never checked/rejected by validateRootConfinement -- that check only
    // ever inspects the coordination-root LEAF) is a symlink to a DIFFERENT
    // real sibling directory inside the SAME worktree.
    const realPlanningTarget = path.join(dir, 'actual-planning-data');
    fs.mkdirSync(realPlanningTarget, { recursive: true });
    fs.symlinkSync(realPlanningTarget, path.join(dir, '.planning'));

    // Pre-root-init: the coordination-root directory does not exist yet,
    // but .planning (the symlink) already does.
    assert.strictEqual(fs.existsSync(path.join(dir, '.planning', 'coordination')), false);
    const idBefore = rll.computeCoordinationRootId(dir);
    assert.match(idBefore, /^[0-9a-f]{64}$/);

    // Simulate root-init: create the confinement-valid (real dir, 0700, not
    // itself a symlink) coordination root THROUGH the .planning symlink --
    // exactly what real root-init does, since it just mkdirs whatever
    // coordinationRootPathFor returns.
    fs.mkdirSync(path.join(dir, '.planning', 'coordination'), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(dir, '.planning', 'coordination'), 0o700);

    const idAfter = rll.computeCoordinationRootId(dir);
    assert.strictEqual(idAfter, idBefore, 'coordination_root_id must be IDENTICAL before and after root-init, even when .planning itself is an internal symlink');

    // Fixture sanity: this genuinely exercises a symlinked ANCESTOR
    // component, not just the leaf.
    assert.notStrictEqual(
      path.join(dir, '.planning', 'coordination'),
      fs.realpathSync(path.join(dir, '.planning', 'coordination')),
      'fixture sanity: .planning must genuinely resolve to a DIFFERENT real path',
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Plan discovery ───────────────────────────────────────────────────────────

test('discoverPlan: exactly one .planning/wave-*/PLAN.md resolves; digest matches raw file bytes', () => {
  const dir = makeGitProject();
  try {
    const planPath = writePlanFixture(dir, 'discovery-test');
    const result = rll.discoverPlan(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.planPath, planPath);
    const crypto = require('node:crypto');
    const expectedDigest = crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');
    assert.strictEqual(result.planDigest, expectedDigest, 'plan_digest must be the raw-byte sha256, byte-identical to the sibling module\'s own definition');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverPlan: zero PLAN.md under .planning/wave-* is ambiguous (ok:false), never silently proceeds', () => {
  const dir = makeGitProject();
  try {
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    const result = rll.discoverPlan(dir);
    assert.strictEqual(result.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverPlan: TWO PLAN.md under .planning/wave-* is ambiguous (ok:false), never silently picks one', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'first');
    writePlanFixture(dir, 'second');
    const result = rll.discoverPlan(dir);
    assert.strictEqual(result.ok, false, 'multiple candidate PLAN.md files must never be silently resolved to one');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Secure registry directory ───────────────────────────────────────────────

test('ensureSecureRegistryDir: creates a fresh directory at exactly mode 0700', () => {
  const dir = makeGitProject();
  try {
    const target = path.join(rll.registryRepoDir(dir), 'fresh-dir');
    const result = rll.ensureSecureRegistryDir(target);
    assert.strictEqual(result.ok, true);
    const st = fs.lstatSync(target);
    assert.ok(st.isDirectory());
    assert.strictEqual(st.mode & 0o777, 0o700);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureSecureRegistryDir: rejects a pre-existing symlink at the leaf BEFORE any mkdir/chmod, zero mutation of the real target', () => {
  const dir = makeGitProject();
  try {
    const realTarget = path.join(rll.registryRepoDir(dir), 'real-target-outside-scope');
    fs.mkdirSync(realTarget, { recursive: true });
    fs.chmodSync(realTarget, 0o755);
    const linkPath = path.join(rll.registryRepoDir(dir), 'symlinked-leaf');
    fs.symlinkSync(realTarget, linkPath);
    const result = rll.ensureSecureRegistryDir(linkPath);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'symlink');
    const stAfter = fs.lstatSync(realTarget);
    assert.strictEqual(stAfter.mode & 0o777, 0o755, 'the real target directory must be completely untouched');
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), 'the symlink itself must remain, unresolved');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Registry record write/read ──────────────────────────────────────────────

test('writeRegistryRecordReplace + readRegistryRecord: round-trips exact bytes at mode 0600', () => {
  const dir = makeGitProject();
  try {
    const recPath = path.join(rll.registryRepoDir(dir), 'rt', 'record.json');
    const payload = { schema: 'test/v1', value: 42 };
    const writeResult = rll.writeRegistryRecordReplace(recPath, Buffer.from(JSON.stringify(payload), 'utf8'));
    assert.strictEqual(writeResult.ok, true);
    assert.strictEqual(fs.lstatSync(recPath).mode & 0o777, 0o600);
    const readResult = rll.readRegistryRecord(recPath);
    assert.strictEqual(readResult.ok, true);
    assert.deepStrictEqual(readResult.obj, payload);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRegistryRecordReplace: a SECOND write to the same path legitimately REPLACES (mutable, unlike a no-clobber grant)', () => {
  const dir = makeGitProject();
  try {
    const recPath = path.join(rll.registryRepoDir(dir), 'rt', 'mutable.json');
    rll.writeRegistryRecordReplace(recPath, Buffer.from('{"v":1}', 'utf8'));
    const secondWrite = rll.writeRegistryRecordReplace(recPath, Buffer.from('{"v":2}', 'utf8'));
    assert.strictEqual(secondWrite.ok, true, 'replace-write must succeed even though the target already exists');
    const readResult = rll.readRegistryRecord(recPath);
    assert.deepStrictEqual(readResult.obj, { v: 2 });
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRegistryRecord: a genuinely absent record reports {ok:true, absent:true}, never throws', () => {
  const dir = makeGitProject();
  try {
    const recPath = path.join(rll.registryRepoDir(dir), 'rt', 'never-written.json');
    const readResult = rll.readRegistryRecord(recPath);
    assert.strictEqual(readResult.ok, true);
    assert.strictEqual(readResult.absent, true);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── getRuntimeIdentity (RuntimeIdentityProvider seam) ───────────────────────

test('getRuntimeIdentity: production (no test capability) NEVER fabricates an identity -- always {ok:false} until WP4 wires a real hook', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFake = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY;
  try {
    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY = JSON.stringify({ ok: true, provider: 'claude-hook', runtime_session_key: 'x'.repeat(20) });
    const result = rll.getRuntimeIdentity();
    assert.strictEqual(result.ok, false, 'even with a fake-identity env var set, production (no test capability) must ignore it');
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFake === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY = savedFake;
  }
});

test('getRuntimeIdentity: test capability + well-formed fake identity is honored', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFake = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY = JSON.stringify({ ok: true, provider: 'codex-supervisor', runtime_session_key: 'sup-123' });
    const result = rll.getRuntimeIdentity();
    assert.deepStrictEqual(result, { ok: true, provider: 'codex-supervisor', runtime_session_key: 'sup-123' });
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFake === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY = savedFake;
  }
});

test('getRuntimeIdentity: an invalid provider enum value in the fake identity is rejected', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFake = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY = JSON.stringify({ ok: true, provider: 'totally-invalid-provider', runtime_session_key: 'x' });
    const result = rll.getRuntimeIdentity();
    assert.strictEqual(result.ok, false);
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFake === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY = savedFake;
  }
});

// ── SessionGenerationProvider ────────────────────────────────────────────────

test('resolveSessionGeneration: the SAME (provider, runtime_session_key) tuple always returns the SAME generation_id', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'stable-session-key-1' };
    const first = rll.resolveSessionGeneration(dir, identity);
    const second = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, true);
    assert.strictEqual(first.generationId, second.generationId);
    assert.match(first.generationId, /^[0-9a-f]{32}$/, 'generation_id must be a 128-bit (32-hex) CSPRNG value');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSessionGeneration: a DIFFERENT runtime_session_key gets a DIFFERENT generation_id', () => {
  const dir = makeGitProject();
  try {
    const identityA = { ok: true, provider: 'claude-hook', runtime_session_key: 'session-key-A' };
    const identityB = { ok: true, provider: 'claude-hook', runtime_session_key: 'session-key-B' };
    const genA = rll.resolveSessionGeneration(dir, identityA);
    const genB = rll.resolveSessionGeneration(dir, identityB);
    assert.notStrictEqual(genA.generationId, genB.generationId);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSessionGeneration: a different PROVIDER with the same key string still gets a different generation (provider is part of the tuple)', () => {
  const dir = makeGitProject();
  try {
    const claudeIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: 'same-key-value' };
    const codexIdentity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'same-key-value' };
    const genClaude = rll.resolveSessionGeneration(dir, claudeIdentity);
    const genCodex = rll.resolveSessionGeneration(dir, codexIdentity);
    assert.notStrictEqual(genClaude.generationId, genCodex.generationId);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSessionGeneration: the raw runtime_session_key never appears in the returned result object', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'MUST-NEVER-LEAK-THIS-VALUE' };
    const result = rll.resolveSessionGeneration(dir, identity);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('MUST-NEVER-LEAK-THIS-VALUE'), 'the raw session key must not be echoed in the provider result');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSessionGeneration: an EXPIRED session record is treated as absent and a fresh generation_id is minted', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'expiring-session' };
    const first = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(first.ok, true);
    // Directly age the on-disk record past its TTL (host-private registry, safe to mutate for this test).
    const recPath = rll.sessionGenerationPathFor(dir, identity);
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(recPath, 0o600);
    fs.writeFileSync(recPath, JSON.stringify(rec), { mode: 0o600 });
    const second = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(second.ok, true);
    assert.notStrictEqual(second.generationId, first.generationId, 'an expired session tuple must mint a fresh generation_id, never reuse the stale one');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// WP3 item C correction pass R3 (point A.4): peekSessionGeneration is a PURE
// lookup -- a validation must never create/rotate state as a side effect.
test('peekSessionGeneration: an ABSENT tuple is reported ok:false -- never mints, unlike resolveSessionGeneration', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'never-resolved-session' };
    const before = rll.peekSessionGeneration(dir, identity);
    assert.strictEqual(before.ok, false);
    assert.strictEqual(before.reason, 'session-generation-absent');
    // Proves the peek genuinely created nothing: the record still does not exist.
    assert.strictEqual(fs.existsSync(rll.sessionGenerationPathFor(dir, identity)), false, 'peekSessionGeneration must never create the record it just reported absent');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('peekSessionGeneration: an EXISTING live tuple returns the SAME generationId as resolveSessionGeneration, with zero additional writes', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'peek-live-session' };
    const minted = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(minted.ok, true);
    const recPath = rll.sessionGenerationPathFor(dir, identity);
    const beforeBytes = fs.readFileSync(recPath, 'utf8');
    const peeked = rll.peekSessionGeneration(dir, identity);
    assert.strictEqual(peeked.ok, true);
    assert.strictEqual(peeked.generationId, minted.generationId);
    const afterBytes = fs.readFileSync(recPath, 'utf8');
    assert.strictEqual(afterBytes, beforeBytes, 'peekSessionGeneration must never mutate the record it read');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('peekSessionGeneration: an EXPIRED tuple is reported ok:false (never silently minting a fresh replacement, unlike resolveSessionGeneration)', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'peek-expiring-session' };
    const minted = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(minted.ok, true);
    const recPath = rll.sessionGenerationPathFor(dir, identity);
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    // M6-M7-ROOT-SOURCE-CONTINUATION-CLOSURE-20260820 (RED C fixture
    // correction): an EXPIRED tuple must also be CHRONOLOGICALLY COHERENT
    // (created_at strictly before expires_at) -- production's chronology
    // validation correctly rejects a record created in the present but
    // expiring in 2000 as session-generation-shape-invalid, which is not the
    // expiry classification this test is about. Age BOTH fields into the
    // past so the only defect the record carries is being expired.
    rec.created_at = '1999-12-31T23:59:00Z';
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(recPath, 0o600);
    fs.writeFileSync(recPath, JSON.stringify(rec), { mode: 0o600 });
    const beforeBytes = fs.readFileSync(recPath, 'utf8');
    const beforeStat = fs.statSync(recPath);
    const peeked = rll.peekSessionGeneration(dir, identity);
    assert.strictEqual(peeked.ok, false);
    assert.strictEqual(peeked.reason, 'session-generation-expired');
    // The stale record on disk is untouched -- a peek never rewrites/rotates it:
    // identical bytes, identical inode/size/mode, and the exact aged fields.
    const afterBytes = fs.readFileSync(recPath, 'utf8');
    const afterStat = fs.statSync(recPath);
    assert.strictEqual(afterBytes, beforeBytes, 'read-only validation must leave the record bytes untouched');
    assert.strictEqual(afterStat.ino, beforeStat.ino, 'read-only validation must not replace the record file');
    assert.strictEqual(afterStat.size, beforeStat.size);
    assert.strictEqual(afterStat.mode & 0o777, beforeStat.mode & 0o777);
    assert.strictEqual(JSON.parse(afterBytes).created_at, '1999-12-31T23:59:00Z');
    assert.strictEqual(JSON.parse(afterBytes).expires_at, '2000-01-01T00:00:00Z');
    assert.strictEqual(JSON.parse(afterBytes).generation_id, rec.generation_id, 'the stale generation_id must not be rotated by a peek');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('peekSessionGeneration: a non-canonical ISO timestamp (milliseconds, or a non-Z offset) on the stored record is rejected -- "ISO UTC canonico", not merely Date.parse-able', () => {
  const dir = makeGitProject();
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'peek-noncanonical-session' };
    const minted = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(minted.ok, true);
    const recPath = rll.sessionGenerationPathFor(dir, identity);
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    // A far-future instant that Date.parse happily accepts in BOTH forms,
    // but only one is the canonical shape this registry writes.
    rec.expires_at = '2099-01-01T00:00:00.000+00:00';
    fs.chmodSync(recPath, 0o600);
    fs.writeFileSync(recPath, JSON.stringify(rec), { mode: 0o600 });
    const peeked = rll.peekSessionGeneration(dir, identity);
    assert.strictEqual(peeked.ok, false);
    assert.strictEqual(peeked.reason, 'session-generation-shape-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isCanonicalIsoUtc: accepts exactly YYYY-MM-DDTHH:MM:SSZ, rejects milliseconds/offsets/garbage', () => {
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-07-17T12:00:00Z'), true);
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-07-17T12:00:00.000Z'), false);
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-07-17T12:00:00+00:00'), false);
  assert.strictEqual(rll.isCanonicalIsoUtc('not-a-date'), false);
  assert.strictEqual(rll.isCanonicalIsoUtc(null), false);
  assert.strictEqual(rll.isCanonicalIsoUtc(undefined), false);
});

// R4 round 3 (block 2c): a regex-shape match plus Date.parse alone is not
// sufficient -- Date.parse/new Date(...) SILENTLY NORMALIZE an impossible
// calendar date into a real one and still return a finite timestamp (e.g.
// 2026-02-30 normalizes to 2026-03-02). A genuine round-trip -- format the
// parsed instant back into the SAME canonical form and compare
// byte-for-byte -- is required to catch this; the regex+Date.parse-only
// predecessor wrongly accepted every case below.
test('isCanonicalIsoUtc: a calendrically IMPOSSIBLE date that Date.parse silently normalizes into a real one is rejected via a genuine round-trip check, never merely regex-shape + Date.parse (R4 round 3, block 2c)', () => {
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-02-30T00:00:00Z'), false, 'February never has a 30th -- Date.parse normalizes this to March 2');
  assert.strictEqual(rll.isCanonicalIsoUtc('2023-02-29T00:00:00Z'), false, '2023 is not a leap year -- no February 29th');
  assert.strictEqual(rll.isCanonicalIsoUtc('2024-02-29T00:00:00Z'), true, '2024 IS a leap year -- February 29th is a genuine date');
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-13-01T00:00:00Z'), false, 'month 13 does not exist');
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-01-32T00:00:00Z'), false, 'January never has a 32nd');
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-01-01T24:00:00Z'), false, 'hour 24 is not a valid clock hour');
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-01-01T00:60:00Z'), false, 'minute 60 is not a valid clock minute');
  assert.strictEqual(rll.isCanonicalIsoUtc('2026-01-01T00:00:60Z'), false, 'second 60 is not a valid clock second (no leap-second representation here)');
});

// R4 round 3 (block 2d): a SEPARATE, exact-64 contract for genuine SHA-256
// digest fields (worktree_id, plan_digest, coordination_root_id), distinct
// from `isHexActionId`'s intentionally-unchanged "32 or more" contract
// (which the frozen `--action <32+-hex>` argv grammar, PLAN.md ~L143-145,
// requires and which this fix never touches). A 32-hex value -- exactly
// what a generated id looks like -- must never satisfy the digest
// contract, and vice versa a 64-hex value must never satisfy `isHexActionId`
// as if it were somehow MORE valid merely for being longer than 32.
test('isHexDigest64: accepts exactly 64 lowercase hex characters, rejects 32-hex (a generated-id-shaped value), 63/65-hex, uppercase, and garbage -- a genuinely SEPARATE contract from isHexActionId (R4 round 3, block 2d)', () => {
  const sixtyFourHex = 'a'.repeat(64);
  const thirtyTwoHex = 'a'.repeat(32);
  assert.strictEqual(rll.isHexDigest64(sixtyFourHex), true);
  assert.strictEqual(rll.isHexDigest64(thirtyTwoHex), false, 'a 32-hex generated-id-shaped value must never satisfy the digest contract');
  assert.strictEqual(rll.isHexDigest64('a'.repeat(63)), false, 'one short of 64');
  assert.strictEqual(rll.isHexDigest64('a'.repeat(65)), false, 'one over 64 -- exact, not "64 or more"');
  assert.strictEqual(rll.isHexDigest64('A'.repeat(64)), false, 'uppercase is rejected');
  assert.strictEqual(rll.isHexDigest64('g'.repeat(64)), false, 'g is not a hex digit');
  assert.strictEqual(rll.isHexDigest64(null), false);
  assert.strictEqual(rll.isHexDigest64(undefined), false);
  // isHexActionId's OWN "32 or more" contract is intentionally UNCHANGED --
  // it still accepts a well-formed 64-hex digest too (a strict superset),
  // since narrowing it would violate the frozen --action argv grammar.
  assert.strictEqual(rll.isHexActionId(thirtyTwoHex), true, 'isHexActionId is unaffected by this fix -- still 32-or-more');
  assert.strictEqual(rll.isHexActionId(sixtyFourHex), true, 'isHexActionId still accepts 64-hex too (superset), unlike isHexDigest64');
});

// R4 round 3 (block 2d): end-to-end proof that a wrong-length value in a
// DIGEST field (worktree_id) is now rejected at grant-consumption time --
// previously, isHexActionId's "32 or more" contract would have wrongly
// accepted a 40-hex garbage worktree_id (well-formed hex, wrong length for
// a genuine sha256 digest) as if it were a real one.
test('validateAndConsumeLifecycleCommandGrant: a grant whose worktree_id is well-formed hex but the WRONG length for a genuine sha256 digest (40-hex, not 64) is rejected as grant-scope-id-shape-invalid (R4 round 3, block 2d)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'd-digest-length', 'arch-testing', 'ensure', null);
    assert.strictEqual(grant.ok, true);
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    assert.strictEqual(rec.worktree_id.length, 64, 'fixture sanity: the genuine worktree_id is 64-hex');
    rec.worktree_id = 'f'.repeat(40); // well-formed hex, WRONG length for a digest
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });

    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-digest-length', 'arch-testing', 'ensure', null);
    assert.strictEqual(result.ok, false, 'a 40-hex worktree_id must never pass as a genuine 64-hex digest: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'grant-scope-id-shape-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// WP3 item C correction pass R3 (point A.5): a binding with less than one
// second of remaining lifetime can never produce an action that outlives it.
test('computeActionTtlSeconds: a binding with <1s remaining fails closed -- never floors to a fabricated 1s TTL', () => {
  const nowIso = new Date(Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const policy = { ready_timeout_seconds: 120 };
  const almostExpired = new Date(Date.now() + 400).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r1 = rll.computeActionTtlSeconds(policy, almostExpired);
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.reason, 'binding-remaining-lifetime-insufficient');

  const alreadyExpired = new Date(Date.now() - 5000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r2 = rll.computeActionTtlSeconds(policy, alreadyExpired);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'binding-remaining-lifetime-insufficient');

  // Sanity: comfortably >1s still succeeds (the fix is a floor, not a ceiling regression).
  const comfortable = new Date(Date.now() + 10000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r3 = rll.computeActionTtlSeconds(policy, comfortable);
  assert.strictEqual(r3.ok, true);
  assert.ok(r3.ttlSeconds >= 1 && r3.ttlSeconds <= 10, r3.ttlSeconds);
  void nowIso;
});

test('ensure: a binding with <1s remaining lifetime is rejected end-to-end, never mints a surviving action (point A.5 adversarial)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'ttl-floor-adv');
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'ttl-floor-session' };
    // A binding minted with a deliberately tiny TTL -- by the time ensure
    // reaches the mint step (grant consumption, capability lookup, etc.
    // all take real wall-clock time), less than 1s remains.
    const bindingResult = rll.createMainOrchestratorBinding(dir, identity, worktreeId, planDigest, 1);
    assert.strictEqual(bindingResult.ok, true);
    const nodeCrypto = require('node:crypto');
    const argvDigest = nodeCrypto.createHash('sha256').update(Buffer.from('ensure:verifier', 'utf8')).digest('hex');
    const grant = rll.mintLifecycleCommandGrant(dir, bindingResult.binding, argvDigest, 'verifier', 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
    assert.strictEqual(grant.ok, true);
    let out;
    try {
      out = execFileSync('node', [IMPL, 'ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', grant.grantId], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']) }),
      });
    } catch (err) {
      out = err.stdout; // non-zero exit is the EXPECTED outcome here -- execFileSync throws, the CLI's own JSON envelope is still on stdout.
    }
    const result = JSON.parse(out.trim().split('\n').pop());
    // Either the grant/binding is by-then genuinely expired (IDENTITY_MISMATCH)
    // or it is still technically live but with <1s remaining, caught by
    // computeActionTtlSeconds (INTERNAL_ERROR, never a fabricated action).
    assert.notStrictEqual(result.status, 'ACTION_REQUIRED', 'a binding with <1s remaining must never successfully mint: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── MainOrchestratorBinding ──────────────────────────────────────────────────

test('createMainOrchestratorBinding: PLAN.md ~L574 exact nine-key shape (no session_generation_id on the record); its (runtime,runtime_session_key) tuple re-derives to the live generation', () => {
  const dir = makeGitProject();
  try {
    const planPath = writePlanFixture(dir, 'binding-test');
    const plan = rll.discoverPlan(dir);
    const worktreeId = rll.computeWorktreeId(dir);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'binding-session' };
    const result = rll.createMainOrchestratorBinding(dir, identity, worktreeId, plan.planDigest, 120);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.binding.worktree_id, worktreeId);
    assert.strictEqual(result.binding.plan_digest, plan.planDigest);
    assert.match(result.binding.binding_id, /^[0-9a-f]{32}$/);
    assert.strictEqual(rll.hasExactKeys(result.binding, [
      'actor_instance_id', 'binding_id', 'created_at', 'expiry', 'plan_digest',
      'runtime', 'runtime_session_key', 'schema', 'worktree_id',
    ].sort()), true, 'session_generation_id must NOT be a member -- PLAN.md ~L574 freezes exactly nine fields');
    const genResult = rll.resolveSessionGeneration(dir, { provider: result.binding.runtime, runtime_session_key: result.binding.runtime_session_key });
    assert.strictEqual(genResult.ok, true);
    assert.strictEqual(genResult.generationId, rll.resolveSessionGeneration(dir, identity).generationId, 're-deriving from the binding\'s own tuple matches the tuple used to create it');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getOrCreateMainOrchestratorBindingForSession: the same live session/worktree/PLAN reuses one binding sequentially and across concurrent hook processes', async () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'main-binding-lookup-or-create');
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const sessionId = 'main-binding-shared-session';

    const first = rll.getOrCreateMainOrchestratorBindingForSession(dir, sessionId, worktreeId, planDigest, 120);
    const second = rll.getOrCreateMainOrchestratorBindingForSession(dir, sessionId, worktreeId, planDigest, 120);
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    assert.strictEqual(second.ok, true, JSON.stringify(second));
    assert.strictEqual(second.binding.binding_id, first.binding.binding_id, 'sequential calls for one exact main-context tuple must reuse the same live binding');

    const childSource = [
      'const r=require(process.argv[1]);',
      'const out=r.getOrCreateMainOrchestratorBindingForSession(process.argv[2],process.argv[3],process.argv[4],process.argv[5],120);',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const launch = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', childSource, IMPL, dir, sessionId, worktreeId, planDigest], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('concurrent binding child failed: ' + code + ' ' + stderr));
        try { resolve(JSON.parse(stdout)); } catch (err) { reject(new Error('invalid child JSON: ' + stdout + ' ' + stderr)); }
      });
    });
    const concurrent = await Promise.all(Array.from({ length: 8 }, launch));
    for (const result of concurrent) {
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.strictEqual(result.binding.binding_id, first.binding.binding_id, 'concurrent calls must serialize and reuse the same live binding');
    }

    const otherSession = rll.getOrCreateMainOrchestratorBindingForSession(dir, 'main-binding-other-session', worktreeId, planDigest, 120);
    assert.strictEqual(otherSession.ok, true, JSON.stringify(otherSession));
    assert.notStrictEqual(otherSession.binding.binding_id, first.binding.binding_id, 'a different host session must receive a different binding');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rebindMainOrchestratorBindingForNewPlan: preserves runtime_session_key (so re-derived generation stays the SAME) + runtime + actor_instance_id, changes plan_digest + binding_id', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'rebind-test');
    const worktreeId = rll.computeWorktreeId(dir);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'rebind-session' };
    const original = rll.createMainOrchestratorBinding(dir, identity, worktreeId, 'a'.repeat(64), 120);
    const rebound = rll.rebindMainOrchestratorBindingForNewPlan(dir, original.binding, 'b'.repeat(64), 120);
    assert.strictEqual(rebound.ok, true);
    assert.strictEqual(rebound.binding.runtime_session_key, original.binding.runtime_session_key);
    assert.strictEqual(rebound.binding.runtime, original.binding.runtime);
    assert.strictEqual(rebound.binding.actor_instance_id, original.binding.actor_instance_id);
    assert.strictEqual(rebound.binding.plan_digest, 'b'.repeat(64));
    assert.notStrictEqual(rebound.binding.binding_id, original.binding.binding_id);
    const origGen = rll.resolveSessionGeneration(dir, { provider: original.binding.runtime, runtime_session_key: original.binding.runtime_session_key });
    const reboundGen = rll.resolveSessionGeneration(dir, { provider: rebound.binding.runtime, runtime_session_key: rebound.binding.runtime_session_key });
    assert.strictEqual(reboundGen.generationId, origGen.generationId, 'draft->final rebind never mints a new session generation');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── lifecycle-command-grant/v1 (PLAN.md ~L576, WP3 item C correction pass R3
// point A.1 -- implemented LITERALLY: exact schema/key-set, binding_kind/
// authority/profile enums, the frozen profile-admission table, action_id
// required-iff-{action-failed,ready,wait-ready}, closed role union, <=30s
// hard TTL) ──────────────────────────────────────────────────────────────────

function makeBindingFixture(dir) {
  writePlanFixture(dir, 'grant-test-' + Math.random().toString(16).slice(2));
  const worktreeId = rll.computeWorktreeId(dir);
  const plan = rll.discoverPlan(dir);
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'grant-fixture-session-' + Math.random().toString(16).slice(2) };
  return rll.createMainOrchestratorBinding(dir, identity, worktreeId, plan.planDigest, 120).binding;
}

// R4 round 3 (block 1a): mints a GENUINE RoleActorBinding/v1 -- a
// separate registry type from `makeBindingFixture` above, never
// resolved through MainOrchestratorBinding/v1.
// Reuses an ALREADY-established plan for `dir` (discoverPlan succeeds) --
// never blindly calls writePlanFixture, which mints a NEW wave-<random>
// directory on every call and would otherwise make discoverPlan ambiguous
// (multiple PLAN.md matches) the moment this fixture runs a second time
// against a dir another fixture (e.g. makeBindingFixture) already set up.
function makeRoleActorBindingFixture(dir, role) {
  const worktreeId = rll.computeWorktreeId(dir);
  let plan = rll.discoverPlan(dir);
  if (!plan.ok) {
    writePlanFixture(dir, 'role-actor-grant-test-' + Math.random().toString(16).slice(2));
    plan = rll.discoverPlan(dir);
  }
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'role-actor-fixture-session-' + Math.random().toString(16).slice(2) };
  const generationId = rll.resolveSessionGeneration(dir, identity).generationId;
  const result = rll.createRoleActorBinding(dir, role, worktreeId, plan.planDigest, generationId, 120);
  assert.strictEqual(result.ok, true, 'test fixture setup: createRoleActorBinding must succeed: ' + JSON.stringify(result));
  return result.binding;
}

// R4 round 3 (round 4 correction, finding 1): createRoleActorBinding
// previously validated ONLY `role` -- malformed digests, an arbitrary
// (non-CSPRNG-shaped) session_generation_id, and a negative/unbounded TTL
// were all silently accepted and durably published. Reproduced empirically
// by the auditor; every one of these must now be rejected BEFORE any
// registry write, and NOTHING must be written to disk in each case.
test('createRoleActorBinding: rejects a malformed worktree_id/plan_digest (not exactly 64-hex), a non-CSPRNG-shaped session_generation_id, and a negative/zero/unbounded TTL -- BEFORE anything is durably written (R4 round 3, round 4 correction, finding 1)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'role-actor-hardening');
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'role-actor-hardening-session' };
    const generationId = rll.resolveSessionGeneration(dir, identity).generationId;
    const bindingsDir = path.join(rll.registryRepoDir(dir), 'role-actor-bindings');

    const badWorktree = rll.createRoleActorBinding(dir, 'arch-testing', 'a'.repeat(63), planDigest, generationId, 120);
    assert.strictEqual(badWorktree.ok, false, '63-hex worktree_id must be rejected: ' + JSON.stringify(badWorktree));
    assert.strictEqual(badWorktree.reason, 'invalid-worktree-id');

    const badPlan = rll.createRoleActorBinding(dir, 'arch-testing', worktreeId, 'b'.repeat(65), generationId, 120);
    assert.strictEqual(badPlan.ok, false, '65-hex plan_digest must be rejected: ' + JSON.stringify(badPlan));
    assert.strictEqual(badPlan.reason, 'invalid-plan-digest');

    const badGeneration = rll.createRoleActorBinding(dir, 'arch-testing', worktreeId, planDigest, 'not-a-csprng-id', 120);
    assert.strictEqual(badGeneration.ok, false, 'a non-CSPRNG-shaped session_generation_id must be rejected: ' + JSON.stringify(badGeneration));
    assert.strictEqual(badGeneration.reason, 'invalid-session-generation-id');

    const badGenerationWrongLength = rll.createRoleActorBinding(dir, 'arch-testing', worktreeId, planDigest, 'c'.repeat(64), 120);
    assert.strictEqual(badGenerationWrongLength.ok, false, 'a 64-hex value must never satisfy the 32-exact CSPRNG contract: ' + JSON.stringify(badGenerationWrongLength));
    assert.strictEqual(badGenerationWrongLength.reason, 'invalid-session-generation-id');

    for (const badTtl of [-1, 0, 1.5, NaN, Infinity, 121, '120']) {
      const result = rll.createRoleActorBinding(dir, 'arch-testing', worktreeId, planDigest, generationId, badTtl);
      assert.strictEqual(result.ok, false, 'ttlSeconds=' + badTtl + ' must be rejected: ' + JSON.stringify(result));
      assert.strictEqual(result.reason, 'invalid-ttl');
    }

    // NOTHING was durably written for any of the rejected attempts.
    let bindingFiles = [];
    try { bindingFiles = fs.readdirSync(bindingsDir); } catch (err) { /* directory may not even exist yet -- also fine */ }
    assert.deepStrictEqual(bindingFiles, [], 'a rejected createRoleActorBinding call must never publish a role-actor-bindings/ file: ' + JSON.stringify(bindingFiles));

    // A genuinely well-formed call still succeeds, proving the checks are
    // not simply over-rejecting.
    const good = rll.createRoleActorBinding(dir, 'arch-testing', worktreeId, planDigest, generationId, 120);
    assert.strictEqual(good.ok, true, JSON.stringify(good));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Mints a well-formed main-orchestrator+normal ensure grant -- the common
// case most tests below build on before tampering one specific field.
function mintNormalGrant(dir, binding, argvDigest, role, subcommand, actionId) {
  return rll.mintLifecycleCommandGrant(dir, binding, argvDigest, role, subcommand, 'main-orchestrator', 'orchestrator', 'normal', actionId === undefined ? null : actionId);
}

test('mintLifecycleCommandGrant + validateAndConsumeLifecycleCommandGrant: succeeds exactly once for matching argv shape', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-abc', 'arch-testing', 'ensure');
    assert.strictEqual(grant.ok, true, JSON.stringify(grant));
    const consumed = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-abc', 'arch-testing', 'ensure');
    assert.strictEqual(consumed.ok, true, JSON.stringify(consumed));
    assert.strictEqual(consumed.binding.binding_id, binding.binding_id);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: the persisted record is the EXACT PLAN.md ~L576 key-set and schema literal', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-shape', 'arch-testing', 'ensure');
    assert.strictEqual(grant.ok, true);
    const rec = JSON.parse(fs.readFileSync(rll.grantPathFor(dir, grant.grantId), 'utf8'));
    assert.strictEqual(rec.schema, 'runtime/lifecycle-command-grant/v1');
    const expectedKeys = [
      'action_id', 'actor_instance_id', 'authority', 'binding_id', 'binding_kind',
      'canonical_argv_digest', 'created_at', 'expiry', 'grant_id', 'plan_digest',
      'profile', 'role', 'schema', 'subcommand', 'worktree_id',
    ].sort();
    assert.deepStrictEqual(Object.keys(rec).sort(), expectedKeys);
    assert.strictEqual(rec.binding_kind, 'main-orchestrator');
    assert.strictEqual(rec.authority, 'orchestrator');
    assert.strictEqual(rec.profile, 'normal');
    assert.strictEqual(rec.action_id, null);
    assert.strictEqual(rec.actor_instance_id, binding.actor_instance_id);
    const ttlMs = Date.parse(rec.expiry) - Date.parse(rec.created_at);
    assert.ok(ttlMs > 0 && ttlMs <= 30000, 'TTL must be a positive value <=30s: ' + ttlMs);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a grant record with an EXTRA unexpected key is rejected (closed key-set, not merely two ids)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-extra-key', 'arch-testing', 'ensure');
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    rec.unexpected_extra_field = 'x';
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-extra-key', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-key-set-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: rejects an invalid binding_kind/authority/profile enum value', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const badKind = rll.mintLifecycleCommandGrant(dir, binding, 'd1', 'arch-testing', 'ensure', 'totally-invalid-kind', 'orchestrator', 'normal', null);
    assert.strictEqual(badKind.ok, false);
    assert.strictEqual(badKind.reason, 'invalid-binding-kind');
    const badAuthority = rll.mintLifecycleCommandGrant(dir, binding, 'd2', 'arch-testing', 'ensure', 'main-orchestrator', 'totally-invalid-authority', 'normal', null);
    assert.strictEqual(badAuthority.ok, false);
    assert.strictEqual(badAuthority.reason, 'invalid-authority');
    const badProfile = rll.mintLifecycleCommandGrant(dir, binding, 'd3', 'arch-testing', 'ensure', 'main-orchestrator', 'orchestrator', 'totally-invalid-profile', null);
    assert.strictEqual(badProfile.ok, false);
    assert.strictEqual(badProfile.reason, 'invalid-profile');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: rejects binding_kind/profile that do not co-vary (role-actor+normal, main-orchestrator+target)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    // R4 round 3 (round 4 correction, finding 1): a genuine RoleActorBinding
    // is required here now that minting is schema-aware -- the profile
    // co-variance check this sub-case targets is DOWNSTREAM of the schema
    // check, and must never be masked by an earlier, unrelated rejection.
    const roleActorBinding = makeRoleActorBindingFixture(dir, 'arch-testing');
    const r1 = rll.mintLifecycleCommandGrant(dir, roleActorBinding, 'd1', 'arch-testing', 'ready', 'role-actor', 'target', 'normal', null);
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(r1.reason, 'binding-kind-profile-mismatch');
    const r2 = rll.mintLifecycleCommandGrant(dir, binding, 'd2', 'arch-testing', 'ensure', 'main-orchestrator', 'orchestrator', 'target', null);
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.reason, 'binding-kind-profile-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mint+validate: PLAN.md ~L576 exact admission table -- bootstrap admits probe|ensure|action-failed|wait-ready|status, rejects notify|rotate|stop-owned', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    for (const sub of ['probe', 'ensure', 'status']) {
      const grant = rll.mintLifecycleCommandGrant(dir, binding, 'd-' + sub, 'arch-testing', sub, 'main-orchestrator', 'orchestrator', 'bootstrap', null);
      assert.strictEqual(grant.ok, true, sub + ' must be admitted by bootstrap: ' + JSON.stringify(grant));
    }
    for (const sub of ['notify', 'rotate', 'stop-owned']) {
      const grant = rll.mintLifecycleCommandGrant(dir, binding, 'd-' + sub, 'arch-testing', sub, 'main-orchestrator', 'orchestrator', 'bootstrap', null);
      assert.strictEqual(grant.ok, false, sub + ' must NEVER be admitted by bootstrap');
      assert.strictEqual(grant.reason, 'subcommand-not-admitted-by-profile');
    }
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mint+validate: PLAN.md ~L576 exact admission table -- normal admits notify|rotate|stop-owned, target admits ONLY ready', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    for (const sub of ['notify', 'rotate', 'stop-owned']) {
      const grant = rll.mintLifecycleCommandGrant(dir, binding, 'd-' + sub, 'arch-testing', sub, 'main-orchestrator', 'orchestrator', 'normal', null);
      assert.strictEqual(grant.ok, true, sub + ' must be admitted by normal: ' + JSON.stringify(grant));
    }
    // R4 round 3 (round 4 correction, finding 1): target/role-actor cases
    // now need a genuine RoleActorBinding -- minting is schema-aware.
    const roleActorBinding = makeRoleActorBindingFixture(dir, 'arch-testing');
    const target = rll.mintLifecycleCommandGrant(dir, roleActorBinding, 'd-ready', 'arch-testing', 'ready', 'role-actor', 'target', 'target', 'a'.repeat(32));
    assert.strictEqual(target.ok, true, JSON.stringify(target));
    const targetEnsure = rll.mintLifecycleCommandGrant(dir, roleActorBinding, 'd-target-ensure', 'arch-testing', 'ensure', 'role-actor', 'target', 'target', null);
    assert.strictEqual(targetEnsure.ok, false);
    assert.strictEqual(targetEnsure.reason, 'subcommand-not-admitted-by-profile');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Point 1.2 (R4): binding_kind and authority co-vary 1:1 -- previously each
// was validated as an INDEPENDENT enum with no correlation between them, so
// a main-orchestrator+target (or role-actor+orchestrator) grant was
// structurally acceptable despite being semantically incoherent (an
// orchestrator-context binding exercising target authority, or vice versa).
test('mintLifecycleCommandGrant/validateAndConsumeLifecycleCommandGrant: binding_kind and authority must co-vary -- main-orchestrator+target and role-actor+orchestrator are BOTH rejected, even though each field is individually a valid enum member (point 1.2)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const mainWithTargetAuthority = rll.mintLifecycleCommandGrant(dir, binding, 'd-mismatch-1', 'arch-testing', 'probe', 'main-orchestrator', 'target', 'bootstrap', null);
    assert.strictEqual(mainWithTargetAuthority.ok, false, 'main-orchestrator binding_kind can never carry target authority');
    assert.strictEqual(mainWithTargetAuthority.reason, 'binding-kind-authority-mismatch');

    // A validly-minted grant, later TAMPERED to an incoherent pair, is also
    // rejected at consumption time -- never merely trusted from mint time.
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'd-tamper-authority', 'arch-testing', 'probe', 'main-orchestrator', 'orchestrator', 'bootstrap', null);
    assert.strictEqual(grant.ok, true, JSON.stringify(grant));
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    rec.authority = 'target';
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
    const consumed = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-tamper-authority', 'arch-testing', 'probe');
    assert.strictEqual(consumed.ok, false);
    assert.strictEqual(consumed.reason, 'grant-binding-kind-authority-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: role-actor binding_kind can never carry orchestrator authority, even individually valid enum members, backed by a genuine RoleActorBinding now that minting is schema-aware (point 1.2)', () => {
  const dir = makeGitProject();
  try {
    const roleActorBinding = makeRoleActorBindingFixture(dir, 'arch-testing');
    const roleActorWithOrchestratorAuthority = rll.mintLifecycleCommandGrant(dir, roleActorBinding, 'd-mismatch-2', 'arch-testing', 'ready', 'role-actor', 'orchestrator', 'target', 'a'.repeat(32));
    assert.strictEqual(roleActorWithOrchestratorAuthority.ok, false, 'role-actor binding_kind can never carry orchestrator authority');
    assert.strictEqual(roleActorWithOrchestratorAuthority.reason, 'binding-kind-authority-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a grant whose profile no longer admits its OWN subcommand (tampered post-mint) is rejected, not merely trusted from mint time', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'd-tamper-admit', 'arch-testing', 'notify');
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    rec.profile = 'bootstrap'; // bootstrap does not admit notify
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-tamper-admit', 'arch-testing', 'notify');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-subcommand-not-admitted');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Point 1.4 (R4): the grant record's OWN embedded grant_id must match the
// id the caller's path reference was built from -- never implicitly
// trusted merely because a file was found at that path. Proven two ways:
// (a) a record whose OWN grant_id field was tampered to a DIFFERENT
// (still well-formed) value than its path, and (b) the copy-onto-a-
// different-path scenario this check exists to catch -- a SECOND,
// independently-minted grant's bytes placed at the FIRST grant's own path.
test('validateAndConsumeLifecycleCommandGrant: the record embedded grant_id must match the path-derived id -- neither a tampered field nor a foreign record copied onto this path is ever honored (point 1.4)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);

    const grantA = mintNormalGrant(dir, binding, 'd-idcheck-a', 'arch-testing', 'notify');
    const grantPathA = rll.grantPathFor(dir, grantA.grantId);
    const recA = JSON.parse(fs.readFileSync(grantPathA, 'utf8'));
    recA.grant_id = 'f'.repeat(32); // well-formed hex, but no longer matches the path.
    fs.chmodSync(grantPathA, 0o600);
    fs.writeFileSync(grantPathA, JSON.stringify(recA), { mode: 0o600 });
    const tamperedResult = rll.validateAndConsumeLifecycleCommandGrant(dir, grantA.grantId, 'd-idcheck-a', 'arch-testing', 'notify');
    assert.strictEqual(tamperedResult.ok, false);
    assert.strictEqual(tamperedResult.reason, 'grant-id-path-mismatch');

    const grantB = mintNormalGrant(dir, binding, 'd-idcheck-b', 'arch-testing', 'rotate');
    const grantPathB = rll.grantPathFor(dir, grantB.grantId);
    const recB = JSON.parse(fs.readFileSync(grantPathB, 'utf8'));
    // Copy grantB's own (genuinely, internally consistent) bytes onto
    // grantA's path -- the file at grantA's path now legitimately claims
    // to BE grantB, entirely self-consistent except for the path it lives at.
    fs.writeFileSync(grantPathA, JSON.stringify(recB), { mode: 0o600 });
    const copiedResult = rll.validateAndConsumeLifecycleCommandGrant(dir, grantA.grantId, 'd-idcheck-b', 'arch-testing', 'rotate');
    assert.strictEqual(copiedResult.ok, false);
    assert.strictEqual(copiedResult.reason, 'grant-id-path-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: action_id is required+hex for action-failed|ready|wait-ready, and rejected as non-null for everything else', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    for (const sub of ['action-failed', 'wait-ready']) {
      const missing = rll.mintLifecycleCommandGrant(dir, binding, 'd-' + sub, 'arch-testing', sub, 'main-orchestrator', 'orchestrator', 'normal', null);
      assert.strictEqual(missing.ok, false, sub + ' must require a non-null action_id');
      assert.strictEqual(missing.reason, 'action-id-required');
      const malformed = rll.mintLifecycleCommandGrant(dir, binding, 'd2-' + sub, 'arch-testing', sub, 'main-orchestrator', 'orchestrator', 'normal', 'not-hex!!');
      assert.strictEqual(malformed.ok, false);
      assert.strictEqual(malformed.reason, 'action-id-required');
      const ok = rll.mintLifecycleCommandGrant(dir, binding, 'd3-' + sub, 'arch-testing', sub, 'main-orchestrator', 'orchestrator', 'normal', 'a'.repeat(32));
      assert.strictEqual(ok.ok, true, sub + ' with a well-formed hex action_id must succeed: ' + JSON.stringify(ok));
    }

    const spuriousActionId = rll.mintLifecycleCommandGrant(dir, binding, 'd-spurious', 'arch-testing', 'ensure', 'main-orchestrator', 'orchestrator', 'normal', 'a'.repeat(32));
    assert.strictEqual(spuriousActionId.ok, false, 'ensure must reject a non-null action_id');
    assert.strictEqual(spuriousActionId.reason, 'action-id-must-be-null');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: ready (role-actor+target) also requires a non-null action_id, backed by a genuine RoleActorBinding now that minting is schema-aware', () => {
  const dir = makeGitProject();
  try {
    const roleActorBinding = makeRoleActorBindingFixture(dir, 'arch-testing');
    const readyMissing = rll.mintLifecycleCommandGrant(dir, roleActorBinding, 'd-ready-missing', 'arch-testing', 'ready', 'role-actor', 'target', 'target', null);
    assert.strictEqual(readyMissing.ok, false);
    assert.strictEqual(readyMissing.reason, 'action-id-required');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// R4 round 3 (block 1a): `ready` is role-actor+target, and RoleActorBinding/v1
// now genuinely exists -- this test's OWN intent (action_id correlation is
// checked, and a MISMATCH is rejected distinctly, BEFORE binding
// resolution is ever attempted) is now provable end to end: the
// wrong-action_id case is rejected for its OWN reason (grant-shape-mismatch,
// checked BEFORE the binding_kind branch), while the right-action_id case
// -- backed by a GENUINE RoleActorBinding, never a MainOrchestratorBinding
// masquerade -- genuinely SUCCEEDS, proving the correlation check passing
// is what unblocks real resolution, not merely a different failure mode.
test('validateAndConsumeLifecycleCommandGrant: action_id correlation -- a MISMATCHED action_id is rejected distinctly from (and before) role-actor binding resolution; the CORRECT action_id, backed by a genuine RoleActorBinding, succeeds', () => {
  const dir = makeGitProject();
  try {
    const realActionId = 'b'.repeat(32);
    const binding = makeRoleActorBindingFixture(dir, 'arch-testing');
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'd-corr', 'arch-testing', 'ready', 'role-actor', 'target', 'target', realActionId);
    assert.strictEqual(grant.ok, true);
    const wrongAction = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-corr', 'arch-testing', 'ready', 'c'.repeat(32));
    assert.strictEqual(wrongAction.ok, false);
    assert.strictEqual(wrongAction.reason, 'grant-shape-mismatch');
    const rightAction = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-corr', 'arch-testing', 'ready', realActionId);
    assert.strictEqual(rightAction.ok, true, 'the correct action_id, with a genuine RoleActorBinding, must succeed: ' + JSON.stringify(rightAction));
    assert.strictEqual(rightAction.bindingKind, 'role-actor');
    assert.strictEqual(rightAction.binding.binding_id, binding.binding_id);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// R4 round 3 (block 1a): the DELIBERATE wrong-binding-type masquerade this
// test previously had no alternative to -- a role-actor grant whose
// binding_id points at a MainOrchestratorBinding record (never a genuine
// RoleActorBinding) is correctly rejected, never silently resolved through
// the wrong type.
// R4 round 3 (round 4 correction, finding 1): previously this scenario
// minted SUCCESSFULLY (publishing a semantically false grant artifact --
// binding_kind:'role-actor' whose binding_id actually pointed at a
// MainOrchestratorBinding record) and was only caught later, at
// consumption. mintLifecycleCommandGrant is now schema-aware: the mismatch
// is rejected at MINT time, before any grant file is ever published --
// strictly earlier and more precise than catching it downstream.
test('mintLifecycleCommandGrant: a role-actor bindingKind whose binding is actually a MainOrchestratorBinding (never a genuine RoleActorBinding) is rejected AT MINT TIME as binding-kind-schema-mismatch -- no grant file is ever published', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const realActionId = 'b'.repeat(32);
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'd-wrong-type', 'arch-testing', 'ready', 'role-actor', 'target', 'target', realActionId);
    assert.strictEqual(grant.ok, false, 'a MainOrchestratorBinding passed as bindingKind:role-actor must never mint: ' + JSON.stringify(grant));
    assert.strictEqual(grant.reason, 'binding-kind-schema-mismatch');

    // Nothing was published to the grants/ registry at all.
    const grantsDir = path.join(rll.registryRepoDir(dir), 'grants');
    let grantFiles = [];
    try { grantFiles = fs.readdirSync(grantsDir).filter((f) => f.endsWith('.json')); } catch (err) { /* directory may not even exist yet -- also fine */ }
    assert.deepStrictEqual(grantFiles, [], 'a rejected mint must never publish a grant file: ' + JSON.stringify(grantFiles));

  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // The symmetric mismatch (a genuine RoleActorBinding passed as
  // bindingKind:main-orchestrator) is ALSO rejected the same way -- a
  // FRESH directory (never a second writePlanFixture against the SAME
  // dir, which would make discoverPlan ambiguous across two wave-*
  // directories).
  const dir2 = makeGitProject();
  try {
    const roleActorBinding = makeRoleActorBindingFixture(dir2, 'arch-testing');
    const reverseMismatch = rll.mintLifecycleCommandGrant(dir2, roleActorBinding, 'd-reverse-mismatch', 'arch-testing', 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
    assert.strictEqual(reverseMismatch.ok, false, 'a RoleActorBinding passed as bindingKind:main-orchestrator must never mint: ' + JSON.stringify(reverseMismatch));
    assert.strictEqual(reverseMismatch.reason, 'binding-kind-schema-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir2), { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: closed role union -- single canonical string, sorted-unique-non-empty canonical array, or null all succeed; malformed shapes are rejected', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const asString = mintNormalGrant(dir, binding, 'd-role-str', 'arch-testing', 'ensure');
    assert.strictEqual(asString.ok, true);
    const asArray = mintNormalGrant(dir, binding, 'd-role-arr', ['arch-testing', 'verifier'], 'ensure');
    assert.strictEqual(asArray.ok, true, JSON.stringify(asArray));
    const asNull = rll.mintLifecycleCommandGrant(dir, binding, 'd-role-null', null, 'probe', 'main-orchestrator', 'orchestrator', 'normal', null);
    assert.strictEqual(asNull.ok, true, JSON.stringify(asNull));

    const notCanonical = mintNormalGrant(dir, binding, 'd-role-bad', 'not-a-real-role', 'ensure');
    assert.strictEqual(notCanonical.ok, false);
    assert.strictEqual(notCanonical.reason, 'invalid-role-shape');
    const emptyArray = mintNormalGrant(dir, binding, 'd-role-empty', [], 'ensure');
    assert.strictEqual(emptyArray.ok, false);
    assert.strictEqual(emptyArray.reason, 'invalid-role-shape');
    const unsortedArray = mintNormalGrant(dir, binding, 'd-role-unsorted', ['verifier', 'arch-testing'], 'ensure');
    assert.strictEqual(unsortedArray.ok, false, 'role array must be sorted -- unsorted is malformed, never silently accepted');
    assert.strictEqual(unsortedArray.reason, 'invalid-role-shape');
    const dupArray = mintNormalGrant(dir, binding, 'd-role-dup', ['arch-testing', 'arch-testing'], 'ensure');
    assert.strictEqual(dupArray.ok, false, 'role array must be unique');
    assert.strictEqual(dupArray.reason, 'invalid-role-shape');
    const numberRole = mintNormalGrant(dir, binding, 'd-role-num', 42, 'ensure');
    assert.strictEqual(numberRole.ok, false);
    assert.strictEqual(numberRole.reason, 'invalid-role-shape');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a multi-role ARRAY grant does not authorize a mismatched array (order/membership) or a plain-string call', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'd-arr-corr', ['arch-testing', 'verifier'], 'ensure');
    assert.strictEqual(grant.ok, true);
    const wrongOrder = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-arr-corr', ['verifier', 'arch-testing'], 'ensure');
    assert.strictEqual(wrongOrder.ok, false);
    assert.strictEqual(wrongOrder.reason, 'grant-shape-mismatch');
    const subsetOnly = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-arr-corr', ['arch-testing'], 'ensure');
    assert.strictEqual(subsetOnly.ok, false);
    assert.strictEqual(subsetOnly.reason, 'grant-shape-mismatch');
    const exact = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-arr-corr', ['arch-testing', 'verifier'], 'ensure');
    assert.strictEqual(exact.ok, true, JSON.stringify(exact));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintLifecycleCommandGrant: TTL is hard-capped at 30 seconds -- validateAndConsumeLifecycleCommandGrant independently re-checks it, never trusting mint time', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'd-ttl', 'arch-testing', 'ensure');
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    // Tampered to a 31s window -- still unexpired (both timestamps in the
    // near future), so ONLY the independent >30s re-check can catch this.
    const createdAt = new Date(Date.now() + 2000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const expiry = new Date(Date.parse(createdAt) + 31000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    rec.created_at = createdAt;
    rec.expiry = expiry;
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-ttl', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-ttl-exceeds-30s');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: created_at in the future is rejected', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'd-future', 'arch-testing', 'ensure');
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    const createdAt = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    rec.created_at = createdAt;
    rec.expiry = new Date(Date.parse(createdAt) + 5000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'd-future', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-created-in-future');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: REPLAY (same grant_id used twice) is rejected the second time', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-replay', 'arch-testing', 'ensure');
    const first = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-replay', 'arch-testing', 'ensure');
    assert.strictEqual(first.ok, true);
    const replay = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-replay', 'arch-testing', 'ensure');
    assert.strictEqual(replay.ok, false);
    assert.strictEqual(replay.reason, 'grant-replay');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a MISMATCHED argv_digest (different args than what the grant authorized) is rejected', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-original', 'arch-testing', 'ensure');
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-TAMPERED', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-shape-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a MISMATCHED role is rejected (a grant for one role cannot authorize a different role)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-x', 'arch-testing', 'ensure');
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-x', 'context-provider', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-shape-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a MISMATCHED subcommand is rejected (a grant for ensure cannot authorize ready)', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-x', 'arch-testing', 'ensure');
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-x', 'arch-testing', 'ready');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-shape-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a forged/never-minted grant_id (well-formed hex, but no record) is rejected as absent', () => {
  const dir = makeGitProject();
  try {
    const forgedId = 'f'.repeat(32);
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, forgedId, 'digest-x', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-absent');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: a malformed (non-hex) grant_id is rejected before any registry lookup', () => {
  const dir = makeGitProject();
  try {
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, 'not-a-valid-hex-id!!', 'digest-x', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'malformed-grant-id');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: an EXPIRED grant is rejected even with a perfectly matching argv shape', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = mintNormalGrant(dir, binding, 'digest-expiry', 'arch-testing', 'ensure');
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    // Both created_at AND expiry moved into the far past (still a valid
    // <=30s-apart pair) so this exercises the GENUINE now>=expiry rejection,
    // never the separate created_at<=expiry / TTL-exceeds-30s checks.
    rec.created_at = '2000-01-01T00:00:00Z';
    rec.expiry = '2000-01-01T00:00:29Z';
    // Grants are no-clobber/immutable in production; this test directly rewrites
    // the host-private fixture bytes (not through the production write path) to
    // simulate the passage of time without a real sleep.
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
    const result = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-expiry', 'arch-testing', 'ensure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'grant-expired');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// R4 round 2, point 4: reuse the SAME hex-ID + canonical-ISO-UTC rigor
// RoleBinding/v1 now enforces for lifecycle-command-grant/v1's own ID and
// timestamp fields -- never merely non-empty-string or Date.parse-able.
test('validateAndConsumeLifecycleCommandGrant: non-hex ID fields and non-canonical timestamps are rejected, even though every OTHER shape/correlation check still passes (R4 round 2, point 4)', () => {
  // Each tamper case needs its OWN fresh project: makeBindingFixture writes
  // a NEW randomly-slugged PLAN each call, so reusing one `dir` across
  // multiple fixture mints would make discoverPlan ambiguous (two
  // .planning/wave-*/PLAN.md files) on the second call onward.
  const tamperAndValidate = (mutate) => {
    const dir = makeGitProject();
    try {
      const binding = makeBindingFixture(dir);
      const grant = mintNormalGrant(dir, binding, 'digest-hexcheck', 'arch-testing', 'ensure');
      const grantPath = rll.grantPathFor(dir, grant.grantId);
      const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
      mutate(rec);
      fs.chmodSync(grantPath, 0o600);
      fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });
      return rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-hexcheck', 'arch-testing', 'ensure');
    } finally {
      fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  let result = tamperAndValidate((rec) => { rec.binding_id = 'not-hex-at-all!!'; });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.reason, 'grant-id-shape-invalid');

  result = tamperAndValidate((rec) => { rec.actor_instance_id = 'also-not-hex'; });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.reason, 'grant-id-shape-invalid');

  result = tamperAndValidate((rec) => { rec.worktree_id = 'zzz'; });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.reason, 'grant-scope-id-shape-invalid');

  result = tamperAndValidate((rec) => { rec.plan_digest = 'zzz'; });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.reason, 'grant-scope-id-shape-invalid');

  // Date.parse-able (milliseconds) but NOT canonical ISO-8601 UTC.
  result = tamperAndValidate((rec) => { rec.created_at = rec.created_at.replace('Z', '.000Z'); });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.reason, 'grant-timestamp-shape-invalid');

  result = tamperAndValidate((rec) => { rec.expiry = rec.expiry.replace('Z', '.000Z'); });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.reason, 'grant-timestamp-shape-invalid');
});

// Point 2.5: an orphaned supervisor-lifecycle-tx lock (the mkdir'd .lock
// directory from a holder that crashed before its own finally{rmdirSync}
// ran) must NEVER be treated as recoverable by age or by any other
// heuristic -- a waiter must time out loudly (an explicit, caller-visible
// failure) rather than silently hang forever OR silently force-reclaim/
// adopt someone else's lock. This is proven directly against THIS file's
// OWN withRegistryLock (every lock in runtime-role-lifecycle.cjs, including
// supervisorLifecycleTxLockDirFor's, is this exact function) -- never
// inferred from the structurally-similar but SEPARATE withRegistryLock
// implementation in runtime-consultation.cjs that LOCK-ORPHAN-01 covers.
test('withRegistryLock: a pre-existing orphaned supervisor-lifecycle-tx .lock directory is NEVER age-reclaimed -- a waiter times out loudly, never hangs, never force-enters, never touches/adopts the orphan (point 2.5)', () => {
  const dir = makeGitProject();
  try {
    const coordId = rll.computeCoordinationRootId(dir);
    const lockDir = rll.supervisorLifecycleTxLockDirFor(dir, coordId);
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    // Artificially aged well past any plausible bounded wait -- proving age
    // alone must NOT unblock the operation (mirrors LOCK-ORPHAN-01's own
    // technique against the sibling runtime-consultation.cjs primitive).
    const ancientMs = Date.parse('2020-01-01T00:00:00Z');
    fs.utimesSync(lockDir, ancientMs / 1000, ancientMs / 1000);
    const mtimeBefore = fs.statSync(lockDir).mtimeMs;

    let criticalSectionRan = false;
    const startedAt = Date.now();
    const result = rll.withRegistryLock(lockDir, () => { criticalSectionRan = true; return 'unreachable'; }, { maxWaitMs: 150 });
    const elapsedMs = Date.now() - startedAt;

    assert.deepStrictEqual(result, { ok: false, reason: 'lock-timeout' }, 'an orphaned lock must produce an explicit, loud failure -- never ok:true, never a different/vaguer reason');
    assert.strictEqual(criticalSectionRan, false, 'the critical section must NEVER run while the lock is (even orphan-)held -- no force-entry');
    assert.ok(elapsedMs >= 100, 'must have genuinely waited close to the full maxWaitMs bound, not failed instantly: ' + elapsedMs + 'ms');

    assert.strictEqual(fs.existsSync(lockDir), true, 'the orphaned lock directory must still exist -- a timed-out waiter must never delete/reclaim a lock it does not own');
    assert.strictEqual(fs.statSync(lockDir).mtimeMs, mtimeBefore, 'the orphaned lock must not even be TOUCHED (no adoption/refresh) by a waiter that failed to acquire it');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Canonical role/template/digest resolution (M6) ──────────────────────────
// roleProfileDigestFor(role) currently returns
// sha256('runtime-role-lifecycle/wp3-role-profile:' + role) -- a fixed LABEL
// string, never the role's own real canonical template bytes at
// setup/agent-templates/<role>.md (confirmed to exist for every canonical
// role, byte-mirrored into .claude/agents/<role>.md per WP5's own pipeline --
// this suite verified all ten CANONICAL_ROLES have one before writing this
// test). This is the "template/digest validation" gap the M6 dispatch names:
// changing a role's template content today produces ZERO change in its
// profile digest, so a role-binding can never distinguish "this peer was
// spawned against the CURRENT template" from "against a stale one".
// Interpretive note: setup/agent-templates/ is chosen as the canonical
// source (not .claude/agents/, its generated mirror) since WP5's own
// Path-Manifest rows describe the mirror as regenerated FROM the template,
// never the reverse.
const REPO_ROOT_FOR_TEMPLATES = path.resolve(__dirname, '..', '..');
function templatePathFor(role) {
  return path.join(REPO_ROOT_FOR_TEMPLATES, 'setup', 'agent-templates', role + '.md');
}

test('roleProfileDigestFor: for every canonical role, resolves to EXACTLY the sha256 of that role\'s real setup/agent-templates/<role>.md bytes, never a fixed label string unrelated to file content (M6: real template bytes, not a substitute)', () => {
  const crypto = require('node:crypto');
  for (const role of rll.CANONICAL_ROLES) {
    const templatePath = templatePathFor(role);
    assert.ok(fs.existsSync(templatePath), 'test precondition: ' + templatePath + ' must exist on disk');
    const expectedDigest = crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex');
    const actualDigest = rll.roleProfileDigestFor(role);
    assert.strictEqual(actualDigest, expectedDigest, role + ': roleProfileDigestFor must equal sha256(real template bytes), got a value derived from something else entirely');
  }
});

// Mutation/negative control: proves the comparison technique above is
// genuinely discriminating -- two DIFFERENT roles' real template files hash
// to two DIFFERENT sha256 digests (never a coincidental collision that would
// make the positive assertion above vacuously satisfiable for the wrong
// reason).
test('roleProfileDigestFor negative control: two different roles\' REAL template files hash to two DIFFERENT sha256 digests (proves the file-content comparison technique above is genuinely discriminating, not a same-digest coincidence)', () => {
  const crypto = require('node:crypto');
  const digestA = crypto.createHash('sha256').update(fs.readFileSync(templatePathFor('arch-testing'))).digest('hex');
  const digestB = crypto.createHash('sha256').update(fs.readFileSync(templatePathFor('doc-updater'))).digest('hex');
  assert.notStrictEqual(digestA, digestB, 'fixture sanity: two different real template files must hash differently');
});

// ─────────────────────────────────────────────────────────────────────────────
// M6 CORRECTION PASS (P1-1, independent Codex audit): roleProfileDigestFor(role)
// (L677-679) is exactly `sha256File(path.join(..., 'setup', 'agent-templates',
// role + '.md'))` -- no canonical-role check before filesystem access, no
// setup/agent-templates<->.claude/agents mirror-parity check, no expected/
// registered-digest comparison (a fresh hash of whatever bytes are currently
// on disk, with nothing to detect drift against). The tests below propose a
// hardening WRAPPER, `resolveCanonicalRoleProfile(role, opts)` (name TBD by
// toolkit-specialist, mirroring this file's own established "propose the
// minimal interface" precedent) which WRAPS the existing roleProfileDigestFor
// plumbing rather than replacing it (per the dispatch: "hardening wraps it,
// it does not replace it"). A proposed `RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT`
// test-capability-gated override (mirroring every other FAKE_* seam already
// in this codebase) lets these tests point the mirror-parity check at
// test-owned tmp fixtures -- never at the real setup/agent-templates/ or
// .claude/agents/ trees, per the dispatch's own explicit constraint.
// ─────────────────────────────────────────────────────────────────────────────

function makeMirrorFixtureRoot(setupBytes, claudeBytes, role) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-template-root-'));
  if (setupBytes !== null) {
    const setupDir = path.join(root, 'setup', 'agent-templates');
    fs.mkdirSync(setupDir, { recursive: true });
    fs.writeFileSync(path.join(setupDir, role + '.md'), setupBytes);
  }
  if (claudeBytes !== null) {
    const claudeDir = path.join(root, '.claude', 'agents');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, role + '.md'), claudeBytes);
  }
  return root;
}

function withFakeTemplateRoot(root, fn) {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedRoot = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'p11-template-root-cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT = root;
    return fn();
  } finally {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedCap;
    if (savedRoot === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT = savedRoot;
  }
}

test('resolveCanonicalRoleProfile (P1-1, proposed minimal interface): must exist as an exported function -- today roleProfileDigestFor has no canonical-role gate, no mirror-parity check, and no expected-digest comparison, which IS the RED', () => {
  assert.strictEqual(typeof rll.resolveCanonicalRoleProfile, 'function', 'resolveCanonicalRoleProfile (or an equivalently-named exported hardening wrapper) must exist -- today it does not');
});

test('resolveCanonicalRoleProfile (P1-1): scenario 1 (wrong role) -- a NONCANONICAL role name is rejected BEFORE any filesystem access, proven via a real fs.readFileSync spy, never merely inspecting the final result', () => {
  assert.strictEqual(typeof rll.resolveCanonicalRoleProfile, 'function', 'precondition: resolveCanonicalRoleProfile must exist');
  const realReadFileSync = fs.readFileSync;
  let readCalls = 0;
  fs.readFileSync = function (...args) { readCalls += 1; return realReadFileSync.apply(fs, args); };
  try {
    const result = rll.resolveCanonicalRoleProfile('totally-not-a-real-role');
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.reason, 'role-not-canonical', JSON.stringify(result));
    assert.strictEqual(readCalls, 0, 'a noncanonical role must be rejected before ANY fs.readFileSync call: ' + readCalls + ' call(s) observed');
  } finally {
    fs.readFileSync = realReadFileSync;
  }
});

test('resolveCanonicalRoleProfile (P1-1): scenario 2 (wrong mirror) -- setup/agent-templates/<role>.md and .claude/agents/<role>.md are verified to MATCH; a deliberately mismatched mirror, and a file missing from EITHER side, are both rejected -- a genuinely matching mirror succeeds (positive control, proving this is about the mismatch, not a broken fixture)', () => {
  assert.strictEqual(typeof rll.resolveCanonicalRoleProfile, 'function', 'precondition: resolveCanonicalRoleProfile must exist');
  const mismatchedRoot = makeMirrorFixtureRoot('# setup version\n', '# DIFFERENT claude version\n', 'arch-testing');
  const missingClaudeRoot = makeMirrorFixtureRoot('# setup version only\n', null, 'arch-testing');
  const missingSetupRoot = makeMirrorFixtureRoot(null, '# claude version only\n', 'arch-testing');
  const matchingRoot = makeMirrorFixtureRoot('# identical bytes\n', '# identical bytes\n', 'arch-testing');
  try {
    withFakeTemplateRoot(mismatchedRoot, () => {
      const result = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(result.ok, false, JSON.stringify(result));
      assert.strictEqual(result.reason, 'template-mirror-mismatch', 'a byte-mismatched mirror must be rejected: ' + JSON.stringify(result));
    });
    withFakeTemplateRoot(missingClaudeRoot, () => {
      const result = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(result.ok, false, JSON.stringify(result));
      assert.notStrictEqual(result.reason, undefined, 'a missing .claude/agents mirror file must never be silently treated as matching: ' + JSON.stringify(result));
    });
    withFakeTemplateRoot(missingSetupRoot, () => {
      const result = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(result.ok, false, JSON.stringify(result));
      assert.notStrictEqual(result.reason, undefined, 'a missing setup/agent-templates file must never be silently treated as matching: ' + JSON.stringify(result));
    });
    withFakeTemplateRoot(matchingRoot, () => {
      const result = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(result.ok, true, 'a genuinely matching mirror must succeed: ' + JSON.stringify(result));
      assert.match(result.digest, /^[0-9a-f]{64}$/);
    });
  } finally {
    fs.rmSync(mismatchedRoot, { recursive: true, force: true });
    fs.rmSync(missingClaudeRoot, { recursive: true, force: true });
    fs.rmSync(missingSetupRoot, { recursive: true, force: true });
    fs.rmSync(matchingRoot, { recursive: true, force: true });
  }
});

test('resolveCanonicalRoleProfile (P1-1): scenario 3 (changed bytes) -- a stable digest is bound and compared against an EXPECTED/REGISTERED value, not merely recomputed fresh each call; a changed-bytes fixture (the template mutated on BOTH mirror sides since the expected digest was captured -- isolating this from scenario 2\'s own mirror-parity check) is rejected as drift', () => {
  assert.strictEqual(typeof rll.resolveCanonicalRoleProfile, 'function', 'precondition: resolveCanonicalRoleProfile must exist');
  const root = makeMirrorFixtureRoot('# version A\n', '# version A\n', 'arch-testing');
  try {
    withFakeTemplateRoot(root, () => {
      const first = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(first.ok, true, JSON.stringify(first));
      const originalDigest = first.digest;
      assert.match(originalDigest, /^[0-9a-f]{64}$/);

      fs.writeFileSync(path.join(root, 'setup', 'agent-templates', 'arch-testing.md'), '# version B (mutated)\n');
      fs.writeFileSync(path.join(root, '.claude', 'agents', 'arch-testing.md'), '# version B (mutated)\n');

      const afterMutation = rll.resolveCanonicalRoleProfile('arch-testing', { expectedDigest: originalDigest });
      assert.strictEqual(afterMutation.ok, false, JSON.stringify(afterMutation));
      assert.strictEqual(afterMutation.reason, 'template-digest-drift', JSON.stringify(afterMutation));

      // Positive control: the SAME (now-mutated) template, checked WITHOUT a
      // stale expectation, still resolves fine -- proving the rejection
      // above is about the comparison against `originalDigest`, not a
      // generally-broken fixture.
      const withoutExpectation = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(withoutExpectation.ok, true, JSON.stringify(withoutExpectation));
      assert.notStrictEqual(withoutExpectation.digest, originalDigest, 'fixture sanity: the fresh digest must genuinely differ after the mutation');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCanonicalRoleProfile (P1-1): scenario 4 (stale digest) -- a digest captured for a DIFFERENT role is rejected when checked against a DIFFERENT role\'s current template -- proves the comparison is against the CURRENT canonical value for the ADDRESSED role specifically, never a caller-confused/leftover digest from elsewhere', () => {
  assert.strictEqual(typeof rll.resolveCanonicalRoleProfile, 'function', 'precondition: resolveCanonicalRoleProfile must exist');
  const roleARoot = makeMirrorFixtureRoot('# role A content\n', '# role A content\n', 'arch-testing');
  const roleBRoot = makeMirrorFixtureRoot('# role B, totally different content\n', '# role B, totally different content\n', 'toolkit-specialist');
  try {
    let staleDigestFromRoleA;
    withFakeTemplateRoot(roleARoot, () => {
      const roleAResult = rll.resolveCanonicalRoleProfile('arch-testing');
      assert.strictEqual(roleAResult.ok, true, JSON.stringify(roleAResult));
      staleDigestFromRoleA = roleAResult.digest;
    });

    withFakeTemplateRoot(roleBRoot, () => {
      const result = rll.resolveCanonicalRoleProfile('toolkit-specialist', { expectedDigest: staleDigestFromRoleA });
      assert.strictEqual(result.ok, false, JSON.stringify(result));
      assert.strictEqual(result.reason, 'template-digest-drift', 'a stale digest captured for a DIFFERENT role must never validate against this one: ' + JSON.stringify(result));

      // Positive control: the SAME role, checked with its OWN genuinely
      // current digest, succeeds.
      const ownDigestResult = rll.resolveCanonicalRoleProfile('toolkit-specialist');
      assert.strictEqual(ownDigestResult.ok, true, JSON.stringify(ownDigestResult));
      const revalidated = rll.resolveCanonicalRoleProfile('toolkit-specialist', { expectedDigest: ownDigestResult.digest });
      assert.strictEqual(revalidated.ok, true, JSON.stringify(revalidated));
    });
  } finally {
    fs.rmSync(roleARoot, { recursive: true, force: true });
    fs.rmSync(roleBRoot, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// M6+M7 requester-authority closure (2026-08-10, dispatch arch-testing-
// 20260810T074058Z Phase 1): Group A -- Stable RequesterBinding. PLAN.md ~L592:
// "Same tuple+PLAN+worktree returns the same live binding (including wake);
// tuple/PLAN/worktree/role/expiry change mints a new instance." Confirmed by
// direct read: createRequesterBinding (~L1445) unconditionally
// crypto.randomBytes(16)s a BRAND-NEW binding_id AND actor_instance_id on
// EVERY call -- there is no readdir/scan of requester-bindings/ before the
// mint at all, so identical-tuple reuse, concurrent convergence, ambiguity
// fail-closed, and the empty-agent_key rejection below are all currently
// unimplemented.
// ────────────────────────────────────────────────────────────────────────────

function requesterBindingFixtureBase(dir) {
  writePlanFixture(dir, 'rll-registry-groupa');
  const worktreeId = rll.computeWorktreeId(dir);
  const planResult = rll.discoverPlan(dir);
  assert.strictEqual(planResult.ok, true, 'GROUP-A fixture: PLAN must be discoverable: ' + JSON.stringify(planResult));
  return { worktreeId, planDigest: planResult.planDigest };
}

test('createRequesterBinding (GROUP-A): the identical exact tuple {runtime,runtime_session_key,agent_key,role,worktree_id,plan_digest} returns the SAME binding_id and actor_instance_id on a second, SEQUENTIAL call -- never a freshly-minted one', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    // M6+M7 FULL CLOSURE (2026-08-11): codex-supervisor -- this test's own
    // subject (idempotent-mint reuse on an identical tuple) predates and is
    // orthogonal to CLAUDE-ID-01, which scopes ONLY identity.provider==='claude-hook'.
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'groupa-seq-session' };
    const first = rll.createRequesterBinding(dir, identity, 'groupa-seq-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(first.ok, true, 'first mint must succeed: ' + JSON.stringify(first));
    const second = rll.createRequesterBinding(dir, identity, 'groupa-seq-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(second.ok, true, 'second mint (identical tuple) must succeed: ' + JSON.stringify(second));
    assert.strictEqual(
      second.binding.binding_id, first.binding.binding_id,
      'GROUP-A (regression): the identical tuple must return the SAME binding_id on a second call, never a fresh mint -- pre-fix createRequesterBinding always crypto.randomBytes(16)s a brand-new binding_id with zero lookup-or-reuse logic: ' + JSON.stringify({ first: first.binding, second: second.binding })
    );
    assert.strictEqual(
      second.binding.actor_instance_id, first.binding.actor_instance_id,
      'GROUP-A (regression): the identical tuple must ALSO return the SAME actor_instance_id on a second call: ' + JSON.stringify({ first: first.binding, second: second.binding })
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createRequesterBinding (GROUP-A): the identical exact tuple returns the SAME binding_id under two genuinely CONCURRENT calls (two separate racing processes), never two independently-live bindings for one logical actor', async () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    // M6+M7 FULL CLOSURE (2026-08-11): codex-supervisor -- this test's own
    // subject (concurrent-mint convergence) predates and is orthogonal to
    // CLAUDE-ID-01, which scopes ONLY identity.provider==='claude-hook'.
    const script = 'const rll = require(process.argv[4]); '
      + 'const identity = { ok: true, provider: "codex-supervisor", runtime_session_key: "groupa-conc-session" }; '
      + 'const result = rll.createRequesterBinding(process.argv[1], identity, "groupa-conc-agent", "arch-testing", process.argv[2], process.argv[3], 3600); '
      + 'process.stdout.write(JSON.stringify(result));';
    function spawnOnce() {
      return new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', script, dir, worktreeId, planDigest, IMPL], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('error', reject);
        child.on('close', () => {
          try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('GROUP-A concurrent fixture: non-JSON child stdout: ' + out)); }
        });
      });
    }
    const [r1, r2] = await Promise.all([spawnOnce(), spawnOnce()]);
    assert.strictEqual(r1.ok, true, 'concurrent call 1 must succeed: ' + JSON.stringify(r1));
    assert.strictEqual(r2.ok, true, 'concurrent call 2 must succeed: ' + JSON.stringify(r2));
    assert.strictEqual(
      r2.binding.binding_id, r1.binding.binding_id,
      'GROUP-A (regression): two genuinely concurrent calls for the identical tuple must converge on ONE binding_id, never mint two independently-live bindings for one logical actor: ' + JSON.stringify({ r1, r2 })
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createRequesterBinding (GROUP-A): two pre-existing LIVE RequesterBinding records already on disk for the identical exact tuple must fail CLOSED (ok:false) on a subsequent mint-or-lookup call, never silently pick the first / reuse either / mint a third', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    // M6+M7 FULL CLOSURE (2026-08-11): codex-supervisor -- this test's own
    // subject (ambiguity fail-closed) predates and is orthogonal to
    // CLAUDE-ID-01, which scopes ONLY identity.provider==='claude-hook'.
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'groupa-ambig-session' };
    // Simulate the ambiguous state directly: two independently-minted, both
    // genuinely live bindings for the EXACT same tuple already exist on disk
    // (e.g. left over from two racing callers before any fix lands). A
    // second plain constructor call can no longer build this fixture --
    // createRequesterBinding is correctly idempotent now (proven by the
    // sibling GROUP-A test above), so it would just return dupe1 again --
    // the second live duplicate is instead planted directly by cloning
    // dupe1 own durable record to a fresh binding_id/actor_instance_id, the
    // same forge technique the follow-up test below uses.
    const crypto = require('node:crypto');
    const dupe1 = rll.createRequesterBinding(dir, identity, 'groupa-ambig-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(dupe1.ok, true, JSON.stringify(dupe1));
    const dupe1Path = rll.requesterBindingPathFor(dir, dupe1.binding.binding_id);
    const dupe2Obj = JSON.parse(fs.readFileSync(dupe1Path, 'utf8'));
    dupe2Obj.binding_id = crypto.randomBytes(16).toString('hex');
    dupe2Obj.actor_instance_id = crypto.randomBytes(16).toString('hex');
    const dupe2Path = rll.requesterBindingPathFor(dir, dupe2Obj.binding_id);
    fs.writeFileSync(dupe2Path, JSON.stringify(dupe2Obj), { mode: 0o600 });
    fs.chmodSync(dupe2Path, 0o600);
    assert.notStrictEqual(dupe1.binding.binding_id, dupe2Obj.binding_id, 'fixture sanity: this test needs genuinely TWO distinct binding records to exist for the ambiguity to be real');

    const third = rll.createRequesterBinding(dir, identity, 'groupa-ambig-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(
      third.ok, false,
      'GROUP-A (regression): two live exact-match RequesterBindings already existing for this tuple must make a further mint-or-lookup call FAIL CLOSED -- never silently choose the first, reuse either ambiguously, or mint a third fresh one. pre-fix createRequesterBinding never looks up existing bindings at all, so it always just mints yet another fresh one (ok:true): ' + JSON.stringify(third)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createRequesterBinding (GROUP-A): an empty raw agent_id fails CLOSED (ok:false), never accepted as a valid identity for this constructor', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    // M6+M7 FULL CLOSURE (2026-08-11): codex-supervisor -- this test's own
    // subject (empty agent_id shape rejection) predates and is orthogonal to
    // CLAUDE-ID-01, which scopes ONLY identity.provider==='claude-hook'.
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'groupa-emptyagent-session' };
    const result = rll.createRequesterBinding(dir, identity, '', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(
      result.ok, false,
      'GROUP-A (regression): an empty raw agent_id must fail closed -- pre-fix createRequesterBinding only rejects a non-string agentKey (`typeof agentKey !== \'string\'`), so an empty string passes straight through and mints a genuine binding: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M6+M7 requester-authority closure (Group D follow-up, 2026-08-10): the
// empty-agent_id guard above only proves createRequesterBinding itself
// rejects a bad caller -- it says nothing about a durable record that never
// went through that constructor at all (a forged file planted directly on
// disk, or a legacy record from before the constructor guard existed). The
// scan resolveArchitectRequesterBinding (context-provider-gate.js) and every
// other reader run is a boundedly-enumerated readdir over requester-bindings/
// -- validateRequesterBindingFor is the ONLY gate standing between such a
// planted record and being treated as a live, authoritative actor identity.
test('validateRequesterBindingFor (GROUP-A follow-up): a durable RequesterBinding record with agent_key:"" forged directly on disk (bypassing createRequesterBinding own guard) is rejected on READ too, never only at construction', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    // M6+M7 FULL CLOSURE (2026-08-11): codex-supervisor -- this test's own
    // subject (forged agent_key rejected on read) predates and is orthogonal
    // to CLAUDE-ID-01, which scopes ONLY identity.provider==='claude-hook'.
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'groupa-forged-session' };
    const minted = rll.createRequesterBinding(dir, identity, 'groupa-forged-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a genuine binding must mint cleanly before being forged: ' + JSON.stringify(minted));

    // Sanity: the genuinely-minted binding validates fine BEFORE the forge --
    // isolates the assertion below to the forged field alone, never an
    // unrelated fixture gap.
    const beforeForge = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, 'arch-testing', worktreeId, planDigest);
    assert.strictEqual(beforeForge.ok, true, 'fixture sanity: the genuine binding must validate BEFORE the forge: ' + JSON.stringify(beforeForge));

    const recordPath = rll.requesterBindingPathFor(dir, minted.binding.binding_id);
    const raw = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    raw.agent_key = '';
    fs.writeFileSync(recordPath, JSON.stringify(raw), { mode: 0o600 });
    fs.chmodSync(recordPath, 0o600);

    const afterForge = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, 'arch-testing', worktreeId, planDigest);
    assert.strictEqual(
      afterForge.ok, false,
      'a durable RequesterBinding record with agent_key:"" forged directly on disk must fail validation on READ, never only rejected at construction time: ' + JSON.stringify(afterForge)
    );
    assert.strictEqual(afterForge.reason, 'requester-binding-shape-invalid', 'must fail for the shape-invalid reason specifically: ' + JSON.stringify(afterForge));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M6+M7 FINAL AUTHORITY/ORACLE CORRECTION (2026-08-11, RED phase, dispatch
// team-lead "M6+M7 FINAL AUTHORITY/ORACLE CORRECTION"): Group 1 -- CLAUDE-ID-01
// full bounded-proof enforcement. Confirmed by direct read (2026-08-11):
// createRequesterBinding (~L1482, see its own doc-comment block ~L1377-1407)
// mints/reuses a persistent RequesterBinding/v1 using ONLY
// resolveSessionGeneration -- a SINGLE current-hook-observation check -- never
// PLAN.md §15's (~L588/~L592) CLAUDE-ID-01 multi-event trace (SubagentStart,
// two distinct PreToolUse events, one sleep/wake-or-resume boundary, a final
// PreToolUse, stable agent_id throughout, distinct ID for a second same-role
// peer). The minted actor_instance_id is then persisted into request.json's
// requester_instance_id and REUSED by post-PLAN gates
// (resolveArchitectRequesterBinding, context-provider-gate.js) across LATER,
// SEPARATE hook calls -- so the "same-call, no stability needed" doc-comment
// rationale immediately above this section does not hold system-wide.
// maybeWriteProbeCorrelation() (subagent-start-context-bundle.js, confirmed by
// direct read) is a best-effort, non-fatal, model-visible diagnostic write
// under .planning/wave-<slug>/probe-correlation/ -- NOT host-private, NOT
// authoritative, and structurally unrelated to requester-binding minting.
//
// Cases 1-3 below drive the REAL production hooks end to end
// (subagent-start-context-bundle.js for SubagentStart, context-provider-
// gate.js for PreToolUse) via node:child_process.spawnSync -- never
// hand-simulated hook logic -- mirroring this file's own execFileSync/spawn
// conventions and claude-one-shot-binding-red.bats's _cosb_e2e_* real-hook-
// driving precedent. Case 4/7/9b are direct function-level calls against the
// already-exported createRequesterBinding, mirroring this file's own
// established GROUP-A style immediately above. Cases 5/6/8/9a are DISCLOSED,
// not approximated -- see the comment block between cases 4 and 7 below, and
// this session's structured report to team-lead.
// ════════════════════════════════════════════════════════════════════════════

const CLAUDEID01_SUBAGENT_START_HOOK = path.resolve(__dirname, '../../.claude/hooks/subagent-start-context-bundle.js');
const CLAUDEID01_CONTEXT_PROVIDER_GATE_HOOK = path.resolve(__dirname, '../../.claude/hooks/context-provider-gate.js');
const CLAUDEID01_RC_IMPL = path.resolve(__dirname, '../lib/runtime-consultation.cjs');

function claudeId01MakeGitProjectOnWaveBranch(waveSlug) {
  const dir = makeGitProject();
  writePlanFixture(dir, waveSlug);
  execFileSync('git', ['-C', dir, 'checkout', '-q', '-b', 'feature/' + waveSlug]);
  return dir;
}

function claudeId01DriveSubagentStart(dir, agentType, sessionId, agentId) {
  return spawnSync('node', [CLAUDEID01_SUBAGENT_START_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: agentType, session_id: sessionId, agent_id: agentId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }),
    encoding: 'utf8',
  });
}

// Drives a real PreToolUse Bash call recognized by tryInjectRequesterGrant
// (context-provider-gate.js) -- root-init is the simplest REQUESTER_ADMIN_SUBCOMMANDS
// member (a non-transaction administrative subcommand, null request/attempt/epoch
// triple), so this is the minimal real call that reaches createRequesterBinding.
// HARD NO-GO correction (item 8 bullet 1): optional 5th `toolUseId` param --
// cases 1/2/3 below were false-green (this helper originally sent NO
// tool_use_id at all, so recordClaudeId01PreToolUseObservation silently
// no-op'd on every call, and the cases passed vacuously -- the trace never
// completed for ANY reason, never because the specific guard under test
// rejected it). Omitted (the original 4-arg call shape) preserves the exact
// prior no-tool_use_id behavior; supplying a 5th arg is the only change
// cases 1/2/3 needed to genuinely exercise the completion logic.
function claudeId01DrivePreToolUseRootInit(dir, agentType, sessionId, agentId, toolUseId) {
  const coordRoot = path.join(dir, '.planning', 'coordination');
  // findConsultationCliInvocation (context-provider-gate.js) requires the
  // canonical POSIX single-quoted grammar via parsePosixDirect -- a plain
  // concatenated string is never recognized (confirmed empirically: an
  // earlier draft of this helper used raw concatenation and every case
  // relying on it wrongly passed, for the WRONG reason -- tryInjectRequesterGrant
  // returned null/not-applicable because the command never parsed at all, so
  // createRequesterBinding was never even reached). renderPosixDirect is the
  // SAME canonical builder claude-one-shot-binding-red.bats's own
  // COSB-E2E-TARGET-GATE-WRONG-AGENT-TYPE fixture uses for the identical reason.
  const command = rll.renderPosixDirect(['node', CLAUDEID01_RC_IMPL, 'root-init', '--coordination-root', coordRoot]);
  const payload = { tool_name: 'Bash', tool_input: { command }, session_id: sessionId, agent_type: agentType, agent_id: agentId };
  if (typeof toolUseId === 'string' && toolUseId.length > 0) payload.tool_use_id = toolUseId;
  return spawnSync('node', [CLAUDEID01_CONTEXT_PROVIDER_GATE_HOOK], {
    input: JSON.stringify(payload),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }),
    encoding: 'utf8',
  });
}

// SubagentStop driver, mirroring claudeId01DriveSubagentStart's own shape --
// same hook file (subagent-start-context-bundle.js handles both events),
// different hook_event_name. Added for the HARD NO-GO correction's
// SubagentStop-focused regression tests (item 8 bullets 3/5).
function claudeId01DriveSubagentStop(dir, agentType, sessionId, agentId) {
  return spawnSync('node', [CLAUDEID01_SUBAGENT_START_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: agentType, session_id: sessionId, agent_id: agentId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }),
    encoding: 'utf8',
  });
}

// Locates the single primary completed attestation. A conformant capability
// fixture also has peer B's action-scoped raw start record, so "sole file" is
// no longer a valid oracle; the schema is the discriminating property.
function claudeId01FindSoleTraceRecordPath(dir) {
  const tracesDir = path.join(rll.registryRepoDir(dir), 'claude-id01-traces');
  let entries;
  try {
    entries = fs.readdirSync(tracesDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const attestations = entries.filter((e) => {
    if (!e.isFile() || !e.name.endsWith('.json')) return false;
    try { return JSON.parse(fs.readFileSync(path.join(tracesDir, e.name), 'utf8')).schema === rll.CLAUDE_ID01_ATTESTATION_SCHEMA; } catch { return false; }
  });
  assert.strictEqual(attestations.length, 1, 'claudeId01FindSoleTraceRecordPath: expected exactly one completed primary attestation, found: ' + JSON.stringify(attestations.map((e) => e.name)));
  return path.join(tracesDir, attestations[0].name);
}

function claudeId01FindSoleRawTraceRecordPath(dir) {
  const tracesDir = path.join(rll.registryRepoDir(dir), 'claude-id01-traces');
  let entries;
  try {
    entries = fs.readdirSync(tracesDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const traces = entries.filter((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.json')) return false;
    try {
      return JSON.parse(fs.readFileSync(path.join(tracesDir, entry.name), 'utf8')).schema === rll.CLAUDE_ID01_TRACE_SCHEMA;
    } catch {
      return false;
    }
  });
  assert.strictEqual(traces.length, 1, 'expected exactly one raw CLAUDE-ID-01 trace');
  return path.join(tracesDir, traces[0].name);
}

function claudeId01CapabilityRecordPath(dir, sessionId) {
  const generation = rll.peekSessionGeneration(dir, {
    ok: true,
    provider: 'claude-hook',
    runtime_session_key: sessionId,
  });
  assert.strictEqual(generation.ok, true, 'fixture session generation must be live');
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, 'fixture PLAN must resolve');
  return rll.claudeId01CapabilityPathFor(
    dir,
    generation.generationId,
    rll.computeWorktreeId(dir),
    plan.planDigest,
  );
}

// Boundedly scans requester-bindings/ for LIVE (validateRequesterBindingFor-passing)
// records matching the exact {role, worktreeId, planDigest, runtime_session_key,
// agent_key} tuple -- ground truth for the tests below, deliberately NOT reusing
// resolveArchitectRequesterBinding (context-provider-gate.js, itself under test
// elsewhere in this correction) so this helper's own correctness never depends on
// the code under test.
function claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planDigest, sessionKey, agentKey) {
  const bindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
  let entries;
  try {
    entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidateId = entry.name.slice(0, -'.json'.length);
    const result = rll.validateRequesterBindingFor(dir, candidateId, role, worktreeId, planDigest);
    if (!result.ok) continue;
    if (result.binding.runtime_session_key === sessionKey && result.binding.agent_key === agentKey) count += 1;
  }
  return count;
}

// M6+M7 FULL CLOSURE (2026-08-11): local equivalent of context-provider-gate.
// test.js's own primeClaudeId01Trace (confirmed empirically there: this exact
// 5-step sequence produces proof_complete:true, and a real createRequesterBinding
// call for the SAME tuple immediately afterward genuinely succeeds) -- duplicated
// here rather than imported since that file's own helper is a local, non-exported
// function and this file already has its own claudeId01Drive*/hook-driving
// conventions above. Unlike claudeId01DrivePreToolUseRootInit (reused unmodified
// by cases 1-3, whose OWN point is an incomplete trace), this needs an explicit,
// DISTINCT tool_use_id per PreToolUse call -- checkClaudeId01ProofComplete
// requires two DISTINCT tool_use_id observations, and claudeId01DrivePreToolUseRootInit
// sends none at all.
function claudeId01DrivePreToolUseWithId(dir, agentType, sessionId, agentId, toolUseId) {
  return spawnSync('node', [CLAUDEID01_CONTEXT_PROVIDER_GATE_HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'true' }, session_id: sessionId, agent_type: agentType, agent_id: agentId, tool_use_id: toolUseId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }),
    encoding: 'utf8',
  });
}

function mintClaudeId01ProbeAction(dir, agentType, sessionId, suffix) {
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(dir, identity);
  assert.strictEqual(generation.ok, true, 'probe action session generation must resolve');
  const worktreeId = rll.computeWorktreeId(dir);
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, 'probe action PLAN must resolve');
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('claude-id01-probe', agentType, agentType, 'fixture', 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    dir, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(dir), worktreeId,
    plan.planDigest, crypto.createHash('sha256').update('claude-id01-probe-policy:' + suffix).digest('hex'),
    generation.generationId, agentType, payload, expiry,
  );
  assert.strictEqual(minted.ok, true, 'probe action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function primeClaudeId01Trace(dir, agentType, sessionId, agentId) {
  const actionA = mintClaudeId01ProbeAction(dir, agentType, sessionId, 'a-' + agentId);
  const actionB = mintClaudeId01ProbeAction(dir, agentType, sessionId, 'b-' + agentId);
  const peerB = agentId + '-distinct-peer-b';
  rll.recordClaudeId01SubagentStartObservation(dir, { sessionId, agentId, agentType, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(dir, { sessionId, agentId, agentType, toolUseId: 'registry-prime-tu-1-' + sessionId + '-' + agentId });
  rll.recordClaudeId01PreToolUseObservation(dir, { sessionId, agentId, agentType, toolUseId: 'registry-prime-tu-2-' + sessionId + '-' + agentId });
  rll.recordClaudeId01SubagentStartObservation(dir, { sessionId, agentId, agentType, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(dir, { sessionId, agentId, agentType, toolUseId: 'registry-prime-tu-3-' + sessionId + '-' + agentId });
  rll.recordClaudeId01SubagentStartObservation(dir, { sessionId, agentId: peerB, agentType, actionId: actionB });
  const proof = rll.checkClaudeId01ProofComplete(dir, sessionId, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, agentType, agentId);
  assert.strictEqual(proof.ok, true, 'global CLAUDE-ID-01 capability must be complete: ' + JSON.stringify(proof));
}

test('CLAUDE-ID-01 (Group 1, case 1, locking-in): a single SubagentStart plus a single PreToolUse carrying a real, distinct tool_use_id -- the minimal possible trace, falling short of the full multi-event CLAUDE-ID-01 proof -- must NOT be sufficient to mint a persistent RequesterBinding', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('claudeid01-case1');
  try {
    const role = 'arch-testing';
    const sessionId = 'c1-session';
    const agentId = 'c1-agent';
    const startResult = claudeId01DriveSubagentStart(dir, role, sessionId, agentId);
    assert.strictEqual(startResult.status, 0, 'SubagentStart hook must exit 0 (fail-open by contract): ' + startResult.stderr);
    // HARD NO-GO correction (item 8 bullet 1): a REAL, distinct tool_use_id --
    // the prior call here sent none at all, so the PreToolUse observation
    // silently no-op'd and this case passed vacuously (never actually
    // exercising the "one observation is insufficient" claim it makes).
    const preResult = claudeId01DrivePreToolUseRootInit(dir, role, sessionId, agentId, 'case1-tu-1');
    assert.strictEqual(preResult.status, 0, 'PreToolUse hook must exit 0: ' + preResult.stderr);

    const worktreeId = rll.computeWorktreeId(dir);
    const planResult = rll.discoverPlan(dir);
    assert.strictEqual(planResult.ok, true);
    const liveCount = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planResult.planDigest, sessionId, agentId);
    assert.strictEqual(
      liveCount, 0,
      'a single SubagentStart + single genuinely-observed PreToolUse must never be enough to mint a persistent RequesterBinding (PLAN.md ~L588/~L592 requires SubagentStart, TWO distinct PreToolUse events, a sleep/wake-or-resume boundary, and a final PreToolUse) -- subagent_start_count stays at 1 and distinct_pretooluse_before_resume_count stays at 1, both short of the required thresholds (found ' + liveCount + ' live matches)'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (Group 1, case 2, locking-in): SubagentStart plus TWO PreToolUse calls (each carrying a real, distinct tool_use_id) with no sleep/wake-or-resume boundary and no distinguishable "final" PreToolUse -- still short of the full CLAUDE-ID-01 trace -- must NOT be sufficient to mint a persistent RequesterBinding', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('claudeid01-case2');
  try {
    const role = 'arch-testing';
    const sessionId = 'c2-session';
    const agentId = 'c2-agent';
    assert.strictEqual(claudeId01DriveSubagentStart(dir, role, sessionId, agentId).status, 0);
    // Two PreToolUse calls back-to-back, each with a REAL, globally-distinct
    // tool_use_id (HARD NO-GO correction, item 8 bullet 1 -- the prior calls
    // here sent none at all), no sleep/wake boundary between them, and no way
    // to distinguish either as a "final" one -- PLAN.md's own 4-event shape
    // (SubagentStart, 2 PreToolUse, sleep/wake, final PreToolUse) is still absent.
    assert.strictEqual(claudeId01DrivePreToolUseRootInit(dir, role, sessionId, agentId, 'case2-tu-1').status, 0);
    assert.strictEqual(claudeId01DrivePreToolUseRootInit(dir, role, sessionId, agentId, 'case2-tu-2').status, 0);

    const worktreeId = rll.computeWorktreeId(dir);
    const planResult = rll.discoverPlan(dir);
    assert.strictEqual(planResult.ok, true);
    const liveCount = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planResult.planDigest, sessionId, agentId);
    assert.strictEqual(
      liveCount, 0,
      'SubagentStart + two genuinely-observed, distinct PreToolUse calls with no sleep/wake boundary and no distinguishable final PreToolUse must never be enough to mint a persistent RequesterBinding -- distinct_pretooluse_before_resume_count reaches 2, but subagent_start_count stays at 1 (no resume boundary ever occurred), so proof_complete never becomes true (found ' + liveCount + ' live matches)'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (Group 1, case 3, locking-in): the trace changing agent_id mid-sequence (SubagentStart under one agent_id, the following PreToolUse -- carrying a real, distinct tool_use_id -- under a DIFFERENT agent_id, same session/role) must fail closed -- no persistent RequesterBinding for either identity', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('claudeid01-case3');
  try {
    const role = 'arch-testing';
    const sessionId = 'c3-session';
    const startAgentId = 'c3-agent-at-start';
    const preToolUseAgentId = 'c3-DIFFERENT-agent-at-pretooluse';
    assert.strictEqual(claudeId01DriveSubagentStart(dir, role, sessionId, startAgentId).status, 0);
    // HARD NO-GO correction (item 8 bullet 1): a REAL tool_use_id -- the
    // prior call here sent none at all, so recordClaudeId01PreToolUseObservation
    // returned at its own top-level guard clause BEFORE ever reaching the
    // `rec.agent_id !== agentId` stability check this case claims to exercise.
    assert.strictEqual(claudeId01DrivePreToolUseRootInit(dir, role, sessionId, preToolUseAgentId, 'case3-tu-1').status, 0);

    const worktreeId = rll.computeWorktreeId(dir);
    const planResult = rll.discoverPlan(dir);
    assert.strictEqual(planResult.ok, true);
    const liveForOriginal = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planResult.planDigest, sessionId, startAgentId);
    const liveForChanged = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planResult.planDigest, sessionId, preToolUseAgentId);
    assert.strictEqual(
      liveForOriginal + liveForChanged, 0,
      'an agent_id change mid-trace (SubagentStart under one agent_id, a genuinely-observed PreToolUse under a different one) must fail closed -- the stability check discards the WHOLE trace on the agent_id mismatch (found ' + liveForOriginal + ' bindings for the original agent_id, ' + liveForChanged + ' for the changed one)'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (Group 1, case 4): the same raw agent_id in two different runtime sessions is two distinct exact tuples and therefore produces two independent bindings', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sharedAgentId = 'c4-shared-agent-id';
    primeClaudeId01Trace(dir, role, 'c4-peer-1-session', sharedAgentId);
    const identity1 = { ok: true, provider: 'claude-hook', runtime_session_key: 'c4-peer-1-session' };
    const first = rll.createRequesterBinding(dir, identity1, sharedAgentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(first.ok, true, 'fixture: first peer mint must succeed: ' + JSON.stringify(first));

    primeClaudeId01Trace(dir, role, 'c4-peer-2-session', sharedAgentId);
    const identity2 = { ok: true, provider: 'claude-hook', runtime_session_key: 'c4-peer-2-session' };
    const second = rll.createRequesterBinding(dir, identity2, sharedAgentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(second.ok, true, 'a different runtime session is a different exact tuple: ' + JSON.stringify(second));
    assert.notStrictEqual(second.binding.binding_id, first.binding.binding_id);
    assert.notStrictEqual(second.binding.actor_instance_id, first.binding.actor_instance_id);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// HARD NO-GO correction (2026-08-11, item 8 bullet 7): case 5 (one complete,
// stable trace enables exactly one live binding) and case 8 (raw
// session_id/agent_id absent from disk after proof completion) are now
// implemented for real below as genuine tests. The former deferred framing
// was written before
// this session's own earlier work landed the CLAUDE-ID-01 trace-recording/
// validation primitive (recordClaudeId01SubagentStartObservation/
// recordClaudeId01PreToolUseObservation/checkClaudeId01ProofComplete), which
// cases 1-4/7/9b above already exercise for real via primeClaudeId01Trace/the
// exported functions directly.
//
// Case 9a is implemented below against getCapabilityManifest: an advertised
// claude-sendmessage test capability remains unavailable until the current
// generation carries a valid global CLAUDE-ID-01 capability marker.

test('CLAUDE-ID-01 (Group 1, case 5 / positive control): the full correct sequence (SubagentStart -> 2 distinct PreToolUse before resume -> repeated SubagentStart -> 1 more distinct PreToolUse after resume, all for the same agent_id/session) DOES mint exactly one live, valid persistent RequesterBinding -- proves the Group 1 guard rejects only INSUFFICIENT traces, never a genuinely complete one', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'case5-session';
    const agentId = 'case5-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    const before = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planDigest, sessionId, agentId);
    assert.strictEqual(before, 0, 'fixture sanity: no binding exists before the mint call');

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const result = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(result.ok, true, 'a genuinely complete CLAUDE-ID-01 trace must mint successfully: ' + JSON.stringify(result));

    const after = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planDigest, sessionId, agentId);
    assert.strictEqual(after, 1, 'exactly one live binding must exist after a genuinely complete trace mints -- never zero, never more than one');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (Group 1, case 8, locking-in): once a trace completes, the raw session_id and raw agent_id are genuinely absent from the on-disk attestation bytes -- only a redacted digest (never the raw value) is retained, verified against the ACTUAL written bytes, not merely the source object literal', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'case8-raw-session-id-must-not-leak';
    const agentId = 'case8-raw-agent-id-must-not-leak';
    primeClaudeId01Trace(dir, role, sessionId, agentId);

    const recordPath = claudeId01FindSoleTraceRecordPath(dir);
    const rawBytes = fs.readFileSync(recordPath, 'utf8');
    const rec = JSON.parse(rawBytes);
    assert.strictEqual(rec.proof_complete, true, 'fixture sanity: the trace must genuinely complete before checking redaction');
    assert.ok(!rawBytes.includes(sessionId), 'the raw session_id must never appear anywhere in the on-disk attestation bytes: ' + rawBytes);
    assert.ok(!rawBytes.includes(agentId), 'the raw agent_id must never appear anywhere in the on-disk attestation bytes: ' + rawBytes);
    assert.match(rec.agent_digest, /^[0-9a-f]{64}$/, 'the attestation must instead carry a 64-hex agent_digest, proving redaction to a digest, never a raw or absent value');

    // Discriminating check: a DIFFERENT agent_id produces a DIFFERENT digest
    // -- proves agent_digest is a genuine function of agent_id, never a
    // constant placeholder that happens to look digest-shaped.
    const dir2 = makeGitProject();
    try {
      requesterBindingFixtureBase(dir2);
      const differentAgentId = 'case8-a-totally-different-agent-id';
      primeClaudeId01Trace(dir2, role, sessionId, differentAgentId);
      const recordPath2 = claudeId01FindSoleTraceRecordPath(dir2);
      const rec2 = JSON.parse(fs.readFileSync(recordPath2, 'utf8'));
      assert.notStrictEqual(rec2.agent_digest, rec.agent_digest, 'a different agent_id must produce a different agent_digest');
    } finally {
      fs.rmSync(rll.registryRepoDir(dir2), { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A different agent in the same runtime session is also a different exact
// tuple. The global capability proves the host identity mechanism for the
// generation; each RequesterBinding still binds its own observed agent key.
test('CLAUDE-ID-01 (Group 1, case 7, locking-in): a genuinely DIFFERENT agent_id (same session/role/worktree/PLAN) mints a genuinely NEW, independent binding -- pre-existing GROUP-A "different tuple -> different binding" semantics, confirmed still correct; deliberately varies agent_id (not session) to stay clear of case 4\'s own same-agent-id/different-session collision shape entirely', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sharedSession = 'c7-shared-session';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sharedSession };
    // M6+M7 FULL CLOSURE (2026-08-11): this test is case 4's own repurposed
    // complement (same file section, same CLAUDE-ID-01 peer-identity domain,
    // per its own "locking-in" comment block) -- stays claude-hook, primed
    // per-agent_id (two DIFFERENT agent_ids under the SAME session).
    primeClaudeId01Trace(dir, role, sharedSession, 'c7-agent-one');
    const first = rll.createRequesterBinding(dir, identity, 'c7-agent-one', role, worktreeId, planDigest, 3600);
    assert.strictEqual(first.ok, true, JSON.stringify(first));

    primeClaudeId01Trace(dir, role, sharedSession, 'c7-agent-two');
    const second = rll.createRequesterBinding(dir, identity, 'c7-agent-two', role, worktreeId, planDigest, 3600);
    assert.strictEqual(second.ok, true, JSON.stringify(second));
    assert.notStrictEqual(
      second.binding.binding_id, first.binding.binding_id,
      'a genuinely different agent_id must mint a NEW, independent binding_id, never reuse or collide with a different agent\'s binding'
    );
    assert.notStrictEqual(second.binding.actor_instance_id, first.binding.actor_instance_id, 'and a different actor_instance_id too');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (Group 1, case 9b, RED): a RequesterBinding minted with genuinely ZERO CLAUDE-ID-01 proof (no SubagentStart/PreToolUse trace of any kind backs this call -- a bare, in-process constructor call, the SAME "zero live hook trace" shape context-provider-gate.test.js\'s own buildCanonicalAcceptedConsultation fixture uses for its confirmed-PASSING GROUPB-CANONICAL-CHAIN-1/PP1 positive-authority tests, which mint a requester binding this exact way and then successfully authorize pattern-discovery access -- including the internal-validate grant path, mintInternalValidateGrant, which mints through this SAME primitive -- through it) must be rejected -- PLAN.md ~L588 gates persistent native-hook requester-binding creation behind CLAUDE-ID-01 entirely', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'c9b-zero-trace-session' };
    const bindingResult = rll.createRequesterBinding(dir, identity, 'c9b-zero-trace-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(
      bindingResult.ok, false,
      'CLAUDE-ID-01 (regression, case 9b): minting a persistent RequesterBinding with genuinely ZERO CLAUDE-ID-01 proof must fail closed once the gate is enforced (this exact zero-trace shape is what backs both resolveArchitectRequesterBinding validation AND mintInternalValidateGrant/validateViaConsultationCli\'s internal validate grant today, per context-provider-gate.test.js\'s own currently-PASSING GROUPB-CANONICAL-CHAIN-1/PP1 fixtures) -- pre-fix createRequesterBinding has no CLAUDE-ID-01 awareness at all and mints unconditionally: ' + JSON.stringify(bindingResult)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// HARD NO-GO correction (2026-08-11, item 8 bullets 3/4/5/6): regression tests
// for the collision/rotation/revocation/attestation-shape defects Codex's
// review found in the Group 1 primitive above. Written to encode the
// CORRECT, post-fix behavior described in the correction spec's items 1/2/4 --
// captured RED against the CURRENT (still-buggy) production bytes per this
// pass's own RED-first discipline. No production changes here -- see the
// correction spec's own items 1/2/4 for what toolkit-specialist implements.
// Deliberately do NOT call claudeId01RecordPathFor/claudeId01LockDirFor with
// today's sessionId-keyed signature anywhere below -- item 1/3's fix reworks
// that lookup-key formula, so a test hardcoding today's call shape would
// silently break the moment the signature changes. claudeId01FindSoleTraceRecordPath
// (directory-scan based) and the frozen-signature functions
// (checkClaudeId01ProofComplete/createRequesterBinding/validateRequesterBindingFor,
// explicitly unchanged per the correction spec's own item 1) are used instead.
// ════════════════════════════════════════════════════════════════════════════

test('CLAUDE-ID-01 (item 1 regression, RED): two DIFFERENT same-role peers (distinct agent_id, same session/role/worktree/PLAN) both complete their own trace and BOTH remain independently live/valid via validateRequesterBindingFor AFTER both complete -- proves peer B completing does not silently invalidate peer A\'s already-minted binding', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sharedSession = 'item1-shared-session';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sharedSession };

    primeClaudeId01Trace(dir, role, sharedSession, 'item1-peer-a');
    const peerA = rll.createRequesterBinding(dir, identity, 'item1-peer-a', role, worktreeId, planDigest, 3600);
    assert.strictEqual(peerA.ok, true, 'peer A must mint successfully after its own complete trace: ' + JSON.stringify(peerA));
    const peerAValidBeforePeerB = rll.validateRequesterBindingFor(dir, peerA.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(peerAValidBeforePeerB.ok, true, 'fixture sanity: peer A validates immediately after its own mint');

    // Peer B (a genuinely DIFFERENT agent_id, same session/role) now primes
    // its OWN complete trace -- item 1's bug: recordClaudeId01SubagentStartObservation's
    // primary-SubagentStart branch OVERWRITES whatever occupies this exact
    // {session,worktree,plan,role} slot the moment it sees a DIFFERENT
    // agent_digest already there, destroying peer A's already-completed
    // attestation before peer B's own trace even begins.
    primeClaudeId01Trace(dir, role, sharedSession, 'item1-peer-b');
    const peerB = rll.createRequesterBinding(dir, identity, 'item1-peer-b', role, worktreeId, planDigest, 3600);
    assert.strictEqual(peerB.ok, true, 'peer B must ALSO mint successfully after its own complete trace: ' + JSON.stringify(peerB));
    assert.notStrictEqual(peerA.binding.binding_id, peerB.binding.binding_id, 'fixture sanity: peer A and peer B must be genuinely different bindings');

    const peerAValidAfterPeerB = rll.validateRequesterBindingFor(dir, peerA.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(
      peerAValidAfterPeerB.ok, true,
      'CLAUDE-ID-01 (regression, item 1): peer A\'s already-minted, already-valid binding must remain valid after peer B (a genuinely different agent_id, same session/role) completes ITS OWN trace -- pre-fix the single {session,worktree,plan,role} lookup key has no agent dimension, so peer B\'s primary SubagentStart overwrites peer A\'s completed attestation on disk, and validateRequesterBindingFor\'s own per-read checkClaudeId01ProofComplete re-check then finds an attestation whose agent_digest no longer matches peer A\'s agentKey, silently invalidating a binding that was never itself touched: ' + JSON.stringify(peerAValidAfterPeerB)
    );
    const peerBValidAfterBoth = rll.validateRequesterBindingFor(dir, peerB.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(peerBValidAfterBoth.ok, true, 'peer B must also remain valid: ' + JSON.stringify(peerBValidAfterBoth));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (item 1 regression, RED): peer A\'s SubagentStop deletes ONLY peer A\'s own CLAUDE-ID-01 trace/attestation slot -- peer B (a genuinely different agent_id, same session/role) stays fully unaffected and its own already-minted binding remains valid', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sharedSession = 'item1-stop-shared-session';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sharedSession };

    primeClaudeId01Trace(dir, role, sharedSession, 'item1-stop-peer-a');
    const peerA = rll.createRequesterBinding(dir, identity, 'item1-stop-peer-a', role, worktreeId, planDigest, 3600);
    assert.strictEqual(peerA.ok, true, JSON.stringify(peerA));

    primeClaudeId01Trace(dir, role, sharedSession, 'item1-stop-peer-b');
    const peerB = rll.createRequesterBinding(dir, identity, 'item1-stop-peer-b', role, worktreeId, planDigest, 3600);
    assert.strictEqual(peerB.ok, true, JSON.stringify(peerB));

    const stopResult = claudeId01DriveSubagentStop(dir, role, sharedSession, 'item1-stop-peer-a');
    assert.strictEqual(stopResult.status, 0, 'SubagentStop hook must exit 0: ' + stopResult.stderr);

    const peerBStillValid = rll.validateRequesterBindingFor(dir, peerB.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(
      peerBStillValid.ok, true,
      'CLAUDE-ID-01 (regression, item 1): stopping peer A must NEVER revoke peer B\'s (a genuinely different agent_id) own proof -- pre-fix deleteClaudeId01TraceForSession takes no agent dimension at all and unlinks the SAME shared {session,worktree,plan,role} path regardless of which peer is stopping, so peer A\'s stop deletes whatever currently occupies that slot (by this point, peer B\'s own completed attestation, since peer B primed AFTER peer A and overwrote it there): ' + JSON.stringify(peerBStillValid)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (items 1/3 regression, RED): rotating session_generation_id for an already-proven claude-hook identity invalidates its existing CLAUDE-ID-01 proof -- validateRequesterBindingFor now fails closed, and a fresh createRequesterBinding call (without re-priming a trace under the NEW generation) never reuses the stale binding', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'rotation-session';
    const agentId = 'rotation-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: the binding must genuinely mint before rotation: ' + JSON.stringify(minted));
    const beforeRotation = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(beforeRotation.ok, true, 'fixture sanity: the binding validates BEFORE rotation');

    // Simulate generation rotation -- the SAME established technique this
    // file's own 'resolveSessionGeneration: an EXPIRED session record is
    // treated as absent and a fresh generation_id is minted' test uses:
    // directly age the on-disk session-generation record past its TTL, so
    // the NEXT resolution mints a genuinely fresh generation_id.
    const genRecPath = rll.sessionGenerationPathFor(dir, identity);
    const genRec = JSON.parse(fs.readFileSync(genRecPath, 'utf8'));
    genRec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(genRecPath, 0o600);
    fs.writeFileSync(genRecPath, JSON.stringify(genRec), { mode: 0o600 });

    const afterRotation = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(
      afterRotation.ok, false,
      'CLAUDE-ID-01 (regression, items 1/3): a rotated session_generation_id must invalidate the existing CLAUDE-ID-01 proof (and therefore the RequesterBinding gated behind it) -- pre-fix neither the CLAUDE-ID-01 attestation nor REQUESTER_BINDING_KEYS reference session_generation_id anywhere, so rotation has zero effect on validateRequesterBindingFor: ' + JSON.stringify(afterRotation)
    );

    // A fresh mint-or-lookup call for the IDENTICAL tuple, post-rotation,
    // without re-priming a trace under the new generation, must never reuse
    // the now-stale binding either.
    const afterRotationMintAttempt = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(
      afterRotationMintAttempt.ok, false,
      'CLAUDE-ID-01 (regression, items 1/3): a fresh createRequesterBinding call for the identical tuple after rotation, with no NEW trace primed under the rotated generation, must never reuse the stale (now-unproven) binding -- pre-fix it does, since validateRequesterBindingFor still wrongly reports it live: ' + JSON.stringify(afterRotationMintAttempt)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 generation recovery: an absent session-generation record cannot resurrect an old same-tuple RequesterBinding', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'absent-generation-session';
    const agentId = 'absent-generation-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const g1 = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(g1.ok, true, 'G1 binding must mint');
    const oldGeneration = rll.peekSessionGeneration(dir, identity);
    assert.strictEqual(oldGeneration.ok, true, 'G1 generation must exist');

    fs.unlinkSync(rll.sessionGenerationPathFor(dir, identity));
    const replacement = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(replacement.ok, true, 'replacement generation must mint');
    assert.notStrictEqual(replacement.generationId, oldGeneration.generationId, 'replacement must be a new generation');
    const stale = rll.validateRequesterBindingFor(dir, g1.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(stale.ok, false, 'G1 binding must remain invalid after absent-record recovery: ' + JSON.stringify(stale));

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const g2 = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(g2.ok, true, 'G2 binding must mint after fresh proof');
    assert.notStrictEqual(g2.binding.binding_id, g1.binding.binding_id, 'G2 must not reuse G1 binding_id');
    assert.notStrictEqual(g2.binding.actor_instance_id, g1.binding.actor_instance_id, 'G2 must not reuse G1 actor_instance_id');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (SubagentStop, locking-in): a SubagentStop for a session/role with NO CLAUDE-ID-01 trace/attestation on disk at all is a silent no-op -- exits 0, never blocks', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('claudeid01-stop-noop');
  try {
    const role = 'arch-testing';
    const sessionId = 'stop-noop-session';
    const agentId = 'stop-noop-agent';
    const result = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
    assert.strictEqual(result.status, 0, 'a SubagentStop with no matching trace must exit 0: ' + result.stderr);
    let parsed = null;
    try { parsed = JSON.parse((result.stdout || '').trim()); } catch { /* no stdout at all is also a valid no-op shape */ }
    assert.ok(!parsed || parsed.decision !== 'block', 'must never block for a genuinely missing record: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (item 4 regression, RED): an injected unlink failure during SubagentStop\'s CLAUDE-ID-01 trace deletion must block the stop (real enforcement), never silently pass -- mirrors this suite\'s own established ClaudeOneShotBinding retirement-failure fault-injection precedent (claude-one-shot-binding-red.bats COSB-E2E-SUBAGENTSTOP-RETIREMENT-FAILURE-BLOCKS)', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('claudeid01-stop-unlink-fail');
  try {
    const role = 'arch-testing';
    const sessionId = 'stop-unlinkfail-session';
    const agentId = 'stop-unlinkfail-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const recordPath = claudeId01FindSoleTraceRecordPath(dir);
    const tracesDir = path.dirname(recordPath);
    const originalMode = fs.statSync(tracesDir).mode & 0o777;
    fs.chmodSync(tracesDir, 0o500); // read+execute only -- unlink requires write permission on the containing directory.
    try {
      const stopResult = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
      assert.strictEqual(stopResult.status, 0, 'SubagentStop must still exit 0 per the official hook protocol (block is expressed via the JSON decision field, never a nonzero exit): ' + stopResult.stderr);
      let parsed = null;
      try { parsed = JSON.parse((stopResult.stdout || '').trim()); } catch { /* handled by the assertion below */ }
      assert.ok(
        parsed && parsed.decision === 'block',
        'CLAUDE-ID-01 (regression, item 4): a genuine unlink failure while deleting the CLAUDE-ID-01 trace must block the stop -- pre-fix deleteClaudeId01TraceForSession swallows ANY unlink failure silently (try{fs.unlinkSync}catch{}) and handleSubagentStop never even inspects its return value, so the stop always silently exits 0 with no decision field regardless: ' + JSON.stringify(stopResult)
      );
    } finally {
      fs.chmodSync(tracesDir, originalMode);
    }
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 attestation validator: an extra key is rejected even after the generation capability has already been sealed', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item2-extrakey-session';
    const agentId = 'item2-extrakey-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const recordPath = claudeId01FindSoleTraceRecordPath(dir);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.strictEqual(rec.proof_complete, true, 'fixture sanity: a genuinely complete attestation must exist before tampering');
    rec.unexpected_extra_field = 'x';
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

    assert.strictEqual(rll.isClaudeId01AttestationWellFormed(rec), false);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 attestation validator: a malformed count field is rejected', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item2-malformed-session';
    const agentId = 'item2-malformed-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const recordPath = claudeId01FindSoleTraceRecordPath(dir);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    rec.subagent_start_count = 'not-a-number';
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

    assert.strictEqual(rll.isClaudeId01AttestationWellFormed(rec), false);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 (item 2 regression, RED): the SAME tool_use_id observed in BOTH the before-resume and after-resume buckets satisfies the bucket-length thresholds with only 2 GLOBALLY-distinct ids, not the required 3 -- the global event-ID uniqueness gap', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item2-global-dedup-session';
    const agentId = 'item2-global-dedup-agent';
    const actionA = mintClaudeId01ProbeAction(dir, role, sessionId, 'dedup-a');
    const actionB = mintClaudeId01ProbeAction(dir, role, sessionId, 'dedup-b');
    const observedBase = { sessionId, agentId, agentType: role, actionId: actionA };
    rll.recordClaudeId01SubagentStartObservation(dir, observedBase);
    rll.recordClaudeId01PreToolUseObservation(dir, Object.assign({}, observedBase, { toolUseId: 'shared-id' }));
    rll.recordClaudeId01SubagentStartObservation(dir, {
      sessionId,
      agentId: agentId + '-peer-b',
      agentType: role,
      actionId: actionB,
    });
    rll.recordClaudeId01PreToolUseObservation(dir, Object.assign({}, observedBase, { toolUseId: 'genuinely-distinct-before-id' }));
    rll.recordClaudeId01SubagentStartObservation(dir, observedBase); // resume boundary
    // Replays 'shared-id' (already used in the before-resume bucket) instead
    // of a genuinely NEW third id -- only 2 globally-distinct ids total.
    rll.recordClaudeId01PreToolUseObservation(dir, Object.assign({}, observedBase, { toolUseId: 'shared-id' }));

    const result = rll.checkClaudeId01ProofComplete(dir, sessionId, worktreeId, planDigest, role, agentId);
    assert.strictEqual(
      result.ok, false,
      'CLAUDE-ID-01 (regression, item 2): a replayed tool_use_id counted across BOTH buckets must never satisfy the proof -- only 2 globally-distinct ids were ever observed here, short of the 3 genuinely distinct ids PLAN.md ~L592 requires -- pre-fix recordClaudeId01PreToolUseObservation\'s dedup only checks WITHIN one bucket (existingIds.includes(toolUseId)), so bucket LENGTHS alone (2 before, 1 after) satisfy proofComplete regardless of global distinctness: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 capability expiry: a fresh valid probe can replace an expired generation capability', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'expiry-reaccredit-session';
    const agentId = 'expiry-reaccredit-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const recordPath = claudeId01CapabilityRecordPath(dir, sessionId);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.strictEqual(rec.proof_complete, true, 'fixture sanity: a genuinely complete capability must exist before aging it');
    rec.expiry = '2000-01-01T00:00:00Z';
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

    const beforeReaccredit = rll.checkClaudeId01ProofComplete(dir, sessionId, worktreeId, planDigest, role, agentId);
    assert.strictEqual(beforeReaccredit.ok, false, 'fixture sanity: the aged attestation must genuinely read as expired first');
    assert.strictEqual(beforeReaccredit.reason, 'claude-id01-capability-invalid');

    // The SAME agent_id, SAME session, genuinely re-primes a brand new trace
    // from scratch after the old one expired.
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const afterReaccredit = rll.checkClaudeId01ProofComplete(dir, sessionId, worktreeId, planDigest, role, agentId);
    assert.strictEqual(
      afterReaccredit.ok, true,
      'a fresh valid probe must replace an expired generation capability: ' + JSON.stringify(afterReaccredit)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
// arch-testing-20260811T162225Z): items 1/2/3/4/10 + Section B/C. Frozen spec
// text (Spanish, preserved verbatim in the dispatch) translated directly into
// test code below, never reinterpreted. Every test drives the REAL production
// primitives this file already established the convention for (primeClaudeId01Trace,
// claudeId01FindSoleTraceRecordPath, requesterBindingFixtureBase) -- no new
// fixture mechanism invented. Pre-existing coverage checked first (see the
// task's own report for the per-item breakdown); every test below targets a
// property confirmed NOT already covered by this file's own pre-existing 90
// tests (all 90 independently re-run and confirmed passing before any of the
// below was added).
// ════════════════════════════════════════════════════════════════════════════

// Item 1 (Section B: "G1 binding -> rotación G2 -> nueva acreditación: binding
// G1 continúa inválido; createRequesterBinding no lo reutiliza; binding G2
// tiene binding_id y actor_instance_id nuevos"). The pre-existing "items 1/3
// regression, RED" test (above) already proves the FIRST two clauses (G1
// invalid after rotation; a mint attempt WITHOUT re-priming under G2 fails).
// It never continues on to actually re-prime a genuine G2 trace and mint --
// this test is that continuation, and is the one that proves the THIRD clause.
test('CLAUDE-ID-01/Section B (item 1, RED): after G1 is invalidated by session-generation rotation, a FRESH trace completed under the live (G2) generation for the IDENTICAL session_id/agent_id/role/worktree/PLAN mints a binding with a NEW binding_id and actor_instance_id -- never G1\'s own ids', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item1-g2-reaccredit-session';
    const agentId = 'item1-g2-reaccredit-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const g1 = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(g1.ok, true, 'fixture: G1 binding must mint before rotation: ' + JSON.stringify(g1));

    // Rotate: age the session-generation record so the NEXT resolution mints
    // a genuinely fresh generation_id (G2) -- same technique this file's own
    // 'resolveSessionGeneration: an EXPIRED session record...' test uses.
    const genRecPath = rll.sessionGenerationPathFor(dir, identity);
    const genRec = JSON.parse(fs.readFileSync(genRecPath, 'utf8'));
    genRec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(genRecPath, 0o600);
    fs.writeFileSync(genRecPath, JSON.stringify(genRec), { mode: 0o600 });

    // A genuinely NEW, complete CLAUDE-ID-01 trace for the IDENTICAL
    // session_id/agent_id/role, now resolving under the rotated (G2) generation.
    primeClaudeId01Trace(dir, role, sessionId, agentId);

    const g2 = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(g2.ok, true, 'a genuinely complete CLAUDE-ID-01 trace under G2 must mint successfully: ' + JSON.stringify(g2));
    assert.notStrictEqual(
      g2.binding.binding_id, g1.binding.binding_id,
      'Section B (item 1, RED): the binding minted under G2 must have a genuinely NEW binding_id, distinct from G1\'s own -- pre-fix checkClaudeId01ProofComplete resolves the CURRENT live generation from runtime_session_key alone (never pinned to the specific generation a given binding was originally minted under: it calls peekSessionGeneration(sessionId) fresh every time), so the moment G2\'s own independent trace completes, G1\'s OLD (still within its own un-rotated 3600s TTL) binding record wrongly re-validates as CLAUDE-ID-01-proof-complete too, and createRequesterBinding\'s exact-tuple-match reuse logic then happily returns G1\'s OLD binding unchanged rather than minting a genuinely new one: ' + JSON.stringify({ g1: g1.binding, g2: g2.binding })
    );
    assert.notStrictEqual(
      g2.binding.actor_instance_id, g1.binding.actor_instance_id,
      'Section B (item 1, RED): the binding minted under G2 must ALSO carry a NEW actor_instance_id, distinct from G1\'s own: ' + JSON.stringify({ g1: g1.binding, g2: g2.binding })
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Item 2 (Section B: "Mismo tuple/generación reutiliza; session distinta crea
// un binding nuevo y no una colisión"). Test A: the FIRST clause, proven for a
// claude-hook identity specifically -- this file's own pre-existing GROUP-A
// reuse tests (sequential/concurrent/ambiguous-duplicate/empty-agent-key) all
// use codex-supervisor, which is never CLAUDE-ID-01-gated at all, so the
// reuse-for-identical-live-tuple invariant has never actually been exercised
// together with the CLAUDE-ID-01 gate in the SAME call.
test('createRequesterBinding (Section B, item 2): the SAME exact claude-hook tuple, with a genuinely complete CLAUDE-ID-01 proof and a still-live generation, reuses the SAME binding_id/actor_instance_id on a second call -- GROUP-A\'s own exact-tuple reuse invariant, now proven for a claude-hook identity specifically', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item2-reuse-session';
    const agentId = 'item2-reuse-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const first = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(first.ok, true, 'first mint must succeed: ' + JSON.stringify(first));

    const second = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(second.ok, true, 'second mint-or-lookup call for the identical tuple must succeed: ' + JSON.stringify(second));
    assert.strictEqual(
      second.binding.binding_id, first.binding.binding_id,
      'Section B (item 2): the identical exact claude-hook tuple, same live generation, must reuse the SAME binding_id, never mint a fresh one: ' + JSON.stringify({ first: first.binding, second: second.binding })
    );
    assert.strictEqual(second.binding.actor_instance_id, first.binding.actor_instance_id, 'and the SAME actor_instance_id too');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A different runtime session is a different exact identity tuple. Expiring
// one generation's capability invalidates only that generation; a second
// session can independently prove capability and mint its own binding.
test('createRequesterBinding (Section B, item 2): a different session using the same agent_key mints an independent binding after its own capability proof', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sharedAgentId = 'item2-diffsession-shared-agent';

    primeClaudeId01Trace(dir, role, 'item2-diffsession-session-one', sharedAgentId);
    const identity1 = { ok: true, provider: 'claude-hook', runtime_session_key: 'item2-diffsession-session-one' };
    const first = rll.createRequesterBinding(dir, identity1, sharedAgentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(first.ok, true, 'fixture: first peer must mint: ' + JSON.stringify(first));

    // Expire the first SESSION GENERATION'S global capability, not one
    // agent-scoped source attestation. Bindings consume the generation
    // capability by design.
    const firstRecordPath = claudeId01CapabilityRecordPath(dir, 'item2-diffsession-session-one');
    const firstRec = JSON.parse(fs.readFileSync(firstRecordPath, 'utf8'));
    assert.strictEqual(firstRec.proof_complete, true, 'fixture sanity: the first generation capability must be complete before aging it');
    firstRec.expiry = '2000-01-01T00:00:00Z';
    fs.chmodSync(firstRecordPath, 0o600);
    fs.writeFileSync(firstRecordPath, JSON.stringify(firstRec), { mode: 0o600 });

    const stillLiveCountBefore = claudeId01CountLiveBindingsForTuple(dir, role, worktreeId, planDigest, 'item2-diffsession-session-one', sharedAgentId);
    assert.strictEqual(stillLiveCountBefore, 0, 'fixture sanity: the first peer\'s own binding must no longer validate as live once its attestation has expired');

    // A genuinely DIFFERENT session, same agent_key, completes its OWN fresh proof.
    primeClaudeId01Trace(dir, role, 'item2-diffsession-session-two', sharedAgentId);
    const identity2 = { ok: true, provider: 'claude-hook', runtime_session_key: 'item2-diffsession-session-two' };
    const second = rll.createRequesterBinding(dir, identity2, sharedAgentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(
      second.ok, true,
      'a genuinely different session with its own valid capability must mint independently: ' + JSON.stringify(second)
    );
    assert.notStrictEqual(second.binding.binding_id, first.binding.binding_id, 'the new binding must be genuinely independent of the first, now-stale one');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Item 3 (Section C: "Raw trace con missing/extra keys, arrays precargados o
// contadores falsos no puede promocionarse con un único PreToolUse"). Confirmed
// by direct read: recordClaudeId01PreToolUseObservation's own raw-trace read
// path checks ONLY `rec.schema !== CLAUDE_ID01_TRACE_SCHEMA` before trusting
// rec.subagent_start_count/tool_use_ids_before_resume/tool_use_ids_after_resume
// verbatim (the arrays are merely Array.isArray-defaulted, never validated for
// content/pre-loading) to decide `proofComplete` -- there is no
// isClaudeId01AttestationWellFormed-style closed-shape check anywhere on this
// READ path, only on the separate, later, completed-attestation READ path
// (checkClaudeId01ProofComplete).
test('CLAUDE-ID-01 (Section C / item 3, RED): a raw trace record forged directly on disk with PRE-LOADED tool_use_id arrays and an inflated subagent_start_count (already at/above the completion thresholds, despite genuinely only ONE real SubagentStart ever having been observed) is wrongly promoted to a complete attestation by a SINGLE additional, genuinely-observed PreToolUse call', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item3-forged-raw-trace-session';
    const agentId = 'item3-forged-raw-trace-agent';

    // A single, action-correlated SubagentStart establishes the real raw
    // trace. The production hook never guesses an action by role/order.
    const actionId = mintClaudeId01ProbeAction(dir, role, sessionId, 'forged-raw');
    rll.recordClaudeId01SubagentStartObservation(dir, {
      sessionId,
      agentId,
      agentType: role,
      actionId,
    });

    const recordPath = claudeId01FindSoleRawTraceRecordPath(dir);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.strictEqual(rec.schema, 'runtime/claude-id01-trace/v1', 'fixture sanity: a genuine RAW (not yet complete) trace record must exist after a single SubagentStart');
    assert.strictEqual(rec.subagent_start_count, 1, 'fixture sanity: only ONE real SubagentStart has occurred so far');

    // Forge the raw trace: pre-load BOTH tool_use_id buckets already at/above
    // threshold, an already-2 subagent_start_count (claiming a wake/resume
    // boundary that never genuinely happened), and mark it resumed -- none of
    // this was ever genuinely, incrementally observed.
    rec.subagent_start_count = 2;
    rec.resumed = true;
    rec.tool_use_ids_before_resume = ['forged-before-1', 'forged-before-2'];
    rec.tool_use_ids_after_resume = [];
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

    // ONE further, genuinely-observed PreToolUse -- this alone (given the
    // forged counts above already satisfy every threshold) completes the
    // "proof" today.
    const preResult = claudeId01DrivePreToolUseRootInit(dir, role, sessionId, agentId, 'item3-forged-real-tu-1');
    assert.strictEqual(preResult.status, 0);

    const afterRec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.notStrictEqual(
      afterRec.proof_complete, true,
      'Section C (item 3, RED): a raw trace record forged with pre-loaded tool_use_id arrays and an inflated subagent_start_count -- never genuinely, incrementally observed -- must NEVER be promotable to a complete attestation via a single additional real PreToolUse call. pre-fix recordClaudeId01PreToolUseObservation only checks rec.schema===CLAUDE_ID01_TRACE_SCHEMA before trusting the forged fields verbatim to decide proofComplete: ' + JSON.stringify(afterRec)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Item 4 (Section C: "Attestation con count enorme, completed_at futuro o
// completed_at>expiry es rechazada en ambos consumidores"). Confirmed by
// direct read of isClaudeId01AttestationWellFormed: counts are checked with a
// LOWER bound only (`< 2`, `< 1`), never an upper one; completed_at is never
// compared against the current clock anywhere; completed_at<=expiry is
// DELIBERATELY not checked there (its own comment: "Deliberately NOT
// completedMs<=expiryMs here"), and checkClaudeId01ProofComplete's own
// separate expiry check only ever compares expiry-vs-now, never
// completed_at-vs-expiry. "Ambos consumidores" (both consumers) = the two call
// sites of checkClaudeId01ProofComplete inside this file: the MINT-time path
// (createRequesterBinding, exercised here directly via
// checkClaudeId01ProofComplete itself) and the VALIDATE-time path
// (validateRequesterBindingFor, re-checked on every read) -- each of the three
// tests below drives BOTH against the identical tampered attestation.
test('CLAUDE-ID-01 capability validator: an enormous primary observation count is rejected by both binding consumers', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item4-enormous-count-session';
    const agentId = 'item4-enormous-count-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a genuine binding must mint before tampering: ' + JSON.stringify(minted));

    const recordPath = claudeId01CapabilityRecordPath(dir, sessionId);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.strictEqual(rec.proof_complete, true, 'fixture sanity: a genuinely complete capability must exist before tampering');
    rec.primary_pretooluse_before_count = Number.MAX_SAFE_INTEGER;
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

    const mintPathResult = rll.checkClaudeId01ProofComplete(dir, sessionId, worktreeId, planDigest, role, agentId);
    assert.notStrictEqual(
      mintPathResult.ok, true,
      'Section C (item 4, RED), mint-time consumer: an attestation with an enormous subagent_start_count must be rejected -- pre-fix isClaudeId01AttestationWellFormed only enforces a LOWER bound (< 2) on every count field, never an upper one: ' + JSON.stringify(mintPathResult)
    );
    const validatePathResult = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.notStrictEqual(
      validatePathResult.ok, true,
      'Section C (item 4, RED), validate-time consumer: the SAME already-minted binding must ALSO fail re-validation once its backing attestation carries an enormous count: ' + JSON.stringify(validatePathResult)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 capability validator: a future completed_at is rejected by both binding consumers', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item4-future-completed-session';
    const agentId = 'item4-future-completed-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a genuine binding must mint before tampering: ' + JSON.stringify(minted));

    const recordPath = claudeId01CapabilityRecordPath(dir, sessionId);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.strictEqual(rec.proof_complete, true, 'fixture sanity: a genuinely complete attestation must exist before tampering');
    // Far in the future, but still comfortably BEFORE the record's own expiry
    // (created_at<=completed_at still holds too) -- isolates "completed_at
    // must not be in the future" from the separate created_at<=completed_at
    // and completed_at<=expiry checks.
    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    rec.completed_at = farFuture;
    rec.expiry = new Date(Date.parse(farFuture) + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

    const mintPathResult = rll.checkClaudeId01ProofComplete(dir, sessionId, worktreeId, planDigest, role, agentId);
    assert.notStrictEqual(
      mintPathResult.ok, true,
      'Section C (item 4, RED), mint-time consumer: an attestation whose completed_at is in the future must be rejected -- pre-fix neither isClaudeId01AttestationWellFormed nor checkClaudeId01ProofComplete ever compares completed_at against the current clock at all (only created_at<=completed_at ORDER is checked, and expiry-vs-now separately): ' + JSON.stringify(mintPathResult)
    );
    const validatePathResult = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.notStrictEqual(
      validatePathResult.ok, true,
      'Section C (item 4, RED), validate-time consumer: the SAME already-minted binding must ALSO fail re-validation once its backing attestation claims a future completed_at: ' + JSON.stringify(validatePathResult)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE-ID-01 capability validator: completed_at after expiry is rejected by both binding consumers', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'item4-completed-after-expiry-session';
    const agentId = 'item4-completed-after-expiry-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a genuine binding must mint before tampering: ' + JSON.stringify(minted));

    const recordPath = claudeId01CapabilityRecordPath(dir, sessionId);
    const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.strictEqual(rec.proof_complete, true, 'fixture sanity: a genuinely complete attestation must exist before tampering');
    const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const completedAfterExpiry = new Date(Date.now() + 7200 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    rec.expiry = futureExpiry;
    rec.completed_at = completedAfterExpiry;
    fs.chmodSync(recordPath, 0o600);
    fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });
    assert.ok(Date.parse(rec.completed_at) > Date.parse(rec.expiry), 'fixture sanity: completed_at must genuinely exceed expiry');
    assert.ok(Date.parse(rec.expiry) > Date.now(), 'fixture sanity: expiry must still be in the future (isolates from the separate now>=expiry check)');

    const mintPathResult = rll.checkClaudeId01ProofComplete(dir, sessionId, worktreeId, planDigest, role, agentId);
    assert.notStrictEqual(
      mintPathResult.ok, true,
      'Section C (item 4, RED), mint-time consumer: an attestation whose completed_at exceeds its own expiry must be rejected -- pre-fix isClaudeId01AttestationWellFormed deliberately checks ONLY created_at<=completed_at, never completed_at<=expiry (its own doc comment: "Deliberately NOT completedMs<=expiryMs here"), and checkClaudeId01ProofComplete\'s own separate expiry check only compares expiry against NOW, never against completed_at: ' + JSON.stringify(mintPathResult)
    );
    const validatePathResult = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.notStrictEqual(
      validatePathResult.ok, true,
      'Section C (item 4, RED), validate-time consumer: the SAME already-minted binding must ALSO fail re-validation once its backing attestation claims completed_at after its own expiry: ' + JSON.stringify(validatePathResult)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Item 10 / Case 9a: even the test-only fake-capability seam must not advertise
// claude-sendmessage until the current registry contains a complete,
// generation-scoped CLAUDE-ID-01 capability. Production remains stricter: it
// derives availability only from live registry evidence and never from this
// test seam.
test('getCapabilityManifest excludes test-advertised claude-sendmessage when no CLAUDE-ID-01 capability exists', () => {
  const dir = makeGitProject();
  const savedNodeEnv = process.env.NODE_ENV;
  const savedCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedFakeCaps = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    requesterBindingFixtureBase(dir);
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'item10-capability-manifest-fixture';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['claude-sendmessage']);

    const manifest = rll.getCapabilityManifest(dir);
    assert.strictEqual(manifest.ok, true, 'fixture sanity: getCapabilityManifest must resolve: ' + JSON.stringify(manifest));
    assert.ok(
      !manifest.availableDrivers.includes('claude-sendmessage'),
      'Case 9a: getCapabilityManifest must not advertise claude-sendmessage while the current registry lacks a complete CLAUDE-ID-01 capability: ' + JSON.stringify(manifest)
    );
  } finally {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedCap;
    if (savedFakeCaps === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCaps;
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// M6+M7 SIXTEENTH Phase 2A: findActionDirect (direct actionPathFor lookup, for
// callers that already know their own projectRoot/repoId) and
// findActionAcrossRepos's bounded scan (opendirSync/readSync streaming,
// MAX_ACTION_REPO_SCAN_ENTRIES=1024, for the 3 callers with no --project-root
// in their frozen argv: action-failed/ready/wait-ready). registryBaseDir()
// resolves purely from os.tmpdir() + this OS user's uid, read fresh on every
// call -- overriding process.env.TMPDIR for the span of one test isolates
// every write these tests perform (including thousands of decoy directories)
// away from the real canonical registry.
// ─────────────────────────────────────────────────────────────────────────────

function withIsolatedRegistryTmp(fn) {
  const savedTmpdir = process.env.TMPDIR;
  const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-scan-isolated-')));
  process.env.TMPDIR = isolatedRoot;
  try {
    return fn();
  } finally {
    if (savedTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmpdir;
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

// Mints one minimal, real, valid role-spawn action for `dir` -- the simplest
// ACTION_KIND_ENUM member, needed only as a genuine registry record to look
// up, never exercising the heavier supervisor-start/ensure machinery this
// file's other fixtures need.
function mintMinimalAction(dir, suffix) {
  if (!rll.discoverPlan(dir).ok) writePlanFixture(dir, 'scan-fixture-' + suffix);
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'scan-fixture-' + suffix };
  const generation = rll.resolveSessionGeneration(dir, identity);
  assert.strictEqual(generation.ok, true, 'scan fixture: session generation must resolve');
  const worktreeId = rll.computeWorktreeId(dir);
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, 'scan fixture: PLAN must resolve');
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('scan-fixture-team', 'verifier', 'verifier', 'fixture', 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    dir, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(dir), worktreeId,
    plan.planDigest, crypto.createHash('sha256').update('scan-fixture-policy:' + suffix).digest('hex'),
    generation.generationId, 'verifier', payload, expiry,
  );
  assert.strictEqual(minted.ok, true, 'scan fixture: action must mint: ' + JSON.stringify(minted));
  return actionId;
}

// Creates `count` sibling repo-id-shaped (64-hex) directories directly under
// the registry base dir, each disjoint from any real repoId this test uses.
function injectDecoyRepoDirs(count) {
  const base = rll.registryBaseDir();
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  for (let i = 0; i < count; i += 1) {
    const decoyId = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.join(base, decoyId, 'actions'), { recursive: true, mode: 0o700 });
  }
}

test('findActionDirect: finds a real minted action by projectRoot, reports absent:true for an unminted one, never scans sibling repos', () => {
  withIsolatedRegistryTmp(() => {
    const dir = makeGitProject();
    try {
      const actionId = mintMinimalAction(dir, 'direct-found');
      const found = rll.findActionDirect(dir, actionId);
      assert.strictEqual(found.ok, true, JSON.stringify(found));
      assert.strictEqual(found.absent, false);
      assert.strictEqual(found.action.action_id, actionId);

      const missing = rll.findActionDirect(dir, rll.generateActionId());
      assert.deepStrictEqual(missing, { ok: true, absent: true });

      // Same lookup via the {repoId} descriptor shape (the form the two
      // hot-path bridge callers actually use once repoId is already resolved).
      const viaDescriptor = rll.findActionDirect({ repoId: rll.computeRepoId(dir) }, actionId);
      assert.strictEqual(viaDescriptor.ok && !viaDescriptor.absent, true, JSON.stringify(viaDescriptor));
      assert.strictEqual(viaDescriptor.action.action_id, actionId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('findActionAcrossRepos: 0/1/duplicate matches under the cap preserve exact pre-existing semantics, even with decoys mixed in', () => {
  withIsolatedRegistryTmp(() => {
    const dir = makeGitProject();
    try {
      // 0 matches: a well-formed hex id that was never minted anywhere.
      const zero = rll.findActionAcrossRepos(rll.generateActionId());
      assert.deepStrictEqual(zero, { ok: true, absent: true });

      // 1 match, alongside unrelated decoy repo dirs that never contain it.
      injectDecoyRepoDirs(20);
      const actionId = mintMinimalAction(dir, 'scan-single');
      const one = rll.findActionAcrossRepos(actionId);
      assert.strictEqual(one.ok, true, JSON.stringify(one));
      assert.strictEqual(one.absent, false);
      assert.strictEqual(one.action.action_id, actionId);

      // Duplicate: the SAME action_id minted a second time under a genuinely
      // different repo (a second git project) is structurally ambiguous.
      const dir2 = makeGitProject();
      try {
        const base = rll.registryBaseDir();
        const dupPath = path.join(base, rll.computeRepoId(dir2), 'actions', actionId + '.json');
        fs.mkdirSync(path.dirname(dupPath), { recursive: true, mode: 0o700 });
        fs.chmodSync(path.dirname(dupPath), 0o700);
        fs.writeFileSync(dupPath, JSON.stringify(rll.findActionDirect(dir, actionId).action), { mode: 0o600 });
        fs.chmodSync(dupPath, 0o600);
        const dup = rll.findActionAcrossRepos(actionId);
        assert.deepStrictEqual(dup, { ok: false, reason: 'ambiguous-action-id' });
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('findActionAcrossRepos: more than MAX_ACTION_REPO_SCAN_ENTRIES total entries fails closed with action-repo-scan-cap-exceeded, even when a real match already exists among them, counting EVERY entry seen (not just repo-id-shaped candidates)', () => {
  withIsolatedRegistryTmp(() => {
    const dir = makeGitProject();
    try {
      const actionId = mintMinimalAction(dir, 'scan-cap');
      // Sanity: found cleanly while under the cap (just this one real repo dir).
      const underCap = rll.findActionAcrossRepos(actionId);
      assert.strictEqual(underCap.ok && !underCap.absent, true, 'fixture sanity: must be found while under the cap: ' + JSON.stringify(underCap));

      // A mix of non-repo-id-shaped junk entries (files, a two-char name) --
      // these must count toward the cap too, never silently skipped just
      // because they never match ACTION_ID_DIR_RE.
      const base = rll.registryBaseDir();
      for (let i = 0; i < 30; i += 1) fs.writeFileSync(path.join(base, 'junk-file-' + i + '.txt'), '');
      fs.mkdirSync(path.join(base, 'zz'), { recursive: true });
      // Enough real repo-id-shaped decoys that total entries (junk + decoys +
      // the one real repo dir) exceeds MAX_ACTION_REPO_SCAN_ENTRIES (1024).
      injectDecoyRepoDirs(rll.MAX_ACTION_REPO_SCAN_ENTRIES);

      const overCap = rll.findActionAcrossRepos(actionId);
      assert.deepStrictEqual(
        overCap, { ok: false, reason: 'action-repo-scan-cap-exceeded' },
        'a scan whose base dir holds more than MAX_ACTION_REPO_SCAN_ENTRIES entries must fail closed even though a real match exists among them: ' + JSON.stringify(overCap)
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('findActionAcrossRepos: exactly MAX_ACTION_REPO_SCAN_ENTRIES entries (cap, not cap+1) still scans cleanly to completion', () => {
  withIsolatedRegistryTmp(() => {
    const dir = makeGitProject();
    try {
      const actionId = mintMinimalAction(dir, 'scan-exact-cap');
      // The real repo dir counts as one entry; fill the rest of the cap with decoys.
      injectDecoyRepoDirs(rll.MAX_ACTION_REPO_SCAN_ENTRIES - 1);
      const atCap = rll.findActionAcrossRepos(actionId);
      assert.strictEqual(atCap.ok && !atCap.absent, true, 'exactly ' + rll.MAX_ACTION_REPO_SCAN_ENTRIES + ' total entries must still resolve (the cap itself is inclusive, only cap+1 fails): ' + JSON.stringify(atCap));
      assert.strictEqual(atCap.action.action_id, actionId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M6+M7 SIXTEENTH Phase 2C: resolveSealedGitCache / sealGitIdentityFor /
// gitTopologySealsMatch (runtime-consultation.cjs) -- the shared sealed cache
// behind projectGitFactsOnce (runtime-bridge-codex.cjs),
// gitDerivedSensitiveRootsCache (runtime-bridge-codex.cjs) and
// projectRealOnceForScope (runtime-consultation.cjs). A plain memo trusts a
// cached per-projectRoot git identity forever, for the life of the process;
// the sealed version cheaply reproves (lstat/readlink/read only, never a
// second git spawn) the exact on-disk .git/gitdir/common-dir identity it was
// sealed against before EVERY reuse, failing closed on any mismatch.
// ─────────────────────────────────────────────────────────────────────────────

function makeGitProjectAt(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-registry-seal-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL Registry Seal Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function simpleGitTopologyDerive(root) {
  const projectReal = rc.gitRevParse(root, ['rev-parse', '--show-toplevel']);
  const gitCommonDirReal = rc.realpathOrSelf(rc.gitRevParse(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  return { ok: true, projectReal, gitCommonDirReal };
}

test('resolveSealedGitCache: a second call with an untampered repo reuses the cached derivation, returning the identical values', () => {
  const dir = makeGitProjectAt('rll-registry-seal-plain-');
  try {
    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, dir, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    const second = rc.resolveSealedGitCache(cache, dir, simpleGitTopologyDerive);
    assert.strictEqual(second.ok, true, JSON.stringify(second));
    assert.strictEqual(second.derived, first.derived, 'an untampered repo must reuse the SAME cached derived object, not a freshly recomputed one');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSealedGitCache RED: a linked worktree whose .git gitdir pointer is synchronously swapped toward a DIFFERENT valid repo is rejected on the very next resolution, never silently re-derives or serves the stale cache, and performs zero writes', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-repoA-');
  const repoB = makeGitProjectAt('rll-registry-seal-repoB-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-seal-wt-'));
  fs.rmdirSync(worktreeDir); // git worktree add requires the target not yet exist
  try {
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', worktreeDir, '-b', 'rll-registry-seal-wt-branch']);
    const gitFilePath = path.join(worktreeDir, '.git');
    const originalGitFileBytes = fs.readFileSync(gitFilePath);
    assert.match(originalGitFileBytes.toString('utf8'), /^gitdir:/, 'fixture sanity: a linked worktree\'s own .git must be a gitdir-pointer FILE, not a directory');

    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, 'fixture sanity: the first, untampered resolution must succeed: ' + JSON.stringify(first));
    const sealedEntryAfterFirst = cache.get(worktreeDir);
    assert.ok(sealedEntryAfterFirst, 'fixture sanity: a successful resolution must populate the cache entry');

    // Synchronous substitution toward a DIFFERENT, independently valid repo
    // (repoB's own real .git directory) -- no await, same tick as the next
    // resolution below.
    fs.writeFileSync(gitFilePath, 'gitdir: ' + path.join(repoB, '.git') + '\n');

    const second = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.deepStrictEqual(
      second, { ok: false, reason: 'git-topology-seal-mismatch' },
      'a .git/gitdir substitution toward a different valid repo, discovered on the very next resolution, must be rejected outright -- never silently re-derived/accepted as a new topology, never silently served from the stale pre-swap cache: ' + JSON.stringify(second)
    );
    assert.strictEqual(
      cache.get(worktreeDir), sealedEntryAfterFirst,
      'a rejected (mismatched) resolution must perform ZERO writes to the cache -- the entry must remain byte-identical to what the first successful resolution produced, never overwritten with a new seal/derivation for the swapped topology'
    );

    // Restoration -- ONLY this fixture's own .git file, nothing else.
    fs.writeFileSync(gitFilePath, originalGitFileBytes);
    const third = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(third.ok, true, 'after restoring the exact original .git bytes, resolution must succeed again: ' + JSON.stringify(third));
    assert.strictEqual(third.derived.projectReal, first.derived.projectReal, 'the restored resolution must match the ORIGINAL identity exactly');
  } finally {
    // Best-effort: if an assertion above threw while .git was still mid-swap,
    // `git worktree remove` may itself fail to recognize the worktree --
    // never let that mask the real test failure propagating through this
    // finally block.
    try { execFileSync('git', ['-C', repoA, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'ignore' }); } catch (err) { /* best effort */ }
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('resolveSealedGitCache RED: a NON-worktree repo whose .git directory is wholesale replaced with a different repo\'s .git directory is rejected on the next resolution', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-normalA-');
  const repoB = makeGitProjectAt('rll-registry-seal-normalB-');
  try {
    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, repoA, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, JSON.stringify(first));

    const gitDirPath = path.join(repoA, '.git');
    fs.rmSync(gitDirPath, { recursive: true, force: true });
    fs.cpSync(path.join(repoB, '.git'), gitDirPath, { recursive: true });

    const second = rc.resolveSealedGitCache(cache, repoA, simpleGitTopologyDerive);
    assert.deepStrictEqual(
      second, { ok: false, reason: 'git-topology-seal-mismatch' },
      'wholesale-replacing a normal (non-worktree) repo\'s .git directory with a different repo\'s must also be caught: ' + JSON.stringify(second)
    );
  } finally {
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Commondir seal gap fix (Codex review, 2026-08-15): the ORIGINAL seal above
// only lstat'd the STRING gitCommonDirReal (a snapshot from the one git spawn
// at derive time) -- never the actual <gitdirTargetReal>/commondir FILE a
// linked worktree's git internals themselves read to resolve that string.
// A commondir content/inode/type swap that left the gitdir-target directory's
// own dev/ino untouched went completely unnoticed on reseal. These 5 tests
// cover: 3 discriminating REDs (in-place modification, inode replacement,
// symlink conversion) against the reseal path, 1 additional RED isolating the
// "exact correlation with gitCommonDirReal" self-consistency check
// (sealCorrelatesWithGitCommonDir) on the FIRST resolution -- where there is
// no prior seal to diff against at all -- and 1 POSITIVE confirming ordinary
// nlink churn on the gitdir-target directory (which now also hosts the sealed
// commondir file) still does not invalidate the seal.
// ─────────────────────────────────────────────────────────────────────────────

test('resolveSealedGitCache RED: a linked worktree\'s commondir file is modified in place (same inode, new bytes) to point at a DIFFERENT valid repo\'s common dir -- caught on the next resolution even though the gitdir-pointer FILE and its own target directory are both untouched', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-cd-inplace-A-');
  const repoB = makeGitProjectAt('rll-registry-seal-cd-inplace-B-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-seal-cd-inplace-wt-'));
  fs.rmdirSync(worktreeDir);
  try {
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', worktreeDir, '-b', 'rll-registry-seal-cd-inplace-branch']);

    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, 'fixture sanity: ' + JSON.stringify(first));

    const seal = rc.sealGitIdentityFor(first.derived.projectReal, first.derived.gitCommonDirReal);
    assert.strictEqual(seal.isLinkedWorktree, true, 'fixture sanity: must be the linked-worktree shape');
    assert.ok(seal.commondirTargetReal, 'fixture sanity: commondir must resolve to repoA\'s own .git');
    const commondirPath = path.join(seal.gitdirTargetReal, 'commondir');
    const originalCommondirBytes = fs.readFileSync(commondirPath);
    const commondirStatBefore = fs.lstatSync(commondirPath);

    // In-place: SAME path, truncate+rewrite -- the SAME inode on this
    // filesystem, isolating "content changed" from "inode changed" (the
    // next test below covers inode replacement specifically).
    fs.writeFileSync(commondirPath, path.join(repoB, '.git') + '\n');
    const commondirStatAfter = fs.lstatSync(commondirPath);
    assert.strictEqual(commondirStatAfter.ino, commondirStatBefore.ino, 'fixture sanity: an in-place writeFileSync must keep the SAME inode, isolating this from the inode-replacement RED below');

    const second = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.deepStrictEqual(
      second, { ok: false, reason: 'git-topology-seal-mismatch' },
      'an in-place commondir content swap toward a different valid repo must be rejected on the very next resolution: ' + JSON.stringify(second)
    );

    fs.writeFileSync(commondirPath, originalCommondirBytes);
    const third = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(third.ok, true, 'after restoring the exact original commondir bytes, resolution must succeed again: ' + JSON.stringify(third));
  } finally {
    try { execFileSync('git', ['-C', repoA, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'ignore' }); } catch (err) { /* best effort */ }
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('resolveSealedGitCache RED: a linked worktree\'s commondir file is REPLACED by a different inode carrying byte-identical content (rename-over-existing) -- caught on the next resolution via stat identity even though the content digest alone would not have distinguished it', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-cd-inode-A-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-seal-cd-inode-wt-'));
  fs.rmdirSync(worktreeDir);
  try {
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', worktreeDir, '-b', 'rll-registry-seal-cd-inode-branch']);

    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, 'fixture sanity: ' + JSON.stringify(first));

    const seal = rc.sealGitIdentityFor(first.derived.projectReal, first.derived.gitCommonDirReal);
    const commondirPath = path.join(seal.gitdirTargetReal, 'commondir');
    const originalCommondirBytes = fs.readFileSync(commondirPath);
    const commondirStatBefore = fs.lstatSync(commondirPath);

    // Replace via rename-over: a fresh inode carrying the EXACT SAME bytes
    // as before -- a swap caught only by a content digest would miss this.
    const replacementPath = commondirPath + '.replacement-tmp';
    fs.writeFileSync(replacementPath, originalCommondirBytes);
    const replacementStat = fs.lstatSync(replacementPath);
    assert.notStrictEqual(replacementStat.ino, commondirStatBefore.ino, 'fixture sanity: the replacement file must be a genuinely different inode');
    fs.renameSync(replacementPath, commondirPath);
    const commondirStatAfter = fs.lstatSync(commondirPath);
    assert.notStrictEqual(commondirStatAfter.ino, commondirStatBefore.ino, 'fixture sanity: after rename-over, commondir must now be the replacement inode');
    assert.deepStrictEqual(fs.readFileSync(commondirPath), originalCommondirBytes, 'fixture sanity: byte content must be UNCHANGED -- this test isolates inode identity from content');

    const second = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.deepStrictEqual(
      second, { ok: false, reason: 'git-topology-seal-mismatch' },
      'a commondir inode replacement, even with byte-identical content, must be rejected on the very next resolution: ' + JSON.stringify(second)
    );
  } finally {
    try { execFileSync('git', ['-C', repoA, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'ignore' }); } catch (err) { /* best effort */ }
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
  }
});

test('resolveSealedGitCache RED: a linked worktree\'s commondir file is converted into a symlink -- caught on the next resolution, never followed and trusted even when the symlink target\'s own bytes are identical to the original', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-cd-symlink-A-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-seal-cd-symlink-wt-'));
  fs.rmdirSync(worktreeDir);
  try {
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', worktreeDir, '-b', 'rll-registry-seal-cd-symlink-branch']);

    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, 'fixture sanity: ' + JSON.stringify(first));

    const seal = rc.sealGitIdentityFor(first.derived.projectReal, first.derived.gitCommonDirReal);
    const commondirPath = path.join(seal.gitdirTargetReal, 'commondir');
    const originalCommondirBytes = fs.readFileSync(commondirPath);

    // Point the symlink at a SEPARATE copy carrying the exact same bytes --
    // isolates "became a symlink" from "content changed".
    const symlinkTargetPath = commondirPath + '.symlink-target';
    fs.writeFileSync(symlinkTargetPath, originalCommondirBytes);
    fs.unlinkSync(commondirPath);
    fs.symlinkSync(symlinkTargetPath, commondirPath);
    assert.strictEqual(fs.lstatSync(commondirPath).isSymbolicLink(), true, 'fixture sanity: commondir must now lstat as a symlink');

    const second = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.deepStrictEqual(
      second, { ok: false, reason: 'git-topology-seal-mismatch' },
      'commondir being converted into a symlink must be rejected on the very next resolution, never followed and trusted: ' + JSON.stringify(second)
    );
  } finally {
    try { execFileSync('git', ['-C', repoA, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'ignore' }); } catch (err) { /* best effort */ }
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
  }
});

test('resolveSealedGitCache RED: a deriveFn returning a gitCommonDirReal that disagrees with what the worktree\'s own commondir file resolves to is rejected on the FIRST resolution (no prior seal to diff against) and is never cached', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-cd-correlate-A-');
  const repoB = makeGitProjectAt('rll-registry-seal-cd-correlate-B-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-seal-cd-correlate-wt-'));
  fs.rmdirSync(worktreeDir);
  try {
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', worktreeDir, '-b', 'rll-registry-seal-cd-correlate-branch']);

    const repoBCommonDirReal = rc.realpathOrSelf(path.join(repoB, '.git'));
    const realGitCommonDirReal = rc.realpathOrSelf(rc.gitRevParse(worktreeDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    assert.notStrictEqual(realGitCommonDirReal, repoBCommonDirReal, 'fixture sanity: repoB must be a genuinely different common dir');

    // Agrees with reality on projectReal, but lies about gitCommonDirReal --
    // exactly the shape of an internal resolution-mechanism disagreement
    // sealCorrelatesWithGitCommonDir exists to catch.
    const lyingDerive = (root) => ({ ok: true, projectReal: rc.gitRevParse(root, ['rev-parse', '--show-toplevel']), gitCommonDirReal: repoBCommonDirReal });

    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, worktreeDir, lyingDerive);
    assert.deepStrictEqual(
      first, { ok: false, reason: 'git-topology-commondir-correlation-mismatch' },
      'a gitCommonDirReal that disagrees with what the worktree\'s own commondir file resolves to must be rejected outright: ' + JSON.stringify(first)
    );
    assert.strictEqual(cache.has(worktreeDir), false, 'a correlation-mismatched derivation must never be cached');

    const second = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(second.ok, true, 'the real (non-lying) deriveFn must still succeed normally: ' + JSON.stringify(second));
  } finally {
    try { execFileSync('git', ['-C', repoA, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'ignore' }); } catch (err) { /* best effort */ }
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('resolveSealedGitCache POSITIVE: ordinary subdirectory churn under a linked worktree\'s own gitdir-target administrative directory (nlink drift on gitdirTargetStat, the same directory that now also hosts the sealed commondir file) does not invalidate the seal', () => {
  const repoA = makeGitProjectAt('rll-registry-seal-cd-nlink-A-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-registry-seal-cd-nlink-wt-'));
  fs.rmdirSync(worktreeDir);
  try {
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', worktreeDir, '-b', 'rll-registry-seal-cd-nlink-branch']);

    const cache = new Map();
    const first = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(first.ok, true, 'fixture sanity: ' + JSON.stringify(first));

    const seal = rc.sealGitIdentityFor(first.derived.projectReal, first.derived.gitCommonDirReal);
    const nlinkBefore = fs.lstatSync(seal.gitdirTargetReal).nlink;

    // Ordinary sibling-subdirectory churn directly under the gitdir-target
    // administrative directory -- exactly the kind of routine activity this
    // exact directory sees in real use -- never touching commondir's own
    // bytes or inode.
    const churnDirs = ['churn-a', 'churn-b', 'churn-c'].map((name) => path.join(seal.gitdirTargetReal, name));
    for (const d of churnDirs) fs.mkdirSync(d);
    const nlinkDuringChurn = fs.lstatSync(seal.gitdirTargetReal).nlink;
    assert.notStrictEqual(nlinkDuringChurn, nlinkBefore, 'fixture sanity: creating 3 sibling subdirectories must actually change nlink, otherwise this test proves nothing');

    const second = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(second.ok, true, 'ordinary nlink churn on the gitdir-target directory must NOT invalidate the seal: ' + JSON.stringify(second));
    assert.strictEqual(second.derived, first.derived, 'must reuse the SAME cached derivation, not recompute');

    for (const d of churnDirs) fs.rmdirSync(d);
    const third = rc.resolveSealedGitCache(cache, worktreeDir, simpleGitTopologyDerive);
    assert.strictEqual(third.ok, true, 'resolution must still succeed after the churned subdirectories are removed again: ' + JSON.stringify(third));
  } finally {
    try { execFileSync('git', ['-C', repoA, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'ignore' }); } catch (err) { /* best effort */ }
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE -- IMMUTABLE AUTHORITY CUTS AND ADMISSION LINEARIZATION (v4).
// Fase 1 (test-specialist, dispatch arch-testing-20260816T160058Z): fresh REDs
// per .planning/wave-portable-runtime-messaging-adapters/
// M7-ATOMIC-REVOCATION-RECONCILIATION.md section 10.3. This is Group A (REDs
// 1-12, contract order): binding-v2 generation (x3), legacy-v1-nonauth,
// rotate-no-delete, classifier (x2), fence (x5) -- all sequential/
// deterministic negatives, no rendezvous producer needed (section 10.1's six
// race-only stages are Group B's concern). Each must fail TODAY for the EXACT
// semantic reason named in its own assertion message (confirmed against the
// real production code by direct read, not guessed), and pass once GREEN
// (toolkit-specialist, Fase 2/3) lands. RED 2 (M7-BINDING-V2-ROOT-GENERATION-02)
// is intentionally NOT in this pass -- createRootSourceBinding needs a full
// action+reservation chain first; landing separately once the exact fixture
// shape is confirmed, to avoid a hand-rolled fixture silently exercising the
// wrong thing.
// ════════════════════════════════════════════════════════════════════════════

// M7 section 3.1: authority_identity_id is sha256(canonicalJSONStringify(...))
// over EXACTLY {schema,provider,repo_id,runtime_session_key,agent_id} --
// generation/PLAN/worktree/role are deliberately excluded from this domain.
// Computed independently here (never by calling production code, which does
// not implement this yet) so the fence-family REDs below can assert against
// the exact path/identity a future admitClaudeAuthorityOperation must use.
function computeExpectedM7AuthorityIdentityId(dir, provider, sessionId, agentId) {
  const identity = {
    schema: 'runtime/claude-authority-identity/v1',
    provider,
    repo_id: rll.computeRepoId(dir),
    runtime_session_key: sessionId,
    agent_id: agentId,
  };
  return rc.sha256String(rc.canonicalJSONStringify(identity));
}

function m7AuthorityFencePathFor(dir, authorityIdentityId) {
  return path.join(rll.registryRepoDir(dir), 'authority-identity-fences', authorityIdentityId + '.json');
}

test('M7-BINDING-V2-REQUESTER-GENERATION-01 (RED): createRequesterBinding must persist schema coordination/requester-binding/v2 with a session_generation_id field equal to the identity tuple\'s current live generation -- today it persists v1 with no such field', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'm7-red01-session' };
    const liveGeneration = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(liveGeneration.ok, true, 'fixture: a live generation must resolve before mint: ' + JSON.stringify(liveGeneration));

    const minted = rll.createRequesterBinding(dir, identity, 'm7-red01-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'positive control: the underlying mint mechanism itself must still succeed today: ' + JSON.stringify(minted));

    const rec = JSON.parse(fs.readFileSync(rll.requesterBindingPathFor(dir, minted.binding.binding_id), 'utf8'));
    assert.strictEqual(
      rec.schema, 'coordination/requester-binding/v2',
      'M7 section 4.1: a freshly-minted RequesterBinding must be schema v2 -- today createRequesterBinding still writes coordination/requester-binding/v1: ' + JSON.stringify(rec)
    );
    assert.strictEqual(
      rec.session_generation_id, liveGeneration.generationId,
      'M7 section 4.1: the persisted record must carry session_generation_id equal to the identity tuple\'s current live generation -- today the v1 schema has no such field at all: ' + JSON.stringify(rec)
    );
    assert.deepStrictEqual(
      Object.keys(rec).sort(),
      ['actor_instance_id', 'agent_key', 'binding_id', 'created_at', 'expiry', 'plan_digest', 'role', 'runtime', 'runtime_session_key', 'schema', 'session_generation_id', 'worktree_id'],
      'M7 section 4.1: exact v1 key-set plus session_generation_id, nothing else: ' + JSON.stringify(Object.keys(rec).sort())
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-BINDING-V2-ONESHOT-GENERATION-03 (RED): createClaudeOneShotBinding must require the CALLER\'s already-fixed sessionGenerationId (new 3rd positional arg per M7 correction section 4.1) to equal the identity\'s CURRENT live generation -- a stale caller-supplied generation must be rejected with binding-generation-mismatch and write zero new files; today the function has no such param at all and silently mint-or-reuses the current generation internally, rationalizing (own doc comment) that "the two naturally agree in the real flow" -- M7 correction rejects that rationalization', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red03-session';
    const agentId = 'm7-red03-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    const g1 = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(g1.ok, true, 'fixture: G1 must resolve before rotation: ' + JSON.stringify(g1));

    // Force the current session-generation record to read as expired, so the
    // NEXT resolveSessionGeneration call for this identity rotates to a
    // fresh G2 -- same technique as M7-ROTATE-NO-DELETE-05 above.
    const genRecPath = rll.sessionGenerationPathFor(dir, identity);
    const genRec = JSON.parse(fs.readFileSync(genRecPath, 'utf8'));
    genRec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(genRecPath, 0o600);
    fs.writeFileSync(genRecPath, JSON.stringify(genRec), { mode: 0o600 });

    const g2 = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(g2.ok, true, 'fixture: G2 must resolve after rotation: ' + JSON.stringify(g2));
    assert.notStrictEqual(g2.generationId, g1.generationId, 'fixture sanity: rotation must genuinely produce a DIFFERENT generation id');

    const oneShotBindingsDir = path.join(rll.registryRepoDir(dir), 'claude-one-shot-bindings');
    let filesBeforeNegative = [];
    try { filesBeforeNegative = fs.readdirSync(oneShotBindingsDir); } catch { /* absent is fine -- zero so far */ }
    assert.strictEqual(filesBeforeNegative.length, 0, 'fixture sanity: zero one-shot bindings exist before the negative call');

    // THE RED: call the TARGET (post-GREEN) 13-arg signature with the STALE
    // G1 explicitly as the 3rd positional arg -- production today is still
    // the 12-arg signature with no generation param at all, so this call
    // necessarily also exercises ordinary signature-changing argument drift
    // (dispatch-acknowledged): the ACTUAL pre-GREEN failure reason is
    // expected to differ from the target 'binding-generation-mismatch'
    // until GREEN lands (see reason assertion below for what today's real
    // observed reason is).
    const rejected = rll.createClaudeOneShotBinding(
      dir, sessionId, g1.generationId, agentId, role,
      rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
      0, role, worktreeId, planDigest, 600,
    );
    assert.strictEqual(rejected.ok, false, 'a stale caller-supplied generation must be rejected, never minted: ' + JSON.stringify(rejected));

    let filesAfterNegative = [];
    try { filesAfterNegative = fs.readdirSync(oneShotBindingsDir); } catch { /* absent is fine */ }
    assert.strictEqual(filesAfterNegative.length, 0, 'M7 section 4.3/5: a rejected stale-generation call must write ZERO new ClaudeOneShotBinding files: ' + JSON.stringify({ filesAfterNegative, rejected }));

    assert.strictEqual(
      rejected.reason, 'binding-generation-mismatch',
      'M7 correction section 4.1: createClaudeOneShotBinding must require its CALLER\'s already-fixed sessionGenerationId to equal the identity\'s CURRENT live generation, rejecting a stale one with binding-generation-mismatch -- today the function has no sessionGenerationId param at all (still the 12-arg signature), so this 13-arg target-shape call is instead rejected for a DIFFERENT, pre-GREEN reason via ordinary positional-argument drift (the caller-supplied generationId string lands in the old agentId slot, and this test\'s own real agentId string then lands in the old agentType slot, failing CANONICAL_ROLES.includes()): ' + JSON.stringify(rejected)
    );

    // Positive control (target postcondition, reached only once GREEN
    // lands): the SAME call shape with the CURRENT G2 explicitly supplied
    // must succeed, persisting session_generation_id===G2 and
    // expiry<=G2.expiresAt.
    const accepted = rll.createClaudeOneShotBinding(
      dir, sessionId, g2.generationId, agentId, role,
      rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
      0, role, worktreeId, planDigest, 600,
    );
    assert.strictEqual(accepted.ok, true, 'positive control: the current live generation must still be accepted: ' + JSON.stringify(accepted));
    const rec = JSON.parse(fs.readFileSync(rll.claudeOneShotBindingPathFor(dir, accepted.binding.binding_id), 'utf8'));
    assert.strictEqual(rec.schema, 'runtime/claude-one-shot-binding/v2', 'M7 section 4.3: schema must still be v2: ' + JSON.stringify(rec));
    assert.strictEqual(rec.session_generation_id, g2.generationId, 'M7 section 4.1: persisted session_generation_id must equal the caller-supplied current G2: ' + JSON.stringify(rec));
    assert.ok(
      Date.parse(rec.expiry) <= Date.parse(g2.expiresAt),
      'M7 section 4.3: expiry must be capped to G2\'s own expiresAt: ' + JSON.stringify({ rec, g2 })
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-LEGACY-V1-NONAUTH-04 (RED): mintRoleCommandGrant must reject a well-formed v1 RequesterBinding as legacy-binding-non-authoritative -- today it mints a grant against it successfully', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red04-session';
    const agentId = 'm7-red04-agent';
    // Post-GREEN update: createRequesterBinding now correctly produces v2
    // (RED 1's own fix) -- v1 is no longer reachable through it at all, so
    // this RED's own well-formed v1 backing must now be constructed
    // DIRECTLY, in-memory, never written to disk (mintRoleCommandGrant takes
    // its `binding` param directly and never re-reads one from disk itself,
    // exactly the same pattern RED 19's own tampered/expired-binding fixture
    // already relies on). Exact v1 key-set/schema literal confirmed by
    // direct read of runtime-role-lifecycle.cjs's own REQUESTER_BINDING_SCHEMA/
    // REQUESTER_BINDING_KEYS constants, explicitly documented there as
    // "kept unchanged... still correctly recognize a legacy record as v1/
    // LEGACY_STALE per section 4.4" -- this is the CURRENT, intended legacy-
    // detection surface, not a stale leftover.
    const nowStr = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const v1Binding = {
      schema: 'coordination/requester-binding/v1',
      binding_id: crypto.randomBytes(16).toString('hex'),
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime: 'claude-hook',
      runtime_session_key: sessionId,
      agent_key: agentId,
      role,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: nowStr,
      expiry: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(['--coordination-root', '/x']));
    const grant = rll.mintRoleCommandGrant(dir, v1Binding, 'requester', 'root-init', argvDigest, null, null, null);
    assert.strictEqual(
      grant.ok, false,
      'M7 section 4.4/10.2: a valid v1 backing must be rejected as legacy-binding-non-authoritative once the M7 admission pass exists -- today mintRoleCommandGrant only checks binding.schema===REQUESTER_BINDING_SCHEMA (currently the v1 literal itself, so a v1 binding satisfies it), and mints successfully: ' + JSON.stringify(grant)
    );
    assert.strictEqual(grant.reason, 'legacy-binding-non-authoritative');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-ROTATE-NO-DELETE-05 (RED): a session-generation rotation must NOT delete the prior generation\'s RequesterBinding records (only invalidate them by generation-value mismatch) -- today retireRequesterBindingsForRuntimeSession unlinks them from disk', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'm7-red05-session' };
    const minted = rll.createRequesterBinding(dir, identity, 'm7-red05-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a binding must mint before rotation: ' + JSON.stringify(minted));
    const bindingPath = rll.requesterBindingPathFor(dir, minted.binding.binding_id);
    assert.strictEqual(fs.existsSync(bindingPath), true, 'fixture sanity: the binding file exists right after mint');

    // Force the current session-generation record to read as expired, so the
    // NEXT resolveSessionGeneration call for this identity rotates -- the
    // same technique this file's own 'resolveSessionGeneration: an EXPIRED
    // session record...' test uses.
    const genRecPath = rll.sessionGenerationPathFor(dir, identity);
    const genRec = JSON.parse(fs.readFileSync(genRecPath, 'utf8'));
    genRec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(genRecPath, 0o600);
    fs.writeFileSync(genRecPath, JSON.stringify(genRec), { mode: 0o600 });

    const rotated = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(rotated.ok, true, 'fixture: rotation must produce a fresh generation: ' + JSON.stringify(rotated));

    assert.strictEqual(
      fs.existsSync(bindingPath), true,
      'M7 section 2.1: rotation must invalidate the prior generation\'s bindings by VALUE, never synchronously delete their records -- today retireRequesterBindingsForRuntimeSession (called from inside resolveSessionGeneration on every fresh mint) unconditionally fs.unlinkSync\'s every binding matching this runtime+session tuple'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-CLOSED-06 (RED): classifyClaudeAuthorityForIdentity must exist and return one of the closed {ABSENT|ONE|FENCED} result shapes -- today the classifier does not exist at all', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    assert.strictEqual(
      typeof rll.classifyClaudeAuthorityForIdentity, 'function',
      'M7 section 6: runtime-role-lifecycle.cjs must export classifyClaudeAuthorityForIdentity(repoDescriptor, observedIdentity) -- today it does not exist'
    );
    const identity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: 'm7-red06-session', agent_id: 'm7-red06-agent',
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: identity.repo_id }, identity);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.state, 'ABSENT', 'M7 section 6: an identity with zero matching bindings/fence must classify as ABSENT: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-CROSS-SCOPE-07 (RED): a current unexpired v2 RequesterBinding for the exact session+agent must still classify as ONE even after the PLAN content (and therefore plan_digest) it was minted under has since rotated -- today the classifier does not exist at all', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    assert.strictEqual(
      typeof rll.classifyClaudeAuthorityForIdentity, 'function',
      'M7 section 6: runtime-role-lifecycle.cjs must export classifyClaudeAuthorityForIdentity(repoDescriptor, observedIdentity) -- today it does not exist'
    );
    const role = 'arch-testing';
    const sessionId = 'm7-red07-session';
    const agentId = 'm7-red07-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a binding must mint under the ORIGINAL PLAN scope: ' + JSON.stringify(minted));

    // Rotate the PLAN's own content (same worktree, same file path -- only
    // its bytes/digest change): M7 section 6 -- "a current unexpired v2
    // record... is a candidate even when its PLAN/worktree/role differs, so
    // scope rotation cannot hide it".
    const planResult = rll.discoverPlan(dir);
    assert.strictEqual(planResult.ok, true, 'fixture sanity: PLAN must resolve before rotating it');
    fs.writeFileSync(planResult.planPath, '# rotated PLAN content for M7-CLASSIFIER-CROSS-SCOPE-07\n');
    const rotatedPlan = rll.discoverPlan(dir);
    assert.notStrictEqual(rotatedPlan.planDigest, planDigest, 'fixture sanity: the PLAN digest must genuinely have changed');

    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: authIdentity.repo_id }, authIdentity);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(
      result.state, 'ONE',
      'M7 section 6: a current unexpired v2 candidate must still classify as ONE even after the PLAN content it was originally minted under has since rotated -- scope rotation must never hide it: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-FENCE-SCHEMA-08 (RED): a real SubagentStop for a canonical owning role must publish a fence record with EXACTLY the closed 4-key runtime/claude-authority-fence/v1 shape -- today no fence mechanism exists and no such file is ever created', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('m7-red08-fence-schema');
  try {
    const role = 'arch-testing';
    const sessionId = 'm7-red08-session';
    const agentId = 'm7-red08-agent';
    const stopResult = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
    assert.strictEqual(stopResult.status, 0, 'SubagentStop must exit 0 per the official hook protocol: ' + stopResult.stderr);

    const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, 'claude-hook', sessionId, agentId);
    const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
    assert.strictEqual(
      fs.existsSync(fencePath), true,
      'M7 section 1/3.2: a real SubagentStop for a canonical owning role must durably publish an identity fence at authority-identity-fences/<authority_identity_id>.json -- today handleSubagentStop has no fence-writing logic at all'
    );
    const rec = JSON.parse(fs.readFileSync(fencePath, 'utf8'));
    assert.deepStrictEqual(Object.keys(rec).sort(), ['authority_identity_id', 'fenced_at', 'reason', 'schema']);
    assert.strictEqual(rec.schema, 'runtime/claude-authority-fence/v1');
    assert.strictEqual(rec.authority_identity_id, authorityIdentityId);
    assert.strictEqual(rec.reason, 'agent-return');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-FENCE-IDENTITY-DOMAIN-09 (RED): the fence identity domain excludes generation/PLAN/worktree/role -- a SECOND SubagentStop for the identical (repo,session,agent) after the PLAN has since rotated must resolve to the SAME immutable fence file, never a new/rewritten one -- today no fence mechanism exists at all', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('m7-red09-fence-domain');
  try {
    const role = 'arch-testing';
    const sessionId = 'm7-red09-session';
    const agentId = 'm7-red09-agent';
    const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, 'claude-hook', sessionId, agentId);
    const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);

    const firstStop = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
    assert.strictEqual(firstStop.status, 0, 'first SubagentStop must exit 0: ' + firstStop.stderr);
    assert.strictEqual(
      fs.existsSync(fencePath), true,
      'M7 section 3.1: the fence path is a pure function of (schema,provider,repo_id,runtime_session_key,agent_id) only -- today no fence mechanism exists at all, so this file is never created'
    );
    const firstBytes = fs.readFileSync(fencePath, 'utf8');

    // Rotate the PLAN content -- worktree/PLAN are deliberately EXCLUDED from
    // the fence identity domain (M7 section 3.1), so a second stop for the
    // IDENTICAL (repo,session,agent) must resolve to the exact SAME fence
    // file, never a new/different one -- and the fence is immutable (M7
    // section 3.2: "never removed or replaced"), so its bytes must be
    // unchanged.
    const planResult = rll.discoverPlan(dir);
    assert.strictEqual(planResult.ok, true, 'fixture sanity: PLAN must resolve before rotating it');
    fs.writeFileSync(planResult.planPath, '# rotated PLAN for M7-FENCE-IDENTITY-DOMAIN-09\n');

    const secondStop = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
    assert.strictEqual(secondStop.status, 0, 'second SubagentStop must exit 0: ' + secondStop.stderr);
    assert.strictEqual(fs.existsSync(fencePath), true, 'the SAME fence file must still exist after PLAN rotation');
    assert.strictEqual(
      fs.readFileSync(fencePath, 'utf8'), firstBytes,
      'M7 section 3.2: the fence is immutable -- a second stop for the identical actor identity must never rewrite/replace it'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-FENCE-VALIDATOR-CUT-10 (RED): validateRequesterBindingFor must deny a binding whose actor identity has a durable fence on disk -- today it never consults the fence path at all and returns ok:true regardless', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red10-session';
    const agentId = 'm7-red10-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a real binding must mint before fencing: ' + JSON.stringify(minted));
    const beforeFence = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(beforeFence.ok, true, 'fixture sanity: the binding validates before any fence exists');

    // Manually plant a fence record matching the exact M7 section 3.2 closed
    // shape -- the mechanism that WOULD write this (a real SubagentStop,
    // post-GREEN) does not exist yet, so this simulates its effect directly
    // to test the READ/validation side in isolation.
    const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, 'claude-hook', sessionId, agentId);
    const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
    const planted = rll.writeRegistryRecordReplace(fencePath, Buffer.from(JSON.stringify({
      schema: 'runtime/claude-authority-fence/v1',
      authority_identity_id: authorityIdentityId,
      reason: 'agent-return',
      fenced_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: planting the simulated fence record must succeed: ' + JSON.stringify(planted));

    const afterFence = rll.validateRequesterBindingFor(dir, minted.binding.binding_id, role, worktreeId, planDigest);
    assert.strictEqual(
      afterFence.ok, false,
      'M7 section 5 point 4: a durable actor fence must deny an otherwise-valid backing -- today validateRequesterBindingFor never reads authority-identity-fences/ at all, so a planted fence has zero effect: ' + JSON.stringify(afterFence)
    );
    assert.strictEqual(afterFence.reason, 'authority-fenced');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-FENCE-STOP-ZERO-11 (RED): a real SubagentStop for a canonical owning role with ZERO prior bindings must still publish an identity fence -- today a stop with nothing to retire is a complete no-op and writes nothing', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('m7-red11-fence-zero');
  try {
    const role = 'arch-testing';
    const sessionId = 'm7-red11-session';
    const agentId = 'm7-red11-agent';
    // Fixture: a fresh session/agent that has NEVER minted anything of any
    // family -- genuinely zero prior live authority.
    const stopResult = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
    assert.strictEqual(stopResult.status, 0, 'SubagentStop must exit 0: ' + stopResult.stderr);

    const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, 'claude-hook', sessionId, agentId);
    const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
    assert.strictEqual(
      fs.existsSync(fencePath), true,
      'M7 section 8.4 bullet 1: "a canonical owning role... publishes the identity fence first" -- unconditional on whether any binding currently exists, so a LATER mint attempt under the SAME identity is denied even though it never had a live binding at stop time. Today handleSubagentStop finds zero live authority (oneShot.candidates and rootSource.live both empty) and exits as a silent no-op, writing nothing at all.'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-FENCE-STOP-ACTIVE-12 (RED): a real SubagentStop for a canonical owning role with an ACTIVE existing RequesterBinding must publish an identity fence, without synchronously deleting the binding itself -- today the stop retires nothing for the requester family (it is not scanned by handleSubagentStop at all) and writes no fence either', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('m7-red12-fence-active');
  try {
    const worktreeId = rll.computeWorktreeId(dir);
    const planResult = rll.discoverPlan(dir);
    assert.strictEqual(planResult.ok, true, 'fixture: PLAN must resolve: ' + JSON.stringify(planResult));
    const planDigest = planResult.planDigest;
    const role = 'arch-testing';
    const sessionId = 'm7-red12-session';
    const agentId = 'm7-red12-agent';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: an ACTIVE binding must exist before the stop: ' + JSON.stringify(minted));
    const bindingPath = rll.requesterBindingPathFor(dir, minted.binding.binding_id);

    const stopResult = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
    assert.strictEqual(stopResult.status, 0, 'SubagentStop must exit 0: ' + stopResult.stderr);

    const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, 'claude-hook', sessionId, agentId);
    const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
    assert.strictEqual(
      fs.existsSync(fencePath), true,
      'M7 section 8.4 bullet 1: an owning-role stop with an ACTIVE candidate must ALSO publish the fence -- today handleSubagentStop never scans requester-bindings/ at all (only claude-one-shot and root-source), so a live RequesterBinding produces zero live candidates for either scanned family and the stop is a silent no-op'
    );
    assert.strictEqual(
      fs.existsSync(bindingPath), true,
      'M7 section 8.4: "no primary binding is synchronously deleted" -- the binding record itself must remain on disk; authority is revoked via the fence, never via deletion'
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group B (test-specialist, dispatch arch-testing-20260816T160058Z):
// REDs 13/14 -- the create/grant race pair. Each proves BOTH linearization
// orders per contract section 10.3's closing paragraph: cut-first (the fence
// is fully durable before the operation is even attempted -- deterministic,
// no rendezvous needed) and admission-first (a real child pauses at the
// Fase-0 create-after-admission-before-write / grant-after-admission-before-
// write producer; the fence lands DURING that window; the child is released
// and completes its write; the operation must then fail its OWN post-write
// predicate re-check, per section 7, even though the now-inert record
// physically landed). Both sides are genuine, currently-failing REDs for
// create/grant specifically: today neither performs any fence check at any
// point, so both orderings currently report success where section 5/7
// requires denial.
// ════════════════════════════════════════════════════════════════════════════

const M7_RACE_CAPABILITY = 'm7-race-fixture-capability';
const RC_IMPL = path.resolve(__dirname, '../lib/runtime-consultation.cjs');

function m7MakeRendezvousDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'm7-race-'));
}

// Spawns a real child process running `childSource` (a self-contained
// `node -e` script), armed for the named M7 rendezvous stage via
// RUNTIME_M7_TEST_STAGE/RUNTIME_M7_TEST_RENDEZVOUS_DIR. Waits for
// <stage>.ready (bounded 5000ms), runs `competingOp` (the parent's own
// durable write racing the paused child), writes <stage>.go, then
// waits/reaps the child -- mirrors M7 section 10.1's own harness contract
// verbatim: "waits for ready, performs the competing operation, writes go
// no-clobber, and waits/reaps both real subprocesses."
async function m7DriveRendezvousRace(childArgv, envExtra, stage, rendezvousDir, competingOp) {
  const readyPath = path.join(rendezvousDir, stage + '.ready');
  const goPath = path.join(rendezvousDir, stage + '.go');
  const child = spawn(process.execPath, childArgv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, envExtra, {
      NODE_ENV: 'test',
      RUNTIME_M7_TEST_STAGE: stage,
      RUNTIME_M7_TEST_RENDEZVOUS_DIR: rendezvousDir,
    }),
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

  const readyStart = Date.now();
  while (!fs.existsSync(readyPath)) {
    if (Date.now() - readyStart > 5000) {
      child.kill('SIGKILL');
      throw new Error('m7 race harness: timed out waiting for ' + stage + '.ready (child never armed): stderr=' + stderr);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  await competingOp();

  fs.writeFileSync(goPath, Buffer.from('go\n', 'utf8'), { mode: 0o600, flag: 'wx' });

  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  return { exitCode, stdout, stderr };
}

// Manually plants a fence record matching the exact M7 section 3.2 closed
// shape at its independently-computed section 3.1 path -- the mechanism
// that would write this (a real SubagentStop, post-GREEN) does not exist
// yet. Reuses computeExpectedM7AuthorityIdentityId/m7AuthorityFencePathFor
// from the Group A fence REDs above, never a second reimplementation.
function m7PlantFence(dir, provider, sessionId, agentId) {
  const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, provider, sessionId, agentId);
  const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
  const planted = rll.writeRegistryRecordReplace(fencePath, Buffer.from(JSON.stringify({
    schema: 'runtime/claude-authority-fence/v1',
    authority_identity_id: authorityIdentityId,
    reason: 'agent-return',
    fenced_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }), 'utf8'));
  assert.strictEqual(planted.ok, true, 'fixture: planting the simulated fence record must succeed: ' + JSON.stringify(planted));
  return { authorityIdentityId, fencePath };
}

// Stage C (M7-FINAL-REMEDIATION-20260818): mints a genuine action+ISSUED
// reservation for the root-source family via the REAL root-source CLI
// subcommand + the REAL agent-spawn-execution-gate.js hook -- the exact same
// proven ceremony scripts/tests/subagent-start-context-bundle.bats's own
// _mint_reserved_root_source_via_real_surfaces uses, ported to this file's
// direct-Node-call house style (no node -e subprocess wrapper needed, this
// file already runs under node:test). decodeRootSourceBootstrapIntentFromAction
// re-derives the bootstrap command's own digests against REAL on-disk PLAN.md/
// subject-bundle bytes -- hand-constructing an `action` object directly would
// require independently reimplementing that whole derivation, so this drives
// the real surfaces instead. Does NOT create the binding itself (the caller
// does that via rll.admitAndCreateRootSourceBinding, matching the real
// action -> reservation(ISSUED) -> consumed marker -> binding(v2) flow).
function mintReservedRootSourceViaRealSurfaces(dir, sessionId) {
  writePlanFixture(dir, 'm7-stagec-race-rootsource');
  const retainedFixture = require(path.resolve(__dirname, 'fixtures/runtime-consultation-grant-wrapper.cjs'));
  const agentGate = path.resolve(__dirname, '../../.claude/hooks/agent-spawn-execution-gate.js');

  const intent = {
    source_role: 'toolkit-specialist',
    reporting_architect: 'arch-platform',
    question: 'M7 Stage C RootSource mint-grant post-write race fixture question.',
    expected_result_kind: 'IMPLEMENTATION_REVIEW',
  };
  const encoded = Buffer.from(rc.canonicalJSONStringify(intent), 'utf8').toString('base64url');
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, 'race fixture: PLAN missing: ' + JSON.stringify(plan));
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(dir, identity);
  const main = rll.createMainOrchestratorBinding(dir, identity, rll.computeWorktreeId(dir), plan.planDigest, 3600);
  assert.strictEqual(generation.ok, true, 'race fixture: session generation resolve failed: ' + JSON.stringify(generation));
  assert.strictEqual(main.ok, true, 'race fixture: main orchestrator binding failed: ' + JSON.stringify(main));
  retainedFixture.establishRetainedCodexSupportPlane(dir, main.binding);
  const grant = rll.mintLifecycleCommandGrant(
    dir, main.binding, rc.sha256String('root-source:' + encoded),
    'toolkit-specialist', 'root-source', 'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(grant.ok, true, 'race fixture: root-source lifecycle admission failed: ' + JSON.stringify(grant));
  const cli = spawnSync(process.execPath, [
    IMPL, 'root-source', '--project-root', dir, '--intent', encoded,
    '--lifecycle-binding', grant.grantId,
  ], { encoding: 'utf8', env: process.env });
  assert.strictEqual(cli.status, 0, 'race fixture: real root-source CLI failed: ' + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
  const envelope = JSON.parse(cli.stdout);
  assert.strictEqual(envelope.status, 'ACTION_REQUIRED', 'race fixture: root-source did not return ACTION_REQUIRED: ' + JSON.stringify(envelope));
  assert.strictEqual(envelope.operation && envelope.operation.kind, 'root-source');
  assert.strictEqual(Array.isArray(envelope.actions) && envelope.actions.length, 1);
  const action = envelope.actions[0];
  const p = action.payload;
  const gate = spawnSync(process.execPath, [agentGate], {
    input: JSON.stringify({
      tool_name: 'Agent',
      tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
      tool_use_id: 'm7-stagec-rsb-race-agent-tool-use-01',
      session_id: sessionId,
      agent_type: '',
      agent_id: '',
    }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_WAVE_SLUG: '' }),
  });
  let gateBody = null;
  try { gateBody = JSON.parse(gate.stdout); } catch { /* asserted below */ }
  assert.ok(
    gate.status === 0 && gateBody && gateBody.hookSpecificOutput && gateBody.hookSpecificOutput.permissionDecision === 'allow',
    'race fixture: real Agent gate did not reserve the root source: ' + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }),
  );
  return { actionId: action.action_id };
}

// ── mintRootSourceReservation: direct discriminant coverage ────────────────
// mintRootSourceReservation is the actual pre-mint authority gate
// (agent-spawn-execution-gate.js:360 is its one production caller). Until
// now it had no test that calls it directly by name -- only indirect
// happy-path coverage through the hook subprocess above
// (mintReservedRootSourceViaRealSurfaces). The tests below mint a real
// action through the same live CLI surface and call
// rll.mintRootSourceReservation directly, covering the discriminants a
// pre-mint authority proof must reject: missing proof, expired proof, wrong
// session/binding correlation, digest mismatch, malformed bytes, and
// one-use replay.

function mintPendingRootSourceActionAndContext(dir, sessionId, label) {
  writePlanFixture(dir, 'rll-registry-mint-discriminant-' + label);
  const retainedFixture = require(path.resolve(__dirname, 'fixtures/runtime-consultation-grant-wrapper.cjs'));
  const intent = {
    source_role: 'toolkit-specialist',
    reporting_architect: 'arch-platform',
    question: 'ROOT-SOURCE-MINT-DISCRIMINANT fixture question (' + label + ').',
    expected_result_kind: 'IMPLEMENTATION_REVIEW',
  };
  const encoded = Buffer.from(rc.canonicalJSONStringify(intent), 'utf8').toString('base64url');
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, 'mint-discriminant fixture: PLAN missing: ' + JSON.stringify(plan));
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(dir, identity);
  const main = rll.createMainOrchestratorBinding(dir, identity, rll.computeWorktreeId(dir), plan.planDigest, 3600);
  assert.strictEqual(generation.ok, true, 'mint-discriminant fixture: session generation resolve failed: ' + JSON.stringify(generation));
  assert.strictEqual(main.ok, true, 'mint-discriminant fixture: main orchestrator binding failed: ' + JSON.stringify(main));
  // establishRetainedCodexSupportPlane's in-process mintSupervisorExecutionClaim
  // call is hard-gated behind isFakeExecutorCapability() (mirrors the
  // M7-STAGEC race fixture above) -- save/restore so no other test in this
  // same node:test process observes test-capability mode leaking in.
  const priorNodeEnv = process.env.NODE_ENV;
  const priorTestCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const priorExecCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY;
  process.env.NODE_ENV = 'test';
  process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'root-source-mint-discriminant-fixture';
  process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = 'root-source-mint-discriminant-fixture';
  try {
    retainedFixture.establishRetainedCodexSupportPlane(dir, main.binding);
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorTestCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = priorTestCap;
    if (priorExecCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = priorExecCap;
  }
  const grant = rll.mintLifecycleCommandGrant(
    dir, main.binding, rc.sha256String('root-source:' + encoded),
    'toolkit-specialist', 'root-source', 'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(grant.ok, true, 'mint-discriminant fixture: root-source lifecycle admission failed: ' + JSON.stringify(grant));
  const cli = spawnSync(process.execPath, [
    IMPL, 'root-source', '--project-root', dir, '--intent', encoded,
    '--lifecycle-binding', grant.grantId,
  ], { encoding: 'utf8', env: process.env });
  assert.strictEqual(cli.status, 0, 'mint-discriminant fixture: real root-source CLI failed: ' + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
  const envelope = JSON.parse(cli.stdout);
  assert.strictEqual(envelope.status, 'ACTION_REQUIRED', 'mint-discriminant fixture: root-source did not return ACTION_REQUIRED: ' + JSON.stringify(envelope));
  const action = envelope.actions[0];
  return {
    action,
    context: {
      mainBindingId: main.binding.binding_id,
      sessionGenerationId: generation.generationId,
      runtimeSessionKey: sessionId,
      toolUseId: 'rll-registry-mint-discriminant-' + label + '-tool-use-01',
      toolInput: { subagent_type: action.payload.agent_type, name: action.payload.name, prompt: action.payload.bootstrap_message },
    },
  };
}

test('ROOT-SOURCE-MINT-DISCRIMINANT-01 (positive + replay): mintRootSourceReservation accepts a genuine, fully-correlated action+context exactly once -- the durable reservation record it publishes matches the action, and an identical second mint attempt against the SAME action_id is denied as a replay, never silently re-accepted', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd01-session';
  try {
    const { action, context } = mintPendingRootSourceActionAndContext(dir, sessionId, 'positive-replay');
    const first = rll.mintRootSourceReservation(dir, action, context);
    assert.strictEqual(first.ok, true, 'a genuine action+context must mint: ' + JSON.stringify(first));
    assert.strictEqual(first.reservation.action_id, action.action_id);
    assert.strictEqual(first.reservation.action_digest, rc.sha256String(rc.canonicalJSONStringify(action)));
    assert.strictEqual(first.reservation.expiry, action.expires_at);

    const second = rll.mintRootSourceReservation(dir, action, context);
    assert.strictEqual(second.ok, false, 'an identical second mint for the same action_id must be denied as a replay, not silently re-accepted: ' + JSON.stringify(second));
    assert.strictEqual(second.reason, 'root-source-reservation-publish-failed');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ROOT-SOURCE-MINT-DISCRIMINANT-02 (missing proof): mintRootSourceReservation rejects an empty/absent reservation context outright', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd02-session';
  try {
    const { action } = mintPendingRootSourceActionAndContext(dir, sessionId, 'missing-proof');
    const result = rll.mintRootSourceReservation(dir, action, {});
    assert.strictEqual(result.ok, false, 'an empty context must never mint: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'root-source-reservation-context-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ROOT-SOURCE-MINT-DISCRIMINANT-03 (expired proof): mintRootSourceReservation rejects an action whose own expires_at has already passed, before ever consulting context', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd03-session';
  try {
    const { action, context } = mintPendingRootSourceActionAndContext(dir, sessionId, 'expired-proof');
    const expired = Object.assign({}, action, { expires_at: canonicalIsoAt(Date.now() - 60000) });
    const result = rll.mintRootSourceReservation(dir, expired, context);
    assert.strictEqual(result.ok, false, 'an already-expired action must never mint: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'root-source-action-expired');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ROOT-SOURCE-MINT-DISCRIMINANT-04 (wrong session correlation): mintRootSourceReservation rejects a context whose sessionGenerationId does not correlate to the action it is trying to reserve', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd04-session';
  try {
    const { action, context } = mintPendingRootSourceActionAndContext(dir, sessionId, 'wrong-generation');
    const wrongGeneration = Object.assign({}, context, { sessionGenerationId: crypto.randomBytes(16).toString('hex') });
    const result = rll.mintRootSourceReservation(dir, action, wrongGeneration);
    assert.strictEqual(result.ok, false, 'a session_generation_id that does not correlate to the action must never mint: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'root-source-reservation-context-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ROOT-SOURCE-MINT-DISCRIMINANT-05 (wrong binding correlation): mintRootSourceReservation rejects a syntactically-valid mainBindingId that does not correspond to a real, matching main-orchestrator binding', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd05-session';
  try {
    const { action, context } = mintPendingRootSourceActionAndContext(dir, sessionId, 'wrong-binding');
    const wrongBinding = Object.assign({}, context, { mainBindingId: crypto.randomBytes(16).toString('hex') });
    const result = rll.mintRootSourceReservation(dir, action, wrongBinding);
    assert.strictEqual(result.ok, false, 'an unrelated mainBindingId must never mint: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'root-source-reservation-main-binding-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ROOT-SOURCE-MINT-DISCRIMINANT-06 (digest mismatch): mintRootSourceReservation rejects an action whose plan_digest does not match the real, current PLAN bytes it claims to authorize against', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd06-session';
  try {
    const { action, context } = mintPendingRootSourceActionAndContext(dir, sessionId, 'digest-mismatch');
    const wrongDigestChar = action.plan_digest[0] === '0' ? '1' : '0';
    const tampered = Object.assign({}, action, { plan_digest: wrongDigestChar + action.plan_digest.slice(1) });
    const result = rll.mintRootSourceReservation(dir, tampered, context);
    assert.strictEqual(result.ok, false, 'a plan_digest not matching the real PLAN bytes must never mint: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'root-source-bootstrap-scope-mismatch');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ROOT-SOURCE-MINT-DISCRIMINANT-07 (malformed bytes): mintRootSourceReservation rejects an action whose bootstrap_message no longer matches the required ROOT_SOURCE_BOOTSTRAP/v1 shape', () => {
  const dir = makeGitProject();
  const sessionId = 'rsmd07-session';
  try {
    const { action, context } = mintPendingRootSourceActionAndContext(dir, sessionId, 'malformed-bytes');
    const corruptedMessage = action.payload.bootstrap_message.replace('ROOT_SOURCE_BOOTSTRAP/v1', 'ROOT_SOURCE_BOOTSTRAP/v999');
    const tampered = Object.assign({}, action, { payload: Object.assign({}, action.payload, { bootstrap_message: corruptedMessage }) });
    const result = rll.mintRootSourceReservation(dir, tampered, context);
    assert.strictEqual(result.ok, false, 'a corrupted bootstrap_message must never mint: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'root-source-bootstrap-shape-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CREATE-RACE-FENCE-13 (RED, cut-first): a fully durable fence landed BEFORE createRequesterBinding is attempted must deny the mint outright -- today createRequesterBinding never consults any fence and mints successfully. M7 CORRECTION (defect 11): rewritten to use a REAL claude-hook identity with genuine CLAUDE-ID-01 proof, never codex-supervisor -- the fence is Claude-domain-only (contract section 4.1: "the Claude fence is not applied to Codex actors"; section 12: "retained Codex HostBridge/disk-floor behavior is unchanged"). The prior codex-supervisor-backed version of this test could never go GREEN: fixing defect 11 makes a fenced codex-supervisor identity mint successfully, directly contradicting that version\'s own assertion.', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red13-cutfirst-session';
    const agentId = 'm7-red13-cutfirst-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    m7PlantFence(dir, 'claude-hook', sessionId, agentId);

    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(
      minted.ok, false,
      'M7 section 5 point 4 / section 8.1: a durably-fenced identity must be denied at create-binding admission, cut-first -- today createRequesterBinding has no fence concept at all and mints successfully: ' + JSON.stringify(minted)
    );
    assert.strictEqual(minted.reason, 'authority-fenced');

    // Positive control: the SAME call for a DIFFERENT, unfenced identity
    // (its OWN genuine CLAUDE-ID-01 proof) still succeeds -- proves the
    // denial above is about the fence specifically, never a broken fixture.
    const unfencedSessionId = 'm7-red13-cutfirst-unfenced-session';
    const unfencedAgentId = 'm7-red13-cutfirst-unfenced-agent';
    primeClaudeId01Trace(dir, role, unfencedSessionId, unfencedAgentId);
    const unfencedIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: unfencedSessionId };
    const control = rll.createRequesterBinding(dir, unfencedIdentity, unfencedAgentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(control.ok, true, 'positive control: an unfenced identity must still mint fine: ' + JSON.stringify(control));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CREATE-RACE-FENCE-13 (RED, admission-first race): a fence landing DURING the window between admission and the durable write must still deny the operation via a post-write predicate re-check, leaving only an inert record on disk -- today createRequesterBinding has no post-write re-check at all and unconditionally reports success. M7 CORRECTION (defect 11): rewritten to use a REAL claude-hook identity with genuine CLAUDE-ID-01 proof (primed in the PARENT process, on the SAME shared dir/registry the child reads) -- never codex-supervisor, same rationale as the cut-first sibling above.', async () => {
  const dir = makeGitProject();
  const rendezvousDir = m7MakeRendezvousDir();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const provider = 'claude-hook';
    const role = 'arch-testing';
    const sessionId = 'm7-red13-race-session';
    const agentId = 'm7-red13-race-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const childSource = [
      'const rll=require(process.argv[1]);',
      'const identity={ok:true,provider:process.argv[3],runtime_session_key:process.argv[4]};',
      'const out=rll.createRequesterBinding(process.argv[2],identity,process.argv[5],process.argv[6],process.argv[7],process.argv[8],3600);',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const result = await m7DriveRendezvousRace(
      ['-e', childSource, IMPL, dir, provider, sessionId, agentId, role, worktreeId, planDigest],
      { RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M7_RACE_CAPABILITY },
      'create-after-admission-before-write',
      rendezvousDir,
      async () => { m7PlantFence(dir, provider, sessionId, agentId); },
    );
    assert.strictEqual(result.exitCode, 0, 'race harness child must exit cleanly: ' + JSON.stringify(result));
    const childOut = JSON.parse(result.stdout);

    // Fixture/race sanity FIRST: the child's write must have genuinely landed
    // (proves the race harness reached the real post-admission write, never a
    // vacuous pre-write/pre-admission failure) -- checked BEFORE the RED
    // assertion below so a failure there is unambiguous fixture evidence,
    // never conflated with the semantic assertion itself.
    const bindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    let bindingFiles = [];
    try { bindingFiles = fs.readdirSync(bindingsDir); } catch { /* empty is a genuine failure below */ }
    assert.strictEqual(bindingFiles.length, 1, 'fixture sanity: the child must have genuinely written its (now-inert) binding record for this race to be meaningful: ' + JSON.stringify({ bindingFiles, childOut }));

    assert.strictEqual(
      childOut.ok, false,
      'M7 section 7: create-binding must rerun the complete authority predicate after its write and before returning success -- a fence that lands during the admission-to-write window must be caught by that post-write re-check, even though the record already physically landed (confirmed above). Today createRequesterBinding performs no post-write re-check at all: ' + JSON.stringify(childOut)
    );
    assert.strictEqual(childOut.reason, 'authority-fenced');
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-GRANT-RACE-FENCE-14 (RED, cut-first): a fully durable fence landed BEFORE mintRoleCommandGrant is attempted must deny the mint outright -- today mintRoleCommandGrant never consults any fence and mints successfully. M7 CORRECTION (defect 11): rewritten to use a REAL claude-hook identity with genuine CLAUDE-ID-01 proof, never codex-supervisor -- same M7-CODEX-COMPATIBILITY rationale as RED 13 above.', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red14-cutfirst-session';
    const agentId = 'm7-red14-cutfirst-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a real binding must mint before fencing: ' + JSON.stringify(minted));

    m7PlantFence(dir, 'claude-hook', sessionId, agentId);

    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(['--coordination-root', '/x']));
    const grant = rll.mintRoleCommandGrant(dir, minted.binding, 'requester', 'root-init', argvDigest, null, null, null);
    assert.strictEqual(
      grant.ok, false,
      'M7 section 5 point 4 / section 8.2: a durably-fenced identity must be denied at mint-grant admission, cut-first -- today mintRoleCommandGrant has no fence concept at all and mints successfully: ' + JSON.stringify(grant)
    );
    assert.strictEqual(grant.reason, 'authority-fenced');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-GRANT-RACE-FENCE-14 (RED, admission-first race): a fence landing DURING the window between mint-grant admission and the durable write must still deny the operation via a post-write predicate re-check, leaving only an inert grant on disk -- today mintRoleCommandGrant has no post-write re-check at all and unconditionally reports success. M7 CORRECTION (defect 11): rewritten to use a REAL claude-hook identity with genuine CLAUDE-ID-01 proof -- same M7-CODEX-COMPATIBILITY rationale as every other race RED in this section.', async () => {
  const dir = makeGitProject();
  const rendezvousDir = m7MakeRendezvousDir();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const provider = 'claude-hook';
    const role = 'arch-testing';
    const sessionId = 'm7-red14-race-session';
    const agentId = 'm7-red14-race-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const identity = { ok: true, provider, runtime_session_key: sessionId };
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a real binding must mint before the race: ' + JSON.stringify(minted));
    const bindingPath = rll.requesterBindingPathFor(dir, minted.binding.binding_id);

    const childSource = [
      'const rll=require(process.argv[1]);',
      'const rc=require(process.argv[2]);',
      'const fs=require("fs");',
      'const binding=JSON.parse(fs.readFileSync(process.argv[4],"utf8"));',
      'const argvDigest=rc.sha256String(rc.canonicalJSONStringify(["--coordination-root","/x"]));',
      'const out=rll.mintRoleCommandGrant(process.argv[3],binding,"requester","root-init",argvDigest,null,null,null);',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const result = await m7DriveRendezvousRace(
      ['-e', childSource, IMPL, RC_IMPL, dir, bindingPath],
      { RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M7_RACE_CAPABILITY },
      'grant-after-admission-before-write',
      rendezvousDir,
      async () => { m7PlantFence(dir, provider, sessionId, agentId); },
    );
    assert.strictEqual(result.exitCode, 0, 'race harness child must exit cleanly: ' + JSON.stringify(result));
    const childOut = JSON.parse(result.stdout);

    // Fixture/race sanity FIRST: the child's write must have genuinely landed
    // (proves the race harness reached the real post-admission write, never a
    // vacuous pre-write/pre-admission failure). mintRoleCommandGrant publishes
    // via roleCommandGrantPathFor -- a DIFFERENT registry path than
    // mintLifecycleCommandGrant's own grantPathFor/'grants' dir (confirmed by
    // direct read of the Fase-0 grant-wrapper fixture, which already uses
    // rll.roleCommandGrantPathFor for this exact grant family). Directory
    // listing, never an ID-derived path from childOut.grantId -- mirrors RED
    // 13's own already-correct admission-first pattern (createRequesterBinding's
    // analogous case): a denied post-write recheck does not echo back the
    // now-inert record's own id (confirmed empirically -- childOut carries
    // only {ok:false,reason} on this path, never grantId), and the M7
    // contract never requires it to.
    const grantsDir = path.dirname(rll.roleCommandGrantPathFor(dir, 'a'.repeat(32)));
    let grantFiles = [];
    try { grantFiles = fs.readdirSync(grantsDir); } catch { /* empty is a genuine failure below */ }
    assert.strictEqual(grantFiles.length, 1, 'fixture sanity: the child must have genuinely written its (now-inert) grant record for this race to be meaningful: ' + JSON.stringify({ grantFiles, childOut }));

    assert.strictEqual(
      childOut.ok, false,
      'M7 section 7: mint-grant must rerun the complete authority predicate after its write and before returning success -- a fence that lands during the admission-to-write window must be caught by that post-write re-check, even though the record already physically landed (confirmed above). Today mintRoleCommandGrant performs no post-write re-check at all: ' + JSON.stringify(childOut)
    );
    assert.strictEqual(childOut.reason, 'authority-fenced');
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Stage C (M7-FINAL-REMEDIATION-20260818) RED: mintRoleCommandGrant's own
// POST-write RootSource recheck reopens ingress but validates only
// `typeof ingressRead.obj.request_id === 'string'` -- a parseable, closed-
// shape ingress whose action_id does not correlate to the classifier's own
// binding still has a string request_id, so it silently proceeds straight to
// (a still-technically-passing) success rather than the canonical
// checkAuthorityOperationTransactionTerminal predicate
// (validateRootSourceIngressRecord) every OTHER caller of that check already
// uses -- confirmed already-correct by the pre-existing
// M7-R2-SHALLOW-ROOT-INGRESS-CORRELATION test above, called DIRECTLY (not
// through mintRoleCommandGrant's own duplicate shallow check). Uses the
// SAME 'grant-after-admission-before-write' rendezvous seam as
// M7-GRANT-RACE-FENCE-14 above, racing an ingress PLANT (absent -> present-
// but-decorrelated) instead of a fence plant.
// ════════════════════════════════════════════════════════════════════════════

test('M7-STAGEC-ROOT-POSTWRITE-RACE (RED): a root-source ingress record that lands DURING the window between mintRoleCommandGrant admission and its durable write -- parseable, closed-shape, a genuine string request_id, but action_id decorrelated from the classifier own binding -- must still deny the operation via the canonical post-write transaction-terminal recheck, leaving only an inert grant on disk. Today mintRoleCommandGrant only checks typeof request_id===\"string\" post-write and reports success.', async () => {
  const dir = makeGitProject();
  const rendezvousDir = m7MakeRendezvousDir();
  try {
    const sessionId = 'm7-stagec-race-session';
    const agentId = 'm7-stagec-race-agent';
    // mintReservedRootSourceViaRealSurfaces -> establishRetainedCodexSupportPlane
    // calls rll.mintSupervisorExecutionClaim IN THIS PROCESS (not a subprocess),
    // which requires isFakeExecutorCapability() (NODE_ENV=test +
    // RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY + the narrower purpose-specific
    // RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY, all non-empty) -- the
    // exact three env vars the proven bats fixture sets as OUTER env for its
    // whole `node -e` subprocess. This file's own process does not carry
    // them by default, so they are set here, save/restore-guarded (mirrors
    // establishRetainedCodexSupportPlane's own save/restore discipline for
    // RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY) so no OTHER test in
    // this same node:test process ever observes test-capability mode leaking in.
    const priorNodeEnv = process.env.NODE_ENV;
    const priorTestCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    const priorExecCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY;
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = M7_RACE_CAPABILITY;
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = 's16-subagent-retained-plane';
    let actionId;
    let created;
    try {
      ({ actionId } = mintReservedRootSourceViaRealSurfaces(dir, sessionId));
      created = rll.admitAndCreateRootSourceBinding(dir, actionId, {
        runtimeSessionKey: sessionId, agentType: 'toolkit-specialist', agentId,
      });
    } finally {
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
      if (priorTestCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = priorTestCap;
      if (priorExecCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = priorExecCap;
    }
    assert.strictEqual(created.ok, true, 'fixture: RootSource binding must genuinely create before the race: ' + JSON.stringify(created));
    const binding = created.binding;
    const bindingPath = path.join(rendezvousDir, 'binding.json');
    fs.writeFileSync(bindingPath, JSON.stringify(binding), { mode: 0o600 });

    const childSource = [
      'const rll=require(process.argv[1]);',
      'const rc=require(process.argv[2]);',
      'const fs=require("fs");',
      'const binding=JSON.parse(fs.readFileSync(process.argv[4],"utf8"));',
      'const argvDigest=rc.sha256String(rc.canonicalJSONStringify(["--coordination-root","/x"]));',
      'const out=rll.mintRoleCommandGrant(process.argv[3],binding,"requester","root-validate",argvDigest,null,null,null);',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const result = await m7DriveRendezvousRace(
      ['-e', childSource, IMPL, RC_IMPL, dir, bindingPath],
      { RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M7_RACE_CAPABILITY },
      'grant-after-admission-before-write',
      rendezvousDir,
      async () => {
        // Parseable, closed-shape, genuine string request_id -- but
        // action_id is a FRESH, unrelated action, never binding.action_id
        // (mirrors M7-R2-SHALLOW-ROOT-INGRESS-CORRELATION's own established
        // technique exactly). Ingress was genuinely ABSENT when Phase A ran
        // (root-validate is in the pre-ingress admitted-subcommand list, so
        // absence alone did not block admission) -- this plant is what turns
        // it present-but-decorrelated strictly between admission and write.
        const ingress = {
          schema: 'runtime/root-ingress/v1',
          binding_id: binding.binding_id,
          action_id: rll.generateActionId(),
          request_id: crypto.randomBytes(32).toString('hex'),
          request_digest: crypto.randomBytes(32).toString('hex'),
          source_role: 'toolkit-specialist',
          requester_instance_id: binding.actor_instance_id,
          target_role: 'arch-platform',
          subject_scope_digest: binding.subject_scope_digest,
          request_expiry: binding.request_expiry,
          worktree_id: binding.worktree_id,
          plan_digest: binding.plan_digest,
          created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
        const planted = rll.writeRegistryRecordReplace(rll.rootSourceIngressPathFor(dir, binding.binding_id), Buffer.from(JSON.stringify(ingress), 'utf8'));
        assert.strictEqual(planted.ok, true, 'race: ingress plant failed: ' + JSON.stringify(planted));
      },
    );
    assert.strictEqual(result.exitCode, 0, 'race harness child must exit cleanly: ' + JSON.stringify(result));
    const childOut = JSON.parse(result.stdout);

    // Fixture/race sanity FIRST (mirrors M7-GRANT-RACE-FENCE-14's own
    // established discipline): the child's write must have genuinely
    // landed, proving the race harness reached the real post-admission
    // write, never a vacuous pre-write/pre-admission failure.
    const grantsDir = path.dirname(rll.roleCommandGrantPathFor(dir, 'a'.repeat(32)));
    let grantFiles = [];
    try { grantFiles = fs.readdirSync(grantsDir); } catch { /* empty is a genuine failure below */ }
    assert.strictEqual(grantFiles.length, 1, 'fixture sanity: the child must have genuinely written its (now-inert) grant record for this race to be meaningful: ' + JSON.stringify({ grantFiles, childOut }));

    assert.strictEqual(
      childOut.ok, false,
      'Codex sequence-4 ruling (root_source_postwrite): mint-grant post-write RootSource handling must use the canonical checkAuthorityOperationTransactionTerminal predicate (full validateRootSourceIngressRecord correlation), never a shallow typeof-request_id check -- a decorrelated-but-parseable ingress landing in the admission-to-write window must still deny, even though the grant record already physically landed (confirmed above). Today it reports success: ' + JSON.stringify(childOut)
    );
    assert.ok(
      typeof childOut.reason === 'string' && childOut.reason.startsWith('root-source-transaction-terminal-read-failed'),
      'the canonical post-write failure reason must come from checkAuthorityOperationTransactionTerminal specifically, not a generic/different failure: ' + JSON.stringify(childOut)
    );
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 1 of 3): R2
// (M7-REQUESTER-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS). createRequesterBinding's
// own post-write predicate re-check (confirmed by direct read, ~L1898-1904)
// is FENCE-ONLY (readClaudeAuthorityFence + .absent) -- it never calls
// classifyClaudeAuthorityForIdentity. A cross-family race (a same-identity
// ONE-SHOT binding landing during the admission-to-write window) is
// therefore invisible to it: the requester write lands, the fence-only
// postcheck sees no fence, and createRequesterBinding wrongly reports
// success even though the identity now has TWO live candidates. The
// cut-first sibling below is a CONTROL, not itself a fresh defect: direct
// read confirms admitClaudeAuthorityOperation/classifyClaudeAuthorityForIdentity
// are already fully implemented and already wired into createRequesterBinding's
// own PRE-write admission call (~L1892-1893), so a fully-durable pre-existing
// one-shot binding is already correctly denied today -- it exists here only
// to isolate the race-specific defect from any other possible cause.
// ════════════════════════════════════════════════════════════════════════════

test('M7-REQUESTER-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS (RED, cut-first): a fully durable ONE-SHOT binding for the SAME identity landed BEFORE createRequesterBinding is even attempted must deny the mint outright via the pre-admission classify+expected-ABSENT check -- this cut-first ordering is ALREADY correctly denied today (admitClaudeAuthorityOperation/classifyClaudeAuthorityForIdentity already exist and are already wired into createRequesterBinding\'s own pre-write admission call); included as an isolating control for the admission-first race sibling below, which IS the genuine RED', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red-reqxfam-cutfirst-session';
    const agentId = 'm7-red-reqxfam-cutfirst-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);

    const cutfirstGen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(cutfirstGen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(cutfirstGen));
    const oneShot = rll.createClaudeOneShotBinding(
      dir, sessionId, cutfirstGen.generationId, agentId, role,
      rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
      0, role, worktreeId, planDigest, 600,
    );
    assert.strictEqual(oneShot.ok, true, 'fixture: a real one-shot binding must mint before the cut-first control: ' + JSON.stringify(oneShot));

    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(
      minted.ok, false,
      'M7 section 5/6/7: a durable one-shot binding for this exact identity must block a new requester bind at pre-write admission, cut-first: ' + JSON.stringify(minted)
    );
    assert.strictEqual(minted.reason, 'authority-binding-conflict');

    const requesterBindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    let requesterFiles = [];
    try { requesterFiles = fs.readdirSync(requesterBindingsDir); } catch { /* absent is fine */ }
    assert.strictEqual(requesterFiles.length, 0, 'M7 section 5: a cut-first denial must write ZERO requester-binding bytes: ' + JSON.stringify(requesterFiles));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-REQUESTER-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS (RED, admission-first race): a same-identity ONE-SHOT binding landing DURING the window between createRequesterBinding\'s own admission and its durable write must still deny the requester mint via a post-write predicate re-check using the FULL cross-family classifier -- today createRequesterBinding\'s post-write recheck is fence-only (readClaudeAuthorityFence+.absent), never classifyClaudeAuthorityForIdentity, so a cross-family ambiguity landing in that window is invisible to it and the requester mint wrongly reports success', async () => {
  const dir = makeGitProject();
  const rendezvousDir = m7MakeRendezvousDir();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const provider = 'claude-hook';
    const role = 'arch-testing';
    const sessionId = 'm7-red-reqxfam-race-session';
    const agentId = 'm7-red-reqxfam-race-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);

    const childSource = [
      'const rll=require(process.argv[1]);',
      'const identity={ok:true,provider:process.argv[3],runtime_session_key:process.argv[4]};',
      'const out=rll.createRequesterBinding(process.argv[2],identity,process.argv[5],process.argv[6],process.argv[7],process.argv[8],3600);',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const result = await m7DriveRendezvousRace(
      ['-e', childSource, IMPL, dir, provider, sessionId, agentId, role, worktreeId, planDigest],
      { RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M7_RACE_CAPABILITY },
      'create-after-admission-before-write',
      rendezvousDir,
      async () => {
        const raceGen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
        assert.strictEqual(raceGen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(raceGen));
        const oneShot = rll.createClaudeOneShotBinding(
          dir, sessionId, raceGen.generationId, agentId, role,
          rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
          0, role, worktreeId, planDigest, 600,
        );
        assert.strictEqual(oneShot.ok, true, 'fixture: the competing one-shot bind (planted while the requester bind is paused) must genuinely succeed: ' + JSON.stringify(oneShot));
      },
    );
    assert.strictEqual(result.exitCode, 0, 'race harness child must exit cleanly: ' + JSON.stringify(result));
    const childOut = JSON.parse(result.stdout);

    // Fixture/race sanity FIRST, from a DIFFERENT source than the semantic
    // assertion below (direct filesystem reads, mirroring RED 13's own
    // established split): both families' writes must have genuinely landed.
    const requesterBindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    const oneShotBindingsDir = path.join(rll.registryRepoDir(dir), 'claude-one-shot-bindings');
    let requesterFiles = [];
    let oneShotFiles = [];
    try { requesterFiles = fs.readdirSync(requesterBindingsDir); } catch { /* empty is a genuine failure below */ }
    try { oneShotFiles = fs.readdirSync(oneShotBindingsDir); } catch { /* empty is a genuine failure below */ }
    assert.strictEqual(requesterFiles.length, 1, 'fixture sanity: the paused requester bind must have genuinely written its (now-inert) record for this race to be meaningful: ' + JSON.stringify({ requesterFiles, childOut }));
    assert.strictEqual(oneShotFiles.length, 1, 'fixture sanity: the competing one-shot bind must have genuinely landed too: ' + JSON.stringify({ oneShotFiles, childOut }));

    assert.strictEqual(
      childOut.ok, false,
      'M7 section 7: create-binding must rerun the COMPLETE authority predicate (the cross-family classifier, not just the fence) after its write and before returning success -- a same-identity one-shot binding landing during the admission-to-write window must be caught by that post-write re-check, even though the requester record already physically landed (confirmed above). Today createRequesterBinding\'s post-write recheck only reads the fence: ' + JSON.stringify(childOut)
    );
    assert.strictEqual(childOut.reason, 'authority-current-binding-ambiguous');

    // Independent, non-vacuous proof that the losing record cannot be used
    // as sole authority downstream: the SAME canonical classifier the
    // (currently insufficient) postcheck above should have consulted
    // already correctly reports this identity as ambiguous.
    const authorityIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider,
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const classified = rll.classifyClaudeAuthorityForIdentity(dir, authorityIdentity);
    assert.strictEqual(classified.ok, false, 'the canonical classifier must independently confirm this identity is ambiguous, never a sole live ONE: ' + JSON.stringify(classified));
    assert.strictEqual(classified.reason, 'authority-current-binding-ambiguous');
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 CORRECTION defect 11 (M7-CODEX-COMPATIBILITY-GATE): the Claude fence must
// never apply to a codex-supervisor identity -- M7 contract section 4.1 ("the
// Claude fence is not applied to Codex actors") and section 12 ("retained Codex
// HostBridge/disk-floor behavior is unchanged"). Confirmed by direct read
// (2026-08-17): createRequesterBinding (~L1847-1852) builds its
// authorityIdentity from identity.provider UNCONDITIONALLY and calls
// admitClaudeAuthorityOperation for every provider; mintRoleCommandGrant's own
// requester branch (~L4636-4647, ~L4769) does the identical thing via
// `binding.runtime` -- both apply the SAME Claude-domain fence/classifier pass
// to a codex-supervisor identity as they do to a claude-hook one. This is the
// SAME defect the pre-correction RED 13/14 race tests above inadvertently
// exercised (and asserted the wrong, current-buggy outcome) by using
// codex-supervisor as their own fence-race identity -- see this file's own
// M7-CREATE-RACE-FENCE-13/M7-GRANT-RACE-FENCE-14 header comments for that
// correction. These two tests are the genuine, dedicated positive-proof for
// the underlying gap itself: a Claude-domain fence planted for a
// codex-supervisor-shaped identity tuple must have ZERO effect on that
// identity's own createRequesterBinding/mintRoleCommandGrant calls.
// ════════════════════════════════════════════════════════════════════════════

test('M7-CODEX-COMPATIBILITY-GATE-11 (RED, create-binding): a fully durable Claude-domain fence planted for a codex-supervisor identity tuple must have ZERO effect on that identity\'s own createRequesterBinding call -- the Claude fence is Claude-hook-domain-only (M7 section 4.1/12); today createRequesterBinding builds its authorityIdentity from identity.provider unconditionally and runs the SAME admitClaudeAuthorityOperation/classifier pass for every provider, so a codex-supervisor identity is wrongly denied exactly as if it were a fenced claude-hook one', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const provider = 'codex-supervisor';
    const sessionId = 'm7-red11-codex-create-session';
    const agentId = 'm7-red11-codex-create-agent';
    // Plants the fence at the EXACT path/identity-id a Claude-domain fence for
    // THIS codex-supervisor tuple would occupy -- proves the gap is real even
    // when a record genuinely exists there, never merely "no fence was ever
    // written for anyone".
    m7PlantFence(dir, provider, sessionId, agentId);
    const identity = { ok: true, provider, runtime_session_key: sessionId };

    const minted = rll.createRequesterBinding(dir, identity, agentId, 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(
      minted.ok, true,
      'M7 section 4.1/12: the Claude actor fence must NEVER apply to a codex-supervisor identity -- Codex keeps its existing retained-host proof path, untouched by M7. Today createRequesterBinding applies the SAME admitClaudeAuthorityOperation/classifier pass to every provider, so a Claude-domain fence planted for this codex-supervisor tuple wrongly denies it: ' + JSON.stringify(minted)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CODEX-COMPATIBILITY-GATE-11 (RED, mint-grant): a fully durable Claude-domain fence planted for a codex-supervisor identity tuple must have ZERO effect on that identity\'s own mintRoleCommandGrant call -- mirrors the create-binding case above, for the mint-grant admission point (mintRoleCommandGrant\'s own requester branch ALSO treats any REQUESTER_BINDING_SCHEMA_V2/ROOT_SOURCE_BINDING_SCHEMA_V2 backing as Claude-authority-v2, regardless of the binding\'s own runtime/provider field)', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const provider = 'codex-supervisor';
    const sessionId = 'm7-red11-codex-grant-session';
    const agentId = 'm7-red11-codex-grant-agent';
    const identity = { ok: true, provider, runtime_session_key: sessionId };
    const minted = rll.createRequesterBinding(dir, identity, agentId, 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a real binding must mint before fencing: ' + JSON.stringify(minted));

    m7PlantFence(dir, provider, sessionId, agentId);

    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(['--coordination-root', '/x']));
    const grant = rll.mintRoleCommandGrant(dir, minted.binding, 'requester', 'root-init', argvDigest, null, null, null);
    assert.strictEqual(
      grant.ok, true,
      'M7 section 4.1/12: the Claude actor fence must NEVER apply to a codex-supervisor identity at mint-grant admission either. Today mintRoleCommandGrant\'s requester branch also builds its Claude-authority identity from binding.runtime unconditionally: ' + JSON.stringify(grant)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group C (test-specialist, dispatch arch-testing-20260816T160058Z):
// RED 19 (M7-EXPIRY-ZERO-WRITE). Contract section 1 point 3: "Expiry and exact
// SessionGeneration mismatch are read-only cuts." Section 5 closing sentence:
// "Expiry, generation mismatch, and a valid terminal are ordinary non-live
// results and write zero bytes." mintRoleCommandGrant takes its `binding`
// parameter as a direct caller-supplied object -- confirmed by direct read
// that it never re-reads/re-validates it from disk, and performs no
// binding.expiry comparison against the current clock anywhere in its own
// body (unlike validateRequesterBindingFor, which does). Section 7's future
// admitClaudeAuthorityOperation closes exactly this: every admission point
// independently re-derives the full predicate from a fresh read, never
// trusting a caller-held object. Simulates the realistic gap this closes --
// a stale/already-expired binding object reaching mint-grant without a fresh
// re-check -- the same "never trusted from mint time, always independently
// re-verified" discipline this file's own WP3 grant tests already establish
// for tampered post-mint fields, applied here to binding expiry specifically.
// ════════════════════════════════════════════════════════════════════════════

test('M7-EXPIRY-ZERO-WRITE-19 (RED): mintRoleCommandGrant must independently re-verify its own backing binding is unexpired (a read-only cut, write zero bytes) rather than trusting the caller-supplied object -- today it performs no expiry check on the binding at all and mints successfully even when passed an already-expired one', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'm7-red19-session' };
    const minted = rll.createRequesterBinding(dir, identity, 'm7-red19-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a real binding must mint before expiring it: ' + JSON.stringify(minted));

    // A genuinely-expired backing object -- e.g. a caller holding a
    // moments-stale reference, or a fresh read after real expiry passed --
    // must never be trusted from mint time (M7 section 1 point 3 / section 5).
    const expiredBinding = Object.assign({}, minted.binding, { expiry: '2000-01-01T00:00:00Z' });

    // Derived, never guessed: mintRoleCommandGrant's own real grants
    // directory, via its own path helper with a placeholder id -- avoids
    // hand-picking a directory-name string literal that might not match
    // (this bit me for RED 14's own grantsDir guess before I fixed it).
    const roleCommandGrantsDir = path.dirname(rll.roleCommandGrantPathFor(dir, 'a'.repeat(32)));
    let filesBefore = [];
    try { filesBefore = fs.readdirSync(roleCommandGrantsDir); } catch { /* directory may not exist yet -- also fine */ }

    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(['--coordination-root', '/x']));
    const grant = rll.mintRoleCommandGrant(dir, expiredBinding, 'requester', 'root-init', argvDigest, null, null, null);
    assert.strictEqual(
      grant.ok, false,
      'M7 section 1 point 3 / section 5: expiry is a read-only cut -- mint-grant must independently re-verify the backing binding is unexpired and write ZERO bytes, never mint against an already-expired binding object -- today mintRoleCommandGrant performs no expiry check on its binding parameter at all: ' + JSON.stringify(grant)
    );

    let filesAfter = [];
    try { filesAfter = fs.readdirSync(roleCommandGrantsDir); } catch { /* also fine */ }
    assert.deepStrictEqual(filesAfter, filesBefore, 'M7 section 5: a denied expiry cut must write ZERO bytes -- no grant file may appear at all, not even an inert one (unlike the fence-race case in RED 13/14)');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group C guards (24-29): existing-behavior preservation, per
// contract section 10.4 -- "guards, not falsely labelled fresh REDs". These
// must PASS today (confirming current-correct behavior) and continue passing
// once GREEN lands; they exist to catch a regression, never to drive one.
// ════════════════════════════════════════════════════════════════════════════

test('M7-REQUESTER-EXPIRY-CAP-GUARD-24 (guard, preserve): createRequesterBinding already caps a freshly-minted binding\'s expiry to the current SessionGeneration.expires_at, never the full requested ttlSeconds when that would exceed it -- M7 section 2.1 confirms this EXISTING behavior; this guard locks it against silent regression', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'm7-guard24-session' };
    // Resolve the live generation FIRST so its own expires_at is fixed and
    // known before the mint below (which re-derives/reuses the SAME
    // generation for this identity tuple internally).
    const generation = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(generation.ok, true, 'fixture: a live generation must resolve: ' + JSON.stringify(generation));

    // A ttlSeconds request FAR beyond the generation's own remaining
    // lifetime -- if the cap did not apply, the binding's own expiry would
    // sail past the generation's expires_at.
    const minted = rll.createRequesterBinding(dir, identity, 'm7-guard24-agent', 'arch-testing', worktreeId, planDigest, 999999999);
    assert.strictEqual(minted.ok, true, 'fixture: mint must succeed: ' + JSON.stringify(minted));
    assert.strictEqual(
      minted.binding.expiry, generation.expiresAt,
      'M7 section 2.1 (existing behavior, guarded against regression): a requested ttlSeconds exceeding the live SessionGeneration\'s own remaining lifetime must be capped to generation.expiresAt exactly, never granted in full: ' + JSON.stringify({ binding: minted.binding, generation })
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-NO-RECOVERY-ABI-GUARD-26 (guard, preserve): neither runtime-role-lifecycle.cjs nor runtime-consultation.cjs define a resume-* command or an AuthorityIdentityLock concept -- M7 section 1 is explicit this design deliberately has neither (along with a stop seal, stale-lock sweep, PID recovery, deletion-based retirement, or best-effort lock stealing, none of which this codebase has ever implemented either) -- this guard locks the one concretely-checkable piece (a literal resume-* command string, or the AuthorityIdentityLock name) against silent regression', () => {
  const rllSrc = fs.readFileSync(IMPL, 'utf8');
  const rcSrc = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-consultation.cjs'), 'utf8');
  assert.ok(!rllSrc.includes("'resume-"), 'runtime-role-lifecycle.cjs must never define a resume-* subcommand string literal');
  assert.ok(!rcSrc.includes("'resume-"), 'runtime-consultation.cjs must never define a resume-* subcommand string literal');
  assert.ok(!rllSrc.includes('AuthorityIdentityLock'), 'runtime-role-lifecycle.cjs must never introduce an AuthorityIdentityLock concept');
  assert.ok(!rcSrc.includes('AuthorityIdentityLock'), 'runtime-consultation.cjs must never introduce an AuthorityIdentityLock concept');
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group C: RED 23 (M7-TRACE-CLEANUP-NONAUTH). Contract section
// 8.4: "publishes the identity fence FIRST" (bullet 1, ordering) ... "After a
// durable fence, raw CLAUDE-ID trace/event cleanup may run best-effort...
// Cleanup failure cannot restore authority and must not convert the durable
// fence into an allow decision." Resolved with team-lead: this is scoped to
// what a LATER authority check sees (the fence must already be durable
// before cleanup even starts, so a cleanup failure afterward can never
// un-write it) -- it says nothing about whether THIS stop call itself
// reports block, which is a separate, already-correct, already-tested layer
// (the pre-existing "item 4 regression" test) that this RED deliberately
// does NOT re-litigate. Reuses that exact same injected-unlink-failure
// technique (chmod the traces dir read+execute-only) to force a genuine
// cleanup failure, then asserts the fence still exists at its independently-
// computed path -- proving the ordering/independence guarantee holds even
// under the adverse cleanup-failure condition specifically, distinct from
// REDs 8/9/11/12's own clean-path fence coverage. The block-outcome
// assertion is included only as unchanged fixture/regression sanity, never
// the property this RED itself targets.
// ════════════════════════════════════════════════════════════════════════════

test('M7-TRACE-CLEANUP-NONAUTH-23 (RED): a durable fence must already be written BEFORE CLAUDE-ID-01 trace cleanup even attempts to run, so an injected cleanup failure (which correctly still blocks the stop, unchanged) can never prevent the fence from existing -- today no fence mechanism exists at all, so the fence file is absent regardless of the cleanup outcome', () => {
  const dir = claudeId01MakeGitProjectOnWaveBranch('m7-red23-cleanup-nonauth');
  try {
    const role = 'arch-testing';
    const sessionId = 'm7-red23-session';
    const agentId = 'm7-red23-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const recordPath = claudeId01FindSoleTraceRecordPath(dir);
    const tracesDir = path.dirname(recordPath);
    const originalMode = fs.statSync(tracesDir).mode & 0o777;
    // Same fault-injection technique the pre-existing "item 4 regression"
    // test already uses: unlink requires write permission on the containing
    // directory, so read+execute-only forces a genuine cleanup failure.
    fs.chmodSync(tracesDir, 0o500);
    try {
      const stopResult = claudeId01DriveSubagentStop(dir, role, sessionId, agentId);
      assert.strictEqual(stopResult.status, 0, 'SubagentStop must exit 0 per the official hook protocol: ' + stopResult.stderr);
      let parsed = null;
      try { parsed = JSON.parse((stopResult.stdout || '').trim()); } catch { /* handled by the assertion below */ }
      assert.ok(
        parsed && parsed.decision === 'block',
        'fixture/regression sanity (UNCHANGED from the pre-existing item-4 test, never what this RED itself targets): a genuine cleanup failure must still block the stop: ' + JSON.stringify(stopResult)
      );

      const authorityIdentityId = computeExpectedM7AuthorityIdentityId(dir, 'claude-hook', sessionId, agentId);
      const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
      assert.strictEqual(
        fs.existsSync(fencePath), true,
        'M7 section 8.4: "publishes the identity fence first" -- fence-writing must be ordered BEFORE trace cleanup even attempts to run, so a cleanup failure (which correctly still blocks the stop, per the unchanged assertion above) can never prevent the fence from being durably written. Today handleSubagentStop has no fence-writing logic at all, so the fence is absent regardless of cleanup outcome: ' + JSON.stringify({ fencePath, stopResult })
      );
    } finally {
      fs.chmodSync(tracesDir, originalMode);
    }
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-ROLEACTOR-COMPAT-GUARD-27 (guard, preserve): RoleActorBinding creation never references the M7 Claude-actor-fence mechanism -- M7 section 2.2 is explicit that RoleActorBinding, retained Codex supervisor authority, lifecycle grants, and one-shot worker-stop-ack all remain outside this Claude actor-cut contract; this guard locks that structural isolation against silent regression once fence-awareness lands for the requester/root-source/one-shot families elsewhere in this file', () => {
  const src = fs.readFileSync(IMPL, 'utf8');
  const defIdx = src.indexOf('function createRoleActorBinding(');
  assert.notStrictEqual(defIdx, -1, 'fixture sanity: createRoleActorBinding must still be found as a named function in the source');
  const window = src.slice(defIdx, defIdx + 2000);
  const nextFunctionOffset = window.indexOf('\nfunction ', 'function createRoleActorBinding('.length);
  const body = nextFunctionOffset === -1 ? window : window.slice(0, nextFunctionOffset);
  assert.ok(!body.includes('authority-identity-fence'), 'M7 section 2.2 (existing behavior, guarded against regression): createRoleActorBinding must never reference the M7 fence mechanism -- it is explicitly outside the Claude actor-cut contract');
  assert.ok(!body.includes('classifyClaudeAuthorityForIdentity'), 'M7 section 2.2 (existing behavior, guarded against regression): createRoleActorBinding must never call the M7 classifier -- it is explicitly outside the Claude actor-cut contract');
});

test('M7-PRIVATE-REGISTRY-GUARD-28 (guard, preserve): the M7 rendezvous safety check silently no-ops for a directory inside the real registry root -- confirms this existing safety boundary before any race RED relies on it to keep test-only rendezvous I/O away from the private registry, per M7 section 10.1\'s own "outside the runtime registry and coordination roots" requirement. resolveSafeM7RendezvousDir/testM7Rendezvous are module-private (fixture sanity below confirmed neither is exported), so this drives the SAME safety check indirectly through a real exported entry point (createRequesterBinding), exactly the way REDs 13/14 already do -- in-process via env vars rather than a child, since there is no race to synchronize here', () => {
  assert.strictEqual(typeof rll.resolveSafeM7RendezvousDir, 'undefined', 'fixture sanity: resolveSafeM7RendezvousDir is module-private, confirming this guard must go through a real exported entry point instead');
  const dir = makeGitProject();
  const savedCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedStage = process.env.RUNTIME_M7_TEST_STAGE;
  const savedRendezvousDir = process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR;
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const insideRegistry = path.join(rll.registryRepoDir(dir), 'm7-guard28-attempt');
    fs.mkdirSync(insideRegistry, { recursive: true, mode: 0o700 });

    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'm7-guard28-capability';
    process.env.RUNTIME_M7_TEST_STAGE = 'create-after-admission-before-write';
    process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR = insideRegistry;

    const identity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'm7-guard28-session' };
    // If the safety check were broken (accepting a registry-internal
    // directory as safe), this call would durably pause waiting for a .go
    // sentinel nothing in this synchronous test ever writes, and eventually
    // throw its own 5000ms timeout -- completing synchronously and quickly
    // is itself part of the proof, not just the assertions below.
    const minted = rll.createRequesterBinding(dir, identity, 'm7-guard28-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: the mint itself must still succeed -- the safety check no-ops the rendezvous only, never the underlying operation: ' + JSON.stringify(minted));
    assert.strictEqual(
      fs.existsSync(path.join(insideRegistry, 'create-after-admission-before-write.ready')), false,
      'M7 section 10.1: a rendezvous directory inside the real registry root must be rejected as unsafe -- no .ready sentinel may ever be written there'
    );
  } finally {
    if (savedCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedCap;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedStage === undefined) delete process.env.RUNTIME_M7_TEST_STAGE; else process.env.RUNTIME_M7_TEST_STAGE = savedStage;
    if (savedRendezvousDir === undefined) delete process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR; else process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR = savedRendezvousDir;
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 CORRECTION defects 1+2 (M7-ADMISSION-STATE-BLIND / M7-CREATOR-DUPLICATE):
// admitClaudeAuthorityOperation (~L4528) never checks operationKind against
// classification.state -- 'create-binding' succeeds whenever state isn't
// FENCED, regardless of whether it is ABSENT (correct precondition for a
// fresh create) or ONE (a candidate, in ANY family, already exists). Layered
// on top: createRequesterBinding's own postcheck (~L1875-1881) and
// createClaudeOneShotBinding's own postcheck (~L4077-4083) are BOTH
// fence-only -- neither re-runs the classifier to confirm exactly ONE
// candidate of the right family/binding_id survived. createClaudeOneShotBinding
// additionally never scans its OWN family at all before minting (unlike
// createRequesterBinding, which does scan requester-bindings/ -- GROUP-A
// above). The two tests below are the direct, creator-level proof: (1) an
// identical repeated createClaudeOneShotBinding call mints a genuinely
// SECOND, independently-live binding instead of reusing the first; (2) a
// requester binding already live for an identity lets a SECOND, cross-family
// createClaudeOneShotBinding call for the SAME identity succeed anyway.
// ════════════════════════════════════════════════════════════════════════════

test('M7-ONESHOT-DUPLICATE-IDENTICAL-CREATE (RED): a second createClaudeOneShotBinding call with the IDENTICAL full parameter set (same session/agent/role/action/request/attempt/epoch) as an already-live binding must NOT result in two independently-live bindings for the same logical spawn -- today createClaudeOneShotBinding scans nothing before minting and always crypto.randomBytes(16)s a brand-new binding_id, so an identical second call mints a genuinely SECOND, independently-live binding', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-oneshot-dup-session';
    const agentId = 'm7-oneshot-dup-agent';
    const role = 'arch-testing';
    const actionId = rll.generateActionId();
    const requestId = crypto.randomBytes(32).toString('hex');
    const attemptId = crypto.randomBytes(32).toString('hex');
    const dupGen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(dupGen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(dupGen));

    const first = rll.createClaudeOneShotBinding(dir, sessionId, dupGen.generationId, agentId, role, actionId, requestId, attemptId, 0, role, worktreeId, planDigest, 600);
    assert.strictEqual(first.ok, true, 'fixture: the first mint must genuinely succeed: ' + JSON.stringify(first));

    const second = rll.createClaudeOneShotBinding(dir, sessionId, dupGen.generationId, agentId, role, actionId, requestId, attemptId, 0, role, worktreeId, planDigest, 600);
    assert.strictEqual(second.ok, true, 'fixture sanity: the second call must also report success (either by reuse or an idempotent path) for this test to distinguish "reused" from "independently duplicated" below: ' + JSON.stringify(second));

    assert.strictEqual(
      second.binding.binding_id, first.binding.binding_id,
      'M7 section 6: "exactly one candidate may be reused only by its same family and exact current scope/role" -- an identical second createClaudeOneShotBinding call for the SAME logical spawn must reuse the SAME binding_id, never mint a genuinely independent second one. Today createClaudeOneShotBinding performs zero lookup-or-reuse of its own family at all: ' + JSON.stringify({ first: first.binding, second: second.binding })
    );

    // Discriminates "reused" from "two coincidentally-successful mints": the
    // one-shot family directory must contain exactly one record on disk for
    // this identical, repeated logical spawn, never two.
    const oneShotDir = path.join(rll.registryRepoDir(dir), 'claude-one-shot-bindings');
    const files = fs.readdirSync(oneShotDir).filter((f) => f.endsWith('.json'));
    assert.strictEqual(files.length, 1, 'exactly one claude-one-shot-bindings/ record must exist on disk for this identical, repeated logical spawn: ' + JSON.stringify(files));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CROSS-FAMILY-CREATE-REJECTED (RED): a requester binding minted for an identity, followed by a createClaudeOneShotBinding attempt for the IDENTICAL (session,agent) identity, must be REJECTED as the second family for the same identity -- today createClaudeOneShotBinding never scans any OTHER family before minting (defect 2), and admitClaudeAuthorityOperation never checks that create-binding admission requires classification state ABSENT specifically (defect 1), so the second, cross-family mint succeeds unconditionally, leaving TWO simultaneously-live authorities for one logical actor', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-crossfamily-create-session';
    const agentId = 'm7-crossfamily-create-agent';
    const requesterRole = 'arch-testing';
    const oneShotRole = 'toolkit-specialist';

    primeClaudeId01Trace(dir, requesterRole, sessionId, agentId);
    const requesterIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const mintedRequester = rll.createRequesterBinding(dir, requesterIdentity, agentId, requesterRole, worktreeId, planDigest, 3600);
    assert.strictEqual(mintedRequester.ok, true, 'fixture: the requester-family binding must genuinely mint first: ' + JSON.stringify(mintedRequester));

    const crossFamilyGen = rll.peekSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(crossFamilyGen.ok, true, 'fixture: the requester mint above must have already established a live session generation: ' + JSON.stringify(crossFamilyGen));
    const mintedOneShot = rll.createClaudeOneShotBinding(
      dir, sessionId, crossFamilyGen.generationId, agentId, oneShotRole,
      rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
      0, oneShotRole, worktreeId, planDigest, 600,
    );
    assert.strictEqual(
      mintedOneShot.ok, false,
      'M7 section 6/8.1: "a different family or scope blocks creation" -- a live requester-family binding must block a SECOND, cross-family (one-shot) mint for the identical (repo,session,agent) identity. Today createClaudeOneShotBinding performs zero cross-family scan and mints unconditionally: ' + JSON.stringify(mintedOneShot)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M7 mutation-testing follow-up (2026-08-17, Phase F): toolkit-specialist
// mutated admitClaudeAuthorityOperation's ABSENT-only create-binding
// admission check (defect 1, runtime-role-lifecycle.cjs ~L4478-4480) to also
// wrongly accept classification state ONE, then ran M7-CROSS-FAMILY-CREATE-REJECTED
// above -- it stayed green, failing to catch the mutation. Traced: that
// test's own attack order is requester-first, one-shot-second, and
// createClaudeOneShotBinding's own FULL postcheck (defect 4's fix --
// re-runs the classifier after write) independently catches the resulting
// ambiguity regardless of whether the admission-time check itself is
// mutated, masking the exact gap under test. createRequesterBinding's own
// postcheck is fence-only, never a full reclassify (confirmed by direct
// read, ~L1898-1904) -- so the OPPOSITE order (one-shot binding already
// live, then createRequesterBinding attempts the same identity) was never
// independently verified by any existing test. The test below closes that
// gap -- the missing sibling of M7-CROSS-FAMILY-CREATE-REJECTED, covering
// the reverse creation order.
test('M7-CROSS-FAMILY-CREATE-REJECTED-REVERSE-ORDER (regression): a live one-shot binding minted for an identity, followed by a createRequesterBinding attempt for the IDENTICAL (session,agent) identity, must be REJECTED as the second family for the same identity -- the opposite creation order from M7-CROSS-FAMILY-CREATE-REJECTED above, independently proving the SAME admission-time cross-family conflict check (defect 1) from the other direction, since createRequesterBinding\'s own postcheck (fence-only) cannot independently catch this the way createClaudeOneShotBinding\'s own full-reclassify postcheck (defect 4) does for the forward order', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-crossfamily-create-reverse-session';
    const agentId = 'm7-crossfamily-create-reverse-agent';
    const requesterRole = 'arch-testing';
    const oneShotRole = 'toolkit-specialist';

    const reverseGen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(reverseGen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(reverseGen));
    const mintedOneShot = rll.createClaudeOneShotBinding(
      dir, sessionId, reverseGen.generationId, agentId, oneShotRole,
      rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
      0, oneShotRole, worktreeId, planDigest, 600,
    );
    assert.strictEqual(mintedOneShot.ok, true, 'fixture: the one-shot-family binding must genuinely mint first: ' + JSON.stringify(mintedOneShot));

    // Prime CLAUDE-ID-01 for the requester side so the rejection under test
    // is attributable ONLY to the admission-time cross-family conflict
    // (defect 1's fix), never to an unrelated, missing CLAUDE-ID-01 proof.
    primeClaudeId01Trace(dir, requesterRole, sessionId, agentId);
    const requesterIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    const requesterBindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    const filesBefore = fs.existsSync(requesterBindingsDir) ? fs.readdirSync(requesterBindingsDir).filter((f) => f.endsWith('.json')).sort() : [];
    assert.deepStrictEqual(filesBefore, [], 'fixture sanity: requester-bindings/ must be genuinely empty before the rejected attempt, not merely unchanged');

    const mintedRequester = rll.createRequesterBinding(dir, requesterIdentity, agentId, requesterRole, worktreeId, planDigest, 3600);
    assert.strictEqual(
      mintedRequester.ok, false,
      'M7 section 6/8.1: "a different family or scope blocks creation" -- a live one-shot-family binding must block a SECOND, cross-family (requester) mint for the identical (repo,session,agent) identity, the opposite order from M7-CROSS-FAMILY-CREATE-REJECTED: ' + JSON.stringify(mintedRequester)
    );
    assert.strictEqual(
      mintedRequester.reason, 'authority-binding-conflict',
      'the specific rejection reason must be authority-binding-conflict (admitClaudeAuthorityOperation\'s own ABSENT-only create-binding admission check, defect 1), not some other, coincidental failure: ' + JSON.stringify(mintedRequester)
    );

    const filesAfter = fs.existsSync(requesterBindingsDir) ? fs.readdirSync(requesterBindingsDir).filter((f) => f.endsWith('.json')).sort() : [];
    assert.deepStrictEqual(filesAfter, filesBefore, 'zero requester-bindings/ record may be written on rejection: before=' + JSON.stringify(filesBefore) + ' after=' + JSON.stringify(filesAfter));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M7 mutation-testing follow-up (2026-08-17, Phase F, mutation 4):
// toolkit-specialist mutated createClaudeOneShotBinding's own postcheck
// (defect 4's fix) from the full classifyClaudeAuthorityForIdentity +
// checkClaudeAuthorityClassificationAgainstExpected re-check back to
// fence-only (mirroring createRequesterBinding's own current fence-only
// postcheck shape) and ran the full suite -- 148/148 passed, nothing caught
// it. Genuine, core-defect gap: contract section 7 requires the FULL
// postcheck specifically so a race that leaves the identity cross-family-
// ambiguous (not merely fenced) still gets caught -- "Race REDs prove both
// linearization orders" (section 10.3's own closing paragraph) applies here
// too, just for the admission-first ordering against a DIFFERENT family
// (requester, not fence) landing during the window. Mirrors
// M7-CREATE-RACE-FENCE-13's own admission-first race mechanics exactly (same
// rendezvous harness, same create-after-admission-before-write stage) -- the
// difference is the competing operation: a real createRequesterBinding mint
// for the SAME identity, not a fence plant.
test('M7-ONESHOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS (regression): a real createRequesterBinding mint landing DURING the window between createClaudeOneShotBinding\'s own admission and its durable write must still deny the one-shot creation via its post-write predicate re-check, leaving only an inert one-shot record on disk -- a weakened postcheck (fence-only, mirroring createRequesterBinding\'s own current shape, instead of the full cross-family classifier defect 4 requires) would let this race silently succeed with two simultaneously-live authorities for one logical actor', async () => {
  const dir = makeGitProject();
  const rendezvousDir = m7MakeRendezvousDir();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-oneshot-create-race-session';
    const agentId = 'm7-oneshot-create-race-agent';
    const requesterRole = 'arch-testing';
    const oneShotRole = 'toolkit-specialist';

    // Prime CLAUDE-ID-01 for the requester side in the PARENT, before the
    // race starts, on the SAME shared dir/registry the child reads --
    // mirrors M7-CREATE-RACE-FENCE-13's own identical convention.
    primeClaudeId01Trace(dir, requesterRole, sessionId, agentId);
    const requesterIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    const childSource = [
      'const rll=require(process.argv[1]);',
      'const crypto=require("crypto");',
      'const projectRoot=process.argv[2];',
      'const sessionId=process.argv[3];',
      'const agentId=process.argv[4];',
      'const role=process.argv[5];',
      'const worktreeId=process.argv[6];',
      'const planDigest=process.argv[7];',
      'const actionId=rll.generateActionId();',
      'const requestId=crypto.randomBytes(32).toString("hex");',
      'const attemptId=crypto.randomBytes(32).toString("hex");',
      'const childGen=rll.resolveSessionGeneration(projectRoot,{provider:"claude-hook",runtime_session_key:sessionId});',
      'if(!childGen.ok){process.stdout.write(JSON.stringify({ok:false,reason:"fixture-generation-resolve-failed",detail:childGen}));process.exit(0);}',
      'const out=rll.createClaudeOneShotBinding(projectRoot,sessionId,childGen.generationId,agentId,role,actionId,requestId,attemptId,0,role,worktreeId,planDigest,600);',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');
    const result = await m7DriveRendezvousRace(
      ['-e', childSource, IMPL, dir, sessionId, agentId, oneShotRole, worktreeId, planDigest],
      { RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M7_RACE_CAPABILITY },
      'create-after-admission-before-write',
      rendezvousDir,
      async () => {
        const mintedRequester = rll.createRequesterBinding(dir, requesterIdentity, agentId, requesterRole, worktreeId, planDigest, 3600);
        assert.strictEqual(mintedRequester.ok, true, 'competing op: the requester-family binding must genuinely mint for the SAME identity while the child is paused mid-admission: ' + JSON.stringify(mintedRequester));
      },
    );
    assert.strictEqual(result.exitCode, 0, 'race harness child must exit cleanly: ' + JSON.stringify(result));
    const childOut = JSON.parse(result.stdout);

    // Fixture/race sanity FIRST: the child's one-shot write must have
    // genuinely landed (proves the race harness reached the real
    // post-admission write, never a vacuous pre-write/pre-admission
    // failure) -- checked BEFORE the semantic assertion below so a failure
    // there is unambiguous fixture evidence, never conflated with the
    // semantic assertion itself. Mirrors M7-CREATE-RACE-FENCE-13's own
    // identical discipline.
    const oneShotDir = path.join(rll.registryRepoDir(dir), 'claude-one-shot-bindings');
    let oneShotFiles = [];
    try { oneShotFiles = fs.readdirSync(oneShotDir).filter((f) => f.endsWith('.json')); } catch { /* empty is a genuine failure below */ }
    assert.strictEqual(oneShotFiles.length, 1, 'fixture sanity: the child must have genuinely written its (now-inert) one-shot binding record for this race to be meaningful: ' + JSON.stringify({ oneShotFiles, childOut }));

    assert.strictEqual(
      childOut.ok, false,
      'M7 section 7 (defect 4): createClaudeOneShotBinding must rerun the COMPLETE authority predicate (the full cross-family classifier, never fence-only) after its write and before returning success -- a competing createRequesterBinding mint that lands during the admission-to-write window leaves the identity genuinely cross-family-ambiguous, which this post-write re-check must catch even though the one-shot record already physically landed (confirmed above): ' + JSON.stringify(childOut)
    );

    // Independent confirmation (mirrors M7-CROSS-FAMILY-AMBIGUITY-21's own
    // established technique): a FRESH classification after the race must
    // STILL report genuine ambiguity, never silently resolve to the
    // now-written one-shot binding as a clean ONE -- proves the written
    // one-shot record is a genuinely inert artifact, never returned as live,
    // independent of exactly how createClaudeOneShotBinding's own return
    // value is worded.
    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const freshClassification = rll.classifyClaudeAuthorityForIdentity({ repoId: authIdentity.repo_id }, authIdentity);
    assert.strictEqual(
      freshClassification.ok, false,
      'a fresh classification after the race must still report genuine cross-family ambiguity: ' + JSON.stringify(freshClassification)
    );
    assert.strictEqual(freshClassification.reason, 'authority-current-binding-ambiguous');
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group C: RED 21 (M7-CROSS-FAMILY-AMBIGUITY). Contract section 6:
// "more than one current candidate is never selected" -- authority-current-
// binding-ambiguous. Section 3.1 excludes role from the fence/classifier
// identity domain, so a requester-family candidate and a one-shot-family
// candidate for the IDENTICAL (repo_id, runtime_session_key, agent_id) tuple
// are the SAME identity for classification purposes even though their own
// role fields legitimately differ.
//
// M7 CORRECTION (2026-08-17): the prior version of this test manufactured its
// ambiguity via TWO SEQUENTIAL production creator calls, both required to
// succeed (createRequesterBinding then createClaudeOneShotBinding). That
// fixture is now permanently unbuildable once defects 1/2 are fixed: the
// SAME sequence is exactly what the new M7-CROSS-FAMILY-CREATE-REJECTED test
// immediately above proves must be REJECTED at creation time (a live
// requester binding blocks a second, cross-family one-shot mint for the
// identical identity) -- so requiring the second call to also report
// ok:true would make this RED's own fixture contradict that other RED's
// fixture the moment GREEN lands for either. Rewritten per the contract's
// own anticipated shape instead (section 6: "Concurrent cross-family
// writers may leave two diagnostic records, but the post-write classifier
// exposes neither as usable") -- the requester side still mints via the
// real production creator (nothing else is live yet, so this remains an
// ordinary, uncontested first mint, unaffected by the defect 1/2 fix); the
// one-shot side is planted DIRECTLY as a byte-for-byte valid
// runtime/claude-one-shot-binding/v2 record via the same secure
// writeRegistryRecordReplace primitive every real creator uses, at the exact
// path a real createClaudeOneShotBinding call would occupy -- simulating
// the diagnostic-record-left-behind scenario the contract itself names,
// never going through the (now correctly rejecting) creator a second time.
// This isolates RED 21's own actual subject -- the CLASSIFIER's ambiguity
// detection -- from the SEPARATE, now-covered-elsewhere question of whether
// the creators themselves prevent the collision from happening in the first
// place. Deliberately keeps DIFFERENT roles for the two sides (arch-testing
// vs toolkit-specialist) -- section 4.3 requires a one-shot binding's own
// persisted agent_type equal its own persisted role, but nothing requires
// the requester side to share that role, and using different roles is a MORE
// faithful proof that role is genuinely excluded from the identity domain
// than same-role would be.
// ════════════════════════════════════════════════════════════════════════════

test('M7-CROSS-FAMILY-AMBIGUITY-21 (RED): classifyClaudeAuthorityForIdentity must reject with authority-current-binding-ambiguous when a requester-family AND a one-shot-family binding are BOTH currently live for the identical (repo,session,agent) identity, even though their own role fields differ -- today the classifier does not exist at all', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    assert.strictEqual(
      typeof rll.classifyClaudeAuthorityForIdentity, 'function',
      'M7 section 6: runtime-role-lifecycle.cjs must export classifyClaudeAuthorityForIdentity(repoDescriptor, observedIdentity) -- today it does not exist'
    );

    const sessionId = 'm7-red21-session';
    const agentId = 'm7-red21-agent';
    const requesterRole = 'arch-testing';
    const oneShotRole = 'toolkit-specialist';

    // Family 1: requester binding, provider:claude-hook, via the REAL
    // production creator -- nothing else is live for this identity yet, so
    // this remains an ordinary, uncontested first mint even post-defect-1/2-fix.
    primeClaudeId01Trace(dir, requesterRole, sessionId, agentId);
    const requesterIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const mintedRequester = rll.createRequesterBinding(dir, requesterIdentity, agentId, requesterRole, worktreeId, planDigest, 3600);
    assert.strictEqual(mintedRequester.ok, true, 'fixture: the requester-family binding must genuinely mint: ' + JSON.stringify(mintedRequester));

    // Family 2: one-shot binding, planted DIRECTLY (never through
    // createClaudeOneShotBinding -- see this section's own header comment for
    // why). A byte-for-byte valid runtime/claude-one-shot-binding/v2 record,
    // written via the SAME secure registry-write primitive every real
    // creator uses, at the exact path a real createClaudeOneShotBinding call
    // would have used. agent_type and role are BOTH oneShotRole (section
    // 4.3: a one-shot binding's own persisted agent_type must equal its own
    // role).
    const oneShotBindingId = crypto.randomBytes(16).toString('hex');
    const genForOneShot = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(genForOneShot.ok, true, 'fixture: session generation must resolve for the planted one-shot record: ' + JSON.stringify(genForOneShot));
    const oneShotRecord = {
      schema: 'runtime/claude-one-shot-binding/v2',
      binding_id: oneShotBindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: oneShotRole,
      native_spawn_action_id: rll.generateActionId(),
      request_id: crypto.randomBytes(32).toString('hex'),
      attempt_id: crypto.randomBytes(32).toString('hex'),
      lease_epoch: 0,
      role: oneShotRole,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      session_generation_id: genForOneShot.generationId,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      expiry: new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const oneShotPath = rll.claudeOneShotBindingPathFor(dir, oneShotBindingId);
    const planted = rll.writeRegistryRecordReplace(oneShotPath, Buffer.from(JSON.stringify(oneShotRecord), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: planting the diagnostic one-shot record must succeed: ' + JSON.stringify(planted));

    // Fixture sanity FIRST (positive control): both families are genuinely,
    // independently live for the identical session_id/agent_id before the
    // classifier is ever consulted -- never a vacuous "only one ever
    // existed" collision, and never an accidental same-role fixture that
    // would leave role-exclusion untested.
    assert.strictEqual(mintedRequester.binding.runtime_session_key, sessionId);
    assert.strictEqual(mintedRequester.binding.agent_key, agentId);
    assert.notStrictEqual(
      mintedRequester.binding.role, oneShotRecord.role,
      'fixture sanity: the two live candidates genuinely have DIFFERENT role fields -- proves this collision is detected despite role differing, never merely because the fixture happened to reuse one role'
    );

    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: authIdentity.repo_id }, authIdentity);
    assert.strictEqual(
      result.ok, false,
      'M7 section 6: "more than one current candidate is never selected" -- a requester-family AND a one-shot-family binding BOTH currently live for the identical (repo,session,agent) identity must reject closed, never silently resolve to either single family (which a result.state of ONE would imply): ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-current-binding-ambiguous');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 defect 3 / checklist items 6-7 (2026-08-17 correction pass):
// createClaudeOneShotBinding never caps its own expiry to the backing session
// generation's own remaining lifetime (contrast createRequesterBinding, which
// already does this) and never checks agentType === role -- both confirmed
// absent by direct read of createClaudeOneShotBinding's full body
// (runtime-role-lifecycle.cjs, no session_generation_id param, expiryIso is
// pure now+ttlSeconds, no equality check anywhere in the function).
// ════════════════════════════════════════════════════════════════════════════

test('M7-ONESHOT-AGENT-TYPE-ROLE-MISMATCH-07 (RED): createClaudeOneShotBinding must reject when agentType !== role -- today it validates each independently against CANONICAL_ROLES but never checks they are equal to each other', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-item7-mismatch-session';
    const agentId = 'm7-item7-mismatch-agent';
    const nativeSpawnActionId = rll.generateActionId();
    const requestId = crypto.randomBytes(32).toString('hex');
    const attemptId = crypto.randomBytes(32).toString('hex');
    const mismatchGen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(mismatchGen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(mismatchGen));

    const result = rll.createClaudeOneShotBinding(
      dir, sessionId, mismatchGen.generationId, agentId, 'arch-testing', nativeSpawnActionId,
      requestId, attemptId, 0, 'toolkit-specialist', worktreeId, planDigest, 600,
    );
    assert.strictEqual(
      result.ok, false,
      'M7 defect 3 / checklist item 7: agent_type ("arch-testing") and role ("toolkit-specialist") diverge -- both are individually valid canonical roles, but a one-shot binding\'s own agent_type must equal its own role (section 4.3) and this must be rejected closed, never minted: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-ONESHOT-EXPIRY-CAPPED-TO-GENERATION-06 (RED): createClaudeOneShotBinding must cap its own binding.expiry to the backing session generation\'s own expires_at when that is SHORTER than now+ttlSeconds -- today expiryIso is pure now+ttlSeconds, ignoring the generation entirely', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-item6-cap-session';
    const agentId = 'm7-item6-cap-agent';
    const identity = { provider: 'claude-hook', runtime_session_key: sessionId };

    // Plant a genuinely LIVE but SHORT (60s) session generation directly --
    // resolveSessionGeneration's own reuse branch (nowMs < expires_at) will
    // pick this exact record up unchanged, giving createClaudeOneShotBinding
    // a generation whose remaining lifetime is unambiguously shorter than the
    // 600s ttlSeconds requested below (both the request ceiling and the
    // production default generation TTL are 3600s, too close to the
    // requested ttl to give a reliable margin -- a deliberately short planted
    // generation avoids that flakiness entirely).
    const nowStr = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const shortExpiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const genRecord = {
      schema: 'runtime/session-generation/v1',
      provider: identity.provider,
      runtime_session_key: identity.runtime_session_key,
      generation_id: crypto.randomBytes(16).toString('hex'),
      created_at: nowStr,
      expires_at: shortExpiresAt,
    };
    const genPlant = rll.writeRegistryRecordReplace(rll.sessionGenerationPathFor(dir, identity), Buffer.from(JSON.stringify(genRecord), 'utf8'));
    assert.strictEqual(genPlant.ok, true, 'fixture: planting the short-lived generation must succeed: ' + JSON.stringify(genPlant));

    const nativeSpawnActionId = rll.generateActionId();
    const requestId = crypto.randomBytes(32).toString('hex');
    const attemptId = crypto.randomBytes(32).toString('hex');
    // Passes the deliberately-planted short-lived generation_id directly --
    // never re-derived via resolve/peek -- since this test's own point is to
    // prove capping against THIS exact planted generation, mirroring R1's
    // own established convention for a rotation/generation-aware fixture.
    const result = rll.createClaudeOneShotBinding(
      dir, sessionId, genRecord.generation_id, agentId, 'arch-testing', nativeSpawnActionId,
      requestId, attemptId, 0, 'arch-testing', worktreeId, planDigest, 600,
    );
    assert.strictEqual(result.ok, true, 'fixture: an ordinary first mint against a genuinely live (if short) generation must succeed: ' + JSON.stringify(result));
    assert.ok(
      Date.parse(result.binding.expiry) <= Date.parse(shortExpiresAt),
      'M7 defect 3 / checklist item 6: binding.expiry (' + result.binding.expiry + ') must never exceed the backing session generation\'s own expires_at (' + shortExpiresAt + ', 60s) even though 600s was requested -- exactly like createRequesterBinding already caps: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 checklist items 3-4 (2026-08-17 correction pass): the capability
// primitive itself (admitClaudeAuthorityOperation/writeGuardedByClaudeAuthorityAdmission/
// isValidClaudeAuthorityAdmissionCapability) is documented and named as a
// single-use, deadline-bound authority token, but confirmed by direct read
// of its own full body: writeGuardedByClaudeAuthorityAdmission never marks a
// capability consumed after use (claudeAuthorityAdmissionCapabilities is a
// WeakSet the capability simply stays a member of), and
// isValidClaudeAuthorityAdmissionCapability never compares capability.deadline
// against the current clock at all -- admitClaudeAuthorityOperation's own
// deadlineIso validation (isCanonicalIsoUtc) checks SHAPE only, never that it
// is still in the future. Both are direct, minimal unit tests against the
// exported primitives themselves -- no binding/grant machinery needed, since
// the gap lives entirely inside this one function pair.
// ════════════════════════════════════════════════════════════════════════════

test('M7-CAPABILITY-SINGLE-USE-03 (RED): a capability obtained from admitClaudeAuthorityOperation must guard at most ONE write -- a second writeGuardedByClaudeAuthorityAdmission call with the SAME capability+operationKind must be refused, never invoke its callback a second time', () => {
  const dir = makeGitProject();
  try {
    const sessionId = 'm7-item3-singleuse-session';
    const agentId = 'm7-item3-singleuse-agent';
    const authorityIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const deadline = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const admission = rll.admitClaudeAuthorityOperation(dir, authorityIdentity, 'create-binding', deadline);
    assert.strictEqual(admission.ok, true, 'fixture: admission against a genuinely ABSENT, unfenced identity must succeed: ' + JSON.stringify(admission));

    let callbackCount = 0;
    const first = rll.writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => { callbackCount += 1; return { ok: true }; });
    assert.strictEqual(first.ok, true, 'fixture: the FIRST guarded write against a freshly-admitted capability must succeed: ' + JSON.stringify(first));
    assert.strictEqual(callbackCount, 1, 'fixture sanity: exactly one callback invocation after the first guarded write');

    const second = rll.writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => { callbackCount += 1; return { ok: true }; });
    assert.strictEqual(
      callbackCount, 1,
      'M7 checklist item 3 ("Capability usada dos veces: callback total=1"): a SECOND guarded write against the SAME already-used capability must never invoke its callback again -- today writeGuardedByClaudeAuthorityAdmission never marks a capability consumed, so the total climbs to 2: ' + JSON.stringify(second)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 defect 7 / checklist item 8 (2026-08-17 correction pass): "v2 + legacy
// marker permanece ONE" -- a well-formed, otherwise-live v2 binding must
// classify ONE regardless of a `.retired` sidecar marker's presence; that
// marker is an inert legacy diagnostic (section 4/8.5: retireClaudeOneShotBinding,
// the no-clobber marker WRITER, is itself removed -- no new marker is ever
// produced by current production code) -- authority is cut exclusively via
// the fence/generation/expiry monotonic cuts, never a mutable-looking sidecar
// file. Confirmed by direct read: classifyClaudeAuthorityForIdentity's own
// one-shot scan explicitly reads claudeOneShotBindingRetiredMarkerPathFor and
// treats a non-absent marker as {state:'stale'} (excluded from candidacy).
// ════════════════════════════════════════════════════════════════════════════

test('M7-ONESHOT-V2-LEGACY-MARKER-INERT-08 (RED): classifyClaudeAuthorityForIdentity must classify state ONE for an otherwise-live v2 ClaudeOneShotBinding even when a legacy .retired sidecar marker is ALSO present for it -- today the marker still gates liveness and the binding is excluded as stale, yielding ABSENT instead', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-item8-legacymarker-session';
    const agentId = 'm7-item8-legacymarker-agent';
    const legacyMarkerGen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(legacyMarkerGen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(legacyMarkerGen));

    const minted = rll.createClaudeOneShotBinding(
      dir, sessionId, legacyMarkerGen.generationId, agentId, 'arch-testing', rll.generateActionId(),
      crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'), 0,
      'arch-testing', worktreeId, planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: an ordinary first mint must succeed: ' + JSON.stringify(minted));

    // retireClaudeOneShotBinding (the marker WRITER) is itself removed from
    // current production code (section 4/8.5) -- plants the legacy sidecar
    // DIRECTLY, mirroring this suite's own established "plant one side of the
    // fixture directly" convention. Content is a plausible legacy shape;
    // the classifier's own check is presence-only (readRegistryRecord.absent),
    // never content-inspecting.
    const markerPath = rll.claudeOneShotBindingRetiredMarkerPathFor(dir, minted.binding.binding_id);
    const markerPlant = rll.writeRegistryRecordReplace(markerPath, Buffer.from(JSON.stringify({ reason: 'agent-return', retired_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }), 'utf8'));
    assert.strictEqual(markerPlant.ok, true, 'fixture: planting the legacy .retired sidecar must succeed: ' + JSON.stringify(markerPlant));

    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, authIdentity);
    assert.strictEqual(result.ok, true, 'fixture sanity: classification itself must not error: ' + JSON.stringify(result));
    assert.strictEqual(
      result.state, 'ONE',
      'M7 defect 7 / checklist item 8 ("v2 + legacy marker permanece ONE"): a live v2 ClaudeOneShotBinding must classify ONE regardless of a legacy .retired sidecar -- today the marker still gates liveness: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 checklist item 16 (2026-08-17 correction pass): "Classifier: los siete
// errores cerrados, cap+1, unsafe entry, malformed, path/content mismatch y
// sidecars." Confirmed by direct read of classifyClaudeAuthorityForIdentity
// and its own scanClaudeAuthorityFamily helper: ZERO existing coverage (in
// this file or runtime-consultation-cli.test.js) for ANY of
// authority-scan-cap-exceeded/authority-entry-unsafe/authority-scan-failed/
// authority-record-malformed, before this section. These three tests cover
// the three most structurally distinct, independently-reachable closed-error
// branches (CAP+1 overflow, an unsafe/non-conforming directory entry, and a
// path<->content binding_id mismatch -- the precise "malformed" and "path/
// content mismatch" checklist sub-items collapse to the SAME
// authority-record-malformed branch, confirmed by direct read: `if (!raw ||
// raw.binding_id !== bindingId) return { state: 'error', reason:
// 'authority-record-malformed' };`), all isolated on the SIMPLEST family
// (requester-bindings, sidecarRe:null, no sidecar-exclusion complexity).
// HONEST RESULT (empirically confirmed 2026-08-17, unlike every OTHER RED in
// this file): all three currently PASS -- classifyClaudeAuthorityForIdentity
// already correctly enforces its own CAP/unsafe-entry/path-content-mismatch
// closed errors. Kept as POSITIVE regression guards (never mislabeled RED),
// closing a real, previously-ZERO-coverage gap in this codebase's own test
// suite even though no production fix is needed here.
// "Sidecars" (the fourth checklist sub-item) already has POSITIVE, indirect
// coverage: M7-ONESHOT-V2-LEGACY-MARKER-INERT-08 above plants a genuine
// `.retired` sidecar next to a live one-shot binding and confirms the
// classifier still reaches state ONE, which is only possible if the sidecar
// was correctly skipped (sidecarRe.test) rather than misread as a malformed/
// unsafe primary entry -- not duplicated here as a fourth standalone test.
// ════════════════════════════════════════════════════════════════════════════

test('M7-CLASSIFIER-SCAN-CAP-EXCEEDED-16 (guard, preserve): classifyClaudeAuthorityForIdentity must reject authority-scan-cap-exceeded when a single family directory holds MORE than CLAUDE_AUTHORITY_SCAN_CAP (1024) entries -- proves the CAP+1 boundary is enforced, never silently scanned past', () => {
  const dir = makeGitProject();
  try {
    const sessionId = 'm7-item16-cap-session';
    const agentId = 'm7-item16-cap-agent';
    const bindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    fs.mkdirSync(bindingsDir, { recursive: true, mode: 0o700 });
    // CAP+1: exactly one entry past CLAUDE_AUTHORITY_SCAN_CAP (1024) --
    // content is irrelevant (the cap check runs BEFORE any entry is ever
    // read), so a trivial empty-object placeholder is sufficient and this
    // stays fast (no real binding-mint work for 1025 entries).
    for (let i = 0; i < 1025; i += 1) {
      const name = crypto.randomBytes(16).toString('hex') + '.json';
      fs.writeFileSync(path.join(bindingsDir, name), '{}');
    }
    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, authIdentity);
    assert.strictEqual(
      result.ok, false,
      'M7 checklist item 16 ("cap+1"): a family directory holding CLAUDE_AUTHORITY_SCAN_CAP+1 entries must be rejected closed, never scanned past its own bound: ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-scan-cap-exceeded');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-UNSAFE-ENTRY-16 (guard, preserve): classifyClaudeAuthorityForIdentity must reject authority-entry-unsafe when a family directory contains an entry that is neither a recognized sidecar nor a well-formed <32-hex>.json primary name -- proves an unexpected/malformed directory entry fails closed rather than being silently skipped or misread', () => {
  const dir = makeGitProject();
  try {
    const sessionId = 'm7-item16-unsafe-session';
    const agentId = 'm7-item16-unsafe-agent';
    const bindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    fs.mkdirSync(bindingsDir, { recursive: true, mode: 0o700 });
    // requester-bindings has sidecarRe:null (confirmed by direct read: the
    // scanClaudeAuthorityFamily call for this family passes `null` as its
    // final arg) -- so ANY non-conforming name here is unambiguously unsafe,
    // never a legitimate sidecar this family's own scan would recognize.
    fs.writeFileSync(path.join(bindingsDir, 'not-a-valid-32-hex-binding-name.json'), '{}');
    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, authIdentity);
    assert.strictEqual(
      result.ok, false,
      'M7 checklist item 16 ("unsafe entry"): a directory entry matching neither a recognized sidecar nor the <32-hex>.json primary-name pattern must be rejected closed: ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-entry-unsafe');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-PATH-CONTENT-MISMATCH-16 (guard, preserve): classifyClaudeAuthorityForIdentity must reject authority-record-malformed when a well-formed-named binding record\'s own embedded binding_id disagrees with its file path -- proves the path<->content correlation is checked, never trusted from the filename alone', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const sessionId = 'm7-item16-pathmismatch-session';
    const agentId = 'm7-item16-pathmismatch-agent';
    primeClaudeId01Trace(dir, 'arch-testing', sessionId, agentId);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const minted = rll.createRequesterBinding(dir, identity, agentId, 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: an ordinary first mint must succeed: ' + JSON.stringify(minted));

    // Tamper the durable record's OWN embedded binding_id post-mint -- the
    // file's own PATH (its name) still names the ORIGINAL id, but the
    // record's CONTENT now claims a different one. Well-formed JSON,
    // otherwise fully valid shape -- isolates this one specific correlation
    // check from any other malformed-shape reason.
    const bindingPath = rll.requesterBindingPathFor(dir, minted.binding.binding_id);
    const rec = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    rec.binding_id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(bindingPath, JSON.stringify(rec));

    const authIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, authIdentity);
    assert.strictEqual(
      result.ok, false,
      'M7 checklist item 16 ("malformed" / "path/content mismatch"): a record whose own embedded binding_id disagrees with its file path must be rejected closed: ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-record-malformed');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R16): rewritten into two
// genuinely distinct sub-scenarios per Codex's exact correction spec, replacing
// the single prior test above (which only ever exercised what is now Case B,
// and even there only pinned zero-callback/ok:false, never the specific
// binding-expired reason string).
//
// Case A (admission-time rejection): admitClaudeAuthorityOperation's own
// deadlineIso check (isCanonicalIsoUtc, confirmed by direct read at
// runtime-role-lifecycle.cjs:4513) validates STRING SHAPE only -- it never
// compares the deadline against the current clock at all, so a
// shape-valid-but-already-past deadline is wrongly ADMITTED (ok:true,
// capability minted) today. Case A asserts the corrected behavior: admission
// itself must reject with reason binding-expired, producing no capability.
//
// Case B (write-time re-check, deadline live at admission but elapses before
// the guarded write runs): isValidClaudeAuthorityAdmissionCapability
// (runtime-role-lifecycle.cjs:4544-4551) ALREADY compares
// currentClockMsForRegistry() against the capability's own deadline before
// writeFn ever runs (confirmed by direct read) -- so callbackCount:0 and
// result.ok:false ALREADY hold today; that is not this sub-case's own gap.
// The actual gap: writeGuardedByClaudeAuthorityAdmission
// (runtime-role-lifecycle.cjs:4563-4569) returns the generic
// reason:'authority-scan-failed' on ANY isValidClaudeAuthorityAdmissionCapability
// failure -- it never distinguishes "deadline elapsed" from every other
// invalidity reason (forged capability, wrong operationKind, malformed
// deadline shape), so a caller can never tell WHY a write was refused. This
// file has no fixed-clock test seam for currentClockMsForRegistry (a plain
// Date.now(), confirmed by direct read, deliberately separate from
// runtime-consultation.cjs's own fixed-clock seam) -- Case B therefore uses a
// short REAL deadline and a real wall-clock wait, the only way to genuinely
// cross it.
test('M7-CAPABILITY-DEADLINE-ENFORCED-04A (RED): admitClaudeAuthorityOperation must reject an already-past canonical deadline AT ADMISSION TIME with reason binding-expired, producing no capability -- today it validates deadlineIso SHAPE only (isCanonicalIsoUtc) and never compares it against the current clock, so a shape-valid-but-already-expired deadline is wrongly admitted', () => {
  const dir = makeGitProject();
  try {
    const sessionId = 'm7-item4a-deadline-session';
    const agentId = 'm7-item4a-deadline-agent';
    const authorityIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const pastDeadline = '2000-01-01T00:00:00Z';
    const admission = rll.admitClaudeAuthorityOperation(dir, authorityIdentity, 'create-binding', pastDeadline);
    assert.strictEqual(
      admission.ok, false,
      'M7 checklist item 4 Case A ("Deadline pasado: binding-expired"): admission itself must reject an already-past canonical deadline -- today admitClaudeAuthorityOperation validates deadlineIso SHAPE only and never compares it against the current clock, so this wrongly succeeds: ' + JSON.stringify(admission)
    );
    assert.strictEqual(admission.reason, 'binding-expired', 'the admission rejection reason must be exactly binding-expired: ' + JSON.stringify(admission));
    assert.strictEqual(admission.capability, undefined, 'a rejected admission must never produce a capability: ' + JSON.stringify(admission));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CAPABILITY-DEADLINE-ENFORCED-04B (RED): a capability whose deadline was LIVE at admission but elapses before writeGuardedByClaudeAuthorityAdmission runs must be refused with reason binding-expired specifically (zero callback invocations, and the SAME capability object must remain unusable on a second attempt) -- today the write is already correctly blocked (callback:0, ok:false) but the reason collapses to the generic authority-scan-failed, indistinguishable from every other admission-capability invalidity', () => {
  const dir = makeGitProject();
  // M7 correction round 1 (2026-08-18, C10): replaces the former real
  // await new Promise(resolve => setTimeout(resolve, 1200)) wall-clock wait.
  // currentClockMsForRegistry is confirmed NOT exported from
  // runtime-role-lifecycle.cjs (typeof rll.currentClockMsForRegistry ===
  // 'undefined', checked directly) -- this file's own header comment above
  // is accurate: there is no dedicated injectable clock seam. Per its OWN
  // "a plain Date.now(), confirmed by direct read" characterization, the
  // deterministic substitute is a save/restore-in-finally monkey-patch of
  // the GLOBAL Date.now -- a standard, well-established technique for
  // exactly this situation, applied ONLY around the write-time re-check
  // (never around the admission call itself, which must still see the REAL
  // clock so "fixture sanity: admission succeeds while genuinely live"
  // stays a meaningful, real-time assertion).
  const originalDateNow = Date.now;
  try {
    const sessionId = 'm7-item4b-deadline-session';
    const agentId = 'm7-item4b-deadline-agent';
    const authorityIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const soonDeadline = new Date(Date.now() + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const admission = rll.admitClaudeAuthorityOperation(dir, authorityIdentity, 'create-binding', soonDeadline);
    assert.strictEqual(admission.ok, true, 'fixture sanity: admission itself must succeed while the deadline is still live: ' + JSON.stringify(admission));

    // Deterministically jump the clock 2000ms past the REAL current instant
    // -- comfortably past the 1000ms deadline above, zero real sleep.
    const fixedNowMs = originalDateNow() + 2000;
    Date.now = () => fixedNowMs;

    let callbackCount = 0;
    const result = rll.writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => { callbackCount += 1; return { ok: true }; });
    assert.strictEqual(callbackCount, 0, 'a capability whose deadline has elapsed since admission must never guard a write -- callback must not fire: ' + JSON.stringify(result));
    assert.strictEqual(result.ok, false, 'the guarded write must report failure once its capability\'s deadline has passed: ' + JSON.stringify(result));
    assert.strictEqual(
      result.reason, 'binding-expired',
      'M7 checklist item 4 Case B: the guarded-write rejection reason must be exactly binding-expired, distinguishing a deadline-elapsed refusal from every other admission-capability invalidity -- today writeGuardedByClaudeAuthorityAdmission collapses every isValidClaudeAuthorityAdmissionCapability failure to the generic authority-scan-failed: ' + JSON.stringify(result)
    );

    // "capability cannot be reused": a second write attempt with the SAME
    // (already-rejected) capability object also fails, callback still zero.
    const secondResult = rll.writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => { callbackCount += 1; return { ok: true }; });
    assert.strictEqual(callbackCount, 0, 'a second write attempt with the same expired capability must also never invoke its callback: ' + JSON.stringify(secondResult));
    assert.strictEqual(secondResult.ok, false, 'a second write attempt with the same expired capability must also fail: ' + JSON.stringify(secondResult));
    assert.strictEqual(secondResult.reason, 'binding-expired', 'the second attempt\'s own rejection reason must also be exactly binding-expired: ' + JSON.stringify(secondResult));
  } finally {
    Date.now = originalDateNow;
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 defect 12(c) / checklist item 17 (2026-08-17 correction pass): "Rendezvous:
// regular/0600/bytes/zero-I/O." Confirmed by direct read of BOTH
// testM7Rendezvous implementations (this repo's own RLL definition, and its
// runtime-consultation.cjs mirror): the `.go`-side poll loop is a plain
// `fs.readFileSync(goPath)` (Node's default fs.readFileSync transparently
// follows a symlink) with ZERO lstatSync/isSymbolicLink/mode check before the
// byte-equality comparison -- a symlink planted at the exact `.go` path,
// pointing at a DIFFERENT file that happens to hold the correct "go\n" bytes,
// would be silently accepted as a genuine release signal. Structural
// "must-be-absent-from-source" check, mirroring this codebase's own
// established guards-27/29 and RED-22 technique -- a live symlink-plant+race
// would need a full child-process rendezvous harness for a property this
// extraction already proves precisely and far more cheaply.
// ════════════════════════════════════════════════════════════════════════════

test('M7-RENDEZVOUS-GO-SYMLINK-UNCHECKED-17 (RED): testM7Rendezvous\'s own .go-side poll (both this file\'s definition and its runtime-consultation.cjs mirror) must reject a symlinked .go path via an explicit lstat/isSymbolicLink check BEFORE trusting its byte contents -- today both bodies call plain fs.readFileSync(goPath) with no such check, so a symlink pointing at correct bytes elsewhere would be wrongly accepted as the real release signal', () => {
  const rllSrc = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'), 'utf8');
  const rcSrc = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-consultation.cjs'), 'utf8');
  for (const [label, src] of [['runtime-role-lifecycle.cjs', rllSrc], ['runtime-consultation.cjs', rcSrc]]) {
    const defIdx = src.indexOf('function testM7Rendezvous(');
    assert.notStrictEqual(defIdx, -1, 'fixture sanity: testM7Rendezvous must still be found as a named function in ' + label);
    const window = src.slice(defIdx, defIdx + 2500);
    const nextFunctionOffset = window.indexOf('\nfunction ', 'function testM7Rendezvous('.length);
    const body = nextFunctionOffset === -1 ? window : window.slice(0, nextFunctionOffset);
    assert.ok(
      body.includes('goPath'),
      'fixture sanity: the extracted testM7Rendezvous body in ' + label + ' must reference goPath at all -- extraction window likely wrong'
    );
    assert.ok(
      body.includes('lstatSync') || body.includes('isSymbolicLink'),
      'M7 defect 12(c) / checklist item 17 ("Rendezvous: regular/0600/bytes/zero-I/O"): testM7Rendezvous in ' + label + ' must lstat/verify the .go path is a genuine regular file (never a symlink) before trusting its byte contents -- today it does not'
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 1 of 3): R4/R5, persisted
// one-shot role equality. Both tamper ONLY agent_type on an otherwise
// well-formed, freshly-minted v2 ClaudeOneShotBinding record so it diverges
// from the record's own role field (both individually canonical) --
// confirmed by direct read that NEITHER validateClaudeOneShotBindingFor
// (~L4085-4144) NOR classifyClaudeAuthorityForIdentity's one-shot family
// scan (~L4403-4421) cross-checks agent_type against role anywhere: each
// checks CANONICAL_ROLES.includes() independently per field, and the
// classifier's own "light liveness check" comment explicitly documents it
// checks only expiry+generation, never calling validateClaudeOneShotBindingFor
// at all.
// ════════════════════════════════════════════════════════════════════════════

test('M7-ONESHOT-PERSISTED-ROLE-VALIDATOR-R4 (RED): validateClaudeOneShotBindingFor must reject a persisted record whose agent_type has been altered to diverge from its own role field (both individually canonical) as claude-one-shot-binding-shape-invalid -- today it checks each field is independently canonical but never that they AGREE with each other', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red-r4-session';
    const agentId = 'm7-red-r4-agent';
    const requestId = crypto.randomBytes(32).toString('hex');
    const attemptId = crypto.randomBytes(32).toString('hex');
    const r4Gen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(r4Gen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(r4Gen));
    const minted = rll.createClaudeOneShotBinding(
      dir, sessionId, r4Gen.generationId, agentId, role, rll.generateActionId(), requestId, attemptId, 0, role, worktreeId, planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a real matching-role one-shot binding must mint first: ' + JSON.stringify(minted));
    const expected = { requestId, attemptId, leaseEpoch: 0, role, worktreeId, planDigest };

    const positiveControl = rll.validateClaudeOneShotBindingFor(dir, minted.binding.binding_id, expected);
    assert.strictEqual(positiveControl.ok, true, 'positive control: the SAME record, still matching (agent_type===role), must validate: ' + JSON.stringify(positiveControl));

    const bindingPath = rll.claudeOneShotBindingPathFor(dir, minted.binding.binding_id);
    const rec = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    assert.notStrictEqual(rec.agent_type, 'verifier', 'fixture sanity: the tamper target role must genuinely differ from the original');
    rec.agent_type = 'verifier';
    fs.chmodSync(bindingPath, 0o600);
    fs.writeFileSync(bindingPath, JSON.stringify(rec), { mode: 0o600 });

    const rejected = rll.validateClaudeOneShotBindingFor(dir, minted.binding.binding_id, expected);
    assert.strictEqual(
      rejected.ok, false,
      'M7 correction checklist item 7 (section 4.3): a persisted record whose agent_type diverges from its own role (both individually canonical) must be rejected as claude-one-shot-binding-shape-invalid -- today validateClaudeOneShotBindingFor checks CANONICAL_ROLES.includes() independently for each field but never cross-checks them: ' + JSON.stringify(rejected)
    );
    assert.strictEqual(rejected.reason, 'claude-one-shot-binding-shape-invalid');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-ONESHOT-PERSISTED-ROLE-CLASSIFIER-R5 (RED): classifyClaudeAuthorityForIdentity must reject a persisted one-shot record whose agent_type diverges from its own role as authority-record-malformed, and must NEVER return it as a live ONE candidate -- today its one-shot family scan performs only a light expiry+generation liveness check and returns it as a valid candidate', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red-r5-session';
    const agentId = 'm7-red-r5-agent';
    const r5Gen = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(r5Gen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(r5Gen));
    const minted = rll.createClaudeOneShotBinding(
      dir, sessionId, r5Gen.generationId, agentId, role,
      rll.generateActionId(), crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
      0, role, worktreeId, planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a real matching-role one-shot binding must mint first: ' + JSON.stringify(minted));

    const authorityIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const positiveControl = rll.classifyClaudeAuthorityForIdentity(dir, authorityIdentity);
    assert.strictEqual(positiveControl.ok, true, 'positive control: the SAME record, still matching, must classify successfully: ' + JSON.stringify(positiveControl));
    assert.strictEqual(positiveControl.state, 'ONE', 'positive control: must classify as the sole live candidate: ' + JSON.stringify(positiveControl));

    const bindingPath = rll.claudeOneShotBindingPathFor(dir, minted.binding.binding_id);
    const rec = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    assert.notStrictEqual(rec.agent_type, 'verifier', 'fixture sanity: the tamper target role must genuinely differ from the original');
    rec.agent_type = 'verifier';
    fs.chmodSync(bindingPath, 0o600);
    fs.writeFileSync(bindingPath, JSON.stringify(rec), { mode: 0o600 });

    const rejected = rll.classifyClaudeAuthorityForIdentity(dir, authorityIdentity);
    assert.strictEqual(
      rejected.ok, false,
      'M7 correction checklist item 7 / section 6: the classifier must reject a persisted one-shot record whose agent_type diverges from its own role as authority-record-malformed, never a stale/legacy pass-through and never a live ONE -- today its one-shot scan performs only a LIGHT expiry+generation check and treats this record as a valid candidate: ' + JSON.stringify(rejected)
    );
    assert.strictEqual(rejected.reason, 'authority-record-malformed');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 3 of 3): R12, five closed
// classifier adversary cases against classifyClaudeAuthorityForIdentity
// (~L4355-4437), isWellFormedClaudeAuthorityIdentity (~L4295-4302), and
// scanClaudeAuthorityFamily (~L4315-4342).
// ════════════════════════════════════════════════════════════════════════════

test('M7-CLASSIFIER-ADVERSARY-CODEX-PROVIDER-R12-1 (RED): classifyClaudeAuthorityForIdentity must reject a well-formed-SHAPE identity whose provider is codex-supervisor as authority-fence-invalid -- the Claude authority-cut domain is claude-hook-only (M7 section 3.1), but isWellFormedClaudeAuthorityIdentity currently checks provider against the SHARED IDENTITY_PROVIDER_ENUM (which also includes codex-supervisor for RequesterBinding purposes), so a codex-supervisor-shaped identity currently passes through and classifies as ABSENT instead of being rejected outright', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const codexIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'codex-supervisor',
      repo_id: rll.computeRepoId(dir), runtime_session_key: 'm7-red-r12-1-codex-session', agent_id: 'm7-red-r12-1-codex-agent',
    };
    const result = rll.classifyClaudeAuthorityForIdentity(dir, codexIdentity);
    assert.strictEqual(
      result.ok, false,
      'M7 section 3.1: the Claude authority-cut identity domain is claude-hook-only -- a well-formed-shape codex-supervisor identity must be rejected as authority-fence-invalid, never classified: ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-fence-invalid');

    // Positive control: the SAME shape, provider claude-hook, classifies fine.
    const claudeIdentity = Object.assign({}, codexIdentity, { provider: 'claude-hook' });
    const control = rll.classifyClaudeAuthorityForIdentity(dir, claudeIdentity);
    assert.strictEqual(control.ok, true, 'positive control: an otherwise-identical claude-hook identity must classify fine: ' + JSON.stringify(control));
    assert.strictEqual(control.state, 'ABSENT');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-ADVERSARY-SIDECAR-SYMLINK-R12-2 (RED): a symlink planted at a path matching a KNOWN sidecar filename pattern must be rejected as authority-entry-unsafe -- scanClaudeAuthorityFamily currently tests the sidecar regex BEFORE ever checking entry.isFile(), so a symlink (or any non-regular entry) whose NAME merely matches a known sidecar pattern is silently continue-d past, never reaching the isFile() safety check a non-sidecar-shaped unsafe entry would get', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const rootSourceBindingsDir = path.join(rll.registryRepoDir(dir), 'root-source-bindings');
    fs.mkdirSync(rootSourceBindingsDir, { recursive: true, mode: 0o700 });
    // The symlink target lives OUTSIDE the scanned directory -- it must be
    // the ONLY entry in root-source-bindings/, otherwise a second helper
    // file with a name that matches neither the sidecar nor primary regex
    // would itself trip authority-entry-unsafe first, making this test pass
    // for the wrong reason (confirmed empirically: this confound was caught
    // and fixed after an initial version placed the decoy file alongside).
    const decoyTargetPath = path.join(dir, 'decoy-symlink-target-outside.txt');
    fs.writeFileSync(decoyTargetPath, 'not a real binding\n');
    // Exact shape CLAUDE_AUTHORITY_ROOT_SOURCE_SIDECAR_RE accepts: <32hex>.ingress.json
    const sidecarShapedSymlinkPath = path.join(rootSourceBindingsDir, 'a'.repeat(32) + '.ingress.json');
    fs.symlinkSync(decoyTargetPath, sidecarShapedSymlinkPath);

    const identity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: 'm7-red-r12-2-session', agent_id: 'm7-red-r12-2-agent',
    };
    const result = rll.classifyClaudeAuthorityForIdentity(dir, identity);
    assert.strictEqual(
      result.ok, false,
      'M7 section 6: an entry that is NOT a genuine regular file must fail closed as authority-entry-unsafe regardless of whether its NAME happens to match a known sidecar pattern -- today the sidecar-name check short-circuits with a silent continue before entry.isFile() is ever consulted, so this planted symlink is invisibly skipped: ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-entry-unsafe');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-ADVERSARY-CROSSIDENTITY-MALFORMED-R12-3 (RED): a well-formed-v2-SHAPE requester-binding record belonging to a DIFFERENT identity, whose role field is nonetheless malformed (non-canonical), must fail the whole classification as authority-record-malformed rather than being silently absorbed as a routine stale diagnostic -- today the requester family scan checks identity match (session+agent) BEFORE ever calling the full validateRequesterBindingFor, so a foreign-identity record short-circuits to stale before its deeper malformation is ever examined', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const foreignIdentity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'm7-red-r12-3-foreign-session' };
    const minted = rll.createRequesterBinding(dir, foreignIdentity, 'm7-red-r12-3-foreign-agent', 'arch-testing', worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a real foreign-identity binding must mint first: ' + JSON.stringify(minted));

    const testIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: 'm7-red-r12-3-test-session', agent_id: 'm7-red-r12-3-test-agent',
    };
    const positiveControl = rll.classifyClaudeAuthorityForIdentity(dir, testIdentity);
    assert.strictEqual(positiveControl.ok, true, 'positive control: an otherwise-valid foreign-identity record must classify this DIFFERENT identity as ABSENT (the foreign record is a routine stale diagnostic, never a candidate): ' + JSON.stringify(positiveControl));
    assert.strictEqual(positiveControl.state, 'ABSENT');
    assert.strictEqual(positiveControl.stale_count, 1, 'positive control: the foreign record must be counted as exactly one stale diagnostic: ' + JSON.stringify(positiveControl));

    // Tamper the foreign record's OWN role to a non-canonical value -- both
    // its own identity fields (still foreign to testIdentity) and its shape
    // (v2 key-set/schema/binding_id-path-match) remain otherwise intact.
    const bindingPath = rll.requesterBindingPathFor(dir, minted.binding.binding_id);
    const rec = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    rec.role = 'not-a-real-canonical-role';
    fs.chmodSync(bindingPath, 0o600);
    fs.writeFileSync(bindingPath, JSON.stringify(rec), { mode: 0o600 });

    const result = rll.classifyClaudeAuthorityForIdentity(dir, testIdentity);
    assert.strictEqual(
      result.ok, false,
      'M7 section 6: malformed records fail closed applies to EVERY record the scan encounters, including one belonging to a different identity -- today a foreign-identity record short-circuits to stale via its session+agent mismatch check BEFORE the full validator (which would catch the non-canonical role) ever runs, so this deeper malformation is silently absorbed rather than failing the classification: ' + JSON.stringify(result)
    );
    assert.strictEqual(result.reason, 'authority-record-malformed');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-ADVERSARY-READ-UNREADABLE-R12-4 (RED): a genuine per-record read failure (a real regular file the classifier cannot read, e.g. a permissions error, never ENOENT/absence) must surface as the closed reason authority-record-unreadable -- today the requester family scan propagates readRegistryRecords own raw failure reason verbatim instead of translating it to the canonical literal', () => {
  const dir = makeGitProject();
  try {
    requesterBindingFixtureBase(dir);
    const requesterBindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    fs.mkdirSync(requesterBindingsDir, { recursive: true, mode: 0o700 });
    const unreadableId = 'b'.repeat(32);
    const unreadablePath = path.join(requesterBindingsDir, unreadableId + '.json');
    fs.writeFileSync(unreadablePath, JSON.stringify({ placeholder: true }), { mode: 0o600 });
    fs.chmodSync(unreadablePath, 0o000);

    let result;
    try {
      const identity = {
        schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
        repo_id: rll.computeRepoId(dir), runtime_session_key: 'm7-red-r12-4-session', agent_id: 'm7-red-r12-4-agent',
      };
      result = rll.classifyClaudeAuthorityForIdentity(dir, identity);
    } finally {
      fs.chmodSync(unreadablePath, 0o600);
    }
    assert.strictEqual(
      result.ok, false,
      'a genuinely unreadable primary record must fail the classification closed: ' + JSON.stringify(result)
    );
    assert.strictEqual(
      result.reason, 'authority-record-unreadable',
      'M7 section 6 own closed reason enum lists authority-record-unreadable for exactly this case -- today the requester scan propagates readRegistryRecords own raw reason string verbatim instead: ' + JSON.stringify(result)
    );
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CLASSIFIER-ADVERSARY-SCAN-CAP-R12-5 (guard, confirm): a family directory with more than CLAUDE_AUTHORITY_SCAN_CAP (1024) entries -- including a genuine live match among them -- must fail the classification as authority-scan-cap-exceeded, cap+1 failing even though a match already exists; verified rather than assumed per M7 section 6 own "cap+1 fails even if a match was already found"', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    const role = 'arch-testing';
    const sessionId = 'm7-red-r12-5-session';
    const agentId = 'm7-red-r12-5-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const minted = rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    assert.strictEqual(minted.ok, true, 'fixture: a genuine live match must exist among the overflowing entries: ' + JSON.stringify(minted));

    const requesterBindingsDir = path.join(rll.registryRepoDir(dir), 'requester-bindings');
    const CAP = 1024;
    for (let i = 0; i < CAP; i += 1) {
      const fillerId = i.toString(16).padStart(32, '0');
      if (fillerId === minted.binding.binding_id) continue;
      fs.writeFileSync(path.join(requesterBindingsDir, fillerId + '.json'), JSON.stringify({ filler: i }), { mode: 0o600 });
    }
    const entryCount = fs.readdirSync(requesterBindingsDir).length;
    assert.ok(entryCount > CAP, 'fixture sanity: the directory must genuinely exceed the scan cap: ' + entryCount);

    const testIdentity = {
      schema: 'runtime/claude-authority-identity/v1', provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity(dir, testIdentity);
    assert.strictEqual(result.ok, false, 'M7 section 6: cap+1 must fail even when a genuine match exists among the entries: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-scan-cap-exceeded');
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 3 of 3): R17, structural half
// ONLY. Mirrors this codebase's own established M7-SUPERSEDED-RESOLVER-ABSENT
// technique (runtime-consultation-role-gate.bats) for a duplicated per-family
// resolver -- here, runtime-consultation.cjs's own ROOT_SOURCE_INGRESS_FIELDS_LOCAL
// (~L6277-6291), a logic-duplicate of rll.validateRootSourceIngressRecord's
// own shape check, confirmed still present and still used by
// readRootSourceIngressOrThrow via assertClosedShape.
//
// A behavioral half (malformed/cross-binding ingress -> real CLI status/
// detail_code) was ATTEMPTED in runtime-consultation-role-gate.bats, reusing
// the real root-source binding+ingress fixture chain plus the wrapper's
// `cancel` subcommand -- but was REMOVED after empirically finding that
// `enforceRootSourceGrantBoundary`/`readRootSourceIngressOrThrow` are not
// actually reached via that call path (a tampered ingress record had zero
// effect on the cancel CLI's outcome). No such test exists in that file.
// The real command path that reaches ingress-adjacent validation was not
// identified in the time available; whoever adds a behavioral R17 proof
// needs to trace that path first.
// ════════════════════════════════════════════════════════════════════════════

test('M7-SUPERSEDED-RESOLVER-ABSENT-ROOT-INGRESS-LOCAL-R17 (RED): ROOT_SOURCE_INGRESS_FIELDS_LOCAL must be genuinely ABSENT from runtime-consultation.cjs -- M7 section 6/12 requires every duplicated per-family shape-checker be superseded by delegating to the ONE canonical rll.validateRootSourceIngressRecord (already exported); today this hook-local field-check table still exists and readRootSourceIngressOrThrow still validates against it via assertClosedShape', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-consultation.cjs'), 'utf8');
  assert.strictEqual(
    src.includes('ROOT_SOURCE_INGRESS_FIELDS_LOCAL'), false,
    'M7 section 6/12: runtime-consultation.cjs must delegate root-source ingress shape validation to rll.validateRootSourceIngressRecord, never maintain its own duplicate field-check table -- today ROOT_SOURCE_INGRESS_FIELDS_LOCAL still exists and is still used'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 3 of 3): R13. Confirmed by
// direct read of .claude/hooks/subagent-start-context-bundle.js's
// handleSubagentStop (~L492-625): classification computed (~539-548) ->
// role-equality check if ONE (~549-552) -> claudeId01Preflight runs
// UNCONDITIONALLY for every actor (~560-569, can BLOCK here) -> only THEN is
// shouldFence computed (~583). A noncanonical/ABSENT actor (shouldFence
// would be false) whose CLAUDE-ID-01 preflight state happens to be malformed
// gets blocked at the preflight before shouldFence is ever consulted, even
// though section 8.4 requires it to be the existing non-owning pass-through
// ("a noncanonical custom-name Agent with no current v2 candidate... writes
// nothing"). Triggers preflightClaudeId01TraceForSession's own
// requester-bindings malformed-record scan (~L3674-3683) directly -- the
// cheapest deterministic way to make it return {ok:false}, needing only a
// live session generation (resolveClaudeId01ScopeReadOnly) and a malformed
// record on disk, never the full multi-event CLAUDE-ID-01 trace machinery.
// ════════════════════════════════════════════════════════════════════════════

test('M7-SUBAGENTSTOP-PREFLIGHT-BEFORE-SHOULDFENCE-R13 (RED): handleSubagentStop must NOT block a noncanonical, non-owning (classifier ABSENT) actor whose CLAUDE-ID-01 preflight state happens to be malformed -- section 8.4 requires this exact case to be the existing zero-mutation pass-through (shouldFence is false), but today claudeId01Preflight runs and can block UNCONDITIONALLY, before shouldFence is ever computed', () => {
  const dir = makeGitProject();
  try {
    const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
    void worktreeId; void planDigest; // fixture also bootstraps the PLAN discoverPlan() needs below.
    const sessionId = 'm7-red-r13-session';
    const agentId = 'm7-red-r13-agent';
    const nonCanonicalAgentType = 'my-noncanonical-non-owning-custom-agent';

    const genResult = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(genResult.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(genResult));

    // Force preflightClaudeId01TraceForSession's OWN first fs.statSync(recordPath)
    // check to fail with a genuine non-ENOENT error (ENOTDIR), WITHOUT also
    // tripping classifyClaudeAuthorityForIdentity's separate requester-bindings
    // scan (a malformed record planted there fails BOTH checks, confounding
    // which one actually caused the block -- confirmed empirically: an
    // earlier version of this fixture used exactly that and the observed
    // block reason turned out to be the classifier's own, not this one).
    // recordPath's own parent directory is replaced with a plain file, so
    // stat-ing recordPath itself hits ENOTDIR while requester-bindings/
    // (a completely different subtree) stays untouched.
    const recordPath = rll.claudeId01RecordPathFor(dir, genResult.generationId, worktreeId, planDigest, nonCanonicalAgentType, rc.sha256String(agentId), undefined);
    const recordParentDir = path.dirname(recordPath);
    fs.mkdirSync(path.dirname(recordParentDir), { recursive: true, mode: 0o700 });
    fs.writeFileSync(recordParentDir, Buffer.from('blocking plain file where a directory is expected\n', 'utf8'));

    const hookPath = path.resolve(__dirname, '../../.claude/hooks/subagent-start-context-bundle.js');
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_WAVE_SLUG: '' });
    const result = spawnSync(process.execPath, [hookPath], {
      input: JSON.stringify({ hook_event_name: 'SubagentStop', session_id: sessionId, agent_id: agentId, agent_type: nonCanonicalAgentType }),
      encoding: 'utf8', env: commonEnv,
    });
    assert.strictEqual(result.status, 0, 'the hook process itself must always exit 0 (SubagentStop never has a real block mechanism beyond the JSON decision field): ' + JSON.stringify(result));

    let body = null;
    try { body = JSON.parse(result.stdout); } catch { /* empty stdout is the expected pass-through shape */ }
    assert.strictEqual(
      body, null,
      'M7 section 8.4: a noncanonical, non-owning (classifier ABSENT) actor must be the existing silent pass-through -- shouldFence is false for this exact identity, so it must never even reach the CLAUDE-ID-01 preflight check that can block it. Today claudeId01Preflight runs unconditionally BEFORE shouldFence is computed, so this malformed-but-irrelevant preflight state wrongly blocks the stop: ' + JSON.stringify({ stdout: result.stdout, stderr: result.stderr })
    );

    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId({ repoId: rll.computeRepoId(dir) }, 'claude-hook', sessionId, agentId);
    const fencePath = path.join(rll.registryRepoDir(dir), 'authority-identity-fences', authorityIdentityId + '.json');
    assert.strictEqual(fs.existsSync(fencePath), false, 'a non-owning pass-through must never publish a fence: ' + fencePath);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 3 of 3): R14. Confirmed by
// direct read that testM7Rendezvous (this file, ~L616-649) and its
// byte-identical runtime-consultation.cjs mirror (~L2537-2570) both perform
// TWO SEPARATE path-based syscalls -- fs.lstatSync(goPath) to validate
// regular/mode-0600/non-symlink, THEN a LATER, separate fs.readFileSync(goPath)
// to obtain the release bytes -- never a single held file descriptor
// (fs.openSync + fstatSync + read-from-fd). This is a classic TOCTOU: the
// path AT goPath can be replaced between the two calls. testM7Rendezvous is
// NOT exported, so this exercises it indirectly through createRequesterBinding
// (a real production create-after-admission-before-write call site),
// deterministically reproducing the race IN-PROCESS (no genuine multi-process
// timing needed) by monkey-patching the SHARED fs.lstatSync so that, as a
// synchronous side effect of the FIRST successful lstat of the legitimate
// regular .go file, it atomically swaps that same path for a symlink to a
// DIFFERENT (but byte-identical "go\n") file before returning control.
//
// M7 FINAL CORRECTION, correction round 1 (2026-08-18, C10): the assertion
// below is REWRITTEN per Codex's exact ruling. The prior assertion only
// checked `threw !== null` -- confirmed empirically (full-suite run,
// 2026-08-18) that under CURRENT production code this test takes
// ~6167ms to pass, meaning the swapped symlink is NOT detected specially at
// all: testM7Rendezvous's own poll loop keeps retrying (an invalid/replaced
// sentinel looks indistinguishable from ENOENT to it today) until
// RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS (5000ms) elapses, and ONLY THEN throws a
// generic timeout error -- "it threw something" is genuinely true, but for
// the WRONG reason (a slow timeout, not a fast, specific detection).
//
// PROPOSED PRODUCTION CONTRACT (toolkit-specialist: implement this EXACT
// string in BOTH testM7Rendezvous bodies -- runtime-role-lifecycle.cjs and
// its runtime-consultation.cjs mirror): on the .go side specifically, ENOENT
// on the initial fs.lstatSync/fs.openSync MAY continue the ordinary poll
// loop (the sentinel genuinely does not exist yet, routine). Any OTHER
// lstat/open outcome for an EXISTING path at goPath that is invalid --
// isSymbolicLink(), not isFile(), mode !== 0o600, or (after a successful
// open) bytes !== the exact literal "go\n" -- must throw IMMEDIATELY (no
// further polling, no waiting for the 5000ms budget) an Error whose
// `.message` contains the exact stable literal
// 'M7_RENDEZVOUS_INVALID_GO_SENTINEL'. This is the ONE test-only invalid-
// sentinel error both call sites must share, so this exact test (and its
// production counterpart, whichever lands first or is verified against the
// other) has one unambiguous, grep-able contract to implement/assert against.
// ════════════════════════════════════════════════════════════════════════════

test('M7-RENDEZVOUS-GO-TOCTOU-SYMLINK-SWAP-R14 (RED): testM7Rendezvous must reject an existing-but-invalid .go sentinel (here: swapped mid-flight for a symlink to a byte-identical-but-different file) IMMEDIATELY with the stable M7_RENDEZVOUS_INVALID_GO_SENTINEL error, never by silently accepting it as a genuine release nor by falling through to the generic 5000ms timeout -- deterministically swaps the .go path for a symlink BETWEEN the lstat call and the readFileSync call by monkey-patching fs.lstatSync as a synchronous side effect; today both bodies perform two SEPARATE syscalls against the path string with no sentinel-validity check on the existing-but-wrong case, so this swap is silently accepted as a genuine release even though neither ever re-verifies the identity of what it actually read', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const role = 'arch-testing';
  // Realpath-resolved UP FRONT: resolveSafeM7RendezvousDir internally
  // realpath()s the raw dir before computing its own goPath, so on macOS
  // (/var/folders/... symlinked from /private/var/folders/...) the path
  // testM7Rendezvous actually calls fs.lstatSync with differs, byte-for-byte,
  // from a goPath built off the RAW (non-realpath'd) os.tmpdir() -- a strict
  // p===goPath comparison inside the patch below would silently never match,
  // never engage the swap, and the race would look like it "did not fire"
  // rather than fail on the actual comparison (confirmed empirically: an
  // earlier version of this fixture used the raw path and swapped stayed
  // false for exactly this reason).
  const rendezvousDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'm7-r14-')));
  const originalLstatSync = fs.lstatSync;
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY,
    RUNTIME_M7_TEST_STAGE: process.env.RUNTIME_M7_TEST_STAGE,
    RUNTIME_M7_TEST_RENDEZVOUS_DIR: process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR,
  };
  try {
    const stage = 'create-after-admission-before-write';
    const goPath = path.join(rendezvousDir, stage + '.go');
    const swapTargetPath = path.join(rendezvousDir, 'attacker-controlled-swap-target.txt');
    fs.writeFileSync(swapTargetPath, Buffer.from('go\n', 'utf8'));
    fs.writeFileSync(goPath, Buffer.from('go\n', 'utf8'), { mode: 0o600 });
    fs.chmodSync(goPath, 0o600);

    let swapped = false;
    fs.lstatSync = function patchedLstatSync(p, ...rest) {
      const result = originalLstatSync.call(fs, p, ...rest);
      if (!swapped && p === goPath) {
        swapped = true;
        fs.unlinkSync(goPath);
        fs.symlinkSync(swapTargetPath, goPath);
      }
      return result;
    };

    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'm7-r14-toctou-capability';
    process.env.RUNTIME_M7_TEST_STAGE = stage;
    process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR = rendezvousDir;

    const sessionId = 'm7-red-r14-session';
    const agentId = 'm7-red-r14-agent';
    primeClaudeId01Trace(dir, role, sessionId, agentId);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };

    let threw = null;
    const callStart = Date.now();
    try {
      rll.createRequesterBinding(dir, identity, agentId, role, worktreeId, planDigest, 3600);
    } catch (e) {
      threw = e;
    }
    const callElapsedMs = Date.now() - callStart;

    assert.strictEqual(swapped, true, 'fixture sanity: the lstat-then-read interception must have genuinely engaged (fs.lstatSync must have been called on the exact .go path at least once) for this race to be meaningful');
    assert.notStrictEqual(
      threw, null,
      'M7 defect 12(c): testM7Rendezvous must never accept a release whose validated regular-file/mode/non-symlink lstat and its later byte-read do not correspond to the SAME durable file -- a symlink swapped into place BETWEEN the lstat call and the readFileSync call (pointing at a byte-identical but DIFFERENT file) is currently silently accepted as a genuine release, so the create-binding call this rendezvous gated proceeded as if a real release had occurred, instead of ever rejecting/timing out on the identity mismatch'
    );
    assert.strictEqual(
      typeof threw.message === 'string' && threw.message.includes('M7_RENDEZVOUS_INVALID_GO_SENTINEL'), true,
      'M7 correction round 1 (C10): testM7Rendezvous must throw the ONE stable test-only invalid-sentinel error (message containing the literal M7_RENDEZVOUS_INVALID_GO_SENTINEL) for an EXISTING-but-invalid .go path (here: a symlink), distinguishable from every other failure mode -- today the thrown error is a generic timeout/other error, never this specific literal: ' + JSON.stringify({ message: threw.message, name: threw.name })
    );
    assert.ok(
      callElapsedMs < 2000,
      'M7 correction round 1 (C10): an existing-but-invalid .go sentinel must be rejected IMMEDIATELY (no further polling), never by falling through to the ~5000ms RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS timeout budget -- today this call took ' + callElapsedMs + 'ms, consistent with the generic timeout path rather than a fast, specific detection'
    );
  } finally {
    fs.lstatSync = originalLstatSync;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION, correction round 1 (2026-08-18, C5): createRequesterBinding's
// own reuse path (the liveMatches.length===1 branch, ~1785-1851) scans
// requester-bindings/ directly via validateRequesterBindingFor per candidate
// -- it never consults classifyClaudeAuthorityForIdentity, the ONE canonical
// cross-family classifier section 6 otherwise mandates everywhere else in
// this file. So if the SAME claude-hook identity (session+agent) ALSO owns a
// concurrently live one-shot binding (a different family), the naive scan
// -- unaware one-shot even exists -- still finds and returns the requester
// binding, even though the canonical classifier would report the identity as
// authority-current-binding-ambiguous (more than one live candidate across
// ANY family). Per Codex's ruling this applies ONLY to claude-hook identities
// (codex-supervisor keeps its existing retained-host reuse path untouched --
// not exercised by this test at all).
// ════════════════════════════════════════════════════════════════════════════

test('C5-REQUESTER-REUSE-CONCURRENT-FOREIGN-FAMILY-AMBIGUOUS (RED): createRequesterBinding must run the canonical cross-family classifier before returning a requester-only reuse -- a live one-shot binding for the SAME claude-hook identity existing concurrently must deny with ambiguity, never silently return the naive requester-bindings-directory-scan match', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const role = 'arch-testing';
  const sessionId = 'c5-session';
  const agentKey = 'c5-agent';
  try {
    primeClaudeId01Trace(dir, role, sessionId, agentKey);
    const identity = { provider: 'claude-hook', runtime_session_key: sessionId };

    const first = rll.createRequesterBinding(dir, identity, agentKey, role, worktreeId, planDigest, 3600);
    assert.strictEqual(first.ok, true, 'fixture: first requester binding mint must succeed: ' + JSON.stringify(first));

    // A concurrent, genuinely LIVE one-shot binding for the IDENTICAL
    // identity (foreign family). createClaudeOneShotBinding's own real API
    // would correctly deny this (admission's expected:ABSENT check already
    // sees the identity as state:ONE/requester -- fixture-confirmed:
    // authority-binding-conflict) -- exactly the ordinary single-binding
    // invariant working as designed, not the gap this test isolates. This
    // fixture instead plants the second record directly on disk, mirroring
    // claude-one-shot-binding-red.bats' own established
    // _cosb_plant_conflicting_binding technique (M7 section 6's own
    // acknowledged "concurrent cross-family writers may leave two
    // diagnostic records" scenario -- a real, anticipated shape, not a
    // fabricated one).
    const genResult = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(genResult.ok, true, 'fixture: session generation resolve failed: ' + JSON.stringify(genResult));
    const oneShotBindingId = crypto.randomBytes(16).toString('hex');
    const oneShotRecord = {
      schema: 'runtime/claude-one-shot-binding/v2',
      binding_id: oneShotBindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime_session_key: sessionId,
      agent_id: agentKey,
      agent_type: role,
      native_spawn_action_id: rll.generateActionId(),
      request_id: crypto.randomBytes(32).toString('hex'),
      attempt_id: crypto.randomBytes(32).toString('hex'),
      lease_epoch: 0,
      role,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      session_generation_id: genResult.generationId,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      expiry: new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const oneShotPlanted = rll.writeRegistryRecordReplace(rll.claudeOneShotBindingPathFor(dir, oneShotBindingId), Buffer.from(JSON.stringify(oneShotRecord), 'utf8'));
    assert.strictEqual(oneShotPlanted.ok, true, 'fixture: competing one-shot plant must succeed: ' + JSON.stringify(oneShotPlanted));

    // A repeat createRequesterBinding call for the IDENTICAL tuple -- today's
    // naive liveMatches.length===1 scan (requester-bindings/ only) still
    // finds and returns the first requester binding, unaware the SAME
    // identity now also owns a live one-shot binding.
    const second = rll.createRequesterBinding(dir, identity, agentKey, role, worktreeId, planDigest, 3600);
    assert.strictEqual(second.ok, false, 'M7 C5: a requester-binding reuse must deny once the identity is ambiguous across families (a concurrent live one-shot binding exists) -- today it wrongly reuses the requester binding via a naive same-directory scan, never consulting the canonical cross-family classifier: ' + JSON.stringify(second));
    assert.strictEqual(second.reason, 'authority-current-binding-ambiguous', 'expected the classifier own ambiguous reason, got: ' + JSON.stringify(second));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION, correction round 1 (2026-08-18, C6): classifyClaudeAuthorityForIdentity's
// per-family scan callbacks (~4408-4480) each apply the IDENTICAL shallow
// legacy-classification pattern -- confirmed by direct read, all three:
//   if (obj && hasExactKeys(obj, <FAMILY>_KEYS) && obj.schema === <FAMILY>_SCHEMA) return { state: 'legacy' };
// -- a bare shape+schema-literal match, with ZERO further validation of
// field VALUES, timestamps, or binding_id<->path correlation, BEFORE this
// legacy short-circuit fires (which also runs before any identity
// comparison at all -- a malformed v1 record is silently absorbed as
// routine legacy regardless of who is asking). Each row below plants a
// record that satisfies the shallow shape+schema check but has a corrupted
// created_at (a non-canonical-ISO string) -- today wrongly classified
// state:'legacy' (contributing to legacy_count, zero error); target is
// { ok:false, reason:'authority-record-malformed' }.
// V1 key sets taken verbatim from this file's own frozen constants
// (ROOT_SOURCE_BINDING_KEYS/CLAUDE_ONE_SHOT_BINDING_KEYS, runtime-role-
// lifecycle.cjs ~2051-2056/3923-3927) for root-source/one-shot; requester's
// V1 shape is the real V2 shape (empirically captured from this file's own
// C5 test output above) minus session_generation_id, matching the
// established KEYS_V2 = KEYS_V1.concat(['session_generation_id']) pattern
// every OTHER binding type in this file already uses.
// ════════════════════════════════════════════════════════════════════════════

test('C6-MALFORMED-V1-REQUESTER (RED): a requester-bindings record with the exact v1 key-set and schema literal, but a corrupted (non-canonical) created_at, must be classified authority-record-malformed -- today classifyClaudeAuthorityForIdentity silently absorbs it as routine LEGACY_STALE with zero further validation', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'c6-requester-session';
  const agentKey = 'c6-requester-agent';
  try {
    const bindingId = crypto.randomBytes(16).toString('hex');
    const malformedV1 = {
      schema: 'coordination/requester-binding/v1',
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime: 'claude-hook',
      runtime_session_key: sessionId,
      agent_key: agentKey,
      role: 'arch-testing',
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: 'not-a-canonical-iso-timestamp',
      expiry: new Date(Date.now() + 3600000).toISOString(),
    };
    const planted = rll.writeRegistryRecordReplace(rll.requesterBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(malformedV1), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: malformed-v1 plant failed: ' + JSON.stringify(planted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentKey,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, identity);
    assert.strictEqual(result.ok, false, 'M7 C6: a malformed v1 requester record must fail classification outright, never be silently absorbed as routine legacy: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C6-MALFORMED-V1-ROOTSOURCE (RED): a root-source-bindings record with the exact v1 key-set and schema literal, but a corrupted (non-canonical) created_at, must be classified authority-record-malformed -- today classifyClaudeAuthorityForIdentity silently absorbs it as routine LEGACY_STALE with zero further validation', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'c6-rootsource-session';
  const agentId = 'c6-rootsource-agent';
  try {
    const bindingId = crypto.randomBytes(16).toString('hex');
    const malformedV1 = {
      schema: 'runtime/root-source-binding/v1',
      binding_id: bindingId,
      action_id: rll.generateActionId(),
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime: 'claude-hook',
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: 'toolkit-specialist',
      role: 'toolkit-specialist',
      reporting_architect: 'arch-platform',
      subject_bundle_ref: 'c6-fixture-subject-bundle-ref',
      subject_scope_digest: crypto.randomBytes(32).toString('hex'),
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: 'not-a-canonical-iso-timestamp',
      expiry: new Date(Date.now() + 3600000).toISOString(),
      request_expiry: new Date(Date.now() + 3600000).toISOString(),
    };
    const planted = rll.writeRegistryRecordReplace(rll.rootSourceBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(malformedV1), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: malformed-v1 plant failed: ' + JSON.stringify(planted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, identity);
    assert.strictEqual(result.ok, false, 'M7 C6: a malformed v1 root-source record must fail classification outright, never be silently absorbed as routine legacy: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C6-MALFORMED-V1-ONESHOT (RED): a claude-one-shot-bindings record with the exact v1 key-set and schema literal, but a corrupted (non-canonical) created_at, must be classified authority-record-malformed -- today classifyClaudeAuthorityForIdentity silently absorbs it as routine LEGACY_STALE with zero further validation', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'c6-oneshot-session';
  const agentId = 'c6-oneshot-agent';
  try {
    const bindingId = crypto.randomBytes(16).toString('hex');
    const malformedV1 = {
      schema: 'runtime/claude-one-shot-binding/v1',
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: 'arch-testing',
      native_spawn_action_id: rll.generateActionId(),
      request_id: crypto.randomBytes(32).toString('hex'),
      attempt_id: crypto.randomBytes(32).toString('hex'),
      lease_epoch: 0,
      role: 'arch-testing',
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: 'not-a-canonical-iso-timestamp',
      expiry: new Date(Date.now() + 3600000).toISOString(),
    };
    const planted = rll.writeRegistryRecordReplace(rll.claudeOneShotBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(malformedV1), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: malformed-v1 plant failed: ' + JSON.stringify(planted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, identity);
    assert.strictEqual(result.ok, false, 'M7 C6: a malformed v1 one-shot record must fail classification outright, never be silently absorbed as routine legacy: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M7 FINAL CORRECTION, correction round 1 (2026-08-18, C6 4th item): the
// oneShotScan callback's own liveness check (~4464-4479) is a NARROW,
// single-field "malformed wins over stale" discipline (M7 GREEN section 4.5,
// R5: agent_type!==role specifically) -- unlike requester/root-source's own
// scan callbacks, which (R12-3) run the COMPLETE validator regardless of
// identity match before ever reaching a stale/identity-mismatch verdict.
// One-shot's own light check never validates worktree_id/plan_digest shape
// at all -- a foreign-identity (different session/agent) v2 record with
// agent_type===role (passing the one check that exists) but a garbage
// worktree_id is silently absorbed as routine 'stale' today, never reaching
// authority-record-malformed.
test('C6-FOREIGN-MALFORMED-ONESHOT-V2 (RED): a foreign-identity (different session/agent) claude-one-shot-bindings v2 record that is otherwise well-formed (agent_type===role) but carries a structurally invalid worktree_id must be classified authority-record-malformed -- today the light liveness check only compares identity/expiry/generation, never validates worktree_id shape, so this is silently absorbed as routine stale', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const foreignSessionId = 'c6-foreign-oneshot-session';
  const foreignAgentId = 'c6-foreign-oneshot-agent';
  const queryingSessionId = 'c6-querying-oneshot-session';
  const queryingAgentId = 'c6-querying-oneshot-agent';
  try {
    const genResult = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: foreignSessionId });
    assert.strictEqual(genResult.ok, true, 'fixture: foreign session generation resolve failed: ' + JSON.stringify(genResult));
    const bindingId = crypto.randomBytes(16).toString('hex');
    const foreignMalformedV2 = {
      schema: 'runtime/claude-one-shot-binding/v2',
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime_session_key: foreignSessionId,
      agent_id: foreignAgentId,
      agent_type: 'arch-testing',
      native_spawn_action_id: rll.generateActionId(),
      request_id: crypto.randomBytes(32).toString('hex'),
      attempt_id: crypto.randomBytes(32).toString('hex'),
      lease_epoch: 0,
      role: 'arch-testing',
      // Structurally invalid: not a 64-hex digest -- never checked by the
      // light liveness check at all (only expiry+generation+identity are).
      worktree_id: 'not-a-valid-hex-digest',
      plan_digest: planDigest,
      session_generation_id: genResult.generationId,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      expiry: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const planted = rll.writeRegistryRecordReplace(rll.claudeOneShotBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(foreignMalformedV2), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: foreign malformed v2 plant failed: ' + JSON.stringify(planted));

    // Query for a COMPLETELY DIFFERENT identity -- the foreign record above
    // must never resolve as a candidate for THIS identity either way, but
    // its own malformed shape must still cause the WHOLE classification to
    // fail, never be silently skipped as "just someone else's stale record".
    const queryingIdentity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: queryingSessionId, agent_id: queryingAgentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, queryingIdentity);
    assert.strictEqual(result.ok, false, 'M7 C6: a foreign-identity one-shot v2 record with a structurally invalid worktree_id must fail the whole classification, never be silently absorbed as routine stale just because it belongs to a different identity: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 GREEN correction round 2, R4: a v1 record with a FUTURE created_at is
// otherwise exactly as well-formed as this file's own C6-MALFORMED-V1-*
// fixtures above (same field shapes, same helper), differing only in that
// created_at/expiry are genuine CANONICAL ISO timestamps (no milliseconds,
// matching C6-FOREIGN-MALFORMED-ONESHOT-V2's own `.replace(/\.\d{3}Z$/,
// 'Z')` technique) rather than a corrupted string -- created_at is simply
// set one year in the future, still satisfying created_at<=expiry. Today's
// three legacy-v1 checks only verify created_at<=expiry (never created_at
// vs the current clock), so a future-dated record wrongly passes every
// check and is classified routine LEGACY_STALE. Target:
// {ok:false,reason:'authority-record-malformed'} in all three families,
// per this mission's own text: "Un created_at futuro debe producir
// authority-record-malformed. No puede producir: LEGACY_STALE; ABSENT;
// reuse; fallback."
// ════════════════════════════════════════════════════════════════════════════

function canonicalIsoAt(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

test('M7-R4-FUTURE-CREATED-AT-REQUESTER (RED): a requester-bindings v1 record, otherwise fully well-formed, whose created_at is one year in the future must be classified authority-record-malformed, never LEGACY_STALE', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'r4-requester-future-session';
  const agentKey = 'r4-requester-future-agent';
  try {
    const bindingId = crypto.randomBytes(16).toString('hex');
    const futureMs = Date.now() + 365 * 24 * 3600 * 1000;
    const futureV1 = {
      schema: 'coordination/requester-binding/v1',
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime: 'claude-hook',
      runtime_session_key: sessionId,
      agent_key: agentKey,
      role: 'arch-testing',
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: canonicalIsoAt(futureMs),
      expiry: canonicalIsoAt(futureMs + 3600000),
    };
    const planted = rll.writeRegistryRecordReplace(rll.requesterBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(futureV1), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: future-created_at v1 plant failed: ' + JSON.stringify(planted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentKey,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, identity);
    assert.strictEqual(result.ok, false, 'M7 R4: a future-created_at v1 requester record must fail classification outright, never be silently absorbed as routine legacy: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-R4-FUTURE-CREATED-AT-ROOTSOURCE (RED): a root-source-bindings v1 record, otherwise fully well-formed, whose created_at is one year in the future must be classified authority-record-malformed, never LEGACY_STALE', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'r4-rootsource-future-session';
  const agentId = 'r4-rootsource-future-agent';
  try {
    const bindingId = crypto.randomBytes(16).toString('hex');
    const futureMs = Date.now() + 365 * 24 * 3600 * 1000;
    const futureV1 = {
      schema: 'runtime/root-source-binding/v1',
      binding_id: bindingId,
      action_id: rll.generateActionId(),
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime: 'claude-hook',
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: 'toolkit-specialist',
      role: 'toolkit-specialist',
      reporting_architect: 'arch-platform',
      subject_bundle_ref: 'r4-fixture-subject-bundle-ref',
      subject_scope_digest: crypto.randomBytes(32).toString('hex'),
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: canonicalIsoAt(futureMs),
      expiry: canonicalIsoAt(futureMs + 3600000),
      request_expiry: canonicalIsoAt(futureMs + 7200000),
    };
    const planted = rll.writeRegistryRecordReplace(rll.rootSourceBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(futureV1), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: future-created_at v1 plant failed: ' + JSON.stringify(planted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, identity);
    assert.strictEqual(result.ok, false, 'M7 R4: a future-created_at v1 root-source record must fail classification outright, never be silently absorbed as routine legacy: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-R4-FUTURE-CREATED-AT-ONESHOT (RED): a claude-one-shot-bindings v1 record, otherwise fully well-formed, whose created_at is one year in the future must be classified authority-record-malformed, never LEGACY_STALE', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'r4-oneshot-future-session';
  const agentId = 'r4-oneshot-future-agent';
  try {
    const bindingId = crypto.randomBytes(16).toString('hex');
    const futureMs = Date.now() + 365 * 24 * 3600 * 1000;
    const futureV1 = {
      schema: 'runtime/claude-one-shot-binding/v1',
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: 'arch-testing',
      native_spawn_action_id: rll.generateActionId(),
      request_id: crypto.randomBytes(32).toString('hex'),
      attempt_id: crypto.randomBytes(32).toString('hex'),
      lease_epoch: 0,
      role: 'arch-testing',
      worktree_id: worktreeId,
      plan_digest: planDigest,
      created_at: canonicalIsoAt(futureMs),
      expiry: canonicalIsoAt(futureMs + 3600000),
    };
    const planted = rll.writeRegistryRecordReplace(rll.claudeOneShotBindingPathFor(dir, bindingId), Buffer.from(JSON.stringify(futureV1), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: future-created_at v1 plant failed: ' + JSON.stringify(planted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const result = rll.classifyClaudeAuthorityForIdentity({ repoId: rll.computeRepoId(dir) }, identity);
    assert.strictEqual(result.ok, false, 'M7 R4: a future-created_at v1 one-shot record must fail classification outright, never be silently absorbed as routine legacy: ' + JSON.stringify(result));
    assert.strictEqual(result.reason, 'authority-record-malformed', 'expected authority-record-malformed, got: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 GREEN correction round 2, R2: checkAuthorityOperationTransactionTerminal's
// own root-source branch only checked `typeof ingressRead.obj.request_id ===
// 'string'` -- a shallow shape check, never the full closed-schema
// correlation validateRootSourceIngressRecord already provides (and
// mintRoleCommandGrant's own requester-authority root-source branch already
// uses for exactly this same ingress record). A correlate-broken ingress
// record (action_id pointing at a DIFFERENT action than the classifier's
// own binding names) still had a string request_id, so it silently passed
// straight through to the terminal-absence check using that unverified
// request_id. Target: {ok:false} with a reason distinguishing the
// correlation failure, never a proceed-as-if-valid.
// ════════════════════════════════════════════════════════════════════════════

test('M7-R2-SHALLOW-ROOT-INGRESS-CORRELATION (RED): checkAuthorityOperationTransactionTerminal must reject a root-source ingress record whose action_id does not correlate to the classifier own binding, even though its request_id is a well-formed string -- never proceed to the terminal check using an unverified ingress', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  try {
    const binding = {
      binding_id: crypto.randomBytes(16).toString('hex'),
      action_id: rll.generateActionId(),
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      worktree_id: worktreeId,
      plan_digest: planDigest,
      subject_scope_digest: crypto.randomBytes(32).toString('hex'),
      request_expiry: canonicalIsoAt(Date.now() + 3600000),
    };
    // Deliberately correlate-broken: action_id points at a DIFFERENT,
    // unrelated action than the classifier's own binding names above --
    // every other field is well-formed, and request_id is a genuine
    // well-formed string, so the OLD shallow check saw nothing wrong.
    const ingress = {
      schema: 'runtime/root-ingress/v1',
      binding_id: binding.binding_id,
      action_id: rll.generateActionId(),
      request_id: crypto.randomBytes(32).toString('hex'),
      request_digest: crypto.randomBytes(32).toString('hex'),
      source_role: 'toolkit-specialist',
      requester_instance_id: binding.actor_instance_id,
      target_role: 'arch-platform',
      subject_scope_digest: binding.subject_scope_digest,
      request_expiry: binding.request_expiry,
      worktree_id: binding.worktree_id,
      plan_digest: binding.plan_digest,
      created_at: canonicalIsoAt(Date.now()),
    };
    const planted = rll.writeRegistryRecordReplace(rll.rootSourceIngressPathFor(dir, binding.binding_id), Buffer.from(JSON.stringify(ingress), 'utf8'));
    assert.strictEqual(planted.ok, true, 'fixture: ingress plant failed: ' + JSON.stringify(planted));

    const result = rll.checkAuthorityOperationTransactionTerminal(dir, 'root-source', binding);
    assert.strictEqual(result.ok, false, 'M7 R2: a correlate-broken root-source ingress (action_id mismatch) must be rejected, never proceed to the terminal check using its unverified request_id: ' + JSON.stringify(result));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION, correction round 1 (2026-08-18, C10): permanent
// coverage for admitClaudeAuthorityOperation's own `expectedBacking` param
// (M7 defect 1: "admission must confirm the classifier's own ONE candidate
// is exactly the caller's already-proven backing, never any other live
// authority for the same identity" -- checkClaudeAuthorityClassificationAgainstExpected,
// runtime-role-lifecycle.cjs ~4535-4546). Confirmed via a complete name-by-
// name read of this file's own full test-run summary (2026-08-18, 167
// tests) that no test named M7-CAPABILITY-EXPECTED-BACKING-PIN (nor any
// close variant) exists anywhere in this file today -- created fresh per
// the dispatch's own explicit fallback. A genuinely LIVE one-shot binding
// backs all three scenarios (mint-time correctness is not in question here,
// only admission's own expectedBacking cross-check).
// ════════════════════════════════════════════════════════════════════════════

test('M7-CAPABILITY-EXPECTED-BACKING-PIN (wrong family denies): admitClaudeAuthorityOperation must deny when expectedBacking.family does not match the classifier own ONE candidate family, even though bindingId and the underlying identity are otherwise exactly correct', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'm7-backingpin-wrongfamily-session';
  const agentId = 'm7-backingpin-wrongfamily-agent';
  try {
    const genResult = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(genResult.ok, true, 'fixture: session generation resolve failed: ' + JSON.stringify(genResult));
    const minted = rll.createClaudeOneShotBinding(
      dir, sessionId, genResult.generationId, agentId, 'arch-testing', rll.generateActionId(),
      crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'), 0,
      'arch-testing', worktreeId, planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a genuine live one-shot binding must mint: ' + JSON.stringify(minted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const deadline = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const admission = rll.admitClaudeAuthorityOperation(
      dir, identity, 'consume-grant', deadline,
      { family: 'requester', bindingId: minted.binding.binding_id },
    );
    assert.strictEqual(admission.ok, false, 'M7 defect 1: admission must deny when expectedBacking.family (requester) does not match the classifier own ONE candidate family (one-shot), even with the exact correct bindingId: ' + JSON.stringify(admission));
    assert.strictEqual(admission.reason, 'authority-binding-conflict', 'expected authority-binding-conflict, got: ' + JSON.stringify(admission));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CAPABILITY-EXPECTED-BACKING-PIN (wrong bindingId denies): admitClaudeAuthorityOperation must deny when expectedBacking.bindingId does not match the classifier own ONE candidate binding_id, even though family and the underlying identity are otherwise exactly correct', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'm7-backingpin-wrongid-session';
  const agentId = 'm7-backingpin-wrongid-agent';
  try {
    const genResult = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(genResult.ok, true, 'fixture: session generation resolve failed: ' + JSON.stringify(genResult));
    const minted = rll.createClaudeOneShotBinding(
      dir, sessionId, genResult.generationId, agentId, 'arch-testing', rll.generateActionId(),
      crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'), 0,
      'arch-testing', worktreeId, planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a genuine live one-shot binding must mint: ' + JSON.stringify(minted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    const wrongBindingId = crypto.randomBytes(16).toString('hex');
    assert.notStrictEqual(wrongBindingId, minted.binding.binding_id, 'fixture sanity: the wrong id must genuinely differ from the real one');
    const deadline = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const admission = rll.admitClaudeAuthorityOperation(
      dir, identity, 'consume-grant', deadline,
      { family: 'one-shot', bindingId: wrongBindingId },
    );
    assert.strictEqual(admission.ok, false, 'M7 defect 1: admission must deny when expectedBacking.bindingId does not match the classifier own ONE candidate binding_id, even with the exact correct family: ' + JSON.stringify(admission));
    assert.strictEqual(admission.reason, 'authority-binding-conflict', 'expected authority-binding-conflict, got: ' + JSON.stringify(admission));
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-CAPABILITY-EXPECTED-BACKING-PIN (exact-positive control): admitClaudeAuthorityOperation must succeed when expectedBacking.family and .bindingId both exactly match the classifier own ONE candidate -- control proving the two denial cases above are attributable to their own specific mismatch, not a blanket rejection', () => {
  const dir = makeGitProject();
  const { worktreeId, planDigest } = requesterBindingFixtureBase(dir);
  const sessionId = 'm7-backingpin-positive-session';
  const agentId = 'm7-backingpin-positive-agent';
  try {
    const genResult = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(genResult.ok, true, 'fixture: session generation resolve failed: ' + JSON.stringify(genResult));
    const minted = rll.createClaudeOneShotBinding(
      dir, sessionId, genResult.generationId, agentId, 'arch-testing', rll.generateActionId(),
      crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'), 0,
      'arch-testing', worktreeId, planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a genuine live one-shot binding must mint: ' + JSON.stringify(minted));

    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: rll.computeRepoId(dir), runtime_session_key: sessionId, agent_id: agentId,
    };
    // M7 correction round 1 (C2, Codex final ruling): the one-shot family's
    // own step-5 terminal read now derives its txnDir INTERNALLY from
    // repoDescriptor (a real projectRoot string) plus the classifier's own
    // returned binding (plan_digest/request_id) -- never a caller-supplied
    // txnDir (runtime-role-lifecycle.cjs checkAuthorityOperationTransactionTerminal,
    // ~4916-4948). The fixture's own request_id/attempt_id (fabricated
    // random hex, never published against) resolves to a path where
    // genuinely nothing exists, which is sufficient to prove "no terminal";
    // this positive control isolates the expectedBacking match itself, not
    // transaction-terminal plumbing.
    const deadline = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const admission = rll.admitClaudeAuthorityOperation(
      dir, identity, 'consume-grant', deadline,
      { family: 'one-shot', bindingId: minted.binding.binding_id },
    );
    assert.strictEqual(admission.ok, true, 'positive control: admission must succeed when expectedBacking exactly matches the classifier own ONE candidate: ' + JSON.stringify(admission));
    assert.strictEqual(admission.classification.family, 'one-shot');
    assert.strictEqual(admission.classification.binding.binding_id, minted.binding.binding_id);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
