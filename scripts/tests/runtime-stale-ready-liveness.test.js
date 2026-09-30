'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createClaudeResumeRecord } = require('../lib/runtime-role-lifecycle/claude-resume-record.cjs');
const RLL_IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const SUBAGENT_HOOK = path.resolve(__dirname, '../../.claude/hooks/subagent-start-context-bundle.js');
const runtimeHostBoundary = require(path.resolve(__dirname, '../../.claude/hooks/runtime-host-boundary.js'));
const rll = require(RLL_IMPL);
const rc = require('../lib/runtime-consultation.cjs');

const ROLES = ['arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater'];
const GENERATION = '1'.repeat(32);
const WORKTREE = '2'.repeat(64);
const PLAN = '3'.repeat(64);
const SESSION = 'main-session';
const NOW = Date.parse('2026-09-29T12:00:00Z');
const CREATED = '2026-09-29T11:59:00Z';
const EXPIRY = '2026-09-29T13:00:00Z';

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function exact(value, keys) {
  return value && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function fixture({ findActor, peekGeneration } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-stale-ready-'));
  const traceDir = path.join(root, 'claude-id01-traces');
  fs.mkdirSync(traceDir, { recursive: true });
  const actors = new Map();
  const fenced = new Map();
  const startupKeys = [
    'action_digest', 'action_id', 'actor_binding_id', 'agent_digest', 'claim_digest',
    'created_at', 'expiry', 'host_contract_digest', 'plan_digest', 'role', 'schema',
    'session_digest', 'session_generation_digest', 'worktree_id',
  ];
  const rawKeys = [
    'agent_id', 'agent_type', 'created_at', 'expiry', 'plan_digest', 'resumed',
    'schema', 'session_id', 'subagent_start_count', 'tool_use_ids_after_resume',
    'tool_use_ids_before_resume', 'worktree_id',
  ];
  const api = createClaudeResumeRecord({
    CANONICAL_ROLES: ROLES,
    canonicalJSONStringify: rc.canonicalJSONStringify,
    CLAUDE_STARTUP_ACTOR_KEYS: startupKeys,
    CLAUDE_STARTUP_ACTOR_SCHEMA: 'runtime/claude-startup-actor/v1',
    claudeStartupActorPathFor: (_root, generationId, agentId) => path.join(
      traceDir, 'startup-v2-' + sha('claude-startup-v2:' + generationId + ':' + sha(agentId)) + '.json',
    ),
    computeClaudeAuthorityIdentityId: (_root, _provider, session, agent) => sha(session + '\0' + agent),
    computeWorktreeId: () => WORKTREE,
    currentClockMsForRegistry: () => NOW,
    discoverPlan: () => ({ ok: true, planDigest: PLAN }),
    ensureSecureRegistryDir: (dir) => { fs.mkdirSync(dir, { recursive: true }); return { ok: true }; },
    findUniqueClaudePeerRoleActorBinding: findActor || ((_root, expected) => {
      const binding = actors.get(expected.role);
      return binding ? { ok: true, binding } : { ok: false, reason: 'UNAVAILABLE' };
    }),
    fs,
    hasExactKeys: exact,
    isCanonicalIsoUtc: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value),
    isHexActionId: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
    isHexCsprng32: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
    isHexDigest64: (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
    isClaudeId01RawTraceWellFormed: (value) => exact(value, rawKeys),
    isoToMsForRegistry: Date.parse,
    path,
    peekSessionGeneration: peekGeneration || (() => ({ ok: true, generationId: GENERATION })),
    publishNoClobber: (file, bytes) => fs.writeFileSync(file, bytes, { flag: 'wx' }),
    readClaudeAuthorityFence: (_root, id) => fenced.has(id)
      ? { ok: true, absent: false, fence: fenced.get(id) }
      : { ok: true, absent: true },
    readRegistryRecord: (file) => fs.existsSync(file)
      ? { ok: true, absent: false, obj: JSON.parse(fs.readFileSync(file, 'utf8')) }
      : { ok: true, absent: true },
    registryRepoDir: () => root,
    sha256String: sha,
    validateRoleActorBindingFor: () => ({ ok: false, reason: 'UNAVAILABLE' }),
  });
  function add(role, { actorBindingId, agentId = role + '-actor', fencedActor = false } = {}) {
    const bindingId = actorBindingId || sha(role).slice(0, 32);
    actors.set(role, { binding_id: bindingId });
    const startup = {
      schema: 'runtime/claude-startup-actor/v1', session_digest: sha(SESSION), agent_digest: sha(agentId),
      role, action_id: sha('action-' + role).slice(0, 32), action_digest: sha('action-digest-' + role),
      claim_digest: sha('claim-' + role), actor_binding_id: bindingId, worktree_id: WORKTREE,
      plan_digest: PLAN, session_generation_digest: sha(GENERATION), host_contract_digest: sha('host'),
      created_at: CREATED, expiry: EXPIRY,
    };
    const raw = {
      schema: 'runtime/claude-id01-trace/v1', session_id: SESSION, agent_id: agentId,
      agent_type: role, worktree_id: WORKTREE, plan_digest: PLAN, subagent_start_count: 1,
      resumed: false, tool_use_ids_before_resume: [], tool_use_ids_after_resume: [],
      created_at: CREATED, expiry: EXPIRY,
    };
    const startupPath = path.join(
      traceDir, 'startup-v2-' + sha('claude-startup-v2:' + GENERATION + ':' + sha(agentId)) + '.json',
    );
    const rawPath = path.join(traceDir, 'raw-' + role + '.json');
    fs.writeFileSync(startupPath, JSON.stringify(startup));
    fs.writeFileSync(rawPath, JSON.stringify(raw));
    if (fencedActor) fenced.set(sha(SESSION + '\0' + agentId), { fenced_at: CREATED });
    return { agentId, rawPath, startupPath };
  }
  const expected = (role) => ({
    generationId: GENERATION, planDigest: PLAN, role,
    runtimeSessionKey: SESSION, worktreeId: WORKTREE,
  });
  return { api, actors, add, expected, fenced, root, traceDir };
}

test('five fenced support actors are classified ABSENT, never healthy READY', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const role of ROLES) f.add(role, { fencedActor: true });
  const results = ROLES.map((role) => f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)));
  assert.deepStrictEqual(results.map((result) => result.status), Array(5).fill('ABSENT'));
  assert.ok(results.every((result) => result.ok));
});

