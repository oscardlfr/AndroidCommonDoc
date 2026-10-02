#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const auth = require('../lib/context-provider-actor-authorization.cjs');
const {
  primeClaudeId01V2ActorProof,
  claudeId01V2SessionEvidenceFor,
} = require('./fixtures/runtime-claude-id01-v2-fixture.cjs');

const ROOT = path.resolve(__dirname, '../..');
const CONSULTED_HOOK = path.join(ROOT, '.claude', 'hooks', 'context-provider-consulted.js');
const GATE_HOOK = path.join(ROOT, '.claude', 'hooks', 'context-provider-gate.js');

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-actor-auth-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  fs.mkdirSync(path.join(root, '.planning', 'wave-d5-actor-auth'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'wave-d5-actor-auth', 'PLAN.md'), '# D5 actor authorization\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function actors(root) {
  const plan = rll.discoverPlan(root);
  assert.strictEqual(plan.ok, true);
  const worktreeId = rll.computeWorktreeId(root);
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  return {
    issuer: {
      ok: true, sessionId: 'shared-session', agentId: 'arch-stable-id', role: 'arch-testing',
      actorInstanceId: 'issuer-actor-instance', worktreeId, planDigest: plan.planDigest, expiresAt,
    },
    target: {
      ok: true, sessionId: 'shared-session', agentId: 'planner-stable-id', role: 'planner',
      actorInstanceId: 'target-actor-instance', worktreeId, planDigest: plan.planDigest, expiresAt,
    },
  };
}

function resolverFrom(...values) {
  const byKey = new Map(values.map((value) => [`${value.sessionId}\0${value.agentId}`, value]));
  return (_root, identity) => byKey.get(`${identity.sessionId}\0${identity.agentId}`)
    || { ok: false, reason: 'fixture-actor-unavailable' };
}

