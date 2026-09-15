'use strict';

function createLifecycleActionRecord(deps) {
  const { fs, path, crypto, Buffer, canonicalJSONStringify, currentClockMsForRegistry, ensureSecureRegistryDir, isHexActionId, isoToMsForRegistry, publishNoClobber, readRegistryRecord, registryBaseDir, registryRepoDir, validateRootSourceAction } = deps;

const ACTION_KIND_ENUM = Object.freeze([
  'team-ensure', 'role-spawn', 'role-rebind', 'role-notify', 'role-stop-owned',
  'root-source-spawn', 'supervisor-start', 'supervisor-stop-owned',
]);
const ACTION_RUNTIME_ENUM = Object.freeze(['claude-native', 'host-process']);
const ACTION_KIND_RUNTIME = Object.freeze({
  'team-ensure': 'claude-native',
  'role-spawn': 'claude-native',
  'role-rebind': null, // both claude-native and host-process variants exist (PLAN.md ~L158-159); caller supplies it
  'role-notify': 'claude-native',
  'role-stop-owned': 'claude-native',
  'root-source-spawn': 'claude-native',
  'supervisor-start': 'host-process',
  'supervisor-stop-owned': 'host-process',
});

// M6: the exact closed (kind,runtime)->host-operation mapping, transcribed
// verbatim from PLAN.md ~L176-185 ("Mapping is exact: team-ensure ->
// TeamCreate only when that native capability is present; role-spawn -> one
// background/team Agent call...; Claude role-rebind/role-notify ->
// SendMessage...; host-process role-rebind -> the retained authenticated
// supervisor control; role-stop-owned -> the runtime's owned peer shutdown;
// supervisor-start -> one sanctioned background Bash-tool launch...;
// supervisor-stop-owned -> stop only the retained owned handle").
const HOST_OPERATION_FOR_ACTION = Object.freeze({
  'team-ensure/claude-native': 'TeamCreate',
  'role-spawn/claude-native': 'Agent',
  'role-rebind/claude-native': 'SendMessage',
  'role-rebind/host-process': 'retained-supervisor-control',
  'role-notify/claude-native': 'SendMessage',
  'role-stop-owned/claude-native': 'owned-peer-shutdown',
  'root-source-spawn/claude-native': 'Agent',
  'supervisor-start/host-process': 'bash-tool-launch',
  'supervisor-stop-owned/host-process': 'owned-handle-stop',
});

/**
 * Pure, side-effect-free lookup: every closed `(kind,runtime)` pair from
 * PLAN.md ~L176-185's frozen mapping resolves to exactly its documented
 * host-operation descriptor. NEVER itself calls `TeamCreate`/`Agent`/
 * `SendMessage` or any other host action -- it only returns the label of
 * what an interpreter SHOULD call; execution stays entirely outside this
 * file. An unknown `kind`, or a `(kind,runtime)` pair outside the closed
 * table (e.g. a kind crossed with the wrong runtime for it), resolves to
 * `null` -- never a guessed fallback.
 * @param {string} kind
 * @param {string} runtime
 * @returns {string|null}
 */
function resolveHostOperationForAction(kind, runtime) {
  if (typeof kind !== 'string' || typeof runtime !== 'string') return null;
  const key = kind + '/' + runtime;
  return Object.prototype.hasOwnProperty.call(HOST_OPERATION_FOR_ACTION, key) ? HOST_OPERATION_FOR_ACTION[key] : null;
}
const ACTION_TTL_CEILING_SECONDS = 120; // PLAN.md ~L154: expiry bounded by ready_timeout_seconds, max 120s.
const CLAUDE_NATIVE_STARTUP_TIMEOUT_DEFAULT_SECONDS = 480;

/**
 * The startup actions whose expiry bounds a real host bringing a worker up, as opposed to an
 * ordinary correlation window. Both kinds must be recognized in the SAME place the policy value is
 * chosen AND where that value is bounds-checked; when only one of the two knew about a startup
 * class, the value and its ceiling disagreed and the mint failed closed instead.
 * @param {{kind?:string,runtime?:string}} scope
 * @returns {{native:boolean,supervisor:boolean,startup:boolean}}
 */
function classifyStartupScope(scope) {
  const native = Boolean(scope && scope.runtime === 'claude-native'
    && (scope.kind === 'role-spawn' || scope.kind === 'root-source-spawn'));
  const supervisor = Boolean(scope && scope.kind === 'supervisor-start' && scope.runtime === 'host-process');
  return { native, supervisor, startup: native || supervisor };
}

function actionTtlPolicyLimitSeconds(policy, scope) {
  const { native: isNativeAgentStartup, supervisor: isSupervisorStartup } = classifyStartupScope(scope);
  if (isNativeAgentStartup) {
    return Object.prototype.hasOwnProperty.call(policy, 'claude_native_startup_timeout_seconds')
      ? policy.claude_native_startup_timeout_seconds
      : CLAUDE_NATIVE_STARTUP_TIMEOUT_DEFAULT_SECONDS;
  }
  // A supervisor start is NOT given its own widened action window, and this is deliberate.
  //
  // It was, briefly: the reasoning was that a batch which must create an isolation root per role,
  // confine it, materialize a child config, spawn a real app-server, prove birth provenance,
  // initialize, log in, start a thread and complete a bootstrap turn should not be held to the
  // ordinary ceiling. The full functional Bats roster disagreed, and it was right. Four ratified
  // invariants in runtime-consultation-bridge.bats depend on this action window staying short --
  // EXPIRY-SPLIT-01 (ready_timeout bounds action and claim; --session-expiry is the independently
  // later service authority), START-DEADLINE-01, SUP-RDV-16, and above all TTL-02, which tampers a
  // claim to created_at + 60s under a 10s policy and requires consumption to be REJECTED. Widening
  // this window widens exactly what a tampered one-use execution claim can get away with, so it is
  // a fail-closed relaxation, not an accommodation.
  //
  // The startup budget problem is real but belongs elsewhere: launch authority (this action and its
  // claim) is deliberately short-lived, while retained service authority is bounded separately by
  // --session-expiry, the min of the main binding's expiry and the session generation's. Anything a
  // long-running batch needs must come from that side, never by lengthening the launch authority.
  void isSupervisorStartup;
  return Math.min(policy.ready_timeout_seconds, ACTION_TTL_CEILING_SECONDS);
}

/**
 * WP3 item C correction (point 4): an action's expiry is never a flat
 * constant. Ordinary actions are bounded by the selected policy's own
 * `ready_timeout_seconds` and the frozen 120s ceiling (PLAN.md ~L154).
 * The two explicit claude-native Agent startup pairs use their separate
 * bounded policy value. Every action is also capped by the
 * MainOrchestratorBinding's own remaining lifetime -- an action can never
 * outlive either the policy that governs it or the authority that requested
 * it. Whole seconds, floored, minimum 1 (never zero/negative -- a
 * caller with an already-expired/near-expired binding should fail at the
 * binding-expiry check upstream, not mint a self-contradictory 0s action).
 * @param {{ready_timeout_seconds:number}} policy
 * @param {string} bindingExpiryIso
 * @returns {number}
 */
/**
 * WP3 item C correction pass R3 (point A.5): a binding with LESS THAN ONE
 * SECOND of remaining lifetime can never produce an action that would
 * outlive it -- fails closed rather than flooring to a fabricated minimum
 * (the previous `Math.max(1, ...)` could mint a 1s action against a binding
 * already expired or expiring in milliseconds, letting the action legitimately
 * outlive the authority that requested it).
 * @returns {{ok:true,ttlSeconds:number}|{ok:false,reason:string}}
 */
function computeActionTtlSeconds(policy, bindingExpiryIso) {
  return effectiveActionTtlSeconds(policy, bindingExpiryIso, null);
}

function effectiveActionTtlSeconds(policy, bindingExpiryIso, scope) {
  const nowMs = currentClockMsForRegistry();
  const bindingRemainingMs = isoToMsForRegistry(bindingExpiryIso) - nowMs;
  if (!Number.isFinite(bindingRemainingMs) || bindingRemainingMs < 1000) {
    return { ok: false, reason: 'binding-remaining-lifetime-insufficient' };
  }
  const policyLimitSeconds = actionTtlPolicyLimitSeconds(policy, scope);
  // The same classification the value was chosen with: a startup action is bounded by the startup
  // ceiling, everything else by the ordinary action ceiling. Still a hard bound, never unbounded.
  const policyLimitCeiling = classifyStartupScope(scope).startup ? 600 : ACTION_TTL_CEILING_SECONDS;
  if (!Number.isInteger(policyLimitSeconds) || policyLimitSeconds < 1
      || policyLimitSeconds > policyLimitCeiling) {
    return { ok: false, reason: 'action-ttl-policy-invalid' };
  }
  const bindingRemainingSeconds = Math.floor(bindingRemainingMs / 1000);
  return { ok: true, ttlSeconds: Math.max(1, Math.min(policyLimitSeconds, bindingRemainingSeconds)) };
}

function actionPathFor(projectRoot, actionId) {
  return path.join(registryRepoDir(projectRoot), 'actions', actionId + '.json');
}

/**
 * 128-bit CSPRNG action id, generated BEFORE the action's own payload is built
 * (`supervisor-start`'s `bridge_argv` embeds `--action <this-id>`, PLAN.md
 * ~L162 -- the payload cannot reference an id `mintRoleLifecycleAction` has not
 * generated yet, so callers that self-reference must mint the id first and
 * pass it in).
 */
function generateActionId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Mints one immutable, no-clobber `coordination/role-lifecycle-action/v1`
 * record under the caller-supplied `actionId` (see `generateActionId`).
 * `payload` must already be the exact closed shape for `kind` (callers below
 * build it) -- this function only handles the common envelope + no-clobber
 * persistence, never inspects/validates payload internals (single responsibility;
 * per-kind builders are the payload authority).
 * @returns {{ok:true,actionId:string,action:object}|{ok:false,reason:string}}
 */
function mintRoleLifecycleAction(projectRoot, actionId, kind, runtime, repoId, worktreeId, planDigest, policyDigest, generationId, role, payload, expiresAtIso) {
  if (!isHexActionId(actionId)) return { ok: false, reason: 'invalid-action-id' };
  if (!ACTION_KIND_ENUM.includes(kind)) return { ok: false, reason: 'invalid-kind' };
  if (!ACTION_RUNTIME_ENUM.includes(runtime)) return { ok: false, reason: 'invalid-runtime' };
  // A precomputed ISO instant, never a TTL re-derived here -- when this
  // value also seeds a supervisor-start payload's --session-expiry
  // (buildSupervisorStartPayload), the two must be BYTE-IDENTICAL, which a
  // second independent `now()`-based computation inside this function could
  // never guarantee (point 4: "el --session-expiry del bridge debe ser
  // exactamente ese expiry"). Bounding against policy/ceiling/binding
  // lifetime is computeActionTtlSeconds's job, called once by the caller.
  const expiresAtMs = isoToMsForRegistry(expiresAtIso);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= currentClockMsForRegistry()) {
    return { ok: false, reason: 'invalid-expiry' };
  }
  const action = {
    schema: 'coordination/role-lifecycle-action/v1',
    action_id: actionId,
    kind,
    runtime,
    repo_id: repoId,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    policy_digest: policyDigest,
    session_generation_id: generationId,
    role: role === undefined ? null : role,
    expires_at: expiresAtIso,
    payload,
  };
  if (kind === 'root-source-spawn') {
    const rootSourceValid = validateRootSourceAction(action);
    if (!rootSourceValid.ok) return { ok: false, reason: rootSourceValid.reason };
  }
  const dir = path.dirname(actionPathFor(projectRoot, actionId));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(actionPathFor(projectRoot, actionId), Buffer.from(canonicalJSONStringify(action), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'action-publish-failed' };
  }
  return { ok: true, actionId, action };
}

