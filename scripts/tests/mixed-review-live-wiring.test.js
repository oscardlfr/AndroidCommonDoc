#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

// mixed-review-live-wiring.test.js -- RED-first coverage for P5 U2 live-
// wiring fast follow (task #13/#14, dispatch test-specialist/arch-platform-
// 20260903T200053Z.json). Fixes a real bug context-provider found in the
// already-approved executeMixedReviewRequest: it re-resolved its own worker
// via s16ResolveRetainedPair, whose target field is disk-resolved identity
// metadata (from resolveLiveCodexAppServerWorker) used only for cross-
// checking -- never the real in-process worker object with a live
// connection, which only exists inside pollRetainedWorkers own
// retainedWorkers array. Confirmed by direct read of the CURRENT (pre-fix)
// executeMixedReviewRequest body (runtime-bridge-codex.cjs:6014-6159).
//
// 4 artifacts, companion production dispatch to toolkit-specialist (same
// wave): (A) s16ResolveMixedReviewPair -- new eligibility check used at
// REQUEST time (Claude-native requester via readRoleBindingState, live
// Codex-native target via resolveLiveCodexAppServerWorker, mirroring
// s16ResolveRetainedPair own cross-checks against context instead of a
// second resolved side). (B) executeMixedReviewRequest signature change --
// receives a live worker directly, never re-resolves one. (C)
// handleMixedReviewRequest -- new CLI subcommand, publishes the intent plus
// a durable subjectText blob. (D) collectPendingMixedReviewRequest -- new
// poll-loop hook, sibling to (not a modification of) the existing
// collectCompletedP2Context closure inside pollRetainedWorkers loop.
//
// Fixture infrastructure below mirrors runtime-role-lifecycle-handlers.test.js
// exactly (m6bEnsureAllFive/m6bPublishReadyEvidence/M6B_FIVE_ROLES/mintGrant/
// runCli, all real non-mocked primitives -- confirmed by direct read of that
// file) for the Codex-native target side, plus a direct low-level role-
// binding write (runtime-role-lifecycle-statemachine.test.js own pattern)
// for the Claude-native requester side, since that state does not need to
// come from a live process.

const assert = require('node:assert');
const { test, describe } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const TEST_CAPABILITY = 'mixed-review-live-wiring-fixture-capability';
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = TEST_CAPABILITY;
process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = TEST_CAPABILITY;
process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = TEST_CAPABILITY;
process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = 'mixed-review-live-wiring-fixture-executor-capability';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = 'mixed-review-live-wiring-fixture-batch-ready-capability';

const rll = require(IMPL);
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));
const rbc = require(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'));
const claudeHost = require(path.resolve(__dirname, '../lib/runtime-host-claude.cjs'));

function makeGitProject(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'rll-mrlw-')));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-mrlw-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL MRLW Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  const libDir = path.join(dir, 'scripts', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
  policy.schema = 'runtime-collaboration-policy/v1';
  policy.version = 1;
  delete policy.selection;
  delete policy.claude_native_startup_timeout_seconds;
  fs.writeFileSync(path.join(libDir, 'runtime-collaboration-policy.json'), JSON.stringify(policy, null, 2) + '\n');
  fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(libDir, 'runtime-routing.json'));
  return dir;
}

function writePlanFixture(projectRoot, waveSlug) {
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for mixed-review-live-wiring.test.js (' + waveSlug + ')\n');
}

function cleanup(dir) {
  fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

const NEUTRAL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-mrlw-neutral-home-'));

function baseEnv(extra) {
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: TEST_CAPABILITY,
    HOME: NEUTRAL_HOME,
    USERPROFILE: NEUTRAL_HOME,
    CODEX_CLI_PATH: '',
  }, extra || {});
  if (extra && Object.prototype.hasOwnProperty.call(extra, 'HOME') && !Object.prototype.hasOwnProperty.call(extra, 'USERPROFILE')) {
    env.USERPROFILE = extra.HOME;
  }
  return env;
}

function runCli(args, envExtra) {
  let stdout;
  let status = 0;
  try {
    stdout = execFileSync('node', ['--require', path.resolve(__dirname, 'lib/private-registry-tmpdir-preload.cjs'), IMPL].concat(args), { encoding: 'utf8', env: baseEnv(envExtra) });
  } catch (err) {
    stdout = err.stdout;
    status = err.status;
  }
  const lines = stdout.trim().split('\n');
  const result = JSON.parse(lines[lines.length - 1]);
  return { status: status, result: result };
}

function identityFor(sessionKey) {
  return { ok: true, provider: 'claude-hook', runtime_session_key: sessionKey };
}

function ensureDigest(roles) {
  return rc.sha256String('ensure:' + roles.slice().sort().join(','));
}

function grantContextFor(subcommand) {
  if (subcommand === 'ready') return { bindingKind: 'role-actor', authority: 'target', profile: 'target' };
  return { bindingKind: 'main-orchestrator', authority: 'orchestrator', profile: 'normal' };
}

