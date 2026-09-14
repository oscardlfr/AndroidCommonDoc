'use strict';

// `runtime-spawn` CLI command controller: composes only the existing confinement/artifact/live-worker-discovery primitives, reports an honest gap for anything beyond that.

function createCmdRuntimeSpawn({
  RC,
  deriveProjectRootFromCoordinationRoot,
  readCanonicalRequestArtifact,
  resolveLiveCodexAppServerWorker,
  usageError,
}) {
// ── runtime-spawn (PLAN.md ~L876) ──

const RUNTIME_SPAWN_SPEC = Object.freeze({
  '--coordination-root': { required: true, repeatable: false },
  '--request': { required: true, repeatable: false },
});

/** @param {string[]} rawArgv @returns {{ok:true,value:{coordinationRoot:string,request:string}}|{ok:false,reason:string}} */
function parseRuntimeSpawnArgv(rawArgv) {
  const out = { coordinationRoot: null, request: null };
  const seen = {};
  let i = 0;
  while (i < rawArgv.length) {
    const flag = rawArgv[i];
    const spec = RUNTIME_SPAWN_SPEC[flag];
    if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
    if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
    const value = rawArgv[i + 1];
    if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
    seen[flag] = true;
    if (flag === '--coordination-root') out.coordinationRoot = value;
    else if (flag === '--request') out.request = value;
    i += 2;
  }
  const missing = Object.keys(RUNTIME_SPAWN_SPEC).filter((flag) => RUNTIME_SPAWN_SPEC[flag].required && !seen[flag]);
  if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
  return { ok: true, value: out };
}

/**
 * PLAN.md ~L876: invokes only the fixed allowlisted wake helper for an
 * already-registered supervised disk consumer, argv array + `shell:false`;
 * never a model/runtime, never arbitrary executable/argv/prompt/result
 * bytes, and unavailable without the ready supervisor, binding, AND a
 * private target-grant issuer. Composition: the "already-registered
 * supervised disk consumer" this subcommand may wake is exactly a READY,
 * live `codex-app-server` worker for the request's own `target_role` --
 * the SAME capability proof runtime-consultation.cjs dispatch itself
 * consumes (resolveLiveCodexAppServerWorker, above), never a second,
 * weaker check. No wake-helper-argv registration primitive is exported
 * anywhere else in this module (confirmed by direct read of every export
 * this file publishes); delivery for this driver is explicitly "telemetry
 * only" (PLAN.md Notification Transports), so this subcommand fails closed
 * rather than invent one -- the authoritative disk-poll path the same
 * worker already runs is entirely unaffected by this subcommand ever
 * declining to wake it.
 */
function cmdRuntimeSpawn(rawArgv) {
  const parsed = parseRuntimeSpawnArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  const rootResult = deriveProjectRootFromCoordinationRoot(parsed.value.coordinationRoot);
  if (!rootResult.ok) {
    process.stderr.write('[runtime-spawn] rejected: ' + rootResult.reason + '\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  const requestResult = readCanonicalRequestArtifact(rootResult.coordRootReal, parsed.value.request);
  if (!requestResult.ok) {
    process.stderr.write('[runtime-spawn] rejected: ' + requestResult.reason + '\n');
    process.exit(RC.CAPABILITY_SCHEMA_DRIFT);
  }
  let worker;
  try {
    worker = resolveLiveCodexAppServerWorker(rootResult.projectRoot, requestResult.targetRole);
  } catch (err) {
    worker = { ok: false, reason: 'worker-resolution-threw' };
  }
  if (!worker.ok || !worker.available) {
    process.stderr.write('[runtime-spawn] unavailable: ' + (worker.reason || 'supervisor-not-ready') + '\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  process.stderr.write('[runtime-spawn] unavailable: private-target-grant-issuer-not-yet-composed\n');
  process.exit(RC.AUTH_ISOLATION);
}

  return Object.freeze({
    RUNTIME_SPAWN_SPEC,
    cmdRuntimeSpawn,
    parseRuntimeSpawnArgv,
  });
}

module.exports = Object.freeze({ createCmdRuntimeSpawn });
