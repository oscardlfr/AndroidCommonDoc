'use strict';

function createChildProcessRegistry({
  fs,
  path,
  crypto,
  registryRepoDir,
  readDurableRegistryRecordFd,
  REGISTRY_RECORD_MAX_BYTES,
  fdBoundIdentityTuple,
  realpathOrSelf,
  observedProcessBirthTime,
  liveChildRootIdentityKeys,
}) {

  function rootIdentityKeyFor(rootIdentity) {
    if (!rootIdentity || typeof rootIdentity !== 'object') return null;
    if (rootIdentity.dev === undefined || rootIdentity.ino === undefined) return null;
    return String(rootIdentity.dev) + ':' + String(rootIdentity.ino);
  }

  function deriveTrueRootIdentity({ repoId, instanceId }) {
    try {
      const completePath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.complete.json');
      const readResult = readDurableRegistryRecordFd(completePath, REGISTRY_RECORD_MAX_BYTES);
      if (!readResult.ok || !readResult.exists) return null;
      const record = JSON.parse(readResult.text);
      if (!record || typeof record.finalPath !== 'string' || record.finalPath.length === 0) return null;
      const tuple = fdBoundIdentityTuple(record.finalPath);
      return { dev: tuple.dev, ino: tuple.ino };
    } catch (err) {
      return null;
    }
  }

  function createSupervisorOwnedChildRegistry() {
    const children = new Map();
    function register(child) {
      const ownedChildId = crypto.randomBytes(16).toString('hex');
      children.set(ownedChildId, child);
      return ownedChildId;
    }
    function resolve(ownedChildId) {
      return children.has(ownedChildId) ? children.get(ownedChildId) : null;
    }
    function unregister(ownedChildId) {
      children.delete(ownedChildId);
    }
    return { register, resolve, unregister };
  }

  function requireProvenChildIdentity(child, { expectedExecutable } = {}) {
    if (!child || typeof child.pid !== 'number' || !Number.isInteger(child.pid) || child.pid <= 0) {
      return { ok: false, reason: 'CHILD_IDENTITY_PID_UNPROVABLE' };
    }
    try {
      process.kill(child.pid, 0);
    } catch (err) {
      if (err && err.code === 'ESRCH') {
        return { ok: false, reason: 'CHILD_IDENTITY_PID_NOT_LIVE' };
      }
      // Any other error (e.g. EPERM) still proves a real process exists at
      // this pid -- fall through and accept it.
    }
    let executableIdentity = null;
    if (typeof child.spawnfile === 'string' && child.spawnfile.length > 0) {
      if (!fs.existsSync(child.spawnfile)) {
        return { ok: false, reason: 'CHILD_IDENTITY_EXECUTABLE_UNPROVABLE' };
      }
      if (typeof expectedExecutable === 'string' && expectedExecutable.length > 0) {
        if (realpathOrSelf(child.spawnfile) !== realpathOrSelf(expectedExecutable)) {
          return { ok: false, reason: 'CHILD_IDENTITY_EXECUTABLE_MISMATCH' };
        }
      }
      executableIdentity = child.spawnfile;
    }
    const birthObservedAt = observedProcessBirthTime(child.pid);
    return { ok: true, childIdentity: { pid: child.pid, executableIdentity, birthObservedAt } };
  }

  return Object.freeze({ rootIdentityKeyFor, deriveTrueRootIdentity, createSupervisorOwnedChildRegistry, requireProvenChildIdentity });
}

module.exports = Object.freeze({ createChildProcessRegistry });
