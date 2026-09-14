'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const facadePath = path.join(repoRoot, 'scripts', 'lib', 'runtime-role-lifecycle.cjs');
const moduleDir = path.join(repoRoot, 'scripts', 'lib', 'runtime-role-lifecycle');
// Sequence-12 thin-facade decomposition: these modules must additionally stay
// under the mailbox's <=320-char max line length. Earlier-sequence modules
// keep their own pre-existing (looser) line-length profile -- this suite
// never retroactively reformats code outside the current sequence's scope.
const seq12Modules = Object.freeze([
  'supervisorLifecycleOwner', 'supervisorBatchMint', 'teamEnsure', 'resumeCheckpoint',
  'ensureHandler', 'cliNotifyHandler', 'cliTerminalize', 'cliActionReadyHandlers',
  'cliRotateStopHandlers', 'cliConsultHandlers', 'cliRootSourceHandlers',
  'prepPublicationReserve', 'prepPublicationGrammar', 'p2Materialization', 'cliDispatch',
  // Sequence 13: the remaining facade foundational blocks (envelope/hex
  // validators, policy/routing schema, posix-direct, structural validators,
  // M7 rendezvous, retained-supervisor reconciliation, managed lifecycle
  // grant), extracted so the facade itself drops to <=1,500 lines.
  'cliEnvelope', 'policySchema', 'posixDirect', 'structuralValidators', 'm7Rendezvous',
  'retainedSupervisorReconciliation', 'managedLifecycleGrant',
]);
const modulePaths = Object.freeze({
  runtimeIdentity: path.join(moduleDir, 'runtime-identity.cjs'),
  privateRegistry: path.join(moduleDir, 'private-registry.cjs'),
  sessionGeneration: path.join(moduleDir, 'session-generation.cjs'),
  scope: path.join(moduleDir, 'claude-id01-scope.cjs'),
  trace: path.join(moduleDir, 'claude-id01-trace.cjs'),
  startup: path.join(moduleDir, 'claude-id01-startup.cjs'),
  observations: path.join(moduleDir, 'claude-id01-observations.cjs'),
  peer: path.join(moduleDir, 'claude-peer-binding.cjs'),
  resumeRecord: path.join(moduleDir, 'claude-resume-record.cjs'),
  resumeLifecycle: path.join(moduleDir, 'claude-resume-lifecycle.cjs'),
  oneShotRecord: path.join(moduleDir, 'claude-one-shot-record.cjs'),
  oneShotOperations: path.join(moduleDir, 'claude-one-shot-operations.cjs'),
  roleBindingState: path.join(moduleDir, 'role-binding-state.cjs'),
  supervisorReadyTransition: path.join(moduleDir, 'supervisor-ready-transition.cjs'),
  roleCapabilityRouting: path.join(moduleDir, 'role-capability-routing.cjs'),
  diskConsumerRegistration: path.join(moduleDir, 'disk-consumer-registration.cjs'),
  lifecycleActionRecord: path.join(moduleDir, 'lifecycle-action-record.cjs'),
  lifecycleActionPayloads: path.join(moduleDir, 'lifecycle-action-payloads.cjs'),
  lifecycleArgv: path.join(moduleDir, 'lifecycle-argv.cjs'),
  rootSourceBootstrapLines: path.join(moduleDir, 'root-source-bootstrap-lines.cjs'),
  rootSourceContract: path.join(moduleDir, 'root-source-contract.cjs'),
  rootSourceReservation: path.join(moduleDir, 'root-source-reservation.cjs'),
  rootSourceBindingAdmission: path.join(moduleDir, 'root-source-binding-admission.cjs'),
  rootSourceBindingRecords: path.join(moduleDir, 'root-source-binding-records.cjs'),
  rootSourceLiveIndex: path.join(moduleDir, 'root-source-live-index.cjs'),
  claudeAuthorityClassifier: path.join(moduleDir, 'claude-authority-classifier.cjs'),
  claudeAuthorityAdmission: path.join(moduleDir, 'claude-authority-admission.cjs'),
  authorityTransactions: path.join(moduleDir, 'authority-transactions.cjs'),
  roleCommandGrant: path.join(moduleDir, 'role-command-grant.cjs'),
  lifecycleCommandGrant: path.join(moduleDir, 'lifecycle-command-grant.cjs'),
  orchestratorRoleBindings: path.join(moduleDir, 'orchestrator-role-bindings.cjs'),
  requesterBindingModule: path.join(moduleDir, 'requester-binding.cjs'),
  executionClaimModule: path.join(moduleDir, 'execution-claim.cjs'),
  roleSpawnExecutionClaim: path.join(moduleDir, 'role-spawn-execution-claim.cjs'),
  directRoleHostAdmission: path.join(moduleDir, 'direct-role-host-admission.cjs'),
  claudeAgentSpawnReservation: path.join(moduleDir, 'claude-agent-spawn-reservation.cjs'),
  rootConsultRecords: path.join(moduleDir, 'root-consult-records.cjs'),
  s16ContextResolution: path.join(moduleDir, 's16-context-resolution.cjs'),
  p2SubjectBundle: path.join(moduleDir, 'p2-subject-bundle.cjs'),
  mixedReviewRecords: path.join(moduleDir, 'mixed-review-records.cjs'),
  prepPublicationRecords: path.join(moduleDir, 'prep-publication-records.cjs'),
  supervisorLifecycleOwner: path.join(moduleDir, 'supervisor-lifecycle-owner.cjs'),
  supervisorBatchMint: path.join(moduleDir, 'supervisor-batch-mint.cjs'),
  teamEnsure: path.join(moduleDir, 'team-ensure.cjs'),
  resumeCheckpoint: path.join(moduleDir, 'resume-checkpoint.cjs'),
  ensureHandler: path.join(moduleDir, 'ensure-handler.cjs'),
  cliNotifyHandler: path.join(moduleDir, 'cli-notify-handler.cjs'),
  cliTerminalize: path.join(moduleDir, 'cli-terminalize.cjs'),
  cliActionReadyHandlers: path.join(moduleDir, 'cli-action-ready-handlers.cjs'),
  cliRotateStopHandlers: path.join(moduleDir, 'cli-rotate-stop-handlers.cjs'),
  cliConsultHandlers: path.join(moduleDir, 'cli-consult-handlers.cjs'),
  cliRootSourceHandlers: path.join(moduleDir, 'cli-rootsource-handlers.cjs'),
  prepPublicationReserve: path.join(moduleDir, 'prep-publication-reserve.cjs'),
  prepPublicationGrammar: path.join(moduleDir, 'prep-publication-grammar.cjs'),
  p2Materialization: path.join(moduleDir, 'p2-materialization.cjs'),
  cliDispatch: path.join(moduleDir, 'cli-dispatch.cjs'),
  cliEnvelope: path.join(moduleDir, 'cli-envelope.cjs'),
  policySchema: path.join(moduleDir, 'policy-schema.cjs'),
  posixDirect: path.join(moduleDir, 'posix-direct.cjs'),
  structuralValidators: path.join(moduleDir, 'structural-validators.cjs'),
  m7Rendezvous: path.join(moduleDir, 'm7-rendezvous.cjs'),
  retainedSupervisorReconciliation: path.join(moduleDir, 'retained-supervisor-reconciliation.cjs'),
  managedLifecycleGrant: path.join(moduleDir, 'managed-lifecycle-grant.cjs'),
});

