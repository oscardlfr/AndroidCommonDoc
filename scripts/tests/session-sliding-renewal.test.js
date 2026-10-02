'use strict';

// Sliding session: the session generation and an actor's binding expire after ONE HOUR OF INACTIVITY (idle timeout) and never
// live beyond TWELVE HOURS from their creation (absolute timeout). Only a hook renews, after the identity proof has passed.
// The injectable clock moves this process's Date (the same offset the full-wave test gives its children).

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const rc = require('../lib/runtime-consultation.cjs');
const renewal = require('../lib/runtime-session-renewal.cjs');
const { installConsumerFixture, toolkitHostContractAvailable } = require('./lib/consumer-runtime-fixture.cjs');
const { primeClaudeId01V2ActorProof } = require('./fixtures/runtime-claude-id01-v2-fixture.cjs');

const SKIP = toolkitHostContractAvailable() ? false : `no signed Claude host contract for ${process.platform} in this toolkit`;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const RealDate = Date;
const clock = { offsetMs: 0 };
class OffsetDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + clock.offsetMs); else super(...args); }
  static now() { return RealDate.now() + clock.offsetMs; }
}
global.Date = OffsetDate;

const SESSION = 'sliding-session';
const ROLE = 'arch-testing';

function project() {
  const fixture = installConsumerFixture('L2');
  const root = fixture.consumerRoot;
  fs.mkdirSync(path.join(root, '.planning', 'wave-sliding'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'wave-sliding', 'PLAN.md'), '# sliding\n');
  spawnSync('git', ['switch', '-q', '-c', 'feature/sliding'], { cwd: root });
  return root;
}

function actor(root, agentId) {
  const generation = rll.resolveSessionGeneration(root, { ok: true, provider: 'claude-hook', runtime_session_key: SESSION });
  const plan = rll.discoverPlan(root);
  const mint = (suffix) => {
    const id = rll.generateActionId();
    const minted = rll.mintRoleLifecycleAction(root, id, 'role-spawn', 'claude-native', rll.computeRepoId(root), rll.computeWorktreeId(root),
      plan.planDigest, crypto.createHash('sha256').update('sliding:' + suffix).digest('hex'), generation.generationId, ROLE,
      rll.buildRoleSpawnPayload('claude-id01-probe', ROLE, ROLE, 'fixture', 'fixture'),
      new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    return id;
  };
  const a = mint('a-' + agentId); const b = mint('b-' + agentId);
  const o = { sessionId: SESSION, agentId, agentType: ROLE };
  rll.recordClaudeId01SubagentStartObservation(root, { ...o, actionId: a });
  rll.recordClaudeId01PreToolUseObservation(root, { ...o, toolUseId: 't1' + agentId });
  rll.recordClaudeId01PreToolUseObservation(root, { ...o, toolUseId: 't2' + agentId });
  rll.recordClaudeId01SubagentStartObservation(root, { ...o, actionId: a });
  rll.recordClaudeId01PreToolUseObservation(root, { ...o, toolUseId: 't3' + agentId });
  rll.recordClaudeId01SubagentStartObservation(root, { sessionId: SESSION, agentId: agentId + '-b', agentType: ROLE, actionId: b });
  primeClaudeId01V2ActorProof({ projectRoot: root, agentType: ROLE, sessionId: SESSION, agentId, actionId: a, prefix: 'sliding-v2', actorBindingTtlSeconds: 3600 });
  return { generation, plan, worktreeId: rll.computeWorktreeId(root) };
}

const proof = (root, ctx, agentId) => rll.checkClaudeId01ProofComplete(root, SESSION, ctx.worktreeId, ctx.plan.planDigest, ROLE, agentId);
const generationRecord = (root) => JSON.parse(fs.readFileSync(rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION }), 'utf8'));
const hookRenew = (root, agentId) => renewal.renewSessionActivityForHook(root, { sessionId: SESSION, agentId, agentType: ROLE });

test('idle timeout: one hour without activity expires the proof, with the idle reason', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'idle-agent');
    assert.strictEqual(proof(root, ctx, 'idle-agent').ok, true);
    clock.offsetMs = 61 * MIN;
    assert.strictEqual(proof(root, ctx, 'idle-agent').ok, false, 'no activity for 61 minutes: the proof is gone');
    assert.strictEqual(rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION }).reason, 'session-generation-expired');
  } finally { clock.offsetMs = 0; }
});

