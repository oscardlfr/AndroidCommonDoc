#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULE_DIR = path.resolve(__dirname, '../lib/runtime-consultation');

const PRIMITIVES_PATH = path.resolve(__dirname, '../lib/runtime-consultation/primitives.cjs');
const CLI_ARGV_PATH = path.resolve(__dirname, '../lib/runtime-consultation/cli-argv.cjs');
const GIT_IDENTITY_PATH = path.resolve(__dirname, '../lib/runtime-consultation/git-identity.cjs');
const COORDINATION_PATHS_PATH = path.resolve(__dirname, '../lib/runtime-consultation/coordination-paths.cjs');
const DURABILITY_COMMON_PATH = path.resolve(__dirname, '../lib/runtime-consultation/durability/common.cjs');
const DURABILITY_READ_PATH = path.resolve(__dirname, '../lib/runtime-consultation/durability/read.cjs');
const DURABILITY_RECONCILE_PATH = path.resolve(__dirname, '../lib/runtime-consultation/durability/reconcile.cjs');
const DURABILITY_WRITE_SUPPORT_PATH = path.resolve(__dirname, '../lib/runtime-consultation/durability/write-support.cjs');
const DURABILITY_WRITE_VERIFY_PATH = path.resolve(__dirname, '../lib/runtime-consultation/durability/write-verify.cjs');
const DURABILITY_WRITE_PATH = path.resolve(__dirname, '../lib/runtime-consultation/durability/write.cjs');
const TRANSITION_CONFINEMENT_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transition-lock/confinement.cjs');
const TRANSITION_RENDEZVOUS_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transition-lock/rendezvous.cjs');
const TRANSITION_STATE_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transition-lock/state.cjs');
const TRANSITION_LIFECYCLE_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transition-lock/lifecycle.cjs');
const PROTOCOL_SCHEMA_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/schema.cjs');
const PROTOCOL_REQUEST_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/request.cjs');
const PROTOCOL_AUTHORITY_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/authority.cjs');
const PROTOCOL_PATTERN_EVIDENCE_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/pattern-evidence.cjs');
const PROTOCOL_RESULTS_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/results.cjs');
const PROTOCOL_CANONICAL_REQUEST_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/canonical-request.cjs');
const PROTOCOL_CANCEL_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/cancel.cjs');
const PROTOCOL_TERMINAL_RECORDS_PATH = path.resolve(__dirname, '../lib/runtime-consultation/protocol/terminal-records.cjs');
const PROTOCOL_PATHS = [
  PROTOCOL_SCHEMA_PATH, PROTOCOL_REQUEST_PATH, PROTOCOL_AUTHORITY_PATH,
  PROTOCOL_PATTERN_EVIDENCE_PATH, PROTOCOL_RESULTS_PATH,
  PROTOCOL_CANONICAL_REQUEST_PATH, PROTOCOL_CANCEL_PATH,
  PROTOCOL_TERMINAL_RECORDS_PATH,
];
const TRANSACTION_CLAIM_LEASE_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transaction/claim-lease.cjs');
const TRANSACTION_TAKEOVER_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transaction/takeover.cjs');
const TRANSACTION_RESULT_INVENTORY_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transaction/result-inventory.cjs');
const TRANSACTION_CANCEL_ACK_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transaction/cancel-ack.cjs');
const TRANSACTION_ACCEPT_CLEANUP_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transaction/accept-cleanup.cjs');
const TRANSACTION_AWAIT_RESULT_PATH = path.resolve(__dirname, '../lib/runtime-consultation/transaction/await-result.cjs');
const CONTENT_BLOB_PUBLISH_PATH = path.resolve(__dirname, '../lib/runtime-consultation/content/blob-publish.cjs');
const HOST_BRIDGE_PATHS = [
  ['capability.cjs', 'createCapabilityModule'],
  ['turns.cjs', 'createTurnsModule'],
  ['children.cjs', 'createChildrenModule'],
  ['root-intents.cjs', 'createRootIntentsModule'],
  ['root-evidence.cjs', 'createRootEvidenceModule'],
  ['root-status.cjs', 'createRootStatusModule'],
  ['root-operations.cjs', 'createRootOperationsModule'],
  ['inbox.cjs', 'createInboxModule'],
].map(([file, factory]) => [
  path.resolve(__dirname, '../lib/runtime-consultation/host-bridge', file), factory,
]);
const TRANSACTION_PATHS = [
  TRANSACTION_CLAIM_LEASE_PATH, TRANSACTION_TAKEOVER_PATH,
  TRANSACTION_RESULT_INVENTORY_PATH, TRANSACTION_CANCEL_ACK_PATH,
  TRANSACTION_ACCEPT_CLEANUP_PATH, TRANSACTION_AWAIT_RESULT_PATH,
  CONTENT_BLOB_PUBLISH_PATH,
];
const FACADE_PATH = path.resolve(__dirname, '../lib/runtime-consultation.cjs');