test('five exact unexpired unfenced startup histories remain UNVERIFIED until an active probe', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const role of ROLES) f.add(role);
  assert.deepStrictEqual(
    ROLES.map((role) => f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)).status),
    Array(5).fill('UNVERIFIED'),
  );
});

test('terminal tombstone preserves ABSENT after raw and startup traces are cleaned', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const role = ROLES[0];
  const observed = f.add(role, { fencedActor: true });
  const published = f.api.publishClaudeSupportRoleTerminal(f.root, {
    sessionId: SESSION, agentId: observed.agentId, agentType: role,
  });
  assert.strictEqual(published.ok, true, JSON.stringify(published));
  fs.rmSync(observed.rawPath);
  fs.rmSync(observed.startupPath);
  assert.strictEqual(
    f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)).status,
    'ABSENT',
  );
});

test('terminal publication accepts an expired startup identity after the authority fence is durable', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const role = ROLES[0];
  const observed = f.add(role, { fencedActor: true });
  const startup = JSON.parse(fs.readFileSync(observed.startupPath, 'utf8'));
  startup.expiry = '2026-09-29T11:59:30Z';
  fs.writeFileSync(observed.startupPath, JSON.stringify(startup));
  const published = f.api.publishClaudeSupportRoleTerminal(f.root, {
    sessionId: SESSION, agentId: observed.agentId, agentType: role,
  });
  assert.strictEqual(published.ok, true, JSON.stringify(published));
  assert.strictEqual(published.skipped, undefined, JSON.stringify(published));
});

