#!/usr/bin/env node
'use strict';

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
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);

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
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(recPath, 0o600);
    fs.writeFileSync(recPath, JSON.stringify(rec), { mode: 0o600 });
    const peeked = rll.peekSessionGeneration(dir, identity);
    assert.strictEqual(peeked.ok, false);
    assert.strictEqual(peeked.reason, 'session-generation-expired');
    // The stale record on disk is untouched -- a peek never rewrites/rotates it.
    const afterBytes = fs.readFileSync(recPath, 'utf8');
    assert.strictEqual(JSON.parse(afterBytes).expires_at, '2000-01-01T00:00:00Z');
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
