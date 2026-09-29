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
function fixture() {
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
    findUniqueClaudePeerRoleActorBinding: (_root, expected) => {
      const binding = actors.get(expected.role);
      return binding ? { ok: true, binding } : { ok: false, reason: 'UNAVAILABLE' };
    },
    fs,
    hasExactKeys: exact,
    isCanonicalIsoUtc: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value),
    isHexActionId: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
    isHexCsprng32: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
    isHexDigest64: (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
    isClaudeId01RawTraceWellFormed: (value) => exact(value, rawKeys),
    isoToMsForRegistry: Date.parse,
    path,
    peekSessionGeneration: () => ({ ok: true, generationId: GENERATION }),
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

test('five exact unfenced support actors remain UNVERIFIED without positive liveness evidence', (t) => {
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
  assert.deepStrictEqual(f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)), {
    ok: false, status: 'UNVERIFIED', reason: 'positive-liveness-evidence-absent',
  });
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

test('black-box A: durable READY plus startup/raw but no fence is not sufficient after host-wide cancellation', (t) => {
  const root = makeCliProject();
  t.after(() => cleanupCliProject(root));
  const sessionId = 'host-wide-cancel-session';
  const seeded = seedReadyClaudeActor(root, sessionId, 'host-wide-cancel-agent');

  // Models Ctrl-C / "All background agents stopped": no SubagentStop event,
  // therefore no fence or resume handle. Persisted startup facts alone cannot
  // be accepted as a fresh observation that the actor still exists.
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
  assert.strictEqual(fs.existsSync(seeded.rawPath), false);
  assert.strictEqual(fs.existsSync(seeded.startupPath), false);

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
