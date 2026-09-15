#!/usr/bin/env node
'use strict';

/**
 * runtime-role-lifecycle.cjs -- stable lifecycle compatibility facade and composition
 * root. It owns the frozen CLI/CommonJS ABI while cohesive factories under
 * `runtime-role-lifecycle/` implement bindings, actions, policy, authority, grants,
 * recovery and Claude lifecycle observations. Live authority is always derived from
 * validated host evidence; this module never fabricates model state. Also exports
 * `renderPosixDirect(argv)`/`parsePosixDirect(command)`, the canonical POSIX
 * host-action renderer/parser frozen at PLAN.md ~L578, for direct import by
 * `context-provider-gate.js` (no model reimplements quoting).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { createRuntimeIdentityModule } = require('./runtime-role-lifecycle/runtime-identity.cjs');
const { createPrivateRegistryModule } = require('./runtime-role-lifecycle/private-registry.cjs');
const { createSessionGenerationModule } = require('./runtime-role-lifecycle/session-generation.cjs');
const { createClaudeId01Scope } = require('./runtime-role-lifecycle/claude-id01-scope.cjs');
const { createClaudeId01Trace } = require('./runtime-role-lifecycle/claude-id01-trace.cjs');
const { createClaudeId01Startup } = require('./runtime-role-lifecycle/claude-id01-startup.cjs');
const { createClaudeId01Observations } = require('./runtime-role-lifecycle/claude-id01-observations.cjs');
const { createClaudePeerBinding } = require('./runtime-role-lifecycle/claude-peer-binding.cjs');
const { createClaudeResumeRecord } = require('./runtime-role-lifecycle/claude-resume-record.cjs');
const { createClaudeResumeLifecycle } = require('./runtime-role-lifecycle/claude-resume-lifecycle.cjs');
const { createClaudeOneShotRecord } = require('./runtime-role-lifecycle/claude-one-shot-record.cjs');
const { createClaudeOneShotOperations } = require('./runtime-role-lifecycle/claude-one-shot-operations.cjs');
const { createRoleBindingState } = require('./runtime-role-lifecycle/role-binding-state.cjs');
const { createSupervisorReadyTransition } = require('./runtime-role-lifecycle/supervisor-ready-transition.cjs');
const { createRoleCapabilityRouting } = require('./runtime-role-lifecycle/role-capability-routing.cjs');
const { createDiskConsumerRegistration } = require('./runtime-role-lifecycle/disk-consumer-registration.cjs');
const { createLifecycleActionRecord } = require('./runtime-role-lifecycle/lifecycle-action-record.cjs');
const { createLifecycleActionPayloads } = require('./runtime-role-lifecycle/lifecycle-action-payloads.cjs');
const { createLifecycleArgv } = require('./runtime-role-lifecycle/lifecycle-argv.cjs');
const { createRootSourceBootstrapLines } = require('./runtime-role-lifecycle/root-source-bootstrap-lines.cjs');
const { createRootSourceContract } = require('./runtime-role-lifecycle/root-source-contract.cjs');
const { createRootSourceReservation } = require('./runtime-role-lifecycle/root-source-reservation.cjs');
const { createRootSourceBindingAdmission } = require('./runtime-role-lifecycle/root-source-binding-admission.cjs');
const { createRootSourceBindingRecords } = require('./runtime-role-lifecycle/root-source-binding-records.cjs');
const { createRootSourceLiveIndex } = require('./runtime-role-lifecycle/root-source-live-index.cjs');
const { createClaudeAuthorityClassifier } = require('./runtime-role-lifecycle/claude-authority-classifier.cjs');
const { createClaudeAuthorityAdmission } = require('./runtime-role-lifecycle/claude-authority-admission.cjs');
const { createAuthorityTransactions } = require('./runtime-role-lifecycle/authority-transactions.cjs');
const { createRoleCommandGrant } = require('./runtime-role-lifecycle/role-command-grant.cjs');
const { createLifecycleCommandGrant } = require('./runtime-role-lifecycle/lifecycle-command-grant.cjs');
const { createOrchestratorRoleBindings } = require('./runtime-role-lifecycle/orchestrator-role-bindings.cjs');
const { createRequesterBindingModule } = require('./runtime-role-lifecycle/requester-binding.cjs');
const { createExecutionClaimModule } = require('./runtime-role-lifecycle/execution-claim.cjs');
const { createRoleSpawnExecutionClaim } = require('./runtime-role-lifecycle/role-spawn-execution-claim.cjs');
const { createDirectRoleHostAdmission } = require('./runtime-role-lifecycle/direct-role-host-admission.cjs');
const { createClaudeAgentSpawnReservation } = require('./runtime-role-lifecycle/claude-agent-spawn-reservation.cjs');
const { createRootConsultRecords } = require('./runtime-role-lifecycle/root-consult-records.cjs');
const { createS16ContextResolution } = require('./runtime-role-lifecycle/s16-context-resolution.cjs');
const { createP2SubjectBundle } = require('./runtime-role-lifecycle/p2-subject-bundle.cjs');
const { createMixedReviewRecords } = require('./runtime-role-lifecycle/mixed-review-records.cjs');
const { createPrepPublicationRecords } = require('./runtime-role-lifecycle/prep-publication-records.cjs');
const { createSupervisorLifecycleOwner } = require('./runtime-role-lifecycle/supervisor-lifecycle-owner.cjs');
const { createSupervisorBatchMint } = require('./runtime-role-lifecycle/supervisor-batch-mint.cjs');
const { createTeamEnsure } = require('./runtime-role-lifecycle/team-ensure.cjs');
const { createResumeCheckpoint } = require('./runtime-role-lifecycle/resume-checkpoint.cjs');
const { createEnsureHandler } = require('./runtime-role-lifecycle/ensure-handler.cjs');
const { createCliNotifyHandler } = require('./runtime-role-lifecycle/cli-notify-handler.cjs');
const { createCliTerminalize } = require('./runtime-role-lifecycle/cli-terminalize.cjs');
const { createCliActionReadyHandlers } = require('./runtime-role-lifecycle/cli-action-ready-handlers.cjs');
const { createCliRotateStopHandlers } = require('./runtime-role-lifecycle/cli-rotate-stop-handlers.cjs');
const { createCliConsultHandlers } = require('./runtime-role-lifecycle/cli-consult-handlers.cjs');
const { createCliRootSourceHandlers } = require('./runtime-role-lifecycle/cli-rootsource-handlers.cjs');
const { createPrepPublicationReserve } = require('./runtime-role-lifecycle/prep-publication-reserve.cjs');
const { createPrepPublicationGrammar } = require('./runtime-role-lifecycle/prep-publication-grammar.cjs');
const { createP2Materialization } = require('./runtime-role-lifecycle/p2-materialization.cjs');
const { createCliDispatch } = require('./runtime-role-lifecycle/cli-dispatch.cjs');
const { createCliEnvelope } = require('./runtime-role-lifecycle/cli-envelope.cjs');
const { createPolicySchema } = require('./runtime-role-lifecycle/policy-schema.cjs');
const { createPosixDirect } = require('./runtime-role-lifecycle/posix-direct.cjs');
const { createStructuralValidators } = require('./runtime-role-lifecycle/structural-validators.cjs');
const { createM7Rendezvous } = require('./runtime-role-lifecycle/m7-rendezvous.cjs');
const { createRetainedSupervisorReconciliation } = require('./runtime-role-lifecycle/retained-supervisor-reconciliation.cjs');
const { createManagedLifecycleGrant } = require('./runtime-role-lifecycle/managed-lifecycle-grant.cjs');

// WP3: reuse the sibling module's proven fd-bound durability primitives (no-clobber
// publish, fd-bound classify-read, digest helpers, git identity) rather than a second
// hand-written reimplementation of this exact security-critical logic.
const rc = require('./runtime-consultation.cjs');
const {
  sha256Buffer, sha256String, sha256File, canonicalJSONStringify, writeAllSync,
  classifyDurableRead, publishNoClobber, gitRevParse, realpathOrSelf,
  windowsPrivateDirectoryAcl,
  DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT,
} = rc;

// Canonical role registry: union of the default policy's support_plane +
// phase_scoped_roles and the default routing registry's routes keys
// (PLAN.md ~L95-97, ~L1099-1108).
const CANONICAL_ROLES = Object.freeze([
  'arch-platform',
  'arch-testing',
  'arch-integration',
  'context-provider',
  'doc-updater',
  'toolkit-specialist',
  'test-specialist',
  'verifier',
  'quality-gater',
  'planner',
]);

// Bounded scan cap shared by every MainOrchestratorBinding/v1 hook-directory scan
// (orchestrator-role-bindings.cjs and execution-claim.cjs both scan the SAME
// orchestrator-bindings/ directory) -- owned here so neither carries its own copy.
const MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP = 1024;


// Production argv never accepts a caller-supplied session generation, binding/teammate/agent
// ID, PID, team name, policy/registry/bootstrap path, prompt, or runtime handle (PLAN.md
// ~L150). `--lifecycle-binding` is deliberately NOT forbidden (SUBCOMMAND_SPEC recognizes it
// for the mutating subcommands) but is still unusable by a caller/model: its value must
// resolve to a real, unexpired, unconsumed grant minted from genuine hook-observed identity.
const FORBIDDEN_FLAGS = Object.freeze([
  '--requester-binding',
  '--target-binding',
  '--session-generation',
  '--binding-id',
  '--teammate-id',
  '--agent-id',
  '--pid',
  '--team-name',
  '--policy-path',
  '--registry-path',
  '--bootstrap-path',
  '--prompt',
  '--runtime-handle',
]);

// WP3 runtime identity, host-private registry, and session-generation
// implementations live in bounded factories. The facade remains the sole
// composition root so mutable authority state is created exactly once.
const cliEnvelope = createCliEnvelope({});
const {
  STATUS_ENUM, DETAIL_ENUM, RC, makeResult, emitAndExit, usageError, invalidError,
  reportRetainedPairRejection, unavailableError, isHexDigest64, isHexCsprng32, isHexActionId,
  isIntInRange,
} = cliEnvelope;
const structuralValidators = createStructuralValidators({});
const {
  hasExactKeys, ROLE_BINDING_ALLOWED_KEYS, hasOnlyAllowedKeys, validateExpectedRecordFields,
  isTestCapability, EXECUTOR_CAPABILITY_ENV, isFakeExecutorCapability,
} = structuralValidators;
const policySchema = createPolicySchema({
  fs, path, facadeDirname: __dirname, CANONICAL_ROLES,
});
const {
  POLICY_MODE_ENUM, ROUTING_DRIVER_ENUM, ROUTING_ROLE_ENUM, POLICY_REQUIRED_KEYS,
  hasUniqueValues, isNonEmptyCanonicalRoleArray, isIntInRangeNum, isValidPolicy, isValidPolicyV2,
  projectPolicyV2ToV1, isValidRouting, resolvePolicyPair, loadJSON,
} = policySchema;
const posixDirect = createPosixDirect({});
const { renderPosixDirect, parsePosixDirect } = posixDirect;

const runtimeIdentity = createRuntimeIdentityModule({
  sha256String, sha256File, gitRevParse, realpathOrSelf, isTestCapability, CANONICAL_ROLES,
  // __dirname is intentionally the facade's own dir; computed inside the module it
  // would resolve one level too deep, silently pointing at the wrong repo root.
  defaultTemplateRoot: path.join(__dirname, '..', '..'),
});
const {
  computePrincipalId,
  computeRepoId,
  computeWorktreeId,
  deepestExistingAncestorRealpath,
  coordinationRootPathFor,
  computeCoordinationRootIdFromPath,
  computeCoordinationRootId,
  discoverPlan,
  templateRootBase,
  roleProfileDigestFor,
  resolveCanonicalRoleProfile,
} = runtimeIdentity;

function s16ConsultationApi() {
  return require('./runtime-consultation.cjs');
}

let sessionGeneration;
const privateRegistry = createPrivateRegistryModule({
  computePrincipalId,
  computeRepoId,
  realpathOrSelf,
  resolvedWindowsPowerShellPath: rc.resolvedWindowsPowerShellPath,
  windowsPrivateDirectoryAcl,
  classifyDurableRead,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  writeAllSync,
  currentClockMsForRegistry: (...args) => sessionGeneration.currentClockMsForRegistry(...args),
});
const {
  windowsCommonApplicationDataRoot,
  registryBaseDir,
  registryRepoDir,
  ensureSecureRegistryDir,
  writeRegistryRecordReplace,
  readRegistryRecord,
  withRegistryLock,
} = privateRegistry;
const m7Rendezvous = createM7Rendezvous({
  fs, path, os, realpathOrSelf, registryBaseDir, coordinationRootPathFor, isTestCapability,
});
const { m7SleepSync, resolveSafeM7RendezvousDir, testM7Rendezvous } = m7Rendezvous;


sessionGeneration = createSessionGenerationModule({
  canonicalJSONStringify,
  hasExactKeys,
  isHexCsprng32,
  isTestCapability,
  readRegistryRecord,
  registryRepoDir,
  sha256String,
  withRegistryLock,
  writeRegistryRecordReplace,
});
const {
  IDENTITY_PROVIDER_ENUM,
  MAX_RUNTIME_SESSION_KEY_BYTES,
  SESSION_GENERATION_KEYS,
  currentClockMsForRegistry,
  futureIsoForRegistry,
  getRuntimeIdentity,
  isCanonicalIsoUtc,
  isoPlusSecondsForRegistry,
  isoToMsForRegistry,
  nowIsoForRegistry,
  peekSessionGeneration,
  readLiveSessionGenerationById,
  resolveSessionGeneration,
  safeExpiryIsoForRegistry,
  sessionGenerationPathFor,
  sessionLookupKey,
} = sessionGeneration;
// M7/WP4 requester-binding schema: pure constants needed by BOTH requester-binding.cjs
// and claudeAuthorityClassifier (composed before requester-binding.cjs, due to their
// mutual classifyClaudeAuthorityForIdentity/validateRequesterBindingFor need) --
// declared here once and injected into both rather than duplicated.
const REQUESTER_BINDING_SCHEMA = 'coordination/requester-binding/v1';
const REQUESTER_BINDING_KEYS = Object.freeze([
  'actor_instance_id', 'agent_key', 'binding_id', 'created_at', 'expiry',
  'plan_digest', 'role', 'runtime', 'runtime_session_key', 'schema', 'worktree_id',
].sort());
const REQUESTER_BINDING_SCHEMA_V2 = 'coordination/requester-binding/v2';
const REQUESTER_BINDING_KEYS_V2 = Object.freeze(
  REQUESTER_BINDING_KEYS.concat(['session_generation_id']).sort()
);
const REQUESTER_BINDING_SCAN_CAP = 1024;

const orchestratorRoleBindings = createOrchestratorRoleBindings({
  path, fs, crypto, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace,
  publishNoClobber, canonicalJSONStringify, resolveSessionGeneration, peekSessionGeneration,
  nowIsoForRegistry, isoPlusSecondsForRegistry, isoToMsForRegistry, currentClockMsForRegistry,
  isCanonicalIsoUtc, isHexActionId, isHexDigest64, isHexCsprng32, hasExactKeys, isIntInRangeNum,
  IDENTITY_PROVIDER_ENUM, MAX_RUNTIME_SESSION_KEY_BYTES, CANONICAL_ROLES, computeRepoId,
  sha256String, MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP,
});
const {
  MAIN_BINDING_KEYS, mainOrchestratorBindingPathFor, createMainOrchestratorBinding,
  rebindMainOrchestratorBindingForNewPlan, findLiveMainOrchestratorBindingForScope,
  hasLiveMainOrchestratorBindingForScope,
  ROLE_ACTOR_BINDING_SCHEMA, ROLE_ACTOR_BINDING_KEYS, ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS,
  roleActorBindingPathFor, createRoleActorBinding, validateRoleActorBindingFor,
  CLAUDE_AUTHORITY_IDENTITY_SCHEMA, CLAUDE_AUTHORITY_FENCE_SCHEMA, CLAUDE_AUTHORITY_FENCE_KEYS,
  CLAUDE_AUTHORITY_FENCE_REASON_ENUM, resolveM7RepoId, computeClaudeAuthorityIdentityId,
  claudeAuthorityFencePathFor, readClaudeAuthorityFence, publishClaudeAuthorityFence,
} = orchestratorRoleBindings;

function retainedSupervisorBridgeApi() {
  // Lazy by construction: runtime-bridge-codex.cjs imports this module at
  // top level. Requiring it only after this module has fully initialized
  // avoids a circular partial-export authority path.
  return require('./runtime-bridge-codex.cjs');
}

/**
 * CLI entry point. Never throws: any unexpected internal error is caught and
 * reported as one valid rc7 envelope rather than an uncaught-exception stack trace,
 * so stdout is always exactly one closed-shape JSON line.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {never}
 */
