'use strict';

// Read-side activation/v1 resolution: current authoritative attempt lookup and the live claude-agent activation scan.

function createActivationResolutionCommands({
  ACTIVATION_V1_FIELDS,
  DURABLE_PENDING,
  DURABLE_PRESENT,
  activationLivenessDeadline,
  activationPathFor,
  assertClosedShape,
  classifyDurableRead,
  currentClockMs,
  fs,
  getRuntimeRoleLifecycle,
  isHexId,
  isoToMs,
  path,
  planRootPath,
  readCanonicalRequestRecord,
  resolveAuthoritativeAttempt,
}) {
/**
 * M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
 * point 4): reads the request at `requestPath`, resolves its CURRENT
 * authoritative attempt, and reads THAT attempt's own live `activation/v1`
 * record if one genuinely exists and path<->field-correlates (its own
 * `request_id`/`attempt_id` must equal what was just resolved) -- the
 * read-side runtime-consultation-target-gate.js uses to determine which
 * binding type may back a target grant: a DETERMINISTIC branch on
 * `selected_driver` (arch-integration-prep's own guidance, relayed
 * 2026-08-09: `'claude-agent'` -> ClaudeOneShotBinding, anything else ->
 * RoleActorBinding, never a fallback/probe-both). Returns
 * `{ok:true,activation:null}` (not an error) when no activation exists yet
 * for the authoritative attempt, or it exists but is malformed/foreign --
 * dispatch may not have run yet, or (today, always, per cmdDispatch's own
 * WP2 scoping) never selects claude-agent -- callers treat a null
 * activation as "not claude-agent", i.e. the persistent, unchanged
 * RoleActorBinding path. Returns `{ok:false}` only for a genuinely
 * malformed/absent/non-durable REQUEST -- the caller must reject the
 * command outright in that case, never guess.
 * @param {string} requestPath
 * @returns {{ok:true,requestId:string,attemptId:string,leaseEpoch:number,activation:object|null}|{ok:false}}
 */
function resolveActivationForRequestPath(requestPath) {
  const txnDir = path.dirname(requestPath);
  let reqObj;
  let reqDigest;
  try {
    // Stage C (M7-FINAL-REMEDIATION-20260818): one fd-bound canonical read
    // retaining both the parsed request AND the SHA-256 digest of those
    // exact bytes (readCanonicalRequestRecord -> readClosedRecord ->
    // readDurableRecord already computes it) -- never a second, separate
    // reopen of request.json merely to obtain a digest. Mirrors this file's
    // own readRequestForTxnOrCorrelationInvalid wrapper exactly (same
    // absentDetail/absentMessage policy), which callers that need only
    // `.obj` keep using unchanged.
    const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'referenced request.json does not resolve',
    });
    reqObj = reqRec.obj;
    reqDigest = reqRec.digest;
  } catch (err) {
    return { ok: false };
  }
  let auth;
  try {
    auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  } catch (err) {
    return { ok: false };
  }
  let activationObj = null;
  try {
    const classified = classifyDurableRead(activationPathFor(txnDir, auth.attemptId), { parse: true });
    // M7 GREEN correction round 2, R5: a durably in-flight (nlink=2) write
    // is neither genuine absence nor a valid activation -- must never be
    // silently folded into ABSENT (which a general caller reads as
    // "safe to treat as no activation"). Only genuine DURABLE_ABSENT falls
    // through to the {ok:true, activation:null} return below.
    if (classified.state === DURABLE_PENDING) return { ok: false };
    if (classified.state === DURABLE_PRESENT) {
      assertClosedShape(classified.obj, ACTIVATION_V1_FIELDS);
      const a = classified.obj;
      // Stage C: full DURABLE_PRESENT correlation against the request --
      // request_id/attempt_id alone (the pre-Stage-C predicate) missed
      // request_digest, lease_epoch, target_role_profile_digest, and the
      // routing_policy version/digest pair entirely.
      if (
        a.request_id !== reqObj.request_id || a.request_digest !== reqDigest
        || a.attempt_id !== auth.attemptId || a.lease_epoch !== auth.leaseEpoch
        || a.target_role_profile_digest !== reqObj.target_role_profile_digest
        || a.routing_policy_version !== reqObj.routing_policy_version
        || a.routing_policy_digest !== reqObj.routing_policy_digest
      ) {
        // R5 lineage: present but DECORRELATED -- a real, distinct error,
        // never silently folded into ABSENT either.
        return { ok: false };
      }
      // Stage C: canonical time checks -- created_at never in the future,
      // never later than its own expiry, and activation_liveness_expiry
      // must be EXACTLY the same deterministic deadline the write side
      // computes (activationLivenessDeadline), never merely "some future
      // timestamp" of the record's own choosing.
      const createdAtMs = isoToMs(a.created_at);
      const expiryMs = isoToMs(a.activation_liveness_expiry);
      const nowMs = currentClockMs();
      if (
        createdAtMs > nowMs || createdAtMs > expiryMs
        || a.activation_liveness_expiry !== activationLivenessDeadline(reqObj)
        || nowMs >= expiryMs
      ) {
        // R5 lineage: present, correlated, but EXPIRED (or a canonical-time
        // violation) -- never treated as still valid, never folded into
        // ABSENT.
        return { ok: false };
      }
      // Stage C: driver/native-field coherence -- never infer or repair
      // either field. Lazy require mirrors this file's own established
      // circular-dependency-safe pattern (runtime-role-lifecycle.cjs itself
      // requires this file); only reached once a record is otherwise fully
      // correlated and live.
      if (a.selected_driver === 'claude-agent') {
        const rll = getRuntimeRoleLifecycle();
        if (!rll.isHexActionId(a.native_spawn_action_id) || a.native_target_binding_id !== null) return { ok: false };
      } else if (a.selected_driver === 'claude-sendmessage') {
        const rll = getRuntimeRoleLifecycle();
        if (!rll.isHexActionId(a.native_target_binding_id) || a.native_spawn_action_id !== null) return { ok: false };
      } else if (a.native_spawn_action_id !== null || a.native_target_binding_id !== null) {
        return { ok: false };
      }
      activationObj = a;
    }
  } catch (err) {
    // M7 GREEN section 4.8: a genuinely malformed/unsafe durable activation
    // record (shape-invalid, symlinked, foreign-owner, etc. -- anything
    // assertClosedShape/classifyDurableRead itself rejects) is an
    // INDETERMINATE resolution, never silently folded into "no activation
    // yet" (ok:true, activation:null) -- the caller must block, never
    // silently fall through to treating this request as if no claude-agent
    // activation could ever exist for it.
    return { ok: false };
  }
  // M7 completeness Part C follow-up (retirement wiring, user Block 4 point
  // 4): also surfaces targetRole/worktreeId/planDigest -- reqObj is already
  // fully parsed above, so this is a non-invasive extension (no new read),
  // and cmdCancel's own post-success retirement lookup needs exactly these
  // fields to resolve the exact-scope ClaudeOneShotBinding it must retire.
  return {
    ok: true, requestId: reqObj.request_id, attemptId: auth.attemptId, leaseEpoch: auth.leaseEpoch,
    activation: activationObj, targetRole: reqObj.target_role, worktreeId: reqObj.subject_worktree_id,
    planDigest: reqObj.plan_digest,
  };
}