// Sequence 14 (thin facade decomposition): the remaining cohesive concerns
// extracted from the R33 conformance surface through CLI turn-envelope
// validation. Grouped as [path, factoryName] pairs, mirroring HOST_BRIDGE_PATHS,
// so the same standalone-load/exports-shape/acyclic-DAG loops below cover them.
const SEQ14_PATHS = [
  ['conformance/scalar-primitives.cjs', 'createScalarPrimitivesConformance'],
  ['conformance/root-provider-tuple.cjs', 'createRootProviderTupleConformance'],
  ['conformance/r33-tuple-digest.cjs', 'createR33TupleDigestConformance'],
  ['commands/validate.cjs', 'createValidateCommand'],
  ['root-lifecycle/windows-acl.cjs', 'createWindowsAclModule'],
  ['root-lifecycle/root-lifecycle.cjs', 'createRootLifecycle'],
  ['local-registry.cjs', 'createLocalRegistry'],
  ['role-command-grant.cjs', 'createRoleCommandGrant'],
  ['root-source-grant-boundary.cjs', 'createRootSourceGrantBoundary'],
  ['routing-policy.cjs', 'createRoutingPolicy'],
  ['canonical-request-build.cjs', 'createCanonicalRequestBuild'],
  ['commands/publish-request.cjs', 'createPublishRequestCommand'],
  ['root-source-publish.cjs', 'createRootSourcePublish'],
  ['dispatch/dispatch-driver-selection.cjs', 'createDispatchDriverSelection'],
  ['dispatch/dispatch-canonical.cjs', 'createDispatchCanonical'],
  ['commands/activation-resolution.cjs', 'createActivationResolutionCommands'],
  ['commands/delivery-worker-stop.cjs', 'createDeliveryWorkerStopCommands'],
  ['commands/publish-result.cjs', 'createPublishResultCommand'],
  ['turn-envelope/context7-pattern-gap.cjs', 'createContext7PatternGap'],
  ['turn-envelope/runtime-turn-envelope-schema.cjs', 'createRuntimeTurnEnvelopeSchema'],
].map(([file, factory]) => [path.resolve(__dirname, '../lib/runtime-consultation', file), factory]);

const MODULE_PATHS = [
  PRIMITIVES_PATH, CLI_ARGV_PATH, GIT_IDENTITY_PATH, COORDINATION_PATHS_PATH,
  DURABILITY_COMMON_PATH, DURABILITY_READ_PATH, DURABILITY_RECONCILE_PATH,
  DURABILITY_WRITE_SUPPORT_PATH, DURABILITY_WRITE_VERIFY_PATH, DURABILITY_WRITE_PATH,
  TRANSITION_CONFINEMENT_PATH, TRANSITION_RENDEZVOUS_PATH,
  TRANSITION_STATE_PATH, TRANSITION_LIFECYCLE_PATH,
  ...PROTOCOL_PATHS, ...TRANSACTION_PATHS, ...HOST_BRIDGE_PATHS.map(([modulePath]) => modulePath),
  ...SEQ14_PATHS.map(([modulePath]) => modulePath),
];

test('primitives.cjs loads standalone and exposes the expected surface', () => {
  const primitives = require(PRIMITIVES_PATH);
  assert.strictEqual(typeof primitives.canonicalJSONStringify, 'function');
  assert.strictEqual(typeof primitives.sha256String, 'function');
  assert.strictEqual(typeof primitives.sha256Buffer, 'function');
  assert.strictEqual(typeof primitives.CliError, 'function');
  assert.strictEqual(typeof primitives.genId, 'function');
  assert.strictEqual(typeof primitives.isTestCapability, 'function');
});

