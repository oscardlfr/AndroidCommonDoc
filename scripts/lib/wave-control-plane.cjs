'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const runtimeProjectContext = require('./runtime-project-context.cjs');
const wavePlanClass = require('./wave-plan-class.cjs');
const verdictStore = require('./verdict-artifact-store.cjs');

const SCHEMA = 'wave-phase-state/v2';
const LEGACY_SCHEMA = 'wave-phase-state/v1';
const PHASES = Object.freeze(['PREP', 'EXECUTE', 'VERIFY_FINAL', 'QG', 'COMPLETE']);
const NEXT = Object.freeze({ PREP: 'EXECUTE', EXECUTE: 'VERIFY_FINAL', VERIFY_FINAL: 'QG', QG: 'COMPLETE' });
const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const ROLE_RE = /^arch-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LIFECYCLE_ROLE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATE_KEYS = Object.freeze(['baseline_head', 'created_at', 'cycle', 'execution_mode', 'head', 'lifecycle_roles',
  'phase', 'plan_sha256', 'required_roles', 'revision', 'schema', 'transitions', 'updated_at', 'verification_epoch',
  'wave_class', 'wave_slug'].sort());
// A state initialized from a Pass A draft also records that fact, so the one legitimate re-binding to the final PLAN can
// be recognized. States written before this key existed simply lack it and are never rebindable.
const STATE_KEYS_WITH_DRAFT = Object.freeze(STATE_KEYS.concat(['plan_draft']).sort());
const DRAFT_PLAN_MARKER = 'STATUS: DRAFT-CONTEXT-PENDING';
const TRANSITION_KEYS = Object.freeze(['at', 'cycle', 'evidence', 'from', 'from_head', 'kind', 'revision', 'to',
  'to_head', 'verification_epoch']);
const LOCK_WAIT_MS = 2000;
const MAX_REWORK_CYCLES = 3;
const QG_ATTEMPT_SCHEMA = 'wave-qg-attempt/v1';
const PREVERIFY_SCHEMA = 'wave-preverify-receipt/v1';
const WAVE_CLASSES = wavePlanClass.WAVE_CLASSES;

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
function atomicCreate(root, target, value) {
  ensureStateDirectory(root, path.dirname(target));
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow, 0o600);
  let complete = false;
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
    complete = true;
  } finally {
    fs.closeSync(fd);
    if (!complete) { try { fs.unlinkSync(target); } catch { /* failed publication stays fail-closed */ } }
  }
  if (process.platform !== 'win32') {
    const parent = fs.openSync(path.dirname(target), fs.constants.O_RDONLY);
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  }
}
function pathsFor(root, slug) {
  assertSlug(slug);
  const canonical = canonicalRoot(root);
  return {
    root: canonical,
    plan: path.join(canonical, '.planning', 'wave-' + slug, 'PLAN.md'),
    classSentinel: path.join(canonical, '.planning', 'wave-' + slug, 'CLASS'),
    state: path.join(canonical, '.androidcommondoc', 'wave-control', slug + '.json'),
  };
}
function gitHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test((result.stdout || '').trim())) throw new Error('HEAD_UNAVAILABLE');
  return result.stdout.trim();
}
/** Per line: true when it is Markdown structure, false inside (or on the delimiters of) a fenced code block. */
function structuralLineFlags(lines) {
  const structural = [];
  let fence = null;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const candidate = marker[1];
      if (fence === null) fence = { char: candidate[0], length: candidate.length };
      else if (candidate[0] === fence.char && candidate.length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = null;
      structural.push(false);
      continue;
    }
    structural.push(fence === null);
  }
  return structural;
}
/**
 * A Pass A draft carries the marker as a standalone line; the finalized PLAN has no such line. This is the one grammar
 * the planner contract ("write a draft with the marker"), the orchestrator check ("the marker is present") and this
 * parser share: an exact line outside fenced code, anywhere in the PLAN. Prose that merely quotes the marker inline
 * or a code sample is not a draft. Recognizing a draft grants nothing by itself: the re-binding it enables still
 * requires PREP, revision 0, no transition, the same HEAD and class, and a final PLAN without the marker.
 */
