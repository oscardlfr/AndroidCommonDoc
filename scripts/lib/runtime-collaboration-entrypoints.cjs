#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lifecycleOwner = require('./runtime-role-lifecycle.cjs');
const consultationOwner = require('./runtime-consultation.cjs');
const claudeHostOwner = require('./runtime-host-claude.cjs');

const ENTRYPOINTS = Object.freeze([
  'init-session',
  'resume-work',
  'work',
  'ingest-content',
  'monitor-docs',
]);

const RESULT_STATUSES = Object.freeze([
  'READY',
  'ACTION_REQUIRED',
  'COMPLETED',
  'BLOCKED',
  'UNAVAILABLE',
  'FAILED',
]);

const SUPPORT_ROLES = Object.freeze([
  'arch-platform',
  'arch-testing',
  'arch-integration',
  'context-provider',
  'doc-updater',
]);

const PORT_SHAPE = Object.freeze({
  lifecycle: Object.freeze(['status', 'ensureRoles', 'invokeRole', 'recoverRole', 'stopOwned']),
  consultation: Object.freeze(['consult', 'ingest', 'monitor']),
  adapter: Object.freeze(['executeAction']),
  selection: Object.freeze(['resolve']),
  audit: Object.freeze(['record']),
});

const TRUSTED_CONTEXTS = new WeakSet();
const CONTEXT_STATE = new WeakMap();
const PLAN_COMMAND_ARGS = new Map();
const HEX64 = '[0-9a-f]{64}';
const REF_RE = Object.freeze({
  checkpoint: new RegExp(`^checkpoint:${HEX64}$`),
  subject: new RegExp(`^subject:${HEX64}$`),
  request: new RegExp(`^request:${HEX64}$`),
  approval: new RegExp(`^approval:${HEX64}$`),
  result: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/,
  accepted_result: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/,
  ack: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/,
});
const DIGEST_RE = /^[0-9a-f]{64}$/;

function hasExactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validatePorts(ports) {
  if (!hasExactKeys(ports, Object.keys(PORT_SHAPE))) throw new TypeError('invalid-port-shape');
  for (const [group, functions] of Object.entries(PORT_SHAPE)) {
    if (!hasExactKeys(ports[group], functions)) throw new TypeError('invalid-port-group');
    for (const name of functions) {
      if (typeof ports[group][name] !== 'function') throw new TypeError('invalid-port-function');
    }
  }
}

function createTrustedHostContext(ports) {
  validatePorts(ports);
  const context = Object.freeze(Object.create(null));
  TRUSTED_CONTEXTS.add(context);
  CONTEXT_STATE.set(context, { ports, ingestionResults: new Map() });
  return context;
}

function trustedState(context) {
  if (!TRUSTED_CONTEXTS.has(context)) throw new TypeError('untrusted-host-context');
  const state = CONTEXT_STATE.get(context);
  if (!state) throw new TypeError('untrusted-host-context');
  return state;
}

function validateIntent(entrypoint, intent) {
  switch (entrypoint) {
    case 'init-session':
      if (!hasExactKeys(intent, ['mode']) || !['dashboard', 'start'].includes(intent.mode)) throw new TypeError('invalid-intent');
      return;
    case 'resume-work':
      if (!hasExactKeys(intent, ['checkpoint_ref']) || !REF_RE.checkpoint.test(intent.checkpoint_ref)) throw new TypeError('invalid-intent');
      return;
    case 'work':
      if (!hasExactKeys(intent, ['role', 'subject_ref', 'task'])) throw new TypeError('invalid-intent');
      if (!lifecycleOwner.CANONICAL_ROLES.includes(intent.role)) throw new TypeError('invalid-intent');
      if (!REF_RE.subject.test(intent.subject_ref)) throw new TypeError('invalid-intent');
      if (typeof intent.task !== 'string' || intent.task.trim().length === 0) throw new TypeError('invalid-intent');
      return;
    case 'ingest-content':
      if (!hasExactKeys(intent, ['request_ref', 'approval_ref'])) throw new TypeError('invalid-intent');
      if (!REF_RE.request.test(intent.request_ref)
          || (intent.approval_ref !== '' && !REF_RE.approval.test(intent.approval_ref))) throw new TypeError('invalid-intent');
      return;
    case 'monitor-docs':
      if (!hasExactKeys(intent, ['scope'])) throw new TypeError('invalid-intent');
      if (typeof intent.scope !== 'string' || intent.scope.trim().length === 0 || intent.scope.includes('\0') || intent.scope.includes('..')) throw new TypeError('invalid-intent');
      return;
    default:
      throw new TypeError('unknown-entrypoint');
  }
}