/**
 * The STDOUT-facing action shape (envelope `actions[]` entries): a subset that
 * excludes host-private fields never meant to reach the caller (none currently
 * -- the full action record is already caller-safe per PLAN.md ~L154's own
 * "no arm contains credentials, result content, a PID, a raw agent ID/runtime
 * handle, a caller-authored prompt" rule) but kept as a distinct function so a
 * future host-private-only field never leaks by accident.
 */
function actionForEnvelope(action) {
  return {
    schema: action.schema,
    action_id: action.action_id,
    kind: action.kind,
    runtime: action.runtime,
    repo_id: action.repo_id,
    worktree_id: action.worktree_id,
    plan_digest: action.plan_digest,
    policy_digest: action.policy_digest,
    session_generation_id: action.session_generation_id,
    role: action.role,
    expires_at: action.expires_at,
    payload: action.payload,
  };
}

const ACTION_ID_DIR_RE = /^[0-9a-f]{64}$/;

// M6+M7 SIXTEENTH Phase 2A: the registry base dir has been observed to
// accumulate tens of thousands of stale repo-scoped subtrees across a long
// wave history (host-private, gitignored, never GC'd by this file -- see
// registryBaseDir's own docstring). `findActionAcrossRepos` used to
// `readdirSync` the WHOLE base dir unconditionally on every call from EVERY
// caller, including the two hot-path callers below that already know their
// own projectRoot/repoId and never needed a scan at all (fixed separately,
// see `findActionDirect`). This constant bounds what remains a genuine
// necessity (the three CLI commands with no `--project-root` in their frozen
// argv): a directory this large must fail closed rather than let an
// unbounded scan degrade the hot path or silently miss/duplicate entries.
const MAX_ACTION_REPO_SCAN_ENTRIES = 1024;

