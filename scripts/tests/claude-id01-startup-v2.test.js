#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const rc = require('../lib/runtime-consultation.cjs');
const host = require('../lib/runtime-host-claude.cjs');

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function makeFixture(label) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-startup-v2-' + label + '-'));
  execFileSync('git', ['-C', projectRoot, 'init', '-q']);
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'startup-v2@test.local']);
  execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Startup V2 Test']);
  execFileSync('git', ['-C', projectRoot, 'commit', '-q', '--allow-empty', '-m', 'init']);
  const waveDir = path.join(projectRoot, '.planning', 'wave-startup-v2');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# startup v2 fixture\n');

  const sessionId = 'startup-session-' + label;
  const agentId = 'startup-agent-' + label;
  const role = 'arch-platform';
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(projectRoot, identity);
  const worktreeId = rll.computeWorktreeId(projectRoot);
  const planDigest = rll.discoverPlan(projectRoot).planDigest;
  const main = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 600);
  assert.strictEqual(generation.ok, true);
  assert.strictEqual(main.ok, true);
  const actionId = rll.generateActionId();
  const actionResult = rll.mintRoleLifecycleAction(
    projectRoot, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(projectRoot),
    worktreeId, planDigest, digest('policy-' + label), generation.generationId, role,
    rll.buildRoleSpawnPayload('startup-v2', role, role, null, 'bootstrap-' + label),
    new Date(Date.now() + 240000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  assert.strictEqual(actionResult.ok, true, JSON.stringify(actionResult));
  const action = actionResult.action;
  const canonical = rll.canonicalNativeAgentInputForAction(action);
  const toolUseId = 'startup-agent-tool-' + label;
  const claimResult = rll.mintRoleSpawnExecutionClaim({ repoId: action.repo_id }, action, main.binding.binding_id, {
    runtimeSessionId: sessionId,
    sourceToolUseId: toolUseId,
    canonicalInputDigest: digest(rc.canonicalJSONStringify(canonical)),
    proposedInputDigest: digest(rc.canonicalJSONStringify(canonical)),
    modelDeviation: false,
  }, 240);
  assert.strictEqual(claimResult.ok, true, JSON.stringify(claimResult));
  const consumed = rll.validateAndConsumeRoleSpawnExecutionClaim(projectRoot, action,
    { sessionId, agentId, agentType: role }, projectRoot);
  assert.strictEqual(consumed.ok, true, JSON.stringify(consumed));
  const actorBinding = rll.createRoleActorBinding(projectRoot, role, worktreeId, planDigest, generation.generationId, 600);
  assert.strictEqual(actorBinding.ok, true, JSON.stringify(actorBinding));
  const profileDigest = rll.roleProfileDigestFor(role);
  const starting = rll.transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest,
    generation.generationId, role, 'ABSENT', 'STARTING', null,
    { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: actionId });
  assert.strictEqual(starting.ok, true, JSON.stringify(starting));
  return {
    projectRoot, sessionId, agentId, role, generation, worktreeId, planDigest, action,
    claim: consumed.claim, actorBinding: actorBinding.binding, profileDigest, starting: starting.record,
  };
}

function withSessionEvidence(fixture, fn) {
  const saved = host.getProductionSessionIdentity;
  host.getProductionSessionIdentity = (projectRoot, sessionId) => {
    if (projectRoot !== fixture.projectRoot || sessionId !== fixture.sessionId) return { ok: false };
    return { ok: true, record: {
      worktree_id: fixture.worktreeId,
      plan_digest: fixture.planDigest,
      host_contract_digest: digest('host-contract'),
      expires_at: new Date(Date.now() + 600000).toISOString(),
    } };
  };
  try { return fn(); } finally { host.getProductionSessionIdentity = saved; }
}