test('each cohesive module loads standalone and exposes only its owned concern', () => {
  const cliArgv = require(CLI_ARGV_PATH);
  const gitIdentity = require(GIT_IDENTITY_PATH);
  const coordinationPaths = require(COORDINATION_PATHS_PATH);
  assert.strictEqual(typeof cliArgv.parseFlags, 'function');
  assert.strictEqual(typeof gitIdentity.gitRevParse, 'function');
  assert.strictEqual(typeof gitIdentity.computeRepoId, 'function');
  assert.strictEqual(typeof coordinationPaths.planRootPath, 'function');
  assert.strictEqual(typeof coordinationPaths.assertGenuinelyConfinedUnderRoot, 'function');
  assert.strictEqual(cliArgv.gitRevParse, undefined);
  assert.strictEqual(gitIdentity.planRootPath, undefined);
  assert.strictEqual(coordinationPaths.parseFlags, undefined);

  const common = require(DURABILITY_COMMON_PATH);
  const read = require(DURABILITY_READ_PATH);
  const reconcile = require(DURABILITY_RECONCILE_PATH);
  const writeSupport = require(DURABILITY_WRITE_SUPPORT_PATH);
  const writeVerify = require(DURABILITY_WRITE_VERIFY_PATH);
  const write = require(DURABILITY_WRITE_PATH);
  assert.strictEqual(typeof common.readAllFromFd, 'function');
  assert.strictEqual(typeof read.createDurableReaders, 'function');
  assert.strictEqual(typeof reconcile.reconcileTempArtifacts, 'function');
  assert.strictEqual(typeof writeSupport.createWriteSupport, 'function');
  assert.strictEqual(typeof writeVerify.createWriteVerifier, 'function');
  assert.strictEqual(typeof write.createDurableWriters, 'function');
  assert.strictEqual(common.publishNoClobber, undefined);
  assert.strictEqual(read.reconcileTempArtifacts, undefined);
  assert.strictEqual(reconcile.createDurableWriters, undefined);

  const confinement = require(TRANSITION_CONFINEMENT_PATH);
  const rendezvous = require(TRANSITION_RENDEZVOUS_PATH);
  const state = require(TRANSITION_STATE_PATH);
  const lifecycle = require(TRANSITION_LIFECYCLE_PATH);
  assert.strictEqual(typeof confinement.assertAncestorChainConfined, 'function');
  assert.strictEqual(typeof rendezvous.testM7Rendezvous, 'function');
  assert.strictEqual(typeof state.createTransitionLockState, 'function');
  assert.strictEqual(typeof lifecycle.createTransitionLockLifecycle, 'function');
  assert.strictEqual(confinement.createTransitionLockState, undefined);
  assert.strictEqual(rendezvous.createTransitionLockLifecycle, undefined);
  assert.strictEqual(state.acquireLock, undefined);
  assert.strictEqual(lifecycle.isValidLockTokenFor, undefined);

  const expectedFactories = [
    [PROTOCOL_SCHEMA_PATH, 'createSchemaProtocol'],
    [PROTOCOL_REQUEST_PATH, 'createRequestProtocol'],
    [PROTOCOL_AUTHORITY_PATH, 'createAuthorityProtocol'],
    [PROTOCOL_PATTERN_EVIDENCE_PATH, 'createPatternEvidenceProtocol'],
    [PROTOCOL_RESULTS_PATH, 'createResultsProtocol'],
    [PROTOCOL_CANONICAL_REQUEST_PATH, 'createCanonicalRequestProtocol'],
    [PROTOCOL_CANCEL_PATH, 'createCancelProtocol'],
    [PROTOCOL_TERMINAL_RECORDS_PATH, 'createTerminalRecordsProtocol'],
    [TRANSACTION_CLAIM_LEASE_PATH, 'createClaimLeaseTransaction'],
    [TRANSACTION_TAKEOVER_PATH, 'createTakeoverTransaction'],
    [TRANSACTION_RESULT_INVENTORY_PATH, 'createResultInventory'],
    [TRANSACTION_CANCEL_ACK_PATH, 'createCancelAckTransaction'],
    [TRANSACTION_ACCEPT_CLEANUP_PATH, 'createAcceptCleanupTransaction'],
    [TRANSACTION_AWAIT_RESULT_PATH, 'createAwaitResultTransaction'],
    [CONTENT_BLOB_PUBLISH_PATH, 'createBlobPublisher'],
    ...HOST_BRIDGE_PATHS,
    ...SEQ14_PATHS,
  ];
  for (const [modulePath, factoryName] of expectedFactories) {
    const concernModule = require(modulePath);
    assert.deepStrictEqual(Object.keys(concernModule), [factoryName]);
    assert.strictEqual(typeof concernModule[factoryName], 'function');
  }
});

