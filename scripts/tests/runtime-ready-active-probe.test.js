'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { execFile, execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const TEST_CAPABILITY = 'ready-active-probe-black-box';
const FAKE_CAPABILITIES = JSON.stringify(['claude-sendmessage']);
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = TEST_CAPABILITY;

const RLL_IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const HOST_BOUNDARY = path.resolve(__dirname, '../../.claude/hooks/runtime-host-boundary.js');
const rll = require(RLL_IMPL);
const rc = require('../lib/runtime-consultation.cjs');
const runtimeHostBoundary = require(HOST_BOUNDARY);

const ROLES = [
  'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
];

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-ready-active-probe-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'active-probe@test.local']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Active Probe Test']);
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init']);

  const libDir = path.join(root, 'scripts', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const policy = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8',
  ));
  policy.schema = 'runtime-collaboration-policy/v1';
  policy.version = 1;
  delete policy.selection;
  delete policy.claude_native_startup_timeout_seconds;
  fs.writeFileSync(
    path.join(libDir, 'runtime-collaboration-policy.json'),
    JSON.stringify(policy, null, 2) + '\n',
  );
  fs.copyFileSync(
    path.resolve(__dirname, '../lib/runtime-routing.json'),
    path.join(libDir, 'runtime-routing.json'),
  );
  const waveDir = path.join(root, '.planning', 'wave-active-probe');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# active liveness probe fixture\n');
  return root;
}

