'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the `notify`
// CLI subcommand handler -- the lazy coordination-artifact.js classifier
// accessor, its two exception-safe wrappers, and the two-phase ingestion-
// request classification (early + fresh-before-mint) around the notify
// action mint. Never requires the facade or a sibling module (its own
// lazy require of coordination-artifact.js is a sibling hook script, not
// the facade/bridge/consultation).

function createCliNotifyHandler({
path, fs, SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, invalidError, unavailableError, emitAndExit,
  makeResult, RC, CANONICAL_ROLES, resolvePolicyPair, sha256File, sha256String,
  validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId, discoverPlan, computeWorktreeId,
  roleProfileDigestFor, readRoleBindingState, canonicalJSONStringify, buildRoleNotifyPayload, generateActionId,
  computeActionTtlSeconds, futureIsoForRegistry, mintRoleLifecycleAction, computeRepoId, actionForEnvelope,
}) {

// ── notify (Frozen CLI ABI, PLAN.md ~L142) ──────────────────────────────────────

const NOTIFY_KIND_ENUM = Object.freeze(['ingestion-request', 'session-control']);

/**
 * R4-TWO-PHASE-CLASSIFICATION (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-
 * 20260819 round 2): lazy accessor for the sibling `.claude/hooks/
 * coordination-artifact.js` module. Lazy by construction (mirrors
 * retainedSupervisorBridgeApi's own lazy require of runtime-bridge-codex.cjs
 * a few hundred lines below) -- required only once handleNotify actually
 * needs it, never at this file's own top level.
 * @returns {object}
 */
function coordinationArtifactModule() {
  return require(path.join(__dirname, '..', '..', '..', '.claude', 'hooks', 'coordination-artifact.js'));
}

/**
 * Exception-safe wrapper around coordinationArtifactModule().classifyIngestionNotifyArtifact
 * -- a require()/classify failure of any kind is never routine; it is always
 * treated as "cannot prove this artifact is valid", never propagated as an
 * uncaught exception (this CLI's stdout-is-always-valid-JSON contract).
 * @param {string} projectRoot
 * @param {string} artifact
 * @returns {{valid:true,phase:'request'|'result',targetRole:string}|{valid:false,reason:string}}
 */
function classifyIngestionNotifyArtifactSafely(projectRoot, artifact) {
  try {
    return coordinationArtifactModule().classifyIngestionNotifyArtifact(artifact, { projectRoot });
  } catch (err) {
    return { valid: false, reason: 'classifier-unavailable' };
  }
}

function validateIngestionResultForSafely(requestPath, approvalPath, resultPath, projectRoot, slug) {
  try {
    const api = coordinationArtifactModule();
    if (!api || typeof api.validateIngestionResultFor !== 'function') return { valid: false, reason: 'validator-unavailable' };
    return api.validateIngestionResultFor(requestPath, approvalPath, resultPath, { projectRoot, slug });
  } catch (error) {
    return { valid: false, reason: 'validator-failed' };
  }
}

/**
 * `notify --project-root <absolute> --role <role> --artifact <canonical-coordination-artifact>
 * --kind <ingestion-request|session-control> [--lifecycle-binding <grant-ref>]` --
 * validate the already-durable artifact and return one lifecycle wake action
 * against an existing READY/WAITING/BUSY binding. Consultation uses the
 * separate `ActivationAction/v1`, never this command. Like `ensure`, this
 * mints a new closed action and therefore requires a valid grant (unlike
 * `ensure` it has no ephemeral fallback -- there is no peer to notify without
 * an existing binding).
 *
 * R4-NOTIFY-ENFORCEMENT (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-20260819
 * round 2): `--kind ingestion-request` is now content-classified via the
 * shared coordination-artifact.js classifier, TWICE -- once early (before
 * validateAndConsumeLifecycleCommandGrant, so an invalid artifact or a
 * `--role` that does not match its derived target role never consumes the
 * grant nor mints anything), and once again, freshly, immediately before
 * mintRoleLifecycleAction (never trusting the early check alone -- closes
 * the window where the artifact could change between the two). `--kind
 * session-control` is completely unaffected: its existing fs.existsSync
 * check (below) remains its whole contract, byte-semantically unchanged.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleNotify(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.notify);
  if (!parsed.ok) {
    usageError('notify');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('notify');
    return;
  }
  const kind = parsed.values['--kind'];
  if (!NOTIFY_KIND_ENUM.includes(kind)) {
    usageError('notify');
    return;
  }

  const role = parsed.values['--role'];
  if (!CANONICAL_ROLES.includes(role)) {
    invalidError('notify', 'NONE');
    return;
  }

  const artifact = parsed.values['--artifact'];
  if (!fs.existsSync(artifact)) {
    invalidError('notify', 'NONE');
    return;
  }

  if (kind === 'ingestion-request') {
    const earlyClassification = classifyIngestionNotifyArtifactSafely(projectRoot, artifact);
    if (!earlyClassification.valid) {
      invalidError('notify', 'NONE');
      return;
    }
    if (earlyClassification.targetRole !== role) {
      invalidError('notify', 'IDENTITY_MISMATCH');
      return;
    }
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('notify', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('notify', 'IDENTITY_MISMATCH');
    return;
  }

  let artifactDigest;
  try {
    artifactDigest = sha256File(artifact);
  } catch (err) {
    invalidError('notify', 'NONE');
    return;
  }
  const argvDigest = sha256String('notify:' + role + ':' + kind + ':' + artifactDigest);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role, 'notify');
  if (!consumeResult.ok) {
    invalidError('notify', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('notify', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    invalidError('notify', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(role);
  const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
  if (!stateResult.ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }
  if (stateResult.state !== 'READY' && stateResult.state !== 'WAITING' && stateResult.state !== 'BUSY') {
    // Never fabricates a wake target for a peer that is not alive.
    unavailableError('notify', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  // Fresh reclassification immediately before the mutating mint call below
  // -- never trusting the early check alone. Ingestion messages are a fixed,
  // code-owned protocol frame plus the canonical path that this function has
  // already confined and classified; no artifact/model-authored prose is
  // interpolated. session-control keeps its original message unchanged.
  let notifyMessage = 'Ingest or apply the referenced artifact, then resume WAITING.';
  if (kind === 'ingestion-request') {
    const freshClassification = classifyIngestionNotifyArtifactSafely(projectRoot, artifact);
    if (!freshClassification.valid) {
      invalidError('notify', 'NONE');
      return;
    }
    if (freshClassification.targetRole !== role) {
      invalidError('notify', 'IDENTITY_MISMATCH');
      return;
    }
    const phase = freshClassification.phase;
    const instruction = phase === 'result'
      ? 'Read artifact_ref exactly, review the correlated ingestion result, then resume WAITING.'
      : 'Read artifact_ref exactly, ingest or apply the approved request, publish its correlated result, then resume WAITING.';
    notifyMessage = `INGESTION_NOTIFY/v1\n${canonicalJSONStringify({
      artifact_ref: path.resolve(artifact),
      instruction,
      phase,
    })}`;
  }

  const payload = buildRoleNotifyPayload(stateResult.record.binding_id, role, artifact, kind, notifyMessage);
  const actionId = generateActionId();
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const notifyTtlResult = computeActionTtlSeconds(pair.policy, binding.expiry);
  if (!notifyTtlResult.ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }
  const notifyExpiresAtIso = futureIsoForRegistry(notifyTtlResult.ttlSeconds);
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-notify', 'claude-native', computeRepoId(projectRoot), binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, role, payload, notifyExpiresAtIso);
  if (!mintResult.ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }

  emitAndExit(makeResult('notify', RC.OK, 'ACTION_REQUIRED', 'NONE', [], [actionForEnvelope(mintResult.action)]));
}

  return Object.freeze({
handleNotify, classifyIngestionNotifyArtifactSafely, validateIngestionResultForSafely,
  });
}

module.exports = { createCliNotifyHandler };