test('terminal publication does not block cleanup after the actor binding is no longer live', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const role = ROLES[0];
  const observed = f.add(role, { fencedActor: true });
  f.actors.delete(role);
  const published = f.api.publishClaudeSupportRoleTerminal(f.root, {
    sessionId: SESSION, agentId: observed.agentId, agentType: role,
  });
  assert.deepStrictEqual(published, {
    ok: true, skipped: true, reason: 'terminal-actor-no-longer-live',
  });
});

test('terminal publication skips a session that never minted a generation and rejects an unusable one', (t) => {
  const absent = fixture({ peekGeneration: () => ({ ok: false, reason: 'session-generation-absent' }) });
  const expired = fixture({ peekGeneration: () => ({ ok: false, reason: 'session-generation-expired' }) });
  const malformed = fixture({ peekGeneration: () => ({ ok: false, reason: 'session-generation-shape-invalid' }) });
  for (const f of [absent, expired, malformed]) t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const role = ROLES[0];
  // Startup actor records are generation-scoped: without a generation none can exist.
  assert.deepStrictEqual(absent.api.publishClaudeSupportRoleTerminal(absent.root, {
    sessionId: SESSION, agentId: role + '-actor', agentType: role,
  }), { ok: true, skipped: true, reason: 'terminal-session-generation-absent' });
  for (const f of [expired, malformed]) {
    const observed = f.add(role, { fencedActor: true });
    assert.deepStrictEqual(f.api.publishClaudeSupportRoleTerminal(f.root, {
      sessionId: SESSION, agentId: observed.agentId, agentType: role,
    }), { ok: false, reason: 'terminal-scope-invalid' });
  }
});

test('terminal publication rejects reversed startup chronology and invalid actor lookup', (t) => {
  const chronology = fixture();
  const invalidActor = fixture({ findActor: () => ({ ok: false, reason: 'INVALID' }) });
  t.after(() => fs.rmSync(chronology.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(invalidActor.root, { recursive: true, force: true }));
  const role = ROLES[0];
  const observed = chronology.add(role, { fencedActor: true });
  const startup = JSON.parse(fs.readFileSync(observed.startupPath, 'utf8'));
  startup.expiry = '2026-09-29T11:58:59Z';
  fs.writeFileSync(observed.startupPath, JSON.stringify(startup));
  assert.deepStrictEqual(chronology.api.publishClaudeSupportRoleTerminal(chronology.root, {
    sessionId: SESSION, agentId: observed.agentId, agentType: role,
  }), { ok: false, reason: 'terminal-startup-mismatch' });
  const invalidObserved = invalidActor.add(role, { fencedActor: true });
  assert.deepStrictEqual(invalidActor.api.publishClaudeSupportRoleTerminal(invalidActor.root, {
    sessionId: SESSION, agentId: invalidObserved.agentId, agentType: role,
  }), { ok: false, reason: 'terminal-actor-invalid' });
});

test('expired and unrelated raw traces are ignored instead of creating false ambiguity', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const role = ROLES[0];
  f.add(role);
  const expired = {
    schema: 'runtime/claude-id01-trace/v1', session_id: SESSION, agent_id: role + '-stale',
    agent_type: role, worktree_id: WORKTREE, plan_digest: PLAN, subagent_start_count: 1,
    resumed: false, tool_use_ids_before_resume: [], tool_use_ids_after_resume: [],
    created_at: '2026-09-29T10:00:00Z', expiry: '2026-09-29T11:00:00Z',
  };
  const unrelated = { ...expired, agent_id: 'other', agent_type: ROLES[1], expiry: EXPIRY };
  fs.writeFileSync(path.join(f.traceDir, 'raw-expired.json'), JSON.stringify(expired));
  fs.writeFileSync(path.join(f.traceDir, 'raw-unrelated.json'), JSON.stringify(unrelated));
  assert.strictEqual(
    f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)).status,
    'UNVERIFIED',
  );
});