function ensureClaudeId01RuntimeCapability(dir, sessionKey) {
  const worktreeId = rll.computeWorktreeId(dir);
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, "CLAUDE-ID-01 fixture PLAN must resolve");
  const identity = identityFor(sessionKey);
  const generation = rll.resolveSessionGeneration(dir, identity);
  assert.strictEqual(generation.ok, true, "CLAUDE-ID-01 fixture generation must resolve");
  const role = "toolkit-specialist";
  const agentId = "mrlw-capability-primary";
  const savedIdentityReader = claudeHost.getProductionSessionIdentity;
  claudeHost.getProductionSessionIdentity = (projectRoot, observedSessionKey) => ({
    ok: projectRoot === dir && observedSessionKey === sessionKey,
    record: {
      worktree_id: worktreeId,
      plan_digest: plan.planDigest,
      host_contract_digest: rc.sha256String("mrlw-host-contract"),
      expires_at: new Date(Date.now() + 600000).toISOString(),
    },
  });
  try {
    const existing = rll.checkClaudeId01RuntimeCapability(
      dir, sessionKey, worktreeId, plan.planDigest, role, agentId,
    );
    if (existing.ok) return;

    const main = rll.createMainOrchestratorBinding(dir, identity, worktreeId, plan.planDigest, 600);
    assert.strictEqual(main.ok, true, "CLAUDE-ID-01 fixture main binding must resolve: " + JSON.stringify(main));
    const actionId = rll.generateActionId();
    const expiry = new Date(Date.now() + 240000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const minted = rll.mintRoleLifecycleAction(
      dir, actionId, "role-spawn", "claude-native", rll.computeRepoId(dir), worktreeId,
      plan.planDigest, rc.sha256String("mrlw-claude-id01-v2"), generation.generationId, role,
      rll.buildRoleSpawnPayload("claude-id01-probe", role, role, null, "fixture"), expiry,
    );
    assert.strictEqual(minted.ok, true, "CLAUDE-ID-01 v2 action must mint: " + JSON.stringify(minted));
    const action = minted.action;
    const canonicalInput = rll.canonicalNativeAgentInputForAction(action);
    const claimResult = rll.mintRoleSpawnExecutionClaim(
      { repoId: action.repo_id }, action, main.binding.binding_id,
      {
        runtimeSessionId: sessionKey,
        sourceToolUseId: "mrlw-capability-agent-tool",
        canonicalInputDigest: rc.sha256String(rc.canonicalJSONStringify(canonicalInput)),
        proposedInputDigest: rc.sha256String(rc.canonicalJSONStringify(canonicalInput)),
        modelDeviation: false,
      },
      240,
    );
    assert.strictEqual(claimResult.ok, true, "CLAUDE-ID-01 v2 claim must mint: " + JSON.stringify(claimResult));
    const consumedClaim = rll.validateAndConsumeRoleSpawnExecutionClaim(
      dir, action, { sessionId: sessionKey, agentId, agentType: role }, dir,
    );
    assert.strictEqual(consumedClaim.ok, true, "CLAUDE-ID-01 v2 claim must consume: " + JSON.stringify(consumedClaim));
    const actorBinding = rll.createRoleActorBinding(
      dir, role, worktreeId, plan.planDigest, generation.generationId, 600,
    );
    assert.strictEqual(actorBinding.ok, true, "CLAUDE-ID-01 actor binding must mint: " + JSON.stringify(actorBinding));
    const profileDigest = rll.roleProfileDigestFor(role);
    const starting = rll.transitionRoleBinding(
      dir, worktreeId, plan.planDigest, profileDigest, generation.generationId,
      role, "ABSENT", "STARTING", null,
      { driver: "claude-sendmessage", respawn_count: 0, pending_action_id: actionId },
    );
    assert.strictEqual(starting.ok, true, "CLAUDE-ID-01 role must enter STARTING: " + JSON.stringify(starting));
    const actor = rll.recordClaudeStartupActorObservation(dir, {
      sessionId: sessionKey, agentId, agentType: role, action,
      claim: consumedClaim.claim, actorBinding: actorBinding.binding,
    });
    assert.strictEqual(actor.ok, true, "CLAUDE-ID-01 actor observation must record: " + JSON.stringify(actor));
    const readyToolUseId = "mrlw-capability-ready-tool";
    const readyArgvDigest = rc.sha256String("ready:" + actionId);
    const readyGrant = rll.mintLifecycleCommandGrant(
      dir, actorBinding.binding, readyArgvDigest, role, "ready",
      "role-actor", "target", "target", actionId,
    );
    assert.strictEqual(readyGrant.ok, true, "CLAUDE-ID-01 ready grant must mint: " + JSON.stringify(readyGrant));
    const readyPre = rll.recordClaudeStartupReadyPreObservation(dir, {
      sessionId: sessionKey, agentId, agentType: role, toolUseId: readyToolUseId,
      action, actorBinding: actorBinding.binding, grantId: readyGrant.grantId,
    });
    assert.strictEqual(readyPre.ok, true, "CLAUDE-ID-01 ready pre-observation must record: " + JSON.stringify(readyPre));
    const consumedGrant = rll.validateAndConsumeLifecycleCommandGrant(
      dir, readyGrant.grantId, readyArgvDigest, role, "ready", actionId,
    );
    assert.strictEqual(consumedGrant.ok, true, "CLAUDE-ID-01 ready grant must consume: " + JSON.stringify(consumedGrant));
    const ready = rll.transitionRoleBinding(
      dir, worktreeId, plan.planDigest, profileDigest, generation.generationId,
      role, "STARTING", "READY", starting.record, {},
    );
    assert.strictEqual(ready.ok, true, "CLAUDE-ID-01 role must enter READY: " + JSON.stringify(ready));
    const outcome = rll.recordClaudeStartupReadyOutcome(dir, {
      hook_event_name: "PostToolUse", tool_name: "Bash", session_id: sessionKey,
      tool_use_id: readyToolUseId, agent_id: agentId, agent_type: role,
    });
    assert.strictEqual(outcome.ok, true, "CLAUDE-ID-01 ready outcome must record: " + JSON.stringify(outcome));
    const proof = rll.checkClaudeId01RuntimeCapability(
      dir, sessionKey, worktreeId, plan.planDigest, role, agentId,
    );
    assert.strictEqual(proof.ok, true, "CLAUDE-ID-01 runtime capability must be complete: " + JSON.stringify(proof));
  } finally {
    claudeHost.getProductionSessionIdentity = savedIdentityReader;
  }
}

function mintGrant(dir, sessionKey, role, subcommand, argvDigest, opts) {
  const identity = identityFor(sessionKey);
  const worktreeId = (opts && opts.worktreeId) || rll.computeWorktreeId(dir);
  const planDigest = (opts && opts.planDigest) || rll.discoverPlan(dir).planDigest;
  ensureClaudeId01RuntimeCapability(dir, sessionKey);
  const bindingResult = rll.createMainOrchestratorBinding(dir, identity, worktreeId, planDigest, (opts && opts.bindingTtlSeconds) || 120);
  assert.strictEqual(bindingResult.ok, true, 'test fixture setup: createMainOrchestratorBinding must succeed');
  const ctx = grantContextFor(subcommand);
  const bindingKind = (opts && opts.bindingKind) || ctx.bindingKind;
  const authority = (opts && opts.authority) || ctx.authority;
  const profile = (opts && opts.profile) || ctx.profile;
  const actionId = (opts && opts.actionId !== undefined) ? opts.actionId : null;
  const grantResult = rll.mintLifecycleCommandGrant(dir, bindingResult.binding, argvDigest, role, subcommand, bindingKind, authority, profile, actionId);
  assert.strictEqual(grantResult.ok, true, 'test fixture setup: mintLifecycleCommandGrant must succeed: ' + JSON.stringify(grantResult));
  return { binding: bindingResult.binding, grantId: grantResult.grantId };
}

const M6B_FIVE_ROLES = ['arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater'];
const CODEX_CAPS = JSON.stringify(['codex-app-server']);

