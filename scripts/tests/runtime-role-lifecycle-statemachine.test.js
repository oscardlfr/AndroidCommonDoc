#!/usr/bin/env node
'use strict';

// WP3 unit-level coverage for runtime-role-lifecycle.cjs's role-binding state
// machine, action registry/generation, and CapabilityProvider seam. Sibling of
// runtime-role-lifecycle-registry.test.js (identity/registry/session/binding/
// grant) -- this file covers the layer built ON TOP of that foundation.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-sm-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-sm-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL SM Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

const W = 'w'.repeat(64);
const P = 'p'.repeat(64);
const PROF = rll.roleProfileDigestFor('arch-testing');
const GEN = 'g'.repeat(32);
const ROLE = 'arch-testing';

// ── State machine ────────────────────────────────────────────────────────────

test('readRoleBindingState: a never-created binding is the implicit ABSENT state', () => {
  const dir = makeGitProject();
  try {
    const result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.state, 'ABSENT');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: full happy chain ABSENT->STARTING->READY->WAITING->BUSY->WAITING, binding_id stable throughout', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    assert.strictEqual(t1.ok, true);
    const bindingId = t1.record.binding_id;
    const t2 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(t2.ok, true);
    const t3 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'WAITING', t2.record, {});
    assert.strictEqual(t3.ok, true);
    const t4 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'WAITING', 'BUSY', t3.record, {});
    assert.strictEqual(t4.ok, true);
    const t5 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'BUSY', 'WAITING', t4.record, {});
    assert.strictEqual(t5.ok, true);
    for (const t of [t1, t2, t3, t4, t5]) assert.strictEqual(t.record.binding_id, bindingId);
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: DEAD->REHYDRATING->READY respawn chain', () => {
  const dir = makeGitProject();
  try {
    let t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t.record, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'DEAD', t.record, {});
    assert.strictEqual(t.ok, true);
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'DEAD', 'REHYDRATING', t.record, {});
    assert.strictEqual(t.ok, true);
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'REHYDRATING', 'READY', t.record, {});
    assert.strictEqual(t.ok, true);
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: ROTATING->REHYDRATING->READY rotation chain', () => {
  const dir = makeGitProject();
  try {
    let t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t.record, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'ROTATING', t.record, {});
    assert.strictEqual(t.ok, true);
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ROTATING', 'REHYDRATING', t.record, {});
    assert.strictEqual(t.ok, true);
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'REHYDRATING', 'READY', t.record, {});
    assert.strictEqual(t.ok, true);
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: READY->STOPPING->STOPPED is terminal (no further transitions defined)', () => {
  const dir = makeGitProject();
  try {
    let t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t.record, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'STOPPING', t.record, {});
    assert.strictEqual(t.ok, true);
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STOPPING', 'STOPPED', t.record, {});
    assert.strictEqual(t.ok, true);
    assert.strictEqual(rll.ROLE_BINDING_TRANSITIONS.STOPPED.size, 0, 'STOPPED must have zero outgoing transitions');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: STARTING->QUARANTINED (ambiguous owner) is terminal for this binding key', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    const t2 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'QUARANTINED', t1.record, { reason: 'ambiguous-owner' });
    assert.strictEqual(t2.ok, true);
    assert.strictEqual(rll.ROLE_BINDING_TRANSITIONS.QUARANTINED.size, 0, 'QUARANTINED must have zero outgoing transitions -- never reused');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: every illegal edge NOT in the closed graph is rejected -- exhaustive pairwise check', () => {
  const dir = makeGitProject();
  try {
    for (const from of rll.ROLE_BINDING_STATE_ENUM) {
      for (const to of rll.ROLE_BINDING_STATE_ENUM) {
        if (rll.ROLE_BINDING_TRANSITIONS[from].has(to)) continue; // legal edge, skip
        // Seed a record claiming to be in `from` state (best-effort direct write for
        // this exhaustive negative sweep only -- production never does this).
        const recPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
        fs.mkdirSync(path.dirname(recPath), { recursive: true, mode: 0o700 });
        const fakeRecord = { schema: 'runtime/role-binding/v1', binding_id: 'a'.repeat(32), role: ROLE, worktree_id: W, plan_digest: P, profile_digest: PROF, session_generation_id: GEN, state: from, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' };
        fs.writeFileSync(recPath, JSON.stringify(fakeRecord), { mode: 0o600 });
        const result = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, from, to, fakeRecord, {});
        assert.strictEqual(result.ok, false, `${from} -> ${to} must be rejected (not in the closed graph)`);
        assert.strictEqual(result.reason, 'illegal-state-transition');
        fs.rmSync(recPath, { force: true });
      }
    }
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: a STALE fromRecord (already superseded by a concurrent transition) is rejected, never silently overwritten', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    const t2 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(t2.ok, true);
    // Attempt a SECOND transition from the now-stale t1.record (as if a second,
    // slower reader tried to act on the pre-transition snapshot).
    const staleAttempt = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(staleAttempt.ok, false);
    assert.strictEqual(staleAttempt.reason, 'stale-binding-read');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: concurrent ABSENT->STARTING creation collides (second caller loses, never double-creates)', () => {
  const dir = makeGitProject();
  try {
    const first = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    assert.strictEqual(first.ok, true);
    const second = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, {});
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'concurrent-creation');
  } finally {
    cleanup(dir);
  }
});