function closedSelection(value) {
  const keys = [
    'actual_host',
    'actual_model',
    'actual_role_engine',
    'continuity',
    'fallback_reason',
    'fallback_used',
    'requested_host',
    'requested_model_profile',
    'requested_role_engine',
  ];
  if (!hasExactKeys(value, keys)) return null;
  const result = {};
  for (const key of keys) result[key] = value[key];
  return result;
}

function selectionAllowed(selection) {
  if (!selection) return false;
  const common = selection.requested_host === 'claude'
    && selection.requested_role_engine === 'claude'
    && selection.actual_host === 'claude'
    && selection.actual_role_engine === 'claude';
  if (!common) return false;
  if (selection.fallback_used === false) {
    return selection.continuity === 'session-persistent' && selection.fallback_reason === null;
  }
  return selection.fallback_used === true
    && selection.continuity === 'ephemeral'
    && typeof selection.fallback_reason === 'string'
    && selection.fallback_reason.length > 0;
}

function makeEnvelope(entrypoint, status, detail, selection, actions = [], result = null) {
  const safeStatus = RESULT_STATUSES.includes(status) ? status : 'FAILED';
  return {
    actions: Array.isArray(actions) ? actions : [],
    detail,
    entrypoint,
    result: safeStatus === 'READY' || safeStatus === 'COMPLETED' ? result : null,
    schema: 'runtime/collaboration-entrypoint-result/v1',
    selection,
    status: safeStatus,
  };
}

function resolveSelection(entrypoint, ports) {
  const selection = closedSelection(ports.selection.resolve());
  if (selectionAllowed(selection)) return { ok: true, selection };
  ports.audit.record({
    schema: 'runtime/collaboration-selection-decision/v1',
    decision: 'unavailable',
    entrypoint,
    actual_host: selection ? selection.actual_host : null,
    actual_role_engine: selection ? selection.actual_role_engine : null,
    continuity: selection ? selection.continuity : null,
  });
  return { ok: false, selection };
}

function allSupportRolesReady(status) {
  const roles = status && status.roles && typeof status.roles === 'object' ? status.roles : {};
  return SUPPORT_ROLES.every((role) => roles[role] === 'READY');
}

function actionRefs(value) {
  return value && Array.isArray(value.actions) ? value.actions : [];
}

async function executeActions(ports, actions) {
  for (const action of actions) {
    if (await ports.adapter.executeAction(action) === false) return false;
  }
  return true;
}

function canonicalCompletion(value, expected) {
  if (!value || typeof value !== 'object') return null;
  if (!REF_RE.result.test(value.result_ref)
      || !REF_RE.accepted_result.test(value.accepted_result_ref)
      || !REF_RE.ack.test(value.ack_ref)
      || !DIGEST_RE.test(value.result_digest)
      || !DIGEST_RE.test(value.accepted_result_digest)
      || !DIGEST_RE.test(value.ack_digest)) return null;
  if (expected && expected.subjectRef !== undefined &&
      (value.subject_ref !== expected.subjectRef || value.actor_role !== expected.role)) return null;
  if (expected && expected.requestRef !== undefined && value.request_ref !== expected.requestRef) return null;
  return {
    result_ref: value.result_ref,
    result_digest: value.result_digest,
    accepted_result_ref: value.accepted_result_ref,
    accepted_result_digest: value.accepted_result_digest,
    ack_ref: value.ack_ref,
    ack_digest: value.ack_digest,
  };
}