function m6bEnsureAllFive(dir, sessionKey, opts) {
  const sortedRoles = M6B_FIVE_ROLES.slice().sort();
  const g = mintGrant(dir, sessionKey, sortedRoles, 'ensure', ensureDigest(M6B_FIVE_ROLES), {
    bindingKind: 'main-orchestrator', authority: 'orchestrator', profile: 'normal',
    bindingTtlSeconds: opts && opts.bindingTtlSeconds,
  });
  const args = ['ensure', '--project-root', dir];
  for (const r of M6B_FIVE_ROLES) args.push('--role', r);
  args.push('--lifecycle-binding', g.grantId);
  const cliResult = runCli(args, { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
  cliResult.mainBinding = g.binding;
  return cliResult;
}

function m6bPublishReadyEvidence(dir, action, roles) {
  return roles.map((role) => {
    const workerSessionId = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const record = {
      schema: 'coordination/worker-presence/v1',
      role: role,
      worker_session_id: workerSessionId,
      worktree_id: action.worktree_id,
      thread_id: 'thread-' + workerSessionId,
      role_profile_digest: rll.roleProfileDigestFor(role),
      pid: process.pid,
      started_at: now.toISOString(),
      lease_expiry: new Date(now.getTime() + 60000).toISOString(),
      heartbeat_at: now.toISOString(),
    };
    const presencePath = path.join(rll.registryRepoDir(dir), 'workers', role, workerSessionId, 'presence.json');
    const written = rll.writeRegistryRecordReplace(presencePath, Buffer.from(JSON.stringify(record), 'utf8'));
    assert.strictEqual(written.ok, true, 'fixture presence must publish: ' + JSON.stringify(written));
    return { role: role, worker_session_id: workerSessionId };
  });
}

function establishRetainedCodexPlane(dir, sessionKey) {
  const ensured = m6bEnsureAllFive(dir, sessionKey);
  assert.strictEqual(ensured.result.status, 'ACTION_REQUIRED', 'fixture: five-role supervisor action must mint: ' + JSON.stringify(ensured.result));
  const found = rll.findActionAcrossRepos(ensured.result.actions[0].action_id);
  assert.strictEqual(found.ok, true, 'fixture: supervisor action lookup must succeed: ' + JSON.stringify(found));
  const action = found.action;
  const actionValidation = rll.validateSupervisorStartAction(action, dir);
  assert.strictEqual(actionValidation.ok, true,
    'fixture: supervisor action must match current project scope: ' + JSON.stringify(actionValidation));
  const repoDescriptor = { repoId: rll.computeRepoId(dir) };
  const claim = rll.mintSupervisorExecutionClaim(repoDescriptor, action, ensured.mainBinding.binding_id, 120);
  assert.strictEqual(claim.ok, true, 'fixture: execution claim must mint: ' + JSON.stringify(claim));
  const evidence = m6bPublishReadyEvidence(dir, action, M6B_FIVE_ROLES.slice().sort());
  const ready = rll.transitionSupervisorBatchToReady(repoDescriptor, action, M6B_FIVE_ROLES.slice().sort(), evidence, rbc.defaultProcessIdentityProvider());
  assert.strictEqual(ready.ok, true, 'fixture: complete support plane must be RETAINED/READY: ' + JSON.stringify(ready));
  const rendezvousInstanceId = crypto.randomBytes(16).toString('hex');
  const supervisorInstanceId = crypto.randomBytes(16).toString('hex');
  for (const role of M6B_FIVE_ROLES) {
    const claimed = rbc.claimRoleOwner(repoDescriptor, rll.computeCoordinationRootId(dir), role, rendezvousInstanceId, supervisorInstanceId, rbc.defaultProcessIdentityProvider());
    assert.strictEqual(claimed.ok, true, 'fixture: process owner must publish for ' + role + ': ' + JSON.stringify(claimed));
  }
  const probe = rbc.resolveLiveCodexAppServerWorker(
    dir, 'arch-platform', rll.roleProfileDigestFor('arch-platform'),
  );
  assert.strictEqual(probe.ok && probe.available, true,
    'fixture: retained Codex plane must resolve immediately: ' + JSON.stringify(probe));
  return { action: action, repoDescriptor: repoDescriptor };
}

// Direct, real (never mocked) role-binding write. driver/state are the ONLY
// two fields s16ResolveMixedReviewPair requester check reads
// (readRoleBindingState + state===READY + record.driver===claude-sendmessage,
// confirmed by direct read of handleRootSource identical pattern), so a
// direct on-disk record is a genuine fixture for that check, not a mock of
// it -- the same idiom runtime-role-lifecycle-statemachine.test.js already
// uses to fixture role-binding STATE directly rather than through the full
// ensure/notify CLI dance this file does not need for the requester side.
function writeClaudeNativeRoleBinding(dir, context, role, state) {
  const profileDigest = rll.roleProfileDigestFor(role);
  const recordPath = rll.roleBindingPathFor(dir, context.worktreeId, context.plan.planDigest, profileDigest, context.generation.generationId, role);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const record = {
    schema: 'runtime/role-binding/v1',
    binding_id: crypto.randomBytes(16).toString('hex'),
    role: role,
    worktree_id: context.worktreeId,
    plan_digest: context.plan.planDigest,
    profile_digest: profileDigest,
    session_generation_id: context.generation.generationId,
    created_at: now,
    updated_at: now,
    driver: 'claude-sendmessage',
    respawn_count: 0,
    state: state,
  };
  fs.writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  return record;
}

// Minimal, real (not mocked) context object -- s16ResolveRetainedPair own
// body (confirmed by direct read, runtime-role-lifecycle.cjs:9975-9997)
// reads only context.repoId/worktreeId/plan.planDigest/generation.generationId
// for its cross-checks, and this dispatch says s16ResolveMixedReviewPair
// mirrors that exact set. Every field below comes from the SAME real,
// independently exported primitives every other test in this codebase uses
// to derive them, never invented values.
function makeContext(dir, sessionKey) {
  return {
    repoId: rll.computeRepoId(dir),
    worktreeId: rll.computeWorktreeId(dir),
    plan: { planDigest: rll.discoverPlan(dir).planDigest },
    generation: { generationId: rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId },
    binding: { actor_instance_id: crypto.randomBytes(16).toString("hex") },
    // Real (not hand-fabricated) resolvePolicyPair() result -- s16ResolveMixedReviewPair
    // re-checks context.pair.routing.routes[targetRole] on every call (structural
    // guarantee per s16ResolveMainContext, confirmed by direct read), so a fixture
    // without a genuine .pair is an invalid context, not a valid minimal one.
    pair: rll.resolvePolicyPair(dir),
  };
}

// ==================== ARTIFACT A: s16ResolveMixedReviewPair ====================
// Requester side fixtured via a direct real role-binding write (see
// writeClaudeNativeRoleBinding above). Target side fixtured via a full real
// retained Codex plane (establishRetainedCodexPlane) -- supervisor-start is
// inherently batched for the whole 5-role support-plane set, so this is the
// lightest genuinely-real fixture available for a single live target role.
// Export name assumed __testOnlyS16ResolveMixedReviewPair, mirroring this
// codebase own established __testOnly<FunctionName> convention throughout --
// pending confirmation.

describe('Artifact A: s16ResolveMixedReviewPair', () => {
  test('export exists (RED until toolkit-specialist companion dispatch lands)', () => {
    assert.strictEqual(typeof rll.__testOnlyS16ResolveMixedReviewPair, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
  });

  test('self-review (requesterRole===targetRole) is rejected with mixed-review-self-review-rejected before any binding/target lookup', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-self-review-');
    try {
      writePlanFixture(dir, 'mrlw-a-self-review');
      const sessionKey = 'mrlw-a-self-review-session';
      const context = makeContext(dir, sessionKey);
      const result = fn(dir, context, 'arch-platform', 'arch-platform');
      assert.deepStrictEqual(result, { ok: false, reason: 'mixed-review-self-review-rejected' });
    } finally {
      cleanup(dir);
    }
  });

  test('MRW-REJECTREASON a retained-pair rejection names its reason on stderr', () => {
    // Live P5 attempt N7 reached mixed-review-request and it exited 4. The closed envelope on
    // stdout carries detail_code CAPABILITY_UNAVAILABLE, which is equally true of all seven
    // rejections this resolver distinguishes, and the reason was dropped at the call site -- so the
    // run reported that something was unavailable without saying what. The envelope's schema is
    // frozen and its detail_code vocabulary is closed, so the reason goes to stderr, which is not
    // part of the ABI; stdout stays byte-identical.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'runtime-role-lifecycle', 'cli-envelope.cjs'), 'utf8',
    );
    const helperAt = source.indexOf('function reportRetainedPairRejection(');
    assert.ok(helperAt > 0, 'the lifecycle CLI must report a retained-pair rejection');
    const helper = source.slice(helperAt, source.indexOf('\nfunction ', helperAt + 1));
    assert.ok(/process\.stderr\.write\(/.test(helper), 'the reason must go to stderr');
    assert.ok(!/process\.stdout\.write\(/.test(helper),
      'the frozen stdout envelope must not be touched');
    assert.ok(/'no-reason-reported'/.test(helper), 'a missing reason must be reported as such');
    assert.ok(/catch \(err\) \{/.test(helper),
      'a diagnostic must never be able to change the outcome it is describing');

    // Both call sites report before emitting their ordinary envelope. handleConsultRoot and
    // handleMixedReviewRequest now live in cli-consult-handlers.cjs (see that module's own
    // header comment).
    const consultSource = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'runtime-role-lifecycle', 'cli-consult-handlers.cjs'), 'utf8',
    );
    for (const command of ['consult-root', 'mixed-review-request']) {
      const reportCall = `reportRetainedPairRejection('${command}', retained);`;
      const emitCall = `unavailableError('${command}', 'CAPABILITY_UNAVAILABLE');`;
      const reportAt = consultSource.indexOf(reportCall);
      const emitAt = consultSource.indexOf(emitCall);
      assert.ok(reportAt > 0, command + ' must report its rejection reason');
      assert.ok(emitAt > reportAt && emitAt - reportAt < 80,
        command + ' must report immediately before emitting CAPABILITY_UNAVAILABLE');
    }
  });

  // The refusal reason names the actual fact. It used to collapse an unreadable binding, an unusable
  // state and the wrong driver into one label, which made live attempt N12's refusal unattributable
  // (PLAN item 48). The behaviour asserted here is unchanged -- each case is still refused -- and
  // each now says which of the three it was.
  test('requester binding absent is rejected, naming the absent state', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-requester-absent-');
    try {
      writePlanFixture(dir, 'mrlw-a-requester-absent');
      const sessionKey = 'mrlw-a-requester-absent-session';
      const context = makeContext(dir, sessionKey);
      const result = fn(dir, context, 'arch-testing', 'arch-platform');
      assert.deepStrictEqual(result, { ok: false, reason: 'mixed-review-requester-not-healthy-absent' });
    } finally {
      cleanup(dir);
    }
  });

  // This fixture's STARTING record is deliberately minimal, and the binding reader refuses it rather
  // than classifying it -- a STARTING binding carries obligations (its pending action) that a
  // hand-written stub does not satisfy. So what this case actually proves is that a requester whose
  // record does not read back cleanly is refused, and now says exactly that. The usable-state path
  // is covered by the sibling absent case and by P5SP-REQUESTER-PARKED's WAITING and DEAD fixtures.
  test('requester binding that does not read back cleanly is rejected, naming that', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-requester-starting-');
    try {
      writePlanFixture(dir, 'mrlw-a-requester-starting');
      const sessionKey = 'mrlw-a-requester-starting-session';
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'STARTING');
      const result = fn(dir, context, 'arch-testing', 'arch-platform');
      assert.deepStrictEqual(result, { ok: false, reason: 'mixed-review-requester-binding-unreadable' });
    } finally {
      cleanup(dir);
    }
  });

  test('requester binding READY but wrong driver (codex-app-server) is rejected with mixed-review-requester-not-claude-native', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-requester-wrongdriver-');
    try {
      writePlanFixture(dir, 'mrlw-a-requester-wrongdriver');
      const sessionKey = 'mrlw-a-requester-wrongdriver-session';
      const context = makeContext(dir, sessionKey);
      const binding = writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const profileDigest = rll.roleProfileDigestFor('arch-testing');
      const recordPath = rll.roleBindingPathFor(dir, context.worktreeId, context.plan.planDigest, profileDigest, context.generation.generationId, 'arch-testing');
      fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, binding, { driver: 'codex-app-server' })), { mode: 0o600 });
      const result = fn(dir, context, 'arch-testing', 'arch-platform');
      assert.deepStrictEqual(result, { ok: false, reason: 'mixed-review-requester-not-claude-native' });
    } finally {
      cleanup(dir);
    }
  });

  test('target unavailable (no retained plane at all) is rejected mirroring s16ResolveRetainedPair own reason', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-target-unavailable-');
    try {
      writePlanFixture(dir, 'mrlw-a-target-unavailable');
      const sessionKey = 'mrlw-a-target-unavailable-session';
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const result = fn(dir, context, 'arch-testing', 'arch-platform');
      assert.deepStrictEqual(result, { ok: false, reason: 'root-consult-retained-worker-unavailable' });
    } finally {
      cleanup(dir);
    }
  });

  test('target owner-mismatch (live worker but a fabricated context that does not match its real identity) is rejected mirroring s16ResolveRetainedPair own reason', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-target-mismatch-');
    try {
      writePlanFixture(dir, 'mrlw-a-target-mismatch');
      const sessionKey = 'mrlw-a-target-mismatch-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const realContext = makeContext(dir, sessionKey);
      const fabricatedContext = Object.assign({}, realContext, { worktreeId: 'f'.repeat(64) });
      writeClaudeNativeRoleBinding(dir, fabricatedContext, 'arch-testing', 'READY');
      const result = fn(dir, fabricatedContext, 'arch-testing', 'arch-platform');
      assert.deepStrictEqual(result, { ok: false, reason: 'root-consult-retained-owner-mismatch' });
    } finally {
      cleanup(dir);
    }
  });

  test('success: a genuinely eligible requester and a genuinely live matching target return ok:true with requesterBinding and target', () => {
    const fn = rll.__testOnlyS16ResolveMixedReviewPair;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyS16ResolveMixedReviewPair');
    const dir = makeGitProject('rll-mrlw-a-success-');
    try {
      writePlanFixture(dir, 'mrlw-a-success');
      const sessionKey = 'mrlw-a-success-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const context = makeContext(dir, sessionKey);
      const requesterBinding = writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const result = fn(dir, context, 'arch-testing', 'arch-platform');
      assert.strictEqual(result.ok, true, 'expected ok:true, got: ' + JSON.stringify(result));
      assert.strictEqual(result.requesterBindingId, requesterBinding.binding_id, 'requesterBindingId must be the real requester role-binding own binding_id (locked shape, confirmed directly with toolkit-specialist)');
      assert.strictEqual(result.requesterActorInstanceId, context.binding.actor_instance_id, 'requesterActorInstanceId must be context.binding.actor_instance_id (locked shape, confirmed directly with toolkit-specialist)');
      assert.ok(result.target, 'expected a truthy target field: ' + JSON.stringify(result));
      assert.strictEqual(result.target.worktreeId, context.worktreeId);
      assert.strictEqual(result.target.planDigest, context.plan.planDigest);
      assert.strictEqual(result.target.sessionGenerationId, context.generation.generationId);
    } finally {
      cleanup(dir);
    }
  });
});

