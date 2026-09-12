#!/usr/bin/env node
'use strict';

// Test-only child-process bridge for actor-scoped CLAUDE-ID-01 fixtures.
// The parent test constructs the v2 proof in memory and passes the exact
// already-validated session evidence to real hook/race subprocesses. Production
// code remains unaware of this seam.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const encoded = process.env.RUNTIME_TEST_CLAUDE_SESSION_EVIDENCE;
if (typeof encoded === 'string' && encoded.length > 0) {
  const fixture = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const originalLoad = Module._load;
  const patchedHosts = new WeakSet();
  Module._load = function runtimeTestSessionEvidenceLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (loaded && typeof loaded === 'object'
        && typeof loaded.getProductionSessionIdentity === 'function'
        && typeof loaded.recordProductionSessionIdentity === 'function'
        && !patchedHosts.has(loaded)) {
      patchedHosts.add(loaded);
      const original = loaded.getProductionSessionIdentity;
      loaded.getProductionSessionIdentity = (projectRootOrRepoDescriptor, sessionId) => {
        const rootMatch = typeof projectRootOrRepoDescriptor === 'string'
          && path.resolve(projectRootOrRepoDescriptor) === path.resolve(fixture.projectRoot);
        const repoMatch = projectRootOrRepoDescriptor && typeof projectRootOrRepoDescriptor.repoId === 'string'
          && projectRootOrRepoDescriptor.repoId === fixture.repoId;
        return (rootMatch || repoMatch) && sessionId === fixture.sessionId
          ? { ok: true, record: fixture.record }
          : original(projectRootOrRepoDescriptor, sessionId);
      };
    }
    return loaded;
  };
}

const unlinkFailurePath = process.env.RUNTIME_TEST_UNLINK_FAILURE_PATH;
if (typeof unlinkFailurePath === 'string' && unlinkFailurePath.length > 0) {
  const originalUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = (target) => {
    if (path.resolve(target) === path.resolve(unlinkFailurePath)) {
      const error = new Error('Injected test-only unlink failure');
      error.code = 'EACCES';
      throw error;
    }
    return originalUnlinkSync(target);
  };
}
