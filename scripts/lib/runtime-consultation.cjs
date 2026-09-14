#!/usr/bin/env node
'use strict';

/**
 * Portable runtime-consultation compatibility facade and composition root.
 *
 * Frozen Production CLI ABI: `node runtime-consultation.cjs <subcommand> --flag value ...`.
 * Every subcommand prints exactly one `coordination/cli-result/v1` JSON object on stdout
 * plus a trailing newline, and exits with the frozen rc/status mapping. See PLAN.md
 * "Frozen Production CLI ABI" (~L750-796) for the complete contract this file implements.
 *
 * Cohesive implementations live under `runtime-consultation/`; this facade preserves
 * the frozen CLI/CommonJS ABI and wires protocol, durability, transactions, locks,
 * host-bridge operations, content publication, routing and platform adapters.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Generic primitives (frozen enums, CliError, canonical JSON/SHA-256,
// process-scoped fixed-id/fixed-clock test state, capability checks and
// base64url) are owned by the leaf module below. Stable public helpers are
// re-exported by reference; the facade adds no duplicate implementation.
const {
  CLI_RESULT_SCHEMA, RC_FOR_STATUS, DRIVER_ENUM, CliError,
  canonicalJSONStringify, sortKeysDeep, sha256Buffer, sha256String, sha256File,
  genId, genId128,
  resolveFixedClockState, currentClockMs, nowIso, isoPlusSeconds, isoToMs,
  isTestCapability, decodeBase64Url, encodeBase64Url,
  activateFixedIds, isFixedIdsActive, isFixedClockActive, getFixedClockBaseMs,
} = require('./runtime-consultation/primitives.cjs');

const {
  ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND, ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY,
  parseFlags, requireFlags, resolveAbsolute,
} = require('./runtime-consultation/cli-argv.cjs');
const {
  gitRevParse, realpathOrSelf, computeRepoId, computeWorktreeId,
  statIdentityOrNull, readlinkOrNull, readFdBoundFileOrNull,
  sealGitIdentityFor, statIdentityEqual, gitTopologySealsMatch, sealCorrelatesWithGitCommonDir, resolveSealedGitCache,
  computeSubjectHead, computeCoordRootId,
} = require('./runtime-consultation/git-identity.cjs');
const {
  planRootPath, planRootFromArtifact, realpathDeepestExisting,
  assertGenuinelyConfinedUnderRoot, assertCanonicalFilename, assertRootConfinedToWorktree,
  transactionsDir, transactionDir, requestPathFor,
  activationPathFor, claimPathFor, activeLeasePathFor, resultPathFor, deliveryPathFor, activationIntentPathFor,
  takeoverPathFor, acceptedResultPathFor, ackPathFor, cancelPathFor,
  inboxPathFor, blobPathFor, patternEvidencePathFor,
  stopPathFor, stopAckPathFor,
  HEX_ID_RE, assertSafeSegment, assertHexId,
} = require('./runtime-consultation/coordination-paths.cjs');
const {
  DEFAULT_MAX_DURABLE_ARTIFACT_BYTES,
  MAX_ENUM_HARD_CAP, MAX_ENUM_KEPT_ENTRIES,
  insertBoundedCandidate, readAllFromFd, statIsRegularFile,
} = require('./runtime-consultation/durability/common.cjs');
const {
  DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT, createDurableReaders,
} = require('./runtime-consultation/durability/read.cjs');
const {
  reconcileOneNoClobberTemp, reconcileTempArtifacts,
} = require('./runtime-consultation/durability/reconcile.cjs');
const { createDurableWriters } = require('./runtime-consultation/durability/write.cjs');
const {
  isPathWithin, assertAncestorChainConfined,
} = require('./runtime-consultation/transition-lock/confinement.cjs');
const {
  sleepSync, testRendezvous, testM7Rendezvous, resolveSafeM7RendezvousDir,
} = require('./runtime-consultation/transition-lock/rendezvous.cjs');
const {
  createTransitionLockState,
} = require('./runtime-consultation/transition-lock/state.cjs');
const {
  createTransitionLockLifecycle,
} = require('./runtime-consultation/transition-lock/lifecycle.cjs');

const facadeDirname = __dirname;

const { createWindowsAclModule } = require('./runtime-consultation/root-lifecycle/windows-acl.cjs');
const {
  WINDOWS_PRIVATE_DIRECTORY_ACL_SCRIPT,
  __windowsAclProbeCallCounts,
  assertWindowsPrivateDirectoryAcl,
  assertWindowsRootAclProbeAvailable,
  normalizeWindowsAclObservation,
  resolvedWindowsPowerShellPath,
  windowsAclSnapshotsEqual,
  windowsPrivateDirectoryAcl,
} = createWindowsAclModule({
  CliError,
  execFileSync,
  fs,
  isFixedClockActive,
  isFixedIdsActive,
  isPathWithin,
  isTestCapability,
  path,
});

const { createRootLifecycle } = require('./runtime-consultation/root-lifecycle/root-lifecycle.cjs');
const {
  cmdRootInit,
  cmdRootValidate,
  validateRootConfinement,
} = createRootLifecycle({
  CliError,
  assertRootConfinedToWorktree,
  assertWindowsPrivateDirectoryAcl,
  assertWindowsRootAclProbeAvailable,
  fs,
  requireFlags,
  resolveAbsolute,
  resolveEffectivePlatform,
  windowsAclSnapshotsEqual,
  windowsPrivateDirectoryAcl,
});

// Forward-declared: each is a hoisted `function` in the pre-extraction facade,
// referenced by an EARLIER top-level composition call below via a thunk (never a
// bare property-shorthand, which would capture today's still-`undefined` value).
// Reassigned once its owning module composes later; every thunk resolves the
// CURRENT value at actual call time, long after module initialization completes.
let decodeIntentOrThrow, hasExactKeys, isCanonicalContext7LibraryId,
  parseApprovedContext7Directive, parsePreferredContext7Directive, resolveActivationForRequestPath;
// Authority state must exist before durable writers/readers are composed:
// writers receive the unforgeable poison marker and readers receive the
// authentic-token validator from this one facade-local state instance.
const transitionLockState = createTransitionLockState();
const {
  markPoisoned, isPoisoned, isValidLockTokenFor, assertLockedScopeIdentity,
} = transitionLockState;
const {
  assertArtifactMatchesReceipt, assertDurable,
  fsyncDir, fsyncDirCauseSuffix, isLockRmdirFaultActive,
  publishNoClobber, publishReplace, writeAllSync,
} = createDurableWriters({ markPoisoned });
const {
  acquireLock, releaseLock, withLock,
} = createTransitionLockLifecycle({
  state: transitionLockState,
  writers: { fsyncDir, fsyncDirCauseSuffix, isLockRmdirFaultActive },
  // Function declarations are hoisted; the lifecycle invokes these lazily,
  // after module initialization, and never imports the facade.
  windowsPrivateDirectoryAcl,
  assertWindowsPrivateDirectoryAcl,
});

// Durable publication, transition-lock state, deterministic rendezvous,
// confinement, and lifecycle operations are composed from focused modules
// under ./runtime-consultation/. The facade keeps the stable public ABI.
// Generic closed-shape schema validation (additionalProperties:false everywhere)
// ─────────────────────────────────────────────────────────────────────────────

const { createSchemaProtocol } = require('./runtime-consultation/protocol/schema.cjs');
const { createRequestProtocol } = require('./runtime-consultation/protocol/request.cjs');
const { createAuthorityProtocol } = require('./runtime-consultation/protocol/authority.cjs');
const { createPatternEvidenceProtocol } = require('./runtime-consultation/protocol/pattern-evidence.cjs');
const { createResultsProtocol } = require('./runtime-consultation/protocol/results.cjs');
const { createCanonicalRequestProtocol } = require('./runtime-consultation/protocol/canonical-request.cjs');
const { createCancelProtocol } = require('./runtime-consultation/protocol/cancel.cjs');
const { createTerminalRecordsProtocol } = require('./runtime-consultation/protocol/terminal-records.cjs');
const { createClaimLeaseTransaction } = require('./runtime-consultation/transaction/claim-lease.cjs');
const { createTakeoverTransaction } = require('./runtime-consultation/transaction/takeover.cjs');
const { createResultInventory } = require('./runtime-consultation/transaction/result-inventory.cjs');
const { createCancelAckTransaction } = require('./runtime-consultation/transaction/cancel-ack.cjs');
const { createAcceptCleanupTransaction } = require('./runtime-consultation/transaction/accept-cleanup.cjs');
const { createAwaitResultTransaction } = require('./runtime-consultation/transaction/await-result.cjs');
const { createBlobPublisher } = require('./runtime-consultation/content/blob-publish.cjs');
const { createCapabilityModule } = require('./runtime-consultation/host-bridge/capability.cjs');
const { createTurnsModule } = require('./runtime-consultation/host-bridge/turns.cjs');
const { createChildrenModule } = require('./runtime-consultation/host-bridge/children.cjs');
const { createRootIntentsModule } = require('./runtime-consultation/host-bridge/root-intents.cjs');
const { createRootEvidenceModule } = require('./runtime-consultation/host-bridge/root-evidence.cjs');
const { createRootStatusModule } = require('./runtime-consultation/host-bridge/root-status.cjs');
const { createRootOperationsModule } = require('./runtime-consultation/host-bridge/root-operations.cjs');
const { createInboxModule } = require('./runtime-consultation/host-bridge/inbox.cjs');

const schemaProtocol = createSchemaProtocol({ fs, CliError, HEX_ID_RE });
const {
  readArtifactBytes, parseJsonOrSchemaInvalid, assertClosedShape,
  isString, isNonEmptyString, isInteger, isNonNegativeInteger, isBoolean,
  orNull, isHex64, isHexId, isIsoTimestamp, isEnum, utf8ByteLength,
  isPlainObject, isContentRefHandle, assertResultContentXor,
} = schemaProtocol;
const {
  absentDurableStop, classifyDurableRead, pendingDurableStop,
  readClosedRecord, readClosedRecordOptional, readDurableBytes,
  readDurableBytesOptional, readDurableRecord, readJsonDurable,
  readJsonDurableOptional,
} = createDurableReaders({ isValidLockTokenFor, parseJsonOrSchemaInvalid, assertClosedShape });

const requestProtocol = createRequestProtocol({
  fs, path, CliError, sha256Buffer, isoToMs, blobPathFor,
  planRootFromArtifact, requestPathFor, readClosedRecord, readJsonDurable,
  assertClosedShape, isNonEmptyString, isNonNegativeInteger, orNull,
  isHex64, isHexId, isIsoTimestamp, isContentRefHandle, isEnum,
  utf8ByteLength,
});
const {
  resolveContentRefOrThrow, assertRolePolicy, MAX_DEPTH_LIMIT,
  CONSULT_V2_FIELDS, readCanonicalRequestRecord, validateConsultV2Fields,
  validateConsultV2, validateRequestGraph, INBOX_REF_V1_FIELDS,
  validateInboxRefV1,
} = requestProtocol;

let authorityProtocol;
const terminalRecordsProtocol = createTerminalRecordsProtocol({
  path, CliError, readJsonDurable,
  readRequestForTxnOrCorrelationInvalid: (...args) =>
    authorityProtocol.readRequestForTxnOrCorrelationInvalid(...args),
  assertClosedShape, isHexId, isIsoTimestamp, isNonEmptyString,
  isNonNegativeInteger, isPlainObject, isEnum, orNull,
});
const {
  CONFLICT_V1_FIELDS, validateConflictV1, TAKEOVER_V1_FIELDS,
  validateTakeoverBinding, validateTakeoverV1, HEX128_RE, STOP_V2_FIELDS,
  assertStopCorrelationTriple, validateStopV2, STOP_ACK_V1_FIELDS,
} = terminalRecordsProtocol;

authorityProtocol = createAuthorityProtocol({
  path, DRIVER_ENUM, planRootFromArtifact, transactionDir, takeoverPathFor,
  readJsonDurable, readJsonDurableOptional, readClosedRecord, withLock,
  assertLockedScopeIdentity, readCanonicalRequestRecord, validateTakeoverBinding,
  assertClosedShape, isHexId, isHex64, isNonEmptyString,
  isNonNegativeInteger, isIsoTimestamp, isEnum, orNull, isBoolean, CliError,
});
const {
  ACTIVATION_V1_FIELDS, validateActivationV1,
  readRequestForTxnOrCorrelationInvalid, readTakeoverIfValid,
  resolveAuthoritativeAttempt, CLAIM_V1_FIELDS, validateClaimV1,
  ACTIVE_LEASE_V1_FIELDS, validateActiveLeaseV1,
  ACTIVATION_INTENT_V1_FIELDS, validateActivationIntentV1,
  DELIVERY_V1_FIELDS, validateDeliveryV1,
} = authorityProtocol;

const patternEvidenceProtocol = createPatternEvidenceProtocol({
  CliError, path, sha256Buffer, isoToMs, patternEvidencePathFor, readClosedRecord,
  isCanonicalContext7LibraryId: (...args) => isCanonicalContext7LibraryId(...args), hasExactKeys: (...args) => hasExactKeys(...args),
  classifyDurableRead, DURABLE_PENDING, DURABLE_PRESENT, assertClosedShape,
  isHexId, isHex64, isNonEmptyString, isNonNegativeInteger, isIsoTimestamp, orNull,
  isContentRefHandle, isPlainObject, resolveAuthoritativeAttempt,
  resolveContentRefOrThrow,
});
const {
  PATTERN_EVIDENCE_DEPENDENCY_KEYS, PATTERN_EVIDENCE_V1_FIELDS,
  isPatternEvidenceDependencyShape, evidenceRelativeRefFor,
  readAndValidatePatternEvidenceRecord, validatePatternEvidenceForResult,
} = patternEvidenceProtocol;

// Results validate root-derived evidence, so this concern is composed before
// the results protocol. Its lifecycle lookup and root-intent correlation stay
// lazy, avoiding a facade import or an initialization cycle.
const { resolveRootEvidenceAuthority } = createRootEvidenceModule({
  CliError, planRootPath, requestPathFor, readCanonicalRequestRecord,
  parseApprovedContext7Directive: (...args) => parseApprovedContext7Directive(...args), parsePreferredContext7Directive: (...args) => parsePreferredContext7Directive(...args),
  findCorrelatedRootConsultIntent: (...args) => findCorrelatedRootConsultIntent(...args),
  getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
});

const resultsProtocol = createResultsProtocol({
  path, CliError, readDurableRecord, readJsonDurable, readClosedRecord,
  requestPathFor, resultPathFor, acceptedResultPathFor, ackPathFor,
  planRootFromArtifact, readCanonicalRequestRecord, resolveContentRefOrThrow,
  resolveAuthoritativeAttempt, validatePatternEvidenceForResult,
  resolveRootEvidenceAuthority, hasExactKeys: (...args) => hasExactKeys(...args), assertClosedShape,
  assertResultContentXor, isHexId, isHex64, isNonEmptyString,
  isNonNegativeInteger, isIsoTimestamp, isEnum, orNull,
  isPatternEvidenceDependencyShape,
});
const {
  RESULT_V2_FIELDS, RESULT_MIRRORED_REQUEST_FIELDS,
  assertResultMirrorsRequest, validateResultV2, ACCEPTED_RESULT_V1_FIELDS,
  validateAcceptedResultV1, assertAcceptedResultCorrelates, ACK_V1_FIELDS,
  validateAckV1, CONSULTATION_DEPENDENCY_KEYS,
  validateConsultationDependencySet,
} = resultsProtocol;

const canonicalRequestProtocol = createCanonicalRequestProtocol({
  fs, path, CliError, realpathDeepestExisting, assertCanonicalFilename,
  assertGenuinelyConfinedUnderRoot, planRootFromArtifact, realpathOrSelf,
  resultPathFor, classifyDurableRead, DURABLE_ABSENT, DURABLE_PENDING,
  readCanonicalRequestRecord, validateConsultV2Fields,
  resolveAuthoritativeAttempt, validateResultV2, validateRootConfinement,
});
const {
  assertExactCanonicalGeometry, accreditCanonicalRequest,
  assertRequestIdentityMatches, classifyCanonicalResultForRequest,
} = canonicalRequestProtocol;

const cancelProtocol = createCancelProtocol({
  path, CliError, currentClockMs, isoToMs, sha256Buffer,
  classifyDurableRead, readJsonDurableOptional, DURABLE_ABSENT,
  DURABLE_PENDING, DURABLE_PRESENT, absentDurableStop, pendingDurableStop,
  assertClosedShape, assertCanonicalFilename, assertGenuinelyConfinedUnderRoot,
  accreditCanonicalRequest, isHexId, isIsoTimestamp, isNonEmptyString, isEnum,
});
const {
  CANCEL_V1_FIELDS, accreditCancelRecord, readCanonicalCancelRecordOptional,
  readCanonicalCancelRecordRequired, classifyCanonicalCancelRecord,
  validateCancelV1,
} = cancelProtocol;
const { createScalarPrimitivesConformance } = require('./runtime-consultation/conformance/scalar-primitives.cjs');
const {
  CANONICAL_DECIMAL_U64_RE,
  COORDINATION_MODE_ENUM,
  C_RECORD_MAX_BYTES,
  ISO_UTC_RE,
  MAX_DECIMAL_U64,
  PROVIDER_MANAGER_KIND_ENUM,
  PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM,
  PROVIDER_SESSION_V3_BASENAME,
  R33_CONTROL_PROTOCOL,
  R33_HANDLE_PROTOCOL,
  R33_PROTOCOL_PROFILE,
  R33_PROVIDER_ABI,
  ROOT_PROFILE_V3_BASENAME,
  ROOT_PROFILE_V3_FIELDS,
  RUNTIME_PROFILE_BINDING_V2_FIELDS,
  TEMPORAL_AUTHORITY_ENVELOPE_V1_FIELDS,
  TRANSITION_LOCK_PROVIDER_NAME,
  assertTemporalAuthorityEnvelopeV1,
  isId128,
  isIsoUtc,
  isLiteralField,
  isMonoNs,
  isPid,
  lit,
} = createScalarPrimitivesConformance({
  CliError,
  HEX128_RE,
  assertClosedShape,
  isEnum,
  isHex64,
  isHexId,
});

const { createRootProviderTupleConformance } = require('./runtime-consultation/conformance/root-provider-tuple.cjs');
const {
  PROVIDER_SESSION_V3_FIELDS,
  assertBindingCarrierBytes,
  assertCanonicalDiskRecordBytes,
  assertCoordinationRootSnapshotUnchanged,
  assertDirectlyAtCoordinationRoot,
  assertNotInsideCoordinationRoot,
  checkProviderSessionV3Conformance,
  checkRootProfileV3Conformance,
  checkRuntimeProfileBindingV2Conformance,
  snapshotCoordinationRootIdentity,
} = createRootProviderTupleConformance({
  CliError,
  assertCanonicalFilename,
  assertClosedShape,
  assertGenuinelyConfinedUnderRoot,
  canonicalJSONStringify,
  fs,
  isHex64,
  isHexId,
  isPlainObject,
  path,
  readClosedRecord,
  readDurableRecord,
  realpathDeepestExisting,
  validateRootConfinement,
  COORDINATION_MODE_ENUM,
  C_RECORD_MAX_BYTES,
  PROVIDER_MANAGER_KIND_ENUM,
  PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM,
  PROVIDER_SESSION_V3_BASENAME,
  R33_CONTROL_PROTOCOL,
  R33_PROVIDER_ABI,
  ROOT_PROFILE_V3_BASENAME,
  ROOT_PROFILE_V3_FIELDS,
  RUNTIME_PROFILE_BINDING_V2_FIELDS,
  TRANSITION_LOCK_PROVIDER_NAME,
  assertTemporalAuthorityEnvelopeV1,
  isEnum,
  isId128,
  isIsoUtc,
  isPid,
  lit,
});

const { createR33TupleDigestConformance } = require('./runtime-consultation/conformance/r33-tuple-digest.cjs');
const {
  R33_TUPLE_CORRELATION_KEYS,
  checkR33ProfileTupleConformance,
  domainSeparatedRecordDigest,
  providerSessionDigestV3,
  rootProfileDigestV3,
  temporalEnvelopeDigestV1,
} = createR33TupleDigestConformance({
  CliError,
  canonicalJSONStringify,
  path,
  sha256Buffer,
  PROVIDER_SESSION_V3_BASENAME,
  ROOT_PROFILE_V3_BASENAME,
  isLiteralField,
  PROVIDER_SESSION_V3_FIELDS,
  ROOT_PROFILE_V3_FIELDS,
  assertCoordinationRootSnapshotUnchanged,
  checkProviderSessionV3Conformance,
  checkRootProfileV3Conformance,
  checkRuntimeProfileBindingV2Conformance,
  snapshotCoordinationRootIdentity,
});
//
// CONSTRAINT FOR WHOEVER IMPLEMENTS THE PROVIDER-OWNED AUTHORITY COMPOSITION:
// put it OUTSIDE the markers above. The region they delimit is asserted to
// contain no filesystem-mutating primitive, and the bootstrap sequence's step 18
// -- `BootstrapReceipt` plus live capabilities transitioning the session to
// ACTIVE, the first authority-success point -- necessarily WRITES. Placing that
// code inside the markers would break the absence audit, and the tempting repair
// would be to weaken the audit rather than move the code. That is the same
// failure family as a marker duplicated into its own describing comment: a guard
// that cannot fail still reads as coverage. Move the code, never the assertion.

// ─────────────────────────────────────────────────────────────────────────────
// Command dispatch registry -- populated incrementally as each cmd* is defined
// ─────────────────────────────────────────────────────────────────────────────

const COMMANDS = {};

const { createValidateCommand } = require('./runtime-consultation/commands/validate.cjs');
const {
  cmdValidate,
  VALIDATE_KIND_DISPATCH,
} = createValidateCommand({
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
});
COMMANDS.validate = cmdValidate;

COMMANDS['root-init'] = cmdRootInit;
COMMANDS['root-validate'] = cmdRootValidate;

const { createLocalRegistry } = require('./runtime-consultation/local-registry.cjs');
const {
  CLAUDE_ONE_SHOT_BINDING_SCHEMA,
  CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
  GRANT_CANONICAL_ROLES,
  GRANT_IDENTITY_PROVIDER_ENUM,
  HEX_CSPRNG_32_RE,
  LOCAL_TEST_PRIVATE_REGISTRY_BASE_SYMBOL,
  REQUESTER_BINDING_KEYS,
  REQUESTER_BINDING_SCHEMA,
  ROLE_COMMAND_GRANT_KEYS,
  ROLE_COMMAND_GRANT_SCHEMA,
  ROLE_COMMAND_GRANT_TTL_SECONDS,
  ROOT_SOURCE_BINDING_SCHEMA_LOCAL,
  ROOT_SOURCE_BINDING_SCHEMA_V2,
  ROOT_SOURCE_POST_INGRESS_COMMANDS,
  ROOT_SOURCE_PRE_INGRESS_COMMANDS,
  isCanonicalIsoUtcLocal,
  isRootSourceGrantContext,
  localComputePrincipalId,
  localEnsureSecureRegistryDir,
  localRegistryBaseDir,
  localRegistryRepoDir,
  localWindowsCommonApplicationDataRoot,
  readLocalRegistryRecord,
  roleCommandGrantConsumedMarkerPathFor,
  roleCommandGrantPathFor,
} = createLocalRegistry({
  BigInt,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  classifyDurableRead,
  execFileSync,
  fs,
  os,
  path,
  realpathOrSelf,
  resolvedWindowsPowerShellPath,
  sha256String,
  windowsPrivateDirectoryAcl,
});

const { createRoleCommandGrant } = require('./runtime-consultation/role-command-grant.cjs');
const {
  consumeValidatedRoleCommandGrantOrThrow,
  validateRoleCommandGrantOrThrow,
} = createRoleCommandGrant({
  CliError,
  GRANT_CANONICAL_ROLES,
  HEX_CSPRNG_32_RE,
  ROLE_COMMAND_GRANT_KEYS,
  ROLE_COMMAND_GRANT_SCHEMA,
  ROLE_COMMAND_GRANT_TTL_SECONDS,
  canonicalJSONStringify,
  currentClockMs,
  getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
  hasExactKeys: (...args) => hasExactKeys(...args),
  isCanonicalIsoUtcLocal,
  isHex64,
  isHexId,
  localEnsureSecureRegistryDir,
  nowIso,
  path,
  publishNoClobber,
  readLocalRegistryRecord,
  roleCommandGrantConsumedMarkerPathFor,
  roleCommandGrantPathFor,
});

const { createRootSourceGrantBoundary } = require('./runtime-consultation/root-source-grant-boundary.cjs');
const {
  REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS,
  REQUESTER_GRANT_TRANSACTIONAL_SUBCOMMANDS,
  enforceRootSourceGrantBoundary,
  readRootSourceIngressOrThrow,
  resolveRequesterGrantScope,
  validateAndConsumeRoleCommandGrantForCommand,
} = createRootSourceGrantBoundary({
  CliError,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND,
  ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY,
  ROOT_SOURCE_BINDING_SCHEMA_LOCAL,
  ROOT_SOURCE_BINDING_SCHEMA_V2,
  ROOT_SOURCE_POST_INGRESS_COMMANDS,
  ROOT_SOURCE_PRE_INGRESS_COMMANDS,
  accreditCanonicalRequest,
  ackPathFor,
  cancelPathFor,
  canonicalJSONStringify,
  classifyDurableRead,
  computeRepoId,
  computeWorktreeId,
  consumeValidatedRoleCommandGrantOrThrow,
  decodeIntentOrThrow: (...args) => decodeIntentOrThrow(...args),
  getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
  gitRevParse,
  path,
  readCanonicalCancelRecordOptional,
  realpathDeepestExisting,
  realpathOrSelf,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  sha256File,
  sha256String,
  testM7Rendezvous,
  validateRoleCommandGrantOrThrow,
});

// HostBridge bindings are initialized once near the public export surface.
// Function bodies above may refer to them, but no bridge operation can run
// until CommonJS module initialization has completed.
let HOST_BRIDGE_ID_RE;
let hostBridgeCommittedTurnIds;
let createHostBridgeCapability;
let requireHostBridgeCapabilityWithLiveWorker;
let requireHostBridgeCapability;
let requireHostBridgeRequestScope;
let hostBridgeListRootConsultIntents;
let readLifecycleRecordRequired;
let findCorrelatedRootConsultIntent;
let hostBridgeClaim;
let hostBridgeLeaseHeartbeat;
let hostBridgeScheduleTurn;
let hostBridgeRecordTurnStartAccepted;
let hostBridgePublishPatternEvidence;
let hostBridgePublishTerminalResult;
let hostBridgeAllowedChildRoles;
let hostBridgePublishChildRequest;
let hostBridgeObserveChildResult;
let rootConsultIntentContext;
let requestInputForRootIntent;
let assertBuiltRootRequestMatchesIntent;
let rootConsultOperationResult;
let canonicalRequestPathForRootIntent;
let readRootConsultTerminalStatus;
let readRootSourceTerminalArtifacts;
let readExistingRootConsultCompletion;
let hostBridgeAdvanceRootConsult;
let hostBridgeObserveAndCompleteRootConsult;
let hostBridgeListInbox;

function printResultAndExit(command, statusName, detailCode, extra) {
  const rc = RC_FOR_STATUS[statusName] !== undefined ? RC_FOR_STATUS[statusName] : RC_FOR_STATUS.INTERNAL;
  const e = extra || {};
  const result = {
    schema: CLI_RESULT_SCHEMA,
    command: command || null,
    ok: statusName === 'SUCCESS',
    status: statusName,
    code: rc,
    request_id: e.request_id || null,
    artifact_ref: e.artifact_ref || null,
    detail_code: detailCode || 'NONE',
    content_ref: e.content_ref || null,
    activation_action: e.activation_action || null,
  };
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(rc);
}

// Portable argv cap (Frozen CLI ABI, PLAN.md ~L754): the complete post-hook argv
// is at most 131072 UTF-8 bytes on POSIX, or 28672 UTF-16 code units on Windows,
// checked before decode/allocation -- i.e. before even a per-flag path-token
// check, independent of subcommand.
const MAX_TOTAL_ARGV_BYTES = 131072;
const MAX_TOTAL_ARGV_UTF16_UNITS_WINDOWS = 28672;

/**
 * Effective platform for the total-argv-cap branch (Gap#1, PLAN.md ~L754).
 * `RUNTIME_CONSULTATION_FORCE_PLATFORM` is honored ONLY when the harness test
 * capability is active (`isTestCapability()`: NODE_ENV=test +
 * RUNTIME_CONSULTATION_TEST_CAPABILITY) -- mirrors resolveFixedClockState's own
 * isTestCapability()-gated env-var override. Production (no capability) always
 * observes the real `process.platform`; the override can NEVER be honored
 * outside the test capability, by construction.
 */
