'use strict';

function createRootSourceContract(deps) {
  const {
    rootSourceBootstrapLines,
    fs, path, Buffer, RESULT_KIND_RE, ROLE_LIFECYCLE_ACTION_KEYS_SORTED, actionPathFor, canonicalJSONStringify, computeRepoId, computeWorktreeId, coordinationRootPathFor, decodeBase64urlClosedJson,
    discoverPlan, gitRevParse, hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, parsePosixDirect, readRegistryRecord, realpathOrSelf, registryRepoDir, resolvedNodePath,
    s16CoordinationRelativeRef, sha256Buffer, sha256File, validateRootSourceBindingRecord, facadeDirname,
  } = deps;

const ROOT_SOURCE_RESERVATION_SCHEMA = 'runtime/root-source-reservation/v2';
const ROOT_SOURCE_RESERVATION_KEYS = Object.freeze([
  'action_digest', 'action_id', 'canonical_input_digest', 'expiry', 'main_binding_id',
  'model_deviation', 'proposed_input_digest', 'reserved_at', 'runtime_session_key',
  'schema', 'session_generation_id', 'tool_input_digest', 'tool_use_id',
].sort());
const ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA = 'runtime/root-source-reservation-consumed/v1';
const ROOT_SOURCE_RESERVATION_CONSUMED_KEYS = Object.freeze([
  'action_id', 'consumed_at', 'reservation_digest', 'schema',
].sort());
const ROOT_SOURCE_BINDING_SCHEMA = 'runtime/root-source-binding/v1';
const ROOT_SOURCE_BINDING_KEYS = Object.freeze([
  'action_id', 'actor_instance_id', 'agent_id', 'agent_type', 'binding_id',
  'created_at', 'expiry', 'plan_digest', 'reporting_architect', 'request_expiry',
  'role', 'runtime', 'runtime_session_key', 'schema', 'subject_bundle_ref',
  'subject_scope_digest', 'worktree_id',
].sort());
// M7 section 4.2: exact v1 key-set plus session_generation_id, nothing else.
const ROOT_SOURCE_BINDING_SCHEMA_V2 = 'runtime/root-source-binding/v2';
const ROOT_SOURCE_BINDING_KEYS_V2 = Object.freeze(
  ROOT_SOURCE_BINDING_KEYS.concat(['session_generation_id']).sort()
);
const ROOT_SOURCE_INGRESS_SCHEMA = 'runtime/root-ingress/v1';
const ROOT_SOURCE_INGRESS_KEYS = Object.freeze([
  'action_id', 'binding_id', 'created_at', 'plan_digest', 'request_digest',
  'request_expiry', 'request_id', 'requester_instance_id', 'schema', 'source_role',
  'subject_scope_digest', 'target_role', 'worktree_id',
].sort());
const ROOT_SOURCE_RETIREMENT_SCHEMA = 'runtime/root-source-retirement/v1';
const ROOT_SOURCE_RETIREMENT_KEYS = Object.freeze([
  'action_id', 'binding_id', 'reason', 'request_id', 'retired_at', 'schema',
  'terminal_digest', 'terminal_ref',
].sort());
const ROOT_SOURCE_RETIREMENT_REASON_ENUM = Object.freeze([
  'acked', 'cancelled', 'expired', 'subagent-stop', 'agent-return',
]);
const ROOT_SOURCE_SCAN_CAP = 1024;
const ROOT_SOURCE_PUBLISH_INTENT_KEYS = Object.freeze([
  'expected_result_kind', 'expiry', 'question', 'target_role',
].sort());
  const {
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_LEGACY, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V2, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V3, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V4, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V5,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V6, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V7, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V8, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V9, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V10,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V11, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V12, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V13, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V14, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V15,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY,
  } = rootSourceBootstrapLines;

function rootSourceReservationPathFor(projectRootOrRepoDescriptor, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-actions', actionId + '.reservation.json');
}
function rootSourceReservationConsumedPathFor(projectRootOrRepoDescriptor, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-actions', actionId + '.reservation.consumed.json');
}
function rootSourceBindingPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-bindings', bindingId + '.json');
}
function rootSourceIngressPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-bindings', bindingId + '.ingress.json');
}
function rootSourceRetirementPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-bindings', bindingId + '.retired.json');
}
function rootSourceLockDirFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-locks', bindingId + '.lock');
}