function canonicalIngestionCompletion(value, expected) {
  if (!value || typeof value !== 'object') return null;
  const keys = [
    'approval_digest', 'approval_ref', 'audit_status', 'disposition',
    'request_digest', 'request_ref', 'result_digest', 'result_ref',
  ];
  if (!hasExactKeys(value, keys)
      || value.request_ref !== expected.requestRef
      || value.approval_ref !== expected.approvalRef
      || value.request_digest !== expected.requestRef.slice('request:'.length)
      || value.approval_digest !== expected.approvalRef.slice('approval:'.length)
      || !REF_RE.result.test(value.result_ref)
      || !DIGEST_RE.test(value.result_digest)
      || !['written', 'deduplicated', 'blocked'].includes(value.disposition)
      || typeof value.audit_status !== 'string' || value.audit_status.length === 0) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

async function executeInit(intent, ports, selection) {
  const current = await ports.lifecycle.status();
  if (intent.mode === 'dashboard' || allSupportRolesReady(current)) {
    return makeEnvelope('init-session', 'READY', 'support-plane-ready', selection, [], current);
  }
  const ensured = await ports.lifecycle.ensureRoles([...SUPPORT_ROLES]);
  const actions = actionRefs(ensured);
  if (!await executeActions(ports, actions)) {
    return makeEnvelope('init-session', 'ACTION_REQUIRED', 'support-plane-action-required', selection, actions);
  }
  const finalStatus = await ports.lifecycle.status();
  if (allSupportRolesReady(finalStatus)) {
    return makeEnvelope('init-session', 'READY', 'support-plane-ready', selection, actions, finalStatus);
  }
  return makeEnvelope('init-session', 'ACTION_REQUIRED', 'support-plane-action-required', selection, actions);
}

async function executeResume(intent, ports, selection) {
  const current = await ports.lifecycle.status();
  const roles = current && current.roles && typeof current.roles === 'object' ? current.roles : {};
  const actions = [];
  for (const role of SUPPORT_ROLES) {
    if (roles[role] === 'READY') continue;
    const digest = crypto.createHash('sha256').update(`${intent.checkpoint_ref}\0${role}`).digest('hex');
    const recovered = await ports.lifecycle.recoverRole({ role, bundle_ref: `bundle:${digest}` });
    actions.push(...actionRefs(recovered));
  }
  if (!await executeActions(ports, actions)) {
    return makeEnvelope('resume-work', 'ACTION_REQUIRED', 'recovery-action-required', selection, actions);
  }
  if (actions.length > 0) return makeEnvelope('resume-work', 'ACTION_REQUIRED', 'recovery-action-required', selection, actions);
  return makeEnvelope('resume-work', 'READY', 'runtime-resumed', selection, [], current);
}

async function executeWork(intent, ports, selection) {
  const coreIntent = { role: intent.role, subject_ref: intent.subject_ref, task: intent.task };
  for (let cycle = 0; cycle <= 32; cycle += 1) {
    const outcome = await ports.lifecycle.invokeRole(coreIntent);
    if (outcome && outcome.status === 'COMPLETED') {
      const result = canonicalCompletion(outcome, { subjectRef: intent.subject_ref, role: intent.role });
      if (!result) return makeEnvelope('work', 'BLOCKED', 'completion-evidence-invalid', selection);
      return makeEnvelope('work', 'COMPLETED', 'work-completed', selection, [], result);
    }
    if (outcome && outcome.status === 'ACTION_REQUIRED') {
      const actions = actionRefs(outcome);
      if (actions.length === 0) return makeEnvelope('work', 'ACTION_REQUIRED', 'work-action-required', selection, []);
      if (cycle === 32) return makeEnvelope('work', 'FAILED', 'action-cycle-limit', selection);
      if (!await executeActions(ports, actions)) {
        return makeEnvelope('work', 'ACTION_REQUIRED', 'work-action-required', selection, actions);
      }
      continue;
    }
    const status = outcome && RESULT_STATUSES.includes(outcome.status) ? outcome.status : 'FAILED';
    return makeEnvelope('work', status, status === 'FAILED' ? 'work-failed' : 'work-terminal', selection, actionRefs(outcome));
  }
  return makeEnvelope('work', 'FAILED', 'action-cycle-limit', selection);
}

async function executeIngest(intent, state, selection) {
  const { ports, ingestionResults } = state;
  if (intent.approval_ref.length === 0) return makeEnvelope('ingest-content', 'BLOCKED', 'approval-required', null);
  const key = `${intent.request_ref}\0${intent.approval_ref}`;
  if (ingestionResults.has(key)) return ingestionResults.get(key);
  const outcome = await ports.consultation.ingest({ request_ref: intent.request_ref, approval_ref: intent.approval_ref });
  if (outcome && outcome.status === 'ACTION_REQUIRED') {
    const actions = actionRefs(outcome);
    if (!await executeActions(ports, actions)) {
      return makeEnvelope('ingest-content', 'ACTION_REQUIRED', 'ingestion-action-required', selection, actions);
    }
    return makeEnvelope('ingest-content', 'ACTION_REQUIRED', 'ingestion-action-required', selection, actions);
  }
  const result = canonicalIngestionCompletion(outcome, {
    requestRef: intent.request_ref,
    approvalRef: intent.approval_ref,
  }) || canonicalCompletion(outcome, { requestRef: intent.request_ref });
  if (!result) return makeEnvelope('ingest-content', 'BLOCKED', 'ingestion-evidence-invalid', selection);
  if (result.disposition === 'blocked') {
    ports.audit.record({ schema: 'runtime/collaboration-ingestion-audit/v1', ...result });
    return makeEnvelope('ingest-content', 'BLOCKED', 'ingestion-blocked', selection);
  }
  const envelope = makeEnvelope('ingest-content', 'COMPLETED', 'ingestion-completed', selection, [], result);
  ports.audit.record({ schema: 'runtime/collaboration-ingestion-audit/v1', ...result });
  ingestionResults.set(key, envelope);
  return envelope;
}

async function executeMonitor(intent, ports, selection) {
  const outcome = await ports.consultation.monitor({ scope: intent.scope });
  if (!outcome || outcome.status === 'FAILED') {
    return makeEnvelope('monitor-docs', 'FAILED', 'monitoring-failed', selection);
  }
  const result = {
    observations: outcome && Array.isArray(outcome.observations) ? outcome.observations : [],
    proposals: outcome && Array.isArray(outcome.proposals) ? outcome.proposals : [],
  };
  return makeEnvelope('monitor-docs', 'COMPLETED', 'monitoring-completed', selection, [], result);
}

async function executeEntrypoint(entrypoint, intent, trustedHostContext) {
  const state = trustedState(trustedHostContext);
  validateIntent(entrypoint, intent);
  if (entrypoint === 'ingest-content' && intent.approval_ref.length === 0) {
    return executeIngest(intent, state, null);
  }
  const resolved = resolveSelection(entrypoint, state.ports);
  if (!resolved.ok) return makeEnvelope(entrypoint, 'UNAVAILABLE', 'selection-unavailable', resolved.selection);
  switch (entrypoint) {
    case 'init-session': return executeInit(intent, state.ports, resolved.selection);
    case 'resume-work': return executeResume(intent, state.ports, resolved.selection);
    case 'work': return executeWork(intent, state.ports, resolved.selection);
    case 'ingest-content': return executeIngest(intent, state, resolved.selection);
    case 'monitor-docs': return executeMonitor(intent, state.ports, resolved.selection);
    default: throw new TypeError('unknown-entrypoint');
  }
}

function decodeCanonicalIntent(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.includes('=')) throw new TypeError('invalid-intent-encoding');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) throw new TypeError('invalid-intent-encoding');
  const text = bytes.toString('utf8');
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid-intent');
  if (consultationOwner.canonicalJSONStringify(value) !== text) throw new TypeError('noncanonical-intent');
  return value;
}