function cleanup(root) {
  fs.rmSync(rll.registryRepoDir(root), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

function identityFor(sessionId) {
  return { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
}

function childEnv() {
  return Object.assign({}, process.env, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: TEST_CAPABILITY,
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: FAKE_CAPABILITIES,
  });
}

function runEnsure(root, sessionId) {
  const invocation = mintEnsureInvocation(root, sessionId);
  const child = spawnSync(process.execPath, invocation.args, {
    encoding: 'utf8', env: childEnv(),
  });
  return parseEnsureResult(child.status, child.stdout, child.stderr);
}

function mintEnsureInvocation(root, sessionId) {
  const plan = rll.discoverPlan(root);
  assert.strictEqual(plan.ok, true, JSON.stringify(plan));
  const main = rll.createMainOrchestratorBinding(
    root, identityFor(sessionId), rll.computeWorktreeId(root), plan.planDigest, 120,
  );
  assert.strictEqual(main.ok, true, JSON.stringify(main));
  const argvDigest = rc.sha256String('ensure:' + ROLES.slice().sort().join(','));
  const grant = rll.mintLifecycleCommandGrant(
    root, main.binding, argvDigest, ROLES, 'ensure',
    'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(grant.ok, true, JSON.stringify(grant));
  const args = [RLL_IMPL, 'ensure', '--project-root', root];
  for (const role of ROLES) args.push('--role', role);
  args.push('--lifecycle-binding', grant.grantId);
  return { args };
}

function parseEnsureResult(exitCode, stdout, stderr) {
  const lines = String(stdout || '').trim().split('\n');
  const envelope = JSON.parse(lines[lines.length - 1]);
  return { exitCode, envelope, stderr: stderr || '' };
}

function runEnsureAsync(root, sessionId) {
  const invocation = mintEnsureInvocation(root, sessionId);
  return new Promise((resolve) => {
    execFile(process.execPath, invocation.args, { encoding: 'utf8', env: childEnv() },
      (error, stdout, stderr) => resolve(parseEnsureResult(error ? error.code : 0, stdout, stderr)));
  });
}

function writeStartupObservation(root, sessionId, action, actorBinding, agentId) {
  rll.recordClaudeId01SubagentStartObservation(root, {
    sessionId, agentId, agentType: action.role, actionId: action.action_id,
  });
  const now = new Date();
  const startup = {
    schema: 'runtime/claude-startup-actor/v1',
    session_digest: sha(sessionId),
    agent_digest: sha(agentId),
    role: action.role,
    action_id: action.action_id,
    action_digest: sha(rc.canonicalJSONStringify(action)),
    claim_digest: '4'.repeat(64),
    actor_binding_id: actorBinding.binding.binding_id,
    worktree_id: action.worktree_id,
    plan_digest: action.plan_digest,
    session_generation_digest: sha(action.session_generation_id),
    host_contract_digest: '5'.repeat(64),
    created_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    expiry: new Date(now.getTime() + 300000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const startupKey = sha(
    'claude-startup-v2:' + action.session_generation_id + ':' + sha(agentId),
  );
  const startupPath = path.join(
    rll.registryRepoDir(root), 'claude-id01-traces', 'startup-v2-' + startupKey + '.json',
  );
  assert.strictEqual(rll.writeRegistryRecordReplace(
    startupPath, Buffer.from(rc.canonicalJSONStringify(startup), 'utf8'),
  ).ok, true);
}

function seedFiveReadyActors(root, sessionId) {
  const initial = runEnsure(root, sessionId);
  assert.strictEqual(initial.exitCode, 0, JSON.stringify(initial));
  assert.strictEqual(initial.envelope.status, 'ACTION_REQUIRED', JSON.stringify(initial.envelope));
  assert.strictEqual(initial.envelope.actions.length, ROLES.length, JSON.stringify(initial.envelope.actions));
  assert.ok(initial.envelope.actions.every((action) =>
    action.kind === 'role-spawn' && action.operation === 'Agent'));

  const actors = new Map();
  for (const action of initial.envelope.actions) {
    const actorBinding = rll.createRoleActorBinding(
      root, action.role, action.worktree_id, action.plan_digest,
      action.session_generation_id, 600,
    );
    assert.strictEqual(actorBinding.ok, true, JSON.stringify(actorBinding));
    const profileDigest = rll.roleProfileDigestFor(action.role);
    const before = rll.readRoleBindingState(
      root, action.worktree_id, action.plan_digest, profileDigest,
      action.session_generation_id, action.role,
    );
    const ready = rll.transitionRoleBinding(
      root, action.worktree_id, action.plan_digest, profileDigest,
      action.session_generation_id, action.role, before.state, 'READY', before.record, {},
    );
    assert.strictEqual(ready.ok, true, JSON.stringify(ready));
    const agentId = 'active-probe-' + action.role + '-' + action.session_generation_id;
    writeStartupObservation(root, sessionId, action, actorBinding, agentId);
    actors.set(action.role, {
      action, actorBinding, agentId, agentDigest: sha(agentId),
    });
  }
  return {
    actors,
    generationId: initial.envelope.actions[0].session_generation_id,
  };
}

function expectFiveProbeActions(result, actors) {
  assert.strictEqual(result.exitCode, 0, JSON.stringify(result));
  assert.strictEqual(result.envelope.status, 'ACTION_REQUIRED', JSON.stringify(result.envelope));
  assert.strictEqual(result.envelope.actions.length, ROLES.length, JSON.stringify(result.envelope.actions));
  for (const action of result.envelope.actions) {
    const actor = actors.get(action.role);
    assert.ok(actor, 'unknown active-probe role ' + action.role);
    assert.strictEqual(action.kind, 'role-notify');
    assert.strictEqual(action.runtime, 'claude-native');
    assert.strictEqual(action.operation, 'SendMessage');
    assert.strictEqual(action.payload.artifact_kind, 'session-control');
    assert.strictEqual(
      action.payload.artifact_ref,
      'liveness:' + actor.actorBinding.binding.binding_id + ':' + actor.agentDigest,
    );
    assert.strictEqual(action.payload.message, [
      'RUNTIME_LIVENESS_PROBE/v1',
      'actor-binding:' + actor.actorBinding.binding.binding_id,
      'actor-digest:' + actor.agentDigest,
      'runtime-action:' + action.action_id,
      'expected-response:resumed-agent-id',
      'actor-action:none',
      'reply:none',
      'next:wait',
    ].join('\n'));
  }
  return result.envelope.actions;
}

function runBoundary(event) {
  if (event.hook_event_name === 'PreToolUse') {
    const admitted = runtimeHostBoundary.admitNativeActionEvent(event);
    assert.strictEqual(admitted.admitted, true, JSON.stringify(admitted));
    assert.strictEqual(admitted.owning, true, JSON.stringify(admitted));
    assert.strictEqual(admitted.reserved, true, JSON.stringify(admitted));
    return admitted;
  }
  const settled = runtimeHostBoundary.settleNativeLivenessProbe(event);
  assert.strictEqual(settled.ok, true, JSON.stringify(settled));
  return settled;
}

function preEvent(root, sessionId, action, toolUseId) {
  return {
    hook_event_name: 'PreToolUse', tool_name: 'SendMessage', cwd: root,
    session_id: sessionId, tool_use_id: toolUseId,
    tool_input: {
      recipient: action.payload.teammate_name,
      message: action.payload.message,
    },
  };
}

function deliverProbe(root, sessionId, action, toolUseId, outcome) {
  const pre = preEvent(root, sessionId, action, toolUseId);
  runBoundary(pre);
  if (outcome.kind === 'no-post') return;
  const post = Object.assign({}, pre, {
    hook_event_name: outcome.kind === 'failure' ? 'PostToolUseFailure' : 'PostToolUse',
  });
  if (outcome.kind === 'failure') post.error = 'simulated host delivery failure';
  else {
    post.tool_response = outcome.toolResponse || { success: outcome.responseSuccess !== false };
    if (outcome.resumedAgentId !== undefined) {
      post.tool_response.resumedAgentId = outcome.resumedAgentId;
    }
    if (outcome.responseMessage !== undefined) {
      post.tool_response.message = outcome.responseMessage;
    }
  }
  runBoundary(post);
}

test('active probe accepts the closed pin and inbox receipts emitted by supported Claude 2.1 patch releases', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-compatible-receipts';
  const seeded = seedFiveReadyActors(root, sessionId);
  const actions = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  const pinned = actions[0];
  deliverProbe(root, sessionId, pinned, 'probe-compatible-pin', {
    kind: 'success',
    toolResponse: {
      success: true, message: 'Agent resumed',
      pin: { id: seeded.actors.get(pinned.role).agentId, name: pinned.role, ref: 'agent-ref' },
    },
  });
  const inbox = actions[1];
  deliverProbe(root, sessionId, inbox, 'probe-compatible-inbox', {
    kind: 'success',
    toolResponse: {
      success: true, message: `Message sent to ${inbox.role}'s inbox`, msg_id: 'message-id',
      routing: { content: 'probe', sender: 'team-lead', summary: 'probe', target: '@' + inbox.role, targetColor: 'blue' },
    },
  });
  for (let index = 2; index < actions.length; index += 1) {
    settleExactProbe(root, sessionId, seeded, actions[index], 'probe-compatible-legacy-' + index);
  }
  const complete = runEnsure(root, sessionId);
  assert.strictEqual(complete.exitCode, 0, JSON.stringify(complete));
  assert.strictEqual(complete.envelope.status, 'READY', JSON.stringify(complete.envelope));
  assert.deepStrictEqual(complete.envelope.actions, []);
});

test('active probe accepts Claude 2.1.285 combined resume receipt and PostToolUse to-alias', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-combined-receipt';
  const seeded = seedFiveReadyActors(root, sessionId);
  const actions = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  const combined = actions[0];
  const pre = preEvent(root, sessionId, combined, 'probe-combined-receipt');
  runBoundary(pre);
  const agentId = seeded.actors.get(combined.role).agentId;
  const settled = runtimeHostBoundary.settleNativeLivenessProbe(Object.assign({}, pre, {
    hook_event_name: 'PostToolUse',
    tool_input: { to: combined.role, message: combined.payload.message },
    tool_response: {
      success: true,
      message: `Resuming agent ${combined.role}`,
      resumedAgentId: agentId,
      pin: { id: agentId, name: combined.role, ref: 'agent-ref' },
    },
  }));
  assert.strictEqual(settled.ok, true, JSON.stringify(settled));
  assert.strictEqual(settled.status, 'LIVE', JSON.stringify(settled));
  for (let index = 1; index < actions.length; index += 1) {
    settleExactProbe(root, sessionId, seeded, actions[index], 'probe-combined-legacy-' + index);
  }
  assert.strictEqual(runEnsure(root, sessionId).envelope.status, 'READY');
});

function roleState(root, seeded, role) {
  const actor = seeded.actors.get(role);
  return rll.readRoleBindingState(
    root, actor.action.worktree_id, actor.action.plan_digest,
    rll.roleProfileDigestFor(role), actor.action.session_generation_id, role,
  );
}

function probeRecordPath(root, actionId, suffix) {
  return path.join(rll.registryRepoDir(root), 'claude-liveness-probes', actionId + suffix);
}

function storedActions(root) {
  const dir = path.join(rll.registryRepoDir(root), 'actions');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')));
}

function settleExactProbe(root, sessionId, seeded, action, toolUseId) {
  deliverProbe(root, sessionId, action, toolUseId, {
    kind: 'success', resumedAgentId: seeded.actors.get(action.role).agentId,
  });
}

function unreachableMessage(recipient) {
  return `No agent named '${recipient}' is reachable.\nUse ListAgents to see everyone you can message.`;
}

test('active probe success matrix: agents_killed inside startup TTL requires 5 probes, 4/5 is not READY, 5/5 exact Post is READY and next init is zero-action', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-five-of-five';
  const seeded = seedFiveReadyActors(root, sessionId);

  // Models Claude's `agents_killed` result: all five host actors disappeared,
  // no SubagentStop was delivered, and their startup traces are still inside
  // the historical five-minute TTL. Historical startup alone must not be READY.
  const probes = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  for (let index = 0; index < probes.length - 1; index += 1) {
    const action = probes[index];
    deliverProbe(root, sessionId, action, 'probe-success-' + index, {
      kind: 'success', resumedAgentId: seeded.actors.get(action.role).agentId,
    });
  }

  const partial = runEnsure(root, sessionId);
  assert.notStrictEqual(partial.envelope.status, 'READY', JSON.stringify(partial.envelope));
  assert.strictEqual(partial.envelope.actions.length, 1, JSON.stringify(partial.envelope.actions));
  const finalAction = partial.envelope.actions[0];
  deliverProbe(root, sessionId, finalAction, 'probe-success-final', {
    kind: 'success', resumedAgentId: seeded.actors.get(finalAction.role).agentId,
  });

  const complete = runEnsure(root, sessionId);
  assert.strictEqual(complete.exitCode, 0, JSON.stringify(complete));
  assert.strictEqual(complete.envelope.status, 'READY', JSON.stringify(complete.envelope));
  assert.deepStrictEqual(complete.envelope.actions, []);
  const nextInit = runEnsure(root, sessionId);
  assert.strictEqual(nextInit.exitCode, 0, JSON.stringify(nextInit));
  assert.strictEqual(nextInit.envelope.status, 'READY', JSON.stringify(nextInit.envelope));
  assert.deepStrictEqual(nextInit.envelope.actions, []);
});

for (const scenario of [
  { name: 'wrong resumedAgentId', kind: 'success' },
  { name: 'missing PostToolUse', kind: 'no-post' },
  { name: 'PostToolUseFailure', kind: 'failure' },
]) {
  test('active probe negative matrix: ' + scenario.name + ' is not READY and does not duplicate Agent in one generation', (t) => {
    const root = makeProject();
    t.after(() => cleanup(root));
    const sessionId = 'active-probe-negative-' + scenario.kind;
    const seeded = seedFiveReadyActors(root, sessionId);
    const probes = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
    const target = probes[0];
    deliverProbe(root, sessionId, target, 'probe-negative-' + scenario.kind, {
      kind: scenario.kind,
      resumedAgentId: scenario.kind === 'success' ? 'wrong-agent-id' : undefined,
    });

    const first = runEnsure(root, sessionId);
    assert.notStrictEqual(first.envelope.status, 'READY', JSON.stringify(first.envelope));
    assert.strictEqual(roleState(root, seeded, target.role).state, 'READY',
      'an inconclusive/missing host ACK is not evidence that the actor is DEAD');
    const firstReplacementIds = first.envelope.actions
      .filter((action) => action.operation === 'Agent' && action.role === target.role)
      .map((action) => action.action_id);
    assert.ok(firstReplacementIds.length <= 1, JSON.stringify(first.envelope.actions));

    const second = runEnsure(root, sessionId);
    assert.notStrictEqual(second.envelope.status, 'READY', JSON.stringify(second.envelope));
    const secondReplacementIds = second.envelope.actions
      .filter((action) => action.operation === 'Agent' && action.role === target.role)
      .map((action) => action.action_id);
    assert.deepStrictEqual(secondReplacementIds, firstReplacementIds,
      'a repeated ensure must re-report, never mint a duplicate same-generation Agent');

    const replacements = storedActions(root).filter((action) =>
      action.kind === 'role-spawn' && action.role === target.role &&
      action.session_generation_id === seeded.generationId &&
      action.action_id !== seeded.actors.get(target.role).action.action_id);
    assert.ok(replacements.length <= 1,
      'at most one replacement Agent may exist for a role in the same generation');
  });
}

test('active probe idempotency and correlation: duplicate exact Pre is accepted, changed recipient and cross-session Post are rejected', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-correlation';
  const seeded = seedFiveReadyActors(root, sessionId);
  const action = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors)[0];
  const pre = preEvent(root, sessionId, action, 'probe-idempotent-pre');
  const first = runBoundary(pre);
  const replay = runBoundary(pre);
  assert.strictEqual(first.reserved, true);
  assert.strictEqual(replay.reserved, true);

  const changedRecipient = preEvent(root, sessionId, action, 'probe-wrong-recipient');
  changedRecipient.tool_input.recipient = ROLES.find((role) => role !== action.role);
  const rejectedRecipient = runtimeHostBoundary.admitNativeActionEvent(changedRecipient);
  assert.strictEqual(rejectedRecipient.admitted, false, JSON.stringify(rejectedRecipient));
  assert.strictEqual(rejectedRecipient.owning, true, JSON.stringify(rejectedRecipient));

  const crossSession = Object.assign({}, pre, {
    hook_event_name: 'PostToolUse',
    session_id: sessionId + '-other',
    tool_response: {
      success: true,
      resumedAgentId: seeded.actors.get(action.role).agentId,
    },
  });
  const rejectedPost = runtimeHostBoundary.settleNativeLivenessProbe(crossSession);
  assert.strictEqual(rejectedPost.ok, false, JSON.stringify(rejectedPost));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'READY');
  const exactPost = Object.assign({}, pre, {
    hook_event_name: 'PostToolUse',
    tool_response: {
      success: true,
      resumedAgentId: seeded.actors.get(action.role).agentId,
    },
  });
  const settled = runtimeHostBoundary.settleNativeLivenessProbe(exactPost);
  const settledReplay = runtimeHostBoundary.settleNativeLivenessProbe(exactPost);
  assert.strictEqual(settled.ok, true, JSON.stringify(settled));
  assert.strictEqual(settledReplay.ok, true, JSON.stringify(settledReplay));
  assert.strictEqual(settledReplay.idempotent, true, JSON.stringify(settledReplay));
  assert.notStrictEqual(runEnsure(root, sessionId).envelope.status, 'READY',
    'one exact success cannot hide the other four unverified actors');
});