function isDraftPlan(planText) {
  const lines = planText.split(/\r?\n/);
  const structural = structuralLineFlags(lines);
  return lines.some((line, index) => structural[index] && line.trim() === DRAFT_PLAN_MARKER);
}
const parsePlanClass = wavePlanClass.parsePlanClass;
function readClassSentinel(root, sentinelPath) {
  if (!fs.existsSync(sentinelPath)) throw new Error('WAVE_CLASS_SENTINEL_MISSING');
  let value;
  try { value = readRootFile(root, sentinelPath).toString('utf8').trim(); }
  catch (error) {
    if (error && (error.code === 'ENOENT' || error.message === 'PHASE_STATE_ANCESTRY_MISSING')) {
      throw new Error('WAVE_CLASS_SENTINEL_MISSING');
    }
    throw new Error('INVALID_WAVE_CLASS_SENTINEL');
  }
  if (!WAVE_CLASSES.includes(value)) throw new Error('INVALID_WAVE_CLASS_SENTINEL');
  return value;
}
function topology(root) {
  // `root` is the consumer repository. Runtime dependencies belong to the L0
  // toolkit that owns this module; requiring them from the consumer made every
  // clean L1/L2 install depend on a nonexistent consumer `mcp-server` tree.
  const yamlModule = path.resolve(__dirname, '../../mcp-server/node_modules/yaml');
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
function lifecycleRoles(root, className, declaredArchitects) {
  const spec = (topology(root).class_artifacts || {})[className];
  const roles = spec && spec.lifecycle_roles;
  if (!Array.isArray(roles) || roles.some((role) => !LIFECYCLE_ROLE_RE.test(role))
    || new Set(roles).size !== roles.length) throw new Error('INVALID_LIFECYCLE_ROLES');
  // A class whose architects are "declared" (DOC) names them only in the PLAN, so the lifecycle must start them too:
  // otherwise Pass B and PREP consultations have no architect peer with a lifecycle startup record.
  if (spec.architects === 'declared' && Array.isArray(declaredArchitects)) {
    return [...new Set([...roles, ...declaredArchitects])];
  }
  return roles.slice();
}
function currentInputs(root, slug) {
  const p = pathsFor(root, slug);
  const planBytes = readRootFile(p.root, p.plan);
  const planText = wavePlanClass.decodePlanBytes(planBytes);
  const planClass = parsePlanClass(planText);
  const sentinelClass = readClassSentinel(p.root, p.classSentinel);
  if (sentinelClass !== planClass) {
    throw new Error(`WAVE_CLASS_MISMATCH:sentinel=${sentinelClass}:plan=${planClass}`);
  }
  const className = planClass;
  return { ...p, head: gitHead(p.root), planDigest: sha256(planBytes), planDraft: isDraftPlan(planText), className,
    roles: requiredRoles(p.root, planText, className), lifecycleRoles: lifecycleRoles(p.root, className, requiredRoles(p.root, planText, className)),
    executionMode: executionMode(p.root, className) };
}
function validateStateShape(state) {
  const hasDraftKey = Object.prototype.hasOwnProperty.call(state || {}, 'plan_draft');
  if (!exactKeys(state, hasDraftKey ? STATE_KEYS_WITH_DRAFT : STATE_KEYS) || (hasDraftKey && typeof state.plan_draft !== 'boolean') || state.schema !== SCHEMA || !PHASES.includes(state.phase)
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
    || !Number.isInteger(state.cycle) || state.cycle < 0 || state.cycle > MAX_REWORK_CYCLES
    || !Number.isInteger(state.verification_epoch) || state.verification_epoch < 0
    || !ISO_UTC_RE.test(state.created_at || '') || !ISO_UTC_RE.test(state.updated_at || '')
    || !['persistent', 'ephemeral', 'disk-only'].includes(state.execution_mode)) {
    throw new Error('INVALID_PHASE_STATE');
  }
  for (const transition of state.transitions) {
    if (!exactKeys(transition, TRANSITION_KEYS) || !PHASES.includes(transition.from) || !PHASES.includes(transition.to)
      || !['advance', 'rework'].includes(transition.kind)
      || (transition.kind === 'advance' ? NEXT[transition.from] !== transition.to : transition.from !== 'QG' || transition.to !== 'EXECUTE')
      || !Number.isInteger(transition.revision) || transition.revision < 1
      || !Number.isInteger(transition.cycle) || transition.cycle < 0 || transition.cycle > MAX_REWORK_CYCLES
      || !Number.isInteger(transition.verification_epoch) || transition.verification_epoch < 0
      || !ISO_UTC_RE.test(transition.at || '')
      || !/^[0-9a-f]{40}$/.test(transition.from_head || '') || !/^[0-9a-f]{40}$/.test(transition.to_head || '')
      || !Array.isArray(transition.evidence)) throw new Error('INVALID_PHASE_STATE');
    for (const evidence of transition.evidence) {
      const verdictEvidence = exactKeys(evidence, ['decision', 'path', 'role'])
        && evidence.decision === 'approve' && ROLE_RE.test(evidence.role || '') && typeof evidence.path === 'string';
      const qgEvidence = exactKeys(evidence, ['path', 'sha256'])
        && typeof evidence.path === 'string' && /^[0-9a-f]{64}$/.test(evidence.sha256 || '');
      const receiptEvidence = exactKeys(evidence, ['attempt', 'kind', 'path', 'sha256'])
        && evidence.kind === 'qg-attempt' && Number.isInteger(evidence.attempt) && evidence.attempt > 0
        && typeof evidence.path === 'string' && /^[0-9a-f]{64}$/.test(evidence.sha256 || '');
      const preverifyEvidence = exactKeys(evidence, ['kind', 'path', 'sha256'])
        && evidence.kind === 'preverify' && typeof evidence.path === 'string'
        && /^[0-9a-f]{64}$/.test(evidence.sha256 || '');
      if (!verdictEvidence && !qgEvidence && !receiptEvidence && !preverifyEvidence) throw new Error('INVALID_PHASE_STATE');
    }
  }
  let expectedPhase = 'PREP';
  let expectedHead = state.baseline_head;
  let expectedCycle = 0;
  let expectedEpoch = 0;
  let expectedRevision = 1;
  let previousTime = new Date(state.created_at).getTime();
  for (const transition of state.transitions) {
    const at = new Date(transition.at).getTime();
    if (transition.from !== expectedPhase || transition.from_head !== expectedHead || at < previousTime
      || transition.revision !== expectedRevision) {
      throw new Error('INVALID_PHASE_STATE');
    }
    if (transition.kind === 'rework') { expectedCycle += 1; expectedEpoch += 1; }
    if (transition.cycle !== expectedCycle || transition.verification_epoch !== expectedEpoch) {
      throw new Error('INVALID_PHASE_STATE');
    }
    expectedPhase = transition.to;
    expectedHead = transition.to_head;
    expectedRevision += 1;
    previousTime = at;
  }
  if (state.phase !== expectedPhase || state.head !== expectedHead || state.cycle !== expectedCycle
    || state.verification_epoch !== expectedEpoch
    || new Date(state.updated_at).getTime() < previousTime) throw new Error('INVALID_PHASE_STATE');
  return state;
}

function migrateV1State(root, slug, statePath, rawState) {
  if (!rawState || rawState.schema !== LEGACY_SCHEMA || !Array.isArray(rawState.transitions)) return null;
  let cycle = 0;
  let verificationEpoch = 0;
  let decisionless = false;
  const transitions = rawState.transitions.map((transition, index) => ({
    ...transition,
    evidence: (transition.evidence || []).map((entry) => {
      if (exactKeys(entry, ['path', 'role'])) { decisionless = true; return { ...entry, decision: 'approve' }; }
      return entry;
    }),
    kind: 'advance', revision: index + 1, cycle, verification_epoch: verificationEpoch,
  }));
  const candidate = { ...rawState, schema: SCHEMA, cycle, verification_epoch: verificationEpoch, transitions };
  validateStateShape(candidate);
  if (decisionless) {
    for (const transition of candidate.transitions.filter((item) => item.from === 'PREP' || item.from === 'VERIFY_FINAL')) {
      for (const evidence of transition.evidence) {
        const validation = validateVerdictSource(root, slug, candidate, transition, evidence);
        if (!validation.ok) throw new Error(`LEGACY_PHASE_STATE_VERDICT_INVALID:${evidence.role}:${validation.reason}`);
      }
    }
  }
  atomicWrite(statePath, candidate);
  return candidate;
}
function validateVerdictSource(root, slug, state, transition, evidence) {
  const phase = transition.from === 'PREP' ? 'prep' : 'verify-final';
  const resolvedVerdictPath = path.isAbsolute(evidence.path) ? evidence.path : path.resolve(root, evidence.path);
  // The control plane is source-referenced from L0 in consumers; its validator
  // belongs to that same toolkit closure, not to a consumer-local scripts tree.
  const cli = path.join(__dirname, 'verdict-evidence-contract-cli.cjs');
  const waveDir = path.join(root, '.planning', 'wave-' + slug);
  const result = spawnSync(process.execPath, [cli, 'validate', '--path', resolvedVerdictPath,
    '--expect-role', evidence.role, '--expect-phase', phase, '--expect-wave-slug', slug,
    '--expect-plan-sha256', state.plan_sha256, '--expect-head', transition.from_head],
  { cwd: waveDir, encoding: 'utf8', timeout: 10000 });
  let payload;
  try { payload = JSON.parse((result.stdout || '').trim()); } catch {
    return { ok: false, reason: 'validation-unavailable' };
  }
  return { ok: result.status === 0 && payload.authorizes === true,
    reason: payload.reason || (result.status === 0 ? 'invalid' : 'validation-unavailable') };
}

function migrateLegacyDecisionlessState(root, slug, statePath, rawState) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)
    || !Array.isArray(rawState.transitions) || !Array.isArray(rawState.required_roles)) return null;
  const candidate = JSON.parse(JSON.stringify(rawState));
  let missingDecision = false;
  const verdictTransitions = [];
  for (const transition of candidate.transitions) {
    if (!transition || (transition.from !== 'PREP' && transition.from !== 'VERIFY_FINAL')) continue;
    if (!Array.isArray(transition.evidence)) return null;
    const roles = [];
    for (const evidence of transition.evidence) {
      if (exactKeys(evidence, ['path', 'role'])) {
        evidence.decision = 'approve';
        missingDecision = true;
      } else if (!exactKeys(evidence, ['decision', 'path', 'role'])) return null;
      roles.push(evidence.role);
    }
    if (JSON.stringify(roles.slice().sort()) !== JSON.stringify(candidate.required_roles.slice().sort())) return null;
    verdictTransitions.push(transition);
  }
  if (!missingDecision) return null;

  // Prove that the state differs from the current schema only by the omitted
  // decision field before trusting any path embedded in the legacy record.
  validateStateShape(candidate);
  for (const transition of verdictTransitions) {
    for (const evidence of transition.evidence) {
      const validation = validateVerdictSource(root, slug, candidate, transition, evidence);
      if (!validation.ok) {
        throw new Error(`LEGACY_PHASE_STATE_VERDICT_INVALID:${evidence.role}:${validation.reason}`);
      }
    }
  }
  // Callers enter through the same per-state lock used by normal transitions,
  // so the verified candidate replaces the decisionless state atomically.
  atomicWrite(statePath, candidate);
  return candidate;
}