test('persisted actor A versus current actor binding B fails closed as identity mismatch', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const role = ROLES[0];
  f.add(role, { actorBindingId: 'a'.repeat(32) });
  f.actors.set(role, { binding_id: 'b'.repeat(32) });
  assert.deepStrictEqual(f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)), {
    ok: false, status: 'INVALID', reason: 'actor-identity-mismatch',
  });
});

const CLI_ROLE = 'arch-testing';
const CLI_CAPABILITY = 'stale-ready-liveness-black-box';
const CLI_CAPABILITIES = JSON.stringify(['claude-sendmessage']);

process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = CLI_CAPABILITY;

function makeCliProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-stale-ready-cli-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'stale-ready@test.local']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Stale Ready Test']);
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init']);
  const libDir = path.join(root, 'scripts', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
  policy.schema = 'runtime-collaboration-policy/v1';
  policy.version = 1;
  delete policy.selection;
  delete policy.claude_native_startup_timeout_seconds;
  fs.writeFileSync(path.join(libDir, 'runtime-collaboration-policy.json'), JSON.stringify(policy, null, 2) + '\n');
  fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(libDir, 'runtime-routing.json'));
  for (const slug of ['historical-a', 'target', 'historical-b']) {
    const waveDir = path.join(root, '.planning', 'wave-' + slug);
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# stale-ready black-box ' + slug + '\n');
  }
  return root;
}

function cleanupCliProject(root) {
  fs.rmSync(rll.registryRepoDir(root), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

function targetPlan(root) {
  const result = rll.discoverPlan(root, { waveSlug: 'target', expectedDigest: null });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  return result;
}

function identityFor(sessionId) {
  return { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
}

function mintEnsureGrant(root, sessionId, planDigest) {
  const main = rll.createMainOrchestratorBinding(
    root, identityFor(sessionId), rll.computeWorktreeId(root), planDigest, 120,
  );
  assert.strictEqual(main.ok, true, JSON.stringify(main));
  const argvDigest = sha('ensure:' + CLI_ROLE + ':wave:target');
  const grant = rll.mintLifecycleCommandGrant(
    root, main.binding, argvDigest, CLI_ROLE, 'ensure',
    'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(grant.ok, true, JSON.stringify(grant));
  return grant.grantId;
}

function runEnsure(root, sessionId, planDigest) {
  const grantId = mintEnsureGrant(root, sessionId, planDigest);
  const environment = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: CLI_CAPABILITY,
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CLI_CAPABILITIES,
  });
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [
      RLL_IMPL, 'ensure', '--project-root', root, '--role', CLI_ROLE,
      '--wave-slug', 'target', '--lifecycle-binding', grantId,
    ], { encoding: 'utf8', env: environment });
  } catch (error) {
    stdout = error.stdout;
  }
  const lines = String(stdout || '').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function runSubagentStop(root, sessionId, agentId) {
  return execFileSync(process.execPath, [SUBAGENT_HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'SubagentStop',
      session_id: sessionId,
      agent_id: agentId,
      agent_type: CLI_ROLE,
    }),
    env: Object.assign({}, process.env, {
      CLAUDE_PROJECT_DIR: root,
      NODE_ENV: 'test',
      RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: CLI_CAPABILITY,
      RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CLI_CAPABILITIES,
    }),
  });
}