test('active probe unsupported ACK: response success=false or missing resumedAgentId remains UNVERIFIED and READY', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-unsupported-ack';
  const seeded = seedFiveReadyActors(root, sessionId);
  const actions = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  const falseSuccess = actions[0];
  const missingId = actions[1];
  deliverProbe(root, sessionId, falseSuccess, 'probe-response-false', {
    kind: 'success', responseSuccess: false,
    resumedAgentId: seeded.actors.get(falseSuccess.role).agentId,
  });
  deliverProbe(root, sessionId, missingId, 'probe-response-missing-id', {
    kind: 'success', responseSuccess: true,
  });
  assert.strictEqual(roleState(root, seeded, falseSuccess.role).state, 'READY');
  assert.strictEqual(roleState(root, seeded, missingId.role).state, 'READY');
  const next = runEnsure(root, sessionId);
  assert.notStrictEqual(next.envelope.status, 'READY', JSON.stringify(next.envelope));
  assert.strictEqual(next.envelope.actions.some((action) => action.operation === 'Agent'), false,
    'unsupported ACK shapes must re-probe, never respawn a possibly executing actor');
});

test('active probe stop race: settlement after READY becomes WAITING preserves the resume handle and WAITING state', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-waiting-race';
  const seeded = seedFiveReadyActors(root, sessionId);
  const action = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors)[0];
  const actor = seeded.actors.get(action.role);
  const pre = preEvent(root, sessionId, action, 'probe-waiting-race');
  runBoundary(pre);
  const parked = rll.parkClaudeResumeHandleForRoleActor(root, {
    sessionId, agentId: actor.agentId, agentType: action.role,
  });
  assert.strictEqual(parked.ok, true, JSON.stringify(parked));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'WAITING');
  const post = Object.assign({}, pre, {
    hook_event_name: 'PostToolUse',
    tool_response: { success: true },
  });
  const settled = runtimeHostBoundary.settleNativeLivenessProbe(post);
  assert.strictEqual(settled.ok, true, JSON.stringify(settled));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'WAITING');
  const next = runEnsure(root, sessionId);
  assert.strictEqual(next.envelope.actions.some((candidate) =>
    candidate.operation === 'Agent' && candidate.role === action.role), false,
  'a WAITING actor with a valid handle must never be replaced by this race');
});

