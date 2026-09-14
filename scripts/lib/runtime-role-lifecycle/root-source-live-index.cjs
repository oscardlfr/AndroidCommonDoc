'use strict';

function createRootSourceLiveIndex(deps) {
  const {
    fs, path, Buffer, RESULT_KIND_RE, ROLE_LIFECYCLE_ACTION_KEYS_SORTED, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY, ROOT_SOURCE_INGRESS_SCHEMA, ROOT_SOURCE_PUBLISH_INTENT_KEYS,
    ROOT_SOURCE_RESERVATION_CONSUMED_KEYS, ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA, ROOT_SOURCE_SCAN_CAP, actionPathFor, canonicalJSONStringify, currentClockMsForRegistry, decodeBase64urlClosedJson,
    hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, isoToMsForRegistry, nowIsoForRegistry, parsePosixDirect, publishNoClobber, readRegistryRecord, registryRepoDir,
    rootSourceBindingPathFor, rootSourceIngressPathFor, rootSourceReservationConsumedPathFor, rootSourceReservationPathFor, sha256String, validateRootSourceAction, validateRootSourceActionEnvelope,
    validateRootSourceBindingFor, validateRootSourceBindingRecord, validateRootSourceIngressRecord, validateRootSourceReservationRecord,
  } = deps;

function findRootSourceBindingsByAction(projectRootOrRepoDescriptor, actionId) {
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-bindings');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return err && err.code === 'ENOENT' ? { ok: true, bindings: [] } : { ok: false, reason: 'root-source-binding-scan-failed' }; }
  if (entries.length > ROOT_SOURCE_SCAN_CAP) return { ok: false, reason: 'root-source-binding-scan-cap-exceeded' };
  const bindings = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    const read = readRegistryRecord(rootSourceBindingPathFor(projectRootOrRepoDescriptor, id));
    if (!read.ok || read.absent) return { ok: false, reason: 'root-source-binding-registry-malformed' };
    const valid = validateRootSourceBindingRecord(read.obj, { binding_id: id });
    if (!valid.ok) return { ok: false, reason: valid.reason };
    if (valid.record.action_id === actionId) bindings.push(valid.record);
  }
  return { ok: true, bindings };
}

const ROOT_SOURCE_ACTION_PAYLOAD_KEYS = Object.freeze([
  'agent_type', 'bootstrap_message', 'name', 'plan_ref', 'reporting_architect',
  'request_expiry', 'subject_bundle_ref', 'subject_scope_digest',
].sort());

/**
 * M6/M7 terminal functional closure, point B: extracts the closed
 * {target_role, question, expected_result_kind, expiry} intent a root-source
 * action's own bootstrap_message embeds, WITHOUT
 * decodeRootSourceBootstrapIntentFromAction's additional script-identity
 * (__dirname-relative runtime-consultation.cjs realpath) and live-filesystem
 * (gitRevParse/discoverPlan/subject-bundle-bytes) checks -- see
 * findRootSourceProvenanceForRequestId's own doc comment for why those are
 * out of scope for evidence-authority provenance. Still validates the exact
 * bootstrap shape/line grammar and argv token count/flag names, and fully
 * decodes+validates the closed --intent payload.
 */