/**
 * Shape-validates ONE already-read action record -- shared by both
 * `findActionAcrossRepos` (scan) and `findActionDirect` (direct lookup) so
 * the two never drift on what counts as a structurally valid action.
 * @param {object} action
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function validateActionRecordShapeForLookup(action) {
  if (!action || action.schema !== 'coordination/role-lifecycle-action/v1' || !ACTION_KIND_ENUM.includes(action.kind)) {
    return { ok: false, reason: 'action-shape-invalid' };
  }
  if (action.kind === 'root-source-spawn') {
    const rootSourceValid = validateRootSourceAction(action);
    if (!rootSourceValid.ok) return { ok: false, reason: rootSourceValid.reason };
  }
  return { ok: true };
}

/**
 * Direct-lookup counterpart to `findActionAcrossRepos`, for the callers that
 * already know their own scope (`projectRoot` or a `{repoId}` descriptor) and
 * therefore never need to guess it by scanning every repo-scoped registry
 * subtree this OS user owns. Same return contract as `findActionAcrossRepos`
 * minus the (here structurally impossible) `ambiguous-action-id` case -- a
 * single caller-derived path can never collide with itself.
 * @param {string|{repoId:string}} projectRootOrRepoDescriptor
 * @param {string} actionId
 * @returns {{ok:true,absent:true}|{ok:true,absent:false,action:object}|{ok:false,reason:string}}
 */
