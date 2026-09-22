'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA = 'wave-phase-state/v1';
const PHASES = Object.freeze(['PREP', 'EXECUTE', 'VERIFY_FINAL', 'QG', 'COMPLETE']);
const NEXT = Object.freeze({ PREP: 'EXECUTE', EXECUTE: 'VERIFY_FINAL', VERIFY_FINAL: 'QG', QG: 'COMPLETE' });
const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const ROLE_RE = /^arch-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LIFECYCLE_ROLE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATE_KEYS = Object.freeze(['baseline_head', 'created_at', 'execution_mode', 'head', 'lifecycle_roles',
  'phase', 'plan_sha256', 'required_roles', 'revision', 'schema', 'transitions', 'updated_at', 'wave_class', 'wave_slug'].sort());
const TRANSITION_KEYS = Object.freeze(['at', 'evidence', 'from', 'from_head', 'to', 'to_head']);
const LOCK_WAIT_MS = 2000;

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonicalRoot(root) { return fs.realpathSync(path.resolve(root)); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}
function assertSlug(slug) {
  if (!SLUG_RE.test(slug || '') || slug === '.' || slug === '..') throw new Error('INVALID_WAVE_SLUG');
}
function assertSafeAncestry(root, target, allowMissingLeaf = false) {
  const canonical = canonicalRoot(root);
  const absolute = path.resolve(target);
  const prefix = canonical.endsWith(path.sep) ? canonical : canonical + path.sep;
  if (absolute !== canonical && !absolute.startsWith(prefix)) throw new Error('PHASE_STATE_OUTSIDE_ROOT');
  const relative = path.relative(canonical, absolute);
  let cursor = canonical;
  const parts = relative ? relative.split(path.sep) : [];
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    if (!fs.existsSync(cursor)) {
      if (allowMissingLeaf && index === parts.length - 1) return absolute;
      throw new Error('PHASE_STATE_ANCESTRY_MISSING');
    }
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('PHASE_STATE_ANCESTRY_UNSAFE');
  }
  return absolute;
}
function readRootFile(root, target) {
  const absolute = assertSafeAncestry(root, target);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('UNSAFE_CONTROL_PLANE_FILE');
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const identity = ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
    if (offset !== bytes.length || identity.some((key) => before[key] !== after[key])) throw new Error('CONTROL_PLANE_FILE_DRIFT');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function ensureStateDirectory(root, directory) {
  const canonical = canonicalRoot(root);
  const relative = path.relative(canonical, path.resolve(directory));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PHASE_STATE_OUTSIDE_ROOT');
  let cursor = canonical;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode: 0o700 });
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PHASE_STATE_ANCESTRY_UNSAFE');
  }
}
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function withStateLock(root, statePath, operation) {
  ensureStateDirectory(root, path.dirname(statePath));
  const lockPath = statePath + '.lock';
  const started = Date.now();
  for (;;) {
    try { fs.mkdirSync(lockPath, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() - started >= LOCK_WAIT_MS) throw new Error('PHASE_STATE_LOCK_TIMEOUT');
      sleepSync(40);
    }
  }
  try {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PHASE_STATE_LOCK_UNSAFE');
    return operation();
  } finally {
    let released = false;
    for (let attempt = 0; attempt < 5 && !released; attempt += 1) {
      try { fs.rmdirSync(lockPath); released = true; }
      catch { if (attempt < 4) sleepSync(40); }
    }
    if (!released) throw new Error('PHASE_STATE_LOCK_RELEASE_FAILED');
  }
}
function atomicWrite(target, value) {
  if (fs.existsSync(target)) {
    const current = fs.lstatSync(target);
    if (!current.isFile() || current.isSymbolicLink()) throw new Error('UNSAFE_PHASE_STATE');
  }
  const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow, 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, target);
    if (process.platform !== 'win32') {
      const parent = fs.openSync(path.dirname(target), fs.constants.O_RDONLY);
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    }
  } finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* private temp cleanup */ } }
}
function pathsFor(root, slug) {
  assertSlug(slug);
  const canonical = canonicalRoot(root);
  return {
    root: canonical,
    plan: path.join(canonical, '.planning', 'wave-' + slug, 'PLAN.md'),
    state: path.join(canonical, '.androidcommondoc', 'wave-control', slug + '.json'),
  };
}
function gitHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test((result.stdout || '').trim())) throw new Error('HEAD_UNAVAILABLE');
  return result.stdout.trim();
}
function parsePlanClass(planText) {
  const section = /###\s+Wave\s+Class\s*\r?\n([\s\S]*?)(?=\r?\n#{1,6}\s|$)/.exec(planText);
  const source = section ? section[1] : planText;
  const match = /\*\*Class\*\*:\s*([A-Za-z0-9._-]+)/.exec(source);
  return match ? match[1] : 'HARNESS';
}
function topology(root) {
  const yamlModule = path.join(root, 'mcp-server', 'node_modules', 'yaml');
  const topologyPath = path.join(root, '.claude', 'registry', 'wave-topology.yaml');
  assertSafeAncestry(root, topologyPath);
  const yaml = require(yamlModule);
  return yaml.parse(readRootFile(root, topologyPath).toString('utf8'));
}
function requiredRoles(root, planText, className) {
  const spec = (topology(root).class_artifacts || {})[className];
  if (!spec) throw new Error('UNKNOWN_WAVE_CLASS');
  let roles;
  if (Array.isArray(spec.architects)) roles = spec.architects.slice();
  if (spec.architects === 'declared') {
    const match = /\*\*Required-Architects\*\*:\s*(.+)/.exec(planText);
    if (!match) throw new Error('DECLARED_ROLES_MISSING');
    roles = match[1].split(',').map((x) => x.trim()).filter(Boolean);
    if (!roles.length) throw new Error('DECLARED_ROLES_MISSING');
  }
  if (!roles) throw new Error('INVALID_TOPOLOGY_SPEC');
  if (roles.some((role) => !ROLE_RE.test(role)) || new Set(roles).size !== roles.length) {
    throw new Error('INVALID_TOPOLOGY_ROLES');
  }
  return roles;
}
function executionMode(root, className) {
  const spec = (topology(root).class_artifacts || {})[className];
  if (!spec || !['persistent', 'ephemeral', 'disk-only'].includes(spec.execution_mode)) {
    throw new Error('INVALID_TOPOLOGY_EXECUTION_MODE');
  }
  return spec.execution_mode;
}
function lifecycleRoles(root, className) {
  const spec = (topology(root).class_artifacts || {})[className];
  const roles = spec && spec.lifecycle_roles;
  if (!Array.isArray(roles) || roles.some((role) => !LIFECYCLE_ROLE_RE.test(role))
    || new Set(roles).size !== roles.length) throw new Error('INVALID_LIFECYCLE_ROLES');
  return roles.slice();
}
function currentInputs(root, slug) {
  const p = pathsFor(root, slug);
  const planBytes = readRootFile(p.root, p.plan);
  const planText = planBytes.toString('utf8');
  const className = parsePlanClass(planText);
  return { ...p, head: gitHead(p.root), planDigest: sha256(planBytes), className,
    roles: requiredRoles(p.root, planText, className), lifecycleRoles: lifecycleRoles(p.root, className),
    executionMode: executionMode(p.root, className) };
}
function validateStateShape(state) {
  if (!exactKeys(state, STATE_KEYS) || state.schema !== SCHEMA || !PHASES.includes(state.phase)
    || !SLUG_RE.test(state.wave_slug || '') || !/^[0-9a-f]{40}$/.test(state.head || '')
    || !/^[0-9a-f]{40}$/.test(state.baseline_head || '')
    || !/^[0-9a-f]{64}$/.test(state.plan_sha256 || '') || !Array.isArray(state.required_roles)
    || state.required_roles.some((role) => !ROLE_RE.test(role))
    || new Set(state.required_roles).size !== state.required_roles.length
    || !Array.isArray(state.lifecycle_roles)
    || state.lifecycle_roles.some((role) => !LIFECYCLE_ROLE_RE.test(role))
    || new Set(state.lifecycle_roles).size !== state.lifecycle_roles.length
    || typeof state.wave_class !== 'string' || !SLUG_RE.test(state.wave_class)
    || !Number.isInteger(state.revision) || state.revision < 0 || !Array.isArray(state.transitions)
    || state.revision !== state.transitions.length
    || !ISO_UTC_RE.test(state.created_at || '') || !ISO_UTC_RE.test(state.updated_at || '')
    || !['persistent', 'ephemeral', 'disk-only'].includes(state.execution_mode)) {
    throw new Error('INVALID_PHASE_STATE');
  }
  for (const transition of state.transitions) {
    if (!exactKeys(transition, TRANSITION_KEYS) || !PHASES.includes(transition.from) || !PHASES.includes(transition.to)
      || NEXT[transition.from] !== transition.to || !ISO_UTC_RE.test(transition.at || '')
      || !/^[0-9a-f]{40}$/.test(transition.from_head || '') || !/^[0-9a-f]{40}$/.test(transition.to_head || '')
      || !Array.isArray(transition.evidence)) throw new Error('INVALID_PHASE_STATE');
    for (const evidence of transition.evidence) {
      const verdictEvidence = exactKeys(evidence, ['decision', 'path', 'role'])
        && evidence.decision === 'approve' && ROLE_RE.test(evidence.role || '') && typeof evidence.path === 'string';
      const qgEvidence = exactKeys(evidence, ['path', 'sha256'])
        && typeof evidence.path === 'string' && /^[0-9a-f]{64}$/.test(evidence.sha256 || '');
      if (!verdictEvidence && !qgEvidence) throw new Error('INVALID_PHASE_STATE');
    }
  }
  let expectedPhase = 'PREP';
  let expectedHead = state.baseline_head;
  let previousTime = new Date(state.created_at).getTime();
  for (const transition of state.transitions) {
    const at = new Date(transition.at).getTime();
    if (transition.from !== expectedPhase || transition.from_head !== expectedHead || at < previousTime) {
      throw new Error('INVALID_PHASE_STATE');
    }
    expectedPhase = transition.to;
    expectedHead = transition.to_head;
    previousTime = at;
  }
  if (state.phase !== expectedPhase || state.head !== expectedHead
    || new Date(state.updated_at).getTime() < previousTime) throw new Error('INVALID_PHASE_STATE');
  return state;
}
function readState(root, slug) {
  const p = pathsFor(root, slug);
  return validateStateShape(JSON.parse(readRootFile(p.root, p.state).toString('utf8')));
}
function initialize(root, slug) {
  const inputs = currentInputs(root, slug);
  return withStateLock(inputs.root, inputs.state, () => {
    if (fs.existsSync(inputs.state)) {
      const existing = readState(root, slug);
      if (existing.head !== inputs.head || existing.plan_sha256 !== inputs.planDigest) throw new Error('PHASE_STATE_INPUT_DRIFT');
      return existing;
    }
    assertSafeAncestry(inputs.root, inputs.state, true);
    const now = new Date().toISOString();
    const state = {
      schema: SCHEMA, wave_slug: slug, wave_class: inputs.className,
      plan_sha256: inputs.planDigest, baseline_head: inputs.head, head: inputs.head, phase: 'PREP',
      required_roles: inputs.roles, lifecycle_roles: inputs.lifecycleRoles, execution_mode: inputs.executionMode,
      revision: 0, created_at: now, updated_at: now,
      transitions: [],
    };
    atomicWrite(inputs.state, state);
    return state;
  });
}
function verifyVerdicts(root, slug, state, phase, verdicts) {
  if (state.required_roles.length === 0) return [];
  const supplied = new Map((verdicts || []).map((v) => [v.role, v.path]));
  const results = [];
  for (const role of state.required_roles) {
    const verdictPath = supplied.get(role);
    if (!verdictPath) throw new Error('REQUIRED_VERDICT_MISSING:' + role);
    const resolvedVerdictPath = path.isAbsolute(verdictPath) ? verdictPath : path.resolve(root, verdictPath);
    const cli = path.join(root, 'scripts', 'lib', 'verdict-evidence-contract-cli.cjs');
    const waveDir = path.join(root, '.planning', 'wave-' + slug);
    const result = spawnSync(process.execPath, [cli, 'validate', '--path', resolvedVerdictPath,
      '--expect-role', role, '--expect-phase', phase, '--expect-wave-slug', slug,
      '--expect-plan-sha256', state.plan_sha256, '--expect-head', state.head],
    { cwd: waveDir, encoding: 'utf8', timeout: 10000 });
    let payload;
    try { payload = JSON.parse((result.stdout || '').trim()); } catch { throw new Error('VERDICT_VALIDATION_UNAVAILABLE:' + role); }
    if (!payload.authorizes) throw new Error('VERDICT_NOT_AUTHORIZING:' + role + ':' + (payload.reason || 'invalid'));
    results.push({ role, path: resolvedVerdictPath, decision: payload.decision });
  }
  return results;
}
function transition(root, slug, to, options = {}) {
  if (!PHASES.includes(to)) throw new Error('UNKNOWN_PHASE');
  const inputs = currentInputs(root, slug);
  return withStateLock(inputs.root, inputs.state, () => {
  const state = readState(root, slug);
  if (state.plan_sha256 !== inputs.planDigest) throw new Error('PHASE_STATE_PLAN_DRIFT');
  if (NEXT[state.phase] !== to) throw new Error('ILLEGAL_PHASE_TRANSITION:' + state.phase + '->' + to);
  const headChanged = state.head !== inputs.head;
  const permitsFinalRebind = state.phase === 'EXECUTE' && to === 'VERIFY_FINAL' && options.rebindHead === true;
  if (headChanged && !permitsFinalRebind) throw new Error('PHASE_STATE_HEAD_DRIFT');
  let evidence = [];
  if (state.phase === 'PREP') evidence = verifyVerdicts(inputs.root, slug, state, 'prep', options.verdicts);
  if (state.phase === 'VERIFY_FINAL') evidence = verifyVerdicts(inputs.root, slug, state, 'verify-final', options.verdicts);
  if (state.phase === 'QG') {
    for (const rel of ['.androidcommondoc/quality-gate.stamp', '.androidcommondoc/pre-pr.stamp', '.androidcommondoc/push-proof.json']) {
      const target = path.join(inputs.root, rel);
      let bytes;
      try { bytes = readRootFile(inputs.root, target); } catch { throw new Error('QG_ARTIFACT_MISSING:' + rel); }
      evidence.push({ path: rel, sha256: sha256(bytes) });
    }
    for (const rel of ['.androidcommondoc/quality-gate.stamp', '.androidcommondoc/pre-pr.stamp']) {
      let stamp;
      try { stamp = JSON.parse(readRootFile(inputs.root, path.join(inputs.root, rel)).toString('utf8')); }
      catch { throw new Error('QG_STAMP_MALFORMED:' + rel); }
      if (stamp.verdict !== 'PASS' || stamp.head !== inputs.head) throw new Error('QG_STAMP_NOT_CURRENT:' + rel);
    }
    const proofCheck = spawnSync('bash', [path.join(inputs.root, 'scripts', 'sh', 'emit-push-proof.sh'),
      '--subcommand', 'verify-proof', '--pushed-sha', inputs.head, '--repo-root', inputs.root],
    { cwd: inputs.root, encoding: 'utf8', timeout: 30000 });
    if (proofCheck.status !== 0) throw new Error('QG_PROOF_INVALID');
  }
  const transitionAt = new Date().toISOString();
  const updated = {
    ...state, head: permitsFinalRebind ? inputs.head : state.head,
    phase: to, revision: state.revision + 1, updated_at: transitionAt,
    transitions: state.transitions.concat([{ from: state.phase, to, at: transitionAt,
      from_head: state.head, to_head: permitsFinalRebind ? inputs.head : state.head, evidence }]),
  };
  atomicWrite(inputs.state, updated);
  return updated;
  });
}
function status(root, slug) {
  const inputs = currentInputs(root, slug);
  const state = readState(root, slug);
  const planCurrent = state.plan_sha256 === inputs.planDigest;
  const headCurrent = state.head === inputs.head;
  return { ...state, plan_current: planCurrent, head_current: headCurrent,
    current: planCurrent && headCurrent };
}
function lifecycleActions(root, slug, profile = 'auto') {
  const state = status(root, slug);
  const roles = state.lifecycle_roles;
  if (state.phase === 'PREP' || state.phase === 'VERIFY_FINAL') {
    return roles.map((role) => ({ operation: 'ensure', role, profile,
      mode: state.execution_mode, transport: 'runtime-role-lifecycle' }));
  }
  if (state.phase === 'EXECUTE') return roles.map((role) => ({ operation: 'status', role, profile,
    mode: state.execution_mode, transport: 'runtime-role-lifecycle' }));
  return roles.map((role) => ({ operation: 'stop-owned', role, profile,
    mode: state.execution_mode, transport: 'runtime-role-lifecycle' }));
}

module.exports = { SCHEMA, PHASES, NEXT, initialize, readState, transition, status, lifecycleActions,
  parsePlanClass, requiredRoles, lifecycleRoles, executionMode };