function extractRootSourceBootstrapIntentForProvenance(action) {
  const p = action && action.payload;
  if (!p || typeof p.bootstrap_message !== 'string') return { ok: false, reason: 'root-source-provenance-bootstrap-absent' };
  const lines = p.bootstrap_message.split('\n');
  if (lines.length !== 5 || lines[0] !== 'ROOT_SOURCE_BOOTSTRAP/v1'
      || lines[1] !== 'plan_ref=' + p.plan_ref
      || lines[2] !== 'subject_bundle_ref=' + p.subject_bundle_ref
      || !lines[3].startsWith('publish_command=')
      || !ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY.includes(lines[4])) {
    return { ok: false, reason: 'root-source-provenance-bootstrap-shape-invalid' };
  }
  const argv = parsePosixDirect(lines[3].slice('publish_command='.length));
  if (!Array.isArray(argv) || argv.length !== 11
      || argv[2] !== 'publish-request'
      || argv[3] !== '--coordination-root' || !path.isAbsolute(argv[4])
      || argv[5] !== '--plan' || !path.isAbsolute(argv[6])
      || argv[7] !== '--subject-bundle' || !path.isAbsolute(argv[8])
      || argv[9] !== '--intent') return { ok: false, reason: 'root-source-provenance-bootstrap-command-invalid' };
  const decoded = decodeBase64urlClosedJson(argv[10], ROOT_SOURCE_PUBLISH_INTENT_KEYS);
  if (!decoded.ok) return { ok: false, reason: 'root-source-provenance-bootstrap-intent-' + decoded.reason };
  const intent = decoded.intent;
  if (intent.target_role !== 'arch-platform'
      || typeof intent.question !== 'string' || intent.question.length === 0 || Buffer.byteLength(intent.question, 'utf8') > 8192
      || !RESULT_KIND_RE.test(intent.expected_result_kind)
      || intent.expiry !== p.request_expiry || !isCanonicalIsoUtc(intent.expiry)) {
    return { ok: false, reason: 'root-source-provenance-bootstrap-intent-invalid' };
  }
  return { ok: true, intent };
}

/**
 * M6/M7 terminal functional closure, point B: bounded, fail-closed
 * root-source PROVENANCE lookup for an already-durable ROOT request_id --
 * distinct from validateRootSourceBindingFor's CURRENT-liveness gate (fence/
 * generation/expiry-vs-now). This answers "did a root-source binding
 * genuinely mint this exact root request" as immutable HISTORY: an action
 * whose own expires_at has since passed remains valid provenance once it
 * already produced a real activation (the ingress record existing IS that
 * proof) -- the authority being interpreted here is the one-shot publish
 * that already happened, never a claim that the actor is still live.
 * Scans root-source-bindings/*.ingress.json (the same bounded directory
 * findRootSourceBindingsByAction already scans) for the ingress whose own
 * request_id equals rootRequestId, then fully reopens and cross-validates
 * ingress -> binding -> action -> decoded bootstrap intent. Returns
 * { ok:true, absent:true } when no ingress references this request_id (an
 * ordinary or root-consult-originated root), { ok:false, reason } on more
 * than one match or any malformed candidate, and { ok:true, absent:false,
 * provenance:{ingress,binding,action,bootstrapIntent} } for exactly one
 * validated match.
 */
