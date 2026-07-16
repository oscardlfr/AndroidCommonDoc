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

// ── MainOrchestratorBinding ──────────────────────────────────────────────────

test('createMainOrchestratorBinding: binding carries the resolved session_generation_id and the exact worktree_id/plan_digest supplied', () => {
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
    const genResult = rll.resolveSessionGeneration(dir, identity);
    assert.strictEqual(result.binding.session_generation_id, genResult.generationId);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rebindMainOrchestratorBindingForNewPlan: preserves session_generation_id + runtime + actor_instance_id, changes plan_digest + binding_id', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'rebind-test');
    const worktreeId = rll.computeWorktreeId(dir);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'rebind-session' };
    const original = rll.createMainOrchestratorBinding(dir, identity, worktreeId, 'a'.repeat(64), 120);
    const rebound = rll.rebindMainOrchestratorBindingForNewPlan(dir, original.binding, 'b'.repeat(64), 120);
    assert.strictEqual(rebound.ok, true);
    assert.strictEqual(rebound.binding.session_generation_id, original.binding.session_generation_id);
    assert.strictEqual(rebound.binding.runtime, original.binding.runtime);
    assert.strictEqual(rebound.binding.actor_instance_id, original.binding.actor_instance_id);
    assert.strictEqual(rebound.binding.plan_digest, 'b'.repeat(64));
    assert.notStrictEqual(rebound.binding.binding_id, original.binding.binding_id);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── lifecycle-command-grant/v1 ───────────────────────────────────────────────

function makeBindingFixture(dir) {
  writePlanFixture(dir, 'grant-test-' + Math.random().toString(16).slice(2));
  const worktreeId = rll.computeWorktreeId(dir);
  const plan = rll.discoverPlan(dir);
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'grant-fixture-session-' + Math.random().toString(16).slice(2) };
  return rll.createMainOrchestratorBinding(dir, identity, worktreeId, plan.planDigest, 120).binding;
}

test('mintLifecycleCommandGrant + validateAndConsumeLifecycleCommandGrant: succeeds exactly once for matching argv shape', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'digest-abc', 'arch-testing', 'ensure');
    assert.strictEqual(grant.ok, true);
    const consumed = rll.validateAndConsumeLifecycleCommandGrant(dir, grant.grantId, 'digest-abc', 'arch-testing', 'ensure');
    assert.strictEqual(consumed.ok, true);
    assert.strictEqual(consumed.binding.binding_id, binding.binding_id);
    assert.strictEqual(consumed.generationId, binding.session_generation_id);
  } finally {
    fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAndConsumeLifecycleCommandGrant: REPLAY (same grant_id used twice) is rejected the second time', () => {
  const dir = makeGitProject();
  try {
    const binding = makeBindingFixture(dir);
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'digest-replay', 'arch-testing', 'ensure');
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
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'digest-original', 'arch-testing', 'ensure');
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
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'digest-x', 'arch-testing', 'ensure');
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
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'digest-x', 'arch-testing', 'ensure');
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
    const grant = rll.mintLifecycleCommandGrant(dir, binding, 'digest-expiry', 'arch-testing', 'ensure');
    const grantPath = rll.grantPathFor(dir, grant.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    rec.expires_at = '2000-01-01T00:00:00Z';
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