const lifecycleActionRecord = createLifecycleActionRecord({
  fs, path, crypto, Buffer, canonicalJSONStringify, currentClockMsForRegistry,
  ensureSecureRegistryDir, isHexActionId, isoToMsForRegistry, publishNoClobber,
  readRegistryRecord, registryBaseDir, registryRepoDir,
  validateRootSourceAction: (...args) => validateRootSourceAction(...args),
});
const {
  ACTION_KIND_ENUM, ACTION_RUNTIME_ENUM, ACTION_KIND_RUNTIME, HOST_OPERATION_FOR_ACTION,
  resolveHostOperationForAction, ACTION_TTL_CEILING_SECONDS,
  CLAUDE_NATIVE_STARTUP_TIMEOUT_DEFAULT_SECONDS, classifyStartupScope,
  actionTtlPolicyLimitSeconds, computeActionTtlSeconds, effectiveActionTtlSeconds,
  actionPathFor, generateActionId, mintRoleLifecycleAction, actionForEnvelope,
  ACTION_ID_DIR_RE, MAX_ACTION_REPO_SCAN_ENTRIES, validateActionRecordShapeForLookup,
  findActionDirect, findActionAcrossRepos,
} = lifecycleActionRecord;
const roleBindingState = createRoleBindingState({
  path, crypto, Buffer, sha256String, registryRepoDir, readRegistryRecord,
  withRegistryLock, nowIsoForRegistry, canonicalJSONStringify, writeRegistryRecordReplace,
  ROLE_BINDING_ALLOWED_KEYS, hasOnlyAllowedKeys, isCanonicalIsoUtc, isHexActionId,
  isHexCsprng32, isHexDigest64,
});
const {
  ROLE_BINDING_STATE_ENUM, ROLE_BINDING_TRANSITIONS, roleBindingKeyDigest,
  roleBindingPathFor, roleBindingExtraFieldsAreClosedForState,
  validateRoleBindingRecordForScope, readRoleBindingState, transitionRoleBindingUnchecked,
  transitionRoleBinding, transitionRoleBindingAtomicViaWaypoint,
} = roleBindingState;
const lifecycleActionPayloads = createLifecycleActionPayloads({
  fs, path, process, facadeDirname: __dirname, CANONICAL_ROLES, canonicalJSONStringify,
  computeRepoId, computeWorktreeId, coordinationRootPathFor, discoverPlan, hasExactKeys,
  isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, isoToMsForRegistry,
  realpathOrSelf, renderPosixDirect, resolvePolicyPair, sha256String,
});
const {
  buildTeamEnsurePayload, buildRoleSpawnPayload, buildRoleRebindClaudeNativePayload,
  buildRoleRebindHostProcessPayload, buildRoleNotifyPayload, buildRoleStopOwnedPayload,
  resolvedNodePath, claudeReadyBootstrapMessageFor, buildSupervisorStartPayload,
  ROLE_LIFECYCLE_ACTION_KEYS_SORTED, SUPERVISOR_START_PAYLOAD_KEYS_SORTED,
  validateSupervisorStartAction, buildSupervisorStopOwnedPayload,
} = lifecycleActionPayloads;

// SupervisorExecutionClaim/v1, RoleSpawnExecutionClaim/v2, ClaudeAgentSpawnReservation/v1,
// and direct-role-host admission -- see each module's own header comment.
const executionClaim = createExecutionClaimModule({
  path, fs, crypto, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir,
  publishNoClobber, canonicalJSONStringify, sha256String, isHexActionId, isHexDigest64,
  isCanonicalIsoUtc, isoToMsForRegistry, currentClockMsForRegistry, nowIsoForRegistry,
  resolveSessionGeneration, peekSessionGeneration, readLiveSessionGenerationById,
  IDENTITY_PROVIDER_ENUM, MAX_RUNTIME_SESSION_KEY_BYTES, hasExactKeys, CANONICAL_ROLES,
  computeWorktreeId, discoverPlan, resolvePolicyPair, actionTtlPolicyLimitSeconds,
  validateSupervisorStartAction, isFakeExecutorCapability, isIntInRangeNum, withRegistryLock,
  mainOrchestratorBindingPathFor, MAIN_BINDING_KEYS, createMainOrchestratorBinding,
  MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP,
});
const {
  EXECUTION_CLAIM_SCHEMA, EXECUTION_CLAIM_KEYS, executionClaimPathFor,
  executionClaimConsumedMarkerPathFor, validateMainOrchestratorBindingFor,
  supervisorRetainedServiceExpiryFromAction, validateRetainedServiceAuthority,
  attachDerivedSessionGenerationId, mintSupervisorExecutionClaim, mintSupervisorExecutionClaimCore,
  findLiveMainOrchestratorBindingForSession, getOrCreateMainOrchestratorBindingForSession,
  mintSupervisorExecutionClaimForSession, validateAndConsumeExecutionClaim,
} = executionClaim;

const claudeAgentSpawnReservation = createClaudeAgentSpawnReservation({
  path, crypto, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir, publishNoClobber,
  canonicalJSONStringify, isHexActionId, isHexDigest64, isoToMsForRegistry, currentClockMsForRegistry,
  nowIsoForRegistry, hasExactKeys, CANONICAL_ROLES, resolvePolicyPair, validateMainOrchestratorBindingFor,
});
const {
  CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA, CLAUDE_AGENT_SPAWN_RESERVATION_KEYS,
  claudeAgentSpawnReservationPathFor, claudeAgentSpawnReservationConsumedMarkerPathFor,
  claudeAgentBootstrapMessageFor, mintClaudeAgentSpawnReservation,
  validateAndConsumeClaudeAgentSpawnReservation, peekValidateClaudeAgentSpawnReservation,
  consumeClaudeAgentSpawnReservationMarker,
} = claudeAgentSpawnReservation;

const roleSpawnExecutionClaim = createRoleSpawnExecutionClaim({
  path, crypto, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir, publishNoClobber,
  canonicalJSONStringify, sha256String, isHexDigest64, isoToMsForRegistry, currentClockMsForRegistry,
  nowIsoForRegistry, hasExactKeys, resolvePolicyPair, actionTtlPolicyLimitSeconds,
  validateMainOrchestratorBindingFor,
});
const {
  canonicalNativeAgentInputForAction, renderCanonicalNativeAgentInput,
  ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA, ROLE_SPAWN_EXECUTION_CLAIM_KEYS,
  roleSpawnExecutionClaimPathFor, roleSpawnExecutionClaimConsumedMarkerPathFor,
  mintRoleSpawnExecutionClaim, validateAndConsumeRoleSpawnExecutionClaim,
} = roleSpawnExecutionClaim;

const lifecycleArgv = createLifecycleArgv({
  Buffer, CANONICAL_ROLES, FORBIDDEN_FLAGS, hasExactKeys,
});
const {
  SUBCOMMAND_SPEC, parseSubcommandArgv, RESULT_KIND_RE, ROOT_CONSULT_INTENT_INPUT_KEYS,
  ROOT_SOURCE_INTENT_INPUT_KEYS, MIXED_REVIEW_INTENT_INPUT_KEYS,
  decodeMixedReviewIntent, OPERATION_KEYS, decodeBase64urlClosedJson,
  decodeRootConsultIntent, decodeRootSourceIntent,
} = lifecycleArgv;