function completeStartup(fixture, options = {}) {
  return withSessionEvidence(fixture, () => {
    const actor = rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: options.agentId || fixture.agentId,
      agentType: options.role || fixture.role, action: fixture.action,
      claim: fixture.claim, actorBinding: fixture.actorBinding,
    });
    if (!actor.ok) return { actor };
    const readyToolUseId = 'startup-ready-tool-' + (options.suffix || 'ok');
    const argvDigest = rc.sha256String('ready:' + fixture.action.action_id);
    const grant = rll.mintLifecycleCommandGrant(fixture.projectRoot, fixture.actorBinding, argvDigest,
      fixture.role, 'ready', 'role-actor', 'target', 'target', fixture.action.action_id);
    if (!grant.ok) return { actor, grant };
    const pre = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: options.readyAgentId || fixture.agentId, agentType: fixture.role,
      toolUseId: readyToolUseId, action: fixture.action, actorBinding: fixture.actorBinding,
      grantId: grant.grantId,
    });
    if (!pre.ok) return { actor, grant, pre };
    const consumedGrant = rll.validateAndConsumeLifecycleCommandGrant(fixture.projectRoot, grant.grantId,
      argvDigest, fixture.role, 'ready', fixture.action.action_id);
    if (!consumedGrant.ok) return { actor, grant, pre, consumedGrant };
    const ready = rll.transitionRoleBinding(fixture.projectRoot, fixture.worktreeId, fixture.planDigest,
      fixture.profileDigest, fixture.generation.generationId, fixture.role, 'STARTING', 'READY',
      fixture.starting, {});
    if (!ready.ok) return { actor, grant, pre, consumedGrant, ready };
    const outcome = rll.recordClaudeStartupReadyOutcome(fixture.projectRoot, {
      hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: fixture.sessionId,
      tool_use_id: readyToolUseId, agent_id: options.outcomeAgentId || fixture.agentId, agent_type: fixture.role,
    });
    return { actor, grant, pre, consumedGrant, ready, outcome };
  });
}

function cleanup(fixture) {
  try { fs.rmSync(rll.registryRepoDir(fixture.projectRoot), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
}

test('P1-ID01-V2 initial consumed claim plus real actor binding and successful target-gated ready promotes one actor without a second peer', () => {
  const fixture = makeFixture('positive');
  try {
    const completed = completeStartup(fixture);
    assert.strictEqual(completed.actor.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.pre.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.outcome.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.outcome.capability.schema, 'runtime/claude-id01-capability/v2');
    assert.deepStrictEqual(Object.keys(completed.outcome.capability).sort(), [
      'completed_at', 'created_at', 'expiry', 'host_contract_digest', 'plan_digest',
      'schema', 'session_generation_digest', 'startup_actor_observed',
      'startup_trace_digest', 'worktree_id',
    ].sort());
    const proof = withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, fixture.agentId,
    ));
    assert.strictEqual(proof.ok, true, JSON.stringify(proof));
    const requester = withSessionEvidence(fixture, () => rll.createRequesterBinding(
      fixture.projectRoot,
      { ok: true, provider: 'claude-hook', runtime_session_key: fixture.sessionId },
      fixture.agentId, fixture.role, fixture.worktreeId, fixture.planDigest, 600,
    ));
    assert.strictEqual(requester.ok, true, JSON.stringify(requester));
    assert.strictEqual(withSessionEvidence(fixture, () => rll.validateRequesterBindingFor(
      fixture.projectRoot, requester.binding.binding_id, fixture.role, fixture.worktreeId, fixture.planDigest,
    )).ok, true);
    const observed = { sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role };
    assert.strictEqual(rll.preflightClaudeId01TraceForSession(fixture.projectRoot, observed).ok, true);
    const identityId = rll.computeClaudeAuthorityIdentityId(
      fixture.projectRoot, 'claude-hook', fixture.sessionId, fixture.agentId,
    );
    assert.strictEqual(rll.publishClaudeAuthorityFence(fixture.projectRoot, identityId).ok, true);
    assert.strictEqual(rll.deleteClaudeId01TraceForSession(fixture.projectRoot, observed).ok, true);
    const afterStop = withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, fixture.agentId,
    ));
    assert.strictEqual(afterStop.ok, false);
    assert.strictEqual(afterStop.reason, 'claude-id01-startup-trace-absent');
  } finally { cleanup(fixture); }
});

test('P1-ID01-V2 SubagentStop parks the exact actor in a multi-wave consumer without global PLAN guessing', () => {
  const fixture = makeFixture('multi-wave-stop-park');
  try {
    const completed = completeStartup(fixture);
    assert.strictEqual(completed.outcome.ok, true, JSON.stringify(completed));
    const historicalWave = path.join(fixture.projectRoot, '.planning', 'wave-historical-retained');
    fs.mkdirSync(historicalWave, { recursive: true });
    fs.writeFileSync(path.join(historicalWave, 'PLAN.md'), '# retained historical wave\n');
    assert.strictEqual(rll.discoverPlan(fixture.projectRoot).ok, false,
      'fixture must reproduce the real multi-wave consumer where global PLAN discovery is ambiguous');

    const parked = rll.parkClaudeResumeHandleForRoleActor(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role,
    });
    assert.strictEqual(parked.ok, true, JSON.stringify(parked));
    const parkedState = rll.readRoleBindingState(
      fixture.projectRoot, fixture.worktreeId, fixture.planDigest, fixture.profileDigest,
      fixture.generation.generationId, fixture.role,
    );
    assert.strictEqual(parkedState.ok, true);
    assert.strictEqual(parkedState.state, 'WAITING');
  } finally { cleanup(fixture); }
});