function decodeRootSourceBootstrapIntentFromAction(action) {
  const p = action && action.payload;
  if (!p || typeof p.bootstrap_message !== 'string') return { ok: false, reason: 'root-source-bootstrap-absent' };
  const lines = p.bootstrap_message.split('\n');
  if (lines.length !== 5 || lines[0] !== 'ROOT_SOURCE_BOOTSTRAP/v1'
      || lines[1] !== 'plan_ref=' + p.plan_ref
      || lines[2] !== 'subject_bundle_ref=' + p.subject_bundle_ref
      || !lines[3].startsWith('publish_command=')
      || !ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY.includes(lines[4])) {
    return { ok: false, reason: 'root-source-bootstrap-shape-invalid' };
  }
  const argv = parsePosixDirect(lines[3].slice('publish_command='.length));
  if (!Array.isArray(argv) || argv.length !== 11
      || argv[0] !== resolvedNodePath()
      || realpathOrSelf(argv[1]) !== realpathOrSelf(path.join(facadeDirname, 'runtime-consultation.cjs'))
      || argv[2] !== 'publish-request'
      || argv[3] !== '--coordination-root' || !path.isAbsolute(argv[4])
      || argv[5] !== '--plan' || !path.isAbsolute(argv[6])
      || argv[7] !== '--subject-bundle' || !path.isAbsolute(argv[8])
      || argv[9] !== '--intent') return { ok: false, reason: 'root-source-bootstrap-command-invalid' };
  let projectRoot;
  let plan;
  let expectedPlanRef;
  let expectedSubjectRef;
  let subjectBytes;
  try {
    projectRoot = gitRevParse(argv[4], ['rev-parse', '--show-toplevel']);
    plan = discoverPlan(projectRoot);
    expectedPlanRef = s16CoordinationRelativeRef(argv[4], path.join(argv[4], p.plan_ref));
    expectedSubjectRef = s16CoordinationRelativeRef(argv[4], argv[8]);
    subjectBytes = fs.readFileSync(argv[8]);
  } catch (err) { return { ok: false, reason: 'root-source-bootstrap-artifact-unreadable' }; }
  const expectedEmptySubject = Buffer.from(canonicalJSONStringify({ schema: 'coordination/subject-bundle-manifest/v1', entries: [] }), 'utf8');
  if (!plan.ok || realpathOrSelf(argv[6]) !== realpathOrSelf(plan.planPath)
      || plan.planDigest !== action.plan_digest
      || computeRepoId(projectRoot) !== action.repo_id || computeWorktreeId(projectRoot) !== action.worktree_id
      || realpathOrSelf(argv[4]) !== realpathOrSelf(coordinationRootPathFor(projectRoot))
      || expectedPlanRef !== p.plan_ref || expectedSubjectRef !== p.subject_bundle_ref
      || sha256File(path.join(argv[4], p.plan_ref)) !== action.plan_digest
      || !subjectBytes.equals(expectedEmptySubject) || sha256Buffer(subjectBytes) !== p.subject_scope_digest) {
    return { ok: false, reason: 'root-source-bootstrap-scope-mismatch' };
  }
  const decoded = decodeBase64urlClosedJson(argv[10], ROOT_SOURCE_PUBLISH_INTENT_KEYS);
  if (!decoded.ok) return { ok: false, reason: 'root-source-bootstrap-intent-' + decoded.reason };
  const intent = decoded.intent;
  if (intent.target_role !== 'arch-platform'
      || typeof intent.question !== 'string' || intent.question.length === 0 || Buffer.byteLength(intent.question, 'utf8') > 8192
      || !RESULT_KIND_RE.test(intent.expected_result_kind)
      || intent.expiry !== p.request_expiry || !isCanonicalIsoUtc(intent.expiry)) {
    return { ok: false, reason: 'root-source-bootstrap-intent-invalid' };
  }
  return { ok: true, intent, argv, command: lines[3].slice('publish_command='.length) };
}

function decodeRootSourceBootstrapIntentForBinding(projectRootOrRepoDescriptor, binding) {
  const recordValid = validateRootSourceBindingRecord(binding, {});
  if (!recordValid.ok) return recordValid;
  const actionRead = readRegistryRecord(actionPathFor(projectRootOrRepoDescriptor, binding.action_id));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'root-source-action-absent' };
  const decoded = decodeRootSourceBootstrapIntentFromAction(actionRead.obj);
  if (!decoded.ok) return decoded;
  if (actionRead.obj.worktree_id !== binding.worktree_id || actionRead.obj.plan_digest !== binding.plan_digest
      || actionRead.obj.payload.subject_bundle_ref !== binding.subject_bundle_ref
      || actionRead.obj.payload.subject_scope_digest !== binding.subject_scope_digest
      || actionRead.obj.payload.request_expiry !== binding.request_expiry) {
    return { ok: false, reason: 'root-source-bootstrap-binding-mismatch' };
  }
  return { ok: true, intent: decoded.intent };
}

