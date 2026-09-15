'use strict';

// `worker-cleanup` CLI command controller: safe registry/home cleanup through retained proven identities, never signalling or killing by an untrusted registry PID.

function createCmdWorkerCleanup({
  CANONICAL_ROLES,
  RC,
  computeCoordinationRootId,
  computeRepoId,
  deriveProjectRootFromCoordinationRoot,
  readRegistryRecord,
  releaseConfirmedDeadSupervisorOwners,
  roleOwnerPathFor,
  usageError,
}) {
// ── worker-cleanup (PLAN.md ~L879, "Owned-child stop vs registry cleanup") ──

const WORKER_CLEANUP_SPEC = Object.freeze({
  '--coordination-root': { required: true, repeatable: false },
});

/** @param {string[]} rawArgv @returns {{ok:true,value:{coordinationRoot:string}}|{ok:false,reason:string}} */
function parseWorkerCleanupArgv(rawArgv) {
  const out = { coordinationRoot: null };
  const seen = {};
  let i = 0;
  while (i < rawArgv.length) {
    const flag = rawArgv[i];
    const spec = WORKER_CLEANUP_SPEC[flag];
    if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
    if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
    const value = rawArgv[i + 1];
    if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
    seen[flag] = true;
    out.coordinationRoot = value;
    i += 2;
  }
  const missing = Object.keys(WORKER_CLEANUP_SPEC).filter((flag) => WORKER_CLEANUP_SPEC[flag].required && !seen[flag]);
  if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
  return { ok: true, value: out };
}

/**
 * PLAN.md ~L879/~L1077: safe registry/home cleanup through retained proven
 * identities/handles and existing tombstone/finalization primitives; NEVER
 * signals or kills by an untrusted registry PID. Composition:
 * releaseConfirmedDeadSupervisorOwners (above) independently re-derives
 * OS-level liveness for the EXACT pid_identity each owner record itself
 * carries before ever touching it, and only ever removes registry bytes for
 * a PID it has itself proven ABSENT -- the same tombstone primitive
 * session-run's own crash recovery already uses, never a second cleanup
 * writer.
 */
function cmdWorkerCleanup(rawArgv) {
  const parsed = parseWorkerCleanupArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  const rootResult = deriveProjectRootFromCoordinationRoot(parsed.value.coordinationRoot);
  if (!rootResult.ok) {
    process.stderr.write('[worker-cleanup] rejected: ' + rootResult.reason + '\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  let repoId;
  try {
    repoId = computeRepoId(rootResult.projectRoot);
  } catch (err) {
    process.stderr.write('[worker-cleanup] rejected: repo-id-unresolvable\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  const repoDescriptor = { repoId };
  const coordinationRootId = computeCoordinationRootId(rootResult.coordRootReal);

  let released = 0;
  let skipped = 0;
  let errors = 0;
  for (const role of CANONICAL_ROLES) {
    const ownerPath = roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
    let read;
    try {
      read = readRegistryRecord(ownerPath);
    } catch (err) {
      errors += 1;
      continue;
    }
    if (!read.ok || read.absent || !read.obj || !read.obj.pid_identity) { skipped += 1; continue; }
    const result = releaseConfirmedDeadSupervisorOwners(repoDescriptor, coordinationRootId, [role], read.obj.pid_identity);
    if (result.ok) released += result.released;
    else if (result.reason === 'dead-supervisor-not-proven-absent') skipped += 1;
    else errors += 1;
  }

  const verdict = {
    schema: 'coordination/bridge-result/v1', command: 'worker-cleanup', ok: errors === 0,
    coordination_root_id: coordinationRootId, released, skipped, errors,
  };
  process.stdout.write(JSON.stringify(verdict) + '\n');
  process.exit(errors === 0 ? RC.OK : RC.CLEANUP_INTERNAL);
}

  return Object.freeze({
    WORKER_CLEANUP_SPEC,
    cmdWorkerCleanup,
    parseWorkerCleanupArgv,
  });
}

module.exports = Object.freeze({ createCmdWorkerCleanup });