function findRootSourceProvenanceForRequestId(projectRootOrRepoDescriptor, rootRequestId) {
  if (!isHexActionId(rootRequestId)) return { ok: false, reason: 'root-source-provenance-request-id-invalid' };
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-bindings');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { return err && err.code === 'ENOENT' ? { ok: true, absent: true } : { ok: false, reason: 'root-source-provenance-scan-failed' }; }
  if (entries.length > ROOT_SOURCE_SCAN_CAP * 4) return { ok: false, reason: 'root-source-provenance-scan-cap-exceeded' };
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.ingress\.json$/.test(entry.name)) continue;
    const bindingId = entry.name.slice(0, -'.ingress.json'.length);
    const ingressRead = readRegistryRecord(rootSourceIngressPathFor(projectRootOrRepoDescriptor, bindingId));
    if (!ingressRead.ok) return { ok: false, reason: ingressRead.reason };
    if (ingressRead.absent) continue;
    const ingressValid = validateRootSourceIngressRecord(ingressRead.obj, { binding_id: bindingId });
    if (!ingressValid.ok) return { ok: false, reason: ingressValid.reason };
    if (ingressValid.record.request_id === rootRequestId) matches.push(ingressValid.record);
  }
  if (matches.length === 0) return { ok: true, absent: true };
  if (matches.length > 1) return { ok: false, reason: 'root-source-provenance-ambiguous' };
  const ingress = matches[0];

  const bindingRead = readRegistryRecord(rootSourceBindingPathFor(projectRootOrRepoDescriptor, ingress.binding_id));
  if (!bindingRead.ok) return { ok: false, reason: bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'root-source-provenance-binding-absent' };
  // Historical provenance never requires CURRENT liveness (fence/generation/
  // now-vs-expiry) -- only that the binding is a well-formed v1-or-v2 record
  // (validateRootSourceBindingRecord, the same shape-checker
  // findRootSourceBindingsByAction itself uses), never
  // validateRootSourceBindingFor's liveness-gated variant.
  const bindingValid = validateRootSourceBindingRecord(bindingRead.obj, { binding_id: ingress.binding_id });
  if (!bindingValid.ok) return { ok: false, reason: bindingValid.reason };
  const binding = bindingValid.record;
  if (
    binding.action_id !== ingress.action_id
    || binding.worktree_id !== ingress.worktree_id
    || binding.plan_digest !== ingress.plan_digest
    || binding.subject_scope_digest !== ingress.subject_scope_digest
    || binding.request_expiry !== ingress.request_expiry
  ) return { ok: false, reason: 'root-source-provenance-binding-mismatch' };

  const actionRead = readRegistryRecord(actionPathFor(projectRootOrRepoDescriptor, ingress.action_id));
  if (!actionRead.ok) return { ok: false, reason: actionRead.reason };
  if (actionRead.absent) return { ok: false, reason: 'root-source-provenance-action-absent' };
  const action = actionRead.obj;
  // Deliberately NOT validateRootSourceAction/decodeRootSourceBootstrapIntentFromAction:
  // those additionally enforce that the bootstrap's embedded publish_command
  // names THIS SAME live process's own __dirname-relative runtime-consultation.cjs
  // path -- a spawn-command-integrity concern, not an evidence-authority-
  // provenance one. resolveRootEvidenceAuthority is reached from inside a
  // retained worker, which may legitimately be running its own on-disk copy
  // of this module (e.g. a role read-view) with a DIFFERENT __dirname than
  // wherever the root-source action was originally minted; requiring path
  // equality here would reject genuinely valid provenance for a reason
  // orthogonal to what this lookup exists to prove. The shape/scope checks
  // below are the same fields validateRootSourceAction itself checks, minus
  // that one script-identity assertion.
  if (
    !action || !hasExactKeys(action, ROLE_LIFECYCLE_ACTION_KEYS_SORTED)
    || action.schema !== 'coordination/role-lifecycle-action/v1' || action.kind !== 'root-source-spawn'
    || action.runtime !== 'claude-native' || action.role !== 'toolkit-specialist'
    || !isHexActionId(action.action_id) || !isHexDigest64(action.repo_id) || !isHexDigest64(action.worktree_id)
    || !isHexDigest64(action.plan_digest) || !isHexDigest64(action.policy_digest)
    || !isHexCsprng32(action.session_generation_id) || !isCanonicalIsoUtc(action.expires_at)
  ) return { ok: false, reason: 'root-source-provenance-action-shape-invalid' };
  const p = action.payload;
  if (
    !p || !hasExactKeys(p, ROOT_SOURCE_ACTION_PAYLOAD_KEYS) || p.agent_type !== 'toolkit-specialist'
    || p.name !== 'toolkit-specialist' || p.reporting_architect !== 'arch-platform'
    || typeof p.bootstrap_message !== 'string' || p.bootstrap_message.length === 0 || Buffer.byteLength(p.bootstrap_message, 'utf8') > 16384
    || typeof p.plan_ref !== 'string' || p.plan_ref.length === 0
    || typeof p.subject_bundle_ref !== 'string' || p.subject_bundle_ref.length === 0
    || !isHexDigest64(p.subject_scope_digest) || !isCanonicalIsoUtc(p.request_expiry)
  ) return { ok: false, reason: 'root-source-provenance-action-payload-invalid' };
  if (
    action.worktree_id !== binding.worktree_id || action.plan_digest !== binding.plan_digest
    || p.reporting_architect !== binding.reporting_architect
    || p.subject_bundle_ref !== binding.subject_bundle_ref
    || p.subject_scope_digest !== binding.subject_scope_digest
    || p.request_expiry !== binding.request_expiry
  ) return { ok: false, reason: 'root-source-provenance-action-mismatch' };

  const bootstrap = extractRootSourceBootstrapIntentForProvenance(action);
  if (!bootstrap.ok) return { ok: false, reason: bootstrap.reason };

  return {
    ok: true, absent: false,
    provenance: { ingress, binding, action, bootstrapIntent: bootstrap.intent },
  };
}

