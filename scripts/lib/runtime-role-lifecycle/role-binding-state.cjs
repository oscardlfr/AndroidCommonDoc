'use strict';

function createRoleBindingState(deps) {
  const { path, crypto, Buffer, sha256String, registryRepoDir, readRegistryRecord, withRegistryLock, nowIsoForRegistry, canonicalJSONStringify, writeRegistryRecordReplace, ROLE_BINDING_ALLOWED_KEYS, hasOnlyAllowedKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64 } = deps;

const ROLE_BINDING_STATE_ENUM = Object.freeze([
  'ABSENT', 'STARTING', 'READY', 'WAITING', 'BUSY',
  'UNAVAILABLE', 'DEAD', 'REHYDRATING', 'ROTATING',
  'QUARANTINED', 'STOPPING', 'STOPPED',
]);

// Closed transition graph: fromState -> Set(toState). Absent from this table ==
// forbidden; transitionRoleBinding() below enforces it unconditionally, never
// trusting a caller-requested transition that is not explicitly listed.
const ROLE_BINDING_TRANSITIONS = Object.freeze({
  ABSENT: Object.freeze(new Set(['STARTING'])),
  STARTING: Object.freeze(new Set(['READY', 'UNAVAILABLE', 'QUARANTINED'])),
  READY: Object.freeze(new Set(['WAITING', 'DEAD', 'ROTATING', 'STOPPING', 'UNAVAILABLE'])),
  WAITING: Object.freeze(new Set(['BUSY', 'DEAD', 'ROTATING', 'STOPPING'])),
  BUSY: Object.freeze(new Set(['WAITING', 'DEAD'])),
  DEAD: Object.freeze(new Set(['REHYDRATING'])),
  REHYDRATING: Object.freeze(new Set(['READY', 'QUARANTINED'])),
  ROTATING: Object.freeze(new Set(['REHYDRATING'])),
  QUARANTINED: Object.freeze(new Set()), // terminal for this binding key
  STOPPING: Object.freeze(new Set(['STOPPED'])),
  STOPPED: Object.freeze(new Set()), // terminal
  // Point 3.1 (R4): retryable WITHIN the same session generation -- a
  // caller-visible driver/action failure for THIS role, never a
  // respawn-budget/ambiguous-owner/explicit-stop terminality (those go
  // through QUARANTINED/STOPPED instead, restart-only). A fresh `ensure`
  // excludes exactly the driver that produced this UNAVAILABLE record
  // (see handleEnsure's pass 1/2) and genuinely selects the next
  // routing-permitted, capability-proven one.
  UNAVAILABLE: Object.freeze(new Set(['STARTING'])),
});

function roleBindingKeyDigest(worktreeId, planDigest, profileDigest, generationId, role) {
  return sha256String(['wp3-role-binding-v1', worktreeId, planDigest, profileDigest, generationId, role].join(':'));
}

function roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role) {
  return path.join(
    registryRepoDir(projectRoot), 'role-bindings',
    roleBindingKeyDigest(worktreeId, planDigest, profileDigest, generationId, role) + '.json',
  );
}

/**
 * Reads the current role-binding record, or synthesizes the implicit ABSENT
 * state if none exists yet (ABSENT is never itself persisted -- it is the
 * natural absence of a record).
 * @returns {{ok:true,state:'ABSENT'}|{ok:true,state:string,record:object}|{ok:false,reason:string}}
 */
/**
 * WP3 item C correction pass R3 (point A.3): closes RoleBinding/v1 and
 * correlates path<->role/worktree/PLAN/profile/session -- the path alone
 * (a hash of this exact tuple) was previously TRUSTED without cross-checking
 * the record's OWN embedded fields against it; a subset of fields (merely
 * schema+state) could never actually authorize anything by itself. Every
 * key-tuple field the path is a hash of is now independently re-verified
 * against the record's own claim, plus a closed (allowed-superset) key-set.
 */