// ==================== ARTIFACT B: executeMixedReviewRequest (signature fix) ====================
// The fixed bug: the OLD signature took (projectRoot, context, requesterRole,
// targetRole, question, reviewedHead, subjectText) and internally called
// s16ResolveRetainedPair to resolve its own worker -- that resolved object
// is disk-metadata (from resolveLiveCodexAppServerWorker) with no
// .connection, so any real call would crash reaching for
// worker.connection.turnStart(...). The fix (confirmed by direct read,
// runtime-bridge-codex.cjs) removes that internal resolution entirely: the
// NEW signature (worker, intentRecord, coordinationRootReal, subjectText)
// receives an already-live worker directly and uses it throughout, never
// re-deriving one. Two proofs below: a structural one (the function body
// itself can no longer even reference the old resolution calls, so the bug
// class is impossible by construction) and a dynamic one (a fake worker
// with a stub connection drives the function without an uncaught crash).

function isolateFunctionBody(sourcePath, functionName) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line.startsWith('function ' + functionName + '(') || line.startsWith('async function ' + functionName + '('));
  if (startIdx < 0) return null;
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length && i - startIdx <= 500; i++) {
    if (lines[i] === '}') { endIdx = i; break; }
  }
  if (endIdx < 0) return null;
  return lines.slice(startIdx, endIdx + 1).join('\n');
}

// Sequence 15: executeMixedReviewRequest was relocated out of the facade
// into its own extracted module -- see that module's own header comment.
const ROOT_MIXED_REVIEW_SOURCE_PATH = path.resolve(__dirname, '../lib/runtime-bridge-codex/root-mixed-review.cjs');

