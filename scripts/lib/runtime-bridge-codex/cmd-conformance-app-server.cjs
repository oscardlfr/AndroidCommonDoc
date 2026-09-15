'use strict';

// `conformance --mode app-server`: self-manages one genuine two-role session-run supervisor batch and drives exactly one real depth-0 leaf through genuine one-use consult-root/consult-root-status CLI children.

function createCmdConformanceAppServer({
  RC,
  REGISTRY_RECORD_MAX_BYTES,
  SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
  SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS,
  asyncSleep,
  canonicalJSONStringify,
  computeCoordinationRootId,
  computeRepoId,
  computeWorktreeId,
  coordinationRootPathFor,
  crypto,
  discoverPlan,
  findExistingRoleOwner,
  path,
  probeAppServerLiveCapability,
  readDurableRegistryRecordFd,
  readRegistryRecord,
  realpathOrSelf,
  registryRepoDir,
  resolveLiveCodexAppServerWorker,
  resolvePolicyPair,
  rll,
  roleProfileDigestFor,
  sha256String,
  spawn,
  spawnSync,
  stopOwnedAppServerChildBounded,
}) {
// ── conformance --mode app-server (Sequence 99: sequence95-codex-decision.json
// GO_WITH_CLOSED_BINDING, sequence98-codex-audit.json accepted_red). Self-
// manages one genuine two-role session-run supervisor batch, drives exactly
// one real depth-0 leaf through genuine one-use consult-root/consult-root-
// status CLI children (never a direct handler export or call), and reports
// truthful rc/attempted per the closed exit contract. ──

const APP_SERVER_CONFORMANCE_ROLES = Object.freeze(['arch-platform', 'context-provider']);
const APP_SERVER_CONFORMANCE_BINDING_TTL_SECONDS = 3600;
const APP_SERVER_CONFORMANCE_READY_TIMEOUT_MS = 20000;
const APP_SERVER_CONFORMANCE_READY_POLL_MS = 200;
const APP_SERVER_CONFORMANCE_STATUS_TIMEOUT_MS = 20000;
const APP_SERVER_CONFORMANCE_STATUS_POLL_MS = 300;
const APP_SERVER_CONFORMANCE_CHILD_TIMEOUT_MS = 10000;

function appServerConformanceVerdict(ok, attempted, reason) {
  return {
    schema: 'coordination/bridge-result/v1', command: 'conformance', ok, mode: 'app-server', attempted, reason,
  };
}

/** @returns {never} */
function emitAppServerConformanceVerdict(rc, ok, attempted, reason) {
  process.stdout.write(JSON.stringify(appServerConformanceVerdict(ok, attempted, reason)) + '\n');
  process.exit(rc);
}

function appServerConformanceNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Spawns one short-lived `runtime-role-lifecycle.cjs <subcommand> ...` child
 * (the project's own copy, resolved the SAME project-root-relative way the
 * genuine minted session-run argv already resolves its own sibling bridge
 * file), bounded by spawnSync's own `timeout`, and returns its parsed closed
 * `coordination/lifecycle-cli-result/v1` envelope. Never throws; every
 * anomaly (spawn failure, timeout, malformed stdout) reports `ok:false`
 * honestly rather than fabricating a result.
 */
function spawnRoleLifecycleChildBounded(rllPath, projectRoot, args, timeoutMs) {
  const r = spawnSync(process.execPath, [rllPath].concat(args), {
    cwd: projectRoot, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (!r || r.error) return { ok: false };
  const lines = String(r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      continue;
    }
    if (parsed && typeof parsed === 'object') return { ok: true, code: r.status, result: parsed };
  }
  return { ok: false };
}

/**
 * Bounds startup by polling only the existing durable owner/bindings via
 * the canonical resolveLiveCodexAppServerWorker chain until BOTH roles are
 * READY, live and co-retained under the identical action/supervisor/
 * rendezvous/pid tuple. A genuine early exit of the already-spawned
 * session-run child is a definitive startup failure, never silently
 * retried until the bound elapses.
 */
async function waitForAppServerConformanceRolesReady(projectRoot, sessionRunChild, deadlineMs) {
  let exited = false;
  const onExit = () => { exited = true; };
  sessionRunChild.once('exit', onExit);
  try {
    for (;;) {
      if (exited) return { ok: false, reason: 'session-run-child-exited-before-ready' };
      let workers = null;
      try {
        workers = APP_SERVER_CONFORMANCE_ROLES.map(
          (role) => resolveLiveCodexAppServerWorker(projectRoot, role, roleProfileDigestFor(role)),
        );
      } catch (err) {
        workers = null;
      }
      if (workers && workers.every((w) => w && w.ok && w.available)) {
        const wa = workers[0].worker;
        const wb = workers[1].worker;
        if (
          wa.actionId === wb.actionId && wa.supervisorInstanceId === wb.supervisorInstanceId
          && wa.rendezvousInstanceId === wb.rendezvousInstanceId && wa.pid === wb.pid
        ) return { ok: true };
      }
      if (Date.now() >= deadlineMs) return { ok: false, reason: 'ready-wait-timeout' };
      await asyncSleep(APP_SERVER_CONFORMANCE_READY_POLL_MS);
    }
  } finally {
    sessionRunChild.removeListener('exit', onExit);
  }
}

/**
 * The one exact canonical root intent -- requester arch-platform, target
 * context-provider, a bounded fixed question, expected result kind
 * CONFORMANCE-LEAF-ANSWER, evidence policy none -- as the closed five-key
 * object in canonical sorted-key JSON order, base64url-encoded exactly as
 * the sibling CLI's own intent decoder requires.
 */
function encodeAppServerConformanceRootIntent() {
  const payload = {
    evidence_policy: 'none',
    expected_result_kind: 'CONFORMANCE-LEAF-ANSWER',
    question: 'APP-LIVE app-server conformance leaf: arch-platform requests one bounded context-provider acknowledgement to prove the live consult-root round trip.',
    requester_role: 'arch-platform',
    target_role: 'context-provider',
  };
  return Buffer.from(canonicalJSONStringify(payload), 'utf8').toString('base64url');
}

/**
 * The one durable publication proof that ever flips `attempted` true --
 * read fresh from disk, never trusted from a prior poll's own self-report,
 * and never true merely because admission was minted, a session-run child
 * was spawned, or an intent was created.
 */
function appServerConformanceRootConsultPublished(projectRoot, intentId) {
  const read = readRegistryRecord(rll.rootConsultPublishedPathFor(projectRoot, intentId));
  return !!(read && read.ok && !read.absent && read.obj);
}

/**
 * On every terminal path: a bounded SIGTERM-then-SIGKILL confirmation of
 * the owned session-run child (the identical confirmation primitive
 * session-run's own shutdown path already uses), then -- only once that
 * process is PROVEN absent -- one bounded, separately spawned worker-
 * cleanup child process against the exact coordination root. Cleanup/
 * internal ambiguity overrides whatever pending result the run itself
 * produced, becoming rc7; a consumed grant and its intent/published/
 * completion evidence are left readable on disk either way.
 * @returns {never}
 */
async function finalizeAppServerConformance(bridgePath, sessionRunChild, coordinationRootReal, pendingRc, pendingOk, pendingAttempted, pendingReason, repoId, actionId) {
  const stopResult = await stopOwnedAppServerChildBounded(
    sessionRunChild, SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS, SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
  );
  let cleanupOk = !!stopResult.stopped;
  // P1-A (sequence123-codex-r129-binding.md section5): "requires actual
  // normal exit with the mapped functional rc plus the exact consumed-
  // action shutdown receipt... Receipt or child rc7, signal exit, forced
  // parent kill, missing/malformed/foreign receipt or inconsistent code
  // becomes conformance rc7 even if worker-cleanup later returns0. With
  // clean resource proof, a nonzero child functional rc3/4/5/6 takes
  // precedence over the pending leaf verdict; otherwise preserve pendingRc."
  // Evaluated regardless of stopResult.stopped -- an unconfirmed/forced-kill
  // stop is itself the FIRST resource-uncertain case, never silently folded
  // into the SEPARATE worker-cleanup-failure branch below.
  let resourceUncertain = false;
  let childFunctionalRc = null;
  if (!stopResult.stopped) {
    resourceUncertain = true;
  } else if (sessionRunChild.signalCode) {
    // A genuinely signal-terminated exit (SIGKILL escalation, or any other
    // signal this owned child was never given the chance to convert into
    // its own graceful process.exit(rc)) -- never treated as though it were
    // the mapped functional rc the child itself never got to report.
    resourceUncertain = true;
  } else if (typeof sessionRunChild.exitCode === 'number') {
    childFunctionalRc = sessionRunChild.exitCode;
    if (childFunctionalRc === RC.CLEANUP_INTERNAL) resourceUncertain = true;
  } else {
    resourceUncertain = true;
  }
  let receiptValid = false;
  if (appServerConformanceNonEmptyString(repoId) && appServerConformanceNonEmptyString(actionId)) {
    try {
      const receiptPath = path.join(registryRepoDir({ repoId }), 'shutdown-receipts', actionId + '.json');
      const receiptRead = readDurableRegistryRecordFd(receiptPath, REGISTRY_RECORD_MAX_BYTES);
      if (receiptRead.ok && receiptRead.exists) {
        const receiptRecord = JSON.parse(receiptRead.text);
        receiptValid = !!(
          receiptRecord && typeof receiptRecord === 'object'
          && receiptRecord.schema === 'runtime/owned-shutdown-receipt/v1'
          && receiptRecord.action_id === actionId
        );
      }
    } catch (err) {
      receiptValid = false;
    }
  }
  if (!receiptValid) resourceUncertain = true;
  if (cleanupOk) {
    const cleanupRun = spawnSync(process.execPath, [bridgePath, 'worker-cleanup', '--coordination-root', coordinationRootReal], {
      encoding: 'utf8', timeout: APP_SERVER_CONFORMANCE_CHILD_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    cleanupOk = !!(cleanupRun && !cleanupRun.error && cleanupRun.status === RC.OK);
  }
  if (!cleanupOk) return emitAppServerConformanceVerdict(RC.CLEANUP_INTERNAL, false, pendingAttempted, 'cleanup-failed');
  if (resourceUncertain) {
    return emitAppServerConformanceVerdict(RC.CLEANUP_INTERNAL, false, pendingAttempted, 'shutdown-receipt-uncertain');
  }
  if (childFunctionalRc !== null && childFunctionalRc !== RC.OK) {
    return emitAppServerConformanceVerdict(childFunctionalRc, false, pendingAttempted, 'child-functional-failure');
  }
  return emitAppServerConformanceVerdict(pendingRc, pendingOk, pendingAttempted, pendingReason);
}

/**
 * `conformance --mode app-server`'s closed implementation
 * (sequence95-codex-decision.json GO_WITH_CLOSED_BINDING). Self-manages one
 * genuine session-run supervisor batch for exactly arch-platform and
 * context-provider, drives exactly one real leaf through genuine
 * runtime-role-lifecycle.cjs CLI children under one-use normal-profile
 * lifecycle grants minted from its own already-genuine live
 * MainOrchestratorBinding, and reports a truthful rc0/3/4/5/6/7 with an
 * honest `attempted` boolean -- never a fabricated result.
 * @returns {never}
 */
async function cmdConformanceAppServer(projectRoot) {
  // 2. Accepted R2 preflight -- rc3 capability/schema absence, rc4 auth/
  // isolation, both attempted:false, before touching anything else.
  const preflight = probeAppServerLiveCapability();
  if (!preflight.ok) {
    return emitAppServerConformanceVerdict(preflight.rc, false, false, preflight.reason);
  }

  // 3. Real project/worktree/coordination-root/PLAN/policy scope, and a
  // read-only reject of an existing live singleton before any mint/spawn.
  let repoId;
  let worktreeId;
  try {
    repoId = computeRepoId(projectRoot);
    worktreeId = computeWorktreeId(projectRoot);
  } catch (err) {
    return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'scope-derivation-failed');
  }
  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'plan-not-discoverable');
  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'policy-invalid');
  const repoDescriptor = { repoId };
  const coordinationRootReal = realpathOrSelf(coordinationRootPathFor(projectRoot));
  const coordinationRootId = computeCoordinationRootId(coordinationRootReal);

  const existingOwner = findExistingRoleOwner(repoDescriptor, coordinationRootId);
  if (!existingOwner.ok) return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, existingOwner.reason);
  if (existingOwner.found) {
    return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'singleton-supervisor-already-retained:' + existingOwner.role);
  }

  // 4. One genuine host-private MainOrchestratorBinding for this run,
  // through the existing session-generation/binding primitives -- its
  // generation is re-derived below from its own runtime tuple, never
  // invented or stored on the binding itself.
  const sessionId = 'app-server-conformance:' + crypto.randomBytes(16).toString('hex');
  const bindingResult = rll.getOrCreateMainOrchestratorBindingForSession(
    repoDescriptor, sessionId, worktreeId, planResult.planDigest, APP_SERVER_CONFORMANCE_BINDING_TTL_SECONDS,
  );
  if (!bindingResult.ok) {
    return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'main-binding-unavailable:' + bindingResult.reason);
  }
  const binding = bindingResult.binding;
  const genResult = rll.resolveSessionGeneration(
    repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key },
  );
  if (!genResult.ok) return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'session-generation-unavailable');

  // 5. One supervisor-start batch for exactly the sorted canonical roles
  // arch-platform+context-provider, both ABSENT->STARTING, driver
  // codex-app-server, through the existing production transaction
  // primitive; then the matching execution claim through the existing
  // production primitive.
  const codexGroup = APP_SERVER_CONFORMANCE_ROLES.map((role) => ({
    role,
    profileDigest: roleProfileDigestFor(role),
    fromState: 'ABSENT',
    toState: 'STARTING',
    fromRecord: null,
    respawnCount: 0,
    driver: 'codex-app-server',
  }));
  const batchResult = rll.mintSupervisorBatchUnderTransaction(
    projectRoot, pair, repoId, worktreeId, planResult.planDigest, genResult.generationId, codexGroup, binding.expiry,
  );
  if (!batchResult.ok || batchResult.unavailable) {
    return emitAppServerConformanceVerdict(
      RC.AUTH_ISOLATION, false, false,
      batchResult.ok ? 'supervisor-batch-unavailable' : ('supervisor-batch-mint-failed:' + (batchResult.reason || '')),
    );
  }
  const action = batchResult.action;
  const claimResult = rll.mintSupervisorExecutionClaimForSession(repoDescriptor, action, projectRoot, sessionId);
  if (!claimResult.ok) {
    return emitAppServerConformanceVerdict(RC.AUTH_ISOLATION, false, false, 'execution-claim-mint-failed:' + (claimResult.reason || ''));
  }

  // 6. Spawn exactly the action's own genuine session-run argv as a child
  // OS process, shell false, as a fully separate program (never an
  // in-process call of any kind), then bound startup by polling only
  // existing durable state until both roles are READY/live/co-retained.
  const bridgeArgv = action.payload.bridge_argv;
  const bridgePath = bridgeArgv[1];
  const sessionRunChild = spawn(bridgeArgv[0], bridgeArgv.slice(1), {
    cwd: projectRoot, stdio: ['ignore', 'ignore', 'ignore'], shell: false, windowsHide: true,
  });
  const readyResult = await waitForAppServerConformanceRolesReady(
    projectRoot, sessionRunChild, Date.now() + APP_SERVER_CONFORMANCE_READY_TIMEOUT_MS,
  );
  if (!readyResult.ok) {
    const rc = readyResult.reason === 'ready-wait-timeout' ? RC.TIMEOUT : RC.AUTH_ISOLATION;
    return finalizeAppServerConformance(bridgePath, sessionRunChild, coordinationRootReal, rc, false, false, readyResult.reason, repoId, action.action_id);
  }

  // 7/8. The canonical root intent, one one-use normal-profile lifecycle
  // grant for consult-root minted from the genuine Main binding, and the
  // real runtime-role-lifecycle.cjs consult-root CLI child -- never a
  // direct handler export/call.
  // Sequence 15 extraction moved this module one directory deeper than the
  // pre-extraction monolith (scripts/lib/ -> scripts/lib/runtime-bridge-codex/).
  const rllPath = path.join(__dirname, '..', 'runtime-role-lifecycle.cjs');
  const encodedIntent = encodeAppServerConformanceRootIntent();
  const consultRootDigest = sha256String('consult-root:' + encodedIntent);
  const consultRootGrant = rll.mintLifecycleCommandGrant(
    projectRoot, binding, consultRootDigest, 'arch-platform', 'consult-root', 'main-orchestrator', 'orchestrator', 'normal', null,
  );
  if (!consultRootGrant.ok) {
    return finalizeAppServerConformance(
      bridgePath, sessionRunChild, coordinationRootReal, RC.AUTH_ISOLATION, false, false,
      'consult-root-grant-mint-failed:' + (consultRootGrant.reason || ''),
      repoId, action.action_id,
    );
  }
  const consultRootRun = spawnRoleLifecycleChildBounded(rllPath, projectRoot, [
    'consult-root', '--project-root', projectRoot, '--intent', encodedIntent, '--lifecycle-binding', consultRootGrant.grantId,
  ], APP_SERVER_CONFORMANCE_CHILD_TIMEOUT_MS);
  const consultRootOperation = consultRootRun.ok && consultRootRun.result ? consultRootRun.result.operation : null;
  const intentId = consultRootOperation && appServerConformanceNonEmptyString(consultRootOperation.operation_id)
    ? consultRootOperation.operation_id : null;
  if (!consultRootRun.ok || consultRootRun.code !== RC.OK || !consultRootRun.result || consultRootRun.result.status !== 'WAITING' || !intentId) {
    return finalizeAppServerConformance(
      bridgePath, sessionRunChild, coordinationRootReal, RC.AUTH_ISOLATION, false, false, 'consult-root-child-failed',
      repoId, action.action_id,
    );
  }

  // 9/10. Poll consult-root-status with a FRESH one-use grant per attempt
  // -- never reused -- until READY (with a fully digest-correlated durable
  // completion), BLOCKED, or a bounded post-attempt timeout. `attempted`
  // becomes true only once durable status proves the request was
  // genuinely published, re-proven fresh from disk below.
  const statusDeadlineMs = Date.now() + APP_SERVER_CONFORMANCE_STATUS_TIMEOUT_MS;
  let terminalOutcome = null;
  let consecutiveBlockedObservations = 0;
  for (;;) {
    const statusDigest = sha256String('consult-root-status:' + intentId);
    const statusGrant = rll.mintLifecycleCommandGrant(
      projectRoot, binding, statusDigest, 'arch-platform', 'consult-root-status', 'main-orchestrator', 'orchestrator', 'normal', null,
    );
    if (statusGrant.ok) {
      const statusRun = spawnRoleLifecycleChildBounded(rllPath, projectRoot, [
        'consult-root-status', '--project-root', projectRoot, '--intent-id', intentId, '--lifecycle-binding', statusGrant.grantId,
      ], APP_SERVER_CONFORMANCE_CHILD_TIMEOUT_MS);
      if (statusRun.ok && statusRun.code === RC.OK && statusRun.result) {
        const op = statusRun.result.operation;
        if (
          statusRun.result.status === 'READY' && op
          && appServerConformanceNonEmptyString(op.result_ref) && appServerConformanceNonEmptyString(op.result_digest)
          && appServerConformanceNonEmptyString(op.accepted_result_ref) && appServerConformanceNonEmptyString(op.accepted_result_digest)
          && appServerConformanceNonEmptyString(op.ack_ref) && appServerConformanceNonEmptyString(op.ack_digest)
        ) { terminalOutcome = 'ready'; break; }
        if (statusRun.result.status === 'BLOCKED') {
          // consult-root dispatch is asynchronous. Immediately after the
          // WAITING admission, one status child can observe the retained
          // hand-off between reservation and request publication as BLOCKED
          // even though the same live owner is still advancing it. Confirm a
          // terminal block across three fresh, independently authorized
          // observations; a genuine lost/blocked owner remains blocked,
          // while the publication hand-off advances to WAITING/READY.
          consecutiveBlockedObservations += 1;
          if (consecutiveBlockedObservations >= 3) { terminalOutcome = 'blocked'; break; }
        } else {
          consecutiveBlockedObservations = 0;
        }
      } else {
        consecutiveBlockedObservations = 0;
      }
    } else {
      consecutiveBlockedObservations = 0;
    }
    if (Date.now() >= statusDeadlineMs) break;
    await asyncSleep(APP_SERVER_CONFORMANCE_STATUS_POLL_MS);
  }

  const attempted = appServerConformanceRootConsultPublished(projectRoot, intentId);
  let pendingRc;
  let pendingOk;
  let pendingReason;
  if (terminalOutcome === 'ready') {
    pendingRc = RC.OK; pendingOk = true; pendingReason = 'root-consult-completed';
  } else if (terminalOutcome === 'blocked') {
    pendingRc = RC.LIVE_CONFORMANCE_FAILURE; pendingOk = false; pendingReason = 'root-consult-blocked';
  } else {
    pendingRc = RC.TIMEOUT; pendingOk = false; pendingReason = 'root-consult-status-timeout';
  }

  // 11/12. Bounded stop + one bounded worker-cleanup child; the terminal
  // result above is reported unless cleanup itself is ambiguous.
  return finalizeAppServerConformance(bridgePath, sessionRunChild, coordinationRootReal, pendingRc, pendingOk, attempted, pendingReason, repoId, action.action_id);
}

  return Object.freeze({
    APP_SERVER_CONFORMANCE_BINDING_TTL_SECONDS,
    APP_SERVER_CONFORMANCE_CHILD_TIMEOUT_MS,
    APP_SERVER_CONFORMANCE_READY_POLL_MS,
    APP_SERVER_CONFORMANCE_READY_TIMEOUT_MS,
    APP_SERVER_CONFORMANCE_ROLES,
    APP_SERVER_CONFORMANCE_STATUS_POLL_MS,
    APP_SERVER_CONFORMANCE_STATUS_TIMEOUT_MS,
    appServerConformanceNonEmptyString,
    appServerConformanceRootConsultPublished,
    appServerConformanceVerdict,
    cmdConformanceAppServer,
    emitAppServerConformanceVerdict,
    encodeAppServerConformanceRootIntent,
    finalizeAppServerConformance,
    spawnRoleLifecycleChildBounded,
    waitForAppServerConformanceRolesReady,
  });
}

module.exports = Object.freeze({ createCmdConformanceAppServer });