function readStateUnlocked(root, slug) {
  const p = pathsFor(root, slug);
  const rawState = JSON.parse(readRootFile(p.root, p.state).toString('utf8'));
  const upgraded = migrateV1State(p.root, slug, p.state, rawState);
  if (upgraded) return upgraded;
  try { return validateStateShape(rawState); }
  catch (originalError) {
    const migrated = migrateLegacyDecisionlessState(p.root, slug, p.state, rawState);
    if (migrated) return migrated;
    throw originalError;
  }
}

// A wave that was never initialized must say so, not surface a path-ancestry failure from reading the missing state.
function assertInitialized(inputs) {
  if (!fs.existsSync(inputs.state)) throw new Error('WAVE_NOT_INITIALIZED');
}

function readState(root, slug) {
  const p = pathsFor(root, slug);
  return withStateLock(p.root, p.state, () => readStateUnlocked(p.root, slug));
}
/**
 * A state bound to a Pass A draft may be re-bound ONCE to the finalized PLAN, and only while nothing was decided on it:
 * still PREP at revision 0 with no transition (so no verdict), same HEAD, same class, and the new PLAN is no draft.
 * Any other PLAN change stays drift.
 */
function draftRebindAllowed(existing, inputs) {
  return existing.plan_draft === true && existing.phase === 'PREP' && existing.revision === 0
    && existing.transitions.length === 0 && existing.head === inputs.head && inputs.planDraft === false
    && existing.wave_class === inputs.className && existing.plan_sha256 !== inputs.planDigest;
}
function initialize(root, slug, expectedPlanDigest = null) {
  const target = pathsFor(root, slug);
  return withStateLock(target.root, target.state, () => {
    const inputs = currentInputs(root, slug);
    if (expectedPlanDigest !== null && inputs.planDigest !== expectedPlanDigest) {
      throw new Error('PHASE_STATE_PLAN_DRIFT');
    }
    if (fs.existsSync(inputs.state)) {
      const existing = readStateUnlocked(root, slug);
      if (existing.head === inputs.head && existing.plan_sha256 === inputs.planDigest) return existing;
      if (!draftRebindAllowed(existing, inputs)) throw new Error('PHASE_STATE_INPUT_DRIFT');
      // The one re-binding: Pass B legitimately rewrote the draft into the final PLAN before anything was decided.
      const rebound = { ...existing, plan_sha256: inputs.planDigest, plan_draft: false, required_roles: inputs.roles,
        lifecycle_roles: inputs.lifecycleRoles, execution_mode: inputs.executionMode, updated_at: new Date().toISOString() };
      atomicWrite(inputs.state, rebound);
      return rebound;
    }
    assertSafeAncestry(inputs.root, inputs.state, true);
    const now = new Date().toISOString();
    const state = {
      schema: SCHEMA, wave_slug: slug, wave_class: inputs.className,
      plan_sha256: inputs.planDigest, baseline_head: inputs.head, head: inputs.head, phase: 'PREP',
      required_roles: inputs.roles, lifecycle_roles: inputs.lifecycleRoles, execution_mode: inputs.executionMode,
      plan_draft: inputs.planDraft, revision: 0, created_at: now, updated_at: now,
      cycle: 0, verification_epoch: 0,
      transitions: [],
    };
    atomicWrite(inputs.state, state);
    return state;
  });
}
function assertExpectedRevision(state, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('EXPECTED_REVISION_REQUIRED');
  if (state.revision !== expectedRevision) throw new Error(`PHASE_STATE_CAS_MISMATCH:expected=${expectedRevision}:actual=${state.revision}`);
}
function trackedTreeClean(root) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) throw new Error('GIT_STATUS_UNAVAILABLE');
  return (result.stdout || '').trim() === '';
}
function ensureWaveControlIgnored(root, slug) {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) throw new Error('GIT_COMMON_DIR_UNAVAILABLE');
  const commonDir = path.resolve(root, result.stdout.trim());
  const exclude = path.join(commonDir, 'info', 'exclude');
  const rule = `.planning/wave-${slug}/control/`;
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (current.split(/\r?\n/).some((line) => line.trim() === rule)) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${rule}\n`);
}
function relativeReceiptPath(root, target) {
  const relative = path.relative(root, target).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('RECEIPT_OUTSIDE_ROOT');
  return relative;
}
function preverify(root, slug, options = {}) {
  const inputs = currentInputs(root, slug);
  assertInitialized(inputs);
  return withStateLock(inputs.root, inputs.state, () => {
    const state = readStateUnlocked(root, slug);
    assertExpectedRevision(state, options.expectedRevision);
    if (state.phase !== 'EXECUTE') throw new Error('PREVERIFY_OUTSIDE_EXECUTE');
    if (state.plan_sha256 !== inputs.planDigest) throw new Error('PHASE_STATE_PLAN_DRIFT');
    if (!trackedTreeClean(inputs.root)) throw new Error('PREVERIFY_TRACKED_TREE_DIRTY');
    ensureWaveControlIgnored(inputs.root, slug);
    const receipt = {
      schema: PREVERIFY_SCHEMA, wave_slug: slug, plan_sha256: state.plan_sha256, head: inputs.head,
      state_revision: state.revision, cycle: state.cycle, verification_epoch: state.verification_epoch,
      created_at: new Date().toISOString(),
    };
    const target = path.join(inputs.root, '.planning', `wave-${slug}`, 'control', 'preverify',
      `cycle-${state.cycle}-revision-${state.revision}-${inputs.head}.json`);
    try { atomicCreate(inputs.root, target, receipt); } catch (error) {
      if (error && error.code === 'EEXIST') {
        const existing = readBoundReceipt(inputs.root, target, {
          schema: PREVERIFY_SCHEMA, wave_slug: slug, plan_sha256: state.plan_sha256, head: inputs.head,
          state_revision: state.revision, cycle: state.cycle, verification_epoch: state.verification_epoch,
        }, 'PREVERIFY_RECEIPT_CONFLICT');
        return { ...existing.value, path: existing.path };
      }
      throw error;
    }
    return { ...receipt, path: relativeReceiptPath(inputs.root, target) };
  });
}
function readBoundReceipt(root, receiptPath, expected, invalidReason) {
  if (typeof receiptPath !== 'string' || receiptPath.length === 0) throw new Error(invalidReason + ':missing');
  const target = path.isAbsolute(receiptPath || '') ? receiptPath : path.resolve(root, receiptPath || '');
  const bytes = readRootFile(root, target);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(invalidReason); }
  if (!exactKeys(value, Object.keys(expected).concat(['created_at']).sort())
    || !ISO_UTC_RE.test(value.created_at || '')
    || !bytes.equals(Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'))) throw new Error(invalidReason);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) throw new Error(invalidReason + ':' + key);
  }
  return { bytes, value, path: relativeReceiptPath(root, target) };
}
function readQGAttemptReceipt(root, slug, receiptPath, expected, invalidReason) {
  if (typeof receiptPath !== 'string' || receiptPath.length === 0) throw new Error(invalidReason + ':missing');
  const target = path.isAbsolute(receiptPath || '') ? receiptPath : path.resolve(root, receiptPath || '');
  const bytes = readRootFile(root, target);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(invalidReason); }
  const keys = ['attempt', 'checks', 'created_at', 'cycle', 'head', 'plan_sha256', 'schema', 'state_revision',
    'verification_epoch', 'verdict', 'wave_slug'].sort();
  if (!exactKeys(value, keys) || !ISO_UTC_RE.test(value.created_at || '') || !Number.isInteger(value.attempt)
    || value.attempt < 1 || !value.checks || typeof value.checks !== 'object' || Array.isArray(value.checks)
    || !bytes.equals(Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'))) throw new Error(invalidReason);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) throw new Error(invalidReason + ':' + key);
  }
  const canonicalTarget = path.join(root, '.androidcommondoc', 'wave-control', slug, 'qg-attempts',
    `cycle-${value.cycle}`, `attempt-${value.attempt}.json`);
  if (path.resolve(target) !== path.resolve(canonicalTarget)) throw new Error(invalidReason + ':path');
  return { bytes, value, path: relativeReceiptPath(root, target) };
}
function qgAttempt(root, slug, verdict, options = {}) {
  if (!['PASS', 'FAIL'].includes(verdict)) throw new Error('INVALID_QG_VERDICT');
  const inputs = currentInputs(root, slug);
  assertInitialized(inputs);
  return withStateLock(inputs.root, inputs.state, () => {
    const state = readStateUnlocked(root, slug);
    assertExpectedRevision(state, options.expectedRevision);
    if (state.phase !== 'QG') throw new Error('QG_ATTEMPT_OUTSIDE_QG');
    if (state.plan_sha256 !== inputs.planDigest || state.head !== inputs.head) throw new Error('PHASE_STATE_INPUT_DRIFT');
    const directory = path.join(inputs.root, '.androidcommondoc', 'wave-control', slug, 'qg-attempts', `cycle-${state.cycle}`);
    ensureStateDirectory(inputs.root, directory);
    const entries = fs.readdirSync(directory);
    if (entries.some((name) => !/^attempt-[1-9][0-9]*\.json$/.test(name))) throw new Error('QG_ATTEMPT_DIRECTORY_INVALID');
    const numbers = entries.map((name) => Number(/^attempt-([1-9][0-9]*)\.json$/.exec(name)[1])).sort((a, b) => a - b);
    if (numbers.some((number, index) => number !== index + 1)) throw new Error('QG_ATTEMPT_SEQUENCE_INVALID');
    const attempt = numbers.length + 1;
    const receipt = {
      schema: QG_ATTEMPT_SCHEMA, verdict, wave_slug: slug, plan_sha256: state.plan_sha256, head: state.head,
      state_revision: state.revision, cycle: state.cycle, verification_epoch: state.verification_epoch, attempt,
      created_at: new Date().toISOString(), checks: options.checks && typeof options.checks === 'object' ? options.checks : {},
    };
    const target = path.join(directory, `attempt-${attempt}.json`);
    atomicCreate(inputs.root, target, receipt);
    return { ...receipt, path: relativeReceiptPath(inputs.root, target) };
  });
}
function rework(root, slug, options = {}) {
  const inputs = currentInputs(root, slug);
  assertInitialized(inputs);
  return withStateLock(inputs.root, inputs.state, () => {
    const state = readStateUnlocked(root, slug);
    assertExpectedRevision(state, options.expectedRevision);
    if (state.phase !== 'QG') throw new Error('REWORK_OUTSIDE_QG');
    if (state.cycle >= MAX_REWORK_CYCLES) throw new Error('REWORK_CYCLE_LIMIT');
    if (state.plan_sha256 !== inputs.planDigest || state.head !== inputs.head) throw new Error('PHASE_STATE_INPUT_DRIFT');
    const receipt = readQGAttemptReceipt(inputs.root, slug, options.failReceipt, {
      schema: QG_ATTEMPT_SCHEMA, verdict: 'FAIL', wave_slug: slug, plan_sha256: state.plan_sha256,
      head: state.head, state_revision: state.revision, cycle: state.cycle,
      verification_epoch: state.verification_epoch,
    }, 'QG_FAIL_RECEIPT_INVALID');
    const digest = sha256(receipt.bytes);
    if (state.transitions.some((item) => item.evidence.some((entry) => entry.sha256 === digest))) {
      throw new Error('QG_FAIL_RECEIPT_REPLAY');
    }
    const now = new Date().toISOString();
    const updated = {
      ...state, phase: 'EXECUTE', cycle: state.cycle + 1, verification_epoch: state.verification_epoch + 1,
      revision: state.revision + 1, updated_at: now,
      transitions: state.transitions.concat([{
        kind: 'rework', revision: state.revision + 1, from: 'QG', to: 'EXECUTE', at: now,
        from_head: state.head, to_head: state.head, cycle: state.cycle + 1,
        verification_epoch: state.verification_epoch + 1,
        evidence: [{ kind: 'qg-attempt', attempt: receipt.value.attempt, path: receipt.path, sha256: digest }],
      }]),
    };
    // The CAS state write is the sole commit point. Prior verdicts and proofs remain immutable audit evidence; they
    // become inert because the next VERIFY_FINAL verdict must cite the new cycle's preverify receipt and QG authority
    // accepts only attempts bound to the current cycle/epoch/revision.
    atomicWrite(inputs.state, updated);
    return updated;
  });
}
// Read-only admission preflight. Unlike initialize(), this never creates the
// control-plane directory, lock, or PREP state. Callers may therefore prove
// host composition before committing the wave state.
function inspect(root, slug) {
  const inputs = currentInputs(root, slug);
  if (!fs.existsSync(inputs.state)) {
    return {
      wave_slug: slug, phase: 'PREP', plan_sha256: inputs.planDigest,
      head: inputs.head, lifecycle_roles: inputs.lifecycleRoles,
      plan_current: true, head_current: true, current: true, initialized: false,
    };
  }
  const existing = readState(root, slug);
  const planCurrent = existing.plan_sha256 === inputs.planDigest;
  const headCurrent = existing.head === inputs.head;
  // `draft_rebind`: the state is a draft that initialize() would re-bind to this final PLAN. The admission then plans
  // with the final PLAN's digest and roles, exactly what initialize() is about to record.
  const draftRebind = !planCurrent && draftRebindAllowed(existing, inputs);
  return { ...existing, ...(draftRebind ? { plan_sha256: inputs.planDigest, lifecycle_roles: inputs.lifecycleRoles } : {}),
    plan_current: planCurrent, head_current: headCurrent, draft_rebind: draftRebind,
    current: planCurrent && headCurrent, initialized: true };
}
function verifyVerdicts(root, slug, state, phase, verdicts) {
  if (state.required_roles.length === 0) return [];
  const supplied = new Map((verdicts || []).map((v) => [v.role, v.path]));
  const results = [];
  for (const role of state.required_roles) {
    const verdictPath = supplied.get(role);
    if (!verdictPath) throw new Error('REQUIRED_VERDICT_MISSING:' + role);
    const resolvedVerdictPath = path.isAbsolute(verdictPath) ? verdictPath : path.resolve(root, verdictPath);
    const validation = validateVerdictSource(root, slug, state,
      { from: phase === 'prep' ? 'PREP' : 'VERIFY_FINAL', from_head: state.head },
      { role, path: resolvedVerdictPath });
    if (!validation.ok) throw new Error('VERDICT_NOT_AUTHORIZING:' + role + ':' + validation.reason);
    if (phase === 'verify-final') {
      const boundary = [...state.transitions].reverse().find((item) => item.kind === 'advance'
        && item.to === 'VERIFY_FINAL' && item.cycle === state.cycle
        && item.verification_epoch === state.verification_epoch);
      const preverifyEvidence = boundary && boundary.evidence.find((item) => item.kind === 'preverify');
      if (!preverifyEvidence) throw new Error('VERIFY_FINAL_PREVERIFY_BINDING_MISSING');
      const canonical = canonicalRoot(root);
      const waveDir = path.join(canonical, '.planning', `wave-${slug}`);
      let verdict;
      try { verdict = JSON.parse(verdictStore.readConfinedFile(waveDir, resolvedVerdictPath).bytes.toString('utf8')); }
      catch { throw new Error('VERDICT_NOT_AUTHORIZING:' + role + ':preverify-binding'); }
      const expectedPath = path.relative(waveDir, path.join(canonical, preverifyEvidence.path)).split(path.sep).join('/');
      const bound = Array.isArray(verdict.evidence) && verdict.evidence.some((entry) => entry.kind === 'opaque-file'
        && entry.path === expectedPath && entry.sha256 === preverifyEvidence.sha256);
      if (!bound) throw new Error('VERDICT_NOT_AUTHORIZING:' + role + ':preverify-binding');
    }
    // The validator intentionally exposes only binding booleans plus
    // `authorizes`; it does not echo the source decision. Once `authorizes` is
    // true, the closed verdict contract has already proven decision=approve.
    // Persist that canonical value explicitly so the state remains readable.
    results.push({ role, path: resolvedVerdictPath, decision: 'approve' });
  }
  return results;
}
function qualityGateProofInvocation(root, slug, head, platform = process.platform) {
  const projectContext = runtimeProjectContext.resolveRuntimeProjectContext(root);
  if (!projectContext.ok) throw new Error('RUNTIME_PROJECT_CONTEXT_INVALID:' + projectContext.reason);
  if (projectContext.consumerLayer === 'L0') {
    if (platform === 'win32') {
      return {
        executable: 'pwsh.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
          path.join(root, 'scripts', 'ps1', 'verify-push-proof.ps1'),
          '-PushedSha', head, '-RepoRoot', root],
      };
    }
    return {
      executable: 'bash',
      args: [path.join(root, 'scripts', 'sh', 'emit-push-proof.sh'),
        '--subcommand', 'verify-proof', '--pushed-sha', head, '--repo-root', root],
    };
  }
  return {
    executable: process.execPath,
    args: [path.resolve(__dirname, 'runtime-consumer-quality-gate.cjs'),
      root, 'verify', '--slug', slug, '--head', head],
  };
}
function transition(root, slug, to, options = {}) {
  if (!PHASES.includes(to)) throw new Error('UNKNOWN_PHASE');
  const inputs = currentInputs(root, slug);
  assertInitialized(inputs);
  return withStateLock(inputs.root, inputs.state, () => {
  const state = readStateUnlocked(root, slug);
  assertExpectedRevision(state, options.expectedRevision);
  if (state.plan_sha256 !== inputs.planDigest) throw new Error('PHASE_STATE_PLAN_DRIFT');
  if (NEXT[state.phase] !== to) throw new Error('ILLEGAL_PHASE_TRANSITION:' + state.phase + '->' + to);
  const headChanged = state.head !== inputs.head;
  const isFinalBoundary = state.phase === 'EXECUTE' && to === 'VERIFY_FINAL';
  const permitsFinalRebind = state.phase === 'EXECUTE' && to === 'VERIFY_FINAL' && options.rebindHead === true;
  if (headChanged && !permitsFinalRebind) throw new Error('PHASE_STATE_HEAD_DRIFT');
  let evidence = [];
  if (state.phase === 'PREP') evidence = verifyVerdicts(inputs.root, slug, state, 'prep', options.verdicts);
  if (state.phase === 'VERIFY_FINAL') evidence = verifyVerdicts(inputs.root, slug, state, 'verify-final', options.verdicts);
  if (isFinalBoundary) {
    if (!trackedTreeClean(inputs.root)) throw new Error('FINAL_HEAD_REBIND_TRACKED_TREE_DIRTY');
    const receipt = readBoundReceipt(inputs.root, options.preverifyReceipt, {
      schema: PREVERIFY_SCHEMA, wave_slug: slug, plan_sha256: state.plan_sha256, head: inputs.head,
      state_revision: state.revision, cycle: state.cycle, verification_epoch: state.verification_epoch,
    }, 'PREVERIFY_RECEIPT_INVALID');
    evidence.push({ kind: 'preverify', path: receipt.path, sha256: sha256(receipt.bytes) });
  }
  if (state.phase === 'QG') {
    const attemptReceipt = readQGAttemptReceipt(inputs.root, slug, options.qgAttempt, {
      schema: QG_ATTEMPT_SCHEMA, verdict: 'PASS', wave_slug: slug, plan_sha256: state.plan_sha256,
      head: state.head, state_revision: state.revision, cycle: state.cycle,
      verification_epoch: state.verification_epoch,
    }, 'QG_PASS_RECEIPT_INVALID');
    evidence.push({ kind: 'qg-attempt', attempt: attemptReceipt.value.attempt,
      path: attemptReceipt.path, sha256: sha256(attemptReceipt.bytes) });
    const qgBoundary = [...state.transitions].reverse().find((item) => item.kind === 'advance'
      && item.to === 'QG' && item.cycle === state.cycle && item.verification_epoch === state.verification_epoch);
    if (!qgBoundary || Date.parse(attemptReceipt.value.created_at) < Date.parse(qgBoundary.at)) {
      throw new Error('QG_PASS_RECEIPT_STALE');
    }
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
      if (!ISO_UTC_RE.test(stamp.timestamp || '') || Date.parse(stamp.timestamp) < Date.parse(qgBoundary.at)) {
        throw new Error('QG_STAMP_STALE_FOR_CYCLE:' + rel);
      }
    }
    let proof;
    try { proof = JSON.parse(readRootFile(inputs.root, path.join(inputs.root, '.androidcommondoc/push-proof.json')).toString('utf8')); }
    catch { throw new Error('QG_PROOF_INVALID'); }
    const proofTime = proof.generated_at || proof.generatedAt;
    if (!ISO_UTC_RE.test(proofTime || '') || Date.parse(proofTime) < Date.parse(qgBoundary.at)) {
      throw new Error('QG_PROOF_STALE_FOR_CYCLE');
    }
    const invocation = qualityGateProofInvocation(inputs.root, slug, inputs.head);
    const proofCheck = spawnSync(invocation.executable, invocation.args,
      { cwd: inputs.root, encoding: 'utf8', timeout: 30000 });
    if (proofCheck.status !== 0) throw new Error('QG_PROOF_INVALID');
  }
  const transitionAt = new Date().toISOString();
  const updated = {
    ...state, head: permitsFinalRebind ? inputs.head : state.head,
    phase: to, revision: state.revision + 1, updated_at: transitionAt,
    transitions: state.transitions.concat([{ kind: 'advance', revision: state.revision + 1,
      from: state.phase, to, at: transitionAt, cycle: state.cycle, verification_epoch: state.verification_epoch,
      from_head: state.head, to_head: permitsFinalRebind ? inputs.head : state.head, evidence }]),
  };
  atomicWrite(inputs.state, updated);
  return updated;
  });
}
function status(root, slug) {
  const inputs = currentInputs(root, slug);
  assertInitialized(inputs);
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

module.exports = { SCHEMA, PHASES, NEXT, MAX_REWORK_CYCLES, initialize, inspect, readState, transition, rework,
  preverify, qgAttempt, status, lifecycleActions, parsePlanClass, requiredRoles, lifecycleRoles, executionMode,
  qualityGateProofInvocation };