test('verified activity every 30 minutes keeps the proof alive past the first hour, up to +5 h, with no respawn', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'live-agent');
    const created = generationRecord(root).created_at;
    for (let minutes = 30; minutes <= 5 * 60; minutes += 30) {
      clock.offsetMs = minutes * MIN;
      const renewal = hookRenew(root, 'live-agent');
      assert.strictEqual(renewal.reason, undefined, `renewal at +${minutes} min: ${JSON.stringify(renewal)}`);
      assert.strictEqual(proof(root, ctx, 'live-agent').ok, true, `proof alive at +${minutes} min`);
    }
    assert.strictEqual(generationRecord(root).generation_id, ctx.generation.generationId, 'the generation id never changes');
    assert.strictEqual(generationRecord(root).created_at, created);
  } finally { clock.offsetMs = 0; }
});

test('absolute timeout: continuous activity still ends at 12 hours from creation', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'abs-agent');
    for (let minutes = 30; minutes < 12 * 60; minutes += 30) { clock.offsetMs = minutes * MIN; hookRenew(root, 'abs-agent'); }
    clock.offsetMs = 12 * HOUR - MIN;
    assert.strictEqual(rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION }).ok, true, 'alive one minute before the absolute limit');
    clock.offsetMs = 12 * HOUR + MIN;
    const peek = rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION });
    assert.strictEqual(peek.reason, 'session-generation-absolute-expired');
    assert.strictEqual(proof(root, ctx, 'abs-agent').ok, false);
    const late = hookRenew(root, 'abs-agent');
    assert.strictEqual(late.renewed, false, 'nothing is renewed past the absolute limit');
  } finally { clock.offsetMs = 0; }
});

test('renewal is cadenced: no write while more than 3000 s of idle time remain', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    actor(root, 'cadence-agent');
    const before = fs.readFileSync(rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION }), 'utf8');
    clock.offsetMs = 5 * MIN; // 55 minutes left
    assert.strictEqual(hookRenew(root, 'cadence-agent').renewed, false);
    assert.strictEqual(fs.readFileSync(rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION }), 'utf8'), before, 'the record was not rewritten');
    clock.offsetMs = 15 * MIN; // 45 minutes left: below the threshold
    assert.strictEqual(hookRenew(root, 'cadence-agent').renewed, true);
  } finally { clock.offsetMs = 0; }
});

test('only a verified identity renews: a fenced actor, an unknown agent id and a foreign role extend nothing', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'real-agent');
    clock.offsetMs = 40 * MIN;
    // Another identity that never proved itself.
    assert.strictEqual(hookRenew(root, 'impostor-agent').renewed, false);
    // The right agent id under a role it does not hold.
    assert.strictEqual(renewal.renewSessionActivityForHook(root, { sessionId: SESSION, agentId: 'real-agent', agentType: 'arch-platform' }).renewed, false);
    const untouched = generationRecord(root);
    assert.strictEqual(untouched.expires_at, ctx.generation.expiresAt, 'neither attempt extended the generation');
    // A fenced actor (returned): no renewal either.
    const identityId = rll.computeClaudeAuthorityIdentityId(root, 'claude-hook', SESSION, 'real-agent');
    assert.strictEqual(rll.publishClaudeAuthorityFence(root, identityId).ok, true);
    assert.strictEqual(hookRenew(root, 'real-agent').renewed, false);
    assert.strictEqual(generationRecord(root).expires_at, ctx.generation.expiresAt, 'a fenced actor extends nothing');
  } finally { clock.offsetMs = 0; }
});

test('immutable startup records carry an absolute lifetime and their digests never change across renewals', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'digest-agent');
    const generation = rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION });
    const tracesDir = path.join(rll.registryRepoDir(root), 'claude-id01-traces');
    const traceFile = fs.readdirSync(tracesDir).find((name) => name.startsWith('startup-v2-'));
    const readTrace = () => JSON.parse(fs.readFileSync(path.join(tracesDir, traceFile), 'utf8'));
    const trace = readTrace();
    const absoluteLimit = Date.parse(generation.createdAt) + 12 * HOUR;
    assert.ok(Date.parse(trace.expiry) > Date.now() + 2 * HOUR, `trace expiry is absolute, not one hour: ${trace.expiry}`);
    assert.ok(Date.parse(trace.expiry) <= absoluteLimit, 'and never beyond the absolute limit');
    const digestBefore = rc.sha256String(rc.canonicalJSONStringify(trace));
    for (let minutes = 30; minutes <= 3 * 60; minutes += 30) { clock.offsetMs = minutes * MIN; hookRenew(root, 'digest-agent'); }
    assert.strictEqual(rc.sha256String(rc.canonicalJSONStringify(readTrace())), digestBefore, 'the trace was never rewritten');
    assert.strictEqual(proof(root, ctx, 'digest-agent').ok, true, 'and the capability that embeds its digest still verifies');
  } finally { clock.offsetMs = 0; }
});