function seedReadyClaudeActor(root, sessionId, agentId) {
  const plan = targetPlan(root);
  const initial = runEnsure(root, sessionId, plan.planDigest);
  assert.strictEqual(initial.status, 'ACTION_REQUIRED', JSON.stringify(initial));
  const action = initial.actions.find((candidate) => candidate.kind === 'role-spawn');
  assert.ok(action, JSON.stringify(initial));
  const actor = rll.createRoleActorBinding(
    root, CLI_ROLE, action.worktree_id, action.plan_digest, action.session_generation_id, 600,
  );
  assert.strictEqual(actor.ok, true, JSON.stringify(actor));
  const profileDigest = rll.roleProfileDigestFor(CLI_ROLE);
  const starting = rll.readRoleBindingState(
    root, action.worktree_id, action.plan_digest, profileDigest,
    action.session_generation_id, CLI_ROLE,
  );
  const ready = rll.transitionRoleBinding(
    root, action.worktree_id, action.plan_digest, profileDigest,
    action.session_generation_id, CLI_ROLE, 'STARTING', 'READY', starting.record, {},
  );
  assert.strictEqual(ready.ok, true, JSON.stringify(ready));

  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiry = new Date(Date.now() + 300000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const raw = {
    schema: 'runtime/claude-id01-trace/v1', session_id: sessionId, agent_id: agentId,
    agent_type: CLI_ROLE, worktree_id: action.worktree_id, plan_digest: action.plan_digest,
    subagent_start_count: 1, resumed: false, tool_use_ids_before_resume: [],
    tool_use_ids_after_resume: [], created_at: createdAt, expiry,
  };
  const rawPath = rll.claudeId01RecordPathFor(
    root, action.session_generation_id, action.worktree_id, action.plan_digest,
    CLI_ROLE, sha(agentId), action.action_id,
  );
  assert.strictEqual(rll.writeRegistryRecordReplace(
    rawPath, Buffer.from(rc.canonicalJSONStringify(raw), 'utf8'),
  ).ok, true);

  const startup = {
    schema: 'runtime/claude-startup-actor/v1', session_digest: sha(sessionId),
    agent_digest: sha(agentId), role: CLI_ROLE, action_id: action.action_id,
    action_digest: sha(rc.canonicalJSONStringify(action)), claim_digest: '4'.repeat(64),
    actor_binding_id: actor.binding.binding_id, worktree_id: action.worktree_id,
    plan_digest: action.plan_digest, session_generation_digest: sha(action.session_generation_id),
    host_contract_digest: '5'.repeat(64), created_at: createdAt, expiry,
  };
  const startupKey = sha('claude-startup-v2:' + action.session_generation_id + ':' + sha(agentId));
  const startupPath = path.join(
    rll.registryRepoDir(root), 'claude-id01-traces', 'startup-v2-' + startupKey + '.json',
  );
  assert.strictEqual(rll.writeRegistryRecordReplace(
    startupPath, Buffer.from(rc.canonicalJSONStringify(startup), 'utf8'),
  ).ok, true);
  return { action, actor, plan, profileDigest, rawPath, startupPath };
}

function currentRoleState(root, seeded) {
  return rll.readRoleBindingState(
    root, seeded.action.worktree_id, seeded.action.plan_digest, seeded.profileDigest,
    seeded.action.session_generation_id, CLI_ROLE,
  );
}

function shutdownEvent(root, sessionId, toolUseId, outcome) {
  const event = {
    hook_event_name: 'PreToolUse', tool_name: 'SendMessage', cwd: root,
    session_id: sessionId, tool_use_id: toolUseId,
    tool_input: { to: CLI_ROLE, summary: 'stop one role', message: { type: 'shutdown_request', reason: 'test' } },
  };
  const reserved = runtimeHostBoundary.reserveNativeShutdownTerminal(event);
  assert.strictEqual(reserved.ok, true, JSON.stringify(reserved));
  if (!outcome) return event;
  const settled = runtimeHostBoundary.settleNativeShutdownTerminal({
    ...event,
    hook_event_name: outcome === 'failed' ? 'PostToolUseFailure' : 'PostToolUse',
    tool_response: outcome === 'confirmed'
      ? { success: true, request_id: 'shutdown-1@' + CLI_ROLE, target: CLI_ROLE }
      : undefined,
  });
  assert.strictEqual(settled.ok, true, JSON.stringify(settled));
  return event;
}

test('explicit successful shutdown is terminal and never parks toxic history for resume', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'explicit-shutdown-session';
  const agentId = 'explicit-shutdown-agent';
  const seeded = seedReadyClaudeActor(root, sessionId, agentId);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const parked = rll.parkClaudeResumeHandleForRoleActor(root, { sessionId, agentId, agentType: CLI_ROLE });
    assert.strictEqual(parked.ok, true, JSON.stringify(parked));
    const consumed = rll.consumeClaudeResumeHandleForObservedActor(root, { sessionId, agentId, agentType: CLI_ROLE });
    assert.strictEqual(consumed.ok, true, JSON.stringify(consumed));
  }
  shutdownEvent(root, sessionId, 'shutdown-tool-success', 'confirmed');
  assert.strictEqual(runSubagentStop(root, sessionId, agentId), '');
  assert.strictEqual(runSubagentStop(root, sessionId, agentId), '',
    'a repeated stop after terminal cleanup must be an idempotent no-op');
  const fenceId = rll.computeClaudeAuthorityIdentityId(root, 'claude-hook', sessionId, agentId);
  assert.strictEqual(rll.readClaudeAuthorityFence(root, fenceId).absent, false);
  const next = runEnsure(root, sessionId, seeded.plan.planDigest);
  assert.strictEqual(next.status, 'ACTION_REQUIRED', JSON.stringify(next));
  assert.ok(next.actions.some((action) => action.kind === 'role-spawn'), JSON.stringify(next));
});