test('extracted modules never import upward and form the intended acyclic DAG', () => {
  const forbidden = /require\(\s*['"][^'"]*runtime-(role-lifecycle|bridge-codex)\.cjs['"]\s*\)/;
  for (const p of MODULE_PATHS) {
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(!forbidden.test(src), p + ' must never reference role-lifecycle/bridge-codex');
  }
  const dependencies = (p) => [...fs.readFileSync(p, 'utf8').matchAll(/require\(['"](\.\.?\/[^'"]+\.cjs)['"]\)/g)]
    .map((match) => match[1]);
  assert.deepStrictEqual(dependencies(PRIMITIVES_PATH), []);
  assert.deepStrictEqual(dependencies(CLI_ARGV_PATH), ['./primitives.cjs']);
  assert.deepStrictEqual(dependencies(GIT_IDENTITY_PATH), ['./primitives.cjs']);
  assert.deepStrictEqual(dependencies(COORDINATION_PATHS_PATH), ['./primitives.cjs', './git-identity.cjs']);
  assert.deepStrictEqual(dependencies(DURABILITY_COMMON_PATH), []);
  assert.deepStrictEqual(dependencies(DURABILITY_READ_PATH), ['../primitives.cjs', './common.cjs']);
  assert.deepStrictEqual(dependencies(DURABILITY_RECONCILE_PATH), ['../primitives.cjs', './common.cjs', './read.cjs']);
  assert.deepStrictEqual(dependencies(DURABILITY_WRITE_SUPPORT_PATH), ['../primitives.cjs', './common.cjs']);
  assert.deepStrictEqual(dependencies(DURABILITY_WRITE_VERIFY_PATH), ['../primitives.cjs', './common.cjs']);
  assert.deepStrictEqual(dependencies(DURABILITY_WRITE_PATH), ['../primitives.cjs', './write-support.cjs', './write-verify.cjs']);
  assert.deepStrictEqual(dependencies(TRANSITION_CONFINEMENT_PATH), ['../primitives.cjs']);
  assert.deepStrictEqual(dependencies(TRANSITION_RENDEZVOUS_PATH), ['../primitives.cjs']);
  assert.deepStrictEqual(dependencies(TRANSITION_STATE_PATH), ['../primitives.cjs', './confinement.cjs']);
  assert.deepStrictEqual(dependencies(TRANSITION_LIFECYCLE_PATH), [
    '../primitives.cjs', './confinement.cjs', './rendezvous.cjs',
  ]);
  for (const protocolPath of PROTOCOL_PATHS) {
    assert.deepStrictEqual(dependencies(protocolPath), []);
  }
  for (const transactionPath of TRANSACTION_PATHS) {
    assert.deepStrictEqual(dependencies(transactionPath), []);
  }
  for (const [hostBridgePath] of HOST_BRIDGE_PATHS) {
    assert.deepStrictEqual(dependencies(hostBridgePath), []);
  }
  // Sequence 14: every one of these 20 modules is a leaf with respect to the
  // OTHER consultation modules -- none requires a sibling .cjs file (shared
  // state crosses module boundaries only via facade-injected deps/thunks,
  // e.g. getRuntimeRoleLifecycle), so each has an empty require graph too.
  for (const [seq14Path] of SEQ14_PATHS) {
    assert.deepStrictEqual(dependencies(seq14Path), [], seq14Path + ' must not require a sibling module directly');
  }
});

test('sequence-14 modules never require runtime-role-lifecycle/bridge-codex directly, only via an injected getter', () => {
  for (const [modulePath] of SEQ14_PATHS) {
    const src = fs.readFileSync(modulePath, 'utf8');
    assert.ok(
      !/require\(\s*['"][^'"]*runtime-(role-lifecycle|bridge-codex)\.cjs['"]\s*\)/.test(src),
      modulePath + ' must receive getRuntimeRoleLifecycle/getRuntimeBridgeCodex as an injected dependency, never require it directly',
    );
  }
});

test('all bounded internal modules stay at or below 500 lines', () => {
  const discovered = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).slice().sort()) {
      const entryPath = path.join(directory, name);
      const stat = fs.lstatSync(entryPath);
      assert.strictEqual(stat.isSymbolicLink(), false, entryPath + ' must not be a symlink');
      if (stat.isDirectory()) walk(entryPath);
      else if (stat.isFile() && name.endsWith('.cjs')) discovered.push(entryPath);
    }
  };
  walk(MODULE_DIR);
  assert.deepStrictEqual(discovered.slice().sort(), MODULE_PATHS.slice().sort());
  for (const modulePath of discovered) {
    const fileLines = fs.readFileSync(modulePath, 'utf8').split(/\r?\n/);
    assert.ok(fileLines.length <= 500, modulePath + ' has ' + fileLines.length + ' lines (max 500)');
    const maxLineLength = Math.max(...fileLines.map((l) => l.length));
    assert.ok(maxLineLength <= 320, modulePath + ' has a ' + maxLineLength + '-char line (max 320)');
  }
});

test('the facade is a thin composition/CLI root: <=1500 physical lines, <=320 chars per line', () => {
  const facadeLines = fs.readFileSync(FACADE_PATH, 'utf8').split(/\r?\n/);
  assert.ok(facadeLines.length <= 1500, 'facade has ' + facadeLines.length + ' lines (max 1500)');
  const maxLineLength = Math.max(...facadeLines.map((l) => l.length));
  assert.ok(maxLineLength <= 320, 'facade has a ' + maxLineLength + '-char line (max 320)');
});