// Sequence 72 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822) standalone Phase
// A scanner repair: split out of validateRootSourceAction's own former
// single body. This envelope half checks ONLY the action's own
// self-contained shape -- exact key set, the one supported
// (schema/kind/runtime/role) union member, every identifier/digest format,
// the payload's own exact key set/types, and canonical timestamps -- and
// deliberately never dereferences the CURRENT on-disk PLAN or decodes the
// bootstrap intent. findLiveRootSourceActionsForRole below calls ONLY this
// half for every historical record it scans, so a structurally valid
// action minted against an OLDER plan digest can be recognized (and
// skipped, once its worktree/plan scope is seen not to match the request)
// without ever running decodeRootSourceBootstrapIntentFromAction's
// PLAN-dereferencing checks against a plan digest that record was never
// minted against. validateRootSourceAction itself stays fully strict and
// behaviorally unchanged: it always calls this envelope check FIRST, then
// the same bootstrap decoder as before, for any caller that still wants
// the complete, PLAN-dereferencing validation of one specific action.
function validateRootSourceActionEnvelope(action) {
  if (!action || !hasExactKeys(action, ROLE_LIFECYCLE_ACTION_KEYS_SORTED)) return { ok: false, reason: 'root-source-action-shape-invalid' };
  if (action.schema !== 'coordination/role-lifecycle-action/v1' || action.kind !== 'root-source-spawn'
      || action.runtime !== 'claude-native' || action.role !== 'toolkit-specialist') return { ok: false, reason: 'root-source-action-union-invalid' };
  if (!isHexActionId(action.action_id) || !isHexDigest64(action.repo_id) || !isHexDigest64(action.worktree_id)
      || !isHexDigest64(action.plan_digest) || !isHexDigest64(action.policy_digest)
      || !isHexCsprng32(action.session_generation_id) || !isCanonicalIsoUtc(action.expires_at)) return { ok: false, reason: 'root-source-action-scope-invalid' };
  const p = action.payload;
  const keys = ['agent_type', 'bootstrap_message', 'name', 'plan_ref', 'reporting_architect', 'request_expiry', 'subject_bundle_ref', 'subject_scope_digest'].sort();
  if (!p || !hasExactKeys(p, keys) || p.agent_type !== 'toolkit-specialist'
      || p.name !== 'toolkit-specialist' || p.reporting_architect !== 'arch-platform'
      || typeof p.bootstrap_message !== 'string' || p.bootstrap_message.length === 0 || Buffer.byteLength(p.bootstrap_message, 'utf8') > 16384
      || typeof p.plan_ref !== 'string' || p.plan_ref.length === 0
      || typeof p.subject_bundle_ref !== 'string' || p.subject_bundle_ref.length === 0
      || !isHexDigest64(p.subject_scope_digest) || !isCanonicalIsoUtc(p.request_expiry)) return { ok: false, reason: 'root-source-action-payload-invalid' };
  return { ok: true };
}

function validateRootSourceAction(action) {
  const envelope = validateRootSourceActionEnvelope(action);
  if (!envelope.ok) return envelope;
  const bootstrap = decodeRootSourceBootstrapIntentFromAction(action);
  if (!bootstrap.ok) return bootstrap;
  return { ok: true };
}


  return Object.freeze({
    ROOT_SOURCE_RESERVATION_SCHEMA, ROOT_SOURCE_RESERVATION_KEYS, ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS, ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_KEYS,
    ROOT_SOURCE_BINDING_SCHEMA_V2, ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_INGRESS_SCHEMA, ROOT_SOURCE_INGRESS_KEYS, ROOT_SOURCE_RETIREMENT_SCHEMA, ROOT_SOURCE_RETIREMENT_KEYS,
    ROOT_SOURCE_RETIREMENT_REASON_ENUM, ROOT_SOURCE_SCAN_CAP, ROOT_SOURCE_PUBLISH_INTENT_KEYS, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_LEGACY, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V2,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V3, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V4, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V5, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V6, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V7,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V8, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V9, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V11, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V10, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V12,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V13, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V14, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V15, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY,
    rootSourceReservationPathFor, rootSourceReservationConsumedPathFor, rootSourceBindingPathFor, rootSourceIngressPathFor, rootSourceRetirementPathFor, rootSourceLockDirFor,
    decodeRootSourceBootstrapIntentFromAction, decodeRootSourceBootstrapIntentForBinding, validateRootSourceActionEnvelope, validateRootSourceAction,
  });
}

module.exports = { createRootSourceContract };