function resolveEffectivePlatform() {
  if (isTestCapability()) {
    const overrideEnv = process.env.RUNTIME_CONSULTATION_FORCE_PLATFORM;
    if (typeof overrideEnv === 'string' && overrideEnv.length > 0) return overrideEnv;
  }
  return process.platform;
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  try {
    const isWindowsArgvCap = resolveEffectivePlatform() === 'win32';
    if (isWindowsArgvCap) {
      const totalArgvUtf16Units = argv.reduce((sum, tok) => sum + String(tok).length, 0);
      if (totalArgvUtf16Units > MAX_TOTAL_ARGV_UTF16_UNITS_WINDOWS) {
        throw new CliError('INVALID', 'INVALID_ARGUMENT', 'post-hook argv exceeds the 28672-UTF-16-unit total budget');
      }
    } else {
      const totalArgvBytes = argv.reduce((sum, tok) => sum + Buffer.byteLength(String(tok), 'utf8'), 0);
      if (totalArgvBytes > MAX_TOTAL_ARGV_BYTES) {
        throw new CliError('INVALID', 'INVALID_ARGUMENT', 'post-hook argv exceeds the 131072-byte total budget');
      }
    }
    if (!command) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing subcommand');
    }
    const handler = COMMANDS[command];
    if (!handler) {
      throw new CliError('USAGE_ERROR', 'UNKNOWN_COMMAND', 'unknown subcommand: ' + command);
    }
    const flags = parseFlags(argv.slice(1), command);
    // Fixed-ids/fixed-clock test-mode activation (WP2 fake-clock/fixed-ids
    // seam): resolved ONCE per process, immediately after parseFlags succeeds
    // and before any handler runs. parseFlags already throws before this
    // point if fixed-ids/fixed-clock is set without the test capability
    // (see the '--fixed-ids/--fixed-clock require the test capability' check
    // above) -- the isTestCapability() re-check here is defensive-but-
    // harmless, not load-bearing.
    activateFixedIds(flags);
    resolveFixedClockState(flags);
    // M7/WP4 (PLAN.md ~L604): role-command-grant/v1 consume+validate,
    // strictly BEFORE handler(flags) performs any read or mutation.
    const grantContext = validateAndConsumeRoleCommandGrantForCommand(command, flags, argv.slice(1));
    // M7/WP4 group A correction: grantContext (undefined for any command
    // outside ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND) is now threaded to
    // the handler -- every other handler in COMMANDS keeps its existing
    // single-arg (flags) signature and simply ignores the extra argument
    // (JS silently drops an unused parameter), so this is a safe, additive
    // change for every command except cmdPublishRequest, which now consumes
    // it to derive an authenticated source_role.
    // Sixteenth §16b: a root-source-backed publish-request is serialized
    // under rootSourceLockDirFor(bindingId) -- revalidated fresh inside the
    // lock, recovered from a bounded actor-scoped scan instead of re-minting
    // when a prior attempt (this call, or a crashed one) already published,
    // and bound to exactly one durable root transaction via publishRootIngress
    // before the command is considered SUCCESS. Every other command/binding
    // keeps its existing unconditional single call, unchanged.
    const extra = (command === 'publish-request' && isRootSourceGrantContext(grantContext))
      ? serializeRootSourcePublishRequest(grantContext, flags, handler)
      : (handler(flags, grantContext) || {});
    // M7 section 4/8.5: the retirement-wiring this block used to perform
    // after transaction-ack/cancel/publish-result/cancel (root-source and
    // one-shot alike) is REMOVED -- no new retirement artifact is ever
    // written. root-source's own terminal is cut by canonical ack.json/
    // cancel.json directly (root-source-status's own section 9 rewrite
    // reads them, never a retirement marker); one-shot publish-result's
    // terminal is cut by its own no-clobber write to accepted-result.json
    // (already enforced at that write site, independent of this block);
    // cancellation of a one-shot target is cut by canonical cancel.json.
    printResultAndExit(command, 'SUCCESS', 'NONE', extra);
  } catch (err) {
    if (err instanceof CliError) {
      printResultAndExit(command, err.status, err.detailCode, err.extra);
    } else {
      process.stderr.write('runtime-consultation internal error: ' + (err && err.stack ? err.stack : String(err)) + '\n');
      printResultAndExit(command, 'INTERNAL', 'INTERNAL_ERROR', {});
    }
  }
}