test('shutdown consumption rejects a caller-supplied foreign stem', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'foreign-stem-session';
  const agentId = 'foreign-stem-agent';
  seedReadyClaudeActor(root, sessionId, agentId);
  shutdownEvent(root, sessionId, 'foreign-stem-tool', 'confirmed');
  const candidate = rll.findClaudeShutdownTerminalForRole(root, {
    sessionId, agentId, agentType: CLI_ROLE,
  });
  assert.strictEqual(candidate.status, 'CONFIRMED');
  assert.deepStrictEqual(rll.consumeClaudeShutdownTerminal(root, {
    ...candidate, stem: path.join(root, 'foreign-stem'),
  }), { ok: false, reason: 'INVALID' });
  const forged = { ...candidate.record, recipient: '../escape' };
  assert.deepStrictEqual(rll.consumeClaudeShutdownTerminal(root, {
    ...candidate,
    record: forged,
    stem: path.join(rll.registryRepoDir(root), 'claude-shutdown-terminal',
      forged.session_digest, forged.recipient, forged.tool_use_digest),
  }), { ok: false, reason: 'INVALID' });
});

test('consumed shutdown replay rejects conflicting terminal state and request id', (t) => {
  const conflictRoot = makeCliProject();
  t.after(() => cleanupCliProject(conflictRoot));
  const conflictSession = 'consumed-conflict-session';
  const conflictAgent = 'consumed-conflict-agent';
  seedReadyClaudeActor(conflictRoot, conflictSession, conflictAgent);
  shutdownEvent(conflictRoot, conflictSession, 'consumed-conflict-tool', 'confirmed');
  assert.strictEqual(runSubagentStop(conflictRoot, conflictSession, conflictAgent), '');
  const conflictDir = path.join(rll.registryRepoDir(conflictRoot), 'claude-shutdown-terminal',
    sha(conflictSession), CLI_ROLE);
  const conflictStem = path.join(conflictDir, sha('consumed-conflict-tool'));
  const confirmed = JSON.parse(fs.readFileSync(conflictStem + '.confirmed.json', 'utf8'));
  const { request_id: _requestId, ...failed } = confirmed;
  failed.schema = 'runtime/claude-shutdown-terminal-failed/v1';
  failed.reason = 'host-sendmessage-failed';
  fs.writeFileSync(conflictStem + '.failed.json', rc.canonicalJSONStringify(failed));
  const conflictBlocked = JSON.parse(runSubagentStop(conflictRoot, conflictSession, conflictAgent));
  assert.strictEqual(conflictBlocked.decision, 'block');
  assert.match(conflictBlocked.reason, /explicit shutdown correlation FAILED/);

  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'consumed-tamper-session';
  const agentId = 'consumed-tamper-agent';
  seedReadyClaudeActor(root, sessionId, agentId);
  shutdownEvent(root, sessionId, 'consumed-tamper-tool', 'confirmed');
  assert.strictEqual(runSubagentStop(root, sessionId, agentId), '');
  const dir = path.join(rll.registryRepoDir(root), 'claude-shutdown-terminal', sha(sessionId), CLI_ROLE);
  const consumedPath = path.join(dir, sha('consumed-tamper-tool') + '.consumed.json');
  const consumed = JSON.parse(fs.readFileSync(consumedPath, 'utf8'));
  consumed.request_id = 'foreign-request';
  fs.writeFileSync(consumedPath, rc.canonicalJSONStringify(consumed));
  const blocked = JSON.parse(runSubagentStop(root, sessionId, agentId));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /explicit shutdown correlation FAILED/);
});

