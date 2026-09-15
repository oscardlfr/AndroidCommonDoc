'use strict';

function createClaudeAuthorityAdmission(deps) {
  const { canonicalJSONStringify, checkAuthorityOperationTransactionTerminal, checkOneShotTransactionTerminalAbsent, classifyClaudeAuthorityForIdentity, currentClockMsForRegistry, isCanonicalIsoUtc, isoToMsForRegistry, sha256String } = deps;

const CLAUDE_AUTHORITY_ADMISSION_OPERATION_KINDS = Object.freeze(['create-binding', 'mint-grant', 'consume-grant']);
const claudeAuthorityAdmissionCapabilities = new WeakSet();

/**
 * M7 defect 1: the ONE shared closed-expectation validator used by BOTH
 * admitClaudeAuthorityOperation's pre-write admission pass and every v2
 * authority writer's own post-write predicate re-check (section 7: "Create
 * and grant paths rerun the complete applicable authority predicate after
 * their write... the cross-family classifier is only one part of that
 * pass"). `classification` must already be `.ok===true` (an ambiguous/error
 * classification propagates directly from classifyClaudeAuthorityForIdentity
 * itself and never reaches this function). `expected` is a closed
 * discriminated shape:
 *   {state:'ABSENT'} -- create-binding: the identity must own NOTHING yet.
 *   {state:'ONE',family,bindingId} -- mint-grant/consume-grant admission, or
 *     any post-write recheck: the identity must own EXACTLY the named
 *     family/binding, never a foreign one.
 * @param {{state:'ABSENT'|'ONE'|'FENCED',family?:string,binding?:object}} classification
 * @param {{state:'ABSENT'}|{state:'ONE',family:string,bindingId:string}} expected
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function checkClaudeAuthorityClassificationAgainstExpected(classification, expected) {
  if (classification.state === 'FENCED') return { ok: false, reason: 'authority-fenced' };
  if (expected.state === 'ABSENT') {
    if (classification.state === 'ABSENT') return { ok: true };
    return { ok: false, reason: 'authority-binding-conflict' };
  }
  if (
    classification.state === 'ONE' && classification.family === expected.family
    && classification.binding && classification.binding.binding_id === expected.bindingId
  ) return { ok: true };
  return { ok: false, reason: 'authority-binding-conflict' };
}

/**
 * M7 section 7: performs the one final fd-bound pass over the complete
 * applicable authority predicate (section 5) via the canonical classifier
 * (section 6), then -- ONLY on success -- mints a fresh, one-use capability.
 * `deadlineIso` is the already-validated deadline the calling operation is
 * about to bind its effect to (e.g. a freshly-computed binding expiry, or a
 * grant's own TTL-derived expiry) -- captured on the capability for
 * traceability, never independently re-validated here (that already
 * happened in the caller's own Phase A, per section 7's own "Phase A must
 * already have fd-validated and pinned... before invoking admission").
 * `expectedBacking` (`{family,bindingId}`) is REQUIRED for `mint-grant`/
 * `consume-grant` (defect 1: admission must confirm the classifier's own
 * ONE candidate is exactly the caller's already-proven backing, never any
 * other live authority for the same identity) and is ignored for
 * `create-binding`, which always expects ABSENT.
 * @param {string|{repoId:string}} repoDescriptor
 * @param {object} identity - the exact closed section-3.1 shape.
 * @param {'create-binding'|'mint-grant'|'consume-grant'} operationKind
 * @param {string} deadlineIso
 * @param {{family:string,bindingId:string}} [expectedBacking]
 * @returns {{ok:true,capability:object,classification:object}|{ok:false,reason:string}}
 */
function admitClaudeAuthorityOperation(repoDescriptor, identity, operationKind, deadlineIso, expectedBacking, proposedOneShotScope) {
  if (!CLAUDE_AUTHORITY_ADMISSION_OPERATION_KINDS.includes(operationKind)) return { ok: false, reason: 'authority-scan-failed' };
  if (typeof deadlineIso !== 'string' || !isCanonicalIsoUtc(deadlineIso)) return { ok: false, reason: 'authority-scan-failed' };
  // M7 GREEN section 4.3 step 1: the deadline must still be LIVE at
  // admission time, not merely shape-valid -- an already-past canonical
  // deadline is rejected here, before classification or any write ever
  // occurs.
  if (currentClockMsForRegistry() >= isoToMsForRegistry(deadlineIso)) return { ok: false, reason: 'binding-expired' };
  let expected;
  if (operationKind === 'create-binding') {
    expected = { state: 'ABSENT' };
  } else {
    if (
      !expectedBacking || typeof expectedBacking !== 'object'
      || typeof expectedBacking.family !== 'string' || expectedBacking.family.length === 0
      || typeof expectedBacking.bindingId !== 'string' || expectedBacking.bindingId.length === 0
    ) return { ok: false, reason: 'authority-scan-failed' };
    expected = { state: 'ONE', family: expectedBacking.family, bindingId: expectedBacking.bindingId };
  }
  // step 2: classify the exact Claude identity.
  const classification = classifyClaudeAuthorityForIdentity(repoDescriptor, identity);
  if (!classification.ok) return classification;
  // step 3: enforce ABSENT for create-binding, or exact ONE/family/bindingId
  // for mint-grant/consume-grant.
  const checked = checkClaudeAuthorityClassificationAgainstExpected(classification, expected);
  if (!checked.ok) return checked;
  // step 4/5 (M7 GREEN section 4.3): for mint-grant/consume-grant, read the
  // applicable authoritative transaction terminal LAST -- using the
  // classifier's OWN just-returned binding, never a caller-selected one --
  // only after the classifier portion of admission has already run
  // (preserves the monotonic first-read linearization proof). A
  // create-binding operation has no backing yet (expected ABSENT) and so has
  // no applicable terminal to check.
  if (operationKind !== 'create-binding') {
    const terminalCheck = checkAuthorityOperationTransactionTerminal(repoDescriptor, expected.family, classification.binding);
    if (!terminalCheck.ok) return terminalCheck;
  }
  // M7 FINAL REMEDIATION Part A, Stage B (Codex architecture_ruling,
  // one_shot): a genuinely NEW one-shot create-binding has no backing yet,
  // so step 4/5 above has nothing to check -- but its own PROPOSED
  // transaction scope can still have acquired a durable authoritative
  // terminal in the window between the caller's own early precheck and this
  // admission call. When the caller supplies one, that proposed scope's
  // terminal is checked HERE -- after the fence/classifier/deadline
  // predicate has already passed, still strictly before the one-use
  // capability is minted -- so a terminal durable at this point denies with
  // zero capability ever issued, and therefore zero chance of the guarded
  // write (marker + binding) running at all.
  if (operationKind === 'create-binding' && proposedOneShotScope) {
    const proposedTerminalCheck = checkOneShotTransactionTerminalAbsent(repoDescriptor, proposedOneShotScope);
    if (!proposedTerminalCheck.ok) return proposedTerminalCheck;
  }
  // step 6: only now mint the one-use capability.
  const authorityIdentityId = sha256String(canonicalJSONStringify(identity));
  const bindingId = (classification.state === 'ONE' && classification.binding) ? classification.binding.binding_id : null;
  const capability = Object.freeze({
    authorityIdentityId, operationKind, bindingId, deadline: deadlineIso,
  });
  claudeAuthorityAdmissionCapabilities.add(capability);
  return { ok: true, capability, classification };
}

/**
 * True iff `capability` is a genuine, still-tracked capability for exactly
 * `operationKind` whose own deadline has not yet passed (M7 checklist item
 * 4: a capability's deadline is part of its own validity, never checked
 * only once back at admission time).
 */
function isValidClaudeAuthorityAdmissionCapability(capability, operationKind) {
  if (!capability || typeof capability !== 'object') return false;
  if (!claudeAuthorityAdmissionCapabilities.has(capability)) return false;
  if (capability.operationKind !== operationKind) return false;
  if (typeof capability.deadline !== 'string' || !isCanonicalIsoUtc(capability.deadline)) return false;
  if (currentClockMsForRegistry() >= isoToMsForRegistry(capability.deadline)) return false;
  return true;
}

/**
 * The structural guarantee section 7 describes: `writeFn` (the actual
 * durable write) can never run without a genuine, matching-operation-kind,
 * still-live capability that only admitClaudeAuthorityOperation can produce
 * -- a caller-forged object with identical field VALUES is rejected (WeakSet
 * membership is by reference, not value). This is the ONE gate every v2
 * authority writer's own final write is routed through. M7 checklist item 3:
 * the capability is removed from the WeakSet BEFORE writeFn ever runs, so it
 * can never guard a second write, even if writeFn itself throws.
 */
function writeGuardedByClaudeAuthorityAdmission(capability, operationKind, writeFn) {
  // M7 GREEN section 4.4 (M7-CAPABILITY-DEADLINE-ENFORCED-04B): a genuine,
  // still-tracked, matching-operation-kind capability whose deadline has
  // elapsed since admission is refused with the SPECIFIC reason
  // binding-expired -- distinguishable from every other admission-capability
  // invalidity (reused/forged/wrong-operation, which stay authority-scan-
  // failed below). Checked before the general validity predicate so this one
  // case gets its own reason instead of collapsing into the generic one.
  if (
    capability && typeof capability === 'object' && claudeAuthorityAdmissionCapabilities.has(capability)
    && capability.operationKind === operationKind
    && typeof capability.deadline === 'string' && isCanonicalIsoUtc(capability.deadline)
    && currentClockMsForRegistry() >= isoToMsForRegistry(capability.deadline)
  ) {
    return { ok: false, reason: 'binding-expired' };
  }
  if (!isValidClaudeAuthorityAdmissionCapability(capability, operationKind)) {
    return { ok: false, reason: 'authority-scan-failed' };
  }
  claudeAuthorityAdmissionCapabilities.delete(capability);
  return writeFn();
}

/**
 * Mints one no-clobber role-command-grant/v1 (PLAN.md Â§15b, ~L592, verbatim
 * closed key-set -- authority enum `requester|target`). `binding` must be a
 * RequesterBinding/v1 (authority:'requester') or a RoleActorBinding/v1 /
 * ClaudeOneShotBinding/v1 (authority:'target'), schema-checked against
 * `authority` so a mismatch mints nothing (mirrors
 * `mintLifecycleCommandGrant`'s own schema-aware minting discipline).
 * `role`/`worktree_id`/`plan_digest` are copied directly from the binding,
 * never independently re-supplied -- what the grant authorizes can never
 * diverge from what its own backing binding actually is. `requestId`/
 * `attemptId`/`leaseEpoch` are nullable (PLAN.md ~L592: null for the
 * non-transaction administrative/read operations
 * `root-init|root-validate|validate` specifically) -- this file does not
 * itself decide WHICH subcommands require them non-null; that is
 * runtime-consultation.cjs's own consume-side enforcement, scoped to
 * whichever subcommands it actually wires grant enforcement for.
 *
 * M7 completeness Part C follow-up (2026-08-09, user Block 3 point 4): a
 * `target`-authority binding may ALSO be a ClaudeOneShotBinding/v1 --
 * runtime-consultation-target-gate.js's own caller decides which type to
 * pass via a deterministic branch on the request's current activation
 * `selected_driver` (arch-integration-prep's own guidance: `'claude-agent'`
 * -> ClaudeOneShotBinding, anything else -> RoleActorBinding, never a
 * fallback/probe-both) -- this function itself only proves the passed
 * object genuinely IS one of the two closed target-eligible shapes, never
 * which one the caller "should" have chosen.
 * @param {string} projectRoot
 * @param {object} binding
 * @param {'requester'|'target'} authority
 * @param {string} subcommand
 * @param {string} argvDigest - sha256 hex over the exact pre-injection argv.
 * @param {string|null} [requestId]
 * @param {string|null} [attemptId]
 * @param {number|null} [leaseEpoch]
 * @returns {{ok:true,grantId:string}|{ok:false,reason:string}}
 */
/**
 * M7 section 6 family label for a binding's own schema literal -- re-derived
 * here so mintRoleCommandGrant's admission and postcheck calls can supply
 * the SAME expected family the classifier itself would report on a ONE
 * classification, without hardcoding it per branch.
 */

  return Object.freeze({ CLAUDE_AUTHORITY_ADMISSION_OPERATION_KINDS, checkClaudeAuthorityClassificationAgainstExpected, admitClaudeAuthorityOperation, isValidClaudeAuthorityAdmissionCapability, writeGuardedByClaudeAuthorityAdmission });
}

module.exports = { createClaudeAuthorityAdmission };