const { createRoutingPolicy } = require('./runtime-consultation/routing-policy.cjs');
const {
  ROUTING_POLICY_CONTENT,
  ROUTING_POLICY_DIGEST,
  ROUTING_POLICY_TABLE,
  ROUTING_POLICY_VERSION,
  TARGET_ROLE_PROFILE_VERSION,
  loadRoutingPolicyContent,
  routingOverrideInvalid,
  targetRoleProfileDigestFor,
} = createRoutingPolicy({
  CliError,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  classifyDurableRead,
  facadeDirname,
  fs,
  isTestCapability,
  os,
  path,
  sha256Buffer,
  sha256String,
});

const { createCanonicalRequestBuild } = require('./runtime-consultation/canonical-request-build.cjs');
const canonicalRequestBuildModule = createCanonicalRequestBuild({
  CONSULT_V2_FIELDS,
  CliError,
  MAX_DEPTH_LIMIT,
  ROUTING_POLICY_CONTENT,
  ROUTING_POLICY_DIGEST,
  ROUTING_POLICY_VERSION,
  TARGET_ROLE_PROFILE_VERSION,
  assertClosedShape,
  assertRolePolicy,
  canonicalJSONStringify,
  computeCoordRootId,
  computeRepoId,
  computeSubjectHead,
  computeWorktreeId,
  decodeBase64Url,
  fs,
  hostBridgeAllowedChildRoles: (...args) => hostBridgeAllowedChildRoles(...args),
  isContentRefHandle,
  isHex64,
  isHexId,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegativeInteger,
  parseJsonOrSchemaInvalid,
  path,
  planRootPath,
  publishNoClobber,
  readArtifactBytes,
  requestPathFor,
  requireHostBridgeCapability: (...args) => requireHostBridgeCapability(...args),
  resolveAbsolute,
  resolveContentRefOrThrow,
  sha256Buffer,
  sha256File,
  sha256String,
  targetRoleProfileDigestFor,
  utf8ByteLength,
  validateConsultV2,
});
decodeIntentOrThrow = canonicalRequestBuildModule.decodeIntentOrThrow;
const {
  INTENT_FIELDS,
  SUBJECT_BUNDLE_ENTRY_FIELDS,
  SUBJECT_BUNDLE_MANIFEST_V1_FIELDS,
  buildCanonicalRequest,
  buildCanonicalRequestFromFields,
  decodeSubjectBundleManifestOrThrow,
  deriveCanonicalRequestFields,
  isSafeRelativeEntryPath,
  materializePlanRef,
  materializeRoutingPolicy,
  materializeSubjectBundle,
} = canonicalRequestBuildModule;