test('P1-ID01-V2 ready PRE resolves the unique authenticated startup actor when PreToolUse omits agent identity fields', () => {
  const fixture = makeFixture('pretooluse-without-agent-fields');
  try {
    const actor = withSessionEvidence(fixture, () => rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role,
      action: fixture.action, claim: fixture.claim, actorBinding: fixture.actorBinding,
    }));
    assert.strictEqual(actor.ok, true, JSON.stringify(actor));
    const argvDigest = rc.sha256String('ready:' + fixture.action.action_id);
    const grant = rll.mintLifecycleCommandGrant(fixture.projectRoot, fixture.actorBinding, argvDigest,
      fixture.role, 'ready', 'role-actor', 'target', 'target', fixture.action.action_id);
    assert.strictEqual(grant.ok, true, JSON.stringify(grant));

    const invalidTranscript = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, transcriptPath: path.join(fixture.projectRoot, 'missing.jsonl'),
      toolUseId: 'startup-ready-invalid-transcript', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(invalidTranscript.ok, false);
    assert.strictEqual(invalidTranscript.reason, 'startup-ready-pre-input-invalid');

    const transcriptDir = path.join(fixture.projectRoot, fixture.sessionId, 'subagents');
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, 'agent-' + fixture.agentId + '.jsonl');
    fs.writeFileSync(transcriptPath, '{}\n');
    const transcriptBound = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: 'non-authoritative-hook-alias', agentType: 'arch-testing',
      transcriptPath, toolUseId: 'startup-ready-transcript-bound', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(transcriptBound.ok, true, JSON.stringify(transcriptBound));
    assert.strictEqual(transcriptBound.record.agent_digest, digest(fixture.agentId));
    assert.strictEqual(transcriptBound.record.role, fixture.role);

    const mainTranscriptPath = path.join(fixture.projectRoot, fixture.sessionId + '.jsonl');
    fs.writeFileSync(mainTranscriptPath, '{}\n');
    const mainTranscriptFallback = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: 'non-authoritative-hook-alias', agentType: 'arch-testing',
      transcriptPath: mainTranscriptPath, toolUseId: 'startup-ready-main-transcript', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(mainTranscriptFallback.ok, true, JSON.stringify(mainTranscriptFallback));
    assert.strictEqual(mainTranscriptFallback.record.agent_digest, digest(fixture.agentId));
    assert.strictEqual(mainTranscriptFallback.record.role, fixture.role);

    const wrongExplicitRole = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentType: 'arch-testing',
      toolUseId: 'startup-ready-wrong-role', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(wrongExplicitRole.ok, false);
    assert.strictEqual(wrongExplicitRole.reason, 'startup-ready-pre-input-invalid');

    const wrongExplicitAgent = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: 'foreign-agent', agentType: fixture.role,
      toolUseId: 'startup-ready-wrong-agent', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(wrongExplicitAgent.ok, false);
    assert.strictEqual(wrongExplicitAgent.reason, 'startup-ready-actor-trace-absent');

    const teamAlias = fixture.role + '@session-' + fixture.sessionId.slice(0, 8);
    const teamAliasReady = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: teamAlias, agentType: fixture.role,
      toolUseId: 'startup-ready-team-alias', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(teamAliasReady.ok, true, JSON.stringify(teamAliasReady));
    assert.strictEqual(teamAliasReady.record.agent_digest, digest(fixture.agentId));

    const foreignTeamAlias = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.role + '@session-deadbeef', agentType: fixture.role,
      toolUseId: 'startup-ready-foreign-team-alias', action: fixture.action,
      actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(foreignTeamAlias.ok, false);
    assert.strictEqual(foreignTeamAlias.reason, 'startup-ready-actor-trace-absent');

    const secondAgentDigest = digest('ambiguous-second-agent');
    const secondLookupKey = digest('claude-startup-v2:' + fixture.generation.generationId + ':' + secondAgentDigest);
    const secondTracePath = path.join(rll.registryRepoDir(fixture.projectRoot), 'claude-id01-traces',
      'startup-v2-' + secondLookupKey + '.json');
    fs.writeFileSync(secondTracePath, JSON.stringify({ ...actor.record, agent_digest: secondAgentDigest }), { mode: 0o600 });
    const ambiguous = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, toolUseId: 'startup-ready-ambiguous-agent',
      action: fixture.action, actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(ambiguous.ok, false);
    assert.strictEqual(ambiguous.reason, 'startup-ready-actor-trace-ambiguous');
    fs.unlinkSync(secondTracePath);

    const pre = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, toolUseId: 'startup-ready-without-agent-fields',
      action: fixture.action, actorBinding: fixture.actorBinding, grantId: grant.grantId,
    });
    assert.strictEqual(pre.ok, true, JSON.stringify(pre));
    assert.strictEqual(pre.record.role, fixture.role);
    assert.strictEqual(pre.record.agent_digest, digest(fixture.agentId));
  } finally { cleanup(fixture); }
});