function findActionDirect(projectRootOrRepoDescriptor, actionId) {
  const read = readRegistryRecord(actionPathFor(projectRootOrRepoDescriptor, actionId));
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, absent: true };
  const shapeCheck = validateActionRecordShapeForLookup(read.obj);
  if (!shapeCheck.ok) return shapeCheck;
  return { ok: true, absent: false, action: read.obj };
}

/**
 * Locates a lifecycle action by id alone. `ready`/`action-failed`/`wait-ready`'s
 * frozen argv carries only `--action` (PLAN.md ~L143-145) -- no `--project-root`,
 * so the scope is derived from the action's own embedded identity rather than
 * guessed from CWD (which a bats/test subprocess's CWD would never legitimately
 * match anyway). Scans each of THIS SAME OS user's own repo-scoped registry
 * subtrees (0700, owner-confined -- not a cross-user disclosure) for the one
 * matching immutable record. A 128-bit action_id colliding across two different
 * repos is structurally near-impossible; fails closed (never silently guesses
 * one) rather than assumes.
 *
 * Bounded + streamed (M6+M7 SIXTEENTH Phase 2A): reads the base dir via
 * `fs.opendirSync`/`readSync` one entry at a time (never a single
 * `readdirSync` materializing the whole, potentially huge, listing at once),
 * counting EVERY entry seen (not merely ones that look like a repo-id
 * directory) against `MAX_ACTION_REPO_SCAN_ENTRIES`. Exceeding the cap fails
 * closed with `action-repo-scan-cap-exceeded` even if a match was already
 * found before the cap was hit -- an aborted scan can never certify "exactly
 * one" or "zero" matches, so it must never report either. The directory
 * handle is always closed, including on an early return.
 * @param {string} actionId
 * @returns {{ok:true,absent:true}|{ok:true,absent:false,action:object}|{ok:false,reason:string}}
 */
