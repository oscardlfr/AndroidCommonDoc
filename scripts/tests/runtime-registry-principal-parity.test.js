#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- see that file's own
// doc comment for why (registryBaseDir() is os.tmpdir()-rooted and shared
// with real production registry data on this machine without this).
require('./lib/private-registry-tmpdir-preload.cjs');

// Coverage-pinning for the arch-platform PREP verdict finding (PLAN.md:6085-6086
// authorized): runtime-consultation.cjs's localComputePrincipalId/
// localRegistryRepoDir (source :6386-6392, exported test-capability-only at
// :13340-13352) are documented at their own definition as logic-identical local
// copies of runtime-role-lifecycle.cjs's own computePrincipalId/registryRepoDir
// (:756-759/:987-992) -- verified byte-identical by inspection but previously
// unpinned by any test. Both sides are pure path/string functions with no I/O;
// ensureSecureRegistryDir/localEnsureSecureRegistryDir (real fs.mkdirSync side
// effects) are deliberately out of scope. registryRepoDir(projectRootOrRepoId)
// additionally accepts an absolute project-root path (git-derived via
// computeRepoId) that localRegistryRepoDir has no equivalent for, so the
// correct comparison drives registryRepoDir via its `{repoId}` descriptor form,
// never a bare string, for the same repoId on both sides.

const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');

const TEST_CAPABILITY = 'registry-principal-parity-fixture-capability';
// Must be set before requiring runtime-consultation.cjs: isTestCapability()
// (runtime-consultation.cjs:212-218) resolves once at require time.
process.env.NODE_ENV = 'test';
process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = TEST_CAPABILITY;

// rll is required first because it transitively requires runtime-consultation.cjs
// (see that file's own "circular import" note); requiring rc directly afterward
// resolves to the same cached, now-gated module instance.
const rll = require(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));

const REPO_ID_FIXTURE = 'registry-principal-parity-fixture-repo-id';

test('localComputePrincipalId is byte-identical to the canonical computePrincipalId', () => {
  assert.strictEqual(rc.localComputePrincipalId(), rll.computePrincipalId());
});

test('localRegistryRepoDir(repoId) is byte-identical to the canonical registryRepoDir({repoId})', () => {
  assert.strictEqual(rc.localRegistryRepoDir(REPO_ID_FIXTURE), rll.registryRepoDir({ repoId: REPO_ID_FIXTURE }));
});
