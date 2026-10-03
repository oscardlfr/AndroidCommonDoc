'use strict';

function createClaudeResumeRegistryLock({ path, registryRepoDir, withRegistryLock }) {
  // Readers and publishers share a bounded commit lock: the real durable
  // writer exposes nlink=2 until its barriers complete. Never acquire actor,
  // handle or state locks inside this namespace lock, and never nest it.
  function withClaudeResumeHandleRegistryLock(projectRoot, work) {
    try {
      const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-resume-handles-publication.lock');
      const locked = withRegistryLock(lockDir, work, { maxWaitMs: 5000 });
      return locked.ok && locked.value ? locked.value
        : { ok: false, reason: 'INVALID', cause: locked.reason || 'resume-registry-lock-result-absent' };
    } catch {
      return { ok: false, reason: 'INVALID' };
    }
  }
  return Object.freeze({ withClaudeResumeHandleRegistryLock });
}

module.exports = Object.freeze({ createClaudeResumeRegistryLock });
