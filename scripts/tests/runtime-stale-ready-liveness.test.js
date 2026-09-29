'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createClaudeResumeRecord } = require('../lib/runtime-role-lifecycle/claude-resume-record.cjs');

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
  const fenced = new Set();
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
    CLAUDE_STARTUP_ACTOR_KEYS: startupKeys,
    CLAUDE_STARTUP_ACTOR_SCHEMA: 'runtime/claude-startup-actor/v1',
    computeClaudeAuthorityIdentityId: (_root, _provider, session, agent) => sha(session + '\0' + agent),
    currentClockMsForRegistry: () => NOW,
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
    readClaudeAuthorityFence: (_root, id) => ({ ok: true, absent: !fenced.has(id) }),
    readRegistryRecord: (file) => ({ ok: true, absent: false, obj: JSON.parse(fs.readFileSync(file, 'utf8')) }),
    registryRepoDir: () => root,
    sha256String: sha,
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
    fs.writeFileSync(path.join(traceDir, 'startup-' + role + '.json'), JSON.stringify(startup));
    fs.writeFileSync(path.join(traceDir, 'raw-' + role + '.json'), JSON.stringify(raw));
    if (fencedActor) fenced.add(sha(SESSION + '\0' + agentId));
  }
  const expected = (role) => ({
    generationId: GENERATION, planDigest: PLAN, role,
    runtimeSessionKey: SESSION, worktreeId: WORKTREE,
  });
  return { api, actors, add, expected, root };
}

test('five fenced support actors are classified ABSENT, never healthy READY', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const role of ROLES) f.add(role, { fencedActor: true });
  const results = ROLES.map((role) => f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)));
  assert.deepStrictEqual(results.map((result) => result.status), Array(5).fill('ABSENT'));
  assert.ok(results.every((result) => result.ok));
});

test('five exact unfenced support actors remain LIVE', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const role of ROLES) f.add(role);
  assert.deepStrictEqual(
    ROLES.map((role) => f.api.classifyClaudeSupportRoleLiveness(f.root, f.expected(role)).status),
    Array(5).fill('LIVE'),
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
