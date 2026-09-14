'use strict';

function createIsolationProviderFactory({
  mandatorySensitiveRootsFor,
  createFdBoundValidatedScope,
  defaultPidLivenessProbe,
  createIsolationRootCreate,
  createIsolationRootFinalize,
  createIsolationRootAccess,
  createIsolationRootCleanup,
  runtimeDeps,
}) {
  return function createIsolationProvider(deps) {
    const dependencies = deps || {};
    if (typeof dependencies.readViewAuthority !== 'function') {
      throw new TypeError('createIsolationProvider requires a readViewAuthority function');
    }
    if (typeof dependencies.readViewAuthority.resolve !== 'function') {
      throw new TypeError('createIsolationProvider requires a readViewAuthority with a resolve() function');
    }
    if (typeof dependencies.strictConfigValidator !== 'function') {
      throw new TypeError('createIsolationProvider requires a strictConfigValidator function');
    }
    if (typeof dependencies.projectRoot !== 'string' || dependencies.projectRoot.length === 0) {
      throw new TypeError('createIsolationProvider requires a non-empty projectRoot');
    }

    const { readViewAuthority, strictConfigValidator, projectRoot } = dependencies;
    const callerSensitiveRoots = Array.isArray(dependencies.sensitiveRoots) ? dependencies.sensitiveRoots : [];
    const sensitiveRoots = mandatorySensitiveRootsFor(projectRoot).concat(callerSensitiveRoots);
    const safeValidatedScope = createFdBoundValidatedScope(readViewAuthority.resolve.bind(readViewAuthority));
    const livenessProbe = typeof dependencies.livenessProbe === 'function'
      ? dependencies.livenessProbe
      : defaultPidLivenessProbe;
    const rootsByRunId = new Map();
    const rootHandleInternals = new WeakMap();
    const shared = Object.assign({}, runtimeDeps(), {
      readViewAuthority,
      strictConfigValidator,
      sensitiveRoots,
      safeValidatedScope,
      livenessProbe,
      rootsByRunId,
      rootHandleInternals,
    });

    const createRunRoot = createIsolationRootCreate(shared);
    const cleanupRoot = createIsolationRootCleanup(shared);
    const finalizeRunRoot = createIsolationRootFinalize(Object.assign({}, shared, { cleanupRoot }));
    const { withValidatedReadView, withValidatedRoot } = createIsolationRootAccess(shared);
    return { createRunRoot, finalizeRunRoot, withValidatedReadView, withValidatedRoot, cleanupRoot };
  };
}

module.exports = Object.freeze({ createIsolationProviderFactory });
