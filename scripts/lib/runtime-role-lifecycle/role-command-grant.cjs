'use strict';

function createRoleCommandGrant(deps) {
  const {
    path, Buffer, CLAUDE_AUTHORITY_IDENTITY_SCHEMA, CLAUDE_ONE_SHOT_BINDING_KEYS, CLAUDE_ONE_SHOT_BINDING_KEYS_V2, CLAUDE_ONE_SHOT_BINDING_SCHEMA, CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
    REQUESTER_BINDING_KEYS, REQUESTER_BINDING_KEYS_V2, REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_SCHEMA_V2, ROLE_ACTOR_BINDING_KEYS, ROLE_ACTOR_BINDING_SCHEMA, ROOT_SOURCE_BINDING_KEYS,
    ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_SCHEMA_V2, admitClaudeAuthorityOperation, canonicalJSONStringify, checkAuthorityOperationTransactionTerminal,
    checkClaudeAuthorityClassificationAgainstExpected, checkOneShotTransactionTerminalAbsent, checkRootSourceTransactionTerminalAbsent, classifyClaudeAuthorityForIdentity,
    claudeAuthorityFamilyForBindingSchema, claudeOneShotBindingPathFor, computeClaudeAuthorityIdentityId, crypto, currentClockMsForRegistry, ensureSecureRegistryDir, hasExactKeys, isCanonicalIsoUtc,
    isHexDigest64, isIntInRangeNum, isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry, publishNoClobber, readClaudeAuthorityFence, readRegistryRecord, resolveM7RepoId,
    rootSourceIngressPathFor, testM7Rendezvous, validateRequesterBindingFor, validateRootSourceBindingFor, validateRootSourceIngressRecord, writeGuardedByClaudeAuthorityAdmission, registryRepoDir,
  } = deps;

const ROLE_COMMAND_GRANT_SCHEMA = 'runtime/role-command-grant/v1';
const ROLE_COMMAND_GRANT_TTL_SECONDS = 30; // PLAN.md Â§15b mirrors lifecycle-command-grant/v1's own <=30s ceiling.
const ROLE_COMMAND_GRANT_KEYS = Object.freeze([
  'actor_instance_id', 'attempt_id', 'authority', 'binding_id',
  'canonical_argv_digest', 'created_at', 'expiry', 'grant_id', 'lease_epoch',
  'plan_digest', 'request_id', 'role', 'schema', 'subcommand', 'worktree_id',
].sort());
const ROLE_COMMAND_GRANT_AUTHORITY_ENUM = Object.freeze(['requester', 'target']);

function roleCommandGrantPathFor(projectRootOrRepoDescriptor, grantId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'role-command-grants', grantId + '.json');
}

function roleCommandGrantConsumedMarkerPathFor(projectRootOrRepoDescriptor, grantId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'role-command-grants', grantId + '.consumed');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// M7 section 6: one canonical classifier. Owns the bounded, closed scan across
// every Claude-actor-cut binding family for one exact observed identity.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