function canonicalIntent(value) {
  return Buffer.from(consultationOwner.canonicalJSONStringify(value), 'utf8').toString('base64url');
}

function digestArgv(command, value) {
  return crypto.createHash('sha256').update(`${command}:${value || ''}`).digest('hex');
}

function workQuestion(intent) {
  return `${intent.subject_ref}\n${intent.task}`;
}

function workRoute(intent) {
  if (intent.role === 'toolkit-specialist') {
    return { kind: 'root-source', requesterRole: 'arch-platform', targetRole: 'toolkit-specialist' };
  }
  const routes = {
    'arch-platform': ['arch-platform', 'context-provider'],
    'arch-testing': ['arch-testing', 'context-provider'],
    'arch-integration': ['arch-integration', 'context-provider'],
    'context-provider': ['arch-platform', 'context-provider'],
    'doc-updater': ['arch-platform', 'doc-updater'],
  };
  const route = routes[intent.role];
  return route ? { kind: 'root-consult', requesterRole: route[0], targetRole: route[1] } : null;
}

function rootSourceActionQuestion(action) {
  try {
    const lines = action.payload.bootstrap_message.split('\n');
    if (lines.length !== 5 || !lines[3].startsWith('publish_command=')) return null;
    const argv = lifecycleOwner.parsePosixDirect(lines[3].slice('publish_command='.length));
    if (!Array.isArray(argv)) return null;
    const index = argv.indexOf('--intent');
    if (index < 0 || index + 1 >= argv.length) return null;
    const decoded = decodeCanonicalIntent(argv[index + 1]);
    return decoded.target_role === 'arch-platform'
      && decoded.expected_result_kind === 'WORK_RESULT'
      && typeof decoded.question === 'string'
      ? decoded.question : null;
  } catch {
    return null;
  }
}