// s16ContextResolution composes further below (needs retainedSupervisorBridgeApi/
// readRoleBindingState, produced later); its pure s16CoordinationRelativeRef is
// needed here first, via a forward-declared thunk, never a require() cycle.
let s16ContextResolution;
const rootSourceBootstrapLines = createRootSourceBootstrapLines({}); // frozen bootstrap final-line history: zero deps, composed once, threaded in.
const rootSourceContract = createRootSourceContract({
  fs, path, Buffer, RESULT_KIND_RE, ROLE_LIFECYCLE_ACTION_KEYS_SORTED,
  actionPathFor, canonicalJSONStringify, computeRepoId, computeWorktreeId,
  coordinationRootPathFor, decodeBase64urlClosedJson, discoverPlan, gitRevParse,
  hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64,
  parsePosixDirect, readRegistryRecord, realpathOrSelf, registryRepoDir,
  resolvedNodePath, s16CoordinationRelativeRef: (...args) => s16ContextResolution.s16CoordinationRelativeRef(...args),
  sha256Buffer, sha256File,
  validateRootSourceBindingRecord: (...args) => validateRootSourceBindingRecord(...args),
  facadeDirname: __dirname, rootSourceBootstrapLines,
});
const {
  ROOT_SOURCE_RESERVATION_SCHEMA, ROOT_SOURCE_RESERVATION_KEYS,
  ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS,
  ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_KEYS, ROOT_SOURCE_BINDING_SCHEMA_V2,
  ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_INGRESS_SCHEMA, ROOT_SOURCE_INGRESS_KEYS,
  ROOT_SOURCE_RETIREMENT_SCHEMA, ROOT_SOURCE_RETIREMENT_KEYS,
  ROOT_SOURCE_RETIREMENT_REASON_ENUM, ROOT_SOURCE_SCAN_CAP,
  ROOT_SOURCE_PUBLISH_INTENT_KEYS, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_LEGACY,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V2, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V3,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V4, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V5,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V6, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V7,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V8, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V9,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V10, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V11,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V12, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V13,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V14, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_V15,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY,
  rootSourceReservationPathFor, rootSourceReservationConsumedPathFor,
  rootSourceBindingPathFor, rootSourceIngressPathFor, rootSourceRetirementPathFor,
  rootSourceLockDirFor, decodeRootSourceBootstrapIntentFromAction,
  decodeRootSourceBootstrapIntentForBinding, validateRootSourceActionEnvelope,
  validateRootSourceAction,
} = rootSourceContract;

const rootSourceReservation = createRootSourceReservation({
  ...rootSourceContract,
  Buffer, actionPathFor, canonicalJSONStringify, currentClockMsForRegistry,
  hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64,
  isoToMsForRegistry, nowIsoForRegistry, publishNoClobber, readRegistryRecord,
  sha256String, validateMainOrchestratorBindingFor,
});
const {
  mintRootSourceReservation, validateRootSourceReservationRecord,
  validateAndConsumeRootSourceReservation,
} = rootSourceReservation;

const rootSourceBindingRecords = createRootSourceBindingRecords({
  ...rootSourceContract,
  path, actionPathFor, computeClaudeAuthorityIdentityId, currentClockMsForRegistry,
  hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64,
  isoToMsForRegistry, peekSessionGeneration, readClaudeAuthorityFence,
  readRegistryRecord, validateExpectedRecordFields,
  loadConsultation: () => require('./runtime-consultation.cjs'),
});
const {
  validateRootSourceBindingRecord, validateRootSourceBindingRecordV2,
  validateRootSourceBindingFor, validateRootSourceIngressRecord,
  validateRootSourceRetirementRecord,
} = rootSourceBindingRecords;

const rootSourceLiveIndex = createRootSourceLiveIndex({
  ...rootSourceContract,
  ...rootSourceReservation,
  ...rootSourceBindingRecords,
  fs, path, Buffer, RESULT_KIND_RE, ROLE_LIFECYCLE_ACTION_KEYS_SORTED,
  actionPathFor, canonicalJSONStringify, currentClockMsForRegistry,
  decodeBase64urlClosedJson, hasExactKeys, isCanonicalIsoUtc, isHexActionId,
  isHexCsprng32, isHexDigest64, isoToMsForRegistry, nowIsoForRegistry,
  parsePosixDirect, publishNoClobber, readRegistryRecord, registryRepoDir,
  sha256String,
});
const {
  findRootSourceBindingsByAction, ROOT_SOURCE_ACTION_PAYLOAD_KEYS,
  extractRootSourceBootstrapIntentForProvenance, findRootSourceProvenanceForRequestId,
  findLiveRootSourceActionsForRole, findLiveRootSourceReservationsForRole,
  publishRootIngress,
} = rootSourceLiveIndex;

const lifecycleCommandGrant = createLifecycleCommandGrant({
  path, Buffer, CANONICAL_ROLES, MAIN_BINDING_KEYS, ROLE_ACTOR_BINDING_KEYS,
  ROLE_ACTOR_BINDING_SCHEMA, canonicalJSONStringify, crypto,
  currentClockMsForRegistry, ensureSecureRegistryDir, hasExactKeys, hasUniqueValues,
  isCanonicalIsoUtc, isHexActionId, isHexDigest64, isoPlusSecondsForRegistry,
  isoToMsForRegistry, mainOrchestratorBindingPathFor, nowIsoForRegistry,
  publishNoClobber, readRegistryRecord, registryRepoDir, validateRoleActorBindingFor,
});
const {
  LIFECYCLE_GRANT_SCHEMA, GRANT_TTL_SECONDS, GRANT_KEYS, GRANT_BINDING_KIND_ENUM,
  GRANT_AUTHORITY_ENUM, GRANT_PROFILE_ENUM, GRANT_PROFILE_ADMITTED_SUBCOMMANDS,
  GRANT_PROFILE_FOR_BINDING_KIND, GRANT_AUTHORITY_FOR_BINDING_KIND,
  GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS, grantPathFor, grantConsumedMarkerPathFor,
  grantArraysEqual, isWellFormedGrantRole, grantRoleMatchesExpectation,
  mintLifecycleCommandGrant, validateAndConsumeLifecycleCommandGrant,
} = lifecycleCommandGrant;

const claudeOneShotOperations = createClaudeOneShotOperations({
  fs, path, registryRepoDir,
});
const {
  claudeOneShotBindingRetiredMarkerPathFor,
  CLAUDE_ONE_SHOT_BINDING_RETIREMENT_REASON_ENUM,
  checkClaudeAgentCapabilityAvailable,
} = claudeOneShotOperations;

const claudeOneShotRecord = createClaudeOneShotRecord({
  CANONICAL_ROLES, CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
  admitClaudeAuthorityOperation: (...args) => admitClaudeAuthorityOperation(...args),
  canonicalJSONStringify,
  checkClaudeAuthorityClassificationAgainstExpected: (...args) => checkClaudeAuthorityClassificationAgainstExpected(...args),
  checkOneShotTransactionTerminalAbsent: (...args) => checkOneShotTransactionTerminalAbsent(...args),
  classifyClaudeAuthorityForIdentity: (...args) => classifyClaudeAuthorityForIdentity(...args),
  computeClaudeAuthorityIdentityId, consumeClaudeAgentSpawnReservationMarker,
  crypto, currentClockMsForRegistry, hasExactKeys, isCanonicalIsoUtc,
  isHexActionId, isHexCsprng32, isHexDigest64, isIntInRangeNum,
  isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry, path,
  peekSessionGeneration, peekValidateClaudeAgentSpawnReservation,
  readClaudeAuthorityFence, readRegistryRecord, registryRepoDir, resolveM7RepoId,
  testM7Rendezvous,
  writeGuardedByClaudeAuthorityAdmission: (...args) => writeGuardedByClaudeAuthorityAdmission(...args),
  writeRegistryRecordReplace,
});
const {
  CLAUDE_ONE_SHOT_BINDING_SCHEMA, CLAUDE_ONE_SHOT_BINDING_KEYS,
  CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2, CLAUDE_ONE_SHOT_BINDING_KEYS_V2,
  CLAUDE_ONE_SHOT_BINDING_TTL_CEILING_SECONDS, claudeOneShotBindingPathFor,
  createClaudeOneShotBindingInternal, createClaudeOneShotBinding,
  consumeClaudeAgentSpawnReservationAndCreateOneShotBinding,
  validateClaudeOneShotBindingFor,
} = claudeOneShotRecord;

// requesterBinding is composed further below (it needs classifyClaudeAuthorityForIdentity,
// produced BY this classifier, and checkClaudeId01ProofComplete, produced after it) --
// broken via a forward-declared thunk, never a runtime require() cycle.
let requesterBinding;
const claudeAuthorityClassifier = createClaudeAuthorityClassifier({
  fs, path, Buffer, CANONICAL_ROLES, CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
  CLAUDE_ONE_SHOT_BINDING_KEYS, CLAUDE_ONE_SHOT_BINDING_KEYS_V2,
  CLAUDE_ONE_SHOT_BINDING_SCHEMA, CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
  IDENTITY_PROVIDER_ENUM, REQUESTER_BINDING_KEYS, REQUESTER_BINDING_KEYS_V2,
  REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_SCHEMA_V2,
  ROOT_SOURCE_BINDING_KEYS, ROOT_SOURCE_BINDING_KEYS_V2,
  ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_SCHEMA_V2,
  canonicalJSONStringify, claudeOneShotBindingPathFor, currentClockMsForRegistry,
  hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64,
  isoToMsForRegistry, readClaudeAuthorityFence, readRegistryRecord,
  registryRepoDir, rootSourceBindingPathFor, sha256String,
  requesterBindingPathFor: (...args) => requesterBinding.requesterBindingPathFor(...args),
  validateClaudeOneShotBindingFor,
  validateRequesterBindingFor: (...args) => requesterBinding.validateRequesterBindingFor(...args),
  validateRootSourceBindingFor,
});
const {
  CLAUDE_AUTHORITY_IDENTITY_KEYS, CLAUDE_AUTHORITY_SCAN_CAP,
  CLAUDE_AUTHORITY_PRIMARY_NAME_RE, CLAUDE_AUTHORITY_ROOT_SOURCE_SIDECAR_RE,
  CLAUDE_AUTHORITY_ONE_SHOT_SIDECAR_RE, isWellFormedClaudeAuthorityIdentity,
  scanClaudeAuthorityFamily, classifyClaudeAuthorityForIdentity,
} = claudeAuthorityClassifier;

const authorityTransactions = createAuthorityTransactions({
  fs, path, CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2, REQUESTER_BINDING_SCHEMA_V2,
  ROOT_SOURCE_BINDING_SCHEMA_V2, computeRepoId, coordinationRootPathFor,
  discoverPlan, readRegistryRecord, rootSourceIngressPathFor, s16ConsultationApi,
  validateRootSourceIngressRecord,
});
const {
  claudeAuthorityFamilyForBindingSchema, readCoordinationArtifactPresence,
  resolveM7TransactionDir, checkRootSourceTransactionTerminalAbsentAtTxnDir,
  checkRootSourceTransactionTerminalAbsent, checkOneShotTransactionTerminalAbsentAtTxnDir,
  checkOneShotTransactionTerminalAbsent, checkAuthorityOperationTransactionTerminal,
} = authorityTransactions;

const claudeAuthorityAdmission = createClaudeAuthorityAdmission({
  canonicalJSONStringify, checkAuthorityOperationTransactionTerminal,
  checkOneShotTransactionTerminalAbsent, classifyClaudeAuthorityForIdentity,
  currentClockMsForRegistry, isCanonicalIsoUtc, isoToMsForRegistry, sha256String,
});
const {
  CLAUDE_AUTHORITY_ADMISSION_OPERATION_KINDS,
  checkClaudeAuthorityClassificationAgainstExpected, admitClaudeAuthorityOperation,
  isValidClaudeAuthorityAdmissionCapability, writeGuardedByClaudeAuthorityAdmission,
} = claudeAuthorityAdmission;

