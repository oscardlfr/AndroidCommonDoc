'use strict';

function createInboxModule(deps) {
  const {
    path,
    fs,
    CliError,
    requireHostBridgeCapability,
    resolveAbsolute,
    computeRepoId,
    getRuntimeRoleLifecycle,
    planRootPath,
    isHexId,
    requestPathFor,
    accreditCanonicalRequest,
    currentClockMs,
    isoToMs,
    resolveAuthoritativeAttempt,
    readCanonicalCancelRecordOptional,
    cancelPathFor,
    readJsonDurableOptional,
    acceptedResultPathFor,
    ACCEPTED_RESULT_V1_FIELDS,
    resultPathFor,
    RESULT_V2_FIELDS,
    assertClosedShape,
    resolveActivationForRequestPath,
    requireHostBridgeRequestScope,
    resolveRootEvidenceAuthority,
    validateInboxRefV1
  } = deps;

  function hostBridgeListInbox(capability, coordRootRaw) {
    const scope = requireHostBridgeCapability(capability);
    const coordRoot = resolveAbsolute(coordRootRaw);
    const repoId = computeRepoId(scope.projectRoot);
    let rll;
    try { rll = getRuntimeRoleLifecycle(); } catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
    const plan = rll.discoverPlan(scope.projectRoot);
    if (!plan.ok || plan.planDigest !== scope.planDigest) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge PLAN is not current');
    const waveSlug = path.basename(path.dirname(plan.planPath)).slice('wave-'.length);
    const planRoot = planRootPath(coordRoot, repoId, waveSlug, scope.planDigest);
    const inboxDir = path.join(planRoot, 'inbox', scope.role);
    let entries;
    try { entries = fs.readdirSync(inboxDir, { withFileTypes: true }); }
    catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'unable to scan role inbox');
    }
    if (entries.length > 4096) throw new CliError('INVALID', 'SECURITY_INVALID', 'role inbox scan cap exceeded');
    const out = [];
    for (const entry of entries) {
      // ROOT-INGRESS-E2E finding: a root-consult request_id is the CLI's own
      // preallocated 32-hex id (crypto.randomBytes(16), same shape validated by
      // isHexId elsewhere in this file -- see INBOX_REF_V1_FIELDS.request_id
      // above), never genId()'s 64-hex. This filename filter hardcoded exactly
      // 64 hex chars and silently dropped every root-consult inbox entry before
      // the target worker ever saw it -- the retained plane advanced the WAL
      // and published the request (request_ref/request_digest went durable)
      // but nothing downstream ever claimed it, so consult-root-status stayed
      // WAITING forever with result_ref/accepted_result_ref/ack_ref all null.
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const inboxRequestId = entry.name.slice(0, -'.json'.length);
      if (!isHexId(inboxRequestId)) continue;
      const inboxPath = path.join(inboxDir, entry.name);
      const inbox = validateInboxRefV1(inboxPath, coordRoot);
      if (inbox.target_role !== scope.role) continue;
      const requestPath = requestPathFor(planRoot, inbox.request_id);
      // A request that has already expired is no longer live/executable authority,
      // so an unresolvable activation for it is benign, not a correlation failure --
      // check expiry (via a fresh accredited read, never skipping the correlation
      // check itself) before ever calling resolveActivationForRequestPath.
      const accredited = accreditCanonicalRequest(coordRoot, requestPath);
      if (
        accredited.digest !== inbox.request_digest
        || accredited.obj.target_role !== inbox.target_role
        || accredited.obj.target_role !== scope.role
      ) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'accredited request does not correlate with its role inbox entry');
      }
      if (currentClockMs() >= isoToMs(accredited.obj.expiry)) continue;
      // A transaction that already reached a canonical terminal state (cancel,
      // accepted-result, or an authoritative result) is no longer schedulable
      // work -- its activation's own, much shorter, liveness naturally expires
      // once the work is done, so an unresolvable activation for an
      // already-terminal transaction is benign, not a correlation failure.
      // Check terminal state (via the SAME durable readers/shapes the
      // nonterminal path below still uses) before ever calling
      // resolveActivationForRequestPath.
      const preTerminalTxnDir = path.dirname(requestPath);
      const preTerminalAuth = resolveAuthoritativeAttempt(accredited.obj, preTerminalTxnDir);
      // CANCEL-AUDIT-01: reads cancel.json ONLY through the sanctioned choke
      // point (see hostBridgeScheduleTurn's identical comment).
      if (readCanonicalCancelRecordOptional(cancelPathFor(preTerminalTxnDir), coordRoot) !== null) continue;
      if (readJsonDurableOptional(acceptedResultPathFor(preTerminalTxnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) }) !== null) continue;
      if (readJsonDurableOptional(resultPathFor(preTerminalTxnDir, preTerminalAuth.attemptId), { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) }) !== null) continue;
      const activation = resolveActivationForRequestPath(requestPath);
      if (!activation.ok) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'role inbox request activation is not resolvable');
      }
      // Persistent app-server polling is disk-visible but driver-specific.  A
      // request routed to Claude, MCP, runtime-spawn or noop remains owned by
      // that driver and is ignored here; it must never make the retained Codex
      // worker fail merely because all drivers share the same role inbox.
      if (!activation.activation || activation.activation.selected_driver !== 'codex-app-server') continue;
      const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
      const txnDir = path.dirname(requestPath);
      const auth = resolveAuthoritativeAttempt(checked.reqObj, txnDir);
      // Host-private correlation only; never part of consult/v2 and never
      // projected into model-controlled wire data as an authority field.
      const evidenceAuthority = resolveRootEvidenceAuthority(checked.reqObj, checked.requestDigest, coordRoot, scope);
      out.push({
        requestPath,
        requestId: checked.reqObj.request_id,
        createdAt: inbox.created_at,
        attemptId: auth.attemptId,
        leaseEpoch: auth.leaseEpoch,
        expectedResultKind: checked.reqObj.expected_result_kind,
        question: checked.reqObj.question,
        rootRequestId: checked.reqObj.root_request_id,
        parentRequestId: checked.reqObj.parent_request_id,
        depth: checked.reqObj.depth,
        maxDepth: checked.reqObj.max_depth,
        evidencePolicy: evidenceAuthority.policy,
        // M6/M7 terminal functional closure, point C/D: propagated so the
        // retained worker can host-enforce an exact gap.library_id lock
        // (never null/search) once a directive already named the library.
        approvedContext7LibraryId: evidenceAuthority.libraryId,
      });
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // stdout envelope + top-level dispatch (Frozen CLI ABI, PLAN.md ~L779-781)
  // ─────────────────────────────────────────────────────────────────────────────


  return {
    hostBridgeListInbox
  };
}

module.exports = { createInboxModule };