function findUniqueRootSourceAction(projectRoot, question, worktreeId, planDigest) {
  const dir = path.join(lifecycleOwner.registryRepoDir(projectRoot), 'actions');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) {
    return error && error.code === 'ENOENT' ? { ok: true, action: null } : { ok: false };
  }
  if (entries.length > 1024) return { ok: false };
  const now = Date.now();
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const read = lifecycleOwner.readRegistryRecord(path.join(dir, entry.name));
    if (!read.ok || read.absent) return { ok: false };
    const action = read.obj;
    if (!action || action.kind !== 'root-source-spawn') continue;
    if (action.worktree_id !== worktreeId || action.plan_digest !== planDigest) continue;
    const valid = lifecycleOwner.validateRootSourceAction(action);
    if (!valid.ok || rootSourceActionQuestion(action) === null) return { ok: false };
    if (rootSourceActionQuestion(action) !== question) continue;
    const bindings = lifecycleOwner.findRootSourceBindingsByAction(projectRoot, action.action_id);
    if (!bindings.ok || bindings.bindings.length > 1) return { ok: false };
    const liveBeforeBinding = bindings.bindings.length === 0
      && now < Date.parse(action.expires_at)
      && now < Date.parse(action.payload.request_expiry);
    if (bindings.bindings.length === 1 || liveBeforeBinding) matches.push(action);
  }
  return matches.length <= 1 ? { ok: true, action: matches[0] || null } : { ok: false };
}

function findUniqueRootConsultIntent(projectRoot, question, route, worktreeId, planDigest) {
  const dir = path.join(lifecycleOwner.registryRepoDir(projectRoot), 'root-consult-intents');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) {
    return error && error.code === 'ENOENT' ? { ok: true, intent: null } : { ok: false };
  }
  if (entries.length > 4096) return { ok: false };
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const intentId = entry.name.slice(0, -5);
    const read = lifecycleOwner.readRootConsultIntent(projectRoot, intentId);
    if (!read.ok || read.absent) return { ok: false };
    const record = read.intent;
    if (record.worktree_id !== worktreeId || record.plan_digest !== planDigest) continue;
    if (record.requester_role !== route.requesterRole || record.target_role !== route.targetRole) continue;
    if (record.question !== question || record.expected_result_kind !== 'WORK_RESULT' || record.evidence_policy !== 'none') continue;
    matches.push(record);
  }
  return matches.length <= 1 ? { ok: true, intent: matches[0] || null } : { ok: false };
}

function planWorkStep(intent, projectRoot) {
  const route = workRoute(intent);
  if (!route) return { command: null, commandArg: null, roleScope: intent.role };
  const plan = lifecycleOwner.discoverPlan(projectRoot);
  if (!plan.ok) return { command: null, commandArg: null, roleScope: route.requesterRole };
  const question = workQuestion(intent);
  const worktreeId = lifecycleOwner.computeWorktreeId(projectRoot);
  if (route.kind === 'root-source') {
    const found = findUniqueRootSourceAction(projectRoot, question, worktreeId, plan.planDigest);
    if (!found.ok) return { command: null, commandArg: null, roleScope: 'toolkit-specialist' };
    if (found.action) return { command: 'root-source-status', commandArg: found.action.action_id, roleScope: 'toolkit-specialist' };
    const encoded = canonicalIntent({
      expected_result_kind: 'WORK_RESULT',
      question,
      reporting_architect: 'arch-platform',
      source_role: 'toolkit-specialist',
    });
    return { command: 'root-source', commandArg: encoded, roleScope: 'toolkit-specialist' };
  }
  const found = findUniqueRootConsultIntent(projectRoot, question, route, worktreeId, plan.planDigest);
  if (!found.ok) return { command: null, commandArg: null, roleScope: route.requesterRole };
  if (found.intent) return { command: 'consult-root-status', commandArg: found.intent.intent_id, roleScope: route.requesterRole };
  const encoded = canonicalIntent({
    evidence_policy: 'none',
    expected_result_kind: 'WORK_RESULT',
    question,
    requester_role: route.requesterRole,
    target_role: route.targetRole,
  });
  return { command: 'consult-root', commandArg: encoded, roleScope: route.requesterRole };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function regularFiles(dir, pattern, cap) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { return error && error.code === 'ENOENT' ? { ok: true, files: [] } : { ok: false, files: [] }; }
  if (entries.length > cap) return { ok: false, files: [] };
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    let stat;
    try { stat = fs.lstatSync(filePath); } catch { return { ok: false, files: [] }; }
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, files: [] };
    files.push(filePath);
  }
  return { ok: true, files };
}

