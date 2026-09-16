'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const facadePath = path.join(repoRoot, 'scripts', 'lib', 'runtime-bridge-codex.cjs');
const moduleDir = path.join(repoRoot, 'scripts', 'lib', 'runtime-bridge-codex');
const expectedModules = Object.freeze([
  'app-server-connection-lifecycle.cjs',
  'app-server-connection-state.cjs',
  'app-server-credential-refresh.cjs',
  'app-server-diagnostics.cjs',
  'app-server-framing.cjs',
  'app-server-pin.cjs',
  'app-server-pinned-image.cjs',
  'app-server-protocol-schema.cjs',
  'app-server-rpc-dispatch.cjs',
  'app-server-rpc-methods.cjs',
  'app-server-supervisor-role-bootstrap.cjs',
  'app-server-supervisor-retained-polling.cjs',
  'app-server-supervisor-startup-preflight.cjs',
  'app-server-supervisor-state.cjs',
  'app-server-supervisor-stop-receipt.cjs',
  'app-server-supervisor-stop-request.cjs',
  'app-server-supervisor-stop-timeline.cjs',
  'app-server-supervisor-worker-spawn.cjs',
  'app-server-turn-completion.cjs',
  'app-server-turn-correlation.cjs',
  'child-process-registry.cjs',
  'child-spawn.cjs',
  'cleanup-record-validation.cjs',
  'credential-checkpoint-authority.cjs',
  'credential-evidence-schema.cjs',
  'credential-evidence-store.cjs',
  'credential-memory.cjs',
  'credential-run-binding.cjs',
  'credential-run-context.cjs',
  'credential-run-finalization.cjs',
  'credential-run-support.cjs',
  'credential-source-provider.cjs',
  'credential-source-read.cjs',
  'identifiers.cjs',
  'isolation-authority.cjs',
  'isolation-identity.cjs',
  'isolation-provider.cjs',
  'isolation-root-access.cjs',
  'isolation-root-cleanup.cjs',
  'isolation-root-create.cjs',
  'isolation-root-finalize.cjs',
  'isolation-topology.cjs',
  'instance-retirement.cjs',
  'owned-child-provenance.cjs',
  'preflight-probes.cjs',
  'process-identity.cjs',
  'registry-record-io.cjs',
  'role-owner-registry.cjs',
  'root-recovery.cjs',
  'session-run-admission.cjs',
  'session-run-test-backend.cjs',
  'supervisor-ledger-cleanup.cjs',
  'tombstone-reaper.cjs',
  // Sequence 15 (thin facade decomposition).
  'session-run-timer-state.cjs', 'owned-child-stop.cjs', 'async-race-utils.cjs',
  'session-run-shutdown-coordinator.cjs', 'session-run-timer-scheduling.cjs',
  'session-run-read-view.cjs', 'worker-presence.cjs', 'live-worker-resolution.cjs',
  'internal-search-mcp.cjs', 'context7-request.cjs',
  'turn-projection-io.cjs', 'turn-projection-build.cjs',
  'retained-turn-inputs.cjs', 'worker-turn-execution.cjs', 'retained-worker-request.cjs',
  'p2-prep-verdict.cjs', 'p2-prep-reservation.cjs', 'p2-review-context.cjs', 'p2-review-thread.cjs',
  'root-mixed-review.cjs', 'cmd-session-run.cjs',
  'owned-app-server-supervisor-engine.cjs', 'app-server-connection.cjs',
  'deterministic-mcp-loopback.cjs', 'cli-shared-confinement.cjs', 'cmd-runtime-spawn.cjs',
  'cmd-claude-mcp-launch.cjs', 'cmd-mcp-serve.cjs', 'cmd-worker-cleanup.cjs', 'cmd-conformance.cjs',
  'cmd-conformance-app-server.cjs',
]);

const productionExports = Object.freeze([
  'INITIAL_ISOLATION_CONFIG_TOML', 'RC', 'buildRuntimeTurnEnvelopeOutputSchema',
  'childEnvFromTopology', 'claimRoleOwner', 'classifyProcessIdentityLiveness',
  'classifyProvisioningOwner', 'closedMcpEnvironment', 'computeCoordinationRootId',
  'computeRootId', 'createAbandonedRootRecoveryAuthority', 'createAppServerConnection',
  'createCaptureRegistry', 'createCredentialSourceProvider', 'createFdBoundValidatedScope',
  'createIsolationProvider', 'createJsonlFrameFeeder', 'createOrphanedProvisioningRecoveryAuthority',
  'createRunAuthorities', 'createSecretMatcher', 'createSupervisorOwnedChildRegistry',
  'defaultProcessIdentityProvider', 'describeBornProvenanceFailure', 'describeInitializeFailure',
  'describeOwnedChildExit', 'describeOwnedChildState', 'describeOwnedChildStderr',
  'describeThreadStartFailure', 'findExistingRoleOwner', 'isolationRootChildPathBudget',
  'observeWindowsProcessBirth', 'parseSessionRunArgv', 'probeAppServerLiveCapability',
  'reapTombstonedRoot', 'releaseConfirmedDeadSupervisorOwners', 'releaseOwnedRoleOwner',
  'requireProvenProcessIdentity', 'resolveAppServerSpawnCommand', 'resolveLiveCodexAppServerWorker',
  'resolvedWindowsPowerShellPath', 'retainedSessionGenerationStatus', 'retireInstanceRecord',
  'revalidateSupervisorStartAction', 'roleOwnerPathFor', 'sessionGenerationIsLive',
  'spawnWithIntent', 'strictConfigValidatorForSessionRun', 'validateBindingsPendThisAction',
  'validateRuntimeTurnEnvelope', 'writeJsonlFrame',
].sort());