const { createPublishRequestCommand } = require('./runtime-consultation/commands/publish-request.cjs');
const {
  cmdPublishRequest,
  publishPreallocatedRequest,
} = createPublishRequestCommand({
  CliError,
  assertArtifactMatchesReceipt,
  assertRolePolicy,
  buildCanonicalRequest,
  buildCanonicalRequestFromFields,
  canonicalJSONStringify,
  computeCoordRootId,
  computeRepoId,
  computeSubjectHead,
  computeWorktreeId,
  decodeIntentOrThrow,
  decodeSubjectBundleManifestOrThrow,
  fs,
  genId,
  materializePlanRef,
  materializeRoutingPolicy,
  materializeSubjectBundle,
  nowIso,
  path,
  planRootPath,
  publishNoClobber,
  requestPathFor,
  requireFlags,
  resolveAbsolute,
  resolveContentRefOrThrow,
  sha256File,
  sha256String,
  validateConsultV2,
});
COMMANDS['publish-request'] = cmdPublishRequest;

const { createRootSourcePublish } = require('./runtime-consultation/root-source-publish.cjs');
const {
  findRootSourceActorRequest,
  serializeRootSourcePublishRequest,
} = createRootSourcePublish({
  CliError,
  computeRepoId,
  fs,
  getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
  isHexId,
  path,
  planRootPath,
  readCanonicalRequestRecord,
  requestPathFor,
  resolveAbsolute,
  sha256File,
});