// Point 1.5 (R4), closed bidirectionally in R4 round 2 (point 4): closed
// shape PER STATE, not merely an allowed-superset -- ROLE_BINDING_ALLOWED_KEYS
// alone permits any of its six optional fields (driver, respawn_count,
// pending_action_id, team_ensure_action_id, failure_reason, stop_reason) to
// co-occur with ANY state, so a READY record could previously carry a stale
// pending_action_id or a QUARANTINED-only failure_reason without being
// rejected.
//   driver/respawn_count   -- required for every persisted (non-ABSENT) state.
//   pending_action_id      -- REQUIRED (bidirectional) for STARTING/
//                             REHYDRATING, forbidden otherwise, and hex-
//                             shaped when present. Bidirectional is now safe:
//                             `transitionRoleBindingAtomicViaWaypoint`
//                             eliminated the one honest transient-absence
//                             case (noop's own former two-write STARTING
//                             hop) by never persisting the waypoint at all.
//   team_ensure_action_id  -- stays ONE-DIRECTIONAL (presence implies
//                             eligible, not the reverse): `rotate`'s own
//                             claude-sendmessage respawn legitimately omits
//                             it (team-ensure already succeeded the FIRST
//                             time this role was spawned via ensure, and
//                             rotate never re-stamps it). Only STARTING or
//                             REHYDRATING, and only driver claude-sendmessage
//                             (the routing-resolved driver name STORED on
//                             the record -- NOT the action's own `runtime`
//                             field value claude-native, a DIFFERENT,
//                             action-level concept). Hex-shaped when present.
//   failure_reason         -- only UNAVAILABLE or QUARANTINED; non-empty
//                             string when present.
//   stop_reason             -- only STOPPING or STOPPED; non-empty string
//                             when present.
//   binding_id              -- always required, hex-shaped.
//   created_at/updated_at   -- always required, canonical ISO-8601 UTC
//                             (`isCanonicalIsoUtc`), never merely
//                             Date.parse-able.
function roleBindingExtraFieldsAreClosedForState(rec) {
  const has = (k) => Object.prototype.hasOwnProperty.call(rec, k);
  if (typeof rec.driver !== 'string' || rec.driver.length === 0) return false;
  if (!Number.isInteger(rec.respawn_count) || rec.respawn_count < 0) return false;
  // R4 round 3 (round 4 correction, finding 2): THE choke point both the
  // reader (readRoleBindingState) and the writer (transitionRoleBinding
  // Unchecked's nextRecord check) call -- fixing it here closes BOTH ends
  // at once. Previously worktree_id/plan_digest/profile_digest/
  // session_generation_id were NEVER independently shape-validated at
  // all, only compared for EQUALITY against a caller's own parameters (in
  // readRoleBindingState) or against validateRoleBindingRecordForScope's
  // expectedTuple (in transitionRoleBindingUnchecked) -- a self-consistent
  // pair of wrong-length values (writer writes X, reader is asked to read
  // the SAME X) passed both, silently, since neither side ever asked "is X
  // itself well-formed". Reproduced empirically: a 63-hex worktree_id, a
  // 65-hex plan_digest, and a 63-hex profile_digest were all durably
  // written and successfully read back.
  if (!isHexDigest64(rec.worktree_id) || !isHexDigest64(rec.plan_digest) || !isHexDigest64(rec.profile_digest)) return false;
  if (!isHexCsprng32(rec.binding_id)) return false;
  if (!isHexCsprng32(rec.session_generation_id)) return false;
  if (!isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.updated_at)) return false;
  const pendingEligible = rec.state === 'STARTING' || rec.state === 'REHYDRATING';
  if (has('pending_action_id') !== pendingEligible) return false;
  if (pendingEligible && !isHexActionId(rec.pending_action_id)) return false;
  const teamEnsureEligible = pendingEligible && rec.driver === 'claude-sendmessage';
  if (has('team_ensure_action_id') && !teamEnsureEligible) return false;
  if (has('team_ensure_action_id') && !isHexActionId(rec.team_ensure_action_id)) return false;
  const failureEligible = rec.state === 'UNAVAILABLE' || rec.state === 'QUARANTINED';
  if (has('failure_reason') !== failureEligible) return false;
  if (failureEligible && (typeof rec.failure_reason !== 'string' || rec.failure_reason.length === 0)) return false;
  const stopEligible = rec.state === 'STOPPING' || rec.state === 'STOPPED';
  if (has('stop_reason') !== stopEligible) return false;
  if (stopEligible && (typeof rec.stop_reason !== 'string' || rec.stop_reason.length === 0)) return false;
  return true;
}

