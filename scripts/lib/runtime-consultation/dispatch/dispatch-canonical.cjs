'use strict';

// `dispatch` command controller: validate capability/routing, delegate driver selection, publish activation/v1 + intent WAL + inbox-ref.

function createDispatchCanonical({
  ACTIVATION_V1_FIELDS,
  CliError,
  DELIVERY_V1_FIELDS,
  DRIVER_ENUM,
  DURABLE_PENDING,
  DURABLE_PRESENT,
  INBOX_REF_V1_FIELDS,
  ROOT_SOURCE_DISPATCH_DRIVERS,
  activationIntentPathFor,
  activationLivenessDeadline,
  activationPathFor,
  assertClosedShape,
  canonicalJSONStringify,
  classifyDurableRead,
  crypto,
  deliveryPathFor,
  inboxPathFor,
  isRootSourceGrantContext,
  nowIso,
  path,
  planRootFromArtifact,
  publishNoClobber,
  readCanonicalRequestRecord,
  readDurableBytesOptional,
  requireFlags,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  selectDispatchDriver,
  sha256Buffer,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// `dispatch` (PLAN.md ~L762, ~L798-810) -- validate capability/routing, publish
// `activation/v1`, publish the requester-owned intent WAL when applicable,
// publish `inbox-ref`, return one non-authoritative `ActivationAction`. WP3
// The `claude-agent` mechanism-readiness check is wired, but it is only a
// necessary precondition: selection remains unavailable until the active
// top-level host supplies the distinct §15d foreground-Agent correlation.
// The remaining non-noop driver branches (SendMessage/bridge argv for
// claude-sendmessage/codex-app-server/codex-mcp/runtime-spawn) still have no
// wired per-request capability-detection machinery and stay WP3-in-progress.
// ─────────────────────────────────────────────────────────────────────────────

// PLAN.md record 5b (~L416): the three driver names whose initial `dispatch`
// durably publishes an `activation-intent/v1` WAL (never `noop`, which has no
// WAL writer at all -- the core writes its delivery record directly instead).
// `codex-app-server`/`codex-mcp` are the two Codex frontends -- their OWN WAL
// writer is the trusted bridge host, only once the scheduler admits/selects
// the item for service, never this per-request `dispatch` call -- so they are
// deliberately NOT members of this set.
const REQUESTER_OWNED_DISPATCH_DRIVERS = Object.freeze(['claude-sendmessage', 'claude-agent', 'runtime-spawn']);

function dispatchCanonical(flags, options) {
  requireFlags(flags, ['coordination-root', 'request']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  // DUR-J item 6: read the request fd-bound-durable ONCE; reuse its accredited digest below.
  // Codex NO-GO round 3 (blocker 1): routed through readCanonicalRequestRecord -- the
  // request's OWN embedded request_id must equal `path.basename(txnDir)`.
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), { absentDetail: 'CORRELATION_INVALID', absentMessage: 'referenced request.json does not resolve' });
  const reqObj = reqRec.obj;
  const planRoot = planRootFromArtifact(coordRoot, requestPath);
  const rootSourceDispatch = !!(options && options.rootSourceDispatch === true);

  // Routing policy must already be materialized at this EXACT immutable snapshot
  // (Ordered Runtime Loop step 2, PLAN.md ~L803) before any driver can be
  // selected; its absence is a genuine "no available driver" signal (CLI-RESULT-04),
  // not a fabricated one -- real per-role route-table selection is WP3.
  const routingPolicyPath = path.join(planRoot, 'routing-policies', reqObj.routing_policy_digest + '.json');
  // DUR-J: the routing policy is a no-clobber-materialized record. A genuinely absent
  // one is the legitimate "no driver available" signal (UNAVAILABLE/CLI-RESULT-04); an
  // nlink==2 / symlink / foreign-owner / malformed policy STOPs (readDurableBytesOptional
  // throws) instead of being mistaken for "absent" -- an in-flight or tampered policy
  // must never read as "no driver".
  const routingPolicyBytes = readDurableBytesOptional(routingPolicyPath);
  if (routingPolicyBytes === null) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'no routing policy materialized for this plan-root; no driver available');
  }
  // R2-B (M6-M7-R2-INTEGRITY-CLOSURE-20260820): the path above is
  // content-addressed by NAMING CONVENTION only -- it does not itself prove
  // the bytes just read are genuinely the ones the request was correlated
  // against at publish time. Hash the SAME bytes already read (never a
  // second read) and require exact equality with the request's own
  // routing_policy_digest before parsing or selecting any driver. A mismatch
  // means the materialized snapshot was rewritten in place after publish
  // (same path, different content) -- fail closed with the same
  // INVALID/CORRELATION_INVALID shape every other request<->artifact
  // correlation check in this file already uses, before any
  // ActivationAction/grant/driver selection can occur.
  if (sha256Buffer(routingPolicyBytes) !== reqObj.routing_policy_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'materialized routing policy bytes do not match request routing_policy_digest: ' + routingPolicyPath);
  }
  // WP3 fix: real per-role route-table selection (PLAN.md Routing Registry:
  // "runtime-routing.json chooses a connector for one consultation attempt").
  // Uses the request's OWN pinned, content-addressed snapshot -- never the live
  // scripts/lib/runtime-routing.json -- so a routing.json edit after publish
  // can never silently change an in-flight request's route table. Iterates
  // the pinned, routing-preference-ordered driver list and selects the FIRST
  // one this dispatch can honestly prove capable: `claude-agent` is the one
  // non-noop driver with a real, wired mechanism-readiness check today
  // (`checkClaudeAgentCapabilityAvailable`, PLAN.md §15d), but that check is
  // not itself sufficient to select the driver.
  // `claude-sendmessage`/`codex-app-server`/`codex-mcp`/`runtime-spawn` still
  // require the RoleLifecycleController/runtime-bridge-codex.cjs
  // capability-detection machinery that does not exist yet for a PER-REQUEST
  // dispatch (WP3-in-progress) and are therefore never selected without real
  // proof -- `noop` is guaranteed present in `allowedDrivers` (checked above)
  // and remains the honest final fallback.
  let routingPolicyObj;
  try {
    routingPolicyObj = JSON.parse(routingPolicyBytes.toString('utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'materialized routing policy is not valid JSON: ' + routingPolicyPath);
  }
  const allowedDrivers = routingPolicyObj && routingPolicyObj.routes ? routingPolicyObj.routes[reqObj.target_role] : undefined;
  if (!Array.isArray(allowedDrivers) || !allowedDrivers.includes('noop')) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'no honestly-selectable driver for target_role ' + reqObj.target_role + ' in the pinned routing policy');
  }
  // M6-M7-LIVE-FUNCTIONAL-ACCEPTANCE-20260820 fix round 1: requiredDriver is
  // validated and applied as a hard candidate filter BEFORE/DURING ordinary
  // priority-order selection, never merely checked against whatever ordinary
  // selection already picked -- an already-live higher-priority candidate
  // (e.g. claude-agent) must never win over a live REQUIRED lower-priority
  // one (e.g. codex-app-server); each candidate's own existing liveness proof
  // is unchanged, only which candidates are even considered.
  // WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822 mandatory driver fallback:
  // resolved here (moved up from just before activationPath below) because
  // the exclusion logic that follows needs the CURRENT authoritative attempt
  // -- if a canonical takeover has already superseded the initial attempt,
  // every candidate below is being selected for that NEW attempt, never the
  // superseded one.
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  const attemptId = auth.attemptId;
  const leaseEpoch = auth.leaseEpoch;
  let requiredDriver = options && options.requiredDriver;
  if (requiredDriver !== undefined && (!DRIVER_ENUM.includes(requiredDriver) || requiredDriver === 'noop')) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'required dispatch driver is invalid');
  }
  // Once a canonical takeover has superseded this request's initial attempt,
  // this dispatch call is for the NEW attempt -- the driver selected for the
  // superseded attempt must never be reselected here, even if it currently
  // reports itself live again (it already failed THIS request once). Read
  // straight off the superseded attempt's own durable activation record; no
  // new schema field is needed (the takeover binding itself never needs to
  // know which driver it superseded, only that one did). A caller-required
  // driver (the root-source caller always requires codex-app-server) that
  // turns out to be exactly the excluded one is never honored -- silently
  // fall through to ordinary priority-order selection among the remaining
  // candidates instead of throwing; that is precisely what this recovery
  // must do once codex-app-server itself is the excluded driver.
  let excludedDriver = null;
  if (attemptId !== reqObj.initial_attempt_id) {
    const supersededActivationRead = classifyDurableRead(activationPathFor(txnDir, reqObj.initial_attempt_id), { parse: true });
    if (supersededActivationRead.state === DURABLE_PRESENT) {
      assertClosedShape(supersededActivationRead.obj, ACTIVATION_V1_FIELDS);
      excludedDriver = supersededActivationRead.obj.selected_driver;
    }
  }
  if (requiredDriver !== undefined && requiredDriver === excludedDriver) {
    requiredDriver = undefined;
  }

  const { selectedDriver, selectedClaudePeerBinding, selectedClaudeResumeHandle } = selectDispatchDriver({
    allowedDrivers, rootSourceDispatch, requiredDriver, excludedDriver, coordRoot, reqObj,
  });

  if (rootSourceDispatch && !ROOT_SOURCE_DISPATCH_DRIVERS.includes(selectedDriver)) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'no live root-source target driver is available for ' + reqObj.target_role);
  }
  if (requiredDriver !== undefined && selectedDriver !== requiredDriver) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'required dispatch driver is not currently live: ' + requiredDriver);
  }

  // P4 Windows native-Claude persistence correction: claude-sendmessage's
  // OWN native binding id/teammate name resolve from WHICHEVER of the two
  // live proofs above actually selected it -- a full ClaudePeerBinding
  // (preferred) or, only when that was not yet available, a unique live
  // bootstrap resume handle for the exact same target scope. Exactly one of
  // the two is ever non-null when selectedDriver === 'claude-sendmessage'.
  const claudeSendMessageTargetBindingId = selectedDriver === 'claude-sendmessage'
    ? (selectedClaudePeerBinding ? selectedClaudePeerBinding.binding_id : selectedClaudeResumeHandle.binding_id)
    : null;
  const claudeSendMessageTeammateName = selectedDriver === 'claude-sendmessage'
    ? (selectedClaudePeerBinding ? selectedClaudePeerBinding.teammate_name : selectedClaudeResumeHandle.teammate_name)
    : null;

  const activationPath = activationPathFor(txnDir, attemptId);
  const idempotentRecovery = !!(options && options.allowIdenticalIdempotent === true);
  let existingActivation = null;
  const existingActivationRead = classifyDurableRead(activationPath, { parse: true });
  if (existingActivationRead.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'activation is still pending during dispatch recovery');
  }
  if (existingActivationRead.state === DURABLE_PRESENT) {
    assertClosedShape(existingActivationRead.obj, ACTIVATION_V1_FIELDS);
    existingActivation = existingActivationRead.obj;
    if (
      existingActivation.request_id !== reqObj.request_id
      || existingActivation.request_digest !== reqRec.digest
      || existingActivation.attempt_id !== attemptId || existingActivation.lease_epoch !== leaseEpoch
      || existingActivation.target_role_profile_digest !== reqObj.target_role_profile_digest
      || existingActivation.routing_policy_version !== reqObj.routing_policy_version
      || existingActivation.routing_policy_digest !== reqObj.routing_policy_digest
      || existingActivation.selected_driver !== selectedDriver
      || existingActivation.native_target_binding_id !== claudeSendMessageTargetBindingId
      || existingActivation.activation_liveness_expiry !== activationLivenessDeadline(reqObj)
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'existing activation does not match deterministic dispatch recovery');
    if (!idempotentRecovery) existingActivation = null; // preserve ordinary dispatch's no-clobber replay rejection.
  }
  const now = existingActivation ? existingActivation.created_at : nowIso();
  // Core-generated opaque one-shot action id (PLAN.md §15d: "Dispatch first
  // commits request, activation (including core-generated
  // native_spawn_action_id)..."), required only for claude-agent; null for
  // every other driver (activation/v1's own field constraint, unchanged).
  const nativeSpawnActionId = existingActivation
    ? existingActivation.native_spawn_action_id
    : (selectedDriver === 'claude-agent' ? crypto.randomBytes(16).toString('hex') : null);
  const activationObj = {
    schema: 'coordination/activation/v1',
    version: 1,
    request_id: reqObj.request_id,
    request_digest: reqRec.digest,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    target_role_profile_digest: reqObj.target_role_profile_digest,
    routing_policy_version: reqObj.routing_policy_version,
    routing_policy_digest: reqObj.routing_policy_digest,
    selected_driver: selectedDriver,
    native_target_binding_id: claudeSendMessageTargetBindingId,
    native_spawn_action_id: nativeSpawnActionId,
    created_at: now,
    activation_liveness_expiry: activationLivenessDeadline(reqObj),
  };
  assertClosedShape(activationObj, ACTIVATION_V1_FIELDS);
  publishNoClobber(activationPath, Buffer.from(canonicalJSONStringify(activationObj), 'utf8'), {
    allowIdenticalIdempotent: idempotentRecovery,
    raceDetailCode: 'AUTHORITY_INVALID',
  });

  // Requester-owned accelerators (claude-sendmessage/claude-agent/runtime-spawn)
  // durably publish their intent WAL here, after activation and before inbox
  // exposure/action return (record 5b, PLAN.md ~L416-430: "initial dispatch
  // writes it durably after activation and before inbox exposure/action
  // return"). `noop` has no WAL writer at all -- the core instead writes the
  // noop delivery record directly (Activation Drivers table, PLAN.md ~L848:
  // "Receipt writer: delivery/<attempt_id>.json records driver:'noop'
  // explicitly").
  if (REQUESTER_OWNED_DISPATCH_DRIVERS.includes(selectedDriver)) {
    const activationIntentObj = {
      schema: 'coordination/activation-intent/v1',
      request_digest: reqRec.digest,
      attempt_id: attemptId,
      lease_epoch: leaseEpoch,
      driver: selectedDriver,
      commit_point_pending: true,
      created_at: now,
    };
    publishNoClobber(
      activationIntentPathFor(txnDir, attemptId),
      Buffer.from(canonicalJSONStringify(activationIntentObj), 'utf8'),
      { raceDetailCode: 'AUTHORITY_INVALID' },
    );
  } else if (selectedDriver === 'noop') {
    const deliveryObj = {
      schema: 'coordination/delivery/v1',
      request_id: reqObj.request_id,
      attempt_id: attemptId,
      lease_epoch: leaseEpoch,
      driver: 'noop',
      claim_digest: null,
      commit_point: null,
      commit_point_at: null,
      created_at: now,
      delivered: false,
      outcome: null,
      detail_code: 'NONE',
    };
    assertClosedShape(deliveryObj, DELIVERY_V1_FIELDS);
    publishNoClobber(
      deliveryPathFor(txnDir, attemptId),
      Buffer.from(canonicalJSONStringify(deliveryObj), 'utf8'),
      { allowIdenticalIdempotent: true },
    );
  }

  const inboxPath = inboxPathFor(planRoot, reqObj.target_role, reqObj.request_id);
  let inboxCreatedAt = now;
  // WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822: read any EXISTING,
  // request-correlated inbox-ref and reuse its created_at UNCONDITIONALLY --
  // not only when the caller opted into idempotentRecovery. inbox-ref is
  // keyed by (target_role, request_id) alone, deliberately attempt-agnostic:
  // "this request entered this role's inbox" is a fact about the REQUEST,
  // not about any one attempt, so every dispatch for the same request must
  // converge on the SAME inbox-ref bytes. Before this fix, a legitimate
  // post-takeover redispatch (a different attempt_id, same request_id) always
  // computed a fresh inboxCreatedAt and lost the no-clobber race against the
  // first dispatch's already-durable inbox-ref with AUTHORITY_INVALID,
  // making the mandatory driver-fallback recovery unreachable in practice --
  // confirmed by WAVE1-E2E-02-DRIVER-FALLBACK across four independent
  // reproductions. Deterministically converging on the first writer's
  // timestamp costs nothing: attempt/epoch fencing (the actual authority
  // boundary) is enforced by claim/lease/result validation elsewhere, never
  // by this notification-only artifact's created_at.
  const existingInbox = classifyDurableRead(inboxPath, { parse: true });
  if (existingInbox.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'inbox ref is still pending during dispatch');
  }
  if (existingInbox.state === DURABLE_PRESENT) {
    assertClosedShape(existingInbox.obj, INBOX_REF_V1_FIELDS);
    if (
      existingInbox.obj.request_id !== reqObj.request_id
      || existingInbox.obj.request_digest !== reqRec.digest
      || existingInbox.obj.target_role !== reqObj.target_role
      || existingInbox.obj.kind !== 'consult'
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'existing inbox ref does not match this request');
    inboxCreatedAt = existingInbox.obj.created_at;
  }
  const inboxRefObj = {
    schema: 'coordination/inbox-ref/v1',
    request_id: reqObj.request_id,
    request_digest: reqRec.digest,
    kind: 'consult',
    target_role: reqObj.target_role,
    created_at: inboxCreatedAt,
  };
  assertClosedShape(inboxRefObj, INBOX_REF_V1_FIELDS);
  publishNoClobber(
    inboxPath,
    Buffer.from(canonicalJSONStringify(inboxRefObj), 'utf8'),
    { allowIdenticalIdempotent: true },
  );

  // PLAN's frozen ActivationAction union: every caller-executed arm carries
  // the exact common correlation fields, then only its closed driver payload.
  // Neither action is authority or evidence; activation/WAL/inbox are already
  // durable before this transient descriptor becomes visible.
  let activationAction = null;
  const commonActivationAction = {
    schema: 'coordination/activation-action/v1',
    request_id: reqObj.request_id,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    selected_driver: selectedDriver,
    target_role: reqObj.target_role,
    request_artifact_path: requestPath,
    activation_artifact_path: activationPath,
  };
  if (selectedDriver === 'claude-sendmessage') {
    // A JSON-looking string is semantically valid for SendMessage, but native
    // Claude can project it as an object before PreToolUse schema validation.
    // Keep the pointer canonical while making its string type unmistakable at
    // the host boundary; the receiver still gets one self-contained message.
    const message = 'COORDINATION_CONSULT/v1\n' + canonicalJSONStringify({
      role: reqObj.source_role,
      target_role: reqObj.target_role,
      request_id: reqObj.request_id,
      artifact_path: requestPath,
      kind: 'consult',
    });
    activationAction = {
      ...commonActivationAction,
      kind: 'claude-sendmessage',
      target_name: claudeSendMessageTeammateName,
      message,
    };
  } else if (selectedDriver === 'claude-agent') {
    activationAction = {
      ...commonActivationAction,
      kind: 'claude-agent',
      agent_type: reqObj.target_role,
      spawn_action_id: nativeSpawnActionId,
      bootstrap_message: {
        role: reqObj.source_role,
        target_role: reqObj.target_role,
        request_id: reqObj.request_id,
        artifact_path: requestPath,
        activation_path: activationPath,
        kind: 'consult-one-shot',
      },
    };
  }
  return { request_id: reqObj.request_id, artifact_ref: activationPath, activation_action: activationAction };
}
function cmdDispatch(flags, grantContext) {
  // Driver selection belongs to the target's pinned route and current live
  // capability evidence. A root-source grant authenticates the requester;
  // it does not imply that requester is backed by codex-app-server. Claude
  // native root sources are legitimate after the exact reporting architect
  // binding has been validated, and must therefore be able to select their
  // unique claude-sendmessage target instead of being forced onto an absent
  // Codex worker. Retained Codex bridge children still use the separate
  // in-process dispatchCanonical(...,{requiredDriver:'codex-app-server'})
  // call in hostBridgePublishChildRequest above.
  return dispatchCanonical(flags, {
    rootSourceDispatch: isRootSourceGrantContext(grantContext),
  });
}

  return Object.freeze({
    REQUESTER_OWNED_DISPATCH_DRIVERS,
    cmdDispatch,
    dispatchCanonical,
  });
}

module.exports = { createDispatchCanonical };