// Transaction commands are composed in the original registration order. Each
// factory closes over this facade load's own Sets, clocks and poison authority.
const { minIso, cmdClaim, cmdLeaseHeartbeat } = createClaimLeaseTransaction({
  ACCEPTED_RESULT_V1_FIELDS, ACTIVE_LEASE_V1_FIELDS, CLAIM_V1_FIELDS, CliError, DURABLE_ABSENT, DURABLE_PENDING, acceptedResultPathFor, accreditCanonicalRequest, activeLeasePathFor,
  assertAcceptedResultCorrelates, assertArtifactMatchesReceipt, assertClosedShape, assertLockedScopeIdentity, assertRequestIdentityMatches, cancelPathFor, canonicalJSONStringify, claimPathFor,
  classifyDurableRead, computeWorktreeId, isHexId, isPoisoned, isoPlusSeconds, isoToMs, markPoisoned, nowIso, path, publishNoClobber, publishReplace, readCanonicalCancelRecordOptional,
  readClosedRecord, readClosedRecordOptional, readJsonDurableOptional, readRequestForTxnOrCorrelationInvalid, requireFlags, resolveAbsolute,
  resolveActivationForRequestPath: (...args) => resolveActivationForRequestPath(...args), resolveAuthoritativeAttempt, resultPathFor, testM7Rendezvous, testRendezvous, validateResultV2, withLock,
});
COMMANDS.claim = cmdClaim;
COMMANDS['lease-heartbeat'] = cmdLeaseHeartbeat;

const { ACTIVATION_LIVENESS_WINDOW_S, REQUEST_EXPIRY_MARGIN_S, CLAIM_NO_LEASE_WINDOW_S, activationLivenessDeadline, cmdTakeover } = createTakeoverTransaction({
  ACTIVE_LEASE_V1_FIELDS, CLAIM_V1_FIELDS, CliError, DELIVERY_V1_FIELDS, RESULT_V2_FIELDS, accreditCanonicalRequest, activeLeasePathFor, assertArtifactMatchesReceipt, assertClosedShape,
  assertLockedScopeIdentity, assertRequestIdentityMatches, canonicalJSONStringify, claimPathFor, deliveryPathFor, genId, isPoisoned, isoPlusSeconds, isoToMs, markPoisoned, minIso, nowIso, path,
  publishNoClobber, readClosedRecordOptional, readJsonDurableOptional, requireFlags, resolveAbsolute, resultPathFor, takeoverPathFor, testRendezvous, withLock,
});
COMMANDS.takeover = cmdTakeover;

const { CANCEL_REASON_ENUM, listResultFiles, writeConflictDiagnosticIfApplicable } = createResultInventory({
  CONFLICT_V1_FIELDS, CliError, MAX_ENUM_HARD_CAP, MAX_ENUM_KEPT_ENTRIES, assertArtifactMatchesReceipt, assertClosedShape, canonicalJSONStringify, fs, insertBoundedCandidate, isHexId, nowIso, path, publishNoClobber, validateConflictV1,
});

const { findResultWithStatus, cmdCancel, cmdTransactionAck } = createCancelAckTransaction({
  ACCEPTED_RESULT_V1_FIELDS, ACK_V1_FIELDS, CANCEL_REASON_ENUM, CliError, DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT, RESULT_V2_FIELDS, acceptedResultPathFor, accreditCanonicalRequest,
  ackPathFor, assertAcceptedResultCorrelates, assertArtifactMatchesReceipt, assertClosedShape, assertLockedScopeIdentity, assertRequestIdentityMatches, cancelPathFor, canonicalJSONStringify,
  classifyDurableRead, isPoisoned, isoToMs, listResultFiles, markPoisoned, nowIso, path, publishNoClobber, readCanonicalCancelRecordOptional, readJsonDurableOptional,
  readRequestForTxnOrCorrelationInvalid, requireFlags, resolveAbsolute, resolveAuthoritativeAttempt, resultPathFor, testRendezvous, withLock, writeConflictDiagnosticIfApplicable,
});
COMMANDS.cancel = cmdCancel;
COMMANDS['transaction-ack'] = cmdTransactionAck;

const { cmdAcceptResult, cmdCleanup } = createAcceptCleanupTransaction({
  ACCEPTED_RESULT_V1_FIELDS, CliError, acceptedResultPathFor, accreditCanonicalRequest, assertAcceptedResultCorrelates, assertArtifactMatchesReceipt, assertClosedShape, assertLockedScopeIdentity,
  assertRequestIdentityMatches, cancelPathFor, canonicalJSONStringify, computeSubjectHead, isPoisoned, listResultFiles, markPoisoned, nowIso, path, publishNoClobber, readCanonicalCancelRecordOptional,
  readCanonicalRequestRecord, readJsonDurableOptional, reconcileTempArtifacts, requireFlags, resolveAbsolute, testRendezvous, validateResultV2, withLock,
});
COMMANDS['accept-result'] = cmdAcceptResult;
COMMANDS.cleanup = cmdCleanup;