function mintRoleCommandGrant(projectRoot, binding, authority, subcommand, argvDigest, requestId, attemptId, leaseEpoch) {
  if (!ROLE_COMMAND_GRANT_AUTHORITY_ENUM.includes(authority)) return { ok: false, reason: 'invalid-authority' };
  let isClaudeAuthorityV2Backing = false;
  let claudeAuthorityIdentityId = null;
  if (authority === 'requester') {
    if (!binding) return { ok: false, reason: 'binding-authority-schema-mismatch' };
    // M7 section 4.4: a well-formed legacy v1 backing is recognized and
    // rejected distinctly -- never a backing or candidate for a fresh grant.
    if (
      (binding.schema === REQUESTER_BINDING_SCHEMA && hasExactKeys(binding, REQUESTER_BINDING_KEYS))
      || (binding.schema === ROOT_SOURCE_BINDING_SCHEMA && hasExactKeys(binding, ROOT_SOURCE_BINDING_KEYS))
    ) {
      return { ok: false, reason: 'legacy-binding-non-authoritative' };
    }
    if (!(
      (binding.schema === REQUESTER_BINDING_SCHEMA_V2 && hasExactKeys(binding, REQUESTER_BINDING_KEYS_V2))
      || (binding.schema === ROOT_SOURCE_BINDING_SCHEMA_V2 && hasExactKeys(binding, ROOT_SOURCE_BINDING_KEYS_V2))
    )) {
      return { ok: false, reason: 'binding-authority-schema-mismatch' };
    }
    // M7 section 1 point 3 / section 5 (RED 19): the caller-supplied
    // object's OWN claimed expiry is checked directly here, before any
    // further work -- a read-only cut, write zero bytes -- in addition to
    // (never instead of) the independent fresh fd-bound re-read immediately
    // below, which alone could not catch a caller lying about an otherwise-
    // genuinely-live backing's own held copy.
    if (!isCanonicalIsoUtc(binding.expiry) || currentClockMsForRegistry() >= isoToMsForRegistry(binding.expiry)) {
      return { ok: false, reason: 'binding-expired' };
    }
    // M7 section 1/5/7: every RoleCommandGrant consumer repeats the total
    // authority predicate -- an independent, FRESH fd-bound re-read of the
    // backing binding, never trusting the caller-supplied object's own
    // expiry/generation/fence/family-proof fields (RED 19: never trusted
    // from mint time). Both validators already implement the complete
    // section-5 predicate for their own family.
    if (binding.schema === REQUESTER_BINDING_SCHEMA_V2) {
      const revalidated = validateRequesterBindingFor(projectRoot, binding.binding_id, binding.role, binding.worktree_id, binding.plan_digest);
      if (!revalidated.ok) return { ok: false, reason: revalidated.reason };
      if (revalidated.binding.actor_instance_id !== binding.actor_instance_id) return { ok: false, reason: 'binding-authority-schema-mismatch' };
      binding = revalidated.binding;
    } else {
      const revalidated = validateRootSourceBindingFor(projectRoot, binding.binding_id, 'toolkit-specialist', binding.worktree_id, binding.plan_digest);
      if (!revalidated.ok) return { ok: false, reason: revalidated.reason };
      if (revalidated.binding.actor_instance_id !== binding.actor_instance_id) return { ok: false, reason: 'binding-authority-schema-mismatch' };
      binding = revalidated.binding;
    }
    // M7 defect 11 (section 4.1/12): the Claude fence/classifier/admission
    // path applies ONLY to a claude-hook-backed requester/root-source
    // binding -- a codex-supervisor binding keeps its existing retained-host
    // proof path (the revalidation above) completely untouched by M7.
    isClaudeAuthorityV2Backing = (binding.runtime === 'claude-hook');
  } else if (!binding || !(
    (binding.schema === ROLE_ACTOR_BINDING_SCHEMA && hasExactKeys(binding, ROLE_ACTOR_BINDING_KEYS))
    || (binding.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2 && hasExactKeys(binding, CLAUDE_ONE_SHOT_BINDING_KEYS_V2))
    || (binding.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA && hasExactKeys(binding, CLAUDE_ONE_SHOT_BINDING_KEYS))
  )) {
    return { ok: false, reason: 'binding-authority-schema-mismatch' };
  } else if (binding.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA) {
    return { ok: false, reason: 'legacy-binding-non-authoritative' };
  } else if (binding.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2) {
    // M7 section 5: an independent fresh fd-bound re-read (never the
    // caller-supplied object). This function does not itself resolve the
    // one-shot family's own transaction-scope tuple (requestId/attemptId/
    // leaseEpoch may legitimately be null at this call site) -- unlike
    // validateClaudeOneShotBindingFor, which requires it -- so the shape is
    // re-proven directly here, not via that stricter validator.
    const freshRead = readRegistryRecord(claudeOneShotBindingPathFor(projectRoot, binding.binding_id));
    if (
      !freshRead.ok || freshRead.absent || !freshRead.obj
      || !hasExactKeys(freshRead.obj, CLAUDE_ONE_SHOT_BINDING_KEYS_V2)
      || freshRead.obj.schema !== CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2
      || freshRead.obj.binding_id !== binding.binding_id
      || freshRead.obj.actor_instance_id !== binding.actor_instance_id
    ) {
      return { ok: false, reason: 'binding-authority-schema-mismatch' };
    }
    binding = freshRead.obj;
    if (!isCanonicalIsoUtc(binding.expiry) || currentClockMsForRegistry() >= isoToMsForRegistry(binding.expiry)) {
      return { ok: false, reason: 'binding-expired' };
    }
    // M7 defect 7 (section 4.4/8.5): authority liveness never consults the
    // legacy schema-less .retired sidecar marker -- it is diagnostics-only
    // and must never gate a v2 binding. Authority is cut exclusively via the
    // fence/generation/expiry monotonic cuts (checked here and by admission
    // below) and the transaction terminal (checked further down).
    isClaudeAuthorityV2Backing = true;
    claudeAuthorityIdentityId = computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', binding.runtime_session_key, binding.agent_id);
    const fenceRead = readClaudeAuthorityFence(projectRoot, claudeAuthorityIdentityId);
    if (!fenceRead.ok) return { ok: false, reason: 'authority-fence-invalid' };
    if (!fenceRead.absent) return { ok: false, reason: 'authority-fenced' };
  }
  if (typeof subcommand !== 'string' || subcommand.length === 0) return { ok: false, reason: 'invalid-subcommand' };
  if (authority === 'requester' && binding.schema === ROOT_SOURCE_BINDING_SCHEMA_V2) {
    const ingressRead = readRegistryRecord(rootSourceIngressPathFor(projectRoot, binding.binding_id));
    if (!ingressRead.ok) return { ok: false, reason: ingressRead.reason };
    const beforeIngress = ['root-init', 'root-validate', 'validate', 'publish-blob', 'publish-request'];
    const afterIngress = ['dispatch', 'await-result', 'accept-result', 'transaction-ack', 'cancel', 'cleanup', 'record-delivery'];
    if (ingressRead.absent ? !beforeIngress.includes(subcommand) : !afterIngress.includes(subcommand)) {
      return { ok: false, reason: 'root-source-subcommand-not-admitted' };
    }
    if (ingressRead.absent && !(requestId == null && attemptId == null && leaseEpoch == null)) {
      return { ok: false, reason: 'root-source-pre-ingress-scope-must-be-null' };
    }
    if (!ingressRead.absent) {
      const ingressValid = validateRootSourceIngressRecord(ingressRead.obj, {
        binding_id: binding.binding_id, action_id: binding.action_id,
        requester_instance_id: binding.actor_instance_id, source_role: 'toolkit-specialist',
        target_role: 'arch-platform', worktree_id: binding.worktree_id,
        plan_digest: binding.plan_digest, subject_scope_digest: binding.subject_scope_digest,
        request_expiry: binding.request_expiry,
      });
      if (!ingressValid.ok) return { ok: false, reason: ingressValid.reason };
      const ingress = ingressValid.record;
      if (requestId !== ingress.request_id) return { ok: false, reason: 'root-source-request-mismatch' };
      // M7 section 5 point 5 (RED 16, M7-ROOT-TERMINAL-CUT; defect 6: fd-bound,
      // never fs.existsSync): family proof after ingress -- neither canonical
      // ack.json nor cancel.json exists. Both mutually exclusive terminals are
      // checked directly (never via a retirement marker, which is
      // diagnostics-only per section 4.4); a genuine read error fails closed.
      const terminalCheck = checkRootSourceTransactionTerminalAbsent(projectRoot, binding, requestId);
      if (!terminalCheck.ok) return terminalCheck;
    }
  }
  if (authority === 'target' && binding.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2) {
    // M7 section 5 (RED 17, M7-ONESHOT-TERMINAL-CUT; defect 6: fd-bound,
    // never fs.existsSync, and the AUTHORITATIVE result -- results/<attempt>
    // .json, never accepted-result.json, per section 8.5: "one-shot
    // publish-result is cut by the authoritative result") -- family proof:
    // neither the one-shot family's own authoritative result nor cancel.json
    // exists yet. Never trusts the caller-supplied requestId parameter
    // without cross-checking it against the freshly re-read binding's own
    // stored request_id first.
    if (requestId !== binding.request_id) return { ok: false, reason: 'claude-one-shot-request-mismatch' };
    const terminalCheck = checkOneShotTransactionTerminalAbsent(projectRoot, binding);
    if (!terminalCheck.ok) return terminalCheck;
  }
  if (!isHexDigest64(argvDigest)) return { ok: false, reason: 'invalid-argv-digest' };
  const resolvedRequestId = requestId === undefined ? null : requestId;
  const resolvedAttemptId = attemptId === undefined ? null : attemptId;
  const resolvedLeaseEpoch = leaseEpoch === undefined ? null : leaseEpoch;
  if (resolvedRequestId !== null && (typeof resolvedRequestId !== 'string' || resolvedRequestId.length === 0)) return { ok: false, reason: 'invalid-request-id' };
  if (resolvedAttemptId !== null && (typeof resolvedAttemptId !== 'string' || resolvedAttemptId.length === 0)) return { ok: false, reason: 'invalid-attempt-id' };
  if (resolvedLeaseEpoch !== null && !isIntInRangeNum(resolvedLeaseEpoch, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'invalid-lease-epoch' };

  const grantId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const grantExpiry = isoPlusSecondsForRegistry(nowStr, ROLE_COMMAND_GRANT_TTL_SECONDS);

  // M7 section 7: obtain mint-grant admission through the full final
  // predicate pass -- ONLY for a Claude v2 backing ("RoleActor/Codex
  // branches keep their existing path"). Phase A (all the schema/expiry/
  // fresh-read/ingress/terminal validation above) has already fd-validated
  // and pinned every positive input; this call's own classifier scan is the
  // linearization point, and the returned capability is what
  // writeGuardedByClaudeAuthorityAdmission below requires to proceed.
  let mintCapability = null;
  if (isClaudeAuthorityV2Backing) {
    const provider = binding.runtime || 'claude-hook';
    const agentIdForIdentity = binding.agent_key !== undefined ? binding.agent_key : binding.agent_id;
    const authorityIdentity = {
      schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider,
      repo_id: resolveM7RepoId(projectRoot), runtime_session_key: binding.runtime_session_key, agent_id: agentIdForIdentity,
    };
    // M7 defect 1: mint-grant admission must confirm the classifier's own
    // ONE candidate is exactly this already-proven backing, never merely
    // "not fenced".
    // M7 CORRECTION C2 (Codex final ruling): admission receives canonical
    // PROJECT scope only (projectRoot, already this function's own param) --
    // it derives its own step-5 terminal-check path internally from the
    // classifier's own resolved binding, never a caller-computed
    // txnDir/operationContext.
    const mintFamily = claudeAuthorityFamilyForBindingSchema(binding.schema);
    const admission = admitClaudeAuthorityOperation(projectRoot, authorityIdentity, 'mint-grant', grantExpiry, {
      family: mintFamily, bindingId: binding.binding_id,
    });
    if (!admission.ok) return { ok: false, reason: admission.reason };
    mintCapability = admission.capability;
  }

  const grant = {
    schema: ROLE_COMMAND_GRANT_SCHEMA,
    grant_id: grantId,
    binding_id: binding.binding_id,
    actor_instance_id: binding.actor_instance_id,
    authority,
    subcommand,
    request_id: resolvedRequestId,
    attempt_id: resolvedAttemptId,
    lease_epoch: resolvedLeaseEpoch,
    canonical_argv_digest: argvDigest,
    plan_digest: binding.plan_digest,
    worktree_id: binding.worktree_id,
    role: binding.role,
    created_at: nowStr,
    expiry: grantExpiry,
  };
  const grantPath = roleCommandGrantPathFor(projectRoot, grantId);
  const dirResult = ensureSecureRegistryDir(path.dirname(grantPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  testM7Rendezvous('grant-after-admission-before-write', projectRoot);
  const publishGrant = () => {
    try {
      publishNoClobber(grantPath, Buffer.from(canonicalJSONStringify(grant), 'utf8'), {});
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'grant-publish-failed' };
    }
  };
  const grantWriteResult = isClaudeAuthorityV2Backing
    ? writeGuardedByClaudeAuthorityAdmission(mintCapability, 'mint-grant', publishGrant)
    : publishGrant();
  if (!grantWriteResult.ok) {
    return { ok: false, reason: grantWriteResult.reason };
  }
  // M7 section 7 / defect 4: rerun the complete applicable authority
  // predicate after the write and before returning success -- the
  // cross-family classifier (not merely a family-local re-validate or a bare
  // fence read) is only one part of that pass; the applicable transaction
  // terminal is re-checked too, so a fence OR a terminal landing during the
  // admission-to-write window still denies the operation, leaving only the
  // already-published grant as an inert record (RED 14).
  if (isClaudeAuthorityV2Backing) {
    const provider = binding.runtime || 'claude-hook';
    const agentIdForIdentity = binding.agent_key !== undefined ? binding.agent_key : binding.agent_id;
    const postAuthorityIdentity = {
      schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider,
      repo_id: resolveM7RepoId(projectRoot), runtime_session_key: binding.runtime_session_key, agent_id: agentIdForIdentity,
    };
    const postClassification = classifyClaudeAuthorityForIdentity(projectRoot, postAuthorityIdentity);
    if (!postClassification.ok) return postClassification;
    const postCheck = checkClaudeAuthorityClassificationAgainstExpected(postClassification, {
      state: 'ONE', family: claudeAuthorityFamilyForBindingSchema(binding.schema), bindingId: binding.binding_id,
    });
    if (!postCheck.ok) return postCheck;
    // Stage C (M7-FINAL-REMEDIATION-20260818, root_source_postwrite ruling):
    // the canonical cross-family terminal check, using postClassification's
    // OWN family/binding (the fresh, authoritative post-write read), never
    // the pre-write `binding` variable this function's own Phase A already
    // revalidated once. checkAuthorityOperationTransactionTerminal already
    // treats pre-ingress RootSource as OPEN and performs full
    // validateRootSourceIngressRecord correlation when ingress exists (the
    // same shape/correlation validation mintRoleCommandGrant's own Phase A
    // root-source branch above already uses), replacing the family-specific
    // shallow `typeof ingressRead.obj.request_id === 'string'` check this
    // block used to have -- a parseable but decorrelated (e.g. wrong
    // action_id) ingress landing in the admission-to-write window used to
    // pass that shallow check and report success; it does not survive full
    // correlation. Preserves OneShot's own authoritative result/v2
    // semantics unchanged (same helper, same 'one-shot' branch). The
    // already-published grant is never deleted or rolled back on a denial
    // here -- it remains inert diagnostic evidence, exactly as before.
    const terminalCheck = checkAuthorityOperationTransactionTerminal(projectRoot, postClassification.family, postClassification.binding);
    if (!terminalCheck.ok) return terminalCheck;
  }
  return { ok: true, grantId };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// WP3 item C correction pass R3 (point A.1): lifecycle-command-grant/v1
// implemented LITERALLY per PLAN.md ~L576 -- exact schema/key-set,
// binding_kind/authority/profile enums, the frozen profile->admitted-
// subcommand table, action_id required-iff-{action-failed,ready,wait-ready},
// closed role union (string | sorted-unique-non-empty-canonical-array |
// null), and a hard <=30s TTL. One-use, hook-minted (real hook wiring is
// WP4; this file implements creation+validation+atomic-consumption so a fake
// hook -- a test, or eventually the real one -- can exercise the exact same
// path). The caller/model can never mint one: `--lifecycle-binding` is a
// RECOGNIZED flag only for `ensure`/`ready` (added to SUBCOMMAND_SPEC below),
// but its VALUE is meaningless unless it resolves to a real, unexpired,
// unconsumed grant record naming a real, unexpired binding -- a guessed/forged
// reference fails validation identically to a caller who never supplied the
// flag at all. Grant records are immutable/no-clobber (an attacker cannot
// overwrite one to extend its life); consumption is tracked via a SEPARATE
// no-clobber marker so a replay (reusing the same grant_id twice) collides
// EEXIST and is rejected -- the classic no-clobber-as-election idiom already
// used throughout the sibling module.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  return Object.freeze({ ROLE_COMMAND_GRANT_SCHEMA, ROLE_COMMAND_GRANT_TTL_SECONDS, ROLE_COMMAND_GRANT_KEYS, ROLE_COMMAND_GRANT_AUTHORITY_ENUM, roleCommandGrantPathFor, roleCommandGrantConsumedMarkerPathFor, mintRoleCommandGrant });
}

module.exports = { createRoleCommandGrant };