const rootSourceBindingAdmission = createRootSourceBindingAdmission({
  ...rootSourceContract,
  ...rootSourceReservation,
  Buffer, CLAUDE_AUTHORITY_IDENTITY_SCHEMA, actionPathFor,
  admitClaudeAuthorityOperation, canonicalJSONStringify,
  checkClaudeAuthorityClassificationAgainstExpected, classifyClaudeAuthorityForIdentity,
  crypto, currentClockMsForRegistry, hasExactKeys, isCanonicalIsoUtc, isHexActionId,
  isoToMsForRegistry, nowIsoForRegistry, publishNoClobber,
  readLiveSessionGenerationById, readRegistryRecord, resolveM7RepoId, sha256String,
  testM7Rendezvous, validateMainOrchestratorBindingFor,
  writeGuardedByClaudeAuthorityAdmission,
});
const { createRootSourceBinding, admitAndCreateRootSourceBinding } = rootSourceBindingAdmission;

const roleCommandGrant = createRoleCommandGrant({
  path, Buffer, CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
  CLAUDE_ONE_SHOT_BINDING_KEYS, CLAUDE_ONE_SHOT_BINDING_KEYS_V2,
  CLAUDE_ONE_SHOT_BINDING_SCHEMA, CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
  REQUESTER_BINDING_KEYS, REQUESTER_BINDING_KEYS_V2,
  REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_SCHEMA_V2,
  ROLE_ACTOR_BINDING_KEYS, ROLE_ACTOR_BINDING_SCHEMA,
  ROOT_SOURCE_BINDING_KEYS, ROOT_SOURCE_BINDING_KEYS_V2,
  ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_SCHEMA_V2,
  admitClaudeAuthorityOperation, canonicalJSONStringify,
  checkAuthorityOperationTransactionTerminal,
  checkClaudeAuthorityClassificationAgainstExpected,
  checkOneShotTransactionTerminalAbsent, checkRootSourceTransactionTerminalAbsent,
  classifyClaudeAuthorityForIdentity, claudeAuthorityFamilyForBindingSchema,
  claudeOneShotBindingPathFor, computeClaudeAuthorityIdentityId, crypto,
  currentClockMsForRegistry, ensureSecureRegistryDir, hasExactKeys,
  isCanonicalIsoUtc, isHexDigest64, isIntInRangeNum, isoPlusSecondsForRegistry,
  isoToMsForRegistry, nowIsoForRegistry, publishNoClobber,
  readClaudeAuthorityFence, readRegistryRecord, resolveM7RepoId,
  rootSourceIngressPathFor, testM7Rendezvous,
  // requesterBinding is composed further below -- see its own forward-declared-thunk comment.
  validateRequesterBindingFor: (...args) => requesterBinding.validateRequesterBindingFor(...args),
  validateRootSourceBindingFor, validateRootSourceIngressRecord,
  writeGuardedByClaudeAuthorityAdmission, registryRepoDir,
});
const {
  ROLE_COMMAND_GRANT_SCHEMA, ROLE_COMMAND_GRANT_TTL_SECONDS,
  ROLE_COMMAND_GRANT_KEYS, ROLE_COMMAND_GRANT_AUTHORITY_ENUM,
  roleCommandGrantPathFor, roleCommandGrantConsumedMarkerPathFor,
  mintRoleCommandGrant,
} = roleCommandGrant;
// supervisor-lifecycle-owner.cjs composes here early (no cross-module dependency),
// satisfying createSupervisorReadyTransition/createRoleCapabilityRouting/p2SubjectBundle
// below. cliTerminalize.cjs needs team-ensure.cjs (composed later) yet is itself needed
// here -- broken via a forward-declared thunk, never a require() cycle.
let cliTerminalize;
const supervisorLifecycleOwner = createSupervisorLifecycleOwner({
  path, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace, withRegistryLock,
  hasOnlyAllowedKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, currentClockMsForRegistry,
  isoToMsForRegistry, nowIsoForRegistry, canonicalJSONStringify, sha256String, CANONICAL_ROLES,
  hasExactKeys, actionPathFor, computeCoordinationRootIdFromPath, readRoleBindingState, roleProfileDigestFor,
  supervisorRetainedServiceExpiryFromAction,
});
const {
  SUPERVISOR_LIFECYCLE_OWNER_SCHEMA, SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM,
  SUPERVISOR_LIFECYCLE_OWNER_PHASE_ENUM, SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS,
  isSupervisorPidIdentityShape, supervisorLifecycleTxLockDirFor, supervisorLifecycleOwnerPathFor,
  readSupervisorLifecycleOwnerState, transitionSupervisorLifecycleOwner,
  isSupervisorLifecycleOwnerActionStale, markSupervisorLifecycleOwnerRetained,
  terminalizeSupervisorLifecycleOwnerIfCurrent, supervisorLifecycleTransactionContentionBudgetMs,
} = supervisorLifecycleOwner;
const supervisorReadyTransition = createSupervisorReadyTransition({
  path, process, Buffer, CANONICAL_ROLES, EXECUTION_CLAIM_KEYS, EXECUTION_CLAIM_SCHEMA,
  canonicalJSONStringify, currentClockMsForRegistry, executionClaimPathFor, hasExactKeys,
  isCanonicalIsoUtc, isHexCsprng32, isSupervisorPidIdentityShape, isTestCapability,
  isoToMsForRegistry, markSupervisorLifecycleOwnerRetained, readRegistryRecord,
  readRoleBindingState, realpathOrSelf, registryRepoDir, resolvedNodePath,
  roleProfileDigestFor, sha256String,
  terminalizeSupervisorStartAction: (...args) => cliTerminalize.terminalizeSupervisorStartAction(...args),
  transitionRoleBinding, validateMainOrchestratorBindingFor,
  validateRetainedServiceAuthority, validateSupervisorStartAction,
});
const {
  peekLiveSupervisorExecutionClaim, wasExecutionClaimEverIssuedFor,
  SUPERVISOR_READY_EVIDENCE_KEYS, WORKER_PRESENCE_KEYS, validateSupervisorReadyEvidence,
  SUPERVISOR_BATCH_READY_TEST_CAPABILITY_ENV, currentProcessOwnsSupervisorReadyTransition,
  transitionSupervisorBatchToReady,
} = supervisorReadyTransition;
const roleCapabilityRouting = createRoleCapabilityRouting({
  fs, path, process, ROUTING_DRIVER_ENUM, computeCoordinationRootId, isTestCapability,
  readRegistryRecord, readRoleBindingState, readSupervisorLifecycleOwnerState,
  registryRepoDir, resolvePolicyPair, roleBindingPathFor,
  loadBridge: () => require('./runtime-bridge-codex.cjs'),
  loadClaudeHost: () => require('./runtime-host-claude.cjs'),
  loadProjectContext: () => require('./runtime-project-context.cjs'),
});
const {
  scanRegistryForReadyDriver, hasCurrentClaudeHostCompositionCapability,
  getCapabilityManifest, resolveSupervisorStartability, selectDriverForRole,
  LIFECYCLE_INELIGIBLE_DRIVERS, selectLifecycleEligibleDriverForRole,
} = roleCapabilityRouting;
const diskConsumerRegistration = createDiskConsumerRegistration({
  path, process, crypto, Buffer, ACTION_TTL_CEILING_SECONDS, CANONICAL_ROLES,
  canonicalJSONStringify, currentClockMsForRegistry, hasExactKeys, isCanonicalIsoUtc,
  isHexCsprng32, isHexDigest64, isIntInRangeNum, isTestCapability,
  isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry, readRegistryRecord,
  registryRepoDir, sha256String, writeRegistryRecordReplace,
});
const {
  DISK_CONSUMER_REGISTRATION_SCHEMA, DISK_CONSUMER_REGISTRATION_KEYS,
  diskConsumerRegistrationKeyDigest, diskConsumerRegistrationPathFor,
  registerDiskConsumer, isProcessAlive, validateDiskConsumerRegistrationFor,
  hasRegisteredValidatedDiskConsumer,
} = diskConsumerRegistration;
const claudeId01Scope = createClaudeId01Scope({
  path, computeWorktreeId, discoverPlan, peekSessionGeneration, registryRepoDir,
  resolveSessionGeneration, sha256String,
});
const {
  CLAUDE_ID01_TRACE_SCHEMA,
  CLAUDE_ID01_ATTESTATION_SCHEMA,
  CLAUDE_ID01_CAPABILITY_SCHEMA,
  CLAUDE_ID01_CAPABILITY_KEYS,
  CLAUDE_ID01_TRACE_TTL_SECONDS,
  CLAUDE_ID01_MAX_TOOL_USE_IDS,
  CLAUDE_ID01_MAX_SUBAGENT_START_COUNT,
  CLAUDE_ID01_EVENT_SCHEMA,
  CLAUDE_ID01_EVENTS_SCAN_CAP,
  claudeId01CapabilityLookupKey,
  claudeId01CapabilityPathFor,
  claudeId01CapabilityLockDirFor,
  claudeId01LookupKey,
  claudeId01RecordPathFor,
  claudeId01LockDirFor,
  claudeId01EventsDirFor,
  resolveClaudeId01Scope,
  resolveClaudeId01ScopeReadOnly,
} = claudeId01Scope;

const claudeId01Trace = createClaudeId01Trace({
  ...claudeId01Scope,
  fs, path, crypto, CANONICAL_ROLES, SESSION_GENERATION_KEYS,
  canonicalJSONStringify, currentClockMsForRegistry, hasExactKeys, hasUniqueValues,
  isCanonicalIsoUtc, isHexDigest64, isoPlusSecondsForRegistry, isoToMsForRegistry,
  nowIsoForRegistry, publishNoClobber, readRegistryRecord, registryRepoDir,
  sessionGenerationPathFor, sha256String, withRegistryLock, writeRegistryRecordReplace,
});
const {
  CLAUDE_ID01_LIVE_ACTION_SCAN_CAP,
  findLiveClaudeNativeRoleSpawnActionIds,
  resolveClaudeId01ActionIdForSubagentStart,
  resolveClaudeId01ActionIdForPreToolUse,
  resolveClaudeId01RecordPathForCheck,
  isClaudeId01ProofCompleteRecord,
  CLAUDE_ID01_ATTESTATION_KEYS,
  isClaudeId01AttestationWellFormed,
  buildFreshClaudeId01Trace,
  CLAUDE_ID01_TRACE_KEYS,
  isWellFormedClaudeId01ToolUseIdBucket,
  isClaudeId01RawTraceWellFormed,
  recordClaudeId01Event,
  clearClaudeId01Events,
  deriveClaudeId01StateFromEvents,
  isClaudeId01CapabilityWellFormed,
  checkClaudeId01CapabilityCompleteByGeneration,
  maybePromoteClaudeId01Capability,
  writeClaudeId01SummaryFromEvents,
} = claudeId01Trace;