const testOnlyExports = Object.freeze([
  '__testOnlyAppendHostProjectedP2SourceEvidence', '__testOnlyBuildP2RetainedReviewTurnInput',
  '__testOnlyBuildPatternEvidenceTurnInput', '__testOnlyBuildResumedTurnInput',
  '__testOnlyBuildRootTurnInput', '__testOnlyBuildTurnReadProjection',
  '__testOnlyCollectPendingMixedReviewRequest', '__testOnlyCompleteDeterministicMcpRendezvous',
  '__testOnlyContextProviderEvidenceInstructions', '__testOnlyCreateDeterministicMcpFrameDecoder',
  '__testOnlyCreateSessionRunReadViewAuthority', '__testOnlyEncodeDeterministicMcpFrame',
  '__testOnlyExecuteContext7Sequence', '__testOnlyExecuteMixedReviewRequest',
  '__testOnlyInspectCredentialRefreshOutcome', '__testOnlyInspectFinalizationState',
  '__testOnlyP5MixedReviewTurnInputFor', '__testOnlyR2ProbeSchemaGenerationLive',
  '__testOnlyR2ReadOwnedAuthFileSecurely', '__testOnlyR2SchemaKeysStructurallyPresent',
  '__testOnlyReadOwnedStableBuffer', '__testOnlyReadProtectedHostCodexPin',
  '__testOnlyResolveSessionRunSpawnCommand', '__testOnlyRunContextProviderInternalSearch',
  '__testOnlyStartOwnedAppServerSupervisorEngine', '__testOnlySupervisorBaseInstructions',
  '__testOnlyValidatePinnedCodexExecutable', 'computeCredentialEvidenceComplete',
  'createCredentialSourceProviderForFdTests',
].sort());

function freshFacade() {
  delete require.cache[require.resolve(facadePath)];
  return require(facadePath);
}