const factories = Object.freeze({
  runtimeIdentity: require(modulePaths.runtimeIdentity).createRuntimeIdentityModule,
  privateRegistry: require(modulePaths.privateRegistry).createPrivateRegistryModule,
  sessionGeneration: require(modulePaths.sessionGeneration).createSessionGenerationModule,
  scope: require(modulePaths.scope).createClaudeId01Scope,
  trace: require(modulePaths.trace).createClaudeId01Trace,
  startup: require(modulePaths.startup).createClaudeId01Startup,
  observations: require(modulePaths.observations).createClaudeId01Observations,
  peer: require(modulePaths.peer).createClaudePeerBinding,
  resumeRecord: require(modulePaths.resumeRecord).createClaudeResumeRecord,
  resumeLifecycle: require(modulePaths.resumeLifecycle).createClaudeResumeLifecycle,
  oneShotRecord: require(modulePaths.oneShotRecord).createClaudeOneShotRecord,
  oneShotOperations: require(modulePaths.oneShotOperations).createClaudeOneShotOperations,
  roleBindingState: require(modulePaths.roleBindingState).createRoleBindingState,
  supervisorReadyTransition: require(modulePaths.supervisorReadyTransition).createSupervisorReadyTransition,
  roleCapabilityRouting: require(modulePaths.roleCapabilityRouting).createRoleCapabilityRouting,
  diskConsumerRegistration: require(modulePaths.diskConsumerRegistration).createDiskConsumerRegistration,
  lifecycleActionRecord: require(modulePaths.lifecycleActionRecord).createLifecycleActionRecord,
  lifecycleActionPayloads: require(modulePaths.lifecycleActionPayloads).createLifecycleActionPayloads,
  lifecycleArgv: require(modulePaths.lifecycleArgv).createLifecycleArgv,
  rootSourceBootstrapLines: require(modulePaths.rootSourceBootstrapLines).createRootSourceBootstrapLines,
  rootSourceContract: require(modulePaths.rootSourceContract).createRootSourceContract,
  rootSourceReservation: require(modulePaths.rootSourceReservation).createRootSourceReservation,
  rootSourceBindingAdmission: require(modulePaths.rootSourceBindingAdmission).createRootSourceBindingAdmission,
  rootSourceBindingRecords: require(modulePaths.rootSourceBindingRecords).createRootSourceBindingRecords,
  rootSourceLiveIndex: require(modulePaths.rootSourceLiveIndex).createRootSourceLiveIndex,
  claudeAuthorityClassifier: require(modulePaths.claudeAuthorityClassifier).createClaudeAuthorityClassifier,
  claudeAuthorityAdmission: require(modulePaths.claudeAuthorityAdmission).createClaudeAuthorityAdmission,
  authorityTransactions: require(modulePaths.authorityTransactions).createAuthorityTransactions,
  roleCommandGrant: require(modulePaths.roleCommandGrant).createRoleCommandGrant,
  lifecycleCommandGrant: require(modulePaths.lifecycleCommandGrant).createLifecycleCommandGrant,
  orchestratorRoleBindings: require(modulePaths.orchestratorRoleBindings).createOrchestratorRoleBindings,
  requesterBindingModule: require(modulePaths.requesterBindingModule).createRequesterBindingModule,
  executionClaimModule: require(modulePaths.executionClaimModule).createExecutionClaimModule,
  roleSpawnExecutionClaim: require(modulePaths.roleSpawnExecutionClaim).createRoleSpawnExecutionClaim,
  directRoleHostAdmission: require(modulePaths.directRoleHostAdmission).createDirectRoleHostAdmission,
  claudeAgentSpawnReservation: require(modulePaths.claudeAgentSpawnReservation).createClaudeAgentSpawnReservation,
  rootConsultRecords: require(modulePaths.rootConsultRecords).createRootConsultRecords,
  s16ContextResolution: require(modulePaths.s16ContextResolution).createS16ContextResolution,
  p2SubjectBundle: require(modulePaths.p2SubjectBundle).createP2SubjectBundle,
  mixedReviewRecords: require(modulePaths.mixedReviewRecords).createMixedReviewRecords,
  prepPublicationRecords: require(modulePaths.prepPublicationRecords).createPrepPublicationRecords,
  supervisorLifecycleOwner: require(modulePaths.supervisorLifecycleOwner).createSupervisorLifecycleOwner,
  supervisorBatchMint: require(modulePaths.supervisorBatchMint).createSupervisorBatchMint,
  teamEnsure: require(modulePaths.teamEnsure).createTeamEnsure,
  resumeCheckpoint: require(modulePaths.resumeCheckpoint).createResumeCheckpoint,
  ensureHandler: require(modulePaths.ensureHandler).createEnsureHandler,
  cliNotifyHandler: require(modulePaths.cliNotifyHandler).createCliNotifyHandler,
  cliTerminalize: require(modulePaths.cliTerminalize).createCliTerminalize,
  cliActionReadyHandlers: require(modulePaths.cliActionReadyHandlers).createCliActionReadyHandlers,
  cliRotateStopHandlers: require(modulePaths.cliRotateStopHandlers).createCliRotateStopHandlers,
  cliConsultHandlers: require(modulePaths.cliConsultHandlers).createCliConsultHandlers,
  cliRootSourceHandlers: require(modulePaths.cliRootSourceHandlers).createCliRootSourceHandlers,
  prepPublicationReserve: require(modulePaths.prepPublicationReserve).createPrepPublicationReserve,
  prepPublicationGrammar: require(modulePaths.prepPublicationGrammar).createPrepPublicationGrammar,
  p2Materialization: require(modulePaths.p2Materialization).createP2Materialization,
  cliDispatch: require(modulePaths.cliDispatch).createCliDispatch,
  cliEnvelope: require(modulePaths.cliEnvelope).createCliEnvelope,
  policySchema: require(modulePaths.policySchema).createPolicySchema,
  posixDirect: require(modulePaths.posixDirect).createPosixDirect,
  structuralValidators: require(modulePaths.structuralValidators).createStructuralValidators,
  m7Rendezvous: require(modulePaths.m7Rendezvous).createM7Rendezvous,
  retainedSupervisorReconciliation: require(modulePaths.retainedSupervisorReconciliation).createRetainedSupervisorReconciliation,
  managedLifecycleGrant: require(modulePaths.managedLifecycleGrant).createManagedLifecycleGrant,
});