const claudeId01Startup = createClaudeId01Startup({
  ...claudeId01Scope,
  fs, path, CANONICAL_ROLES, GRANT_KEYS, LIFECYCLE_GRANT_SCHEMA,
  ROLE_SPAWN_EXECUTION_CLAIM_KEYS, ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA,
  actionPathFor, canonicalJSONStringify, computeClaudeAuthorityIdentityId,
  currentClockMsForRegistry, grantConsumedMarkerPathFor, grantPathFor, hasExactKeys,
  isCanonicalIsoUtc, isHexActionId, isHexDigest64, isoToMsForRegistry,
  nowIsoForRegistry, peekSessionGeneration, publishNoClobber, readClaudeAuthorityFence,
  readRegistryRecord, readRoleBindingState, registryRepoDir,
  loadClaudeHost: () => require('./runtime-host-claude.cjs'), roleProfileDigestFor,
  roleSpawnExecutionClaimConsumedMarkerPathFor, sha256String, validateRoleActorBindingFor,
});
const {
  CLAUDE_STARTUP_ACTOR_SCHEMA,
  CLAUDE_STARTUP_READY_PRE_SCHEMA,
  CLAUDE_STARTUP_READY_OUTCOME_SCHEMA,
  CLAUDE_ID01_CAPABILITY_V2_SCHEMA,
  CLAUDE_STARTUP_ACTOR_KEYS,
  CLAUDE_STARTUP_READY_PRE_KEYS,
  CLAUDE_STARTUP_READY_OUTCOME_KEYS,
  CLAUDE_ID01_CAPABILITY_V2_KEYS,
  isNonEmptyBoundedString,
  claudeStartupLookupKeyByDigest,
  claudeStartupActorPathFor,
  claudeStartupReadyPrePathFor,
  claudeStartupReadyOutcomePathFor,
  claudeId01CapabilityV2PathFor,
  claudeId01CapabilityV2PathForDigest,
  isConsumedRoleSpawnClaim,
  readCurrentClaudeSessionEvidence,
  recordClaudeStartupActorObservation,
  recordClaudeStartupReadyPreObservation,
  isClaudeId01CapabilityV2WellFormed,
  recordClaudeStartupReadyOutcome,
  checkClaudeId01ActorStartupProof,
  checkClaudeId01RuntimeCapability,
  checkClaudeId01ProofComplete,
} = claudeId01Startup;
requesterBinding = createRequesterBindingModule({
  path, fs, crypto, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace,
  withRegistryLock, canonicalJSONStringify, resolveSessionGeneration, peekSessionGeneration, sessionGenerationPathFor,
  nowIsoForRegistry, isoPlusSecondsForRegistry, isoToMsForRegistry, currentClockMsForRegistry,
  isCanonicalIsoUtc, isHexActionId, isHexDigest64, isHexCsprng32, hasExactKeys,
  IDENTITY_PROVIDER_ENUM, CANONICAL_ROLES, isIntInRangeNum, sha256String,
  CLAUDE_AUTHORITY_IDENTITY_SCHEMA, resolveM7RepoId, computeClaudeAuthorityIdentityId, readClaudeAuthorityFence,
  classifyClaudeAuthorityForIdentity, checkClaudeAuthorityClassificationAgainstExpected,
  checkClaudeId01ProofComplete, admitClaudeAuthorityOperation, writeGuardedByClaudeAuthorityAdmission,
  testM7Rendezvous,
  REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_KEYS, REQUESTER_BINDING_SCHEMA_V2,
  REQUESTER_BINDING_KEYS_V2, REQUESTER_BINDING_SCAN_CAP,
});
const {
  requesterBindingPathFor, requesterBindingLookupLockDirFor, requesterBindingContentionBudgetMs,
  createRequesterBinding, validateRequesterBindingFor,
} = requesterBinding;

const claudeId01Observations = createClaudeId01Observations({
  ...claudeId01Scope,
  ...claudeId01Trace,
  ...claudeId01Startup,
  fs, path, CANONICAL_ROLES, REQUESTER_BINDING_KEYS, REQUESTER_BINDING_KEYS_V2,
  REQUESTER_BINDING_SCAN_CAP, currentClockMsForRegistry, hasExactKeys,
  isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry,
  readRegistryRecord, registryRepoDir, sha256String, withRegistryLock,
});
const {
  recordClaudeId01SubagentStartObservation,
  recordClaudeId01PreToolUseObservation,
  preflightClaudeId01TraceForSession,
  deleteClaudeId01TraceForSession,
} = claudeId01Observations;

const claudePeerBinding = createClaudePeerBinding({
  ACTION_KIND_ENUM, ACTION_RUNTIME_ENUM, CANONICAL_ROLES, ROLE_ACTOR_BINDING_KEYS,
  ROLE_ACTOR_BINDING_SCHEMA, actionPathFor, canonicalJSONStringify,
  checkClaudeId01ProofComplete, computeClaudeAuthorityIdentityId, computeRepoId,
  computeWorktreeId, currentClockMsForRegistry, discoverPlan, ensureSecureRegistryDir,
  fs, generateActionId, hasExactKeys, isCanonicalIsoUtc, isHexActionId,
  isHexCsprng32, isHexDigest64, isoPlusSecondsForRegistry, isoToMsForRegistry,
  nowIsoForRegistry, path, peekSessionGeneration, publishNoClobber,
  readClaudeAuthorityFence, readRegistryRecord, registryRepoDir,
  roleActorBindingPathFor, sha256String, validateRoleActorBindingFor, withRegistryLock,
});
const {
  CLAUDE_PEER_BINDING_SCHEMA,
  CLAUDE_PEER_BINDING_KEYS,
  claudePeerBindingPathFor,
  validateClaudePeerBindingRecord,
  readClaudePeerBinding,
  CLAUDE_PEER_BINDING_SCAN_CAP,
  findUniqueClaudePeerRoleActorBinding,
  resolveClaudePeerObservedActorAuthority,
  CLAUDE_PEER_EXPECTED_KEYS,
  CLAUDE_PEER_ACTION_KEYS,
  CLAUDE_PEER_SPAWN_PAYLOAD_KEYS,
  CLAUDE_PEER_REBIND_PAYLOAD_KEYS,
  validateClaudePeerExpected,
  scanClaudePeerBindingsForExpected,
  findUniqueLiveClaudePeerAction,
  validateClaudePeerBindingFor,
  findUniqueClaudePeerBindingForTarget,
  ensureClaudePeerBindingForObservedActor,
} = claudePeerBinding;

const claudeResumeRecord = createClaudeResumeRecord({
  CANONICAL_ROLES, computeClaudeAuthorityIdentityId, computeWorktreeId,
  currentClockMsForRegistry, discoverPlan, findUniqueClaudePeerRoleActorBinding,
  fs, hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32,
  isHexDigest64, isoToMsForRegistry, path, peekSessionGeneration,
  readClaudeAuthorityFence, readRegistryRecord, registryRepoDir,
});
const {
  CLAUDE_RESUME_HANDLE_SCHEMA,
  CLAUDE_RESUME_HANDLE_KEYS,
  CLAUDE_RESUME_HANDLE_SCAN_CAP,
  claudeResumeHandlePathFor,
  claudeResumeHandleConsumedMarkerPathFor,
  validateClaudeResumeHandleRecordShape,
  validateClaudeResumeHandleRecord,
  readClaudeResumeHandle,
  isClaudeResumeHandleConsumed,
  findClaudeResumeHandlesForActor,
  resolveClaudeResumeRoleActorScope,
} = claudeResumeRecord;

const claudeResumeLifecycle = createClaudeResumeLifecycle({
  ...claudeResumeRecord,
  canonicalJSONStringify, computeClaudeAuthorityIdentityId, currentClockMsForRegistry,
  ensureSecureRegistryDir, findClaudeResumeHandlesForActor, fs, generateActionId,
  hasExactKeys, isCanonicalIsoUtc, isHexCsprng32, isoPlusSecondsForRegistry,
  isoToMsForRegistry, nowIsoForRegistry, path, publishNoClobber,
  readClaudeAuthorityFence, readRegistryRecord, readRoleBindingState,
  registryRepoDir, resolveClaudeResumeRoleActorScope, roleProfileDigestFor,
  sha256String, transitionRoleBinding, validateClaudePeerExpected,
  validateRoleActorBindingFor, withRegistryLock,
});
const {
  CLAUDE_RESUME_HANDLE_TTL_SECONDS,
  parkClaudeResumeHandleForRoleActor,
  consumeClaudeResumeHandleForObservedActor,
  findUniqueClaudeResumeHandleForTarget,
  findUniqueConsumedClaudeResumeHandleForBusyTarget,
} = claudeResumeLifecycle;




const directRoleHostAdmission = createDirectRoleHostAdmission({
  path, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir, publishNoClobber,
  canonicalJSONStringify, sha256String, isHexActionId, nowIsoForRegistry, withRegistryLock,
  findActionDirect, validateRootSourceBindingFor, admitAndCreateRootSourceBinding,
  recordClaudeStartupActorObservation,
  readRoleBindingState, transitionRoleBinding,
  roleProfileDigestFor, createRoleActorBinding, validateRoleActorBindingFor,
  ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS, validateAndConsumeRoleSpawnExecutionClaim,
});
const { admitDirectRoleHostStartup, directRoleHostAdmissionPathFor } = directRoleHostAdmission;

// mixedReviewVerdictPathFor is a genuine mutual need between root-consult-records.cjs
// and prep-publication-records.cjs -- broken via a forward-declared thunk, never a
// require() cycle (the former's own body never calls back into the latter).
let prepPublicationRecords;
const rootConsultRecords = createRootConsultRecords({
  path, fs, registryRepoDir, readRegistryRecord, hasExactKeys, isHexCsprng32,
  isHexDigest64, isHexActionId, isCanonicalIsoUtc, isoToMsForRegistry, CANONICAL_ROLES,
  Buffer, RESULT_KIND_RE, validateExpectedRecordFields,
  mixedReviewVerdictPathFor: (...args) => prepPublicationRecords.mixedReviewVerdictPathFor(...args),
});
const {
  ROOT_CONSULT_INTENT_SCHEMA, ROOT_CONSULT_INTENT_KEYS, ROOT_CONSULT_RESERVATION_SCHEMA,
  ROOT_CONSULT_RESERVATION_KEYS, ROOT_CONSULT_PUBLISHED_SCHEMA, ROOT_CONSULT_PUBLISHED_KEYS,
  ROOT_CONSULT_COMPLETION_SCHEMA, ROOT_CONSULT_COMPLETION_KEYS, ROOT_CONSULT_SCAN_CAP,
  rootConsultIntentPathFor, rootConsultReservationPathFor, rootConsultPublishedPathFor,
  rootConsultCompletionPathFor, rootConsultLockDirFor, validateRootConsultIntentRecord,
  validateRootConsultReservationRecord, validateRootConsultPublishedRecord,
  validateRootConsultCompletionRecord, readRootConsultIntent, listRootConsultIntentsForActor,
  listPendingMixedReviewIntentsForRole, findRootConsultIntentByRequestId,
  MIXED_REVIEW_SUBJECT_MAX_BYTES,
} = rootConsultRecords;

const p2SubjectBundle = createP2SubjectBundle({
  path, rc, hasExactKeys, isHexCsprng32, isHexDigest64, isCanonicalIsoUtc, canonicalJSONStringify,
  discoverPlan, computeRepoId, computeWorktreeId, gitRevParse, findLiveMainOrchestratorBindingForScope,
  computeCoordinationRootId, readSupervisorLifecycleOwnerState, currentClockMsForRegistry,
  readRoleBindingState, roleProfileDigestFor, nowIsoForRegistry, registryRepoDir, publishNoClobber,
});
const {
  P2_SUBJECT_BUNDLE_SEED_SCHEMA, P2_SUBJECT_BUNDLE_SEED_ROLES, P2_SUBJECT_BUNDLE_SEED_CAPS,
  P2_SUBJECT_BUNDLE_SEED_KEYS, P2_SEAL_REQUIRED_ROLES, isSafeP2SubjectPath,
  validateP2SubjectBundleSeedRecord, sealP2SubjectBundleInput,
} = p2SubjectBundle;

prepPublicationRecords = createPrepPublicationRecords({
  path, registryRepoDir, isHexCsprng32, isHexDigest64, isCanonicalIsoUtc,
  P2_SUBJECT_BUNDLE_SEED_ROLES, isSafeP2SubjectPath,
});
const {
  PREP_PUBLICATION_INTENT_SCHEMA, PREP_PUBLICATION_INTENT_KEYS, PREP_PUBLICATION_INTENT_STATES,
  PREP_PUBLICATION_INTENT_CORRELATED_FIELDS, validatePrepPublicationIntentRecord,
  PREP_PUBLICATION_RECEIPT_SCHEMA, PREP_PUBLICATION_RECEIPT_KEYS,
  PREP_PUBLICATION_RECEIPT_CORRELATED_FIELDS, validatePrepPublicationReceiptRecord,
  prepPublicationIntentPathFor, prepPublicationReceiptPathFor, rootConsultReviewPathFor,
  mixedReviewVerdictPathFor, mixedReviewSubjectPathFor, prepPublicationPredecessorRole,
} = prepPublicationRecords;