test('failed shutdown request preserves ordinary resumable parking', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'failed-shutdown-session';
  const agentId = 'failed-shutdown-agent';
  const seeded = seedReadyClaudeActor(root, sessionId, agentId);
  shutdownEvent(root, sessionId, 'shutdown-tool-failure', 'failed');
  assert.strictEqual(runSubagentStop(root, sessionId, agentId), '');
  assert.strictEqual(currentRoleState(root, seeded).state, 'WAITING');
  const fenceId = rll.computeClaudeAuthorityIdentityId(root, 'claude-hook', sessionId, agentId);
  assert.strictEqual(rll.readClaudeAuthorityFence(root, fenceId).absent, true);
});

test('absent shutdown evidence is inert for non-persistent SubagentStop identities', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  assert.deepStrictEqual(rll.findClaudeShutdownTerminalForRole(root, {
    sessionId: 'ordinary-one-shot-session', agentId: 'ordinary-one-shot-agent',
    agentType: 'toolkit-specialist',
  }), { ok: true, status: 'NONE' });
  assert.deepStrictEqual(rll.findClaudeShutdownTerminalForRole(root, {
    sessionId: 'custom-session', agentId: 'custom-agent', agentType: 'custom-agent-name',
  }), { ok: true, status: 'NONE' });
});

test('pending shutdown race blocks SubagentStop instead of incorrectly parking', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'pending-shutdown-session';
  const agentId = 'pending-shutdown-agent';
  const seeded = seedReadyClaudeActor(root, sessionId, agentId);
  shutdownEvent(root, sessionId, 'shutdown-tool-pending');
  const output = JSON.parse(runSubagentStop(root, sessionId, agentId));
  assert.strictEqual(output.decision, 'block');
  assert.match(output.reason, /awaiting its correlated host outcome/);
  assert.strictEqual(currentRoleState(root, seeded).state, 'READY');
});

test('successful shutdown evidence cannot terminalize a replacement identity', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'foreign-shutdown-session';
  const seeded = seedReadyClaudeActor(root, sessionId, 'original-shutdown-agent');
  shutdownEvent(root, sessionId, 'shutdown-tool-foreign', 'confirmed');
  const output = JSON.parse(runSubagentStop(root, sessionId, 'replacement-shutdown-agent'));
  assert.strictEqual(output.decision, 'block');
  assert.match(output.reason, /explicit shutdown correlation FAILED/);
  assert.strictEqual(currentRoleState(root, seeded).state, 'READY');
});

