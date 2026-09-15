'use strict';

// `validate` CLI command controller: full schema/path/authority validation, no mutation.

function createValidateCommand({
  CliError,
  requireFlags,
  resolveAbsolute,
  validateAcceptedResultV1,
  validateAckV1,
  validateActivationIntentV1,
  validateActiveLeaseV1,
  validateCancelV1,
  validateClaimV1,
  validateConflictV1,
  validateConsultV2,
  validateDeliveryV1,
  validateInboxRefV1,
  validateResultV2,
  validateTakeoverV1,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// `validate` -- full schema/path/authority validation, no mutation (PLAN.md ~L775)
// ─────────────────────────────────────────────────────────────────────────────

const VALIDATE_KIND_DISPATCH = {
  'consult-v2': (artifact, coordRoot) => validateConsultV2(artifact, coordRoot),
  'inbox-ref-v1': (artifact, coordRoot) => validateInboxRefV1(artifact, coordRoot),
  'result-v2': (artifact, coordRoot) => validateResultV2(artifact, coordRoot).obj,
  'claim-v1': (artifact, coordRoot) => validateClaimV1(artifact, coordRoot),
  'active-lease-v1': (artifact, coordRoot) => validateActiveLeaseV1(artifact, coordRoot),
  'activation-intent-v1': (artifact) => validateActivationIntentV1(artifact),
  'delivery-v1': (artifact) => validateDeliveryV1(artifact),
  'accepted-result-v1': (artifact) => validateAcceptedResultV1(artifact),
  'ack-v1': (artifact) => validateAckV1(artifact),
  'cancel-v1': (artifact, coordRoot) => validateCancelV1(artifact, coordRoot),
  'conflict-v1': (artifact) => validateConflictV1(artifact),
  'takeover-v1': (artifact) => validateTakeoverV1(artifact),
};

function cmdValidate(flags) {
  requireFlags(flags, ['coordination-root', 'kind', 'artifact']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const artifact = resolveAbsolute(flags.artifact);
  const validator = VALIDATE_KIND_DISPATCH[flags.kind];
  if (!validator) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unknown --kind: ' + flags.kind);
  }
  const obj = validator(artifact, coordRoot);
  return {
    request_id: (obj && (obj.request_id || obj.in_reply_to)) || null,
    artifact_ref: artifact,
  };
}

  return Object.freeze({
    cmdValidate,
    VALIDATE_KIND_DISPATCH,
  });
}

module.exports = { createValidateCommand };
