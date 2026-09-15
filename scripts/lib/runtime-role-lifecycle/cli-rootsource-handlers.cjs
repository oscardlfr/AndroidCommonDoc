'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the root-source,
// root-source-status, probe, and status CLI subcommand handlers. Never
// requires the facade or a sibling module.

function createCliRootSourceHandlers({
path, fs, Buffer, canonicalJSONStringify, sha256String, registryRepoDir, readRegistryRecord,
  SUBCOMMAND_SPEC, parseSubcommandArgv, RC, CANONICAL_ROLES, usageError, invalidError, unavailableError, emitAndExit, makeResult,
  makeOperation, s16ResolveMainContext, s16MaterializeCommonArtifacts, decodeRootSourceIntent,
  readRoleBindingState, roleProfileDigestFor, findUniqueClaudeResumeHandleForTarget,
  findUniqueConsumedClaudeResumeHandleForBusyTarget, retainedSupervisorBridgeApi,
  generateActionId, renderPosixDirect, resolvedNodePath, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE,
  effectiveActionTtlSeconds, mintRoleLifecycleAction, safeExpiryIsoForRegistry, actionForEnvelope,
  validateRootSourceAction, actionPathFor, findRootSourceBindingsByAction, rootSourceIngressPathFor,
  hasExactKeys, ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_BINDING_SCHEMA_V2, computeClaudeAuthorityIdentityId,
  readClaudeAuthorityFence, validateRootSourceIngressRecord, s16ConsultationApi, currentClockMsForRegistry,
  isoToMsForRegistry, resolvePolicyPair, validateAndConsumeLifecycleCommandGrant, discoverPlan,
  computeWorktreeId,
}) {

function handleRootSource(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['root-source']);
  if (!parsed.ok || !path.isAbsolute(parsed.values['--project-root'])) { usageError('root-source'); return; }
  const projectRoot = parsed.values['--project-root'];
  const encodedIntent = parsed.values['--intent'];
  const decoded = decodeRootSourceIntent(encodedIntent);
  if (!decoded.ok) { invalidError('root-source', 'POLICY_INVALID'); return; }
  const context = s16ResolveMainContext(
    projectRoot, parsed.values['--lifecycle-binding'], sha256String('root-source:' + encodedIntent),
    'toolkit-specialist', 'root-source', null, true,
  );
  if (!context.ok) { invalidError('root-source', 'IDENTITY_MISMATCH'); return; }
  // Validate one live reporting architect before any materialization. P4's
  // Claude-native support plane uses the canonical peer-custody binding; P5's
  // retained Codex lane remains an exact fallback using the same disk
  // protocol. Never select by role text alone and never require Codex when a
  // valid same-session Claude peer already owns arch-platform.
  const claudeArchitectRole = readRoleBindingState(
    projectRoot, context.worktreeId, context.plan.planDigest,
    roleProfileDigestFor('arch-platform'), context.generation.generationId,
    'arch-platform',
  );
  let reportingArchitectAvailable = Boolean(
    claudeArchitectRole.ok && claudeArchitectRole.state === 'READY'
    && claudeArchitectRole.record.driver === 'claude-sendmessage'
  );
  // A completed persistent Claude task is parked as WAITING between messages.
  // Treat it as the same available reporting architect only when the unique,
  // unconsumed resume handle proves the exact current session/worktree/PLAN/
  // role tuple and its backing RoleActorBinding and authority fence are still
  // valid. WAITING by itself remains unavailable and therefore fail-closed.
  if (
    !reportingArchitectAvailable && claudeArchitectRole.ok
    && claudeArchitectRole.state === 'WAITING'
    && claudeArchitectRole.record.driver === 'claude-sendmessage'
  ) {
    const parkedArchitect = findUniqueClaudeResumeHandleForTarget(projectRoot, {
      sessionDigest: sha256String(context.binding.runtime_session_key),
      worktreeId: context.worktreeId,
      planDigest: context.plan.planDigest,
      targetRole: 'arch-platform',
    });
    reportingArchitectAvailable = Boolean(parkedArchitect.ok && parkedArchitect.record);
  }
  // A successfully delivered resume consumes the parked handle and moves
  // the exact same persistent actor WAITING -> BUSY.  BUSY is therefore the
  // normal state at the P4 work boundary, not an unavailable architect.
  // Re-prove the exact consumed resume handle, current session/role/worktree/
  // PLAN actor binding and its authority fence before accepting it; the role-
  // binding state alone never grants this continuation. A bootstrap-only
  // actor has no guaranteed post-ready PreToolUse, so requiring a separately
  // observed ClaudePeerBinding here would make this valid boundary
  // unreachable on the native host.
  if (
    !reportingArchitectAvailable && claudeArchitectRole.ok
    && claudeArchitectRole.state === 'BUSY'
    && claudeArchitectRole.record.driver === 'claude-sendmessage'
  ) {
    const resumedArchitect = findUniqueConsumedClaudeResumeHandleForBusyTarget(projectRoot, {
      generationId: context.generation.generationId,
      sessionDigest: sha256String(context.binding.runtime_session_key),
      worktreeId: context.worktreeId,
      planDigest: context.plan.planDigest,
      targetRole: 'arch-platform',
    }, claudeArchitectRole.record);
    reportingArchitectAvailable = Boolean(resumedArchitect.ok && resumedArchitect.record);
  }
  if (!reportingArchitectAvailable) {
    let bridge = null;
    try { bridge = retainedSupervisorBridgeApi(); } catch (err) { bridge = null; }
    const architect = bridge && typeof bridge.resolveLiveCodexAppServerWorker === 'function'
      ? bridge.resolveLiveCodexAppServerWorker(projectRoot, 'arch-platform', roleProfileDigestFor('arch-platform'))
      : null;
    reportingArchitectAvailable = Boolean(
      architect && architect.ok && architect.available
      && architect.worker.sessionGenerationId === context.generation.generationId
    );
  }
  if (!reportingArchitectAvailable) { unavailableError('root-source', 'CAPABILITY_UNAVAILABLE'); return; }
  const artifacts = s16MaterializeCommonArtifacts(projectRoot, context);
  if (!artifacts.ok) { invalidError('root-source', 'DURABILITY_UNPROVEN'); return; }
  const actionId = generateActionId();
  const publishIntent = Buffer.from(canonicalJSONStringify({
    target_role: 'arch-platform', question: decoded.intent.question,
    expected_result_kind: decoded.intent.expected_result_kind, expiry: context.requestExpiry,
  }), 'utf8').toString('base64url');
  const publishCommand = renderPosixDirect([
    resolvedNodePath(), path.join(__dirname, '..', 'runtime-consultation.cjs'), 'publish-request',
    '--coordination-root', context.coordRoot,
    '--plan', context.plan.planPath,
    '--subject-bundle', path.join(artifacts.planRoot, 'subject-bundles', artifacts.subjectScopeDigest, 'manifest.json'),
    '--intent', publishIntent,
  ]);
  const bootstrapMessage = [
    'ROOT_SOURCE_BOOTSTRAP/v1',
    'plan_ref=' + artifacts.planRef,
    'subject_bundle_ref=' + artifacts.subjectBundleRef,
    'publish_command=' + publishCommand,
    ROOT_SOURCE_BOOTSTRAP_FINAL_LINE,
  ].join('\n');
  const payload = {
    agent_type: 'toolkit-specialist', name: 'toolkit-specialist', bootstrap_message: bootstrapMessage,
    reporting_architect: 'arch-platform', plan_ref: artifacts.planRef,
    subject_bundle_ref: artifacts.subjectBundleRef, subject_scope_digest: artifacts.subjectScopeDigest,
    request_expiry: context.requestExpiry,
  };
  const ttl = effectiveActionTtlSeconds(context.pair.policy, context.binding.expiry, {
    kind: 'root-source-spawn', runtime: 'claude-native',
  });
  if (!ttl.ok) { invalidError('root-source', 'INTERNAL_ERROR'); return; }
  const actionExpiryMs = Math.min(
    currentClockMsForRegistry() + ttl.ttlSeconds * 1000,
    isoToMsForRegistry(context.generation.expiresAt), isoToMsForRegistry(context.requestExpiry),
  );
  const minted = mintRoleLifecycleAction(
    projectRoot, actionId, 'root-source-spawn', 'claude-native', context.repoId,
    context.worktreeId, context.plan.planDigest, sha256String(canonicalJSONStringify(context.pair.routing)),
    context.generation.generationId, 'toolkit-specialist', payload,
    safeExpiryIsoForRegistry(actionExpiryMs),
  );
  if (!minted.ok) { invalidError('root-source', 'INTERNAL_ERROR'); return; }
  emitAndExit(makeResult('root-source', RC.OK, 'ACTION_REQUIRED', 'NONE', [], [actionForEnvelope(minted.action)], makeOperation('root-source', actionId, 'ACTION_REQUIRED', {})));
}