/**
 * R4 round 3 (block 2a): closes an identity-overwrite bug empirically
 * reproduced against `transitionRoleBindingUnchecked` -- `nextRecord` is
 * assembled via `Object.assign(base, fromRecord||{}, {state,updated_at},
 * extraFields||{})`, which merges left-to-right, so a `fromRecord` or
 * `extraFields` carrying its OWN `role`/`worktree_id`/`plan_digest`/
 * `profile_digest`/`session_generation_id` SILENTLY OVERWRITES the base
 * object's correct values (the function's own verified parameters).
 * Reproduced concretely: a transition at the arch-testing role-binding path
 * with `extraFields.role = 'verifier'` returned `{ok:true}` and wrote a
 * record whose own `role` field said "verifier" while living at the
 * arch-testing-keyed path; the very next `readRoleBindingState` call
 * correctly REJECTED it as `role-binding-shape-invalid`, but the WRITE
 * itself should never have succeeded. Applied to `current`/`fromRecord`/
 * `nextRecord`, all under the SAME lock inside
 * `transitionRoleBindingUnchecked` -- fails closed (never silently
 * corrects the mismatched field back to the expected value, which would
 * mask a genuine caller bug rather than surface it) so identity fields can
 * never be overwritten by a caller-supplied `fromRecord` or `extraFields`
 * regardless of what either one claims.
 * @param {object} record
 * @param {{role:*, worktree_id:string, plan_digest:string, profile_digest:string, session_generation_id:string}} expectedTuple
 * @returns {boolean}
 */
function validateRoleBindingRecordForScope(record, expectedTuple) {
  if (!record || typeof record !== 'object') return false;
  return (
    record.role === expectedTuple.role
    && record.worktree_id === expectedTuple.worktree_id
    && record.plan_digest === expectedTuple.plan_digest
    && record.profile_digest === expectedTuple.profile_digest
    && record.session_generation_id === expectedTuple.session_generation_id
  );
}