const { cmdAwaitResult } = createAwaitResultTransaction({
  ACCEPTED_RESULT_V1_FIELDS, CLAIM_NO_LEASE_WINDOW_S, CliError, DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT, REQUEST_EXPIRY_MARGIN_S, acceptedResultPathFor, accreditCanonicalRequest,
  activationLivenessDeadline, activationPathFor, activeLeasePathFor, assertAcceptedResultCorrelates, assertClosedShape, assertRequestIdentityMatches, cancelPathFor, claimPathFor,
  classifyCanonicalCancelRecord, classifyDurableRead, currentClockMs, getFixedClockBaseMs, isFixedClockActive, isoPlusSeconds, isoToMs, minIso, path, requireFlags, resolveAbsolute,
  resolveAuthoritativeAttempt, resultPathFor, sleepSync, testRendezvous, validateActivationV1, validateActiveLeaseV1, validateClaimV1, validateResultV2,
});
COMMANDS['await-result'] = cmdAwaitResult;

const { cmdPublishBlob } = createBlobPublisher({
  CliError, blobPathFor, computeRepoId, decodeSubjectBundleManifestOrThrow, fs, gitRevParse, isSafeRelativeEntryPath, path, planRootPath, publishNoClobber, realpathOrSelf, requireFlags, resolveAbsolute, sha256Buffer, sha256File,
});
COMMANDS['publish-blob'] = cmdPublishBlob;


const { createDispatchDriverSelection } = require('./runtime-consultation/dispatch/dispatch-driver-selection.cjs');
const {
  ROOT_SOURCE_DISPATCH_DRIVERS,
  claudeAgentCapabilityProjectRoot,
  selectDispatchDriver,
} = createDispatchDriverSelection({
  CliError,
  facadeDirname,
  getRuntimeBridgeCodex: () => require('./runtime-bridge-codex.cjs'),
  getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
  gitRevParse,
  path,
  sha256String,
});

const { createDispatchCanonical } = require('./runtime-consultation/dispatch/dispatch-canonical.cjs');
const {
  REQUESTER_OWNED_DISPATCH_DRIVERS,
  cmdDispatch,
  dispatchCanonical,
} = createDispatchCanonical({
  ACTIVATION_V1_FIELDS,
  CliError,
  DELIVERY_V1_FIELDS,
  DRIVER_ENUM,
  DURABLE_PENDING,
  DURABLE_PRESENT,
  INBOX_REF_V1_FIELDS,
  ROOT_SOURCE_DISPATCH_DRIVERS,
  activationIntentPathFor,
  activationLivenessDeadline,
  activationPathFor,
  assertClosedShape,
  canonicalJSONStringify,
  classifyDurableRead,
  crypto,
  deliveryPathFor,
  inboxPathFor,
  isRootSourceGrantContext,
  nowIso,
  path,
  planRootFromArtifact,
  publishNoClobber,
  readCanonicalRequestRecord,
  readDurableBytesOptional,
  requireFlags,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  selectDispatchDriver,
  sha256Buffer,
});
COMMANDS.dispatch = cmdDispatch;

const { createActivationResolutionCommands } = require('./runtime-consultation/commands/activation-resolution.cjs');
const activationResolutionModule = createActivationResolutionCommands({
  ACTIVATION_V1_FIELDS,
  DURABLE_PENDING,
  DURABLE_PRESENT,
  activationLivenessDeadline,
  activationPathFor,
  assertClosedShape,
  classifyDurableRead,
  currentClockMs,
  fs,
  getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
  isHexId,
  isoToMs,
  path,
  planRootPath,
  readCanonicalRequestRecord,
  resolveAuthoritativeAttempt,
});
resolveActivationForRequestPath = activationResolutionModule.resolveActivationForRequestPath;
const {
  findLiveClaudeAgentActivations,
} = activationResolutionModule;

const { createDeliveryWorkerStopCommands } = require('./runtime-consultation/commands/delivery-worker-stop.cjs');
const {
  COMMIT_POINT_ENUM,
  DRIVER_CROSSED_COMMIT_POINT,
  RECORD_DELIVERY_OUTCOME_ENUM,
  REQUESTER_OWNED_DRIVERS,
  STOP_ACK_DISPOSITION_ENUM,
  cmdRecordDelivery,
  cmdWorkerStop,
  cmdWorkerStopAck,
} = createDeliveryWorkerStopCommands({
  CliError,
  DELIVERY_V1_FIELDS,
  DRIVER_ENUM,
  STOP_ACK_V1_FIELDS,
  STOP_V2_FIELDS,
  assertClosedShape,
  assertHexId,
  assertSafeSegment,
  assertStopCorrelationTriple,
  canonicalJSONStringify,
  deliveryPathFor,
  genId128,
  isoPlusSeconds,
  nowIso,
  path,
  planRootFromArtifact,
  publishNoClobber,
  readRequestForTxnOrCorrelationInvalid,
  requireFlags,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  stopAckPathFor,
  stopPathFor,
  validateStopV2,
});
COMMANDS['record-delivery'] = cmdRecordDelivery;
COMMANDS['worker-stop'] = cmdWorkerStop;
COMMANDS['worker-stop-ack'] = cmdWorkerStopAck;

const { createPublishResultCommand } = require('./runtime-consultation/commands/publish-result.cjs');
const {
  BLOCKED_REASON_ENUM,
  NATIVE_CONTENT_MAX_B64URL_CHARS,
  NATIVE_CONTENT_MAX_DECODED_BYTES,
  cmdPublishResult,
} = createPublishResultCommand({
  ACCEPTED_RESULT_V1_FIELDS,
  CLAIM_V1_FIELDS,
  CliError,
  RESULT_V2_FIELDS,
  acceptedResultPathFor,
  assertAcceptedResultCorrelates,
  assertArtifactMatchesReceipt,
  assertClosedShape,
  assertLockedScopeIdentity,
  assertResultContentXor,
  cancelPathFor,
  canonicalJSONStringify,
  claimPathFor,
  computeSubjectHead,
  computeWorktreeId,
  decodeBase64Url,
  isPoisoned,
  markPoisoned,
  nowIso,
  path,
  planRootFromArtifact,
  publishNoClobber,
  readCanonicalCancelRecordOptional,
  readCanonicalRequestRecord,
  readClosedRecord,
  readJsonDurableOptional,
  requireFlags,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  resultPathFor,
  testRendezvous,
  validatePatternEvidenceForResult,
  withLock,
});
COMMANDS['publish-result'] = cmdPublishResult;

const { createContext7PatternGap } = require('./runtime-consultation/turn-envelope/context7-pattern-gap.cjs');
const context7PatternGapModule = createContext7PatternGap({
  CliError,
});
hasExactKeys = context7PatternGapModule.hasExactKeys;
isCanonicalContext7LibraryId = context7PatternGapModule.isCanonicalContext7LibraryId;
parseApprovedContext7Directive = context7PatternGapModule.parseApprovedContext7Directive;
parsePreferredContext7Directive = context7PatternGapModule.parsePreferredContext7Directive;
const {
  APPROVED_CONTEXT7_DIRECTIVE_LINE_RE,
  APPROVED_CONTEXT7_DIRECTIVE_MARKER,
  CONTEXT7_LIBRARY_ID_RE,
  PREFERRED_CONTEXT7_DIRECTIVE_LINE_RE,
  PREFERRED_CONTEXT7_DIRECTIVE_MARKER,
  RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS,
  RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES,
  RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES,
  RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES,
  RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN,
  TURN_KIND_LOCK_ENUM,
  expectedTurnEnvelopeBranchCount,
  patternGapExecutionAllowed,
  requiredConsultQuestionFor,
  requiredGapLibraryIdFor,
  requiredTurnKind,
  validatePatternGap,
} = context7PatternGapModule;

const { createRuntimeTurnEnvelopeSchema } = require('./runtime-consultation/turn-envelope/runtime-turn-envelope-schema.cjs');
const {
  codexStructuredRuntimeTurnEnvelopeSchema,
  runtimeTurnEnvelopeSchema,
  unwrapAndValidateCodexStructuredRuntimeTurnEnvelope,
  validateRuntimeTurnEnvelope,
} = createRuntimeTurnEnvelopeSchema({
  RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS,
  RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES,
  RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES,
  RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES,
  RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN,
  expectedTurnEnvelopeBranchCount,
  hasExactKeys,
  patternGapExecutionAllowed,
  requiredConsultQuestionFor,
  requiredGapLibraryIdFor,
  requiredTurnKind,
  validatePatternGap,
});