const mixedReviewRecords = createMixedReviewRecords({
  Buffer, isHexCsprng32, isHexDigest64, isCanonicalIsoUtc, isSafeP2SubjectPath, hasExactKeys,
  sha256String, canonicalJSONStringify, validateRootConsultIntentRecord, readRootConsultIntent,
  path, discoverPlan, computeWorktreeId, readRegistryRecord, mixedReviewSubjectPathFor,
  mixedReviewVerdictPathFor, readRoleBindingState, roleProfileDigestFor, retainedSupervisorBridgeApi,
  nowIsoForRegistry,
});
const {
  ROOT_CONSULT_REVIEW_SCHEMA, ROOT_CONSULT_REVIEW_KEYS, ROOT_CONSULT_REVIEW_DECISIONS,
  ROOT_CONSULT_REVIEW_CORRELATED_FIELDS, validateRootConsultReviewRecord,
  MIXED_REVIEW_VERDICT_SCHEMA, MIXED_REVIEW_VERDICT_KEYS, MIXED_REVIEW_VERDICT_DECISIONS,
  MIXED_REVIEW_VERDICT_CORRELATED_FIELDS, validateMixedReviewVerdictRecord,
  MIXED_REVIEW_READBACK_SCHEMA, MIXED_REVIEW_READBACK_KEYS, buildMixedReviewReadbackReceipt,
  readMixedReviewReadback,
} = mixedReviewRecords;

s16ContextResolution = createS16ContextResolution({
  path, OPERATION_KEYS, validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId,
  discoverPlan, resolvePolicyPair, computeWorktreeId, peekSessionGeneration,
  currentClockMsForRegistry, isoToMsForRegistry, computeRepoId, coordinationRootPathFor,
  retainedSupervisorBridgeApi, roleProfileDigestFor, isHexCsprng32, readRoleBindingState, hasExactKeys,
});
const {
  makeOperation, s16CoordinationRelativeRef, s16ResolveMainContext,
  s16ResolveRetainedPair, s16ResolveMixedReviewPair,
} = s16ContextResolution;

// Ordered so every module composes strictly after the sibling exports its own
// deps require (no thunks needed here -- that pair lives further up).
const teamEnsure = createTeamEnsure({
  path, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace, withRegistryLock,
  canonicalJSONStringify, nowIsoForRegistry, hasExactKeys, isCanonicalIsoUtc, generateActionId,
  buildTeamEnsurePayload, mintRoleLifecycleAction, roleProfileDigestFor, roleBindingPathFor,
  readRoleBindingState, CANONICAL_ROLES, actionPathFor, computeActionTtlSeconds, futureIsoForRegistry,
  isFakeExecutorCapability,
});
const {
  TEAM_ENSURE_STATE_ENUM, teamEnsureMarkerPathFor, readTeamEnsureState, ensureTeamEnsureAction,
  registerTeamEnsureSuccess, findRoleBindingsDependentOnTeamEnsure, findExistingSupervisorBinding,
} = teamEnsure;
cliTerminalize = createCliTerminalize({
  path, fs, registryRepoDir, wasExecutionClaimEverIssuedFor, withRegistryLock, roleProfileDigestFor,
  readRoleBindingState, transitionRoleBinding, computeCoordinationRootIdFromPath,
  terminalizeSupervisorLifecycleOwnerIfCurrent, teamEnsureMarkerPathFor, readTeamEnsureState,
  nowIsoForRegistry, writeRegistryRecordReplace, canonicalJSONStringify, findRoleBindingsDependentOnTeamEnsure,
  ensureSecureRegistryDir, publishNoClobber, readLiveSessionGenerationById, roleBindingPathFor, isHexActionId,
  readRegistryRecord, actionPathFor, ACTION_KIND_ENUM, ACTION_RUNTIME_ENUM, resolveHostOperationForAction,
  validateRootSourceAction, currentClockMsForRegistry, isoToMsForRegistry,
});
const {
  terminalizeSupervisorStartAction, terminalizeActionAsFailed, interpretedActionMarkerPathFor,
  consumeInterpreterActionOnce, sessionGenerationIsLiveById, findAnyRoleBindingPendingAction,
  interpretRoleLifecycleAction,
} = cliTerminalize;
const resumeCheckpoint = createResumeCheckpoint({
  path, fs, canonicalJSONStringify, sha256String, isCanonicalIsoUtc, isoToMsForRegistry,
  currentClockMsForRegistry, nowIsoForRegistry, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace,
  hasExactKeys, roleProfileDigestFor, readRoleBindingState, transitionRoleBinding,
  transitionRoleBindingAtomicViaWaypoint, findUniqueClaudeResumeHandleForTarget,
  consumeClaudeResumeHandleForObservedActor, parkClaudeResumeHandleForRoleActor,
  CLAUDE_RESUME_HANDLE_TTL_SECONDS, computeClaudeAuthorityIdentityId, readClaudeAuthorityFence,
  makeOperation, roleBindingPathFor,
  CLAUDE_RESUME_HANDLE_KEYS, CLAUDE_RESUME_HANDLE_SCAN_CAP, CLAUDE_RESUME_HANDLE_SCHEMA,
  MAX_ACTION_REPO_SCAN_ENTRIES, actionForEnvelope, actionPathFor, buildRoleNotifyPayload,
  claudeResumeHandlePathFor, computeActionTtlSeconds, computeRepoId, futureIsoForRegistry, generateActionId,
  interpretedActionMarkerPathFor, isClaudeResumeHandleConsumed, mintRoleLifecycleAction, readClaudeResumeHandle,
  validateClaudeResumeHandleRecord,
});
const {
  roleBindingForEnvelope, respawnBudgetExceeded, legacyResumeCheckpointMessage, resumeCheckpointMessage,
  findLiveResumeHandlesForLifecycleRole, findResumeCheckpointActionForRole,
  executeResumeCheckpointEnsure, quarantineViaRehydrating, RESUME_CHECKPOINT_REF_RE,
} = resumeCheckpoint;
const supervisorBatchMint = createSupervisorBatchMint({
  path, fs, crypto, registryRepoDir, canonicalJSONStringify, sha256String, currentClockMsForRegistry,
  isoToMsForRegistry, nowIsoForRegistry, futureIsoForRegistry, computeCoordinationRootIdFromPath,
  withRegistryLock, supervisorLifecycleTxLockDirFor, readSupervisorLifecycleOwnerState,
  isSupervisorLifecycleOwnerActionStale, terminalizeSupervisorLifecycleOwnerIfCurrent,
  markSupervisorLifecycleOwnerRetained, supervisorLifecycleTransactionContentionBudgetMs,
  generateActionId, mintRoleLifecycleAction, actionForEnvelope, buildSupervisorStartPayload,
  effectiveActionTtlSeconds, transitionRoleBinding, transitionRoleBindingAtomicViaWaypoint,
  roleBindingForEnvelope, SUPERVISOR_LIFECYCLE_OWNER_SCHEMA, actionPathFor, buildRoleSpawnPayload,
  claudeReadyBootstrapMessageFor, computeCoordinationRootId, computeRepoId, coordinationRootPathFor,
  ensureSecureRegistryDir, hasRegisteredValidatedDiskConsumer, isCanonicalIsoUtc, isTestCapability,
  publishNoClobber, readLiveSessionGenerationById, readRegistryRecord, resolvedNodePath,
  selectLifecycleEligibleDriverForRole, supervisorLifecycleOwnerPathFor,
  supervisorRetainedServiceExpiryFromAction, transitionSupervisorLifecycleOwner, writeRegistryRecordReplace,
});
const {
  mintSupervisorBatchUnderTransaction, mintBatchedSupervisorStartAction, spawnOrRehydrateSingleRole,
} = supervisorBatchMint;
const p2Materialization = createP2Materialization({
  path, fs, registryRepoDir, readRegistryRecord, hasExactKeys, canonicalJSONStringify, sha256String,
  isSafeP2SubjectPath, gitRevParse, computeCoordinationRootIdFromPath, s16ConsultationApi,
  P2_SUBJECT_BUNDLE_SEED_ROLES, P2_SUBJECT_BUNDLE_SEED_SCHEMA, P2_SUBJECT_BUNDLE_SEED_CAPS,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE, publishNoClobber, realpathOrSelf, s16CoordinationRelativeRef,
  sha256Buffer, sha256File, validateP2SubjectBundleSeedRecord,
});
const {
  s16MaterializeCommonArtifacts, buildP2SubjectBundleMaterialization,
  s16MaterializeArchitectSubjectBundle, s16ReadOptionalValidated,
} = p2Materialization;
const prepPublicationReserve = createPrepPublicationReserve({
  path, registryRepoDir, readRegistryRecord, publishNoClobber, canonicalJSONStringify, sha256String,
  sha256Buffer, gitRevParse, classifyDurableRead, DURABLE_PRESENT, isSafeP2SubjectPath, isHexCsprng32,
  currentClockMsForRegistry, isoToMsForRegistry, nowIsoForRegistry, futureIsoForRegistry, fs, crypto,
  discoverPlan, computeRepoId, computeWorktreeId, resolvePolicyPair, retainedSupervisorBridgeApi,
  roleProfileDigestFor, readRoleBindingState, validateRootConsultIntentRecord,
  validateRootConsultCompletionRecord, validateRootConsultReviewRecord, validatePrepPublicationIntentRecord,
  validatePrepPublicationReceiptRecord, PREP_PUBLICATION_INTENT_SCHEMA, P2_SUBJECT_BUNDLE_SEED_ROLES,
  rootConsultIntentPathFor, rootConsultCompletionPathFor, rootConsultReviewPathFor,
  prepPublicationIntentPathFor, prepPublicationReceiptPathFor, prepPublicationPredecessorRole,
  findLiveMainOrchestratorBindingForScope, mintSupervisorExecutionClaim, registerTeamEnsureSuccess,
  actionPathFor,
});
const {
  fakeHostExecutorExecute, prepPublicationPredecessorQualifies, reservePrepPublicationIntent,
} = prepPublicationReserve;
const prepPublicationGrammar = createPrepPublicationGrammar({
  isCanonicalIsoUtc, hasExactKeys, canonicalJSONStringify, sha256Buffer, registryRepoDir,
  readRegistryRecord, writeRegistryRecordReplace, path, crypto, isHexDigest64, isSafeP2SubjectPath,
  nowIsoForRegistry, PREP_PUBLICATION_INTENT_CORRELATED_FIELDS,
  PREP_PUBLICATION_INTENT_STATES, PREP_PUBLICATION_INTENT_KEYS, PREP_PUBLICATION_RECEIPT_SCHEMA,
  PREP_PUBLICATION_RECEIPT_KEYS, validatePrepPublicationIntentRecord, validatePrepPublicationReceiptRecord,
  prepPublicationIntentPathFor, prepPublicationReceiptPathFor,
});
const {
  validatePrepPublicationGrammar, prepPublicationIntentExpectedFromSelf,
  completePrepPublicationIntent, conflictPrepPublicationIntent,
} = prepPublicationGrammar;
const cliConsultHandlers = createCliConsultHandlers({
  path, fs, crypto, Buffer, canonicalJSONStringify, sha256String, gitRevParse, publishNoClobber,
  currentClockMsForRegistry, isoToMsForRegistry, nowIsoForRegistry, registryRepoDir,
  SUBCOMMAND_SPEC, parseSubcommandArgv, RC, usageError, invalidError, unavailableError, emitAndExit, makeResult, makeOperation,
  reportRetainedPairRejection, decodeRootConsultIntent, decodeMixedReviewIntent,
  s16ResolveMainContext, s16ResolveRetainedPair, s16ResolveMixedReviewPair, s16MaterializeArchitectSubjectBundle,
  s16ConsultationApi, s16ReadOptionalValidated,
  computeCoordinationRootIdFromPath, ROOT_CONSULT_INTENT_SCHEMA, validateRootConsultIntentRecord,
  rootConsultIntentPathFor, rootConsultReservationPathFor, rootConsultPublishedPathFor, rootConsultCompletionPathFor,
  validateRootConsultReservationRecord, validateRootConsultPublishedRecord, validateRootConsultCompletionRecord,
  readRootConsultIntent, mixedReviewSubjectPathFor, MIXED_REVIEW_SUBJECT_MAX_BYTES,
});
const {
  handleConsultRoot, handleMixedReviewRequest, handleConsultRootStatus,
} = cliConsultHandlers;
const cliRootSourceHandlers = createCliRootSourceHandlers({
  path, fs, Buffer, canonicalJSONStringify, sha256String, registryRepoDir, readRegistryRecord,
  SUBCOMMAND_SPEC, parseSubcommandArgv, RC, CANONICAL_ROLES, usageError, invalidError, unavailableError, emitAndExit, makeResult,
  makeOperation, s16ResolveMainContext, s16MaterializeCommonArtifacts, decodeRootSourceIntent,
  readRoleBindingState, roleProfileDigestFor, findUniqueClaudeResumeHandleForTarget,
  findUniqueConsumedClaudeResumeHandleForBusyTarget, retainedSupervisorBridgeApi,
  generateActionId, renderPosixDirect, resolvedNodePath, ROOT_SOURCE_BOOTSTRAP_FINAL_LINE,
  effectiveActionTtlSeconds, mintRoleLifecycleAction, safeExpiryIsoForRegistry, actionForEnvelope,
  validateRootSourceAction, actionPathFor, findRootSourceBindingsByAction, rootSourceIngressPathFor,
  hasExactKeys, ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_BINDING_SCHEMA_V2, computeClaudeAuthorityIdentityId,
  readClaudeAuthorityFence, validateRootSourceIngressRecord, s16ConsultationApi, currentClockMsForRegistry,
  isoToMsForRegistry, resolvePolicyPair, validateAndConsumeLifecycleCommandGrant, discoverPlan,
  computeWorktreeId,
});
const {
  handleRootSource, handleRootSourceStatus, handleProbe, handleStatus,
} = cliRootSourceHandlers;
const cliNotifyHandler = createCliNotifyHandler({
  path, fs, SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, invalidError, unavailableError, emitAndExit,
  makeResult, RC, CANONICAL_ROLES, resolvePolicyPair, sha256File, sha256String,
  validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId, discoverPlan, computeWorktreeId,
  roleProfileDigestFor, readRoleBindingState, canonicalJSONStringify, buildRoleNotifyPayload, generateActionId,
  computeActionTtlSeconds, futureIsoForRegistry, mintRoleLifecycleAction, computeRepoId, actionForEnvelope,
});
const { handleNotify, classifyIngestionNotifyArtifactSafely, validateIngestionResultForSafely } = cliNotifyHandler;
const cliActionReadyHandlers = createCliActionReadyHandlers({
  SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, isHexActionId, findActionAcrossRepos, invalidError,
  sha256String, validateAndConsumeLifecycleCommandGrant, peekSessionGeneration, terminalizeActionAsFailed,
  unavailableError, roleProfileDigestFor, readRoleBindingState, currentClockMsForRegistry, isoToMsForRegistry,
  transitionRoleBinding, roleBindingForEnvelope, emitAndExit, makeResult, RC, isIntInRange, CANONICAL_ROLES,
});
const {
  handleActionFailed, handleReady, extractRepeatedFlagValues, handleWaitReady,
} = cliActionReadyHandlers;
const cliRotateStopHandlers = createCliRotateStopHandlers({
  path, SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, CANONICAL_ROLES, invalidError, resolvePolicyPair,
  validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId, discoverPlan, computeWorktreeId,
  roleProfileDigestFor, readRoleBindingState, unavailableError, transitionRoleBinding, respawnBudgetExceeded,
  quarantineViaRehydrating, getCapabilityManifest, spawnOrRehydrateSingleRole, emitAndExit, makeResult, RC,
  roleBindingForEnvelope, actionForEnvelope, sha256String, buildSupervisorStopOwnedPayload,
  buildRoleStopOwnedPayload, generateActionId, canonicalJSONStringify, computeActionTtlSeconds,
  futureIsoForRegistry, mintRoleLifecycleAction, computeRepoId,
});
const { handleRotate, handleStopOwned } = cliRotateStopHandlers;
const retainedSupervisorReconciliation = createRetainedSupervisorReconciliation({
  retainedSupervisorBridgeApi, computeRepoId, computeCoordinationRootId,
  readSupervisorLifecycleOwnerState, currentClockMsForRegistry, isoToMsForRegistry,
  readRegistryRecord, actionPathFor, terminalizeSupervisorStartAction,
});
const { codexAppServerStartupEligible, reconcileRetainedSupervisorForEnsure } = retainedSupervisorReconciliation;