function readRoleBindingState(projectRoot, worktreeId, planDigest, profileDigest, generationId, role) {
  const recordPath = roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role);
  const read = readRegistryRecord(recordPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  if (
    !rec || !hasOnlyAllowedKeys(rec, ROLE_BINDING_ALLOWED_KEYS)
    || rec.schema !== 'runtime/role-binding/v1' || !ROLE_BINDING_STATE_ENUM.includes(rec.state)
    || rec.worktree_id !== worktreeId || rec.plan_digest !== planDigest
    || rec.profile_digest !== profileDigest || rec.session_generation_id !== generationId || rec.role !== role
    || !roleBindingExtraFieldsAreClosedForState(rec)
  ) {
    return { ok: false, reason: 'role-binding-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * The CAS+write internals, shared by `transitionRoleBinding` (which enforces
 * the closed PUBLIC single-hop graph before delegating here) and
 * `transitionRoleBindingAtomicViaWaypoint` (which enforces its OWN two-hop
 * legality via the SAME graph data before delegating here, but persists
 * only the FINAL state -- R4 round 2, point 4). NEVER called directly by a
 * handler; always through one of those two checked entry points.
 * `fromRecord` is `null` only for the ABSENT->STARTING transition (first
 * creation); every other transition requires the CURRENT on-disk record's
 * `binding_id` to match `fromRecord.binding_id` (a stale/superseded reader can
 * never blindly overwrite a newer transition -- checked under the registry
 * lock). Point 4: the fully-assembled `nextRecord` is validated via the SAME
 * closed-shape check a reader would apply BEFORE it is ever persisted --
 * this function can never durably write a record its own sibling reader
 * would immediately reject.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBindingUnchecked(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields) {
  const recordPath = roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role);
  const lockDir = recordPath + '.lock';
  // Block 2a: THIS call's own verified parameters -- the single source of
  // truth every record touched below (current/fromRecord/nextRecord) is
  // checked against, so none of them can ever smuggle a different tuple
  // into what gets persisted.
  const expectedTuple = { role, worktree_id: worktreeId, plan_digest: planDigest, profile_digest: profileDigest, session_generation_id: generationId };
  const result = withRegistryLock(lockDir, () => {
    const current = readRegistryRecord(recordPath);
    if (!current.ok) return { ok: false, reason: current.reason };
    if (fromState === 'ABSENT') {
      if (!current.absent) return { ok: false, reason: 'concurrent-creation' };
    } else {
      if (current.absent) return { ok: false, reason: 'binding-vanished' };
      if (!current.obj || current.obj.binding_id !== (fromRecord && fromRecord.binding_id) || current.obj.state !== fromState) {
        return { ok: false, reason: 'stale-binding-read' };
      }
      // Block 2a: the on-disk record this transition is reading FROM must
      // already belong to this exact tuple -- never transition off of a
      // record that (somehow) does not.
      if (!validateRoleBindingRecordForScope(current.obj, expectedTuple)) {
        return { ok: false, reason: 'current-record-scope-mismatch' };
      }
    }
    // Block 2a: the caller-supplied fromRecord is about to be merged into
    // nextRecord below (Object.assign merges left-to-right, so a
    // fromRecord carrying a DIFFERENT role/worktree_id/plan_digest/
    // profile_digest/session_generation_id would otherwise silently
    // overwrite the correct base values) -- checked BEFORE that merge ever
    // happens, never merely inferred from current's own check above (a
    // caller can pass ANY object here, not necessarily what was just read).
    if (fromRecord && !validateRoleBindingRecordForScope(fromRecord, expectedTuple)) {
      return { ok: false, reason: 'from-record-scope-mismatch' };
    }
    const nowStr = nowIsoForRegistry();
    const nextRecord = Object.assign(
      {
        schema: 'runtime/role-binding/v1',
        binding_id: crypto.randomBytes(16).toString('hex'),
        role,
        worktree_id: worktreeId,
        plan_digest: planDigest,
        profile_digest: profileDigest,
        session_generation_id: generationId,
        created_at: (fromRecord && fromRecord.created_at) || nowStr,
      },
      fromRecord || {},
      { state: toState, updated_at: nowStr },
      extraFields || {},
    );
    // binding_id is preserved across a transition of an EXISTING record (identity
    // of the binding does not change just because its state does); only a fresh
    // ABSENT->STARTING creation mints a new one.
    if (fromRecord) nextRecord.binding_id = fromRecord.binding_id;
    // Point 1.5 (R4): pending_action_id/team_ensure_action_id are ONLY
    // meaningful while a host-native action is actually pending
    // (STARTING/REHYDRATING) -- without this, a plain Object.assign merge
    // silently carries a NOW-STALE reference forward into READY/
    // UNAVAILABLE/QUARANTINED/etc, exactly the kind of leftover field a
    // per-state closed shape must reject. Stripped centrally here
    // (`delete`, not `undefined` -- both are omitted by
    // canonicalJSONStringify, but `delete` also keeps the IN-MEMORY object
    // this function returns to its caller honest, not just the eventual
    // serialized bytes) so every call site is covered uniformly, never
    // requiring each caller to remember to clear them individually.
    if (toState !== 'STARTING' && toState !== 'REHYDRATING') {
      delete nextRecord.pending_action_id;
      delete nextRecord.team_ensure_action_id;
    }
    // Point 3.1 (R4): the SAME stale-carry-forward hazard, now reachable
    // for `failure_reason` too now that UNAVAILABLE has an outgoing edge
    // (UNAVAILABLE->STARTING, the same-generation driver-fallback retry) --
    // an Object.assign merge would otherwise silently carry the FAILED
    // attempt's failure_reason forward onto the fresh STARTING record,
    // which roleBindingExtraFieldsAreClosedForState's bidirectional check
    // (has('failure_reason') !== failureEligible) then permanently rejects
    // as shape-invalid the moment anything reads it back. stop_reason is
    // stripped symmetrically for the same reason, even though no current
    // edge yet carries it forward (STOPPED is terminal) -- defends the
    // same invariant if that ever changes.
    if (toState !== 'UNAVAILABLE' && toState !== 'QUARANTINED') {
      delete nextRecord.failure_reason;
    }
    if (toState !== 'STOPPING' && toState !== 'STOPPED') {
      delete nextRecord.stop_reason;
    }
    // Block 2a: the decisive check -- regardless of what fromRecord or
    // extraFields claimed, nextRecord's identity fields must match THIS
    // call's own verified parameters. This is what actually closes the
    // reproduced bug (extraFields.role='verifier' silently accepted onto
    // the arch-testing-keyed path): even though the checks above already
    // reject a poisoned current/fromRecord, this is the last,
    // unconditional gate immediately before the write -- fails closed
    // rather than silently correcting the mismatched field back to the
    // expected value, which would mask a genuine caller bug instead of
    // surfacing it.
    if (!validateRoleBindingRecordForScope(nextRecord, expectedTuple)) {
      return { ok: false, reason: 'next-record-scope-mismatch' };
    }
    // Point 4 (R4 round 2): validate the FULL nextRecord -- exact key-set,
    // schema, and every per-state field/shape rule -- before it is ever
    // persisted. A writer that could durably publish a record its own
    // sibling reader would reject is exactly the gap this closes.
    if (
      !hasOnlyAllowedKeys(nextRecord, ROLE_BINDING_ALLOWED_KEYS)
      || nextRecord.schema !== 'runtime/role-binding/v1'
      || !roleBindingExtraFieldsAreClosedForState(nextRecord)
    ) {
      return { ok: false, reason: 'nextrecord-shape-invalid' };
    }
    const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(nextRecord), 'utf8'));
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    return { ok: true, record: nextRecord };
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

/**
 * Enforces the closed PUBLIC single-hop transition graph, then delegates to
 * `transitionRoleBindingUnchecked`.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields) {
  if (!ROLE_BINDING_TRANSITIONS[fromState] || !ROLE_BINDING_TRANSITIONS[fromState].has(toState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  return transitionRoleBindingUnchecked(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields);
}

/**
 * R4 round 2, point 4: a compound two-hop transition (`fromState` ->
 * `waypointState` -> `toState`) that validates BOTH hops are legal per the
 * SAME closed `ROLE_BINDING_TRANSITIONS` graph `transitionRoleBinding`
 * itself enforces, but persists ONLY the final `toState` record -- the
 * `waypointState` is never durably written, so it can never be observed
 * mid-flight (by a concurrent reader) in an intentionally-incomplete shape,
 * and never needs its own now-bidirectionally-required fields (e.g.
 * `pending_action_id`) fabricated dishonestly. This is deliberately NOT a
 * new direct edge in the PUBLIC graph (`fromState` -> `toState` stays
 * illegal for every OTHER caller) -- only this function's own two
 * discrete, independently-checked hops license the jump.
 * Used by: `noop`'s own STARTING/REHYDRATING->READY hop (never a genuine
 * pending action to reference) and `quarantineViaRehydrating`'s
 * DEAD/ROTATING->REHYDRATING->QUARANTINED hop (REHYDRATING is a structural
 * graph waypoint only, never a genuine wait).
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBindingAtomicViaWaypoint(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, waypointState, toState, fromRecord, extraFields) {
  if (!ROLE_BINDING_TRANSITIONS[fromState] || !ROLE_BINDING_TRANSITIONS[fromState].has(waypointState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  if (!ROLE_BINDING_TRANSITIONS[waypointState] || !ROLE_BINDING_TRANSITIONS[waypointState].has(toState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  return transitionRoleBindingUnchecked(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields);
}

  return Object.freeze({ ROLE_BINDING_STATE_ENUM, ROLE_BINDING_TRANSITIONS, roleBindingKeyDigest, roleBindingPathFor, roleBindingExtraFieldsAreClosedForState, validateRoleBindingRecordForScope, readRoleBindingState, transitionRoleBindingUnchecked, transitionRoleBinding, transitionRoleBindingAtomicViaWaypoint });
}

module.exports = { createRoleBindingState };
