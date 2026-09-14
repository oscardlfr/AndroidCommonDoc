'use strict';

function createRootIntentsModule(deps) {
  const {
    path,
    CliError,
    requireHostBridgeCapability,
    resolveAbsolute,
    computeCoordRootId,
    getRuntimeRoleLifecycle,
    classifyDurableRead,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    sha256Buffer
  } = deps;

  function hostBridgeListRootConsultIntents(capability, coordRootRaw) {
    const scope = requireHostBridgeCapability(capability);
    // Resolve and confine even though lifecycle records themselves are host-
    // private: the caller must not swap the coordination scope independently.
    const coordRoot = resolveAbsolute(coordRootRaw);
    if (computeCoordRootId(coordRoot) !== computeCoordRootId(path.resolve(coordRoot))) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'root-consult coordination root identity invalid');
    }
    let rll;
    try { rll = getRuntimeRoleLifecycle(); }
    catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
    const listed = rll.listRootConsultIntentsForActor(scope.projectRoot, scope.actorInstanceId);
    if (!listed || listed.ok !== true || !Array.isArray(listed.intents)) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult intent scan failed');
    }
    if (listed.intents.length > 1024) throw new CliError('INVALID', 'SECURITY_INVALID', 'root-consult intent scan cap exceeded');
    const output = listed.intents.map((intent) => {
      const valid = rll.validateRootConsultIntentRecord(intent, {
        requester_actor_instance_id: scope.actorInstanceId,
        requester_role: scope.role,
        worktree_id: scope.worktreeId,
        plan_digest: scope.planDigest,
      });
      if (!valid.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent does not match HostBridgeCapability');
      return {
        intentPath: rll.rootConsultIntentPathFor(scope.projectRoot, intent.intent_id),
        intentId: intent.intent_id,
        createdAt: intent.created_at,
      };
    });
    output.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.intentId.localeCompare(b.intentId));
    return output;
  }

  function readLifecycleRecordRequired(rll, recordPath, validator, expected, label) {
    const classified = classifyDurableRead(recordPath, { parse: true });
    if (classified.state === DURABLE_ABSENT) return null;
    if (classified.state === DURABLE_PENDING) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', label + ' is still pending durability');
    }
    const valid = validator(classified.obj, expected);
    if (!valid || valid.ok !== true) throw new CliError('INVALID', 'AUTHORITY_INVALID', label + ' is malformed or foreign');
    return {
      obj: valid.record, bytes: classified.bytes,
      digest: sha256Buffer(classified.bytes), path: recordPath,
    };
  }

  /**
   * Resolves host-private root-consult policy from the immutable lifecycle
   * intent.  The request is the lookup key, not the current target actor: the
   * intent belongs to the source architect while inbox polling runs under the
   * target capability.  Ordinary and nested requests have no matching intent
   * and therefore retain policy `none`.
   */
  function findCorrelatedRootConsultIntent(reqObj, expectedTargetScope) {
    let rll;
    try { rll = getRuntimeRoleLifecycle(); }
    catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
    if (typeof rll.findRootConsultIntentByRequestId !== 'function') {
      throw new CliError('INVALID', 'INTERNAL_ERROR', 'root-consult request lookup unavailable');
    }
    const found = rll.findRootConsultIntentByRequestId({ repoId: reqObj.repo_id }, reqObj.request_id);
    if (!found || found.ok !== true) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult request lookup is malformed or ambiguous');
    }
    if (found.absent === true) return null;
    const expected = {
      request_id: reqObj.request_id,
      repo_id: reqObj.repo_id,
      coordination_root_id: reqObj.coordination_root_id,
      requester_role: reqObj.source_role,
      requester_actor_instance_id: reqObj.requester_instance_id,
      target_role: reqObj.target_role,
      worktree_id: reqObj.requester_worktree_id,
      plan_digest: reqObj.plan_digest,
      target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id,
      subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest,
      request_created_at: reqObj.created_at,
      request_expiry: reqObj.expiry,
    };
    const valid = rll.validateRootConsultIntentRecord(found.intent, expected);
    if (!valid || valid.ok !== true) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent does not correlate to its request');
    }
    if (
      reqObj.root_request_id !== reqObj.request_id
      || reqObj.parent_request_id !== null
      || reqObj.depth !== 0
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent correlates only to root topology');
    if (expectedTargetScope && (
      valid.record.target_role !== expectedTargetScope.role
      || valid.record.worktree_id !== expectedTargetScope.worktreeId
      || valid.record.plan_digest !== expectedTargetScope.planDigest
    )) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent does not match target HostBridgeCapability');
    return valid.record;
  }

  /**
   * M6/M7 terminal functional closure, point C: the single canonical
   * root-aware evidence-authority resolver, superseding the old
   * root-consult-only rootConsultEvidencePolicyForRequest (which silently
   * returned 'none' for any root-source-originated request or descendant,
   * since findCorrelatedRootConsultIntent only ever matches a request whose
   * OWN request_id equals a minted root-consult intent's request_id -- true
   * only when reqObj already IS that intent's root).
   *
   * For ANY root or descendant reqObj: (1) reopens the ROOT's own canonical
   * request bytes from root_request_id (a no-op re-read when reqObj already is
   * the root); (2) resolves EITHER a root-consult intent (existing, byte-exact
   * unchanged private evidence_policy authority) OR root-source provenance
   * (point B's lookup, deriving policy+libraryId from the root's own question
   * text via point A's directive parser) -- never both; (3) revalidates the
   * descendant's own identity against its root before propagating; (4)
   * returns the SAME { policy, libraryId } to every descendant of that root.
   *
   * `expectedTargetScope`, when supplied, is applied only when reqObj already
   * is the root (the pre-existing root-consult semantic: "does this root's own
   * target correlate with the CURRENT worker checking its own obligations") --
   * never re-applied against a refetched root on behalf of an unrelated
   * descendant worker, which would compare the wrong role.
   *
   * @returns {{policy:'none'|'context7-required'|'context7-preferred', libraryId: string|null}}
   */

  return {
    hostBridgeListRootConsultIntents,
    readLifecycleRecordRequired,
    findCorrelatedRootConsultIntent
  };
}

module.exports = { createRootIntentsModule };