test('active probe expiry: expired LIVE outcome is UNVERIFIED and a settled action cannot stay selected forever', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-expired-positive';
  const seeded = seedFiveReadyActors(root, sessionId);
  const action = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors)[0];
  deliverProbe(root, sessionId, action, 'probe-expired-live', {
    kind: 'success', resumedAgentId: seeded.actors.get(action.role).agentId,
  });
  const outcomePath = probeRecordPath(root, action.action_id, '.outcome.json');
  const outcome = JSON.parse(fs.readFileSync(outcomePath, 'utf8'));
  outcome.observed_at = '1999-12-31T23:59:00Z';
  outcome.expires_at = '2000-01-01T00:00:00Z';
  fs.writeFileSync(outcomePath, rc.canonicalJSONStringify(outcome));

  const next = runEnsure(root, sessionId);
  assert.notStrictEqual(next.envelope.status, 'READY', JSON.stringify(next.envelope));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'READY');
  const replacement = next.envelope.actions.find((candidate) => candidate.role === action.role);
  assert.ok(replacement, JSON.stringify(next.envelope.actions));
  assert.strictEqual(replacement.operation, 'SendMessage');
  assert.notStrictEqual(replacement.action_id, action.action_id,
    'an expired settled action must be retired so a fresh probe can be selected');
});

