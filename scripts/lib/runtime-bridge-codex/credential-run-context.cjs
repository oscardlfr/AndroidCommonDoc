'use strict';

/**
 * Per-facade credential authority composition.  Mutable run state never
 * crosses the returned public authority surface; the WeakMap is recreated on
 * every facade load and is reachable only through the redacted inspector.
 */
function createCredentialRunContext({
  path,
  isCoreGeneratedIdentifier,
  isTestCapability,
  registryRepoDir,
  createSecretMatcher,
  createCaptureRegistry,
  createCheckpointAuthority,
  createBroker,
  createRecorder,
  createRunBinding,
  createRunFinalization,
  isSecretMatcherEmpty,
  isCaptureRegistryEmpty,
  STOP_ALL_DEFAULT_TIMEOUT_MS,
}) {
  const runAuthoritiesInternals = new WeakMap();
  const acceptedModes = Object.freeze(new Set(['app-server', 'mcp']));

  function createRunAuthorities(deps) {
    const dependencies = deps || {};
    if (!isCoreGeneratedIdentifier(dependencies.runId)) {
      throw new TypeError('createRunAuthorities requires runId to be a core-generated lowercase-hex identifier (32-64 chars), got: ' + JSON.stringify(dependencies.runId));
    }
    if (!acceptedModes.has(dependencies.mode)) {
      throw new TypeError('createRunAuthorities requires mode to be one of ' + Array.from(acceptedModes).join('|') + ', got: ' + JSON.stringify(dependencies.mode));
    }
    if (!dependencies.sourceProvider || typeof dependencies.sourceProvider.read !== 'function') {
      throw new TypeError('createRunAuthorities requires a sourceProvider with a read() function');
    }
    if (!dependencies.isolationProvider || typeof dependencies.isolationProvider.withValidatedReadView !== 'function') {
      throw new TypeError('createRunAuthorities requires an isolationProvider with withValidatedReadView()');
    }
    if (!dependencies.sealHandle || typeof dependencies.sealHandle !== 'object') {
      throw new TypeError('createRunAuthorities requires a sealHandle (a READY IsolationProvider handle)');
    }
    if (!Array.isArray(dependencies.expectedRoster)) {
      throw new TypeError('createRunAuthorities requires an expectedRoster array');
    }
    if (!Array.isArray(dependencies.rootRoster)) {
      throw new TypeError('createRunAuthorities requires a rootRoster array');
    }
    if (typeof dependencies.publisherFactory !== 'function') {
      throw new TypeError('createRunAuthorities requires a publisherFactory function');
    }
    if (!dependencies.connectionStopAuthority || typeof dependencies.connectionStopAuthority.stopAll !== 'function') {
      throw new TypeError('createRunAuthorities requires a connectionStopAuthority with stopAll()');
    }

    const {
      runId, mode, sealHandle, expectedRoster, rootRoster, isolationProvider,
      sourceProvider, publisherFactory, connectionStopAuthority,
    } = dependencies;
    const testFaultInjection = isTestCapability()
      && dependencies.testFaultInjection
      && typeof dependencies.testFaultInjection === 'object'
      ? dependencies.testFaultInjection : null;
    const isTeardownFaultActive = (phase) => !!testFaultInjection
      && testFaultInjection.teardown === phase;
    const testConstructionOrder = isTestCapability()
      && dependencies.testConstructionOrder
      && typeof dependencies.testConstructionOrder.record === 'function'
      ? dependencies.testConstructionOrder : null;
    const recordConstructionStep = (name) => {
      if (testConstructionOrder) testConstructionOrder.record(name);
    };

    const secretMatcher = createSecretMatcher();
    recordConstructionStep('secretMatcher');
    const captureRegistry = createCaptureRegistry();
    recordConstructionStep('captureRegistry');
    const checkpointAuthority = createCheckpointAuthority({
      secretMatcher, captureRegistry, isolationProvider, sealHandle, runId,
      mode, expectedRoster, rootRoster, repoId: sealHandle && sealHandle.repoId,
    });
    recordConstructionStep('checkpointAuthority');
    const broker = createBroker({ secretMatcher });
    recordConstructionStep('broker');
    const recorder = createRecorder({ expectedRoster });
    recordConstructionStep('recorder');

    const activeConnectionIds = new Set();
    let lastStopAllCoverage = null;
    checkpointAuthority.onPoison(() => broker.poison());
    checkpointAuthority.onPoison((reason) => {
      const frozenRoster = Array.from(activeConnectionIds);
      Promise.resolve(connectionStopAuthority.stopAll(reason, {
        connectionIds: frozenRoster,
        timeoutMs: STOP_ALL_DEFAULT_TIMEOUT_MS,
      })).then((result) => {
        const acks = (result && result.acks) || new Map();
        const missing = frozenRoster.filter((id) => acks.get(id) !== 'STOPPED');
        const extra = Array.from(acks.keys()).filter((id) => !frozenRoster.includes(id));
        lastStopAllCoverage = {
          complete: missing.length === 0 && extra.length === 0,
          missing,
          extra,
        };
      }).catch((err) => {
        lastStopAllCoverage = {
          complete: false,
          missing: frozenRoster.slice(),
          extra: [],
          error: String((err && err.message) || err),
        };
      });
    });

    const captureSink = {
      register(buffer) {
        const result = captureRegistry.register(buffer);
        if (!result.ok) checkpointAuthority.notifyOverflow();
        return result;
      },
    };
    const publisher = publisherFactory({ runId, mode });
    const waveDir = registryRepoDir({ repoId: sealHandle.repoId });
    const manifestPath = path.join(
      waveDir, 'conformance-evidence', mode, runId, 'manifest.json',
    );
    const activeConnectionCount = () => activeConnectionIds.size;

    const { publishAndFinalize, isOpenForBinding } = createRunFinalization({
      runId, mode, expectedRoster, sealHandle, checkpointAuthority, publisher, manifestPath,
      isTeardownFaultActive, broker, secretMatcher, captureRegistry,
      activeConnectionCount,
    });
    const { bindConnection } = createRunBinding({
      rootRoster, broker, recorder, checkpointAuthority, secretMatcher, sourceProvider,
      addActiveConnection: (connectionId) => activeConnectionIds.add(connectionId),
      deleteActiveConnection: (connectionId) => activeConnectionIds.delete(connectionId),
      isOpenForBinding,
    });

    const authorities = { bindConnection, captureSink, publishAndFinalize };
    runAuthoritiesInternals.set(authorities, {
      broker,
      secretMatcher,
      captureRegistry,
      checkpointAuthority,
      getStopAllCoverage: () => lastStopAllCoverage,
      getActiveLeaseCount: activeConnectionCount,
    });
    return authorities;
  }

  function __testOnlyInspectFinalizationState(authorities) {
    const internals = runAuthoritiesInternals.get(authorities);
    if (!internals) return undefined;
    return {
      brokerStatus: internals.broker.status(),
      evidenceInvalid: internals.checkpointAuthority.isPoisoned(),
      secretMatcherEmpty: isSecretMatcherEmpty(internals.secretMatcher),
      captureRegistryEmpty: isCaptureRegistryEmpty(internals.captureRegistry),
      activeLeaseCount: internals.getActiveLeaseCount(),
      correctiveRepublishDurabilityConfirmed: internals.checkpointAuthority
        .correctiveRepublishDurabilityConfirmed(),
    };
  }

  return Object.freeze({ createRunAuthorities, __testOnlyInspectFinalizationState });
}

module.exports = Object.freeze({ createCredentialRunContext });