function handleRootSourceStatus(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['root-source-status']);
  if (!parsed.ok || !path.isAbsolute(parsed.values['--project-root'])) { usageError('root-source-status'); return; }
  const projectRoot = parsed.values['--project-root'];
  const actionId = parsed.values['--action'];
  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent || !actionRead.obj || actionRead.obj.kind !== 'root-source-spawn') { invalidError('root-source-status', 'IDENTITY_MISMATCH'); return; }
  const action = actionRead.obj;
  const actionValid = validateRootSourceAction(action);
  if (!actionValid.ok) { invalidError('root-source-status', 'IDENTITY_MISMATCH'); return; }
  const context = s16ResolveMainContext(
    projectRoot, parsed.values['--lifecycle-binding'], sha256String('root-source-status:' + actionId),
    'toolkit-specialist', 'root-source-status', actionId, false,
  );
  // M7 section 9 (defect 8): a read-only root-source-status invocation
  // deliberately does NOT require action.session_generation_id to equal the
  // CURRENT generation -- that one existing handler equality gate is
  // removed only for THIS read-only command, so an old-generation binding
  // can still reach the generation-cut projection below (a NEW,
  // binding-level check, not this one) and project BLOCKED. No create,
  // grant, or mutating command receives this exception.
  if (!context.ok || action.worktree_id !== context.worktreeId || action.plan_digest !== context.plan.planDigest) {
    invalidError('root-source-status', 'IDENTITY_MISMATCH'); return;
  }
  const bindings = findRootSourceBindingsByAction(projectRoot, actionId);
  if (!bindings.ok || bindings.bindings.length > 1) {
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
  }
  if (bindings.bindings.length === 0) {
    const state = currentClockMsForRegistry() < isoToMsForRegistry(action.expires_at) ? 'WAITING' : 'BLOCKED';
    emitAndExit(makeResult('root-source-status', RC.OK, state, 'NONE', [], [], makeOperation('root-source', actionId, state, {}))); return;
  }
  const binding = bindings.bindings[0];
  const ingress = readRegistryRecord(rootSourceIngressPathFor(projectRoot, binding.binding_id));
  if (!ingress.ok) {
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
  }
  if (ingress.absent) {
    const v2Live = !(hasExactKeys(binding, ROOT_SOURCE_BINDING_KEYS_V2) && binding.schema === ROOT_SOURCE_BINDING_SCHEMA_V2)
      || (binding.session_generation_id === context.generation.generationId
        && currentClockMsForRegistry() < isoToMsForRegistry(binding.expiry));
    const authorityIdentityId = computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', binding.runtime_session_key, binding.agent_id);
    const fenceRead = readClaudeAuthorityFence(projectRoot, authorityIdentityId);
    if (!fenceRead.ok) {
      emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
    }
    if (!v2Live || !fenceRead.absent) {
      emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'NONE', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
    }
    emitAndExit(makeResult('root-source-status', RC.OK, 'WAITING', 'NONE', [], [], makeOperation('root-source', actionId, 'WAITING', {}))); return;
  }
  const validIngress = validateRootSourceIngressRecord(ingress.obj, { binding_id: binding.binding_id, action_id: actionId });
  if (!validIngress.ok) {
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
  }
  // M7 section 9 (defect 8): readRootSourceTerminalArtifacts is now called
  // EXACTLY ONCE -- its own fd-bound terminalState/ref/digest fields drive
  // the whole projection directly; the legacy retirement marker is never
  // consulted (section 4.4/6: non-authoritative whether or not it exists).
  const waveSlug = path.basename(path.dirname(context.plan.planPath)).replace(/^wave-/, '');
  const planRoot = path.join(context.coordRoot, context.repoId, waveSlug, context.plan.planDigest);
  const api = s16ConsultationApi();
  let terminal;
  try {
    terminal = api.readRootSourceTerminalArtifacts(context.coordRoot, planRoot, ingress.obj.request_id);
  } catch (err) { terminal = null; }
  if (!terminal || terminal.requestDigest !== ingress.obj.request_digest) {
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
  }
  const operationFields = {
    request_id: ingress.obj.request_id, request_ref: terminal.requestRef, request_digest: terminal.requestDigest,
    result_ref: terminal.resultRef, result_digest: terminal.resultDigest,
    accepted_result_ref: terminal.acceptedResultRef, accepted_result_digest: terminal.acceptedResultDigest,
    ack_ref: terminal.ackRef, ack_digest: terminal.ackDigest,
    cancel_ref: terminal.cancelRef, cancel_digest: terminal.cancelDigest,
  };
  if (terminal.terminalState === 'ACKED') {
    if (terminal.acceptedResultRef === null || terminal.acceptedResultDigest === null) {
      emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
    }
    emitAndExit(makeResult('root-source-status', RC.OK, 'READY', 'NONE', [], [], makeOperation('root-source', actionId, 'READY', operationFields))); return;
  }
  if (terminal.terminalState === 'CANCELLED') {
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'NONE', [], [], makeOperation('root-source', actionId, 'BLOCKED', operationFields))); return;
  }
  // Terminal evidence above is durable business truth and is intentionally
  // classified before transient actor liveness. Only an OPEN operation needs
  // a current generation, unexpired binding and unfenced actor to keep waiting.
  if (hasExactKeys(binding, ROOT_SOURCE_BINDING_KEYS_V2) && binding.schema === ROOT_SOURCE_BINDING_SCHEMA_V2) {
    const generationCurrent = binding.session_generation_id === context.generation.generationId;
    const stillUnexpired = currentClockMsForRegistry() < isoToMsForRegistry(binding.expiry);
    if (!generationCurrent || !stillUnexpired) {
      emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'NONE', [], [], makeOperation('root-source', actionId, 'BLOCKED', {
        request_id: ingress.obj.request_id, request_ref: terminal.requestRef, request_digest: terminal.requestDigest,
      }))); return;
    }
  }
  const authorityIdentityId = computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', binding.runtime_session_key, binding.agent_id);
  const fenceRead = readClaudeAuthorityFence(projectRoot, authorityIdentityId);
  if (!fenceRead.ok) {
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-source', actionId, 'BLOCKED', {}))); return;
  }
  const isFenced = !fenceRead.absent;
  // OPEN: no transaction terminal yet. M7 GREEN section 4.7 / CORRECTION C7:
  // the binding's own actor fence (already read once, above) gates the
  // outcome here -- a durably fenced actor (already SubagentStop-returned)
  // can never legitimately complete this still-open transaction, so
  // BLOCKED/NONE (never WAITING/NONE) for a request nobody is left to
  // answer. Per Codex's ruling, a fenced+ingress case exposes ONLY the
  // accredited request_ref/request_digest -- never result/accepted/ack/
  // cancel, even if the terminal reader already proved some of them durable
  // -- so this uses a NARROWER fields object, never the full
  // operationFields. An unfenced, live actor is the ordinary WAITING case
  // (full operationFields, unchanged).
  if (isFenced) {
    const fencedOpenFields = { request_id: ingress.obj.request_id, request_ref: terminal.requestRef, request_digest: terminal.requestDigest };
    emitAndExit(makeResult('root-source-status', RC.OK, 'BLOCKED', 'NONE', [], [], makeOperation('root-source', actionId, 'BLOCKED', fencedOpenFields))); return;
  }
  emitAndExit(makeResult('root-source-status', RC.OK, 'WAITING', 'NONE', [], [], makeOperation('root-source', actionId, 'WAITING', operationFields)));
}