test('active probe durable record validation rejects wrong schema and wrong scope without killing READY', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-record-validation';
  const seeded = seedFiveReadyActors(root, sessionId);
  const actions = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  for (const [index, mutation] of [
    ['wrong-schema', (record) => { record.schema = 'runtime/claude-liveness-probe/v999'; }],
    ['wrong-scope', (record) => { record.session_generation_id = 'f'.repeat(32); }],
  ].entries()) {
    const action = actions[index];
    const pre = preEvent(root, sessionId, action, 'probe-record-' + mutation[0]);
    runBoundary(pre);
    const pendingPath = probeRecordPath(root, action.action_id, '.pending.json');
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    mutation[1](pending);
    fs.writeFileSync(pendingPath, rc.canonicalJSONStringify(pending));
    const post = Object.assign({}, pre, {
      hook_event_name: 'PostToolUse',
      tool_response: {
        success: true,
        resumedAgentId: seeded.actors.get(action.role).agentId,
      },
    });
    const rejected = runtimeHostBoundary.settleNativeLivenessProbe(post);
    assert.strictEqual(rejected.ok, false, mutation[0] + ': ' + JSON.stringify(rejected));
    assert.strictEqual(roleState(root, seeded, action.role).state, 'READY');
  }
  assert.notStrictEqual(runEnsure(root, sessionId).envelope.status, 'READY');
});