describe('Artifact B: executeMixedReviewRequest (fixed signature, no internal re-resolution)', () => {
  test('export exists (RED until toolkit-specialist companion dispatch lands)', () => {
    assert.strictEqual(typeof rbc.__testOnlyExecuteMixedReviewRequest, 'function', 'export-missing:__testOnlyExecuteMixedReviewRequest');
  });

  test('structural: the function own body never references s16ResolveRetainedPair or resolveLiveCodexAppServerWorker (the bug class is impossible by construction, not just avoided at runtime)', () => {
    const body = isolateFunctionBody(ROOT_MIXED_REVIEW_SOURCE_PATH, 'executeMixedReviewRequest');
    assert.ok(body, 'could not isolate executeMixedReviewRequest own body via the real on-disk source -- function-not-found or body exceeds the 500-line isolation window');
    assert.ok(!body.includes('s16ResolveRetainedPair'), 'executeMixedReviewRequest own body still references s16ResolveRetainedPair -- the internal re-resolution regression may have returned');
    assert.ok(!body.includes('resolveLiveCodexAppServerWorker'), 'executeMixedReviewRequest own body still references resolveLiveCodexAppServerWorker directly -- the internal re-resolution regression may have returned');
  });

  test('dynamic: a fake worker with a stub connection drives the function without an uncaught crash or an undefined-connection-access failure', async () => {
    const fn = rbc.__testOnlyExecuteMixedReviewRequest;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyExecuteMixedReviewRequest');
    const stubConnection = new Proxy({}, {
      get(target, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return (...args) => Promise.resolve(undefined);
      },
    });
    const fakeWorker = {
      role: 'arch-platform',
      threadId: null,
      connection: stubConnection,
      repoDescriptor: { repoId: 'fake-repo-id-for-artifact-b-regression-test' },
    };
    const fakeIntentRecord = {
      intent_id: crypto.randomBytes(16).toString('hex'),
      request_id: crypto.randomBytes(16).toString('hex'),
      initial_attempt_id: crypto.randomBytes(16).toString('hex'),
      request_expiry: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      main_binding_id: crypto.randomBytes(16).toString('hex'),
      requester_actor_instance_id: crypto.randomBytes(16).toString('hex'),
      session_generation_id: crypto.randomBytes(16).toString('hex'),
      subject_head: '0123456789abcdef0123456789abcdef01234567',
      subject_bundle_ref: 'subject-bundles/' + 'a'.repeat(64) + '/manifest.json',
      subject_scope_digest: 'b'.repeat(64),
      question: 'q',
    };
    let result;
    let threw = null;
    try {
      result = await fn(fakeWorker, fakeIntentRecord, '/fake/coordination/root', 'fake subject text');
    } catch (err) {
      threw = err;
    }
    assert.strictEqual(threw, null, 'executeMixedReviewRequest must never throw uncaught, even against a stub worker -- its own try/catch/finally must convert any internal failure into a clean {ok:false,reason} return: ' + (threw && (threw.stack || threw.message)));
    assert.strictEqual(result.ok, false, 'expected a clean ok:false against a stub worker/coordination root (no real Codex backend), got: ' + JSON.stringify(result));
    assert.ok(!/cannot read propert/i.test(String(result.reason)), 'result.reason must never surface a raw undefined-property-access message -- that is the exact old-bug signature (worker.connection.turnStart on a disk-metadata-only object): ' + JSON.stringify(result));
  });
});

// ==================== ARTIFACT C: handleMixedReviewRequest CLI subcommand ====================
// Tested via real CLI subprocess spawning (runCli), never __testOnlyHandleMixedReviewRequest
// called directly in-process -- every handler in this family (handleConsultRoot
// and siblings) exits via emitAndExit/invalidError/usageError/unavailableError,
// the same pattern runtime-role-lifecycle-handlers.test.js already tests
// exclusively through real subprocess spawning, never a direct in-process
// call, for exactly this reason.

function encodeMixedReviewIntent(intent) {
  return Buffer.from(rc.canonicalJSONStringify(intent), 'utf8').toString('base64url');
}
function mixedReviewRequestDigest(encodedIntent) {
  return rc.sha256String('mixed-review-request:' + encodedIntent);
}
function writeSubjectTextFile(dir, text) {
  const filePath = path.join(dir, 'mrlw-subject-text-' + crypto.randomBytes(8).toString('hex') + '.txt');
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
}

// mixed-review-request needs a longer binding TTL than ensure/ready fixtures
// use: s16ResolveMainContext (requireCreationLifetime:true, mirroring
// handleConsultRoot) requires >=120s REMAINING at CHECK time, not mint time --
// by the time grant validation + session-generation lookup + subprocess spawn
// overhead elapse, a 120s-TTL binding falls just under that floor and fails
// closed with a generic IDENTITY_MISMATCH (root-cause confirmed directly with
// toolkit-specialist, empirically reproduced and fixed). 300s gives headroom.
function mintMixedReviewRequestGrant(dir, sessionKey, requesterRole, argvDigest) {
  return mintGrant(dir, sessionKey, requesterRole, 'mixed-review-request', argvDigest, {
    bindingKind: 'main-orchestrator', authority: 'orchestrator', profile: 'normal', bindingTtlSeconds: 300,
  });
}

function runMixedReviewRequest(dir, sessionKey, requesterRole, targetRole, subjectText, overrides) {
  const intentInput = Object.assign({
    question: 'q', requester_role: requesterRole,
    reviewed_head: '0123456789abcdef0123456789abcdef01234567', target_role: targetRole,
  }, overrides || {});
  const encodedIntent = encodeMixedReviewIntent(intentInput);
  const subjectFile = writeSubjectTextFile(dir, subjectText);
  const argvDigest = mixedReviewRequestDigest(encodedIntent);
  const g = mintMixedReviewRequestGrant(dir, sessionKey, requesterRole, argvDigest);
  return runCli(['mixed-review-request', '--project-root', dir, '--intent', encodedIntent, '--subject-text-file', subjectFile, '--lifecycle-binding', g.grantId]);
}