function resolveIngestionArtifacts(projectRoot, intent) {
  if (intent.approval_ref === '') return { ok: false };
  const planning = path.join(projectRoot, '.planning');
  let waves;
  try { waves = fs.readdirSync(planning, { withFileTypes: true }); }
  catch { return { ok: false }; }
  if (waves.length > 256) return { ok: false };
  const requestDigest = intent.request_ref.slice('request:'.length);
  const approvalDigest = intent.approval_ref.slice('approval:'.length);
  const matches = [];
  for (const wave of waves) {
    if (!wave.isDirectory() || !/^wave-[A-Za-z0-9._-]+$/.test(wave.name)) continue;
    const slug = wave.name.slice('wave-'.length);
    const requests = regularFiles(path.join(planning, wave.name, 'requests', 'ingestion'), /^[A-Za-z0-9._-]+\.json$/, 1024);
    if (!requests.ok) return { ok: false };
    for (const requestPath of requests.files) {
      let digest;
      try { digest = sha256File(requestPath); } catch { return { ok: false }; }
      if (digest !== requestDigest) continue;
      const requestId = path.basename(requestPath, '.json');
      const approvalPath = path.join(planning, wave.name, 'approvals', `${requestId}.json`);
      let approvalStat;
      try { approvalStat = fs.lstatSync(approvalPath); } catch { continue; }
      if (approvalStat.isSymbolicLink() || !approvalStat.isFile()) return { ok: false };
      if (sha256File(approvalPath) !== approvalDigest) continue;
      const requestClassification = lifecycleOwner.classifyIngestionNotifyArtifactSafely(projectRoot, requestPath);
      if (!requestClassification || requestClassification.valid !== true
          || requestClassification.phase !== 'request' || requestClassification.targetRole !== 'doc-updater') continue;
      const resultDir = path.join(planning, wave.name, 'results', 'doc-updater');
      const results = regularFiles(resultDir, /^doc-updater-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{5,}\.json$/, 1024);
      if (!results.ok) return { ok: false };
      const validResults = [];
      for (const resultPath of results.files) {
        const valid = lifecycleOwner.validateIngestionResultForSafely(requestPath, approvalPath, resultPath, projectRoot, slug);
        if (valid && valid.valid === true) validResults.push(resultPath);
      }
      if (validResults.length > 1) return { ok: false };
      matches.push({ approvalPath, requestPath, resultPath: validResults[0] || null, slug });
    }
  }
  return matches.length === 1 ? { ok: true, ...matches[0] } : { ok: false };
}

function ingestionCompletion(projectRoot, intent) {
  const resolved = resolveIngestionArtifacts(projectRoot, intent);
  if (!resolved.ok || !resolved.resultPath) return null;
  let result;
  try { result = JSON.parse(fs.readFileSync(resolved.resultPath, 'utf8')); } catch { return null; }
  const relative = path.relative(projectRoot, resolved.resultPath).split(path.sep).join('/');
  if (!REF_RE.result.test(relative)) return null;
  return {
    approval_digest: intent.approval_ref.slice('approval:'.length),
    approval_ref: intent.approval_ref,
    audit_status: result.audit_status,
    disposition: result.disposition,
    request_digest: intent.request_ref.slice('request:'.length),
    request_ref: intent.request_ref,
    result_digest: sha256File(resolved.resultPath),
    result_ref: relative,
  };
}

function planEntrypointStep(entrypoint, intent, projectRoot) {
  validateIntent(entrypoint, intent);
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new TypeError('invalid-project-root');
  let command = null;
  let commandArg = null;
  let roleScope = null;
  let argvDigest = crypto.createHash('sha256').update(`entrypoint:${entrypoint}:readonly`).digest('hex');
  if (entrypoint === 'init-session') {
    if (intent.mode === 'start') {
      command = 'ensure';
      roleScope = [...SUPPORT_ROLES].sort();
      argvDigest = crypto.createHash('sha256').update('ensure:' + roleScope.join(',')).digest('hex');
    } else {
      command = 'status';
      argvDigest = crypto.createHash('sha256').update('status:').digest('hex');
    }
  } else if (entrypoint === 'resume-work') {
    command = 'ensure';
    roleScope = [...SUPPORT_ROLES].sort();
    argvDigest = digestArgv('ensure', roleScope.join(','));
  } else if (entrypoint === 'work') {
    const step = planWorkStep(intent, projectRoot);
    command = step.command;
    commandArg = step.commandArg;
    roleScope = step.roleScope;
    argvDigest = command === null
      ? digestArgv(`entrypoint:${entrypoint}`, 'blocked')
      : digestArgv(command, commandArg);
  } else if (entrypoint === 'ingest-content' && intent.approval_ref !== '') {
    const resolved = resolveIngestionArtifacts(projectRoot, intent);
    if (resolved.ok && resolved.resultPath === null) {
      command = 'notify';
      commandArg = resolved.requestPath;
      roleScope = 'doc-updater';
      argvDigest = crypto.createHash('sha256').update(`notify:doc-updater:ingestion-request:${sha256File(resolved.requestPath)}`).digest('hex');
    }
  }
  if (commandArg !== null) {
    if (PLAN_COMMAND_ARGS.size >= 256) PLAN_COMMAND_ARGS.delete(PLAN_COMMAND_ARGS.keys().next().value);
    PLAN_COMMAND_ARGS.set(argvDigest, commandArg);
  }
  return Object.freeze({ command, argv_digest: argvDigest, role_scope: roleScope });
}

