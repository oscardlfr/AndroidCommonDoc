'use strict';

function createIsolationAuthority({
  fs, os, path, rll, sha256String, isTestCapability, gitRevParse,
  realpathOrSelf, resolveSealedGitCache, fdBoundIdentityTuple, IDENTITY_TUPLE_FIELDS,
}) {
  function fsyncFileAndParentDir(filePath) {
    let fileFd;
    try {
      fileFd = fs.openSync(filePath, process.platform === 'win32' ? 'r+' : 'r');
      fs.fsyncSync(fileFd);
    } catch (err) {
      return false;
    } finally {
      if (fileFd !== undefined) { try { fs.closeSync(fileFd); } catch (err) { /* best-effort */ } }
    }
    let dirFd;
    try {
      dirFd = fs.openSync(path.dirname(filePath), process.platform === 'win32' ? 'r+' : 'r');
      fs.fsyncSync(dirFd);
    } catch (err) {
      return false;
    } finally {
      if (dirFd !== undefined) { try { fs.closeSync(dirFd); } catch (err) { /* best-effort */ } }
    }
    return true;
  }

  function isRootFinalizeFaultActive(phase) {
    return isTestCapability() && process.env.RUNTIME_BRIDGE_CODEX_FAULT_ROOT_FINALIZE === phase;
  }

  function computeRootId(instanceId) {
    return sha256String(instanceId);
  }

  function classifyProvisioningOwner(ownerIdentity, expiresAtIso, opts) {
    const options = opts || {};
    void expiresAtIso;
    const livenessProbe = typeof options.livenessProbe === 'function' ? options.livenessProbe : () => 'INDETERMINATE';
    const verdict = livenessProbe(ownerIdentity);
    if (verdict === 'LIVE' || verdict === 'DEAD' || verdict === 'INDETERMINATE') return verdict;
    return 'INDETERMINATE'; // fail-closed: an unrecognized probe result never authorizes destruction.
  }

  function defaultPidLivenessProbe(pid) {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return 'INDETERMINATE';
    try {
      process.kill(pid, 0);
      return 'LIVE';
    } catch (err) {
      if (err && err.code === 'ESRCH') return 'DEAD';
      return 'LIVE';
    }
  }


  function isSafeIdentifierSegment(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function isCoreGeneratedIdentifier(value) {
    return typeof value === 'string' && /^[0-9a-f]{32,64}$/.test(value);
  }


  function isCanonicalIsoUtcTimestamp(value) {
    if (typeof value !== 'string') return false;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && new Date(ms).toISOString() === value;
  }

  const CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN = /^(0|[1-9][0-9]*)$/;
  function isValidDevInoValue(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
    return typeof value === 'string' && CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(value);
  }

  const OWNER_IDENTITY_KEYS_SORTED = Object.freeze(['birthToken', 'executableIdentity', 'pid']);
  const FINAL_IDENTITY_SNAPSHOT_KEYS_SORTED = Object.freeze(['configDigest', 'configIdentity', 'topologyIdentity']);
  const IDENTITY_TUPLE_FIELDS_SORTED = Object.freeze([...IDENTITY_TUPLE_FIELDS].sort());

  function requireSafeIdentifierSegments(fields) {
    for (const name of Object.keys(fields)) {
      if (!isSafeIdentifierSegment(fields[name])) {
        return { ok: false, reason: 'UNSAFE_IDENTIFIER_SEGMENT:' + name };
      }
    }
    return { ok: true };
  }

  let cachedKnownSafeAncestorAnchors = null;
  function knownSafeAncestorAnchors() {
    if (cachedKnownSafeAncestorAnchors) return cachedKnownSafeAncestorAnchors;
    const candidates = [];
    try { candidates.push(os.tmpdir()); } catch (err) { /* best-effort */ }
    try { candidates.push(os.homedir()); } catch (err) { /* best-effort */ }
    try { candidates.push(rll.registryBaseDir()); } catch (err) { /* best-effort */ }
    const resolved = new Set();
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue;
      try {
        resolved.add(fs.realpathSync(candidate));
      } catch (err) {
        resolved.add(path.resolve(candidate));
      }
    }
    cachedKnownSafeAncestorAnchors = resolved;
    return resolved;
  }

  const ANCESTOR_WALK_MAX_LEVELS = 64; // defensive backstop only -- the real stopping conditions are a known-safe anchor or the filesystem root.

  function validateAncestorChainNoSymlinks(intendedPath) {
    const safeAnchors = knownSafeAncestorAnchors();
    let current = path.dirname(intendedPath);
    for (let level = 0; level < ANCESTOR_WALK_MAX_LEVELS; level++) {
      let lst;
      try {
        lst = fs.lstatSync(current);
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          const parent = path.dirname(current);
          if (parent === current) return { ok: true }; // filesystem root.
          current = parent;
          continue;
        }
        return { ok: false, reason: 'ANCESTOR_LSTAT_FAILED' };
      }
      if (lst.isSymbolicLink()) return { ok: false, reason: 'ANCESTOR_SYMLINK_DETECTED' };
      if (!lst.isDirectory()) return { ok: false, reason: 'ANCESTOR_NOT_A_DIRECTORY' };
      let realCurrent;
      try {
        realCurrent = fs.realpathSync(current);
      } catch (err) {
        realCurrent = current;
      }
      if (safeAnchors.has(realCurrent)) return { ok: true };
      const parent = path.dirname(current);
      if (parent === current) return { ok: true }; // filesystem root.
      current = parent;
    }
    return { ok: false, reason: 'ANCESTOR_CHAIN_TOO_DEEP' };
  }

  function handleMatchesSnapshot(handle, snapshot) {
    const scalarFields = ['instanceId', 'repoId', 'runId', 'intendedPath', 'configPath', 'intentPath', 'completePath', 'state'];
    for (const field of scalarFields) {
      if (handle[field] !== snapshot[field]) return false;
    }
    const snapshotLayers = Object.keys(snapshot.topologyPaths || {});
    const handleLayers = Object.keys((handle && handle.topologyPaths) || {});
    if (snapshotLayers.length !== handleLayers.length) return false;
    for (const layer of snapshotLayers) {
      if (!handle.topologyPaths || handle.topologyPaths[layer] !== snapshot.topologyPaths[layer]) return false;
    }
    return true;
  }

  const gitDerivedSensitiveRootsCache = new Map(); // projectRoot -> {derived:{worktreeToplevel, gitCommonDir}, seal}

  function mandatorySensitiveRootsFor(projectRoot) {
    const sealed = resolveSealedGitCache(gitDerivedSensitiveRootsCache, projectRoot, (root) => {
      const worktreeToplevel = realpathOrSelf(gitRevParse(root, ['rev-parse', '--show-toplevel']));
      const gitCommonDir = realpathOrSelf(gitRevParse(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
      return { ok: true, projectReal: worktreeToplevel, gitCommonDirReal: gitCommonDir, worktreeToplevel, gitCommonDir };
    });
    const codexHome = (typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME.length > 0)
      ? process.env.CODEX_HOME : path.join(os.homedir(), '.codex');
    const alwaysSensitive = [os.homedir(), codexHome, path.join(os.homedir(), '.claude')];
    if (!sealed.ok) return alwaysSensitive;
    const { worktreeToplevel, gitCommonDir } = sealed.derived;
    return [worktreeToplevel, gitCommonDir].concat(alwaysSensitive);
  }

  function resolvedPathIsProperDescendantOf(resolvedCandidate, resolvedParent) {
    const parentWithSep = resolvedParent.endsWith(path.sep) ? resolvedParent : resolvedParent + path.sep;
    return resolvedCandidate.startsWith(parentWithSep);
  }
  function resolvedPathEqualsOrIsDescendantOf(resolvedCandidate, resolvedParent) {
    return resolvedCandidate === resolvedParent || resolvedPathIsProperDescendantOf(resolvedCandidate, resolvedParent);
  }

  const CLEANUP_AUTHORIZATION_OUTCOME_ENUM = Object.freeze(new Set(['PID_ABSENT', 'PID_LIVE', 'PID_INDETERMINATE', 'NEVER_SPAWNED']));
  const CLEANUP_AUTHORIZATION_CLOSED_FIELDS = Object.freeze(new Set([
    'outcome', 'repoId', 'instanceId', 'runId', 'pid', 'birthToken', 'executableIdentity',
    'instanceRecordIdentity', 'ownerToken', 'allowPendingAbandonment',
  ]));

  function createFdBoundValidatedScope(resolveFn) {
    return function withValidatedScope(capability, { runId, role }, callback) {
      const resolution = resolveFn(capability, { expectedRunId: runId, expectedRole: role });
      if (!resolution || resolution.ok !== true) {
        return { ok: false, reason: (resolution && resolution.reason) || 'VALIDATED_SCOPE_CAPABILITY_REJECTED' };
      }
      if (!Array.isArray(resolution.workspaceRoots) || !resolution.workspaceRoots.every((p) => typeof p === 'string' && p.length > 0)) {
        return { ok: false, reason: 'VALIDATED_SCOPE_CREDITED_SCOPE_MISSING' };
      }
      let before;
      try {
        before = resolution.workspaceRoots.map((p) => fdBoundIdentityTuple(p));
      } catch (err) {
        return { ok: false, reason: 'VALIDATED_SCOPE_PRECHECK_FAILED' };
      }
      let callbackResult;
      let callbackThrew = false;
      let callbackError;
      try {
        callbackResult = callback(resolution.workspaceRoots);
      } catch (err) {
        callbackThrew = true;
        callbackError = err;
      }
      let after;
      try {
        after = resolution.workspaceRoots.map((p) => fdBoundIdentityTuple(p));
      } catch (err) {
        return { ok: false, reason: 'VALIDATED_SCOPE_REBIND_DURING_USE' };
      }
      const scopeIdentityStable = before.length === after.length
        && before.every((beforeTuple, i) => IDENTITY_TUPLE_FIELDS.every((field) => beforeTuple[field] === after[i][field]));
      if (!scopeIdentityStable) {
        return { ok: false, reason: 'VALIDATED_SCOPE_REBIND_DURING_USE' };
      }
      if (callbackThrew) throw callbackError;
      return callbackResult;
    };
  }
  return {
    fsyncFileAndParentDir, isRootFinalizeFaultActive, computeRootId,
    classifyProvisioningOwner, defaultPidLivenessProbe, isSafeIdentifierSegment,
    isCoreGeneratedIdentifier, isCanonicalIsoUtcTimestamp,
    CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN, isValidDevInoValue,
    OWNER_IDENTITY_KEYS_SORTED, FINAL_IDENTITY_SNAPSHOT_KEYS_SORTED,
    IDENTITY_TUPLE_FIELDS_SORTED, requireSafeIdentifierSegments,
    validateAncestorChainNoSymlinks, handleMatchesSnapshot,
    mandatorySensitiveRootsFor, resolvedPathIsProperDescendantOf,
    resolvedPathEqualsOrIsDescendantOf, CLEANUP_AUTHORIZATION_OUTCOME_ENUM,
    CLEANUP_AUTHORIZATION_CLOSED_FIELDS, createFdBoundValidatedScope,
  };
}

module.exports = Object.freeze({ createIsolationAuthority });