test('active probe action discovery ignores unrelated global action accumulation through its scope index', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-scan-cap';
  const seeded = seedFiveReadyActors(root, sessionId);
  const probes = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  const actionsDir = path.join(rll.registryRepoDir(root), 'actions');
  const currentCount = fs.readdirSync(actionsDir).length;
  for (let index = currentCount; index <= 1024; index += 1) {
    fs.writeFileSync(path.join(actionsDir, 'decoy-' + String(index).padStart(4, '0') + '.json'), '{}');
  }
  const bounded = runEnsure(root, sessionId);
  assert.strictEqual(bounded.envelope.status, 'ACTION_REQUIRED', JSON.stringify(bounded.envelope));
  assert.deepStrictEqual(
    bounded.envelope.actions.map((action) => action.action_id).sort(),
    probes.map((action) => action.action_id).sort(),
    'the per-scope index must re-report the exact probes without scanning unrelated actions',
  );
  for (const role of ROLES) assert.strictEqual(roleState(root, seeded, role).state, 'READY');
});

test('active probe foreign-session isolation: both Pre and Post from session B are rejected for session A action', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const ownerSession = 'active-probe-owner-session-a';
  const foreignSession = 'active-probe-foreign-session-b';
  const seeded = seedFiveReadyActors(root, ownerSession);
  const action = expectFiveProbeActions(runEnsure(root, ownerSession), seeded.actors)[0];
  const foreignPre = preEvent(root, foreignSession, action, 'probe-foreign-session');
  const preResult = runtimeHostBoundary.admitNativeActionEvent(foreignPre);
  assert.strictEqual(preResult.admitted, false, JSON.stringify(preResult));
  assert.strictEqual(preResult.owning, true, JSON.stringify(preResult));
  assert.strictEqual(fs.existsSync(probeRecordPath(root, action.action_id, '.pending.json')), false);

  const foreignPost = Object.assign({}, foreignPre, {
    hook_event_name: 'PostToolUse',
    tool_response: {
      success: true,
      resumedAgentId: seeded.actors.get(action.role).agentId,
    },
  });
  const postResult = runtimeHostBoundary.settleNativeLivenessProbe(foreignPost);
  assert.strictEqual(postResult.ok, false, JSON.stringify(postResult));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'READY');
});

test('active probe temporal boundary: Pre before action expiry and Post after expiry cannot become LIVE', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-late-post';
  const seeded = seedFiveReadyActors(root, sessionId);
  const action = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors)[0];
  const pre = preEvent(root, sessionId, action, 'probe-late-post');
  runBoundary(pre);

  const actionPath = rll.actionPathFor(root, action.action_id);
  const expiredAction = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
  expiredAction.expires_at = '2000-01-01T00:00:00Z';
  fs.writeFileSync(actionPath, rc.canonicalJSONStringify(expiredAction));
  const latePost = Object.assign({}, pre, {
    hook_event_name: 'PostToolUse',
    tool_response: {
      success: true,
      resumedAgentId: seeded.actors.get(action.role).agentId,
    },
  });
  const settled = runtimeHostBoundary.settleNativeLivenessProbe(latePost);
  assert.ok(settled.ok === false || settled.status !== 'LIVE', JSON.stringify(settled));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'READY');
  assert.strictEqual(fs.existsSync(probeRecordPath(root, action.action_id, '.outcome.json')), false,
    'an expired action must not publish a reusable positive outcome');
});