function plannedEntrypointCommandArgument(plan) {
  if (!hasExactKeys(plan, ['command', 'argv_digest', 'role_scope']) || !DIGEST_RE.test(plan.argv_digest)) return null;
  return PLAN_COMMAND_ARGS.get(plan.argv_digest) || null;
}

function parseCli(argv) {
  if (argv[0] !== 'execute' || argv.length < 7 || argv.length > 11 || argv.length % 2 === 0) throw new TypeError('usage');
  const flags = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--entrypoint', '--project-root', '--intent', '--host-composition', '--lifecycle-binding'].includes(flag) || Object.prototype.hasOwnProperty.call(flags, flag)) throw new TypeError('usage');
    flags[flag] = argv[index + 1];
  }
  if (!ENTRYPOINTS.includes(flags['--entrypoint'])) throw new TypeError('usage');
  if (typeof flags['--project-root'] !== 'string' || !path.isAbsolute(flags['--project-root']) || !fs.existsSync(flags['--project-root'])) throw new TypeError('usage');
  if (flags['--host-composition'] !== undefined && !/^[0-9a-f]{32}$/.test(flags['--host-composition'])) throw new TypeError('usage');
  return {
    entrypoint: flags['--entrypoint'],
    projectRoot: path.resolve(flags['--project-root']),
    intent: decodeCanonicalIntent(flags['--intent']),
    hostComposition: flags['--host-composition'] || null,
    lifecycleBinding: flags['--lifecycle-binding'] || null,
  };
}

function rolesFromLifecycle(result) {
  const roles = {};
  const bindings = result && Array.isArray(result.bindings) ? result.bindings : [];
  for (const binding of bindings) {
    if (binding && typeof binding.role === 'string' && typeof binding.state === 'string') roles[binding.role] = binding.state;
  }
  return { roles, actions: actionRefs(result) };
}