test('lifecycle modules stay bounded and never import the facade, bridge, or consultation', () => {
  for (const [name, modulePath] of Object.entries(modulePaths)) {
    const source = fs.readFileSync(modulePath, 'utf8');
    const sourceLines = source.split(/\r?\n/);
    const lineCount = sourceLines.length;
    assert.ok(lineCount <= 500, `${name} has ${lineCount} lines; limit is 500`);
    if (seq12Modules.includes(name)) {
      const maxLineLength = Math.max(...sourceLines.map((l) => l.length));
      assert.ok(maxLineLength <= 320, `${name} has a line ${maxLineLength} chars long; limit is 320`);
    }
    assert.doesNotMatch(source, /require\s*\([^)]*runtime-role-lifecycle\.cjs/);
    assert.doesNotMatch(source, /require\s*\([^)]*runtime-bridge-codex\.cjs/);
    assert.doesNotMatch(source, /require\s*\([^)]*runtime-consultation\.cjs/);
    // Every module's own factory (or factories) must return a frozen surface,
    // never a mutable object leaking internal state.
    assert.match(source, /return Object\.freeze\(\{/, `${name} must return a frozen factory surface`);
  }
});

test('the facade itself stays within its thin-composition/CLI-controller line and length budget', () => {
  const source = fs.readFileSync(facadePath, 'utf8');
  const sourceLines = source.split(/\r?\n/);
  assert.ok(sourceLines.length <= 1500, `facade has ${sourceLines.length} lines; limit is 1500`);
  const maxLineLength = Math.max(...sourceLines.map((l) => l.length));
  assert.ok(maxLineLength <= 320, `facade has a line ${maxLineLength} chars long; limit is 320`);
});

test('no lifecycle module function name is defined more than once across the facade and module tree', () => {
  const facadeSource = fs.readFileSync(facadePath, 'utf8');
  const declRe = /^function ([A-Za-z0-9_]+)\(/gm;
  const seen = new Map();
  function record(sourceLabel, source) {
    let m;
    const re = new RegExp(declRe.source, declRe.flags);
    while ((m = re.exec(source))) {
      const name = m[1];
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push(sourceLabel);
    }
  }
  record('facade', facadeSource);
  for (const [name, modulePath] of Object.entries(modulePaths)) {
    record(name, fs.readFileSync(modulePath, 'utf8'));
  }
  for (const [name, locations] of seen) {
    assert.strictEqual(locations.length, 1, `${name} is defined in more than one place: ${locations.join(', ')}`);
  }
});

test('runtime identity, private registry, and session generation are closed factory surfaces', () => {
  const runtimeIdentity = factories.runtimeIdentity({ CANONICAL_ROLES: [] });
  const privateRegistry = factories.privateRegistry({});
  const sessionGeneration = factories.sessionGeneration({});

  for (const surface of [runtimeIdentity, privateRegistry, sessionGeneration]) {
    assert.ok(Object.isFrozen(surface));
  }
  assert.deepStrictEqual(Object.keys(runtimeIdentity).sort(), [
    'computeCoordinationRootId', 'computeCoordinationRootIdFromPath', 'computePrincipalId',
    'computeRepoId', 'computeWorktreeId', 'coordinationRootPathFor', 'deepestExistingAncestorRealpath',
    'discoverPlan', 'resolveCanonicalRoleProfile', 'roleProfileDigestFor', 'templateRootBase',
  ]);
  assert.deepStrictEqual(Object.keys(privateRegistry).sort(), [
    'ensureSecureRegistryDir', 'readRegistryRecord', 'registryBaseDir', 'registryRepoDir',
    'windowsCommonApplicationDataRoot', 'withRegistryLock', 'writeRegistryRecordReplace',
  ]);
  assert.deepStrictEqual(Object.keys(sessionGeneration).sort(), [
    'IDENTITY_PROVIDER_ENUM', 'MAX_RUNTIME_SESSION_KEY_BYTES', 'SESSION_GENERATION_KEYS',
    'currentClockMsForRegistry',
    'futureIsoForRegistry', 'getRuntimeIdentity', 'isCanonicalIsoUtc',
    'isoPlusSecondsForRegistry', 'isoToMsForRegistry', 'nowIsoForRegistry',
    'peekSessionGeneration', 'readLiveSessionGenerationById', 'resolveSessionGeneration',
    'safeExpiryIsoForRegistry', 'sessionGenerationPathFor', 'sessionLookupKey',
  ]);
});

test('Claude peer, resume, and one-shot factories expose closed immutable surfaces', () => {
  const peer = factories.peer({});
  const resumeRecord = factories.resumeRecord({});
  const resumeLifecycle = factories.resumeLifecycle(resumeRecord);
  const oneShotRecord = factories.oneShotRecord({});
  const oneShotOperations = factories.oneShotOperations({});

  assert.strictEqual(peer.CLAUDE_PEER_BINDING_SCHEMA, 'runtime/claude-peer-binding/v1');
  assert.strictEqual(resumeRecord.CLAUDE_RESUME_HANDLE_SCHEMA, 'runtime/claude-resume-handle/v1');
  assert.strictEqual(oneShotRecord.CLAUDE_ONE_SHOT_BINDING_SCHEMA, 'runtime/claude-one-shot-binding/v1');
  assert.strictEqual(oneShotRecord.CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2, 'runtime/claude-one-shot-binding/v2');
  for (const value of [peer, resumeRecord, resumeLifecycle, oneShotRecord, oneShotOperations]) {
    assert.ok(Object.isFrozen(value));
  }
  for (const value of [
    peer.CLAUDE_PEER_BINDING_KEYS,
    resumeRecord.CLAUDE_RESUME_HANDLE_KEYS,
    oneShotRecord.CLAUDE_ONE_SHOT_BINDING_KEYS,
    oneShotRecord.CLAUDE_ONE_SHOT_BINDING_KEYS_V2,
    oneShotOperations.CLAUDE_ONE_SHOT_BINDING_RETIREMENT_REASON_ENUM,
  ]) assert.ok(Object.isFrozen(value));
});

test('facade composes one-shot authority without a module cycle', () => {
  const source = fs.readFileSync(facadePath, 'utf8');
  const peerAt = source.indexOf('const claudePeerBinding = createClaudePeerBinding');
  const resumeRecordAt = source.indexOf('const claudeResumeRecord = createClaudeResumeRecord');
  const resumeLifecycleAt = source.indexOf('const claudeResumeLifecycle = createClaudeResumeLifecycle');
  const oneShotOperationsAt = source.indexOf('const claudeOneShotOperations = createClaudeOneShotOperations');
  const oneShotRecordAt = source.indexOf('const claudeOneShotRecord = createClaudeOneShotRecord');
  const classifierAt = source.indexOf('const claudeAuthorityClassifier = createClaudeAuthorityClassifier');

  assert.ok(peerAt > 0);
  assert.ok(resumeRecordAt > peerAt);
  assert.ok(resumeLifecycleAt > resumeRecordAt);
  assert.ok(oneShotRecordAt > oneShotOperationsAt);
  assert.ok(classifierAt > oneShotRecordAt);
  assert.match(source.slice(resumeLifecycleAt, resumeLifecycleAt + 1200), /\.\.\.claudeResumeRecord/);
  assert.match(source.slice(oneShotRecordAt, classifierAt), /classifyClaudeAuthorityForIdentity: \(\.\.\.args\) =>/);
  assert.doesNotMatch(
    fs.readFileSync(modulePaths.oneShotRecord, 'utf8'),
    /require\s*\([^)]*claude-one-shot-operations/,
  );
});

test('CLAUDE-ID-01 factories expose closed schemas and function surfaces', () => {
  const scope = factories.scope({});
  const trace = factories.trace(scope);
  const startup = factories.startup(scope);
  const observations = factories.observations({ ...scope, ...trace, ...startup });

  assert.strictEqual(scope.CLAUDE_ID01_TRACE_SCHEMA, 'runtime/claude-id01-trace/v1');
  assert.strictEqual(scope.CLAUDE_ID01_ATTESTATION_SCHEMA, 'runtime/claude-id01-attestation/v1');
  assert.strictEqual(scope.CLAUDE_ID01_CAPABILITY_SCHEMA, 'runtime/claude-id01-capability/v1');
  assert.strictEqual(startup.CLAUDE_ID01_CAPABILITY_V2_SCHEMA, 'runtime/claude-id01-capability/v2');

  for (const fn of [
    scope.resolveClaudeId01Scope,
    trace.isClaudeId01AttestationWellFormed,
    startup.checkClaudeId01ProofComplete,
    observations.recordClaudeId01SubagentStartObservation,
  ]) assert.strictEqual(typeof fn, 'function');

  assert.ok(Object.isFrozen(scope));
  assert.ok(Object.isFrozen(trace));
  assert.ok(Object.isFrozen(startup));
  assert.ok(Object.isFrozen(observations));
});

test('facade composes the one-way scope to trace/startup to observations DAG', () => {
  const source = fs.readFileSync(facadePath, 'utf8');
  const scopeAt = source.indexOf('const claudeId01Scope = createClaudeId01Scope');
  const traceAt = source.indexOf('const claudeId01Trace = createClaudeId01Trace');
  const startupAt = source.indexOf('const claudeId01Startup = createClaudeId01Startup');
  const observationsAt = source.indexOf('const claudeId01Observations = createClaudeId01Observations');

  assert.ok(scopeAt > 0);
  assert.ok(traceAt > scopeAt);
  assert.ok(startupAt > scopeAt);
  assert.ok(observationsAt > traceAt && observationsAt > startupAt);
  assert.match(source.slice(traceAt, startupAt), /\.\.\.claudeId01Scope/);
  assert.match(source.slice(startupAt, observationsAt), /\.\.\.claudeId01Scope/);
  assert.match(source.slice(observationsAt), /\.\.\.claudeId01Trace/);
  assert.match(source.slice(observationsAt), /\.\.\.claudeId01Startup/);
});

test('facade preserves the public CLAUDE-ID-01 schema and callable exports', () => {
  const facade = require(facadePath);
  const scope = factories.scope({});
  const startup = factories.startup(scope);

  assert.strictEqual(facade.CLAUDE_ID01_TRACE_SCHEMA, scope.CLAUDE_ID01_TRACE_SCHEMA);
  assert.strictEqual(facade.CLAUDE_ID01_ATTESTATION_SCHEMA, scope.CLAUDE_ID01_ATTESTATION_SCHEMA);
  assert.strictEqual(facade.CLAUDE_ID01_CAPABILITY_SCHEMA, scope.CLAUDE_ID01_CAPABILITY_SCHEMA);
  assert.strictEqual(facade.CLAUDE_ID01_CAPABILITY_V2_SCHEMA, startup.CLAUDE_ID01_CAPABILITY_V2_SCHEMA);

  for (const name of [
    'recordClaudeId01SubagentStartObservation',
    'recordClaudeId01PreToolUseObservation',
    'recordClaudeStartupActorObservation',
    'recordClaudeStartupReadyPreObservation',
    'recordClaudeStartupReadyOutcome',
    'deleteClaudeId01TraceForSession',
    'checkClaudeId01ProofComplete',
    'checkClaudeId01RuntimeCapability',
    'isClaudeId01AttestationWellFormed',
  ]) assert.strictEqual(typeof facade[name], 'function', `${name} must remain exported`);
});

test('lifecycle core factories expose closed immutable surfaces', () => {
  const surfaces = [
    factories.roleBindingState({}),
    factories.supervisorReadyTransition({}),
    factories.roleCapabilityRouting({}),
    factories.diskConsumerRegistration({}),
    factories.lifecycleActionRecord({}),
    factories.lifecycleActionPayloads({}),
    factories.lifecycleArgv({}),
  ];

  for (const surface of surfaces) assert.ok(Object.isFrozen(surface));
  assert.ok(Object.isFrozen(surfaces[0].ROLE_BINDING_STATE_ENUM));
  assert.ok(Object.isFrozen(surfaces[0].ROLE_BINDING_TRANSITIONS));
  assert.ok(Object.isFrozen(surfaces[2].LIFECYCLE_INELIGIBLE_DRIVERS));
  assert.ok(Object.isFrozen(surfaces[4].ACTION_KIND_ENUM));
  assert.ok(Object.isFrozen(surfaces[4].ACTION_KIND_RUNTIME));
  assert.ok(Object.isFrozen(surfaces[6].SUBCOMMAND_SPEC));
});

test('root-source contract preserves immutable bootstrap history byte-for-byte', () => {
  const facade = require(facadePath);
  const contract = factories.rootSourceContract({ rootSourceBootstrapLines: factories.rootSourceBootstrapLines({}) });
  const history = contract.ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY;
  assert.ok(Object.isFrozen(history));
  assert.strictEqual(history.length, 16);
  assert.strictEqual(history[history.length - 1], contract.ROOT_SOURCE_BOOTSTRAP_FINAL_LINE);
  assert.strictEqual(facade.ROOT_SOURCE_BOOTSTRAP_FINAL_LINE, undefined);
  assert.strictEqual(new Set(history).size, history.length);
  for (const value of history) {
    assert.strictEqual(typeof value, 'string');
    assert.ok(value.length > 0);
  }
});

test('Claude authority admission capability is reference-bound and one-use within one factory', () => {
  const future = '2999-01-01T00:00:00Z';
  const surface = factories.claudeAuthorityAdmission({
    canonicalJSONStringify: JSON.stringify,
    checkAuthorityOperationTransactionTerminal: () => ({ ok: true }),
    checkOneShotTransactionTerminalAbsent: () => ({ ok: true }),
    classifyClaudeAuthorityForIdentity: () => ({ ok: true, state: 'ABSENT' }),
    currentClockMsForRegistry: () => 0,
    isCanonicalIsoUtc: (value) => value === future,
    isoToMsForRegistry: () => 1,
    sha256String: () => '0'.repeat(64),
  });
  const admitted = surface.admitClaudeAuthorityOperation({}, {}, 'create-binding', future);
  assert.strictEqual(admitted.ok, true);
  let writes = 0;
  assert.deepStrictEqual(
    surface.writeGuardedByClaudeAuthorityAdmission(admitted.capability, 'create-binding', () => {
      writes += 1;
      return { ok: true };
    }),
    { ok: true },
  );
  assert.strictEqual(writes, 1);
  assert.strictEqual(surface.writeGuardedByClaudeAuthorityAdmission(
    admitted.capability, 'create-binding', () => ({ ok: true }),
  ).ok, false);
  assert.strictEqual(surface.isValidClaudeAuthorityAdmissionCapability(
    Object.freeze({ ...admitted.capability }), 'create-binding',
  ), false);
});

test('facade preserves its 271-key ABI and re-exports core factory references', () => {
  const coreFactoryNames = Object.freeze({
    runtimeIdentity: 'createRuntimeIdentityModule',
    privateRegistry: 'createPrivateRegistryModule',
    sessionGeneration: 'createSessionGenerationModule',
    roleBindingState: 'createRoleBindingState',
    supervisorReadyTransition: 'createSupervisorReadyTransition',
    roleCapabilityRouting: 'createRoleCapabilityRouting',
    diskConsumerRegistration: 'createDiskConsumerRegistration',
    lifecycleActionRecord: 'createLifecycleActionRecord',
    lifecycleActionPayloads: 'createLifecycleActionPayloads',
    lifecycleArgv: 'createLifecycleArgv',
    rootSourceContract: 'createRootSourceContract',
    rootSourceReservation: 'createRootSourceReservation',
    rootSourceBindingAdmission: 'createRootSourceBindingAdmission',
    rootSourceBindingRecords: 'createRootSourceBindingRecords',
    rootSourceLiveIndex: 'createRootSourceLiveIndex',
    claudeAuthorityClassifier: 'createClaudeAuthorityClassifier',
    claudeAuthorityAdmission: 'createClaudeAuthorityAdmission',
    authorityTransactions: 'createAuthorityTransactions',
    roleCommandGrant: 'createRoleCommandGrant',
    lifecycleCommandGrant: 'createLifecycleCommandGrant',
    orchestratorRoleBindings: 'createOrchestratorRoleBindings',
    requesterBindingModule: 'createRequesterBindingModule',
    executionClaimModule: 'createExecutionClaimModule',
    roleSpawnExecutionClaim: 'createRoleSpawnExecutionClaim',
    directRoleHostAdmission: 'createDirectRoleHostAdmission',
    claudeAgentSpawnReservation: 'createClaudeAgentSpawnReservation',
    rootConsultRecords: 'createRootConsultRecords',
    s16ContextResolution: 'createS16ContextResolution',
    p2SubjectBundle: 'createP2SubjectBundle',
    mixedReviewRecords: 'createMixedReviewRecords',
    prepPublicationRecords: 'createPrepPublicationRecords',
    supervisorLifecycleOwner: 'createSupervisorLifecycleOwner',
    supervisorBatchMint: 'createSupervisorBatchMint',
    teamEnsure: 'createTeamEnsure',
    resumeCheckpoint: 'createResumeCheckpoint',
    ensureHandler: 'createEnsureHandler',
    cliNotifyHandler: 'createCliNotifyHandler',
    cliTerminalize: 'createCliTerminalize',
    cliActionReadyHandlers: 'createCliActionReadyHandlers',
    cliRotateStopHandlers: 'createCliRotateStopHandlers',
    cliConsultHandlers: 'createCliConsultHandlers',
    cliRootSourceHandlers: 'createCliRootSourceHandlers',
    prepPublicationReserve: 'createPrepPublicationReserve',
    prepPublicationGrammar: 'createPrepPublicationGrammar',
    p2Materialization: 'createP2Materialization',
    cliDispatch: 'createCliDispatch',
    cliEnvelope: 'createCliEnvelope',
    policySchema: 'createPolicySchema',
    posixDirect: 'createPosixDirect',
    structuralValidators: 'createStructuralValidators',
    m7Rendezvous: 'createM7Rendezvous',
    retainedSupervisorReconciliation: 'createRetainedSupervisorReconciliation',
    managedLifecycleGrant: 'createManagedLifecycleGrant',
  });
  const originals = new Map();
  const captured = {};

  delete require.cache[require.resolve(facadePath)];
  try {
    for (const [key, factoryName] of Object.entries(coreFactoryNames)) {
      const moduleExports = require(modulePaths[key]);
      const original = moduleExports[factoryName];
      originals.set(moduleExports, [factoryName, original]);
      moduleExports[factoryName] = (deps) => {
        const surface = original(deps);
        captured[key] = surface;
        return surface;
      };
    }

    const facade = require(facadePath);
    const publicKeys = Object.keys(facade).sort();
    assert.strictEqual(publicKeys.length, 271);
    assert.strictEqual(Object.isFrozen(facade), false);
    for (const surface of Object.values(captured)) {
      for (const [name, value] of Object.entries(surface)) {
        if (Object.prototype.hasOwnProperty.call(facade, name)) {
          assert.strictEqual(facade[name], value, `${name} must be the composed factory reference`);
        }
      }
    }

    facade.__boundaryMonkeyPatch = true;
    assert.strictEqual(facade.__boundaryMonkeyPatch, true);
    delete facade.__boundaryMonkeyPatch;

    delete require.cache[require.resolve(facadePath)];
    const reloaded = require(facadePath);
    assert.deepStrictEqual(Object.keys(reloaded).sort(), publicKeys);
  } finally {
    for (const [moduleExports, [factoryName, original]] of originals) {
      moduleExports[factoryName] = original;
    }
    delete require.cache[require.resolve(facadePath)];
  }
});

// ── Sequence-12 characterization tests: newly extracted stateful/effectful
// boundaries, including negative fail-closed paths ─────────────────────────

test('PREP-publication grammar parser fails closed on a hostile intent shape, a CR/NUL byte, and a non-Buffer input', () => {
  const grammar = factories.prepPublicationGrammar({});
  const validIntent = {
    role: 'arch-platform', wave_slug: 'wave-1',
    head: 'a'.repeat(40), plan_sha256: 'b'.repeat(64), publication_nonce: 'c'.repeat(32),
  };
  assert.strictEqual(grammar.validatePrepPublicationGrammar(Buffer.from('x'), { ...validIntent, role: 'not-a-role' }).ok, false);
  assert.strictEqual(grammar.validatePrepPublicationGrammar('not-a-buffer', validIntent).ok, false);
  assert.strictEqual(
    grammar.validatePrepPublicationGrammar(Buffer.from([0x41, 0x0d, 0x42]), validIntent).ok, false,
    'a bare CR byte must fail closed, never be silently normalized',
  );
  assert.strictEqual(
    grammar.validatePrepPublicationGrammar(Buffer.from([0x00]), validIntent).ok, false,
    'a bare NUL byte must fail closed',
  );
  assert.ok(Object.isFrozen(grammar));
});

test('supervisor-lifecycle-owner PID identity shape check fails closed on every hostile input', () => {
  const owner = factories.supervisorLifecycleOwner({
    hasExactKeys: (obj, sortedExpectedKeys) => obj && typeof obj === 'object'
      && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify(sortedExpectedKeys),
  });
  assert.strictEqual(owner.isSupervisorPidIdentityShape(null), false);
  assert.strictEqual(owner.isSupervisorPidIdentityShape('not-an-object'), false);
  assert.strictEqual(owner.isSupervisorPidIdentityShape({}), false);
  assert.strictEqual(owner.isSupervisorPidIdentityShape({ pid: 1, executable: 'node', birth_observed_at: 1, extra: true }), false);
  assert.ok(Object.isFrozen(owner));
});

test('resume-checkpoint respawn-budget boundary is exact and fails closed at and past the ceiling', () => {
  const resumeCheckpoint = factories.resumeCheckpoint({});
  assert.strictEqual(resumeCheckpoint.respawnBudgetExceeded({ respawn_count: 0 }, { max_respawns_per_role: 1 }), false);
  assert.strictEqual(resumeCheckpoint.respawnBudgetExceeded({ respawn_count: 1 }, { max_respawns_per_role: 1 }), true);
  assert.strictEqual(resumeCheckpoint.respawnBudgetExceeded({ respawn_count: 2 }, { max_respawns_per_role: 1 }), true);
  assert.strictEqual(resumeCheckpoint.respawnBudgetExceeded({}, { max_respawns_per_role: 0 }), true);
});

test('cli-dispatch exposes a closed, frozen subcommand table and fails closed (never throws) for an unknown or empty argv', () => {
  const seenResults = [];
  const cliDispatch = factories.cliDispatch({
    usageError: (command) => seenResults.push({ kind: 'usage', command }),
    makeResult: (command, code, status, detailCode) => ({ command, code, status, detailCode }),
    RC: { INTERNAL: 7 },
    emitAndExit: (result) => seenResults.push({ kind: 'emit', result }),
    handleProbe: () => {}, handleEnsure: () => {}, handleNotify: () => {}, handleActionFailed: () => {},
    handleReady: () => {}, handleWaitReady: () => {}, handleStatus: () => {}, handleConsultRoot: () => {},
    handleMixedReviewRequest: () => {}, handleConsultRootStatus: () => {}, handleRootSource: () => {},
    handleRootSourceStatus: () => {}, handleRotate: () => {}, handleStopOwned: () => {},
  });
  assert.ok(Object.isFrozen(cliDispatch));
  assert.ok(Object.isFrozen(cliDispatch.HANDLERS));
  assert.deepStrictEqual(Object.keys(cliDispatch.HANDLERS).sort(), [
    'action-failed', 'consult-root', 'consult-root-status', 'ensure', 'mixed-review-request',
    'notify', 'probe', 'ready', 'root-source', 'root-source-status', 'rotate', 'status',
    'stop-owned', 'wait-ready',
  ]);
  cliDispatch.main(['not-a-real-subcommand']);
  assert.deepStrictEqual(seenResults, [{ kind: 'usage', command: '' }]);
  seenResults.length = 0;
  cliDispatch.main([]);
  assert.deepStrictEqual(seenResults, [{ kind: 'usage', command: '' }]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequence 17: whole-tree readability gate. Walks the module directory itself
// (not just modulePaths) so a future nested module is bounded even if someone
// forgets to extend the map above, and enforces <=320 chars/line across every
// module -- not only the seq12Modules allowlist -- plus a per-function length
// cap. Mirrors the equivalent bridge/consultation whole-tree gates.
// ─────────────────────────────────────────────────────────────────────────────

function discoverLifecycleModules(directory) {
  const discovered = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).slice().sort()) {
      const entryPath = path.join(dir, name);
      const stat = fs.lstatSync(entryPath);
      assert.strictEqual(stat.isSymbolicLink(), false, `${entryPath} must not be a symlink`);
      if (stat.isDirectory()) walk(entryPath);
      else if (stat.isFile() && name.endsWith('.cjs')) discovered.push(entryPath);
    }
  };
  walk(directory);
  return discovered;
}

test('every recursive lifecycle module stays at or below 500 lines and 320 chars/line', () => {
  const discovered = discoverLifecycleModules(moduleDir);
  const expectedPaths = Object.values(modulePaths).slice().sort();
  assert.deepStrictEqual(discovered.slice().sort(), expectedPaths);
  for (const modulePath of discovered) {
    const fileLines = fs.readFileSync(modulePath, 'utf8').split(/\r?\n/);
    assert.ok(fileLines.length <= 500, `${modulePath} has ${fileLines.length} lines (max 500)`);
    const maxLineLength = Math.max(...fileLines.map((l) => l.length));
    assert.ok(maxLineLength <= 320, `${modulePath} has a ${maxLineLength}-char line (max 320)`);
  }
});

// Blanks comment/string/template contents (preserving every newline and
// overall character offset) so stray brace-shaped characters inside prose
// comments or embedded frozen string constants can never desync the
// brace-depth counter below. Regex literals are left as-is: their `{n,m}`
// quantifiers are always self-balanced, so they cannot skew the count.
function lastSignificantChar(out) {
  const t = out.replace(/[ \t]+$/, '');
  return t.length ? t[t.length - 1] : '';
}
function lastSignificantWord(out) {
  const m = out.match(/([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*$/);
  return m ? m[1] : '';
}
const REGEX_PRECEDING_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'throw', 'void', 'instanceof', 'do', 'else', 'yield']);
function blankCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += ' '; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += (src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) { out += ' '; i++; }
      continue;
    }
    if (c === '/') {
      const prevChar = lastSignificantChar(out);
      const prevWord = lastSignificantWord(out);
      const regexPosition = prevChar === '' || '([{,;:=!&|?+-*%^~<>'.includes(prevChar) || REGEX_PRECEDING_KEYWORDS.has(prevWord);
      if (regexPosition) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') { inClass = true; j++; continue; }
          if (src[j] === ']') { inClass = false; j++; continue; }
          if (src[j] === '/' && !inClass) { j++; break; }
          if (src[j] === '\n') break;
          j++;
        }
        if (src[j - 1] === '/') {
          while (j < n && /[a-z]/i.test(src[j])) j++;
          for (let k = i; k < j; k++) out += (src[k] === '\n' ? '\n' : ' ');
          i = j;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

test('no function body left in the facade or any lifecycle module exceeds 500 lines', () => {
  const sources = [facadePath, ...discoverLifecycleModules(moduleDir)];
  for (const sourcePath of sources) {
    const rawSource = fs.readFileSync(sourcePath, 'utf8');
    const fileLines = rawSource.split(/\r?\n/);
    const scanLines = blankCommentsAndStrings(rawSource).split(/\r?\n/);
    assert.equal(scanLines.length, fileLines.length, `${sourcePath} line count desynced while blanking comments/strings`);
    for (let i = 0; i < scanLines.length; i++) {
      const m = scanLines[i].match(/^\s*(?:async\s+)?function\s*\*?\s*[A-Za-z0-9_$]*\s*\(/);
      if (!m) continue;
      let depth = 0;
      let started = false;
      let end = -1;
      for (let j = i; j < scanLines.length; j++) {
        for (const ch of scanLines[j]) {
          if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
        }
        if (started && depth === 0) { end = j; break; }
      }
      assert.ok(end !== -1, `${sourcePath}:${i + 1} function never closes its own braces`);
      const bodyLines = end - i + 1;
      assert.ok(
        bodyLines <= 500,
        `${sourcePath}:${i + 1} function body is ${bodyLines} lines (max 500)`,
      );
    }
  }
});
