'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rll = require('../../lib/runtime-role-lifecycle.cjs');
const rc = require('../../lib/runtime-consultation.cjs');
const claudeHost = require('../../lib/runtime-host-claude.cjs');

// Keep validated test evidence readable for the lifetime of the node:test
// process. Production reads this dependency again when the completed proof is
// consumed, so a call-scoped monkeypatch would make a genuine v2 fixture decay
// immediately after construction.
const sessionEvidence = new Map();
const productionSessionIdentity = claudeHost.getProductionSessionIdentity;
function sessionEvidenceKeys(projectRootOrRepoDescriptor, sessionId) {
  if (typeof projectRootOrRepoDescriptor === 'string') {
    return [path.resolve(projectRootOrRepoDescriptor) + '\0' + sessionId];
  }
  if (projectRootOrRepoDescriptor && typeof projectRootOrRepoDescriptor.repoId === 'string') {
    return ['repo:' + projectRootOrRepoDescriptor.repoId + '\0' + sessionId];
  }
  return [];
}
claudeHost.getProductionSessionIdentity = (projectRootOrRepoDescriptor, sessionId) => {
  for (const key of sessionEvidenceKeys(projectRootOrRepoDescriptor, sessionId)) {
    const found = sessionEvidence.get(key);
    if (found) return found;
  }
  return productionSessionIdentity(projectRootOrRepoDescriptor, sessionId);
};

function sha256Bytes(bytes) { return rc.sha256Buffer(Buffer.from(bytes)); }

/**
 * Materializes the same signed, cross-process host/session evidence that a
 * managed native conductor would publish. Bats invokes hooks in fresh Node
 * processes, so an in-memory identity stub cannot prove actor authority.
 */