for (const chronology of [
  {
    name: 'far-future expiry',
    mutate(outcome) { outcome.expires_at = '2099-01-01T00:00:00Z'; },
  },
  {
    name: 'observed_at after expires_at',
    mutate(outcome) {
      outcome.observed_at = '2099-01-01T00:00:01Z';
      outcome.expires_at = '2099-01-01T00:00:00Z';
    },
  },
]) {
  test('active probe outcome chronology: ' + chronology.name + ' is rejected instead of extending LIVE', (t) => {
    const root = makeProject();
    t.after(() => cleanup(root));
    const sessionId = 'active-probe-chronology-' + chronology.name.replace(/[^a-z]+/g, '-');
    const seeded = seedFiveReadyActors(root, sessionId);
    const action = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors)[0];
    settleExactProbe(root, sessionId, seeded, action, 'probe-chronology');
    const outcomePath = probeRecordPath(root, action.action_id, '.outcome.json');
    const outcome = JSON.parse(fs.readFileSync(outcomePath, 'utf8'));
    chronology.mutate(outcome);
    fs.writeFileSync(outcomePath, rc.canonicalJSONStringify(outcome));

    const result = runEnsure(root, sessionId);
    assert.notStrictEqual(result.envelope.status, 'READY', JSON.stringify(result.envelope));
    assert.strictEqual(roleState(root, seeded, action.role).state, 'READY');
  });
}

test('active probe concurrency: two real concurrent ensure calls mint at most one probe per generation role and actor', async (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-concurrent-ensure';
  const seeded = seedFiveReadyActors(root, sessionId);
  const [left, right] = await Promise.all([
    runEnsureAsync(root, sessionId),
    runEnsureAsync(root, sessionId),
  ]);
  for (const result of [left, right]) {
    assert.strictEqual(result.exitCode, 0, JSON.stringify(result));
    assert.strictEqual(result.envelope.status, 'ACTION_REQUIRED', JSON.stringify(result.envelope));
  }
  const durableProbes = storedActions(root).filter((action) =>
    action.kind === 'role-notify' && action.operation === undefined && action.payload &&
    typeof action.payload.message === 'string' &&
    action.payload.message.startsWith('RUNTIME_LIVENESS_PROBE/v1\n') &&
    action.session_generation_id === seeded.generationId);
  assert.strictEqual(durableProbes.length, ROLES.length, JSON.stringify(durableProbes));
  for (const role of ROLES) {
    assert.strictEqual(durableProbes.filter((action) => action.role === role).length, 1,
      'concurrent ensure minted duplicate probe for ' + role);
  }
});

test('active probe input validation: empty sessionId toolUseId and recipient are rejected before reservation', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-empty-inputs';
  const seeded = seedFiveReadyActors(root, sessionId);
  const actions = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  const mutations = [
    ['sessionId', (event) => { event.session_id = ''; }],
    ['toolUseId', (event) => { event.tool_use_id = ''; }],
    ['recipient', (event) => { event.tool_input.recipient = ''; }],
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    const [label, mutate] = mutations[index];
    const action = actions[index];
    const event = preEvent(root, sessionId, action, 'probe-empty-' + label);
    mutate(event);
    const result = runtimeHostBoundary.admitNativeActionEvent(event);
    assert.strictEqual(result.admitted, false, label + ': ' + JSON.stringify(result));
    assert.strictEqual(result.owning, true, label + ': ' + JSON.stringify(result));
    assert.strictEqual(fs.existsSync(probeRecordPath(root, action.action_id, '.pending.json')), false);
  }
});

test('active probe action discovery rejects a malformed action referenced by the scope index', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-malformed-action';
  const seeded = seedFiveReadyActors(root, sessionId);
  const probes = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  for (let index = 0; index < probes.length; index += 1) {
    settleExactProbe(root, sessionId, seeded, probes[index], 'probe-malformed-control-' + index);
  }
  assert.strictEqual(runEnsure(root, sessionId).envelope.status, 'READY');

  fs.writeFileSync(rll.actionPathFor(root, probes[0].action_id), '{}');
  const rejected = runEnsure(root, sessionId);
  assert.notStrictEqual(rejected.envelope.status, 'READY', JSON.stringify(rejected.envelope));
  for (const role of ROLES) assert.strictEqual(roleState(root, seeded, role).state, 'READY');
});