function mintActorAction(root, role, sessionId, suffix) {
  const generation = rll.resolveSessionGeneration(root, {
    ok: true, provider: 'claude-hook', runtime_session_key: sessionId,
  });
  assert.strictEqual(generation.ok, true, JSON.stringify(generation));
  const plan = rll.discoverPlan(root);
  const actionId = rll.generateActionId();
  const minted = rll.mintRoleLifecycleAction(
    root, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(root),
    rll.computeWorktreeId(root), plan.planDigest,
    crypto.createHash('sha256').update(`d5:${suffix}`).digest('hex'),
    generation.generationId, role,
    rll.buildRoleSpawnPayload('d5-team', role, role, 'fixture', 'fixture'),
    new Date(Date.now() + 600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  assert.strictEqual(minted.ok, true, JSON.stringify(minted));
  return actionId;
}

function seedRealActor(root, sessionId, agentId, role) {
  const actionId = mintActorAction(root, role, sessionId, `${role}:${agentId}`);
  primeClaudeId01V2ActorProof({
    projectRoot: root, sessionId, agentId, agentType: role, actionId,
    prefix: `d5-${role}-${agentId}`,
  });
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const plan = rll.discoverPlan(root);
  const binding = rll.createRequesterBinding(
    root, identity, agentId, role, rll.computeWorktreeId(root), plan.planDigest, 600,
  );
  assert.strictEqual(binding.ok, true, JSON.stringify(binding));
  return binding.binding;
}

function hook(file, root, event, evidence) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (evidence) env.RUNTIME_TEST_CLAUDE_SESSION_EVIDENCE = evidence;
  return require('node:child_process').spawnSync(process.execPath, [file], {
    cwd: root, env, input: JSON.stringify(event), encoding: 'utf8',
  });
}

// Pre-fix RED reproduced independently before this implementation:
//   * canonical `to:planner` + observed `agent_type:planner-2` => denied;
//   * a flag for `planner-2` => an unrelated agent_id was allowed.
// These cases prove the replacement is stable-actor keyed instead.
{
  const root = makeProject();
  const { issuer, target } = actors(root);
  const resolveActor = resolverFrom(issuer, target);
  const recorded = auth.recordMediatedAuthorization(root, {
    session_id: issuer.sessionId,
    agent_id: issuer.agentId,
    agent_type: 'arch-testing-7',
    tool_input: { to: 'planner-2', message: 'handoff' },
    tool_response: { success: true, resumedAgentId: target.agentId },
  }, { resolveActor });
  assert.strictEqual(recorded.ok, true, JSON.stringify(recorded));

  const first = auth.activateOrReadAuthorization(root, {
    sessionId: target.sessionId, agentId: target.agentId,
  }, { resolveActor });
  assert.strictEqual(first.ok, true, JSON.stringify(first));
  assert.strictEqual(first.activated, true, 'first exact actor use atomically activates the pending authorization');
  assert.strictEqual(first.record.target_role, 'planner');
  assert.strictEqual(first.record.target_agent_id, target.agentId);
  assert.strictEqual(first.record.issuer_agent_id, issuer.agentId);

  const repeat = auth.activateOrReadAuthorization(root, {
    sessionId: target.sessionId, agentId: target.agentId,
  }, { resolveActor });
  assert.strictEqual(repeat.ok, true, JSON.stringify(repeat));
  assert.strictEqual(repeat.activated, false, 'replay reads the one immutable active authorization; it cannot activate twice');

  const duplicate = auth.recordMediatedAuthorization(root, {
    session_id: issuer.sessionId, agent_id: issuer.agentId,
    tool_input: { to: 'anything-at-all', message: 'duplicate' },
    tool_response: { success: true, resumedAgentId: target.agentId },
  }, { resolveActor });
  assert.deepStrictEqual(
    { ok: duplicate.ok, reused: duplicate.reused, active: duplicate.active },
    { ok: true, reused: true, active: true },
    'a replay cannot overwrite or remint the active authorization',
  );
  console.log('D5-A stable actor survives presentation suffix and activates once: PASS');
}

{
  const root = makeProject();
  const { issuer, target } = actors(root);
  const foreign = { ...target, agentId: 'foreign-planner-id', actorInstanceId: 'foreign-actor-instance' };
  const resolveActor = resolverFrom(issuer, target, foreign);
  assert.strictEqual(auth.publishResolvedAuthorization(root, issuer, target).ok, true);
  const denied = auth.activateOrReadAuthorization(root, {
    sessionId: foreign.sessionId, agentId: foreign.agentId,
  }, { resolveActor });
  assert.strictEqual(denied.ok, false, 'same role label under another agent_id must not inherit authorization');
  console.log('D5-B same-role foreign agent_id denied: PASS');
}

{
  const root = makeProject();
  const { issuer, target } = actors(root);
  const otherSession = { ...target, sessionId: 'foreign-session' };
  const resolveActor = resolverFrom(issuer, target, otherSession);
  assert.strictEqual(auth.publishResolvedAuthorization(root, issuer, target).ok, true);
  assert.strictEqual(auth.activateOrReadAuthorization(root, {
    sessionId: otherSession.sessionId, agentId: otherSession.agentId,
  }, { resolveActor }).ok, false, 'same agent_id in another session must not inherit authorization');
  console.log('D5-C foreign session denied: PASS');
}

{
  const root = makeProject();
  const { issuer, target } = actors(root);
  const resolveActor = resolverFrom(issuer, target);
  assert.strictEqual(auth.publishResolvedAuthorization(root, issuer, target).ok, true);
  fs.appendFileSync(path.join(root, '.planning', 'wave-d5-actor-auth', 'PLAN.md'), '\nchanged\n');
  const denied = auth.activateOrReadAuthorization(root, {
    sessionId: target.sessionId, agentId: target.agentId,
  }, { resolveActor });
  assert.strictEqual(denied.ok, false, 'PLAN digest drift must invalidate the handoff');
  console.log('D5-D PLAN drift denied: PASS');
}

{
  const root = makeProject();
  const { issuer, target } = actors(root);
  const resolveActor = resolverFrom(issuer, target);
  const published = auth.publishResolvedAuthorization(root, issuer, target);
  assert.strictEqual(published.ok, true);
  const pending = path.join(auth.authorizationDir(root), `${published.authorizationId}.pending.json`);
  fs.writeFileSync(pending, '{"schema":"tampered"}');
  const denied = auth.activateOrReadAuthorization(root, {
    sessionId: target.sessionId, agentId: target.agentId,
  }, { resolveActor });
  assert.strictEqual(denied.ok, false, 'malformed durable authorization must fail closed');
  console.log('D5-E malformed record denied: PASS');
}

{
  const root = makeProject();
  const { issuer, target } = actors(root);
  const unsupported = { ...target, role: 'arch-platform' };
  assert.strictEqual(auth.publishResolvedAuthorization(root, issuer, unsupported).ok, false);
  const noStableTarget = auth.recordMediatedAuthorization(root, {
    session_id: issuer.sessionId, agent_id: issuer.agentId,
    tool_input: { to: 'planner-2', message: 'handoff' },
    tool_response: { success: true },
  }, { resolveActor: resolverFrom(issuer, target) });
  assert.strictEqual(noStableTarget.ok, false, 'a SendMessage result without stable resumedAgentId cannot mint authority');
  console.log('D5-F unsupported role and unidentifiable target denied: PASS');
}

// Real-hook integration: genuine durable requester bindings are seeded for
// the architect, resumed planner, and a foreign actor. The PostToolUse hook
// resolves the two stable actors and the PreToolUse hook consumes the same
// authorization while the observed presentation role is numerically
// suffixed. No production resolver seam is used in this block.
{
  const root = makeProject();
  const sessionId = 'd5-real-hook-session';
  seedRealActor(root, sessionId, 'arch-real-id', 'arch-testing');
  seedRealActor(root, sessionId, 'planner-real-id', 'planner');
  seedRealActor(root, sessionId, 'foreign-real-id', 'test-specialist');
  const sessionEvidence = claudeId01V2SessionEvidenceFor(root, sessionId);
  assert.ok(sessionEvidence, 'real hook fixture must expose durable host/session evidence');
  const encodedEvidence = Buffer.from(JSON.stringify({
    projectRoot: root,
    repoId: rll.computeRepoId(root),
    sessionId,
    record: sessionEvidence.record,
  })).toString('base64url');

  const before = fs.existsSync(auth.authorizationDir(root))
    ? fs.readdirSync(auth.authorizationDir(root)).filter((name) => name.endsWith('.pending.json')).length
    : 0;
  const missing = hook(CONSULTED_HOOK, root, {
    hook_event_name: 'PostToolUse', tool_name: 'SendMessage',
    session_id: sessionId, agent_id: 'arch-real-id', agent_type: 'arch-testing',
    tool_input: { to: 'planner-2', message: 'not identifiable' },
    tool_response: { success: true },
  }, encodedEvidence);
  assert.strictEqual(missing.status, 0);
  const failed = hook(CONSULTED_HOOK, root, {
    hook_event_name: 'PostToolUse', tool_name: 'SendMessage',
    session_id: sessionId, agent_id: 'arch-real-id', agent_type: 'arch-testing',
    tool_input: { to: 'planner-2', message: 'failed delivery' },
    tool_response: { success: false, resumedAgentId: 'planner-real-id' },
  }, encodedEvidence);
  assert.strictEqual(failed.status, 0);
  const afterRejected = fs.existsSync(auth.authorizationDir(root))
    ? fs.readdirSync(auth.authorizationDir(root)).filter((name) => name.endsWith('.pending.json')).length
    : 0;
  assert.strictEqual(afterRejected, before, 'missing/false resumed actor outcome must mint nothing');

  const consulted = hook(CONSULTED_HOOK, root, {
    hook_event_name: 'PostToolUse', tool_name: 'SendMessage',
    session_id: sessionId, agent_id: 'arch-real-id', agent_type: 'arch-testing-9',
    tool_input: { to: 'planner-2', message: 'stable handoff' },
    tool_response: { success: true, resumedAgentId: 'planner-real-id' },
  }, encodedEvidence);
  assert.strictEqual(consulted.status, 0, consulted.stderr);

  const planner = hook(GATE_HOOK, root, {
    hook_event_name: 'PreToolUse', tool_name: 'Grep',
    session_id: sessionId, agent_id: 'planner-real-id', agent_type: 'opaque-host-label',
    tool_input: { pattern: 'contract', path: 'docs' },
  }, encodedEvidence);
  assert.strictEqual(planner.stdout, '', `stable planner actor must be allowed: ${planner.stdout} ${planner.stderr}`);
  assert.match(planner.stderr, /authorization_id=/, 'real gate must audit the durable actor authorization');

  const foreign = hook(GATE_HOOK, root, {
    hook_event_name: 'PreToolUse', tool_name: 'Grep',
    session_id: sessionId, agent_id: 'foreign-real-id', agent_type: 'opaque-host-label',
    tool_input: { pattern: 'contract', path: 'docs' },
  }, encodedEvidence);
  assert.match(foreign.stdout, /"permissionDecision":"deny"/, 'a seeded foreign actor cannot inherit planner authorization');
  console.log('D5-G real consulted/gate hooks: opaque presentation label allowed by stable actor; missing/false outcome and foreign actor denied: PASS');
}

console.log('context-provider actor authorization: PASS');