test('P1-ID01-V2 startup joins a scoped composition with current host evidence before persisting the actor trace', () => {
  const fixture = makeFixture('scoped-composition-host-contract');
  const saved = host.getProductionSessionIdentity;
  try {
    host.getProductionSessionIdentity = (projectRoot, sessionId, expected) => {
      if (projectRoot !== fixture.projectRoot || sessionId !== fixture.sessionId) return { ok: false };
      const common = {
        worktree_id: fixture.worktreeId,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      };
      return expected
        ? { ok: true, record: { ...common, plan_digest: fixture.planDigest } }
        : { ok: true, record: { ...common, host_contract_digest: digest('host-contract') } };
    };
    const actor = rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role,
      action: fixture.action, claim: fixture.claim, actorBinding: fixture.actorBinding,
    });
    assert.strictEqual(actor.ok, true, JSON.stringify(actor));
    assert.strictEqual(actor.record.host_contract_digest, digest('host-contract'));
    assert.strictEqual(Object.keys(actor.record).length, 14);

    host.getProductionSessionIdentity = (projectRoot, sessionId, expected) => {
      if (projectRoot !== fixture.projectRoot || sessionId !== fixture.sessionId) return { ok: false };
      return expected
        ? { ok: true, record: {
          worktree_id: fixture.worktreeId, plan_digest: fixture.planDigest,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        } }
        : { ok: false };
    };
    const missingHostEvidence = rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId + '-missing', agentType: fixture.role,
      action: fixture.action, claim: fixture.claim, actorBinding: fixture.actorBinding,
    });
    assert.strictEqual(missingHostEvidence.ok, false);
    assert.strictEqual(missingHostEvidence.reason, 'startup-actor-session-unproven');
  } finally {
    host.getProductionSessionIdentity = saved;
    cleanup(fixture);
  }
});

test('P1-ID01-V2 authenticated team alias completes ready outcome but a foreign alias cannot mint capability', () => {
  const accepted = makeFixture('team-alias-outcome');
  const rejected = makeFixture('foreign-team-alias-outcome');
  try {
    const teamAlias = accepted.role + '@session-' + accepted.sessionId.slice(0, 8);
    const completed = completeStartup(accepted, { readyAgentId: teamAlias, outcomeAgentId: teamAlias });
    assert.strictEqual(completed.pre.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.outcome.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.outcome.capability.schema, 'runtime/claude-id01-capability/v2');

    const foreign = completeStartup(rejected, {
      readyAgentId: rejected.role + '@session-' + rejected.sessionId.slice(0, 8),
      outcomeAgentId: rejected.role + '@session-deadbeef',
    });
    assert.strictEqual(foreign.pre.ok, true, JSON.stringify(foreign));
    assert.strictEqual(foreign.outcome.ok, false);
    assert.strictEqual(foreign.outcome.reason, 'startup-ready-outcome-actor-mismatch');
    const proof = withSessionEvidence(rejected, () => rll.checkClaudeId01ProofComplete(
      rejected.projectRoot, rejected.sessionId, rejected.worktreeId, rejected.planDigest,
      rejected.role, rejected.agentId,
    ));
    assert.strictEqual(proof.ok, false);
  } finally {
    cleanup(accepted);
    cleanup(rejected);
  }
});

test('P1-ID01-V2 missing host evidence, failed/missing ready, foreign actor and old generation-wide v1 capability grant no requester proof', () => {
  const fixture = makeFixture('negative');
  try {
    const noSession = rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role,
      action: fixture.action, claim: fixture.claim, actorBinding: fixture.actorBinding,
    });
    assert.strictEqual(noSession.ok, false);
    assert.strictEqual(rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, fixture.agentId,
    ).ok, false);
    assert.strictEqual(rll.checkClaudeId01RuntimeCapability(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest,
    ).reason, 'claude-id01-actor-scope-required');
    const completed = completeStartup(fixture);
    assert.strictEqual(completed.outcome.ok, true, JSON.stringify(completed));
    const foreign = withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, 'foreign-agent',
    ));
    assert.strictEqual(foreign.ok, false);
    const oldPath = rll.claudeId01CapabilityPathFor(fixture.projectRoot, fixture.generation.generationId,
      fixture.worktreeId, fixture.planDigest);
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, JSON.stringify({ schema: 'runtime/claude-id01-capability/v1', proof_complete: true }));
    assert.strictEqual(withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, 'another-agent',
    )).ok, false);
  } finally { cleanup(fixture); }
});