test('active probe physical absence: exact unreachable Post retires unchanged READY once and stale replay cannot kill its replacement', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-exact-unreachable';
  const seeded = seedFiveReadyActors(root, sessionId);
  const action = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors)[0];
  const pre = preEvent(root, sessionId, action, 'probe-exact-unreachable');
  runBoundary(pre);
  const absentPost = Object.assign({}, pre, {
    hook_event_name: 'PostToolUse',
    tool_response: {
      success: false,
      message: unreachableMessage(action.payload.teammate_name),
    },
  });
  const absent = runtimeHostBoundary.settleNativeLivenessProbe(absentPost);
  assert.strictEqual(absent.ok, true, JSON.stringify(absent));
  assert.strictEqual(absent.status, 'ABSENT', JSON.stringify(absent));
  assert.strictEqual(roleState(root, seeded, action.role).state, 'DEAD');

  const replacement = runEnsure(root, sessionId);
  assert.notStrictEqual(replacement.envelope.status, 'READY');
  const targetAgents = replacement.envelope.actions.filter((candidate) =>
    candidate.operation === 'Agent' && candidate.role === action.role);
  assert.strictEqual(targetAgents.length, 1, JSON.stringify(replacement.envelope.actions));
  assert.strictEqual(replacement.envelope.actions.filter((candidate) =>
    candidate.operation === 'Agent' && candidate.role !== action.role).length, 0,
  'one exact absence must replace only its own role');
  assert.notStrictEqual(roleState(root, seeded, action.role).state, 'DEAD');

  const replay = runtimeHostBoundary.settleNativeLivenessProbe(absentPost);
  assert.strictEqual(replay.ok, false, JSON.stringify(replay));
  assert.notStrictEqual(roleState(root, seeded, action.role).state, 'DEAD',
    'a stale terminal replay must never kill the replacement state');
  const durableReplacements = storedActions(root).filter((candidate) =>
    candidate.kind === 'role-spawn' && candidate.role === action.role &&
    candidate.action_id !== seeded.actors.get(action.role).action.action_id);
  assert.strictEqual(durableReplacements.length, 1, JSON.stringify(durableReplacements));
  assert.strictEqual(durableReplacements[0].action_id, targetAgents[0].action_id,
    'a stale replay must preserve the existing replacement and never mint a duplicate');
});

test('active probe physical absence negatives: message drift remains UNVERIFIED and never respawns READY actors', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-unreachable-negatives';
  const seeded = seedFiveReadyActors(root, sessionId);
  const actions = expectFiveProbeActions(runEnsure(root, sessionId), seeded.actors);
  const variants = [
    {
      label: 'wrong recipient text',
      message(action) {
        const other = ROLES.find((role) => role !== action.payload.teammate_name);
        return unreachableMessage(other);
      },
    },
    {
      label: 'suffix/newline drift',
      message(action) { return unreachableMessage(action.payload.teammate_name) + '\n'; },
    },
    {
      label: 'missing message',
      message() { return undefined; },
    },
    {
      label: 'different failure message',
      message() { return 'Recipient is temporarily unavailable.'; },
    },
  ];
  for (let index = 0; index < variants.length; index += 1) {
    const action = actions[index];
    deliverProbe(root, sessionId, action, 'probe-unreachable-negative-' + index, {
      kind: 'success', responseSuccess: false,
      responseMessage: variants[index].message(action),
    });
    assert.strictEqual(roleState(root, seeded, action.role).state, 'READY', variants[index].label);
  }
  const next = runEnsure(root, sessionId);
  assert.notStrictEqual(next.envelope.status, 'READY');
  for (let index = 0; index < variants.length; index += 1) {
    const role = actions[index].role;
    assert.strictEqual(next.envelope.actions.some((candidate) =>
      candidate.operation === 'Agent' && candidate.role === role), false,
    variants[index].label + ' must not create an Agent replacement');
  }
});

test('active probe generation isolation: a new generation still emits exactly five Agent actions', (t) => {
  const root = makeProject();
  t.after(() => cleanup(root));
  const sessionId = 'active-probe-new-generation';
  const seeded = seedFiveReadyActors(root, sessionId);
  const rotated = rll.resolveSessionGeneration(
    root, identityFor(sessionId),
    { invocationDigest: '7'.repeat(64), forceRotation: true },
  );
  assert.strictEqual(rotated.ok, true, JSON.stringify(rotated));
  assert.strictEqual(rotated.rotated, true, JSON.stringify(rotated));
  assert.notStrictEqual(rotated.generationId, seeded.generationId);

  const nextGeneration = runEnsure(root, sessionId);
  assert.strictEqual(nextGeneration.exitCode, 0, JSON.stringify(nextGeneration));
  assert.strictEqual(nextGeneration.envelope.status, 'ACTION_REQUIRED', JSON.stringify(nextGeneration.envelope));
  assert.strictEqual(nextGeneration.envelope.actions.length, ROLES.length);
  assert.ok(nextGeneration.envelope.actions.every((action) =>
    action.operation === 'Agent' && action.kind === 'role-spawn' &&
    action.session_generation_id === rotated.generationId));
  assert.strictEqual(nextGeneration.envelope.actions.some((action) =>
    action.operation === 'SendMessage'), false);
});