function createProductionPorts(parsed, plan, admission) {
  let invoked = false;
  let cached = null;
  let recoveryReturned = false;
  const commandArg = plannedEntrypointCommandArgument(plan);
  function runPlanned() {
    if (invoked) return cached;
    invoked = true;
    if (plan.command === null) return null;
    const args = [path.join(__dirname, 'runtime-role-lifecycle.cjs'), plan.command, '--project-root', parsed.projectRoot];
    if (plan.command === 'ensure') {
      for (const role of plan.role_scope) args.push('--role', role);
    } else if (plan.command === 'status' && typeof plan.role_scope === 'string') {
      args.push('--role', plan.role_scope);
    } else if (plan.command === 'root-source' || plan.command === 'consult-root') {
      args.push('--intent', commandArg);
    } else if (plan.command === 'root-source-status') {
      args.push('--action', commandArg);
    } else if (plan.command === 'consult-root-status') {
      args.push('--intent-id', commandArg);
    } else if (plan.command === 'notify') {
      args.push('--role', 'doc-updater', '--artifact', commandArg, '--kind', 'ingestion-request');
    }
    args.push('--lifecycle-binding', parsed.lifecycleBinding);
    const child = childProcess.spawnSync(process.execPath, args, { cwd: parsed.projectRoot, encoding: 'utf8' });
    try { cached = JSON.parse(String(child.stdout || '').trim()); } catch { cached = { status: 'FAILED', actions: [] }; }
    return cached;
  }
  const selection = {
    actual_host: admission.actual_host,
    actual_model: admission.actual_model,
    actual_role_engine: admission.actual_role_engine,
    continuity: admission.continuity,
    fallback_reason: null,
    fallback_used: false,
    requested_host: 'claude',
    requested_model_profile: '.claude/model-profiles.json#current',
    requested_role_engine: 'claude',
  };
  return {
    lifecycle: {
      async status() {
        if (plan.command === 'ensure' && !invoked) return { roles: {} };
        return rolesFromLifecycle(runPlanned());
      },
      async ensureRoles() { return runPlanned(); },
      async invokeRole() {
        const value = runPlanned();
        if (value && actionRefs(value).length > 0) return { status: 'ACTION_REQUIRED', actions: actionRefs(value) };
        if (!value) return { status: 'BLOCKED', actions: [] };
        if (value.status === 'READY' && value.operation) {
          return {
            status: 'COMPLETED',
            ...value.operation,
            subject_ref: parsed.intent.subject_ref,
            actor_role: parsed.intent.role,
          };
        }
        if (value.status === 'WAITING' || value.status === 'ACTION_REQUIRED') {
          return { status: 'ACTION_REQUIRED', actions: [] };
        }
        return { status: value.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'BLOCKED', actions: [] };
      },
      async recoverRole() {
        if (recoveryReturned) return { actions: [] };
        recoveryReturned = true;
        return runPlanned() || { actions: [] };
      },
      async stopOwned() { return { actions: [] }; },
    },
    consultation: {
      async consult() { return null; },
      async ingest() {
        if (plan.command === 'notify') {
          const value = runPlanned();
          return { status: 'ACTION_REQUIRED', actions: actionRefs(value) };
        }
        return ingestionCompletion(parsed.projectRoot, parsed.intent);
      },
      async monitor() {
        const tempRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'androidcommondoc-monitor-'));
        const outputPath = path.join(tempRoot, 'monitoring-report.json');
        try {
          const script = path.join(parsed.projectRoot, 'mcp-server', 'build', 'cli', 'monitor-sources.js');
          const child = childProcess.spawnSync(process.execPath, [script, '--project-root', parsed.projectRoot, '--layer', 'L0', '--tier', 'all', '--output', outputPath], {
            cwd: parsed.projectRoot,
            encoding: 'utf8',
            env: { ...process.env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot },
          });
          if (child.status !== 0) return { status: 'FAILED', observations: [], proposals: [] };
          const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
          const details = Array.isArray(report.details) ? report.details : [];
          return { observations: details, proposals: details.filter((item) => item && item.status !== 'reviewed') };
        } catch {
          return { status: 'FAILED', observations: [], proposals: [] };
        } finally {
          try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
        }
      },
    },
    adapter: { async executeAction() { return false; } },
    selection: { resolve() { return selection; } },
    audit: { record() {} },
  };
}

function exitCode(status) {
  if (status === 'READY' || status === 'COMPLETED') return 0;
  if (status === 'ACTION_REQUIRED') return 4;
  if (status === 'BLOCKED') return 5;
  if (status === 'UNAVAILABLE') return 6;
  return 7;
}

async function main(argv) {
  try {
    const parsed = parseCli(argv);
    validateIntent(parsed.entrypoint, parsed.intent);
    const plan = planEntrypointStep(parsed.entrypoint, parsed.intent, parsed.projectRoot);
    if ((plan.command === null) !== (parsed.lifecycleBinding === null)) throw new TypeError('grant-shape-mismatch');
    const consumed = claudeHostOwner.consumeProductionHostComposition(parsed.projectRoot, parsed.hostComposition, {
      entrypoint: parsed.entrypoint,
      argvDigest: plan.argv_digest,
      roleScope: plan.role_scope,
    });
    let envelope;
    if (!consumed.ok) {
      envelope = makeEnvelope(parsed.entrypoint, 'UNAVAILABLE', 'host-composition-unavailable', null);
    } else {
      const context = createTrustedHostContext(createProductionPorts(parsed, plan, consumed.record));
      envelope = await executeEntrypoint(parsed.entrypoint, parsed.intent, context);
    }
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    process.exitCode = exitCode(envelope.status);
  } catch (error) {
    const unavailable = error && error.message === 'grant-shape-mismatch';
    const envelope = makeEnvelope('', unavailable ? 'UNAVAILABLE' : 'FAILED', unavailable ? 'host-composition-unavailable' : 'usage-invalid', null);
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    process.exitCode = unavailable ? 6 : 2;
  }
}

module.exports = { ENTRYPOINTS, RESULT_STATUSES, executeEntrypoint, planEntrypointStep, plannedEntrypointCommandArgument };
if (process.env.NODE_ENV === 'test'
    && process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY === 'p3-entrypoints-v1') {
  module.exports.__TEST_ONLY__createTrustedHostContext = createTrustedHostContext;
}

if (require.main === module) main(process.argv.slice(2));