function findActionAcrossRepos(actionId) {
  const base = registryBaseDir();
  let dir;
  try {
    dir = fs.opendirSync(base);
  } catch (err) {
    return { ok: true, absent: true };
  }
  const matches = [];
  let entriesSeen = 0;
  let capExceeded = false;
  let earlyResult = null;
  try {
    let entry;
    while ((entry = dir.readSync()) !== null) {
      entriesSeen += 1;
      if (entriesSeen > MAX_ACTION_REPO_SCAN_ENTRIES) {
        capExceeded = true;
        break;
      }
      if (!entry.isDirectory() || !ACTION_ID_DIR_RE.test(entry.name)) continue;
      const candidatePath = path.join(base, entry.name, 'actions', actionId + '.json');
      const read = readRegistryRecord(candidatePath);
      if (!read.ok) { earlyResult = { ok: false, reason: read.reason }; break; }
      if (!read.absent) matches.push(read.obj);
    }
  } finally {
    try { dir.closeSync(); } catch (err) { /* best effort -- never fatal for a read path */ }
  }
  if (capExceeded) return { ok: false, reason: 'action-repo-scan-cap-exceeded' };
  if (earlyResult) return earlyResult;
  if (matches.length === 0) return { ok: true, absent: true };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous-action-id' };
  const shapeCheck = validateActionRecordShapeForLookup(matches[0]);
  if (!shapeCheck.ok) return shapeCheck;
  return { ok: true, absent: false, action: matches[0] };
}

// ── Per-kind action payload builders (PLAN.md ~L156-163, exact closed shapes) ──

  return Object.freeze({
    ACTION_KIND_ENUM, ACTION_RUNTIME_ENUM, ACTION_KIND_RUNTIME, HOST_OPERATION_FOR_ACTION, resolveHostOperationForAction, ACTION_TTL_CEILING_SECONDS, CLAUDE_NATIVE_STARTUP_TIMEOUT_DEFAULT_SECONDS,
    classifyStartupScope, actionTtlPolicyLimitSeconds, computeActionTtlSeconds, effectiveActionTtlSeconds, actionPathFor, generateActionId, mintRoleLifecycleAction, actionForEnvelope,
    ACTION_ID_DIR_RE, MAX_ACTION_REPO_SCAN_ENTRIES, validateActionRecordShapeForLookup, findActionDirect, findActionAcrossRepos,
  });
}

module.exports = { createLifecycleActionRecord };