test('no function body left in the facade or any consultation module exceeds 500 lines', () => {
  const sources = [FACADE_PATH, ...MODULE_PATHS];
  for (const sourcePath of sources) {
    const fileLines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
    for (let i = 0; i < fileLines.length; i++) {
      const m = fileLines[i].match(/^function\s*\*?\s*[A-Za-z0-9_$]*\s*\(/);
      if (!m) continue;
      let depth = 0;
      let started = false;
      let end = -1;
      for (let j = i; j < fileLines.length; j++) {
        for (const ch of fileLines[j]) {
          if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
        }
        if (started && depth === 0) { end = j; break; }
      }
      assert.ok(end !== -1, sourcePath + ':' + (i + 1) + ' function never closes its own braces');
      const bodyLines = end - i + 1;
      assert.ok(
        bodyLines <= 500,
        sourcePath + ':' + (i + 1) + ' function body is ' + bodyLines + ' lines (max 500)',
      );
    }
  }
});

test('extracted implementations are relocated once, not copied behind the facade', () => {
  const sources = [FACADE_PATH, ...MODULE_PATHS]
    .map((modulePath) => fs.readFileSync(modulePath, 'utf8'));
  const relocated = [
    'classifyDurableRead', 'readDurableBytes', 'readDurableBytesOptional',
    'readJsonDurable', 'readJsonDurableOptional', 'readDurableRecord',
    'readClosedRecord', 'readClosedRecordOptional',
    'reconcileTempArtifacts', 'reconcileOneNoClobberTemp',
    'writeAllSync', 'fsyncDir', 'publishNoClobber', 'publishReplace',
    'assertDurableTargetMatches', 'assertArtifactMatchesReceipt',
    'sleepSync', 'testRendezvous', 'resolveSafeM7RendezvousDir', 'testM7Rendezvous',
    'markPoisoned', 'isPoisoned', 'isPathWithin', 'assertAncestorChainConfined', 'isValidLockTokenFor',
    'assertLockedScopeIdentity', 'acquireLock', 'releaseLock', 'withLock',
    'readArtifactBytes', 'parseJsonOrSchemaInvalid', 'assertClosedShape',
    'resolveContentRefOrThrow', 'readCanonicalRequestRecord',
    'validateConsultV2', 'validateRequestGraph', 'validateInboxRefV1',
    'validateActivationV1', 'readRequestForTxnOrCorrelationInvalid',
    'resolveAuthoritativeAttempt', 'validateClaimV1', 'validateActiveLeaseV1',
    'validatePatternEvidenceForResult', 'validateResultV2',
    'validateAcceptedResultV1', 'assertAcceptedResultCorrelates',
    'validateConsultationDependencySet', 'assertExactCanonicalGeometry',
    'accreditCanonicalRequest', 'classifyCanonicalResultForRequest',
    'accreditCancelRecord', 'readCanonicalCancelRecordRequired',
    'classifyCanonicalCancelRecord', 'validateCancelV1',
    'validateConflictV1', 'validateTakeoverBinding', 'validateTakeoverV1',
    'validateStopV2',
    'cmdClaim', 'cmdLeaseHeartbeat', 'activationLivenessDeadline',
    'cmdTakeover', 'listResultFiles', 'writeConflictDiagnosticIfApplicable',
    'findResultWithStatus', 'cmdCancel', 'cmdTransactionAck',
    'cmdAcceptResult', 'cmdCleanup', 'cmdAwaitResult', 'cmdPublishBlob',
    'createHostBridgeCapability', 'hostBridgeListRootConsultIntents',
    'hostBridgeAdvanceRootConsult', 'hostBridgeObserveAndCompleteRootConsult',
    'readRootConsultTerminalStatus', 'readRootSourceTerminalArtifacts',
    'hostBridgeListInbox', 'hostBridgeClaim', 'hostBridgeLeaseHeartbeat',
    'hostBridgeScheduleTurn', 'hostBridgeRecordTurnStartAccepted',
    'hostBridgePublishPatternEvidence', 'hostBridgePublishTerminalResult',
    'hostBridgeAllowedChildRoles', 'hostBridgePublishChildRequest',
    'hostBridgeObserveChildResult', 'resolveRootEvidenceAuthority',
    // Sequence 14 (thin facade decomposition).
    'assertBindingCarrierBytes', 'assertCanonicalDiskRecordBytes', 'assertCoordinationRootSnapshotUnchanged',
    'assertDirectlyAtCoordinationRoot', 'assertNotInsideCoordinationRoot', 'assertTemporalAuthorityEnvelopeV1',
    'assertWindowsPrivateDirectoryAcl', 'assertWindowsRootAclProbeAvailable', 'buildCanonicalRequest',
    'buildCanonicalRequestFromFields', 'checkProviderSessionV3Conformance', 'checkR33ProfileTupleConformance',
    'checkRootProfileV3Conformance', 'checkRuntimeProfileBindingV2Conformance', 'claudeAgentCapabilityProjectRoot',
    'cmdDispatch', 'cmdPublishRequest', 'cmdPublishResult', 'cmdRecordDelivery', 'cmdRootInit', 'cmdRootValidate',
    'cmdValidate', 'cmdWorkerStop', 'cmdWorkerStopAck', 'codexStructuredRuntimeTurnEnvelopeSchema',
    'consumeValidatedRoleCommandGrantOrThrow', 'decodeIntentOrThrow', 'decodeSubjectBundleManifestOrThrow',
    'deriveCanonicalRequestFields', 'dispatchCanonical', 'domainSeparatedRecordDigest',
    'enforceRootSourceGrantBoundary', 'expectedTurnEnvelopeBranchCount', 'findLiveClaudeAgentActivations',
    'findRootSourceActorRequest', 'hasExactKeys', 'isCanonicalContext7LibraryId', 'isCanonicalIsoUtcLocal',
    'isId128', 'isIsoUtc', 'isLiteralField', 'isMonoNs', 'isPid', 'isRootSourceGrantContext',
    'isSafeRelativeEntryPath', 'lit', 'loadRoutingPolicyContent', 'localComputePrincipalId',
    'localEnsureSecureRegistryDir', 'localRegistryBaseDir', 'localRegistryRepoDir',
    'localWindowsCommonApplicationDataRoot', 'materializePlanRef', 'materializeRoutingPolicy',
    'materializeSubjectBundle', 'normalizeWindowsAclObservation', 'parseApprovedContext7Directive',
    'parsePreferredContext7Directive', 'patternGapExecutionAllowed', 'providerSessionDigestV3',
    'publishPreallocatedRequest', 'readLocalRegistryRecord', 'readRootSourceIngressOrThrow',
    'requiredConsultQuestionFor', 'requiredGapLibraryIdFor', 'requiredTurnKind',
    'resolveActivationForRequestPath', 'resolveRequesterGrantScope', 'resolvedWindowsPowerShellPath',
    'roleCommandGrantConsumedMarkerPathFor', 'roleCommandGrantPathFor', 'rootProfileDigestV3',
    'routingOverrideInvalid', 'runtimeTurnEnvelopeSchema', 'selectDispatchDriver',
    'serializeRootSourcePublishRequest', 'snapshotCoordinationRootIdentity', 'targetRoleProfileDigestFor',
    'temporalEnvelopeDigestV1', 'unwrapAndValidateCodexStructuredRuntimeTurnEnvelope',
    'validateAndConsumeRoleCommandGrantForCommand', 'validatePatternGap', 'validateRoleCommandGrantOrThrow',
    'validateRootConfinement', 'validateRuntimeTurnEnvelope', 'windowsAclSnapshotsEqual', 'windowsPrivateDirectoryAcl',
  ];
  const facadeSource = sources[0];
  for (const functionName of relocated) {
    const definition = new RegExp('function\\s+' + functionName + '\\s*\\(', 'g');
    const occurrences = sources.reduce(
      (count, source) => count + [...source.matchAll(definition)].length,
      0,
    );
    assert.strictEqual(occurrences, 1, functionName + ' must have exactly one implementation');
    assert.ok(!definition.test(facadeSource), functionName + ' must not remain implemented in the facade');
  }
});

test('canonical JSON and SHA-256 helpers match fixed golden vectors', () => {
  const { canonicalJSONStringify, sha256String, sha256Buffer } = require(PRIMITIVES_PATH);
  assert.strictEqual(canonicalJSONStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.strictEqual(canonicalJSONStringify({ b: { d: 2, c: 3 }, a: 1 }), '{"a":1,"b":{"c":3,"d":2}}');
  assert.strictEqual(sha256String(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.strictEqual(sha256String('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(sha256Buffer(Buffer.from('abc', 'utf8')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the facade re-exports extracted functions by identical reference', () => {
  const facade = require(FACADE_PATH);
  const primitives = require(PRIMITIVES_PATH);
  const gitIdentity = require(GIT_IDENTITY_PATH);
  assert.strictEqual(facade.canonicalJSONStringify, primitives.canonicalJSONStringify);
  assert.strictEqual(facade.sha256String, primitives.sha256String);
  assert.strictEqual(facade.gitRevParse, gitIdentity.gitRevParse);
  assert.strictEqual(facade.realpathOrSelf, gitIdentity.realpathOrSelf);
  assert.strictEqual(typeof facade.validateRootConfinement, 'function');
  assert.strictEqual(typeof facade.validateConsultationDependencySet, 'function');
  assert.strictEqual(typeof facade.classifyCanonicalResultForRequest, 'function');
  const facadeSource = fs.readFileSync(FACADE_PATH, 'utf8');
  assert.ok(!/function\s+validateConsultationDependencySet\s*\(/.test(facadeSource));
  assert.ok(!/function\s+classifyCanonicalResultForRequest\s*\(/.test(facadeSource));
});

test('transaction public helpers retain the exact factory-produced references', () => {
  const takeoverModule = require(TRANSACTION_TAKEOVER_PATH);
  const inventoryModule = require(TRANSACTION_RESULT_INVENTORY_PATH);
  const cancelAckModule = require(TRANSACTION_CANCEL_ACK_PATH);
  const originals = {
    takeover: takeoverModule.createTakeoverTransaction,
    inventory: inventoryModule.createResultInventory,
    cancelAck: cancelAckModule.createCancelAckTransaction,
  };
  const captured = {};
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCapability = process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY;
  takeoverModule.createTakeoverTransaction = (...args) => {
    const result = originals.takeover(...args);
    captured.activationLivenessDeadline = result.activationLivenessDeadline;
    return result;
  };
  inventoryModule.createResultInventory = (...args) => {
    const result = originals.inventory(...args);
    captured.listResultFiles = result.listResultFiles;
    return result;
  };
  cancelAckModule.createCancelAckTransaction = (...args) => {
    const result = originals.cancelAck(...args);
    captured.findResultWithStatus = result.findResultWithStatus;
    return result;
  };
  delete require.cache[require.resolve(FACADE_PATH)];
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = 'module-boundary-ref-identity';
    const facade = require(FACADE_PATH);
    assert.strictEqual(facade.activationLivenessDeadline, captured.activationLivenessDeadline);
    assert.strictEqual(facade.listResultFiles, captured.listResultFiles);
    assert.strictEqual(facade.findResultWithStatus, captured.findResultWithStatus);
  } finally {
    takeoverModule.createTakeoverTransaction = originals.takeover;
    inventoryModule.createResultInventory = originals.inventory;
    cancelAckModule.createCancelAckTransaction = originals.cancelAck;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorCapability === undefined) delete process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY;
    else process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = priorCapability;
    delete require.cache[require.resolve(FACADE_PATH)];
  }
});

test('all 17 public HostBridge functions retain the exact factory-produced references', () => {
  const publicNames = [
    'resolveRootEvidenceAuthority', 'createHostBridgeCapability',
    'hostBridgeListRootConsultIntents', 'hostBridgeAdvanceRootConsult',
    'hostBridgeObserveAndCompleteRootConsult', 'readRootConsultTerminalStatus',
    'readRootSourceTerminalArtifacts', 'hostBridgeListInbox', 'hostBridgeClaim',
    'hostBridgeLeaseHeartbeat', 'hostBridgeScheduleTurn',
    'hostBridgeRecordTurnStartAccepted', 'hostBridgePublishPatternEvidence',
    'hostBridgePublishTerminalResult', 'hostBridgeAllowedChildRoles',
    'hostBridgePublishChildRequest', 'hostBridgeObserveChildResult',
  ];
  const originals = new Map();
  const captured = {};
  for (const [modulePath, factoryName] of HOST_BRIDGE_PATHS) {
    const concern = require(modulePath);
    const original = concern[factoryName];
    originals.set(modulePath, original);
    concern[factoryName] = (...args) => {
      const result = original(...args);
      for (const name of publicNames) {
        if (typeof result[name] === 'function') captured[name] = result[name];
      }
      return result;
    };
  }
  delete require.cache[require.resolve(FACADE_PATH)];
  try {
    const facade = require(FACADE_PATH);
    for (const name of publicNames) {
      assert.strictEqual(typeof captured[name], 'function', name + ' was not produced by its concern factory');
      assert.strictEqual(facade[name], captured[name], name + ' must be exported by exact reference');
    }
  } finally {
    for (const [modulePath, factoryName] of HOST_BRIDGE_PATHS) {
      require(modulePath)[factoryName] = originals.get(modulePath);
    }
    delete require.cache[require.resolve(FACADE_PATH)];
  }
});

test('HostBridge capabilities remain private to one facade composition', () => {
  const { createCapabilityModule } = require(HOST_BRIDGE_PATHS[0][0]);
  const root = path.resolve(path.parse(process.cwd()).root, 'host-bridge-scope');
  const planDigest = 'a'.repeat(64);
  const worktreeId = 'b'.repeat(64);
  const scope = {
    actorInstanceId: '1'.repeat(32),
    expiresAt: '2999-01-01T00:00:00.000Z',
    planDigest,
    projectRoot: root,
    role: 'context-provider',
    supervisorInstanceId: '2'.repeat(32),
    workerSessionId: '3'.repeat(32),
    worktreeId,
  };
  const deps = {
    path, CliError: class CliError extends Error {
      constructor(_status, _detailCode, message) { super(message); }
    },
    GRANT_CANONICAL_ROLES: ['context-provider'],
    hasExactKeys: (value, keys) => Object.keys(value).sort().join('\0') === keys.join('\0'),
    isHex64: (value) => /^[a-f0-9]{64}$/.test(value),
    isIsoTimestamp: (value) => Number.isFinite(Date.parse(value)),
    isoToMs: Date.parse,
    resolveSealedGitCache: (_cache, projectRoot, resolve) => ({ ok: true, derived: resolve(projectRoot) }),
    gitRevParse: (_projectRoot, args) => args.includes('--show-toplevel') ? root : path.join(root, '.git'),
    realpathOrSelf: (value) => value,
    computeWorktreeId: () => worktreeId,
    accreditCanonicalRequest: () => { throw new Error('not used'); },
    resolveActivationForRequestPath: () => { throw new Error('not used'); },
    resolveAbsolute: path.resolve,
    getRuntimeRoleLifecycle: () => ({ discoverPlan: () => ({ ok: true, planDigest }) }),
    getRuntimeBridgeCodex: () => ({
      resolveLiveCodexAppServerWorker: () => ({
        ok: true,
        available: true,
        worker: {
          pid: process.pid,
          worktreeId,
          planDigest,
          role: scope.role,
          supervisorInstanceId: scope.supervisorInstanceId,
          workerSessionId: scope.workerSessionId,
        },
      }),
    }),
  };
  const firstComposition = createCapabilityModule(deps);
  const secondComposition = createCapabilityModule(deps);
  const minted = firstComposition.createHostBridgeCapability(scope);
  assert.strictEqual(minted.ok, true);
  assert.strictEqual(firstComposition.requireHostBridgeCapability(minted.capability).role, scope.role);
  assert.throws(
    () => secondComposition.requireHostBridgeCapability(minted.capability),
    /unknown HostBridgeCapability/,
  );
});

test('requester and target grant flags are part of the immutable parse contract', () => {
  const cliArgv = require(CLI_ARGV_PATH);
  assert.deepStrictEqual(
    cliArgv.parseFlags(['--coordination-root', 'root', '--requester-binding', 'requester-id'], 'root-init'),
    { 'coordination-root': 'root', 'requester-binding': 'requester-id' },
  );
  assert.deepStrictEqual(
    cliArgv.parseFlags([
      '--coordination-root', 'root', '--request', 'request.json', '--role', 'worker',
      '--worker-session', 'session', '--target-binding', 'target-id',
    ], 'claim'),
    {
      'coordination-root': 'root', request: 'request.json', role: 'worker',
      'worker-session': 'session', 'target-binding': 'target-id',
    },
  );
});

test('CLI contract collections are immutable and DETAIL_CODES stays private', () => {
  const primitives = require(PRIMITIVES_PATH);
  const cliArgv = require(CLI_ARGV_PATH);
  assert.ok(Object.isFrozen(primitives.RC_FOR_STATUS));
  assert.ok(Object.isFrozen(primitives.DRIVER_ENUM));
  assert.ok(!Object.prototype.hasOwnProperty.call(primitives, 'DETAIL_CODES'));
  assert.ok(Object.isFrozen(cliArgv.COMMAND_FLAGS));
  assert.ok(Object.isFrozen(cliArgv.BOOLEAN_FLAGS));
  assert.ok(Object.isFrozen(cliArgv.PATH_FLAG_NAMES));
  assert.ok(Object.isFrozen(cliArgv.ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND));
  assert.ok(Object.isFrozen(cliArgv.ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY));
  for (const flags of Object.values(cliArgv.COMMAND_FLAGS)) assert.ok(Object.isFrozen(flags));
  assert.throws(() => cliArgv.COMMAND_FLAGS.claim.push('unexpected'), TypeError);
  assert.throws(() => { cliArgv.ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND.claim = 'requester'; }, TypeError);
  assert.strictEqual(cliArgv.ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND.claim, 'target');
});

test('facade reload preserves its 69-key public surface without duplicating flags', () => {
  const cliArgv = require(CLI_ARGV_PATH);
  const beforeFlags = Object.fromEntries(
    Object.entries(cliArgv.COMMAND_FLAGS).map(([command, flags]) => [command, flags.slice()]),
  );
  const first = require(FACADE_PATH);
  const firstKeys = Object.keys(first).sort();
  assert.strictEqual(firstKeys.length, 69);

  delete require.cache[require.resolve(FACADE_PATH)];
  const second = require(FACADE_PATH);
  assert.deepStrictEqual(Object.keys(second).sort(), firstKeys);
  assert.deepStrictEqual(cliArgv.COMMAND_FLAGS, beforeFlags);
  for (const flags of Object.values(cliArgv.COMMAND_FLAGS)) {
    assert.strictEqual(flags.length, new Set(flags).size);
  }
});

test('fd-bound identity reads always close the descriptor they open', () => {
  const gitIdentity = require(GIT_IDENTITY_PATH);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-consultation-fd-'));
  const fixture = path.join(dir, 'identity.txt');
  fs.writeFileSync(fixture, 'sealed identity\n');
  const priorStat = gitIdentity.statIdentityOrNull(fixture);
  const originalCloseSync = fs.closeSync;
  let closes = 0;
  fs.closeSync = function countedClose(fd) {
    closes += 1;
    return originalCloseSync(fd);
  };
  try {
    assert.strictEqual(gitIdentity.readFdBoundFileOrNull(fixture, priorStat).toString('utf8'), 'sealed identity\n');
    assert.strictEqual(closes, 1);
  } finally {
    fs.closeSync = originalCloseSync;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the facade and module directory form a relocatable package', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-consultation-package-'));
  const facade = path.join(dir, 'runtime-consultation.cjs');
  try {
    fs.copyFileSync(FACADE_PATH, facade);
    fs.cpSync(path.dirname(PRIMITIVES_PATH), path.join(dir, 'runtime-consultation'), { recursive: true });
    for (const sibling of ['runtime-routing.json', 'runtime-collaboration-policy.json']) {
      fs.copyFileSync(path.resolve(path.dirname(FACADE_PATH), sibling), path.join(dir, sibling));
    }
    const result = spawnSync(process.execPath, [facade, 'not-a-command'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 2, result.stderr);
    const envelope = JSON.parse(result.stdout.trim());
    assert.strictEqual(envelope.status, 'USAGE_ERROR');
    assert.strictEqual(envelope.detail_code, 'UNKNOWN_COMMAND');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