const ensureHandler = createEnsureHandler({
  path, SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, invalidError, unavailableError, emitAndExit,
  makeResult, RC, hasUniqueValues, CANONICAL_ROLES, resolvePolicyPair, RESUME_CHECKPOINT_REF_RE,
  sha256String, validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId, discoverPlan,
  computeWorktreeId, executeResumeCheckpointEnsure, reconcileRetainedSupervisorForEnsure,
  getCapabilityManifest, roleProfileDigestFor, readRoleBindingState, retainedSupervisorBridgeApi,
  readRegistryRecord, actionPathFor, isoToMsForRegistry, currentClockMsForRegistry, transitionRoleBinding,
  resolveHostOperationForAction, actionForEnvelope, respawnBudgetExceeded, quarantineViaRehydrating,
  isTestCapability, hasRegisteredValidatedDiskConsumer, codexAppServerStartupEligible,
  resolveSupervisorStartability, selectLifecycleEligibleDriverForRole, transitionRoleBindingAtomicViaWaypoint,
  roleBindingForEnvelope, mintSupervisorBatchUnderTransaction, computeRepoId, generateActionId,
  buildRoleSpawnPayload, claudeReadyBootstrapMessageFor, effectiveActionTtlSeconds, futureIsoForRegistry,
  mintRoleLifecycleAction, canonicalJSONStringify,
});
const { handleEnsure } = ensureHandler;

// ── CLI entry point ──────────────────────────────────────────────────────────────

const cliDispatch = createCliDispatch({
  usageError, makeResult, RC, emitAndExit,
  handleProbe, handleEnsure, handleNotify, handleActionFailed, handleReady, handleWaitReady,
  handleStatus, handleConsultRoot, handleMixedReviewRequest, handleConsultRootStatus,
  handleRootSource, handleRootSourceStatus, handleRotate, handleStopOwned,
});
const { HANDLERS, main } = cliDispatch;
const managedLifecycleGrant = createManagedLifecycleGrant({
  path, Buffer, HANDLERS, isWellFormedGrantRole, discoverPlan, computeWorktreeId, sha256String,
  registryRepoDir, readRegistryRecord, grantPathFor, grantConsumedMarkerPathFor,
  getOrCreateMainOrchestratorBindingForSession, mintLifecycleCommandGrant, writeRegistryRecordReplace,
  canonicalJSONStringify,
});
const { resolveOrMintManagedLifecycleGrant } = managedLifecycleGrant;