// M7 defect 9 (section 6): the per-family scanners this codebase used to
// maintain here (a session+agent+agentType root-source scan, a hook-facing
// resolver additionally filtering by worktree/plan, and a session+agent+
// scope variant deliberately excluding agentType) are removed -- every
// caller now resolves root-source authority through the ONE canonical
// cross-family classifier, classifyClaudeAuthorityForIdentity, which checks
// the fence first and reports more than one live candidate across ANY
// family as ambiguous rather than letting each caller apply its own
// slightly different per-family matching rule. findRootSourceBindingsByAction
// above is kept: it is bounded discovery by action_id for status projection,
// never identity-based authority resolution.

function findLiveRootSourceActionsForRole(projectRootOrRepoDescriptor, role, worktreeId, planDigest, currentCallCorrelation) {
  if (role !== 'toolkit-specialist') return { ok: true, actions: [] };
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'actions');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { return err && err.code === 'ENOENT' ? { ok: true, actions: [] } : { ok: false, reason: 'root-source-action-scan-failed' }; }
  if (entries.length > ROOT_SOURCE_SCAN_CAP) return { ok: false, reason: 'root-source-action-scan-cap-exceeded' };
  // M6-M7-ROOT-SOURCE-EXPIRED-HISTORY-CLOSURE-20260820: ONE clock capture per
  // scan, and a VALID matching action whose expires_at has passed is
  // classified as expired HISTORY (never deleted, never an early return) so
  // it can no longer hide a newer, still-live action for the same
  // worktree/plan. Malformed records still fail closed before any clock
  // classification; a live action with an already-expired request keeps its
  // own explicit deny.
  //
  // ROOT-SOURCE-CORRELATION-01: `currentCallCorrelation` is a strictly
  // OPTIONAL fifth parameter, `undefined` for every pre-existing caller.
  // When omitted, every branch below is BYTE-IDENTICAL to this function's
  // original behavior: >1 live = ambiguous, exactly 1 live = that action
  // (even with expired history), 0 live with expired history =
  // root-source-action-expired, 0 live and no history = []. This is the
  // form every existing test still exercises, unmodified.
  //
  // When supplied (agent-spawn-execution-gate.js's sole production caller
  // only), a candidate no longer needs to be the ONLY historical record in
  // scope to be recognized -- it must instead be the ONLY one whose OWN
  // recorded, non-caller-derived payload (agent_type/name/bootstrap_message)
  // exactly matches THIS call. This never widens which records are
  // eligible: a record must still independently pass
  // validateRootSourceActionEnvelope and validateRootSourceAction (both
  // still unconditional `return`s below, still evaluated before either
  // bucket exists) before it is ever compared at all, so a malformed or
  // never-fully-decoded record's payload is never a trustworthy correlation
  // target. A correlated match against an expired bucket still denies
  // explicitly, never silent passthrough for an identifiable caller reusing
  // an expired authorization; only a call correlating to NOTHING in any
  // bucket is genuinely unrelated to this role's root-source history.
  const nowMs = currentClockMsForRegistry();
  const liveActions = [];
  const requestExpiredActions = [];
  const envelopeExpiredActions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const read = readRegistryRecord(path.join(dir, entry.name));
    if (!read.ok || read.absent) return { ok: false, reason: 'root-source-action-registry-malformed' };
    if (read.obj && read.obj.kind !== 'root-source-spawn') continue;
    // Sequence 72 scanner repair: envelope-validate every record BEFORE
    // ever looking at scope. A structurally invalid record still fails the
    // whole scan closed regardless of scope (never silently skipped as
    // merely out-of-scope). A structurally valid record whose worktree/plan
    // does not match the requested scope is history for a DIFFERENT scope
    // -- skip it without ever running the PLAN-dereferencing full validator
    // against it, so it can no longer block a scan of the CURRENT scope
    // just because it was minted against a different one. Only a record
    // that both envelope-validates AND matches the requested scope is worth
    // the full validateRootSourceAction call (and its resulting
    // live/expired classification below), exactly as before.
    const envelope = validateRootSourceActionEnvelope(read.obj);
    if (!envelope.ok) return { ok: false, reason: envelope.reason };
    if (read.obj.worktree_id !== worktreeId || read.obj.plan_digest !== planDigest) continue;
    const checked = validateRootSourceAction(read.obj);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    if (nowMs >= isoToMsForRegistry(read.obj.expires_at)) { envelopeExpiredActions.push(read.obj); continue; }
    if (nowMs >= isoToMsForRegistry(read.obj.payload.request_expiry)) { requestExpiredActions.push(read.obj); continue; }
    liveActions.push(read.obj);
  }
  if (currentCallCorrelation === undefined) {
    if (requestExpiredActions.length > 0) return { ok: false, reason: 'root-source-request-expired' };
    if (liveActions.length > 1) return { ok: false, reason: 'root-source-action-ambiguous' };
    if (liveActions.length === 0 && envelopeExpiredActions.length > 0) return { ok: false, reason: 'root-source-action-expired' };
    return { ok: true, actions: liveActions };
  }
  const matchesCurrentCall = (a) => (
    currentCallCorrelation.agentType === a.payload.agent_type
    && currentCallCorrelation.name === a.payload.name
    && currentCallCorrelation.prompt === a.payload.bootstrap_message
  );
  const liveMatches = liveActions.filter(matchesCurrentCall);
  if (liveMatches.length > 1) return { ok: false, reason: 'root-source-action-ambiguous' };
  if (liveMatches.length === 1) return { ok: true, actions: liveMatches };
  const requestExpiredMatches = requestExpiredActions.filter(matchesCurrentCall);
  if (requestExpiredMatches.length > 1) return { ok: false, reason: 'root-source-action-ambiguous' };
  if (requestExpiredMatches.length === 1) return { ok: false, reason: 'root-source-request-expired' };
  const envelopeExpiredMatches = envelopeExpiredActions.filter(matchesCurrentCall);
  if (envelopeExpiredMatches.length > 1) return { ok: false, reason: 'root-source-action-ambiguous' };
  if (envelopeExpiredMatches.length === 1) return { ok: false, reason: 'root-source-action-expired' };
  return { ok: true, actions: [] };
}

