'use strict';

function createIsolationRootCreate({
  fs, path, crypto, registryRepoDir, publishBridgeRegistryRecord,
  canonicalJSONStringify, ensureSecureRegistryDir, INITIAL_ISOLATION_CONFIG_TOML,
  hasExactKeys, OWNER_IDENTITY_KEYS_SORTED, rootsByRunId, rootHandleInternals,
  isCoreGeneratedIdentifier, isolationRootChildPathBudget,
  validateAncestorChainNoSymlinks, sensitiveRoots,
  resolvedPathEqualsOrIsDescendantOf, resolvedPathIsProperDescendantOf,
  ROOT_PROVISION_INTENT_LIFETIME_MS, topologyPathsFor, childEnvFromTopology,
  ISOLATED_PATH_POSIX,
}) {
  function createRunRoot({ instanceId, repoId, runId, ownerIdentity, role }) {
    if (typeof instanceId !== 'string' || instanceId.length === 0) return { ok: false, reason: 'ROOT_INSTANCE_ID_REQUIRED' };
    if (!isCoreGeneratedIdentifier(repoId) || !isCoreGeneratedIdentifier(instanceId) || !isCoreGeneratedIdentifier(runId)) {
      return { ok: false, reason: 'UNSAFE_IDENTIFIER_SEGMENT:core-generated-grammar' };
    }

    if (!hasExactKeys(ownerIdentity, OWNER_IDENTITY_KEYS_SORTED)
      || typeof ownerIdentity.pid !== 'number' || !Number.isInteger(ownerIdentity.pid) || ownerIdentity.pid <= 0
      || typeof ownerIdentity.birthToken !== 'string' || ownerIdentity.birthToken.length === 0
      || typeof ownerIdentity.executableIdentity !== 'string' || ownerIdentity.executableIdentity.length === 0) {
      return { ok: false, reason: 'ROOT_OWNER_IDENTITY_INVALID' };
    }

    if (typeof role === 'string' && role.length > 0) {
      const existingRootsForRun = rootsByRunId.get(runId);
      if (existingRootsForRun && existingRootsForRun.roleSpecific.has(role)) {
        return { ok: false, reason: 'ROOT_DUPLICATE_RUN_ROLE_REGISTRATION' };
      }
    }

    const intendedPath = path.join(registryRepoDir({ repoId }), 'isolation-roots', instanceId);

    const pathBudget = isolationRootChildPathBudget(intendedPath);
    if (!pathBudget.ok) return { ok: false, reason: pathBudget.reason };

    const ancestorCheck = validateAncestorChainNoSymlinks(intendedPath);
    if (!ancestorCheck.ok) return ancestorCheck;

    const resolvedIntendedPath = path.resolve(intendedPath);
    for (const sensitiveRoot of sensitiveRoots) {
      if (typeof sensitiveRoot !== 'string' || sensitiveRoot.length === 0) continue;
      const resolvedSensitiveRoot = path.resolve(sensitiveRoot);
      if (resolvedPathEqualsOrIsDescendantOf(resolvedIntendedPath, resolvedSensitiveRoot)) {
        return { ok: false, reason: 'ROOT_INTENDED_PATH_WITHIN_SENSITIVE_ROOT' };
      }
      if (resolvedPathIsProperDescendantOf(resolvedSensitiveRoot, resolvedIntendedPath)) {
        return { ok: false, reason: 'ROOT_SENSITIVE_ROOT_WITHIN_INTENDED_PATH' };
      }
    }

    try {
      fs.lstatSync(intendedPath);
      return { ok: false, reason: 'ROOT_LEAF_ALREADY_EXISTS' };
    } catch (err) {
      if (!(err && err.code === 'ENOENT')) {
        return { ok: false, reason: 'ROOT_LEAF_LSTAT_FAILED' };
      }
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ROOT_PROVISION_INTENT_LIFETIME_MS);
    const intentRecord = {
      schema: 'coordination/root-provision-intent/v1',
      instanceId, repoId, runId, intendedPath, ownerIdentity,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const intentPath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.intent.json');
    try {
      publishBridgeRegistryRecord(intentPath, Buffer.from(canonicalJSONStringify(intentRecord), 'utf8'));
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'ROOT_INTENT_PUBLISH_FAILED' };
    }

    const topologyPaths = topologyPathsFor(intendedPath);
    const configPath = path.join(topologyPaths.codexHome, 'config.toml');
    const completePath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.complete.json');
    let originalLeafIdentity = null;
    const ownerToken = crypto.randomBytes(16).toString('hex');
    const record = {
      instanceId, repoId, runId, intendedPath, ownerIdentity,
      intentPath, completePath, configPath, topologyPaths,
      state: 'PROFILE_PENDING',
    };
    let rootsForThisRun = rootsByRunId.get(runId);
    if (!rootsForThisRun) {
      rootsForThisRun = { roleSpecific: new Map(), generic: new Map() };
      rootsByRunId.set(runId, rootsForThisRun);
    }
    if (typeof role === 'string' && role.length > 0) {
      rootsForThisRun.roleSpecific.set(role, record);
    } else {
      rootsForThisRun.generic.set(instanceId, record);
    }
    rootHandleInternals.set(record, {
      instanceId, repoId, runId, intendedPath, configPath, intentPath, completePath,
      topologyPaths: Object.assign({}, topologyPaths),
      state: 'PROFILE_PENDING', // HARD NO-GO RESPONSE Block C: kept in sync with record.state at every legitimate transition (see finalizeRunRoot below).
      ownerToken,
      originalLeafIdentity: null,
    });
    let leafCreated = false;
    for (const layer of Object.keys(topologyPaths)) {
      const dirResult = ensureSecureRegistryDir(topologyPaths[layer]);
      if (!dirResult.ok) {
        return {
          ok: false, reason: 'ROOT_TOPOLOGY_DIR_FAILED:' + layer + ':' + dirResult.reason,
          handle: leafCreated ? record : null, ownerToken: leafCreated ? ownerToken : null,
        };
      }
      if (layer === 'root') {
        leafCreated = true;
        let leafFd;
        try {
          leafFd = fs.openSync(topologyPaths.root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        } catch (err) {
          return { ok: false, reason: 'ROOT_LEAF_IDENTITY_CAPTURE_FAILED', handle: record, ownerToken };
        }
        try {
          const st = fs.fstatSync(leafFd, { bigint: true });
          originalLeafIdentity = { dev: st.dev.toString(), ino: st.ino.toString() };
          rootHandleInternals.set(record, Object.assign({}, rootHandleInternals.get(record), { originalLeafIdentity }));
        } finally {
          try { fs.closeSync(leafFd); } catch (e) { /* best-effort */ }
        }
      }
    }

    try {
      fs.writeFileSync(configPath, INITIAL_ISOLATION_CONFIG_TOML, { mode: 0o600 });
    } catch (err) {
      return { ok: false, reason: 'ROOT_CONFIG_WRITE_FAILED', handle: record, ownerToken };
    }

    const launchContext = childEnvFromTopology(topologyPaths);
    const closedEnv = {
      HOME: launchContext.env.HOME,
      CODEX_HOME: launchContext.env.CODEX_HOME,
      TMPDIR: launchContext.env.TMPDIR,
      XDG_CACHE_HOME: launchContext.env.XDG_CACHE_HOME,
      XDG_CONFIG_HOME: launchContext.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: launchContext.env.XDG_STATE_HOME,
      PATH: ISOLATED_PATH_POSIX,
      LANG: process.env.LANG || 'C.UTF-8',
      USER: process.env.USER || '',
      LOGNAME: process.env.LOGNAME || process.env.USER || '',
    };
    return { ok: true, handle: record, cwd: launchContext.cwd, env: closedEnv, ownerToken };
  }
  return createRunRoot;
}

module.exports = Object.freeze({ createIsolationRootCreate });