describe('Artifact C: handleMixedReviewRequest (CLI subcommand, argv/intent/subject-file validation)', () => {
  test('export exists (RED until toolkit-specialist companion dispatch lands)', () => {
    assert.strictEqual(typeof rll.__testOnlyHandleMixedReviewRequest, 'function', 'export-missing:__testOnlyHandleMixedReviewRequest');
  });

  test('decodeMixedReviewIntent: encoding/json/key-set failures each produce their own distinct reason (empirically confirmed via direct probing)', () => {
    const fn = rll.__testOnlyDecodeMixedReviewIntent;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyDecodeMixedReviewIntent');
    const validBase = { question: 'q', requester_role: 'arch-testing', reviewed_head: '0123456789abcdef0123456789abcdef01234567', target_role: 'arch-platform' };
    assert.deepStrictEqual(fn('not-valid-base64!!!'), { ok: false, reason: 'intent-encoding-invalid' });
    assert.deepStrictEqual(fn(Buffer.from('not json', 'utf8').toString('base64url')), { ok: false, reason: 'intent-json-invalid' });
    assert.deepStrictEqual(fn(encodeMixedReviewIntent('a string not an object')), { ok: false, reason: 'intent-key-set-invalid' });
    assert.deepStrictEqual(fn(encodeMixedReviewIntent({})), { ok: false, reason: 'intent-key-set-invalid' });
    assert.deepStrictEqual(fn(encodeMixedReviewIntent(Object.assign({}, validBase, { extra_key: 'x' }))), { ok: false, reason: 'intent-key-set-invalid' });
    assert.deepStrictEqual(fn(encodeMixedReviewIntent(validBase)), { ok: true, intent: validBase });
  });

  test('decodeMixedReviewIntent: each semantic validation rule independently triggers mixed-review-intent-invalid (bad requester_role, bad target_role, self-review, empty question, bad reviewed_head format)', () => {
    const fn = rll.__testOnlyDecodeMixedReviewIntent;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyDecodeMixedReviewIntent');
    const validBase = { question: 'q', requester_role: 'arch-testing', reviewed_head: '0123456789abcdef0123456789abcdef01234567', target_role: 'arch-platform' };
    const badVariants = {
      'requester_role not a canonical role': Object.assign({}, validBase, { requester_role: 'not-a-real-role' }),
      'target_role not a canonical role': Object.assign({}, validBase, { target_role: 'not-a-real-role' }),
      'self-review (requester_role===target_role)': Object.assign({}, validBase, { target_role: 'arch-testing' }),
      'empty question': Object.assign({}, validBase, { question: '' }),
      'reviewed_head too short': Object.assign({}, validBase, { reviewed_head: 'too-short' }),
      'reviewed_head uppercase hex': Object.assign({}, validBase, { reviewed_head: '0123456789ABCDEF0123456789ABCDEF01234567' }),
    };
    for (const label of Object.keys(badVariants)) {
      const result = fn(encodeMixedReviewIntent(badVariants[label]));
      assert.deepStrictEqual(result, { ok: false, reason: 'mixed-review-intent-invalid' }, label + ': ' + JSON.stringify(result));
    }
  });

  test('argv parsing: missing or relative --project-root is rejected as a usage error (code 2, detail_code NONE)', () => {
    const dir = makeGitProject('rll-mrlw-c-argv-project-root-');
    try {
      writePlanFixture(dir, 'mrlw-c-argv-project-root');
      const r1 = runCli(['mixed-review-request', '--intent', 'x', '--subject-text-file', '/tmp/x']);
      assert.strictEqual(r1.status, 2, 'missing --project-root: ' + JSON.stringify(r1.result));
      assert.strictEqual(r1.result.status, 'INVALID');
      assert.strictEqual(r1.result.code, 2);
      assert.strictEqual(r1.result.detail_code, 'NONE');
      const r2 = runCli(['mixed-review-request', '--project-root', 'relative/path', '--intent', 'x', '--subject-text-file', '/tmp/x']);
      assert.strictEqual(r2.status, 2, 'relative --project-root: ' + JSON.stringify(r2.result));
      assert.strictEqual(r2.result.code, 2);
    } finally {
      cleanup(dir);
    }
  });

  test('argv parsing: relative --subject-text-file is rejected as a usage error (code 2), distinct from the subject-file CONTENT checks below', () => {
    const dir = makeGitProject('rll-mrlw-c-argv-subject-path-');
    try {
      writePlanFixture(dir, 'mrlw-c-argv-subject-path');
      const validIntent = encodeMixedReviewIntent({ question: 'q', requester_role: 'arch-testing', reviewed_head: '0123456789abcdef0123456789abcdef01234567', target_role: 'arch-platform' });
      const r = runCli(['mixed-review-request', '--project-root', dir, '--intent', validIntent, '--subject-text-file', 'relative.txt']);
      assert.strictEqual(r.status, 2, JSON.stringify(r.result));
      assert.strictEqual(r.result.code, 2);
      assert.strictEqual(r.result.detail_code, 'NONE');
    } finally {
      cleanup(dir);
    }
  });

  test('intent decoding: malformed --intent (invalid base64url/JSON) is rejected as POLICY_INVALID (code 3)', () => {
    const dir = makeGitProject('rll-mrlw-c-bad-intent-encoding-');
    try {
      writePlanFixture(dir, 'mrlw-c-bad-intent-encoding');
      const subjectFile = writeSubjectTextFile(dir, 'subject text');
      const r = runCli(['mixed-review-request', '--project-root', dir, '--intent', 'not-valid-base64url-json!!!', '--subject-text-file', subjectFile]);
      assert.strictEqual(r.status, 3, JSON.stringify(r.result));
      assert.strictEqual(r.result.status, 'INVALID');
      assert.strictEqual(r.result.code, 3);
      assert.strictEqual(r.result.detail_code, 'POLICY_INVALID');
    } finally {
      cleanup(dir);
    }
  });

  test('intent decoding: a well-formed but incomplete intent object (missing required keys) is rejected as POLICY_INVALID', () => {
    const dir = makeGitProject('rll-mrlw-c-incomplete-intent-');
    try {
      writePlanFixture(dir, 'mrlw-c-incomplete-intent');
      const subjectFile = writeSubjectTextFile(dir, 'subject text');
      const emptyIntent = encodeMixedReviewIntent({});
      const r = runCli(['mixed-review-request', '--project-root', dir, '--intent', emptyIntent, '--subject-text-file', subjectFile]);
      assert.strictEqual(r.status, 3, JSON.stringify(r.result));
      assert.strictEqual(r.result.detail_code, 'POLICY_INVALID');
    } finally {
      cleanup(dir);
    }
  });

  test('subject-text-file content: missing, oversized, empty, and invalid-UTF8 are each rejected as POLICY_INVALID, never crashing or silently truncating', () => {
    const dir = makeGitProject('rll-mrlw-c-subject-content-');
    try {
      writePlanFixture(dir, 'mrlw-c-subject-content');
      const validIntent = encodeMixedReviewIntent({ question: 'q', requester_role: 'arch-testing', reviewed_head: '0123456789abcdef0123456789abcdef01234567', target_role: 'arch-platform' });

      const missingFile = path.join(dir, 'does-not-exist.txt');
      const rMissing = runCli(['mixed-review-request', '--project-root', dir, '--intent', validIntent, '--subject-text-file', missingFile]);
      assert.strictEqual(rMissing.status, 3, 'missing subject file: ' + JSON.stringify(rMissing.result));
      assert.strictEqual(rMissing.result.detail_code, 'POLICY_INVALID');

      const oversizedFile = path.join(dir, 'oversized.txt');
      fs.writeFileSync(oversizedFile, 'x'.repeat(65537), 'utf8');
      const rOversized = runCli(['mixed-review-request', '--project-root', dir, '--intent', validIntent, '--subject-text-file', oversizedFile]);
      assert.strictEqual(rOversized.status, 3, 'oversized subject file: ' + JSON.stringify(rOversized.result));
      assert.strictEqual(rOversized.result.detail_code, 'POLICY_INVALID');

      const emptyFile = path.join(dir, 'empty.txt');
      fs.writeFileSync(emptyFile, '', 'utf8');
      const rEmpty = runCli(['mixed-review-request', '--project-root', dir, '--intent', validIntent, '--subject-text-file', emptyFile]);
      assert.strictEqual(rEmpty.status, 3, 'empty subject file: ' + JSON.stringify(rEmpty.result));
      assert.strictEqual(rEmpty.result.detail_code, 'POLICY_INVALID');

      const invalidUtf8File = path.join(dir, 'invalid-utf8.txt');
      fs.writeFileSync(invalidUtf8File, Buffer.from([0xff, 0xfe, 0xfd]));
      const rInvalidUtf8 = runCli(['mixed-review-request', '--project-root', dir, '--intent', validIntent, '--subject-text-file', invalidUtf8File]);
      assert.strictEqual(rInvalidUtf8.status, 3, 'invalid-UTF8 subject file: ' + JSON.stringify(rInvalidUtf8.result));
      assert.strictEqual(rInvalidUtf8.result.detail_code, 'POLICY_INVALID');
    } finally {
      cleanup(dir);
    }
  });

  test('boundary: a subject-text-file at exactly 65536 bytes is not rejected by the oversized check (proceeds past it, whatever happens downstream)', () => {
    const dir = makeGitProject('rll-mrlw-c-subject-boundary-');
    try {
      writePlanFixture(dir, 'mrlw-c-subject-boundary');
      const validIntent = encodeMixedReviewIntent({ question: 'q', requester_role: 'arch-testing', reviewed_head: '0123456789abcdef0123456789abcdef01234567', target_role: 'arch-platform' });
      const atCapFile = path.join(dir, 'at-cap.txt');
      const atCapText = 'x'.repeat(65536);
      assert.strictEqual(Buffer.byteLength(atCapText, 'utf8'), 65536, 'test setup invariant: fixture must be exactly at the cap, not over');
      fs.writeFileSync(atCapFile, atCapText, 'utf8');
      const r = runCli(['mixed-review-request', '--project-root', dir, '--intent', validIntent, '--subject-text-file', atCapFile]);
      // No grant was minted, so this fails downstream at context resolution
      // (IDENTITY_MISMATCH, confirmed empirically) -- both that and the
      // oversized-file rejection share code:3/status:INVALID, so the
      // discriminating assertion is on detail_code specifically, not code.
      assert.notStrictEqual(r.result.detail_code, 'POLICY_INVALID', 'boundary case (exactly 65536 bytes) must not be rejected as oversized -- only strictly-over should trigger POLICY_INVALID at the file-content stage: ' + JSON.stringify(r.result));
    } finally {
      cleanup(dir);
    }
  });

  test('requester-not-claude-native rejection: a real CLI call with no requester binding set up is rejected as CAPABILITY_UNAVAILABLE', () => {
    const dir = makeGitProject('rll-mrlw-c-requester-unavail-');
    try {
      writePlanFixture(dir, 'mrlw-c-requester-unavail');
      const sessionKey = 'mrlw-c-requester-unavail-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const r = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-platform', 'subject text');
      assert.strictEqual(r.status, 4, JSON.stringify(r.result));
      assert.strictEqual(r.result.status, 'UNAVAILABLE');
      assert.strictEqual(r.result.code, 4);
      assert.strictEqual(r.result.detail_code, 'CAPABILITY_UNAVAILABLE');
    } finally {
      cleanup(dir);
    }
  });

  test('target-unavailable rejection: a real CLI call with a valid requester but no retained target plane is rejected as CAPABILITY_UNAVAILABLE', () => {
    const dir = makeGitProject('rll-mrlw-c-target-unavail-');
    try {
      writePlanFixture(dir, 'mrlw-c-target-unavail');
      const sessionKey = 'mrlw-c-target-unavail-session';
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const r = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-platform', 'subject text');
      assert.strictEqual(r.status, 4, JSON.stringify(r.result));
      assert.strictEqual(r.result.detail_code, 'CAPABILITY_UNAVAILABLE');
    } finally {
      cleanup(dir);
    }
  });

  test('successful publish + WAITING emission, and the subjectText blob lands at the intentId-keyed path byte-identical on read-back', () => {
    const dir = makeGitProject('rll-mrlw-c-success-');
    try {
      writePlanFixture(dir, 'mrlw-c-success');
      const sessionKey = 'mrlw-c-success-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const subjectText = 'success case subject text ' + crypto.randomBytes(4).toString('hex');
      const r = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-platform', subjectText);
      assert.strictEqual(r.status, 0, JSON.stringify(r.result));
      assert.strictEqual(r.result.ok, true);
      assert.strictEqual(r.result.status, 'WAITING');
      assert.strictEqual(r.result.code, 0);
      assert.strictEqual(r.result.detail_code, 'NONE');
      assert.ok(r.result.operation, JSON.stringify(r.result));
      assert.strictEqual(r.result.operation.kind, 'mixed-review-request');
      assert.strictEqual(r.result.operation.state, 'WAITING');
      const intentId = r.result.operation.operation_id;
      assert.match(intentId, /^[0-9a-f]{32}$/, 'operation_id must be the 32-hex intentId: ' + JSON.stringify(r.result));

      const repoDescriptor = { repoId: rll.computeRepoId(dir) };
      const subjectPath = rll.mixedReviewSubjectPathFor(repoDescriptor, intentId);
      const blobRead = rll.readRegistryRecord(subjectPath);
      assert.strictEqual(blobRead.ok, true, JSON.stringify(blobRead));
      assert.ok(blobRead.obj, 'subject blob must exist (obj truthy) at the intentId-keyed path: ' + subjectPath + ' got: ' + JSON.stringify(blobRead));
      assert.strictEqual(blobRead.obj.schema, 'runtime/mixed-review-subject/v1');
      assert.strictEqual(blobRead.obj.text, subjectText, 'subject blob text must be byte-identical to the original on read-back');
      assert.strictEqual(blobRead.obj.digest, rc.sha256String(subjectText), 'subject blob digest must be a genuine sha256 of its own text');
    } finally {
      cleanup(dir);
    }
  });
});