function findLiveRootSourceReservationsForRole(projectRootOrRepoDescriptor, role) {
  if (role !== 'toolkit-specialist') return { ok: true, reservations: [] };
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-source-actions');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { return err && err.code === 'ENOENT' ? { ok: true, reservations: [] } : { ok: false, reason: 'root-source-reservation-scan-failed' }; }
  if (entries.length > ROOT_SOURCE_SCAN_CAP * 2) return { ok: false, reason: 'root-source-reservation-scan-cap-exceeded' };
  // M67-RS-RESERVATION-EXPIRED-HISTORY-LIVE-01: ONE clock capture per scan
  // (mirrors findLiveRootSourceActionsForRole's own M6-M7-ROOT-SOURCE-EXPIRED-
  // HISTORY-CLOSURE-20260820 fix), and a VALID unconsumed reservation whose
  // expiry has passed is classified as expired HISTORY (never deleted, never
  // an early return) so it can no longer mask a newer, still-live reservation
  // for the same role. Malformed records still fail closed before any clock
  // classification. Only after the whole scan: >1 live = ambiguous, exactly
  // 1 live = that reservation (even with expired history present), 0 live
  // with expired history = root-source-reservation-expired, 0 live and no
  // history = [].
  const nowMs = currentClockMsForRegistry();
  const reservations = [];
  let sawExpiredHistory = false;
  for (const entry of entries) {
    const match = entry.isFile() && /^([0-9a-f]{32})\.reservation\.json$/.exec(entry.name);
    if (!match) continue;
    const actionId = match[1];
    const actionRead = readRegistryRecord(actionPathFor(projectRootOrRepoDescriptor, actionId));
    const reservationRead = readRegistryRecord(rootSourceReservationPathFor(projectRootOrRepoDescriptor, actionId));
    if (!actionRead.ok || actionRead.absent || !reservationRead.ok || reservationRead.absent) return { ok: false, reason: 'root-source-reservation-registry-malformed' };
    const actionValid = validateRootSourceAction(actionRead.obj);
    const reservationValid = validateRootSourceReservationRecord(reservationRead.obj, actionRead.obj);
    if (!actionValid.ok || !reservationValid.ok) return { ok: false, reason: actionValid.ok ? reservationValid.reason : actionValid.reason };
    const consumed = readRegistryRecord(rootSourceReservationConsumedPathFor(projectRootOrRepoDescriptor, actionId));
    if (!consumed.ok) return { ok: false, reason: consumed.reason };
    if (!consumed.absent) {
      const marker = consumed.obj;
      if (!marker || !hasExactKeys(marker, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS)
          || marker.schema !== ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA
          || marker.action_id !== actionId || !isHexDigest64(marker.reservation_digest)
          || marker.reservation_digest !== sha256String(canonicalJSONStringify(reservationValid.record))
          || !isCanonicalIsoUtc(marker.consumed_at)) {
        return { ok: false, reason: 'root-source-reservation-consumed-marker-malformed' };
      }
      continue;
    }
    if (nowMs >= isoToMsForRegistry(reservationValid.record.expiry)) { sawExpiredHistory = true; continue; }
    reservations.push(reservationValid.record);
  }
  if (reservations.length > 1) return { ok: false, reason: 'root-source-reservation-ambiguous' };
  if (reservations.length === 0 && sawExpiredHistory) return { ok: false, reason: 'root-source-reservation-expired' };
  return { ok: true, reservations };
}