test('shutdown correlation replay is idempotent and malformed settled evidence fails closed', (t) => {
  const replayRoot = makeCliProject();
  const malformedRoot = makeCliProject();
  t.after(() => cleanupCliProject(replayRoot));
  t.after(() => cleanupCliProject(malformedRoot));
  seedReadyClaudeActor(replayRoot, 'replay-shutdown-session', 'replay-shutdown-agent');
  shutdownEvent(replayRoot, 'replay-shutdown-session', 'shutdown-tool-replay', 'confirmed');
  shutdownEvent(replayRoot, 'replay-shutdown-session', 'shutdown-tool-replay', 'confirmed');
  assert.strictEqual(runSubagentStop(replayRoot, 'replay-shutdown-session', 'replay-shutdown-agent'), '');

  const seeded = seedReadyClaudeActor(malformedRoot, 'malformed-shutdown-session', 'malformed-shutdown-agent');
  shutdownEvent(malformedRoot, 'malformed-shutdown-session', 'shutdown-tool-malformed', 'confirmed');
  const confirmedPath = path.join(
    rll.registryRepoDir(malformedRoot), 'claude-shutdown-terminal', sha('malformed-shutdown-session'),
    CLI_ROLE, sha('shutdown-tool-malformed') + '.confirmed.json',
  );
  fs.writeFileSync(confirmedPath, '{"schema":"broken"}');
  const blocked = JSON.parse(runSubagentStop(
    malformedRoot, 'malformed-shutdown-session', 'malformed-shutdown-agent',
  ));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /explicit shutdown correlation FAILED/);
  assert.strictEqual(currentRoleState(malformedRoot, seeded).state, 'READY');
});

test('black-box A: durable READY plus expired startup/raw but no fence is not sufficient after host-wide cancellation', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'host-wide-cancel-session';
  const seeded = seedReadyClaudeActor(root, sessionId, 'host-wide-cancel-agent');

  const startup = JSON.parse(fs.readFileSync(seeded.startupPath, 'utf8'));
  startup.expiry = new Date(Date.now() - 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.strictEqual(rll.writeRegistryRecordReplace(
    seeded.startupPath, Buffer.from(rc.canonicalJSONStringify(startup), 'utf8'),
  ).ok, true);

  // Models the observed host-wide kill: no SubagentStop event, fence or resume
  // handle, while the startup observation has already expired. Persisted
  // historical facts cannot be accepted as evidence that the actor exists.
  const result = runEnsure(root, sessionId, seeded.plan.planDigest);
  assert.notStrictEqual(result.status, 'READY',
    'init/ensure must actively revalidate host liveness; durable unfenced startup history alone is not current liveness');
});

test('black-box B: fenced READY whose terminal cleanup deleted traces is retired before ensure can report healthy', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'fenced-cleaned-session';
  const agentId = 'fenced-cleaned-agent';
  const seeded = seedReadyClaudeActor(root, sessionId, agentId);
  const fenceId = rll.computeClaudeAuthorityIdentityId(root, 'claude-hook', sessionId, agentId);
  // Model a terminal host observation rather than an ordinary resumable
  // Task completion: the pre-existing fence makes the hook bypass parking,
  // persist the scope tombstone, then clean the raw traces.
  assert.strictEqual(rll.publishClaudeAuthorityFence(root, fenceId).ok, true);
  assert.strictEqual(runSubagentStop(root, sessionId, agentId), '');
  const fence = rll.readClaudeAuthorityFence(root, fenceId);
  assert.ok(fence.ok && !fence.absent, JSON.stringify(fence));
  // Cleanup is best-effort and may race the action's liveness projection;
  // erase both traces explicitly to prove the terminal tombstone, not the
  // historical files, drives the next ensure decision.
  fs.rmSync(seeded.rawPath, { force: true });
  fs.rmSync(seeded.startupPath, { force: true });

  const result = runEnsure(root, sessionId, seeded.plan.planDigest);
  assert.notStrictEqual(result.status, 'READY');
  const durable = currentRoleState(root, seeded);
  assert.ok(durable.ok, JSON.stringify(durable));
  assert.notStrictEqual(durable.state, 'READY',
    'terminal fence+cleanup evidence must retire stale READY durably, not merely hide it from one envelope');
});

test('multi-wave control: exact startup trace supplies the target PLAN for ordinary READY to WAITING park', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'multi-wave-park-session';
  const agentId = 'multi-wave-park-agent';
  const seeded = seedReadyClaudeActor(root, sessionId, agentId);

  const parked = rll.parkClaudeResumeHandleForRoleActor(root, {
    sessionId, agentId, agentType: CLI_ROLE,
  });
  assert.strictEqual(parked.ok, true, JSON.stringify(parked));
  assert.strictEqual(currentRoleState(root, seeded).state, 'WAITING');
});
