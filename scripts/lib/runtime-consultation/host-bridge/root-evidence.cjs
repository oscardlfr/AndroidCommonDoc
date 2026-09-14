'use strict';

function createRootEvidenceModule(deps) {
  const {
    CliError,
    planRootPath,
    requestPathFor,
    readCanonicalRequestRecord,
    parseApprovedContext7Directive,
    parsePreferredContext7Directive,
    findCorrelatedRootConsultIntent,
    getRuntimeRoleLifecycle
  } = deps;

  function resolveRootEvidenceAuthority(reqObj, reqDigest, coordRoot, expectedTargetScope) {
    const isRoot = reqObj.request_id === reqObj.root_request_id;
    let rootReqObj = reqObj;
    let rootDigest = reqDigest;
    if (!isRoot) {
      const rootPlanRoot = planRootPath(coordRoot, reqObj.repo_id, reqObj.wave_slug, reqObj.plan_digest);
      const rootPath = requestPathFor(rootPlanRoot, reqObj.root_request_id);
      const rootRec = readCanonicalRequestRecord(rootPath, reqObj.root_request_id, {
        absentDetail: 'CORRELATION_INVALID', absentMessage: 'root request does not resolve for evidence authority resolution',
      });
      rootReqObj = rootRec.obj;
      rootDigest = rootRec.digest;
      if (
        rootReqObj.root_request_id !== rootReqObj.request_id || rootReqObj.parent_request_id !== null || rootReqObj.depth !== 0
        || rootReqObj.repo_id !== reqObj.repo_id || rootReqObj.wave_slug !== reqObj.wave_slug
        || rootReqObj.plan_digest !== reqObj.plan_digest || rootReqObj.protocol_profile !== reqObj.protocol_profile
        || rootReqObj.subject_repo_id !== reqObj.subject_repo_id || rootReqObj.subject_worktree_id !== reqObj.subject_worktree_id
        || rootReqObj.subject_head !== reqObj.subject_head || rootReqObj.subject_scope_digest !== reqObj.subject_scope_digest
        || rootReqObj.routing_policy_version !== reqObj.routing_policy_version
        || rootReqObj.routing_policy_digest !== reqObj.routing_policy_digest
        || rootReqObj.coordination_root_id !== reqObj.coordination_root_id
      ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'descendant does not correlate with its root for evidence authority resolution');
    }

    const rootConsultIntent = findCorrelatedRootConsultIntent(rootReqObj, isRoot ? expectedTargetScope : undefined);
    let rll;
    try { rll = getRuntimeRoleLifecycle(); }
    catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
    if (typeof rll.findRootSourceProvenanceForRequestId !== 'function') {
      throw new CliError('INVALID', 'INTERNAL_ERROR', 'root-source provenance lookup unavailable');
    }
    const provenance = rll.findRootSourceProvenanceForRequestId({ repoId: rootReqObj.repo_id }, rootReqObj.request_id);
    if (!provenance.ok) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source provenance lookup is malformed or ambiguous: ' + provenance.reason);
    }
    const hasRootConsult = rootConsultIntent !== null;
    const hasRootSource = provenance.absent !== true;
    if (hasRootConsult && hasRootSource) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root request has both root-consult and root-source evidence authority');
    }
    if (hasRootConsult) return { policy: rootConsultIntent.evidence_policy, libraryId: null };
    if (hasRootSource) {
      const p = provenance.provenance;
      if (
        rootReqObj.source_role !== 'toolkit-specialist' || rootReqObj.target_role !== 'arch-platform'
        || rootDigest !== p.ingress.request_digest
        || rootReqObj.requester_instance_id !== p.binding.actor_instance_id
        || rootReqObj.plan_digest !== p.ingress.plan_digest || rootReqObj.plan_digest !== p.binding.plan_digest
        || rootReqObj.question !== p.bootstrapIntent.question
        || rootReqObj.expected_result_kind !== p.bootstrapIntent.expected_result_kind
      ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source provenance does not correlate with its root request');
      const directive = parseApprovedContext7Directive(rootReqObj.question);
      const preferredDirective = parsePreferredContext7Directive(rootReqObj.question);
      if (directive.present && preferredDirective.present) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source question carries both APPROVED_CONTEXT7_LIBRARY_ID and PREFERRED_CONTEXT7_LIBRARY_ID directives');
      }
      if (directive.present) return { policy: 'context7-required', libraryId: directive.libraryId };
      if (preferredDirective.present) return { policy: 'context7-preferred', libraryId: preferredDirective.libraryId };
      return { policy: 'none', libraryId: null };
    }
    return { policy: 'none', libraryId: null };
  }


  return {
    resolveRootEvidenceAuthority
  };
}

module.exports = { createRootEvidenceModule };