function publishRootIngress(projectRootOrRepoDescriptor, binding, fields) {
  const checked = validateRootSourceBindingFor(projectRootOrRepoDescriptor, binding && binding.binding_id, 'toolkit-specialist', binding && binding.worktree_id, binding && binding.plan_digest);
  if (!checked.ok) return checked;
  const f = fields || {};
  const nowStr = nowIsoForRegistry();
  const rec = {
    schema: ROOT_SOURCE_INGRESS_SCHEMA, binding_id: binding.binding_id, action_id: binding.action_id,
    request_id: f.requestId, request_digest: f.requestDigest, source_role: 'toolkit-specialist',
    requester_instance_id: binding.actor_instance_id, target_role: 'arch-platform',
    subject_scope_digest: binding.subject_scope_digest, request_expiry: binding.request_expiry,
    worktree_id: binding.worktree_id, plan_digest: binding.plan_digest, created_at: nowStr,
  };
  const validated = validateRootSourceIngressRecord(rec, {
    binding_id: binding.binding_id, action_id: binding.action_id,
    requester_instance_id: binding.actor_instance_id,
  });
  if (!validated.ok) return validated;
  try { publishNoClobber(rootSourceIngressPathFor(projectRootOrRepoDescriptor, binding.binding_id), Buffer.from(canonicalJSONStringify(rec), 'utf8'), {}); }
  catch (err) { return { ok: false, reason: 'root-source-ingress-publish-failed' }; }
  return { ok: true, ingress: rec };
}