// Compose only after all protocol, routing and envelope constants exist.
{
  const hostBridgeCapabilityModule = createCapabilityModule({
    path, CliError, GRANT_CANONICAL_ROLES, hasExactKeys, isHex64, isIsoTimestamp, isoToMs,
    resolveSealedGitCache, gitRevParse, realpathOrSelf, computeWorktreeId,
    accreditCanonicalRequest, resolveActivationForRequestPath, resolveAbsolute,
    getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
    getRuntimeBridgeCodex: () => require('./runtime-bridge-codex.cjs'),
  });
  ({
    HOST_BRIDGE_ID_RE, hostBridgeCommittedTurnIds, createHostBridgeCapability,
    requireHostBridgeCapabilityWithLiveWorker, requireHostBridgeCapability,
    requireHostBridgeRequestScope,
  } = hostBridgeCapabilityModule);

  const rootIntentsModule = createRootIntentsModule({
    path, CliError, requireHostBridgeCapability, resolveAbsolute, computeCoordRootId,
    getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
    classifyDurableRead, DURABLE_ABSENT, DURABLE_PENDING, sha256Buffer,
  });
  ({
    hostBridgeListRootConsultIntents, readLifecycleRecordRequired,
    findCorrelatedRootConsultIntent,
  } = rootIntentsModule);

  ({
    hostBridgeClaim, hostBridgeLeaseHeartbeat, hostBridgeScheduleTurn,
    hostBridgeRecordTurnStartAccepted, hostBridgePublishPatternEvidence,
    hostBridgePublishTerminalResult,
  } = createTurnsModule({
    path, CliError, requireHostBridgeRequestScope, cmdClaim, cmdLeaseHeartbeat,
    resolveAbsolute, resolveAuthoritativeAttempt, claimPathFor, readClosedRecord,
    CLAIM_V1_FIELDS, readCanonicalCancelRecordOptional, cancelPathFor,
    readJsonDurableOptional, acceptedResultPathFor, ACCEPTED_RESULT_V1_FIELDS,
    resultPathFor, RESULT_V2_FIELDS, activationIntentPathFor, deliveryPathFor,
    nowIso,
    publishNoClobber, canonicalJSONStringify, ACTIVATION_INTENT_V1_FIELDS,
    hostBridgeCommittedTurnIds, isNonEmptyString, utf8ByteLength, assertClosedShape,
    DELIVERY_V1_FIELDS, blobPathFor, assertArtifactMatchesReceipt, sha256Buffer,
    patternEvidencePathFor, PATTERN_EVIDENCE_V1_FIELDS, isCanonicalContext7LibraryId,
    sha256String, evidenceRelativeRefFor, isoToMs, assertLockedScopeIdentity,
    withLock, planRootFromArtifact, validateRuntimeTurnEnvelope, validatePatternGap,
    resolveRootEvidenceAuthority, isHex64, isPatternEvidenceDependencyShape,
    validateConsultationDependencySet, cmdPublishResult,
  }));

  ({
    hostBridgeAllowedChildRoles, hostBridgePublishChildRequest,
    hostBridgeObserveChildResult,
  } = createChildrenModule({
    path, fs, CliError, requireHostBridgeCapability, requireHostBridgeRequestScope,
    validateConsultV2, MAX_DEPTH_LIMIT, cmdPublishRequest, dispatchCanonical,
    resolveAbsolute, accreditCanonicalRequest, planRootFromArtifact, requestPathFor,
    resolveActivationForRequestPath, readCanonicalRequestRecord,
    resolveAuthoritativeAttempt, resultPathFor, RESULT_V2_FIELDS,
    validateResultV2, classifyDurableRead, cmdAcceptResult,
    cmdTransactionAck, acceptedResultPathFor, assertClosedShape,
    ACCEPTED_RESULT_V1_FIELDS, readDurableRecord, DURABLE_ABSENT, DURABLE_PENDING,
    assertAcceptedResultCorrelates, ACK_V1_FIELDS, canonicalJSONStringify,
    hasExactKeys, isHexId, isoToMs, RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES,
    RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN,
    getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
  }));

  const rootStatusModule = createRootStatusModule({
    path, fs, CliError, HOST_BRIDGE_ID_RE, requireHostBridgeCapabilityWithLiveWorker,
    resolveAbsolute, getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
    readLifecycleRecordRequired, computeRepoId, computeWorktreeId, gitRevParse,
    computeCoordRootId, isoToMs, planRootPath, requestPathFor,
    accreditCanonicalRequest, classifyDurableRead, DURABLE_ABSENT, DURABLE_PENDING,
    pendingDurableStop, cancelPathFor, classifyCanonicalCancelRecord,
    resolveAuthoritativeAttempt, resultPathFor, readClosedRecord,
    acceptedResultPathFor, ACCEPTED_RESULT_V1_FIELDS, ackPathFor, ACK_V1_FIELDS,
    SUBJECT_BUNDLE_MANIFEST_V1_FIELDS, SUBJECT_BUNDLE_ENTRY_FIELDS,
    assertClosedShape, readDurableRecord, sha256Buffer, readCanonicalRequestRecord,
    validateResultV2, assertAcceptedResultCorrelates, canonicalJSONStringify,
  });
  ({
    rootConsultIntentContext, requestInputForRootIntent,
    assertBuiltRootRequestMatchesIntent, rootConsultOperationResult,
    canonicalRequestPathForRootIntent, readRootConsultTerminalStatus,
    readRootSourceTerminalArtifacts, readExistingRootConsultCompletion,
  } = rootStatusModule);

  ({
    hostBridgeAdvanceRootConsult, hostBridgeObserveAndCompleteRootConsult,
  } = createRootOperationsModule({
    path, CliError, rootConsultIntentContext, rootConsultOperationResult,
    readExistingRootConsultCompletion, requestInputForRootIntent,
    buildCanonicalRequest, assertBuiltRootRequestMatchesIntent,
    publishPreallocatedRequest, dispatchCanonical, canonicalRequestPathForRootIntent,
    hostBridgeObserveChildResult, nowIso, canonicalJSONStringify, sha256Buffer,
    readLifecycleRecordRequired, requireHostBridgeCapability,
  }));

  ({ hostBridgeListInbox } = createInboxModule({
    path, fs, CliError, requireHostBridgeCapability, resolveAbsolute, computeRepoId,
    getRuntimeRoleLifecycle: () => require('./runtime-role-lifecycle.cjs'),
    planRootPath, isHexId, requestPathFor, accreditCanonicalRequest, currentClockMs,
    isoToMs, resolveAuthoritativeAttempt, readCanonicalCancelRecordOptional,
    cancelPathFor, readJsonDurableOptional, acceptedResultPathFor,
    ACCEPTED_RESULT_V1_FIELDS, resultPathFor, RESULT_V2_FIELDS, assertClosedShape,
    resolveActivationForRequestPath, requireHostBridgeRequestScope,
    resolveRootEvidenceAuthority, validateInboxRefV1,
  }));


}