/**
 * M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
 * point 2): scans this plan-root's transaction tree for every LIVE
 * `activation/v1` record with `selected_driver==='claude-agent'` whose
 * parent request's `target_role` matches `role` -- the read-side half of
 * "recognize a CURRENT claude-agent ActivationAction" for
 * agent-spawn-execution-gate.js. Never returns on the first match: collects
 * EVERY genuinely live candidate so the caller applies the SAME "zero or
 * more-than-one -> non-owning/ambiguous, never guess" discipline this
 * codebase's other ownership scans already use (mirrors
 * findOwningRoleLifecycleCandidate's own convention). A candidate is "live"
 * only when its own `activation_liveness_expiry` has not yet passed; an
 * absent/malformed/shape-invalid request or activation is silently skipped
 * (never a candidate), never thrown -- a scan over many transactions must
 * not abort on one unrelated malformed entry. `activation.request_id` is
 * additionally cross-checked against the transaction directory it was found
 * under (path<->field correlation, mirroring this file's own established
 * discipline elsewhere) before ever being trusted.
 *
 * PRODUCTION REALITY (disclosed, not hidden): `cmdDispatch` above is
 * WP2-scoped -- its driver selection is unconditionally `noop`, so no
 * `activation/v1` record with `selected_driver:'claude-agent'` is ever
 * produced today. This function can therefore only ever return `[]` in
 * current production, by construction -- see
 * runtime-role-lifecycle.cjs's own ClaudeAgentSpawnReservation/v1 section
 * header for the full disclosure. Built completely and correctly against
 * the real, already-frozen `activation/v1` schema regardless, ready for a
 * future WP3 dispatch-side producer.
 * @param {string} coordRoot
 * @param {string} repoId
 * @param {string} waveSlug
 * @param {string} planDigest
 * @param {string} role
 * @returns {Array<{activation:object,requestId:string}>}
 */
function findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planDigest, role) {
  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);
  const txnsDir = path.join(planRoot, 'transactions');
  let txnEntries;
  try {
    txnEntries = fs.readdirSync(txnsDir, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const nowMs = currentClockMs();
  const found = [];
  for (const txnEntry of txnEntries) {
    if (!txnEntry.isDirectory() || !isHexId(txnEntry.name)) continue;
    const requestId = txnEntry.name;
    const txnDir = path.join(txnsDir, requestId);
    let reqObj;
    try {
      reqObj = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), requestId, {}).obj;
    } catch (err) {
      continue; // absent/malformed/foreign request -- never a candidate.
    }
    if (reqObj.target_role !== role) continue;
    const activationsDir = path.join(txnDir, 'activations');
    let activationEntries;
    try {
      activationEntries = fs.readdirSync(activationsDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const activationEntry of activationEntries) {
      if (!activationEntry.isFile() || !activationEntry.name.endsWith('.json')) continue;
      let activationObj;
      try {
        const classified = classifyDurableRead(path.join(activationsDir, activationEntry.name), { parse: true });
        if (classified.state !== DURABLE_PRESENT) continue;
        assertClosedShape(classified.obj, ACTIVATION_V1_FIELDS);
        activationObj = classified.obj;
      } catch (err) {
        continue; // malformed/non-durable -- never a candidate.
      }
      if (activationObj.selected_driver !== 'claude-agent') continue;
      if (activationObj.request_id !== requestId) continue;
      // activation_liveness_expiry's own canonical-ISO-UTC shape is already
      // proven by assertClosedShape(activationObj, ACTIVATION_V1_FIELDS)
      // above -- this is a plain liveness comparison, not a second shape check.
      if (isoToMs(activationObj.activation_liveness_expiry) <= nowMs) continue;
      found.push({ activation: activationObj, requestId });
    }
  }
  return found;
}

  return Object.freeze({
    findLiveClaudeAgentActivations,
    resolveActivationForRequestPath,
  });
}

module.exports = { createActivationResolutionCommands };