// M7 section 4/8.5: retireRootSourceBinding (the retirement-artifact writer)
// is REMOVED. No new retirement artifact is written for root-source
// bindings -- root-source-status derives its state directly from action ->
// binding -> ingress plus fd-bound transaction terminals (ack.json/
// cancel.json), and authority itself is cut via the fence/generation/expiry
// monotonic cuts, never via a retirement marker.

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// M6+M7 FINAL AUTHORITY CORRECTION (Group 1): CLAUDE-ID-01 full bounded-proof
// gate (PLAN.md Â§15, ~L592). Persistent native-hook requester-binding minting
// for a NAMED role is capability-gated behind a real, empirically-observed
// correlation trace -- never a caller's own claim. Bounded, action- and
// agent-scoped records live under the same host-private registry root every
// other binding type uses, reusing the same lock/read/write primitives. Real observations are
// fed in by subagent-start-context-bundle.js (SubagentStart/SubagentStop) and
// context-provider-gate.js (PreToolUse) BEFORE either hook's own
// createRequesterBinding call site decides whether to proceed.
//
// Required sequence (PLAN.md ~L592, literal order): primary SubagentStart ->
// two DISTINCT PreToolUse tool_use_id values -> a genuine repeated
// SubagentStart for the SAME primary (the "sleep/wake or resume boundary")
// -> one further distinct PreToolUse. session_id/agent_type (the lookup key
// itself) plus raw agent_id must stay stable throughout one action-scoped
// trace; a different agent is recorded only against its own distinct live
// action. There is no session+role, transcript-path, name-prefix, or
// single-live-role fallback. Once complete, the raw primary trace is atomically
// REPLACED by a redacted attestation carrying only scope digests/timestamps/
// counts/booleans -- no raw session_id/agent_id/tool_use_id retained in the
// durable record. A second same-role/different-agent action promotes those
// facts to one generation-scoped capability. SubagentStop removes only the
// exact stopped actor's traces and requester bindings; it never revokes the
// generation capability already proven by both peers.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// CLAUDE-ID-01 modules are composed below after every dependency is initialized.
// P3 U0A1A: host-private Claude peer schema and lookup

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// M7 completeness (2026-08-09, PLAN.md Â§15d, ~L612-614): ClaudeOneShotBinding
// (`runtime/claude-one-shot-binding/v1`) -- the one-shot analog of
// RoleActorBinding/v1 above, for a `claude-agent` Agent()-tool spawn that
// dispatch itself activates (never Agent Teams reuse/lifecycle presence).
// PLAN.md ~L614 names `subagent-start-context-bundle.js` as the owning
// creator: "correlates that exact spawn action to one observed
// {session_id,agent_id,agent_type} ... and creates exactly
// {schema:"runtime/claude-one-shot-binding/v1",...}".
//
// SCOPE (per team-lead-relayed user spec, m7-completeness-verdict-2026-08-09.md
// Block 2, and the already-completed architect review recorded in
// claude-one-shot-binding-red.bats's own COSB-HOOK-NO-ONESHOT-BINDING skip
// reason): this section implements the create/validate primitive pair,
// mirroring every other binding type's create<Type>/validate<Type>For
// convention -- it does NOT perform the correlation itself (exactly like
// createRoleActorBinding/createRequesterBinding never independently verify a
// caller's claimed identity against a live hook trace; that is always the
// CALLER's responsibility). Naive elimination-based minting ("no persistent
// role-binding exists for this role, so it must be one-shot") was correctly
// rejected as a genuine privilege-escalation bug -- that condition is true
// for the overwhelming majority of ALL ordinary ad-hoc specialist/architect
// dispatches, not just genuine one-shot claude-agent ones (confirmed against
// agent-spawn-execution-gate.js's own RoleSpawnExecutionClaim/v1 comment).
//
// STATUS (2026-08-09, retirement-triggers pass, verdict Block 4 -- supersedes
// the original "deferred" note this comment used to carry): the full chain is
// now wired end-to-end, never by elimination. agent-spawn-execution-gate.js
// (PreToolUse) mints a ClaudeAgentSpawnReservation/v1 for a genuine, pre-
// committed spawn action; subagent-start-context-bundle.js (SubagentStart)
// correlates the observed {session_id,agent_id,agent_type} against that exact
// reservation before calling createClaudeOneShotBinding.
//
// SUPERSEDED (2026-08-16, M7 Atomic Revocation Reconciliation, section 4/
// 8.5): the retirement-MARKER-WRITE half of this paragraph (a SubagentStop-
// side identity scan feeding a per-binding no-clobber retirement-marker
// writer on agent-return; runtime-consultation.cjs main()'s
// retire-on-terminal-result/retire-on-cancellation) described a mechanism
// this file no longer implements at all -- both the scanner and the writer
// are removed. No new retirement artifact is written; authority is cut via
// the fence/generation/expiry monotonic cuts (M7 section 6's cross-family
// classifier), and terminal state is read directly off the transaction's
// own fd-bound artifacts (result/ack/cancel), never a synthesized marker.
// Everything else in this paragraph (reservation mint, SubagentStart
// correlation, target-gate grant scoping, expiry enforcement) is unaffected
// by this change. Nothing here ever substitutes a
// RoleActorBinding for this type or vice versa (the two schemas are
// structurally disjoint, closed key-sets, exactly like every other binding
// pair in this file -- see COSB-VALIDATE-ROLEACTORBINDING-SUBSTITUTION).
//
// What remains true today is a SEPARATE, out-of-scope layer, not a gap in
// this wiring: cmdDispatch's own driver-selection (WP3/routing-policy) never
// resolves `selectedDriver` to `claude-agent` today (hardcoded 'noop',
// confirmed by direct read) -- no production call path currently reaches
// this binding's mint call at all, so claude-agent stays UNAVAILABLE for the
// consultation-target surface in practice, but for a routing/driver-selection
// reason, not a missing correlation/retirement primitive. This is now
// EXPLICITLY, TESTABLY verified (not merely inferred from an unrelated WP2
// boundary) via `checkClaudeAgentCapabilityAvailable` below -- a pure,
// unwired helper a future WP3 driver-selection pass should consult BEFORE
// ever selecting claude-agent, ready the same way `findLiveClaudeAgentActivations`
// (runtime-consultation.cjs) already is.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€



// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// M7/WP4 second-pass correction (PLAN.md Â§15b, ~L592): role-command-grant/v1
// -- MINT ONLY. Real consumption (atomic one-time-use validation before any
// read/mutation, PLAN.md ~L604) lives inside runtime-consultation.cjs
// itself, the CLI it exclusively authorizes -- this file cannot be
// `require()`d from there (runtime-consultation.cjs already requires THIS
// file; an rc -> rll require would be circular -- see that file's own
// `hasExactKeys` duplication-precedent comment for the identical
// constraint). Minted here so BOTH context-provider-gate.js (requester
// authority, via a RequesterBinding above) and
// runtime-consultation-target-gate.js (target authority, via an existing
// RoleActorBinding) share ONE mint implementation instead of duplicating it
// across the two hook files.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  return Object.freeze({ findRootSourceBindingsByAction, ROOT_SOURCE_ACTION_PAYLOAD_KEYS, extractRootSourceBootstrapIntentForProvenance, findRootSourceProvenanceForRequestId, findLiveRootSourceActionsForRole, findLiveRootSourceReservationsForRole, publishRootIngress });
}

module.exports = { createRootSourceLiveIndex };