// ── Action generation ────────────────────────────────────────────────────────

test('mintRoleLifecycleAction: exact envelope fields, action_id is 128-bit hex, one-use (no-clobber underneath)', () => {
  const dir = makeGitProject();
  try {
    const payload = rll.buildTeamEnsurePayload('team-x', 'ensure the support plane');
    const actionId = rll.generateActionId();
    const result = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'claude-native', 'r'.repeat(64), W, P, 'd'.repeat(64), GEN, null, payload);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.actionId, actionId);
    assert.match(result.actionId, /^[0-9a-f]{32}$/);
    const envelope = rll.actionForEnvelope(result.action);
    assert.strictEqual(envelope.schema, 'coordination/role-lifecycle-action/v1');
    assert.strictEqual(envelope.kind, 'team-ensure');
    assert.strictEqual(envelope.runtime, 'claude-native');
    assert.strictEqual(envelope.role, null);
    assert.deepStrictEqual(envelope.payload, payload);
  } finally {
    cleanup(dir);
  }
});

test('mintRoleLifecycleAction: rejects an unknown kind (closed union enforcement)', () => {
  const dir = makeGitProject();
  try {
    const result = rll.mintRoleLifecycleAction(dir, rll.generateActionId(), 'totally-invalid-kind', 'claude-native', 'r'.repeat(64), W, P, 'd'.repeat(64), GEN, null, {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'invalid-kind');
  } finally {
    cleanup(dir);
  }
});

test('buildSupervisorStartPayload: bridge_command is the canonical render of bridge_argv, round-trips through parsePosixDirect', () => {
  const payload = rll.buildSupervisorStartPayload('/usr/bin/node', '/abs/bridge.cjs', 'a'.repeat(32), '/coord/root', ['arch-testing', 'context-provider'], '2026-01-01T00:00:00Z');
  assert.deepStrictEqual(payload.bridge_argv, [
    '/usr/bin/node', '/abs/bridge.cjs', 'session-run', '--action', 'a'.repeat(32),
    '--coordination-root', '/coord/root', '--role', 'arch-testing', '--role', 'context-provider',
    '--session-expiry', '2026-01-01T00:00:00Z',
  ]);
  const decoded = rll.parsePosixDirect(payload.bridge_command);
  assert.deepStrictEqual(decoded, payload.bridge_argv, 'bridge_command must parse back to the exact bridge_argv (canonical round-trip)');
});

// ── CapabilityProvider ───────────────────────────────────────────────────────

test('selectDriverForRole: picks the first ROUTING-ORDER driver that is actually available, never reorders by availability', () => {
  const routing = { routes: { 'arch-testing': ['claude-sendmessage', 'claude-agent', 'codex-app-server', 'noop'] } };
  // Only codex-app-server and claude-agent are "available" -- routing prefers
  // claude-agent (2nd) over codex-app-server (3rd); claude-sendmessage (1st) is
  // NOT available, so it must be skipped, not silently promoted.
  const manifest = { availableDrivers: ['codex-app-server', 'claude-agent'] };
  const selected = rll.selectDriverForRole(routing, 'arch-testing', manifest);
  assert.strictEqual(selected, 'claude-agent', 'must respect routing PREFERENCE ORDER among available drivers, not availableDrivers array order');
});

test('selectDriverForRole: with zero proven capability, falls through to noop ONLY if routing lists it for this role', () => {
  const routingWithNoop = { routes: { 'arch-testing': ['claude-agent', 'noop'] } };
  const selected = rll.selectDriverForRole(routingWithNoop, 'arch-testing', { availableDrivers: [] });
  assert.strictEqual(selected, 'noop');

  const routingWithoutNoop = { routes: { 'verifier': ['codex-app-server', 'codex-mcp'] } };
  const noneSelected = rll.selectDriverForRole(routingWithoutNoop, 'verifier', { availableDrivers: [] });
  assert.strictEqual(noneSelected, null, 'zero capability and no noop entry for this role must select nothing, never fabricate a driver');
});

test('getCapabilityManifest: production (no test capability) always reports zero available drivers -- never inferred from env/binary/model text', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFakeCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['codex-app-server']);
    const result = rll.getCapabilityManifest();
    assert.deepStrictEqual(result, { ok: true, availableDrivers: [] }, 'even with a fake-capabilities env var set, production must ignore it entirely');
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFakeCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCap;
  }
});

test('getCapabilityManifest: test capability + well-formed fake manifest is honored', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFakeCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['codex-app-server', 'noop']);
    const result = rll.getCapabilityManifest();
    assert.deepStrictEqual(result, { ok: true, availableDrivers: ['codex-app-server', 'noop'] });
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFakeCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCap;
  }
});

test('getCapabilityManifest: an unrecognized driver name in the fake manifest is rejected wholesale (fail closed, not a partial filter)', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFakeCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['codex-app-server', 'not-a-real-driver']);
    const result = rll.getCapabilityManifest();
    assert.deepStrictEqual(result, { ok: true, availableDrivers: [] });
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFakeCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCap;
  }
});