function ensureDurableSessionEvidence(projectRoot, sessionId) {
  const fixtureRoot = path.join(projectRoot, '.androidcommondoc-test', 'claude-host-contract');
  const evidenceRoot = path.join(fixtureRoot, 'evidence');
  const observerPath = path.join(fixtureRoot, 'claude-host-contract-probe.cjs');
  const executablePath = path.join(fixtureRoot, 'claude-fixture');
  const qualificationPath = path.join(fixtureRoot, 'qualification.json');
  const profilePath = path.join(projectRoot, '.claude', 'model-profiles.json');
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  if (!fs.existsSync(profilePath)) {
    fs.copyFileSync(path.resolve(__dirname, '..', '..', '..', '.claude', 'model-profiles.json'), profilePath);
  }
  fs.mkdirSync(path.join(evidenceRoot, 'observer'), { recursive: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, 'claude-host-contract-probe.cjs'), observerPath);
  fs.writeFileSync(executablePath, Buffer.from('claude-id01-v2 signed test executable\n', 'utf8'));

  const probeSession = 'claude-id01-v2-host-probe';
  const agentA = 'claude-id01-v2-probe-a';
  const agentB = 'claude-id01-v2-probe-b';
  const toolA = 'claude-id01-v2-agent-a';
  const toolB = 'claude-id01-v2-agent-b';
  const wakeTool = 'claude-id01-v2-wake-a';
  const inputA = { description: 'probe A', subagent_type: 'probe-peer', name: 'probe-peer-a', prompt: 'A', run_in_background: true };
  const inputB = { description: 'probe B', subagent_type: 'probe-peer', name: 'probe-peer-b', prompt: 'B', run_in_background: false };
  const event = (hook, extras = {}) => {
    const raw = Object.assign({ hook_event_name: hook, session_id: probeSession }, extras);
    return {
      schema: 'runtime/claude-host-contract-probe-event/v1', evidence_mode: 'genuine-pinned',
      producer: 'claude-host-contract-probe', hook_event_name: hook,
      session_digest: rc.sha256String(probeSession),
      tool_use_digest: raw.tool_use_id ? rc.sha256String(raw.tool_use_id) : null,
      prompt_id_digest: null,
      agent_id_digest: raw.agent_id ? rc.sha256String(raw.agent_id) : null,
      agent_type: raw.agent_type || null,
      tool_name: raw.tool_name || null,
      tool_input_digest: raw.tool_input === undefined ? null : rc.sha256String(rc.canonicalJSONStringify(raw.tool_input)),
      updated_input_digest: extras.updated_input_digest || null,
      raw_event: raw,
      observed_at: '2026-09-05T14:50:00.000Z',
    };
  };
  const events = [
    event('SessionStart', { source: 'startup' }),
    event('PreToolUse', { tool_name: 'Agent', tool_use_id: toolA, tool_input: inputA,
      updated_input_digest: rc.sha256String(rc.canonicalJSONStringify(inputA)) }),
    event('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
    event('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PostToolUse', { tool_name: 'Agent', tool_use_id: toolA, tool_input: inputA,
      tool_response: { status: 'async_launched', isAsync: true, agentId: agentA, totalToolUseCount: 2 } }),
    event('PreToolUse', { tool_name: 'SendMessage', tool_use_id: wakeTool, tool_input: { recipient: 'probe-peer-a', message: 'wake' } }),
    event('PostToolUse', { tool_name: 'SendMessage', tool_use_id: wakeTool, tool_input: { recipient: 'probe-peer-a', message: 'wake' },
      tool_response: { success: true, resumedAgentId: agentA } }),
    event('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
    event('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { tool_name: 'Agent', tool_use_id: toolB, tool_input: inputB,
      updated_input_digest: rc.sha256String(rc.canonicalJSONStringify(inputB)) }),
    event('SubagentStart', { agent_id: agentB, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
    event('PostToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
    event('SubagentStop', { agent_id: agentB, agent_type: 'probe-peer' }),
    event('PostToolUse', { tool_name: 'Agent', tool_use_id: toolB, tool_input: inputB,
      tool_response: { status: 'completed', agentId: agentB, totalToolUseCount: 1 } }),
  ];
  const observerBytes = Buffer.from(events.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  const streamBytes = Buffer.from(JSON.stringify({
    type: 'system', subtype: 'init', session_id: probeSession, model: 'claude-sonnet-5',
    claude_code_version: '2.1.261', tools: ['Task', 'Bash', 'Read', 'SendMessage'],
    mcp_servers: [{ name: 'fixture-mcp', status: 'connected' }],
  }) + '\n', 'utf8');
  fs.writeFileSync(path.join(evidenceRoot, 'observer', 'events.jsonl'), observerBytes);
  fs.writeFileSync(path.join(evidenceRoot, 'claude-stream.jsonl'), streamBytes);
  const qualification = {
    schema: 'androidcommondoc/p1-native-host-contract-qualification/v1',
    status: 'HOST_CONTRACT_OBSERVED', session_id: probeSession,
    qualified_at: '2026-09-05T14:58:31.667Z', transport_profile: 'native-claude-cli',
    cli: {
      version: '2.1.261', executable_realpath: fs.realpathSync(executablePath),
      executable_sha256: sha256Bytes(fs.readFileSync(executablePath)), actual_model: 'claude-sonnet-5',
    },
    evidence_sha256: {
      'observer/events.jsonl': sha256Bytes(observerBytes),
      'claude-stream.jsonl': sha256Bytes(streamBytes),
    },
    observed_contract: {
      same_actor_resume: true, different_same_type_peer: true, required_tools_present: true,
      additional_tools_allowed: true, post_tool_use_exposes_executed_input: true,
      canonical_five_key_input_executed: true,
    },
  };
  fs.writeFileSync(qualificationPath, JSON.stringify(qualification));
  const published = claudeHost.publishClaudeHostContractPackage({ projectRoot, qualificationPath, evidenceRoot, observerPath });
  assert.strictEqual(published.ok, true, `claude-id01-v2 fixture: host contract must publish: ${JSON.stringify(published)}`);
  const hostPin = {
    executablePath, cliVersion: qualification.cli.version, observerPath,
    transportProfile: qualification.transport_profile, os: process.platform,
  };
  const recorded = claudeHost.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Task', 'Bash', 'Read', 'SendMessage'], mcp_servers: [{ name: 'fixture-mcp' }],
    },
    hostPin,
  });
  assert.strictEqual(recorded.ok, true, `claude-id01-v2 fixture: session identity must record: ${JSON.stringify(recorded)}`);
  return recorded;
}

/**
 * Publishes the signed host contract, records a pin-bound managed session,
 * and mints one real production host admission for tests that exercise
 * capability discovery rather than per-actor authority.
 */
function primeProductionClaudeHostAdmission(options) {
  const { projectRoot, sessionId } = options;
  const entrypoint = options.entrypoint || 'monitor-docs';
  const roleScope = options.roleScope === undefined ? null : options.roleScope;
  const argvDigest = options.argvDigest || rc.sha256String(`entrypoint:${entrypoint}:readonly`);
  ensureDurableSessionEvidence(projectRoot, sessionId);
  const minted = claudeHost.mintProductionHostComposition({
    projectRoot,
    event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: sessionId },
    entrypoint,
    argvDigest,
    roleScope,
  });
  assert.strictEqual(minted.ok, true,
    `claude host admission fixture must mint: ${JSON.stringify(minted)}`);
  return minted;
}

function primeClaudeId01V2ActorProof(options) {
  const { projectRoot, agentType, sessionId, agentId, actionId } = options;
  const prefix = options.prefix || 'claude-id01-v2-fixture';
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(projectRoot, identity);
  assert.strictEqual(generation.ok, true, `${prefix}: session generation must resolve: ${JSON.stringify(generation)}`);
  const worktreeId = rll.computeWorktreeId(projectRoot);
  const plan = rll.discoverPlan(projectRoot);
  assert.strictEqual(plan.ok, true, `${prefix}: PLAN must resolve: ${JSON.stringify(plan)}`);
  const durableSessionEvidence = ensureDurableSessionEvidence(projectRoot, sessionId);
  const actionLookup = rll.findActionDirect(projectRoot, actionId);
  assert.strictEqual(actionLookup.ok, true, `${prefix}: action must resolve: ${JSON.stringify(actionLookup)}`);
  const action = actionLookup.action;

  const main = rll.getOrCreateMainOrchestratorBindingForSession(
    projectRoot, sessionId, worktreeId, plan.planDigest, 600,
  );
  assert.strictEqual(main.ok, true, `${prefix}: main binding must resolve: ${JSON.stringify(main)}`);
  const canonicalInput = rll.canonicalNativeAgentInputForAction(action);
  const canonicalDigest = rc.sha256String(rc.canonicalJSONStringify(canonicalInput));
  const claim = rll.mintRoleSpawnExecutionClaim(
    { repoId: action.repo_id }, action, main.binding.binding_id,
    {
      runtimeSessionId: sessionId,
      sourceToolUseId: `${prefix}-agent-${actionId}`,
      canonicalInputDigest: canonicalDigest,
      proposedInputDigest: canonicalDigest,
      modelDeviation: false,
    },
    240,
  );
  assert.strictEqual(claim.ok, true, `${prefix}: spawn claim must mint: ${JSON.stringify(claim)}`);
  const consumedClaim = rll.validateAndConsumeRoleSpawnExecutionClaim(
    projectRoot, action, { sessionId, agentId, agentType }, projectRoot,
  );
  assert.strictEqual(consumedClaim.ok, true, `${prefix}: spawn claim must consume: ${JSON.stringify(consumedClaim)}`);
  const actorBinding = rll.createRoleActorBinding(
    projectRoot, agentType, worktreeId, plan.planDigest, generation.generationId,
    options.actorBindingTtlSeconds || 600,
  );
  assert.strictEqual(actorBinding.ok, true, `${prefix}: actor binding must mint: ${JSON.stringify(actorBinding)}`);

  const profileDigest = rll.roleProfileDigestFor(agentType);
  const currentState = rll.readRoleBindingState(
    projectRoot, worktreeId, plan.planDigest, profileDigest, generation.generationId, agentType,
  );
  assert.strictEqual(currentState.ok, true, `${prefix}: role state must read: ${JSON.stringify(currentState)}`);
  let starting = null;
  if (currentState.state === 'ABSENT') {
    starting = rll.transitionRoleBinding(
      projectRoot, worktreeId, plan.planDigest, profileDigest, generation.generationId,
      agentType, 'ABSENT', 'STARTING', null,
      { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: actionId },
    );
    assert.strictEqual(starting.ok, true, `${prefix}: role must enter STARTING: ${JSON.stringify(starting)}`);
  } else if (currentState.state === 'STARTING') {
    assert.strictEqual(currentState.record.pending_action_id, actionId,
      `${prefix}: existing STARTING role must own the same action`);
    starting = { ok: true, record: currentState.record };
  } else {
    assert.strictEqual(currentState.state, 'READY', `${prefix}: an existing fixture role state must already be READY: ${JSON.stringify(currentState)}`);
  }

  const fixtureSessionEvidence = durableSessionEvidence;
  sessionEvidence.set(path.resolve(projectRoot) + '\0' + sessionId, fixtureSessionEvidence);
  sessionEvidence.set('repo:' + rll.computeRepoId(projectRoot) + '\0' + sessionId, fixtureSessionEvidence);
  {
    const actor = rll.recordClaudeStartupActorObservation(projectRoot, {
      sessionId, agentId, agentType, action, claim: consumedClaim.claim,
      actorBinding: actorBinding.binding,
    });
    assert.strictEqual(actor.ok, true, `${prefix}: actor observation must record: ${JSON.stringify(actor)}`);
    if (options.completeReady === false) {
      return { action, actorBinding: actorBinding.binding, startupActor: actor.record };
    }
    const readyToolUseId = `${prefix}-ready-${actionId}`;
    const argvDigest = rc.sha256String(`ready:${actionId}`);
    const grant = rll.mintLifecycleCommandGrant(
      projectRoot, actorBinding.binding, argvDigest, agentType, 'ready',
      'role-actor', 'target', 'target', actionId,
    );
    assert.strictEqual(grant.ok, true, `${prefix}: ready grant must mint: ${JSON.stringify(grant)}`);
    const pre = rll.recordClaudeStartupReadyPreObservation(projectRoot, {
      sessionId, agentId, agentType, toolUseId: readyToolUseId,
      action, actorBinding: actorBinding.binding, grantId: grant.grantId,
    });
    assert.strictEqual(pre.ok, true, `${prefix}: ready pre must record: ${JSON.stringify(pre)}`);
    const consumedGrant = rll.validateAndConsumeLifecycleCommandGrant(
      projectRoot, grant.grantId, argvDigest, agentType, 'ready', actionId,
    );
    assert.strictEqual(consumedGrant.ok, true, `${prefix}: ready grant must consume: ${JSON.stringify(consumedGrant)}`);
    if (starting) {
      const ready = rll.transitionRoleBinding(
        projectRoot, worktreeId, plan.planDigest, profileDigest, generation.generationId,
        agentType, 'STARTING', 'READY', starting.record, {},
      );
      assert.strictEqual(ready.ok, true, `${prefix}: role must enter READY: ${JSON.stringify(ready)}`);
    }
    const outcome = rll.recordClaudeStartupReadyOutcome(projectRoot, {
      hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: sessionId,
      tool_use_id: readyToolUseId, agent_id: agentId, agent_type: agentType,
    });
    assert.strictEqual(outcome.ok, true, `${prefix}: ready outcome must record: ${JSON.stringify(outcome)}`);
    const proof = rll.checkClaudeId01ProofComplete(
      projectRoot, sessionId, worktreeId, plan.planDigest, agentType, agentId,
    );
    assert.strictEqual(proof.ok, true, `${prefix}: actor-scoped v2 proof must complete: ${JSON.stringify(proof)}`);
    return { action, actorBinding: actorBinding.binding, readyToolUseId };
  }
}

function primeClaudeStartupActor(options) {
  return primeClaudeId01V2ActorProof({ ...options, completeReady: false });
}

function claudeId01V2SessionEvidenceFor(projectRoot, sessionId) {
  return sessionEvidence.get(path.resolve(projectRoot) + '\0' + sessionId) || null;
}

module.exports = {
  primeClaudeId01V2ActorProof,
  primeClaudeStartupActor,
  primeProductionClaudeHostAdmission,
  claudeId01V2SessionEvidenceFor,
};