// ==================== ARTIFACT D: collectPendingMixedReviewRequest (poll-loop hook) ====================
// Sibling to (never a modification of) the existing P2 collection closure
// inside pollRetainedWorkers's own loop -- confirmed additive by direct read
// plus an independent byte-identity diff of the surrounding P2 block against
// the original committed HEAD (see this task own report). Pending intents
// fixtured via the REAL, now-working mixed-review-request CLI flow (Artifact
// C), never hand-fabricated -- a genuinely valid ~29-field intent record is
// exactly what a real caller would have published.

function makeFakeWorker(overrides) {
  return Object.assign({
    role: 'arch-platform',
    repoDescriptor: null,
    activePromise: null,
    activeRequestId: null,
    connection: new Proxy({}, { get: (t, p) => (typeof p === 'symbol' || p === 'then' ? undefined : (...a) => Promise.resolve(undefined)) }),
    threadId: null,
  }, overrides || {});
}

describe('Artifact D: collectPendingMixedReviewRequest (poll-loop hook, sibling to P2 collection)', () => {
  test('export exists (RED until toolkit-specialist companion dispatch lands)', () => {
    assert.strictEqual(typeof rbc.__testOnlyCollectPendingMixedReviewRequest, 'function', 'export-missing:__testOnlyCollectPendingMixedReviewRequest');
  });

  test('context-provider role is always a no-op, even with zero setup (checked before any scan)', () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyCollectPendingMixedReviewRequest');
    const sentinel = Promise.resolve('sentinel').catch(() => {});
    const worker = makeFakeWorker({ role: 'context-provider', repoDescriptor: { repoId: 'fake-repo-id' }, activePromise: sentinel });
    fn(worker, '/fake/coordination/root');
    assert.strictEqual(worker.activePromise, sentinel, 'context-provider must return immediately, never touching activePromise');
  });

  test('an nlink=2 mixed-review intent is deferred to the next poll without weakening other read failures', () => {
    const repoDescriptor = { repoId: crypto.randomBytes(32).toString('hex') };
    const intentDir = path.join(rll.registryRepoDir(repoDescriptor), 'root-consult-intents');
    const intentId = crypto.randomBytes(16).toString('hex');
    const intentPath = path.join(intentDir, intentId + '.json');
    const ownerTemp = path.join(intentDir, '.' + intentId + '.pending-test.tmp-owner');
    try {
      fs.mkdirSync(intentDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(ownerTemp, '{}\n', { mode: 0o600 });
      fs.linkSync(ownerTemp, intentPath);
      assert.deepStrictEqual(
        rll.listPendingMixedReviewIntentsForRole(repoDescriptor, 'arch-platform'),
        { ok: true, intents: [] },
        'the explicit durable PENDING state is not a completed intent and must be retried by a later poll',
      );
      fs.unlinkSync(ownerTemp);
      fs.writeFileSync(intentPath, '{malformed', { mode: 0o600 });
      const corrupt = rll.listPendingMixedReviewIntentsForRole(repoDescriptor, 'arch-platform');
      assert.strictEqual(corrupt.ok, false, 'a stable malformed record must remain fail-closed');
      assert.notStrictEqual(corrupt.reason, 'pending', 'corruption must never be relabelled as the transient publication state');
    } finally {
      fs.rmSync(rll.registryRepoDir(repoDescriptor), { recursive: true, force: true });
    }
  });

  test('a pending subject blob defers dispatch, while a non-pending read failure still stops the worker', () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    const originalList = rll.listPendingMixedReviewIntentsForRole;
    const originalRead = rll.readRegistryRecord;
    const worker = makeFakeWorker({ repoDescriptor: { repoId: crypto.randomBytes(32).toString('hex') } });
    try {
      rll.listPendingMixedReviewIntentsForRole = () => ({ ok: true, intents: [{ intent_id: crypto.randomBytes(16).toString('hex') }] });
      rll.readRegistryRecord = () => ({ ok: false, reason: 'pending' });
      fn(worker, '/fake/coordination/root');
      assert.strictEqual(worker.activePromise, null, 'a subject still being durably published must be retried, never dispatched early');

      rll.readRegistryRecord = () => ({ ok: false, reason: 'SECURITY_INVALID' });
      assert.throws(() => fn(worker, '/fake/coordination/root'), /SECURITY_INVALID/, 'stable security failures must remain fail-closed');
    } finally {
      rll.listPendingMixedReviewIntentsForRole = originalList;
      rll.readRegistryRecord = originalRead;
    }
  });

  test('a rejected dispatch reports through the injected supervisor callback without a free-variable failure', async () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    const originalList = rll.listPendingMixedReviewIntentsForRole;
    const originalRead = rll.readRegistryRecord;
    const worker = makeFakeWorker({ repoDescriptor: { repoId: crypto.randomBytes(32).toString('hex') } });
    const text = 'rejected dispatch subject';
    let reported = null;
    try {
      rll.listPendingMixedReviewIntentsForRole = () => ({
        ok: true,
        intents: [{ intent_id: crypto.randomBytes(16).toString('hex') }],
      });
      rll.readRegistryRecord = () => ({
        ok: true,
        absent: false,
        obj: {
          schema: 'runtime/mixed-review-subject/v1',
          text,
          digest: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
        },
      });
      fn(
        worker,
        '/fake/coordination/root',
        (error) => { reported = error; },
        () => Promise.reject(new Error('synthetic-dispatch-failure')),
      );
      assert.ok(worker.activePromise, 'the rejected request must still enter the single-flight slot');
      await worker.activePromise;
      assert.strictEqual(reported && reported.message, 'synthetic-dispatch-failure');
      assert.strictEqual(worker.activePromise, null, 'finally must release the single-flight slot');
    } finally {
      rll.listPendingMixedReviewIntentsForRole = originalList;
      rll.readRegistryRecord = originalRead;
    }
  });

  test('single-flight guard: worker.activePromise!==null skips dispatch even with exactly one matching pending intent', () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyCollectPendingMixedReviewRequest');
    const dir = makeGitProject('rll-mrlw-d-single-flight-');
    try {
      writePlanFixture(dir, 'mrlw-d-single-flight');
      const sessionKey = 'mrlw-d-single-flight-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const r = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-platform', 'single-flight subject text');
      assert.strictEqual(r.result.ok, true, 'fixture: publish must succeed: ' + JSON.stringify(r.result));

      const sentinel = Promise.resolve('sentinel').catch(() => {});
      const worker = makeFakeWorker({ role: 'arch-platform', repoDescriptor: { repoId: context.repoId }, activePromise: sentinel });
      fn(worker, rll.coordinationRootPathFor(dir));
      assert.strictEqual(worker.activePromise, sentinel, 'a worker already mid-turn must never have its activePromise replaced, even with a genuinely eligible pending intent waiting');
    } finally {
      cleanup(dir);
    }
  });

  test('ambiguous-multiple-pending: two pending intents for the SAME target role throws mixed-review-pending-ambiguous', () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyCollectPendingMixedReviewRequest');
    const dir = makeGitProject('rll-mrlw-d-ambiguous-');
    try {
      writePlanFixture(dir, 'mrlw-d-ambiguous');
      const sessionKey = 'mrlw-d-ambiguous-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      writeClaudeNativeRoleBinding(dir, context, 'arch-integration', 'READY');
      const r1 = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-platform', 'ambiguous subject 1');
      assert.strictEqual(r1.result.ok, true, 'fixture: first publish must succeed: ' + JSON.stringify(r1.result));
      const r2 = runMixedReviewRequest(dir, sessionKey, 'arch-integration', 'arch-platform', 'ambiguous subject 2');
      assert.strictEqual(r2.result.ok, true, 'fixture: second publish must succeed: ' + JSON.stringify(r2.result));

      const worker = makeFakeWorker({ role: 'arch-platform', repoDescriptor: { repoId: context.repoId }, activePromise: null });
      assert.throws(() => fn(worker, rll.coordinationRootPathFor(dir)), /mixed-review-pending-ambiguous/);
    } finally {
      cleanup(dir);
    }
  });

  test('role filtering: a pending intent addressed to a DIFFERENT target role is never picked up by this worker own iteration', () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyCollectPendingMixedReviewRequest');
    const dir = makeGitProject('rll-mrlw-d-role-filter-');
    try {
      writePlanFixture(dir, 'mrlw-d-role-filter');
      const sessionKey = 'mrlw-d-role-filter-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const r = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-integration', 'role-filter subject text');
      assert.strictEqual(r.result.ok, true, 'fixture: publish (targeting arch-integration) must succeed: ' + JSON.stringify(r.result));

      const sentinel = null;
      const worker = makeFakeWorker({ role: 'arch-platform', repoDescriptor: { repoId: context.repoId }, activePromise: sentinel });
      fn(worker, rll.coordinationRootPathFor(dir));
      assert.strictEqual(worker.activePromise, sentinel, 'a pending intent addressed to a different target role must never be dispatched to this worker, and must never trigger the ambiguity check either');
    } finally {
      cleanup(dir);
    }
  });

  test('success: exactly one matching pending intent with activePromise===null is dispatched, reading the subject blob correctly', async () => {
    const fn = rbc.__testOnlyCollectPendingMixedReviewRequest;
    assert.strictEqual(typeof fn, 'function', 'export-missing:__testOnlyCollectPendingMixedReviewRequest');
    const dir = makeGitProject('rll-mrlw-d-success-');
    try {
      writePlanFixture(dir, 'mrlw-d-success');
      const sessionKey = 'mrlw-d-success-session';
      establishRetainedCodexPlane(dir, sessionKey);
      const context = makeContext(dir, sessionKey);
      writeClaudeNativeRoleBinding(dir, context, 'arch-testing', 'READY');
      const subjectText = 'd-success subject text ' + crypto.randomBytes(4).toString('hex');
      const r = runMixedReviewRequest(dir, sessionKey, 'arch-testing', 'arch-platform', subjectText);
      assert.strictEqual(r.result.ok, true, 'fixture: publish must succeed: ' + JSON.stringify(r.result));

      const worker = makeFakeWorker({ role: 'arch-platform', repoDescriptor: { repoId: context.repoId }, activePromise: null });
      fn(worker, rll.coordinationRootPathFor(dir));
      assert.ok(worker.activePromise, 'a genuinely eligible pending intent with activePromise===null must be dispatched -- activePromise must become a new promise, not stay null');
      await worker.activePromise;
      assert.strictEqual(worker.activePromise, null, 'finally must reset activePromise back to null once the dispatched call settles');
    } finally {
      cleanup(dir);
    }
  });
});