module.exports = {
  renderPosixDirect,
  parsePosixDirect,
  resolveOrMintManagedLifecycleGrant,
  claudeReadyBootstrapMessageFor,
  makeResult,
  resolvePolicyPair,
  isValidPolicy,
  isValidPolicyV2,
  projectPolicyV2ToV1,
  isValidRouting,
  CANONICAL_ROLES,
  STATUS_ENUM,
  DETAIL_ENUM,
  // R131 P2 GREEN-A1: subject-bundle seed schema PATH/SEED/MAT seams + request-birth role-bound materializer selector.
  isSafeP2SubjectPath,
  validateP2SubjectBundleSeedRecord,
  sealP2SubjectBundleInput,
  buildP2SubjectBundleMaterialization,
  s16MaterializeArchitectSubjectBundle,
  // P5 U2: retained-pair resolver, reused by runtime-bridge-codex.cjs's executeMixedReviewRequest.
  s16ResolveRetainedPair,
  // P5 U2 live-wiring: unconditional production exports (not __testOnly-gated) -- handleMixedReviewRequest and runtime-bridge-codex.cjs's poll loop both call these in normal operation.
  s16ResolveMixedReviewPair,
  listPendingMixedReviewIntentsForRole,
  mixedReviewSubjectPathFor,
  // P5 U2 live-wiring: context-provider-gate.js's LIFECYCLE_SUBCOMMAND_SCOPE_RESOLVERS calls this in production, never only via the __testOnly alias.
  decodeMixedReviewIntent,
  // R131 P2 GREEN-A2a: generic PREP-binding record validators (review/intent/receipt).
  validateRootConsultReviewRecord,
  // P5 U2: unconditional production export -- executeMixedReviewRequest calls this outside tests too; also aliased below as __testOnlyValidateMixedReviewVerdictRecord for a stable test-facing name.
  validateMixedReviewVerdictRecord,
  buildMixedReviewReadbackReceipt,
  readMixedReviewReadback,
  validatePrepPublicationIntentRecord,
  validatePrepPublicationReceiptRecord,
  prepPublicationIntentPathFor,
  prepPublicationReceiptPathFor,
  rootConsultReviewPathFor,
  mixedReviewVerdictPathFor,
  prepPublicationPredecessorRole,
  reservePrepPublicationIntent,
  // R131 P2 GREEN-A2c: exact PREP-publication verdict grammar parser.
  validatePrepPublicationGrammar,
  // R131 P2 GREEN-A2d: completion/conflict transition seams.
  completePrepPublicationIntent,
  conflictPrepPublicationIntent,
  // WP3 registry/identity/session/binding/grant internals, exported for direct node:test coverage (bats drives the CLI envelope; unit tests drive internals directly).
  computePrincipalId,
  computeRepoId,
  computeWorktreeId,
  coordinationRootPathFor,
  computeCoordinationRootId,
  computeCoordinationRootIdFromPath,
  discoverPlan,
  roleProfileDigestFor,
  resolveCanonicalRoleProfile,
  registryBaseDir,
  registryRepoDir,
  ensureSecureRegistryDir,
  writeRegistryRecordReplace,
  publishNoClobber,
  readRegistryRecord,
  classifyIngestionNotifyArtifactSafely,
  validateIngestionResultForSafely,
  withRegistryLock,
  getRuntimeIdentity,
  resolveSessionGeneration,
peekSessionGeneration,
  readLiveSessionGenerationById,
isCanonicalIsoUtc,
  isHexActionId,
  isHexDigest64,
  sessionGenerationPathFor,
  createMainOrchestratorBinding,
  rebindMainOrchestratorBindingForNewPlan,
  mainOrchestratorBindingPathFor,
  findLiveMainOrchestratorBindingForScope,
  hasLiveMainOrchestratorBindingForScope,
  createRoleActorBinding,
  validateRoleActorBindingFor,
  roleActorBindingPathFor,
  mintLifecycleCommandGrant,
  validateAndConsumeLifecycleCommandGrant,
  grantPathFor,
  grantConsumedMarkerPathFor,
  // M7/WP4: RequesterBinding/v1 + role-command-grant/v1, mint side only -- consume side lives in runtime-consultation.cjs (its own local primitive duplicate; see that file for why it cannot require() this module).
  REQUESTER_BINDING_SCHEMA,
  REQUESTER_BINDING_KEYS,
  REQUESTER_BINDING_SCAN_CAP,
  requesterBindingPathFor,
  createRequesterBinding,
  validateRequesterBindingFor,
  ROOT_SOURCE_RESERVATION_SCHEMA,
  ROOT_SOURCE_BINDING_SCHEMA,
  ROOT_SOURCE_INGRESS_SCHEMA,
  ROOT_SOURCE_RETIREMENT_SCHEMA,
  rootSourceReservationPathFor,
  rootSourceBindingPathFor,
  rootSourceIngressPathFor,
  rootSourceRetirementPathFor,
  rootSourceLockDirFor,
  validateRootSourceAction,
  decodeRootSourceBootstrapIntentForBinding,
  validateRootSourceReservationRecord,
  mintRootSourceReservation,
  validateAndConsumeRootSourceReservation,
  createRootSourceBinding,
admitAndCreateRootSourceBinding,
  validateRootSourceBindingRecord,
  validateRootSourceBindingFor,
  validateRootSourceIngressRecord,
  validateRootSourceRetirementRecord,
  findRootSourceBindingsByAction,
  // M6/M7 point B: bounded fail-closed root-source provenance lookup by ROOT request_id, reused by runtime-consultation.cjs's resolveRootEvidenceAuthority.
  findRootSourceProvenanceForRequestId,
  // M7 defect 9: the three per-family root-source scanners once exported here are removed -- every caller now resolves root-source authority through the one canonical cross-family classifier, classifyClaudeAuthorityForIdentity.
  preflightClaudeId01TraceForSession,
  findLiveRootSourceActionsForRole,
  findLiveRootSourceReservationsForRole,
  publishRootIngress,
  decodeRootConsultIntent,
  decodeRootSourceIntent,
  rootConsultIntentPathFor,
  rootConsultReservationPathFor,
  rootConsultPublishedPathFor,
  rootConsultCompletionPathFor,
  rootConsultLockDirFor,
  validateRootConsultIntentRecord,
  validateRootConsultReservationRecord,
  validateRootConsultPublishedRecord,
  validateRootConsultCompletionRecord,
  readRootConsultIntent,
  listRootConsultIntentsForActor,
  findRootConsultIntentByRequestId,
  // M6+M7 Group 1: CLAUDE-ID-01 full bounded-proof gate -- real-observation recorders (SubagentStart/PreToolUse/SubagentStop) plus the read-only gate query.
  CLAUDE_ID01_TRACE_SCHEMA,
  CLAUDE_ID01_ATTESTATION_SCHEMA,
  CLAUDE_ID01_CAPABILITY_SCHEMA,
  claudeId01RecordPathFor,
  claudeId01CapabilityPathFor,
  recordClaudeId01SubagentStartObservation,
  recordClaudeId01PreToolUseObservation,
  recordClaudeStartupActorObservation,
  recordClaudeStartupReadyPreObservation,
  recordClaudeStartupReadyOutcome,
  deleteClaudeId01TraceForSession,
  checkClaudeId01ProofComplete,
  checkClaudeId01RuntimeCapability,
  CLAUDE_ID01_CAPABILITY_V2_SCHEMA,
  CLAUDE_PEER_BINDING_SCHEMA,
  CLAUDE_PEER_BINDING_KEYS,
  claudePeerBindingPathFor,
  validateClaudePeerBindingRecord,
  readClaudePeerBinding,
  resolveClaudePeerObservedActorAuthority,
  ensureClaudePeerBindingForObservedActor,
  validateClaudePeerBindingFor,
  findUniqueClaudePeerBindingForTarget,
  // P4 Windows native-Claude persistence: runtime/claude-resume-handle/v1 -- bootstrap park/consume pair plus dispatch-side finder.
  CLAUDE_RESUME_HANDLE_SCHEMA,
  CLAUDE_RESUME_HANDLE_KEYS,
  claudeResumeHandlePathFor,
  parkClaudeResumeHandleForRoleActor,
  consumeClaudeResumeHandleForObservedActor,
  findUniqueClaudeResumeHandleForTarget,
  findUniqueConsumedClaudeResumeHandleForBusyTarget,
  // Section C parity (item 4): the one closed-shape/range/chronology validator for a completed attestation, lazily required by runtime-consultation.cjs's isClaudeId01AttestationWellFormedLocal instead of a second, drifting copy.
  isClaudeId01AttestationWellFormed,
  ROLE_COMMAND_GRANT_SCHEMA,
  ROLE_COMMAND_GRANT_TTL_SECONDS,
  ROLE_COMMAND_GRANT_KEYS,
  roleCommandGrantPathFor,
  roleCommandGrantConsumedMarkerPathFor,
  mintRoleCommandGrant,
  // M7 (PLAN.md §15d): ClaudeOneShotBinding/v1 create/validate pair. Hook-side correlation/mint, target-gate consumption, and all four retirement triggers are wired; claude-agent's unavailability is a WP3 driver-selection gap, testable via checkClaudeAgentCapabilityAvailable below.
  CLAUDE_ONE_SHOT_BINDING_SCHEMA,
  CLAUDE_ONE_SHOT_BINDING_KEYS,
  claudeOneShotBindingPathFor,
  createClaudeOneShotBinding,
  validateClaudeOneShotBindingFor,
  // WP3 state machine / capability / action generation internals.
  ROLE_BINDING_STATE_ENUM,
  ROLE_BINDING_TRANSITIONS,
  roleBindingPathFor,
  readRoleBindingState,
  transitionRoleBinding,
  transitionRoleBindingUnchecked,
  transitionRoleBindingAtomicViaWaypoint,
  validateRoleBindingRecordForScope,
  getCapabilityManifest,
  resolveSupervisorStartability,
  selectDriverForRole,
  resolveHostOperationForAction,
  interpretRoleLifecycleAction,
  terminalizeActionAsFailed,
  ACTION_KIND_ENUM,
  generateActionId,
  mintRoleLifecycleAction,
  actionForEnvelope,
  actionPathFor,
  findActionAcrossRepos,
  findActionDirect,
  MAX_ACTION_REPO_SCAN_ENTRIES,
  mintBatchedSupervisorStartAction,
  spawnOrRehydrateSingleRole,
  teamEnsureMarkerPathFor,
  readTeamEnsureState,
  ensureTeamEnsureAction,
  buildTeamEnsurePayload,
  buildRoleSpawnPayload,
  buildRoleRebindClaudeNativePayload,
  buildRoleRebindHostProcessPayload,
  buildRoleNotifyPayload,
  buildRoleStopOwnedPayload,
  buildSupervisorStartPayload,
  validateSupervisorStartAction,
  buildSupervisorStopOwnedPayload,
  resolvedNodePath,
  computeActionTtlSeconds,
  effectiveActionTtlSeconds,
  fakeHostExecutorExecute,
  // WP3 item C: SupervisorExecutionClaim/v1 -- the distinct third authority `session-run` must validate before any other registry write.
  EXECUTION_CLAIM_SCHEMA,
  EXECUTION_CLAIM_KEYS,
  executionClaimPathFor,
  mintSupervisorExecutionClaim,
  validateAndConsumeExecutionClaim,
  validateMainOrchestratorBindingFor,
  validateRetainedServiceAuthority,
  peekLiveSupervisorExecutionClaim,
  // M6 GROUP A: the real, ungated, host-private entrypoint context-provider-gate.js calls -- resolves its own MainOrchestratorBinding from the current session/environment and delegates to the same core body mintSupervisorExecutionClaim itself also delegates to.
  findLiveMainOrchestratorBindingForSession,
  getOrCreateMainOrchestratorBindingForSession,
  mintSupervisorExecutionClaimForSession,
  // M6 GROUP B: `session-run`'s exclusive admission point for a supervisor-start action's complete, presence-corroborated role set.
  transitionSupervisorBatchToReady,
  extractRepeatedFlagValues,
  // Third HOLD, Part B: RoleSpawnExecutionClaim/v2 -- the atomic reserve/commit claim agent-spawn-execution-gate.js mints and subagent-start-context-bundle.js confirms/consumes.
  ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA,
  ROLE_SPAWN_EXECUTION_CLAIM_KEYS,
  canonicalNativeAgentInputForAction,
  renderCanonicalNativeAgentInput,
  roleSpawnExecutionClaimPathFor,
  mintRoleSpawnExecutionClaim,
  validateAndConsumeRoleSpawnExecutionClaim,
  admitDirectRoleHostStartup,
  directRoleHostAdmissionPathFor,
  // M7 Part C: ClaudeAgentSpawnReservation/v1 -- the consultation-dispatch analog of RoleSpawnExecutionClaim/v1, plus ClaudeOneShotBinding/v1's own retirement primitive.
  CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA,
  CLAUDE_AGENT_SPAWN_RESERVATION_KEYS,
  claudeAgentSpawnReservationPathFor,
  claudeAgentSpawnReservationConsumedMarkerPathFor,
  claudeAgentBootstrapMessageFor,
  mintClaudeAgentSpawnReservation,
  validateAndConsumeClaudeAgentSpawnReservation,
  consumeClaudeAgentSpawnReservationAndCreateOneShotBinding,
  claudeOneShotBindingRetiredMarkerPathFor,
  CLAUDE_ONE_SHOT_BINDING_RETIREMENT_REASON_ENUM,
  // M7 defect 9: the per-family one-shot scanner once exported here is removed -- every caller now resolves one-shot authority through the one canonical cross-family classifier, classifyClaudeAuthorityForIdentity.
  checkClaudeAgentCapabilityAvailable,
  hasExactKeys,
hasOnlyAllowedKeys,
ROLE_BINDING_ALLOWED_KEYS,
  // WP3 item C: singleton supervisor enforcement, team-ensure SUCCEEDED gate and dependent invalidation.
  findExistingSupervisorBinding,
  TEAM_ENSURE_STATE_ENUM,
  registerTeamEnsureSuccess,
  findRoleBindingsDependentOnTeamEnsure,
  // WP3 item C R2/R3: SupervisorLifecycleTransaction -- coordination_root_id-anchored, cross-generation singleton with an explicit recoverable owner/intent state machine.
  SUPERVISOR_LIFECYCLE_OWNER_SCHEMA,
  SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM,
  SUPERVISOR_LIFECYCLE_OWNER_PHASE_ENUM,
  SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS,
  supervisorLifecycleTxLockDirFor,
  supervisorLifecycleOwnerPathFor,
  readSupervisorLifecycleOwnerState,
  transitionSupervisorLifecycleOwner,
  markSupervisorLifecycleOwnerRetained,
  isSupervisorLifecycleOwnerActionStale,
  terminalizeSupervisorLifecycleOwnerIfCurrent,
  mintSupervisorBatchUnderTransaction,
  terminalizeSupervisorStartAction,
  // M6 Block C + M7/WP4: DiskConsumerRegistration/v1 -- real production registration/query primitive hasRegisteredValidatedDiskConsumer now consults, at both spawnOrRehydrateSingleRole's and handleEnsure's noop-eligibility call sites.
  registerDiskConsumer,
  diskConsumerRegistrationPathFor,
  hasRegisteredValidatedDiskConsumer,
  // M7 section 6: the one canonical cross-family classifier.
  classifyClaudeAuthorityForIdentity,
  // M7 section 7: admission linearization -- consumed by Fase 4's validateAndConsumeRoleCommandGrantForCommand (consultation.cjs), which consumes its own 'consume-grant' capability before the existing one-use grant marker.
  admitClaudeAuthorityOperation,
  isValidClaudeAuthorityAdmissionCapability,
  writeGuardedByClaudeAuthorityAdmission,
  // M7 GREEN 4.3/4.6: the same terminal check admission's own step 5 uses, standalone so a consume-grant caller can re-check only the terminal (never the fence/classifier, frozen as of admission) right before the one-time consumption write.
  checkAuthorityOperationTransactionTerminal,
  // M7 section 3: Claude actor identity/fence primitives -- consumed by Fase 3's SubagentStop hook wiring (publishClaudeAuthorityFence) and any caller inspecting a fence independently of the classifier's own scan.
  CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
  CLAUDE_AUTHORITY_FENCE_SCHEMA,
  computeClaudeAuthorityIdentityId,
  claudeAuthorityFencePathFor,
  readClaudeAuthorityFence,
  publishClaudeAuthorityFence,
};

// M7 §10.1: test-only rendezvous surface (mirrors runtime-consultation.cjs's own
// isTestCapability()-gated export; production never observes these names).
if (isTestCapability()) {
  Object.assign(module.exports, {
    testM7Rendezvous,
    resolveSafeM7RendezvousDir,
    // M67-B3-SELF-HEAL-FINAL-5R-20260821: pure ms/ISO expiry-rounding primitives, exported for a deterministic boundary-exact unit regression (no fixed-clock seam exists here).
    safeExpiryIsoForRegistry,
    futureIsoForRegistry,
    __testOnlyValidateMixedReviewVerdictRecord: validateMixedReviewVerdictRecord,
    // handleMixedReviewRequest is reached only via HANDLERS/main() in production -- this lets a test harness drive it directly with a synthetic argv array.
    __testOnlyHandleMixedReviewRequest: handleMixedReviewRequest,
    // Same-file-local in production, reached only through handleMixedReviewRequest -- exported so each internal branch can be asserted on directly, not only observed as one shared POLICY_INVALID at the CLI envelope layer.
    __testOnlyDecodeMixedReviewIntent: decodeMixedReviewIntent,
    __testOnlyS16ResolveMixedReviewPair: s16ResolveMixedReviewPair,
  });
}

if (require.main === module) {
  main(process.argv.slice(2));
}