// ── probe (Frozen CLI ABI, PLAN.md ~L140) ───────────────────────────────────────

/**
 * `probe --project-root <absolute>` -- derive selected policy, host/session
 * generation, and connector capability needs; read-only.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleProbe(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.probe);
  if (!parsed.ok) {
    usageError('probe');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('probe');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('probe', 'POLICY_INVALID');
    return;
  }

  // Point 1.1 (R4): PLAN.md ~L150 -- every lifecycle command requires a
  // grant; missing/invalid fails closed, never a silent pass-through.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('probe', 'IDENTITY_MISMATCH');
    return;
  }
  const argvDigest = sha256String('probe');
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, null, 'probe');
  if (!consumeResult.ok) {
    invalidError('probe', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('probe', 'POLICY_INVALID');
    return;
  }
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== computeWorktreeId(projectRoot)) {
    invalidError('probe', 'IDENTITY_MISMATCH');
    return;
  }

  emitAndExit(makeResult('probe', RC.OK, 'WAITING', 'NONE', [], []));
}

// ── status (Frozen CLI ABI, PLAN.md ~L146) ──────────────────────────────────────

/**
 * `status --project-root <absolute> [--role <role>]` -- return current
 * non-authoritative lifecycle diagnostics; read-only.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleStatus(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.status);
  if (!parsed.ok) {
    usageError('status');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('status');
    return;
  }
  const role = parsed.values['--role'];
  if (role !== undefined && !CANONICAL_ROLES.includes(role)) {
    invalidError('status', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('status', 'POLICY_INVALID');
    return;
  }

  // Point 1.1 (R4): every lifecycle command requires a grant. `role` is the
  // caller's own optional --role when supplied, else null (whole-plane) --
  // PLAN.md ~L576's closed role union names status explicitly in the
  // null-role case.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('status', 'IDENTITY_MISMATCH');
    return;
  }
  const argvDigest = sha256String('status:' + (role === undefined ? '' : role));
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role === undefined ? null : role, 'status');
  if (!consumeResult.ok) {
    invalidError('status', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('status', 'POLICY_INVALID');
    return;
  }
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== computeWorktreeId(projectRoot)) {
    invalidError('status', 'IDENTITY_MISMATCH');
    return;
  }

  emitAndExit(makeResult('status', RC.OK, 'WAITING', 'NONE', [], []));
}

  return Object.freeze({
handleRootSource, handleRootSourceStatus, handleProbe, handleStatus,
  });
}

module.exports = { createCliRootSourceHandlers };