module.exports = {
  isSafeRelativeEntryPath,
  canonicalJSONStringify, sha256Buffer, sha256String, sha256File, writeAllSync, classifyDurableRead,
  // NO-GO Correction C: the ONE canonical ack/cancel basename source,
  // reused by runtime-role-lifecycle.cjs's retirement-record validator to
  // reject a non-canonical terminal_ref (never a second, separately
  // hardcoded basename literal). acceptedResultPathFor added for M7 RED 17
  // (M7-ONESHOT-TERMINAL-CUT): mintRoleCommandGrant's own one-shot-family
  // terminal check reuses this SAME basename source, never a second literal.
  // resultPathFor added for M7 defect 6: the one-shot family's own
  // AUTHORITATIVE terminal is its result (results/<attempt>.json), never
  // accepted-result.json (section 8.5) -- exported so
  // runtime-role-lifecycle.cjs's own mintRoleCommandGrant/consultation.cjs's
  // own consume-time recheck share this SAME path source, never a second
  // hardcoded literal.
  ackPathFor, cancelPathFor, acceptedResultPathFor, resultPathFor,
  isValidLockTokenFor, acquireLock, releaseLock, listResultFiles, findResultWithStatus, reconcileOneNoClobberTemp,
  // WP3: reused by runtime-role-lifecycle.cjs's host-private registry (same fd-bound
  // durability primitives, never a second reimplementation of this security-critical logic).
  DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT, publishNoClobber, gitRevParse, realpathOrSelf,
  // M6+M7 SIXTEENTH Phase 2C: sealed git-topology cache primitives, reused
  // by every module that memoizes a per-projectRoot git-derived identity
  // rather than each hand-rolling its own (weaker, divergence-prone) seal.
  // sealCorrelatesWithGitCommonDir added post-review (commondir seal gap):
  // exact self-consistency check between commondir's own resolved target
  // and the gitCommonDirReal string git itself produced.
  resolveSealedGitCache, sealGitIdentityFor, gitTopologySealsMatch, sealCorrelatesWithGitCommonDir,
  // WP3 item C: the bridge's own coordination-root check reuses this EXACT
  // confinement primitive rather than a second, weaker one.
  validateRootConfinement,
  // W09/W10: one SID-based Windows ACL primitive shared with the lifecycle
  // registry (which already depends on this module, so no reverse require/cycle).
  resolvedWindowsPowerShellPath, windowsPrivateDirectoryAcl,
  // TOCTOU fix (arch-platform re-review, wave-portable-runtime-messaging-adapters):
  // exported so callers can re-probe and compare before/after ACL snapshots
  // around a credential/config read, mirroring validateRootConfinement's own
  // before/after pattern rather than trusting a single point-in-time check.
  windowsAclSnapshotsEqual,
  // WP3 item C2 (R7): single canonical RuntimeTurnEnvelope/v1 source (PLAN.md ~L932).
  runtimeTurnEnvelopeSchema, validateRuntimeTurnEnvelope,
  codexStructuredRuntimeTurnEnvelopeSchema,
  unwrapAndValidateCodexStructuredRuntimeTurnEnvelope,
  validateContext7LibraryId: isCanonicalContext7LibraryId,
  // M6/M7 terminal functional closure (points A/C/F): request-scoped
  // APPROVED_CONTEXT7_LIBRARY_ID directive parser, the unified root-aware
  // evidence-authority resolver, and the canonical consultation_dependencies
  // validator -- exported for direct node:test coverage of this
  // security-critical logic (M67-* RED suites).
  parseApprovedContext7Directive,
  resolveRootEvidenceAuthority,
  validateConsultationDependencySet,
  classifyCanonicalResultForRequest,
  patternEvidencePathFor,
  materializePlanRef,
  materializeRoutingPolicy,
  materializeSubjectBundle,
  targetRoleProfileDigestFor,
  ROUTING_POLICY_VERSION,
  ROUTING_POLICY_DIGEST,
  buildCanonicalRequest,
  publishPreallocatedRequest,
  dispatchCanonical,
  createHostBridgeCapability,
  hostBridgeListRootConsultIntents,
  hostBridgeAdvanceRootConsult,
  hostBridgeObserveAndCompleteRootConsult,
  readRootConsultTerminalStatus,
readRootSourceTerminalArtifacts,
  hostBridgeListInbox,
  hostBridgeClaim,
  hostBridgeLeaseHeartbeat,
  hostBridgeScheduleTurn,
  hostBridgeRecordTurnStartAccepted,
  hostBridgePublishPatternEvidence,
  hostBridgePublishTerminalResult,
  hostBridgeAllowedChildRoles,
  hostBridgePublishChildRequest,
  hostBridgeObserveChildResult,
  // M7 completeness Part C follow-up: the read-side scan agent-spawn-
  // execution-gate.js/subagent-start-context-bundle.js use to recognize a
  // CURRENT claude-agent-driven activation/v1 (PLAN.md §15d). planRootPath
  // itself is deliberately NOT exported -- nothing outside this file calls
  // it directly, only findLiveClaudeAgentActivations's own internal use.
  findLiveClaudeAgentActivations,
  // M7 completeness Part C follow-up: the per-request driver resolver
  // runtime-consultation-target-gate.js uses for its deterministic
  // ClaudeOneShotBinding-vs-RoleActorBinding branch (point 4).
  resolveActivationForRequestPath,
  // M6+M7 requester-authority closure (Group B): the ONE shared requester-
  // grant-scope resolver context-provider-gate.js uses to mint a correctly-
  // scoped grant, mirroring the SAME resolution this file's own main()
  // independently re-derives before consuming one.
  resolveRequesterGrantScope,
};

// ─────────────────────────────────────────────────────────────────────────────
// R33 static conformance surface -- TEST-CAPABILITY-GATED, NOT a production export.
//
// The entire R33 surface is currently reachable ONLY by tests, and this gate says
// exactly that. An UNCONDITIONAL export is a shipped surface no matter what the
// comment above it claims, and an earlier revision shipped these unconditionally
// on the reasoning that R3.3:1115-1117 names their eventual in-process callers
// (step 12 the root-profile check, step 17 the provider-session check). That
// justified their EXISTENCE as contract implementation awaiting its consumer; it
// never justified a public surface. Those callers belong to the provider-owned
// composition and DO NOT EXIST YET.
//
// Gated behind the same `isTestCapability()` seam as `--fixed-ids`/`--fixed-clock`
// (NODE_ENV=test PLUS a harness-created RUNTIME_CONSULTATION_TEST_CAPABILITY,
// cjs:207). Resolved ONCE at require time, so a production `require` of this
// module observes none of these names.
//
// WHEN PHASE B LANDS, the production export is the complete authoritative
// composition -- never these partial parsers. They stay behind this gate as its
// internals. Do not promote one of them to production reach because a caller
// finds it convenient: a conformance check that escapes into production is the
// public-SUCCESS mistake in a different costume.
//
// What they are, restated so the gate is not mistaken for mere test plumbing:
// they prove closed schema, canonical bytes, confined paths, tuple correlation
// and the A.5 digests. They establish NO authority, accreditation or liveness. A
// caller that runs any of them to completion has learned that bytes conform to a
// closed schema -- not that a root, session or profile is legitimate.
//
// The field tables remain unexported even under the gate: tests must not
// introspect internals. Key counts are pinned by the module-load count assertion
// plus golden vectors. `R33_TUPLE_CORRELATION_KEYS` is the deliberate exception --
// it is a DERIVED CONTRACT ARTIFACT, not a harness, and the 17x1 mutation matrix
// must iterate the PRODUCTION table; a hardcoded list of 17 names would let a
// disabled comparison and a deleted test row both stay green, which is exactly
// how the missing per-key coverage went unnoticed.
// ─────────────────────────────────────────────────────────────────────────────
if (isTestCapability()) {
  Object.assign(module.exports, {
    // A.5 digest formulas (R3.3:3716-3729) -- a test uses the PRODUCTION formula
    // rather than reimplementing it, since a reimplementation either drifts from
    // production or fails for the wrong reason; a golden vector then pins it so a
    // production change cannot silently pass.
    rootProfileDigestV3,
    providerSessionDigestV3,
    temporalEnvelopeDigestV1,
    // Non-authoritative conformance checks.
    checkRootProfileV3Conformance,
    checkProviderSessionV3Conformance,
    checkRuntimeProfileBindingV2Conformance,
    checkR33ProfileTupleConformance,
    // Derived contract artifact (see above).
    R33_TUPLE_CORRELATION_KEYS,
    // M7 §10.1: test-only rendezvous surface -- a test harness that needs to
    // drive/inspect the rendezvous mechanism directly, rather than only
    // through a real command call path, can.
    testM7Rendezvous,
    resolveSafeM7RendezvousDir,
    // Stage D (M7-FINAL-REMEDIATION-20260818, mandatory nonsemantic cleanup):
    // resolveActivationForRequestPath checks activation_liveness_expiry
    // against this SAME formula -- a test fixture that needs a genuinely-live
    // activation record derives its own liveness deadline from the real
    // function, never a second, independently hand-maintained copy that can
    // silently drift from it. Not a new production public surface -- usable
    // by tests under the real test capability only.
    activationLivenessDeadline,
    // P4 wave-portable-runtime-messaging-adapters follow-up (arch-platform PREP
    // verdict, "not independently verified" item; scope authorized via
    // PLAN.md:6085-6086): localComputePrincipalId/localRegistryRepoDir are this
    // file's own documented logic-identical local copies of
    // runtime-role-lifecycle.cjs's computePrincipalId/registryRepoDir (see this
    // file's own comment at their definition, ~L6386-6392). Exported here ONLY
    // under the test capability so a regression test (arch-testing/
    // test-specialist) can pin byte-identical behavior against the canonical
    // originals -- not a new production public surface.
    localComputePrincipalId,
    localRegistryRepoDir,
  });
}

// Publish the complete require()-able surface before entering CLI execution.
// runtime-role-lifecycle.cjs reuses the durability primitives above and the
// CLI's requester-grant validator lazily requires lifecycle in return. Running
// main() before assigning module.exports exposed an empty partial module during
// that cycle and made every canonical requester binding fail as `read-failed`.
if (require.main === module) {
  main();
}