function exportsFromFreshProcess(testCapability) {
  const script = [
    testCapability ? "process.env.NODE_ENV='test';process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY='boundary';" : "delete process.env.NODE_ENV;delete process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY;",
    `process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(facadePath)})).sort()));`,
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('startup module tree is bounded and has no upward facade dependency', () => {
  const actualModules = new Set();
  for (const name of fs.readdirSync(moduleDir).slice().sort()) {
    const filePath = path.join(moduleDir, name);
    const stat = fs.lstatSync(filePath);
    assert.equal(stat.isSymbolicLink(), false, `${name} must not be a symlink`);
    if (stat.isFile() && name.endsWith('.cjs')) actualModules.add(name);
  }
  assert.deepEqual([...actualModules].sort(), [...expectedModules].sort());
  for (const name of expectedModules) {
    assert.ok(actualModules.has(name), `${name} is absent from the bridge module tree`);
    const source = fs.readFileSync(path.join(moduleDir, name), 'utf8');
    const lines = source.split(/\r?\n/).length - 1;
    assert.ok(lines <= 500, `${name} has ${lines} lines`);
    assert.doesNotMatch(source, /require\([^)]*runtime-bridge-codex\.cjs/);
    assert.match(source, /module\.exports = Object\.freeze\(\{ create[A-Za-z0-9]+ \}\);/);
  }
});

test('public credential provider exports preserve factory reference identity', () => {
  const providerModulePath = require.resolve(path.join(moduleDir, 'credential-source-provider.cjs'));
  const originalModule = require(providerModulePath);
  const originalCacheEntry = require.cache[providerModulePath];
  let produced;
  require.cache[providerModulePath] = {
    id: providerModulePath,
    filename: providerModulePath,
    loaded: true,
    exports: {
      createCredentialSourceProviderFactory(deps) {
        produced = originalModule.createCredentialSourceProviderFactory(deps);
        return produced;
      },
    },
  };
  try {
    const facade = freshFacade();
    assert.ok(produced, 'credential provider factory was not composed');
    assert.strictEqual(facade.createCredentialSourceProvider, produced.createCredentialSourceProvider);
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY = 'boundary';
    const testFacade = freshFacade();
    assert.strictEqual(
      testFacade.createCredentialSourceProviderForFdTests,
      produced.createCredentialSourceProviderForFdTests,
    );
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY;
    delete require.cache[require.resolve(facadePath)];
    require.cache[providerModulePath] = originalCacheEntry;
  }
});

test('facade is the sole composition root for startup modules', () => {
  const source = fs.readFileSync(facadePath, 'utf8');
  for (const name of expectedModules) {
    assert.match(source, new RegExp(`require\\(['\"]\\./runtime-bridge-codex/${name.replace('.', '\\.')}['\"]\\)`));
  }
  for (const name of expectedModules) {
    const moduleSource = fs.readFileSync(path.join(moduleDir, name), 'utf8');
    for (const peer of expectedModules) {
      assert.doesNotMatch(moduleSource, new RegExp(`require\\([^)]*${peer.replace('.', '\\.')}`));
    }
  }
});

test('run finalization receives the sealed root authority from its composition context', () => {
  const contextSource = fs.readFileSync(path.join(moduleDir, 'credential-run-context.cjs'), 'utf8');
  const finalizationSource = fs.readFileSync(path.join(moduleDir, 'credential-run-finalization.cjs'), 'utf8');
  assert.match(
    contextSource,
    /createRunFinalization\(\{[\s\S]*?runId, mode, expectedRoster, sealHandle, checkpointAuthority/,
  );
  assert.match(
    finalizationSource,
    /function createRunFinalization\(\{ runId, mode, expectedRoster, sealHandle, checkpointAuthority/,
  );
});

test('credential evidence schema receives its closed-shape validator', () => {
  const facadeSource = fs.readFileSync(facadePath, 'utf8');
  const schemaSource = fs.readFileSync(path.join(moduleDir, 'credential-evidence-schema.cjs'), 'utf8');
  assert.match(facadeSource, /createCredentialEvidenceSchema\(\{ hasExactKeys \}\)/);
  assert.match(schemaSource, /function createCredentialEvidenceSchema\(\{\s*hasExactKeys,\s*\}\)/);
});

test('run finalization receives root-id derivation and digest validation', () => {
  const facadeSource = fs.readFileSync(facadePath, 'utf8');
  const finalizationSource = fs.readFileSync(path.join(moduleDir, 'credential-run-finalization.cjs'), 'utf8');
  assert.match(
    facadeSource,
    /parseCorrelatedCheckpointName, computeCredentialEvidenceComplete,\s*computeRootId, isHexDigest64,/,
  );
  assert.match(
    finalizationSource,
    /computeCredentialEvidenceComplete,\s*computeRootId,\s*isHexDigest64,/,
  );
});

test('owned-child provenance receives the platform birth observers it calls', () => {
  const facadeSource = fs.readFileSync(facadePath, 'utf8');
  const provenanceSource = fs.readFileSync(path.join(moduleDir, 'owned-child-provenance.cjs'), 'utf8');
  assert.match(
    facadeSource,
    /fs, path, spawn, resolvedPsPath, observeWindowsProcessIdentity, observeLinuxProcessBirth,/,
  );
  assert.match(
    provenanceSource,
    /observeWindowsProcessIdentity,\s*observeLinuxProcessBirth,\s*getIsolatedPathPosix,/,
  );
});

test('production export ABI remains closed at 50 keys', () => {
  assert.deepEqual(exportsFromFreshProcess(false), productionExports);
});

test('test-capability export ABI remains closed at 79 keys', () => {
  assert.deepEqual(exportsFromFreshProcess(true), [...productionExports, ...testOnlyExports].sort());
});

test('facade reload recreates startup closures without duplicate state', () => {
  const first = freshFacade();
  const second = freshFacade();
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  assert.notStrictEqual(second.parseSessionRunArgv, first.parseSessionRunArgv);
  assert.notStrictEqual(second.defaultProcessIdentityProvider, first.defaultProcessIdentityProvider);
  assert.deepEqual(second.parseSessionRunArgv([
    '--action', 'a'.repeat(32), '--coordination-root', '/tmp/repo/.planning/coordination',
    '--role', 'context-provider', '--session-expiry', '2030-01-01T00:00:00.000Z',
  ]), first.parseSessionRunArgv([
    '--action', 'a'.repeat(32), '--coordination-root', '/tmp/repo/.planning/coordination',
    '--role', 'context-provider', '--session-expiry', '2030-01-01T00:00:00.000Z',
  ]));
});

test('one live-child root identity set is shared by facade-composed consumers', () => {
  const facadeSource = fs.readFileSync(facadePath, 'utf8');
  assert.equal(
    (facadeSource.match(/const liveChildRootIdentityKeys = new Set\(\);/g) || []).length,
    1,
  );
  for (const name of [
    'child-process-registry.cjs',
    'child-spawn.cjs',
    'tombstone-reaper.cjs',
  ]) {
    const source = fs.readFileSync(path.join(moduleDir, name), 'utf8');
    assert.match(source, /liveChildRootIdentityKeys/);
    assert.doesNotMatch(source, /liveChildRootIdentityKeys\s*=\s*new Set/);
  }
});

test('provider handles remain private to the facade instance that issued them', () => {
  const privateBase = process.platform === 'win32'
    ? path.join(process.env.ProgramData, 'AndroidCommonDoc', 'bridge-boundary-' + process.pid)
    : fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bridge-boundary-'));
  if (process.platform === 'win32') {
    assert.equal(fs.existsSync(privateBase), false, `private test root already exists: ${privateBase}`);
    fs.mkdirSync(privateBase, { recursive: true, mode: 0o700 });
  }
  const registryBaseSymbol = Symbol.for('android-common-doc.runtime-private-registry-base');
  const previousBase = globalThis[registryBaseSymbol];
  globalThis[registryBaseSymbol] = privateBase;
  try {
    const first = freshFacade();
    const firstProvider = first.createIsolationProvider({
      readViewAuthority: Object.assign(() => ({ ok: false }), {
        resolve: () => ({ ok: false, reason: 'unused' }),
      }),
      strictConfigValidator: () => ({ ok: true }),
      projectRoot: repoRoot,
    });
    const created = firstProvider.createRunRoot({
      instanceId: '1'.repeat(32),
      repoId: '2'.repeat(32),
      runId: '3'.repeat(32),
      ownerIdentity: {
        pid: process.pid,
        birthToken: 'boundary-birth',
        executableIdentity: process.execPath,
      },
    });
    assert.equal(created.ok, true, created.reason);

    const second = freshFacade();
    const secondProvider = second.createIsolationProvider({
      readViewAuthority: Object.assign(() => ({ ok: false }), {
        resolve: () => ({ ok: false, reason: 'unused' }),
      }),
      strictConfigValidator: () => ({ ok: true }),
      projectRoot: repoRoot,
    });
    assert.deepEqual(
      secondProvider.finalizeRunRoot(created.handle, { role: 'verifier', capability: {} }),
      { ok: false, reason: 'ROOT_FINALIZE_UNKNOWN_HANDLE' },
    );
  } finally {
    if (previousBase === undefined) delete globalThis[registryBaseSymbol];
    else globalThis[registryBaseSymbol] = previousBase;
    fs.rmSync(privateBase, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequence 0008: factory-behavior tests for the five sequence 0005-0007 modules.
// ─────────────────────────────────────────────────────────────────────────────

const FIVE_NEW_MODULES = Object.freeze([
  'app-server-diagnostics.cjs',
  'app-server-framing.cjs',
  'app-server-protocol-schema.cjs',
  'app-server-turn-completion.cjs',
  'supervisor-ledger-cleanup.cjs',
]);

test('each of the five new modules exports exactly one frozen createXxx factory returning a frozen closed surface', () => {
  const localHasExactKeys = (obj, sortedKeys) => JSON.stringify(Object.keys(obj).sort()) === JSON.stringify(sortedKeys);
  const depsByModule = {
    'app-server-diagnostics.cjs': [],
    'app-server-framing.cjs': [],
    'app-server-protocol-schema.cjs': [{ hasExactKeys: localHasExactKeys }],
    'app-server-turn-completion.cjs': [{
      terminalStop: () => {}, isValidAgentMessageItem: () => true,
      unwrapAndValidateCodexStructuredRuntimeTurnEnvelope: () => ({ ok: true }), crypto: require('node:crypto'),
    }],
    'supervisor-ledger-cleanup.cjs': [{
      path, repoDescriptor: { repoId: 'r' }, rendezvousInstanceId: 'x',
      registryRepoDir: () => '/tmp', readDurableRegistryRecordFd: () => ({ ok: true, exists: false }),
      REGISTRY_RECORD_MAX_BYTES: 1024, sha256Buffer: () => 'x', getIsolationProvider: () => ({}),
      fs, reapTombstonedRoot: () => ({ ok: true }),
    }],
  };
  for (const name of FIVE_NEW_MODULES) {
    const modulePath = path.join(moduleDir, name);
    delete require.cache[require.resolve(modulePath)];
    const mod = require(modulePath);
    assert.ok(Object.isFrozen(mod), `${name} top-level export must be frozen`);
    const keys = Object.keys(mod);
    assert.equal(keys.length, 1, `${name} must export exactly one key, got ${keys.join(',')}`);
    const factoryName = keys[0];
    assert.match(factoryName, /^create[A-Za-z0-9]+$/);
    assert.equal(typeof mod[factoryName], 'function');
    const surface = mod[factoryName](...depsByModule[name]);
    assert.ok(Object.isFrozen(surface), `${name}'s ${factoryName}() return must be frozen`);
    assert.ok(Object.keys(surface).length > 0, `${name}'s ${factoryName}() must return a non-empty surface`);
    for (const key of Object.keys(surface)) {
      assert.ok(key.length > 0, `${name} leaked an empty-string key`);
    }
    delete require.cache[require.resolve(modulePath)];
  }
});

const SIX_CONNECTION_MODULES = Object.freeze([
  'app-server-connection-state.cjs',
  'app-server-connection-lifecycle.cjs',
  'app-server-turn-correlation.cjs',
  'app-server-credential-refresh.cjs',
  'app-server-rpc-dispatch.cjs',
  'app-server-rpc-methods.cjs',
]);

test('each of the six connection-decomposition modules exports exactly one frozen createXxx factory returning a frozen closed surface', () => {
  const noop = () => {};
  const { createConnectionState } = require(path.join(moduleDir, 'app-server-connection-state.cjs'));
  const fakeState = createConnectionState();
  const depsByModule = {
    'app-server-connection-state.cjs': [],
    'app-server-connection-lifecycle.cjs': [{
      state: fakeState, writeJsonlFrame: noop, stdin: {}, defaultRpcTimeoutMs: 10000,
      settlePendingCredentialOutcome: noop,
    }],
    'app-server-turn-correlation.cjs': [{
      state: fakeState, terminalStop: noop, isTerminal: () => false, isRefreshing: () => false,
      dispatchRequest: () => Promise.resolve({ ok: true, result: {} }), allocateId: () => 1,
      invokeTurnCompletionResult: noop, invokeTurnCompletionHandler: noop, boundedTurnErrorSuffix: () => 'x',
      isValidThreadReadParams: () => true, isValidThreadReadResponse: () => true,
      isValidTurnStartedNotification: () => true, isValidTurnCompletedNotification: () => true,
      hasExactKeys: () => true, asyncSleep: () => Promise.resolve(), retainedWorkerPollIntervalMs: 250,
      maxRetiredTurnIdsPerThread: 100,
    }],
    'app-server-credential-refresh.cjs': [{
      state: fakeState, stdin: {}, writeJsonlFrame: noop, isTerminal: () => false, beginStop: noop,
      terminalStop: noop, writeThenFinalizeStop: noop, onRefreshConfirmed: noop, refreshProvider: null,
      credentialBinding: null, defaultRpcTimeoutMs: 10000, isValidChatgptAuthTokensRefreshParams: () => true,
      serverRequestRefreshFailedError: { code: -1, message: 'x' }, serverRequestInvalidParamsError: { code: -2, message: 'y' },
    }],
    'app-server-rpc-dispatch.cjs': [{
      state: fakeState, stdin: {}, writeJsonlFrame: noop, isTerminal: () => false, isRefreshing: () => false,
      defaultRpcTimeoutMs: 10000, beginStop: noop, writeThenFinalizeStop: noop, handleRefreshServerRequest: noop,
      serverRequestFixedRows: {}, serverRequestParamsValidators: {},
      serverRequestUnknownMethodError: { code: -3, message: 'z' }, serverRequestInvalidParamsError: { code: -2, message: 'y' },
    }],
    'app-server-rpc-methods.cjs': [{
      state: fakeState, stdin: {}, writeJsonlFrame: noop, isTerminal: () => false, terminalStop: noop,
      dispatchRequest: () => Promise.resolve({ ok: true, result: {} }), computeDispatchWindow: () => ({ ok: true, timeoutMs: 10000 }),
      onNotification: () => noop, hasExactKeys: () => true, defaultRpcTimeoutMs: 10000,
      isValidInitializeResponse: () => true, isValidLoginAccountResponse: () => true,
      isValidAccountUpdatedNotification: () => true, isValidThreadStartOrResumeResponse: () => true,
      isValidTurnStartResponse: () => true, isValidTurnInterruptResponse: () => true,
      isValidThreadArchiveResponse: () => true, authModeValues: ['chatgptAuthTokens'], planTypeValues: ['plus'],
      describeRpcError: () => '', isUnknownThreadArchiveError: () => false,
      isCurrentTurnSafelyTerminal: () => true, isCurrentTurnSafeToArchive: () => true,
      bindOrVerifyCurrentTurnId: () => ({ ok: true }), retireTurnId: () => true, tryDeliverCurrentTurn: noop,
      codexStructuredRuntimeTurnEnvelopeSchema: () => ({}),
    }],
  };
  for (const name of SIX_CONNECTION_MODULES) {
    const modulePath = path.join(moduleDir, name);
    delete require.cache[require.resolve(modulePath)];
    const mod = require(modulePath);
    assert.ok(Object.isFrozen(mod), `${name} top-level export must be frozen`);
    const keys = Object.keys(mod);
    assert.equal(keys.length, 1, `${name} must export exactly one key, got ${keys.join(',')}`);
    const factoryName = keys[0];
    assert.match(factoryName, /^create[A-Za-z0-9]+$/);
    assert.equal(typeof mod[factoryName], 'function');
    const surface = mod[factoryName](...depsByModule[name]);
    assert.ok(Object.isFrozen(surface), `${name}'s ${factoryName}() return must be frozen`);
    assert.ok(Object.keys(surface).length > 0, `${name}'s ${factoryName}() must return a non-empty surface`);
    for (const key of Object.keys(surface)) {
      assert.ok(key.length > 0, `${name} leaked an empty-string key`);
    }
    assert.doesNotMatch(fs.readFileSync(modulePath, 'utf8'), /require\([^)]*runtime-bridge-codex\/(?!app-server-connection-state|app-server-connection-lifecycle|app-server-turn-correlation|app-server-credential-refresh|app-server-rpc-dispatch|app-server-rpc-methods)/, `${name} must not require a sibling connection-decomposition module (composition belongs to the facade)`);
    delete require.cache[require.resolve(modulePath)];
  }
});

test('two createAppServerConnection() instances never share mutable per-connection state', async () => {
  const facade = freshFacade();
  const { PassThrough } = require('node:stream');
  function makePair() {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const written = [];
    stdin.on('data', (chunk) => { written.push(...String(chunk).split('\n').filter(Boolean).map((l) => JSON.parse(l))); });
    return { stdin, stdout, written };
  }
  const a = makePair();
  const b = makePair();
  const connA = facade.createAppServerConnection({ stdin: a.stdin, stdout: a.stdout });
  const connB = facade.createAppServerConnection({ stdin: b.stdin, stdout: b.stdout });
  connA.initialize();
  connB.initialize();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.written.length, 1);
  assert.equal(b.written.length, 1);
  assert.equal(a.written[0].id, 1, 'connA must allocate request id 1 from its own independent counter');
  assert.equal(b.written[0].id, 1, 'connB must independently allocate request id 1 too -- a shared nextId counter would make this 2');
});

test('createAppServerTurnCompletion.boundedTurnErrorSuffix uses only the injected crypto, never a global, and never leaks raw message text', () => {
  const { createAppServerTurnCompletion } = require(path.join(moduleDir, 'app-server-turn-completion.cjs'));
  const calls = { createHash: [], update: [], digest: [] };
  const fakeHash = {
    update(data, enc) { calls.update.push([data, enc]); return fakeHash; },
    digest(enc) { calls.digest.push(enc); return 'deadbeef'.repeat(8); },
  };
  const fakeCrypto = { createHash(algo) { calls.createHash.push(algo); return fakeHash; } };
  const { boundedTurnErrorSuffix } = createAppServerTurnCompletion({
    terminalStop: () => {}, isValidAgentMessageItem: () => true,
    unwrapAndValidateCodexStructuredRuntimeTurnEnvelope: () => ({ ok: true }),
    crypto: fakeCrypto,
  });
  const secretMessage = 'super-secret-token-should-never-appear-in-output';
  const suffix = boundedTurnErrorSuffix({ message: secretMessage });
  assert.deepEqual(calls.createHash, ['sha256']);
  assert.deepEqual(calls.update, [[secretMessage, 'utf8']]);
  assert.deepEqual(calls.digest, ['hex']);
  assert.doesNotMatch(suffix, new RegExp(secretMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(suffix, ':messageLength=' + secretMessage.length + ';messageSha256=deadbeefdeadbeef');
});

test('createAppServerProtocolSchema.classifyIncomingFrame classifies one valid response and rejects ambiguous/extra-key wrappers', () => {
  const { createAppServerProtocolSchema } = require(path.join(moduleDir, 'app-server-protocol-schema.cjs'));
  const localHasExactKeys = (obj, sortedKeys) => JSON.stringify(Object.keys(obj).sort()) === JSON.stringify(sortedKeys);
  const schema = createAppServerProtocolSchema({ hasExactKeys: localHasExactKeys });
  const valid = schema.classifyIncomingFrame({ id: 1, result: {} });
  assert.equal(valid.kind, 'response');
  assert.equal(valid.ok, true);
  assert.equal(valid.id, 1);
  const ambiguous = schema.classifyIncomingFrame({ id: 2, result: {}, error: {} });
  assert.deepEqual(ambiguous, { kind: 'invalid', reason: 'response-wrapper-ambiguous' });
  const extraKey = schema.classifyIncomingFrame({ id: 3, result: {}, extra: true });
  assert.deepEqual(extraKey, { kind: 'invalid', reason: 'response-wrapper-extra-keys' });
});

test('app-server-framing exports preserve factory reference identity on the facade', () => {
  const framingModulePath = require.resolve(path.join(moduleDir, 'app-server-framing.cjs'));
  const originalModule = require(framingModulePath);
  const originalCacheEntry = require.cache[framingModulePath];
  let produced;
  require.cache[framingModulePath] = {
    id: framingModulePath, filename: framingModulePath, loaded: true,
    exports: {
      createAppServerFraming(...args) {
        produced = originalModule.createAppServerFraming(...args);
        return produced;
      },
    },
  };
  try {
    const facade = freshFacade();
    assert.ok(produced, 'app-server framing factory was not composed');
    assert.strictEqual(facade.createJsonlFrameFeeder, produced.createJsonlFrameFeeder);
    assert.strictEqual(facade.writeJsonlFrame, produced.writeJsonlFrame);
  } finally {
    delete require.cache[require.resolve(facadePath)];
    require.cache[framingModulePath] = originalCacheEntry;
  }
});

test('app-server-diagnostics exports preserve factory reference identity on the facade', () => {
  const diagModulePath = require.resolve(path.join(moduleDir, 'app-server-diagnostics.cjs'));
  const originalModule = require(diagModulePath);
  const originalCacheEntry = require.cache[diagModulePath];
  let produced;
  require.cache[diagModulePath] = {
    id: diagModulePath, filename: diagModulePath, loaded: true,
    exports: {
      createAppServerDiagnostics(...args) {
        produced = originalModule.createAppServerDiagnostics(...args);
        return produced;
      },
    },
  };
  try {
    const facade = freshFacade();
    assert.ok(produced, 'app-server diagnostics factory was not composed');
    for (const name of [
      'describeBornProvenanceFailure', 'describeInitializeFailure', 'describeOwnedChildExit',
      'describeOwnedChildState', 'describeOwnedChildStderr', 'describeThreadStartFailure',
    ]) {
      assert.strictEqual(facade[name], produced[name], `${name} reference must match`);
    }
  } finally {
    delete require.cache[require.resolve(facadePath)];
    require.cache[diagModulePath] = originalCacheEntry;
  }
});

test('turn-completion, protocol-schema and ledger-cleanup are each composed exactly once, and classifyIncomingFrame is defined exactly once across the whole tree', () => {
  // Sequence 15: the composition call sites for these three factories moved
  // out of the facade into app-server-connection.cjs / owned-app-server-
  // supervisor-engine.cjs (mini-facades that assemble a fresh per-call/per-
  // instance object graph from several sequence 5-10 sibling modules) --
  // "exactly once" is now a whole-tree property, not a facade-only one,
  // mirroring how classifyIncomingFrame is already checked just below.
  const allFiles = [facadePath, ...expectedModules.map((n) => path.join(moduleDir, n))];
  for (const factoryName of ['createAppServerTurnCompletion', 'createAppServerProtocolSchema', 'createSupervisorLedgerCleanup']) {
    let callSites = 0;
    for (const file of allFiles) {
      const src = fs.readFileSync(file, 'utf8');
      const matches = src.match(new RegExp('(?<!function )' + factoryName + '\\(', 'g')) || [];
      callSites += matches.length;
    }
    assert.equal(callSites, 1, `${factoryName} must be called exactly once across the facade and its module tree, found ${callSites}`);
  }
  let totalDefinitions = 0;
  for (const file of allFiles) {
    const src = fs.readFileSync(file, 'utf8');
    totalDefinitions += (src.match(/function classifyIncomingFrame\(/g) || []).length;
  }
  assert.equal(totalDefinitions, 1, 'classifyIncomingFrame must be defined exactly once across the facade and its module tree');
});

const SUPERVISOR_MODULES = Object.freeze([
  'app-server-supervisor-state.cjs',
  'app-server-supervisor-stop-receipt.cjs',
  'app-server-supervisor-stop-timeline.cjs',
  'app-server-supervisor-stop-request.cjs',
  'app-server-supervisor-startup-preflight.cjs',
  'app-server-supervisor-worker-spawn.cjs',
  'app-server-supervisor-role-bootstrap.cjs',
  'app-server-supervisor-retained-polling.cjs',
]);

test('each of the eight supervisor-engine-decomposition modules exports exactly one frozen createXxx factory', () => {
  for (const name of SUPERVISOR_MODULES) {
    const modulePath = path.join(moduleDir, name);
    delete require.cache[require.resolve(modulePath)];
    const mod = require(modulePath);
    assert.ok(Object.isFrozen(mod), `${name} top-level export must be frozen`);
    const keys = Object.keys(mod);
    assert.equal(keys.length, 1, `${name} must export exactly one key, got ${keys.join(',')}`);
    assert.match(keys[0], /^create[A-Za-z0-9]+$/);
    assert.equal(typeof mod[keys[0]], 'function');
    delete require.cache[require.resolve(modulePath)];
  }
});

test('a second createSupervisorEngineState() instance never shares mutable state with the first', () => {
  const { createSupervisorEngineState } = require(path.join(moduleDir, 'app-server-supervisor-state.cjs'));
  const ownedChildRef = { children: [] };
  const a = createSupervisorEngineState({ getBatchReady: () => false, ownedChildRef });
  const b = createSupervisorEngineState({ getBatchReady: () => false, ownedChildRef });
  a.setAdmissionClosed(true);
  a.setPollInFlight(true);
  a.ledger.set('x', { some: 'entry' });
  a.retainedWorkers.push({ role: 'x' });
  assert.equal(b.getAdmissionClosed(), false, 'a second engine state instance must not observe the first instance\'s admission flag');
  assert.equal(b.getPollInFlight(), false, 'a second engine state instance must not observe the first instance\'s poll-in-flight flag');
  assert.equal(b.ledger.size, 0, 'a second engine state instance must have its own independent ledger');
  assert.equal(b.retainedWorkers.length, 0, 'a second engine state instance must have its own independent retainedWorkers array');
  assert.notEqual(a.readyPromise, b.readyPromise, 'each engine state instance must own a distinct readyPromise');
});

test('retained polling treats a DURABILITY_UNPROVEN root-consult advance as transient (skip/retry), never a poll-killing rejection, while still rejecting on an unrelated CliError and leaving DRIVER_UNAVAILABLE tolerance unchanged', async () => {
  const { createSupervisorRetainedPolling } = require(path.join(moduleDir, 'app-server-supervisor-retained-polling.cjs'));
  const { CliError } = require(path.join(repoRoot, 'scripts', 'lib', 'runtime-consultation', 'primitives.cjs'));

  function buildPolling(advanceImpl) {
    let pollInFlight = false;
    const polling = createSupervisorRetainedPolling({
      sessionExpiryMs: Date.now() + 60000,
      action: {},
      retainedSessionGenerationStatus: () => ({ due: false }),
      shutdown: async (reason) => { throw new Error('SHUTDOWN_CALLED:' + reason); },
      isShuttingDown: () => false,
      getEngineStopRequested: () => false,
      getPollInFlight: () => pollInFlight,
      setPollInFlight: (v) => { pollInFlight = v; },
      pendingRawMcpPromises: new Set(),
      retainedWorkers: [{
        connection: { isStopped: () => false },
        lastPresenceHeartbeatMs: Date.now(),
        role: 'verifier',
        capability: {},
        activePromise: null,
        knownRequests: new Set(),
      }],
      repoDescriptor: {},
      coordinationRootReal: '/fake',
      rc: {
        hostBridgeListRootConsultIntents: () => [{ intentPath: '/fake/intent.json' }],
        hostBridgeAdvanceRootConsult: advanceImpl,
        hostBridgeObserveAndCompleteRootConsult: () => { throw new Error('must not reach observe'); },
      },
      loadP2CompletedRootReviewContext: () => ({ eligible: false }),
      executeP2RetainedArchitectReview: async () => {},
      collectPendingMixedReviewRequest: () => null,
      executeRetainedWorkerRequest: async () => {},
      replaceOwnedWorkerPresence: () => ({ ok: true }),
      retainedWorkerHeartbeatIntervalMs: Number.MAX_SAFE_INTEGER,
      asyncSleep: () => Promise.resolve(),
    });
    return { polling, getPollInFlight: () => pollInFlight };
  }

  const { polling: durabilityUnprovenPolling, getPollInFlight: durabilityFlag } = buildPolling(() => {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult WAL lock/advance failed');
  });
  await assert.doesNotReject(durabilityUnprovenPolling.pollRetainedWorkers(), 'a transient DURABILITY_UNPROVEN advance must be skipped for this tick, never reject the whole poll (which the caller\'s own setInterval handler turns into a full engine shutdown)');
  assert.equal(durabilityFlag(), false, 'pollInFlight must still be released after tolerating DURABILITY_UNPROVEN');

  const { polling: unrelatedErrorPolling } = buildPolling(() => {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'unrelated genuine defect');
  });
  await assert.rejects(unrelatedErrorPolling.pollRetainedWorkers(), /SCHEMA_INVALID|unrelated genuine defect/, 'an unrelated CliError must still reject the poll -- only DRIVER_UNAVAILABLE and DURABILITY_UNPROVEN are transient-tolerated');

  const { polling: driverUnavailablePolling } = buildPolling(() => {
    throw new CliError('INVALID', 'DRIVER_UNAVAILABLE', 'no live target');
  });
  await assert.doesNotReject(driverUnavailablePolling.pollRetainedWorkers(), 'pre-existing DRIVER_UNAVAILABLE tolerance must remain unchanged');
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequence 16: whole-tree readability gate. Walks the module directory itself
// (not just the `expectedModules` allowlist) so a future nested module is
// bounded even if someone forgets to extend the allowlist above.
// ─────────────────────────────────────────────────────────────────────────────

function discoverBridgeModules(directory) {
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

test('every recursive bridge module stays at or below 500 lines and 320 chars/line', () => {
  const discovered = discoverBridgeModules(moduleDir);
  const expectedPaths = expectedModules.map((name) => path.join(moduleDir, name)).slice().sort();
  assert.deepStrictEqual(discovered.slice().sort(), expectedPaths);
  for (const modulePath of discovered) {
    const fileLines = fs.readFileSync(modulePath, 'utf8').split(/\r?\n/);
    assert.ok(fileLines.length <= 500, `${modulePath} has ${fileLines.length} lines (max 500)`);
    const maxLineLength = Math.max(...fileLines.map((l) => l.length));
    assert.ok(maxLineLength <= 320, `${modulePath} has a ${maxLineLength}-char line (max 320)`);
  }
});

test('the facade is a thin composition/CLI root: <=1500 physical lines, <=320 chars per line', () => {
  const facadeLines = fs.readFileSync(facadePath, 'utf8').split(/\r?\n/);
  assert.ok(facadeLines.length <= 1500, `facade has ${facadeLines.length} lines (max 1500)`);
  const maxLineLength = Math.max(...facadeLines.map((l) => l.length));
  assert.ok(maxLineLength <= 320, `facade has a ${maxLineLength}-char line (max 320)`);
});

// Blanks comment/string/template/regex-literal contents (preserving every
// newline and overall character offset) so stray brace-shaped characters
// inside prose comments, embedded source-text string literals (e.g.
// session-run-test-backend.cjs's deterministic child-script fixture), or
// quote characters embedded inside a regex literal (e.g. a TOML-quote
// pattern like /"([^"]+)"/) can never desync the brace-depth counter below.
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

test('no function body left in the facade or any bridge module exceeds 500 lines', () => {
  const sources = [facadePath, ...discoverBridgeModules(moduleDir)];
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

test('performT0AndRunTimeline closes admission and clears engine timers exactly once even if requestStop and runStopTimelineDirect race', async () => {
  const { createSupervisorStopRequest } = require(path.join(moduleDir, 'app-server-supervisor-stop-request.cjs'));
  let admissionClosedCalls = 0;
  let clearCalls = 0;
  let stopPromiseCache = null;
  let engineStopRequested = false;
  const runOwnedStopTimeline = async (reason) => ({ reason, reported: false });
  const stopRequest = createSupervisorStopRequest({
    engine: {}, injectedShutdown: () => {}, settleReadyOnStartupFailure: () => {},
    getEngineStopRequested: () => engineStopRequested, setEngineStopRequested: (v) => { engineStopRequested = v; },
    getStopPromiseCache: () => stopPromiseCache, setStopPromiseCache: (v) => { stopPromiseCache = v; },
    setAdmissionClosed: () => { admissionClosedCalls += 1; }, setFirstStopReasonIfUnset: () => {},
    getDeterministicMcpControl: () => null, resolveStopSignal: () => {},
    clearEngineTimers: () => { clearCalls += 1; }, runOwnedStopTimeline,
  });
  const [r1, r2] = await Promise.all([stopRequest.requestStop('A'), stopRequest.requestStop('B')]);
  assert.equal(r1, r2, 'a second concurrent requestStop must resolve the SAME memoized result, never re-run t0');
  assert.equal(admissionClosedCalls, 1, 'admission must close exactly once per real stop, never once per requestStop call');
  assert.equal(clearCalls, 1, 'engine timers must be cleared exactly once per real stop');
});
