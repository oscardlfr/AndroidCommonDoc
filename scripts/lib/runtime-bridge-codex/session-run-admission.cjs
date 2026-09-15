'use strict';

function createSessionRunAdmission({
  fs,
  path,
  bridgeFilename,
  ACTION_ENVELOPE_KEYS,
  SUPERVISOR_START_PAYLOAD_KEYS,
  arraysEqual,
  isTestCapability,
  realpathOrSelf,
  registryRepoDir,
  readRegistryRecord,
  findActionDirect,
  hasExactKeys,
  computeRepoId,
  computeWorktreeId,
  discoverPlan,
  resolvePolicyPair,
  sha256String,
  canonicalJSONStringify,
  resolvedNodePath,
  renderPosixDirect,
  peekLiveSupervisorExecutionClaim,
  roleProfileDigestFor,
  readRoleBindingState,
  hasOnlyAllowedKeys,
  ROLE_BINDING_ALLOWED_KEYS,
}) {
  // ── argv parsing (session-run: --action --coordination-root --role[repeat] --session-expiry, PLAN.md ~L787) ──

  const SESSION_RUN_SPEC = Object.freeze({
    '--action': { required: true, repeatable: false },
    '--coordination-root': { required: true, repeatable: false },
    '--role': { required: true, repeatable: true },
    '--session-expiry': { required: true, repeatable: false },
    '--test-backend': { required: false, repeatable: false },
  });

  /**
   * @param {string[]} rawArgv
   * @returns {{ok:true,value:{action:string,coordinationRoot:string,roles:string[],sessionExpiry:string,testBackend:string|null}}|{ok:false,reason:string}}
   */
  function parseSessionRunArgv(rawArgv) {
    const out = { action: null, coordinationRoot: null, roles: [], sessionExpiry: null, testBackend: null };
    const seen = {};
    let i = 0;
    while (i < rawArgv.length) {
      const flag = rawArgv[i];
      const spec = SESSION_RUN_SPEC[flag];
      if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
      if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
      const value = rawArgv[i + 1];
      if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
      seen[flag] = true;
      if (flag === '--action') out.action = value;
      else if (flag === '--coordination-root') out.coordinationRoot = value;
      else if (flag === '--role') out.roles.push(value);
      else if (flag === '--session-expiry') out.sessionExpiry = value;
      else if (flag === '--test-backend') out.testBackend = value;
      i += 2;
    }
    const missing = Object.keys(SESSION_RUN_SPEC).filter((flag) => SESSION_RUN_SPEC[flag].required && !seen[flag]);
    if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
    return { ok: true, value: out };
  }

  // ── action handoff revalidation (defense in depth vs the spawn-gate) ──

  function isHexActionId(value) {
    return typeof value === 'string' && /^[0-9a-f]{32,}$/.test(value);
  }

  // R4 round 3 (block 2d): a SEPARATE, exact-64 contract for genuine SHA-256
  // digest fields (coordination_root_id = `sha256(realpath(coordination_root))`,
  // PLAN.md ~L289) -- mirrors the sibling module's own `isHexDigest64`
  // (local copy, not imported, matching this file's existing convention of
  // keeping its own `isHexActionId` copy rather than importing the sibling's).
  // `isHexActionId` above stays UNCHANGED ("32 or more") -- supervisor_instance_id/
  // rendezvous_instance_id are crypto-random 32-hex ids, a genuinely different
  // contract from a 64-hex digest.
  function isHexDigest64(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  }

  /**
   * The lifecycle action deliberately never carries private test seams.  Once
   * cmdSessionRun has accepted the double-gated deterministic backend, compare
   * the action against the production argv with that one private pair removed.
   * Outside the private capability this is an identity function.
   * @param {string[]} rawArgv
   * @param {{testBackend:string|null}} parsed
   * @returns {string[]}
   */
  function sessionRunAuthorityArgv(rawArgv, parsed) {
    if (!isTestCapability() || parsed.testBackend !== 'deterministic-app-server-v1') return rawArgv;
    const index = rawArgv.indexOf('--test-backend');
    if (index < 0) return rawArgv;
    return rawArgv.slice(0, index).concat(rawArgv.slice(index + 2));
  }

  /**
   * Scans this repo's `sessions/` registry subtree for a record whose
   * `generation_id` equals `generationId` and is not yet expired. `session-run`
   * has no hook-observed identity tuple to independently RE-DERIVE a session
   * generation the way `ensure` does (PLAN.md ~L150: identity comes only from
   * "hook-observed runtime identity", which a detached background process
   * never receives) -- this is the achievable substitute: prove the claimed
   * generation is still a REAL, LIVE record this repo minted, not a stale or
   * fabricated value merely embedded in the action.
   * @param {{repoId:string}} repoDescriptor
   * @param {string} generationId
   * @returns {boolean}
   */
  function sessionGenerationIsLive(repoDescriptor, generationId) {
    const sessionsDir = path.join(registryRepoDir(repoDescriptor), 'sessions');
    let entries;
    try {
      entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    } catch (err) {
      return false;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      let read;
      try {
        read = readRegistryRecord(path.join(sessionsDir, entry.name));
      } catch (err) {
        continue;
      }
      if (!read.ok || read.absent) continue;
      const rec = read.obj;
      if (rec && rec.schema === 'runtime/session-generation/v1' && rec.generation_id === generationId) {
        return Date.now() < Date.parse(rec.expires_at);
      }
    }
    return false;
  }

  /**
   * Independently re-derives `projectRoot` from `--coordination-root` (this
   * ABI has no `--project-root`) and revalidates the found action against that
   * fresh derivation end to end: kind/runtime/role/expiry, repo/worktree/plan
   * identity recomputed from scratch, the COMPLETE closed action shape
   * (`payload.bridge` literal, the resolved-node/absolute-bridge-path/
   * subcommand components of `bridge_argv`, `bridge_command`'s own
   * round-trip), the raw received argv tail deep-equal to the action's own
   * minted `bridge_argv`, and the claimed session generation still live on
   * disk. Read-only throughout -- no registry write happens here.
   * @param {{action:string,coordinationRoot:string,roles:string[],sessionExpiry:string}} parsed
   * @param {string[]} rawArgv - the exact tokens this process received after `session-run`.
   * @returns {{ok:true,projectRoot:string,action:object,coordinationRootReal:string}|{ok:false,reason:string}}
   */
  function revalidateSupervisorStartAction(parsed, rawArgv) {
    if (!isHexActionId(parsed.action)) return { ok: false, reason: 'malformed-action-id' };

    const coordRootReal = realpathOrSelf(parsed.coordinationRoot);
    const planningDir = path.dirname(coordRootReal);
    const projectRoot = path.dirname(planningDir);
    if (path.basename(coordRootReal) !== 'coordination' || path.basename(planningDir) !== '.planning') {
      return { ok: false, reason: 'coordination-root-not-canonical-shape' };
    }
    const expectedCoordRoot = path.join(projectRoot, '.planning', 'coordination');
    if (realpathOrSelf(expectedCoordRoot) !== coordRootReal) {
      return { ok: false, reason: 'coordination-root-self-consistency-failed' };
    }

    // M6+M7 SIXTEENTH Phase 2A: projectRoot is already independently re-derived
    // above (from --coordination-root) -- a direct actionPathFor lookup is
    // exact and cannot be ambiguous, so this never needs to scan every
    // repo-scoped registry subtree the way ready/action-failed/wait-ready
    // (which have no --project-root in their frozen argv) legitimately still
    // do via findActionAcrossRepos.
    const found = findActionDirect(projectRoot, parsed.action);
    if (!found.ok) return { ok: false, reason: 'action-lookup-failed' };
    if (found.absent) return { ok: false, reason: 'action-not-found' };
    const action = found.action;

    // Point E: close the action envelope BEFORE trusting any of its fields,
    // and explicitly verify the record's OWN action_id matches what was
    // looked up (never merely trust the lookup-by-path mechanism).
    if (!hasExactKeys(action, ACTION_ENVELOPE_KEYS)) return { ok: false, reason: 'action-envelope-key-set-invalid' };
    if (action.schema !== 'coordination/role-lifecycle-action/v1') return { ok: false, reason: 'action-schema-invalid' };
    if (action.action_id !== parsed.action) return { ok: false, reason: 'action-id-content-path-mismatch' };
    if (action.kind !== 'supervisor-start') return { ok: false, reason: 'wrong-action-kind' };
    if (action.runtime !== 'host-process') return { ok: false, reason: 'wrong-action-runtime' };
    if (action.role !== null) return { ok: false, reason: 'action-role-not-null' };
    const actionExpiryMs = Date.parse(action.expires_at);
    if (!Number.isFinite(actionExpiryMs)) return { ok: false, reason: 'action-expiry-invalid' };
    if (!(Date.now() < actionExpiryMs)) return { ok: false, reason: 'action-expired' };
    // The startup action and retained service have distinct host-derived
    // deadlines.  The service boundary must be canonical and strictly later;
    // its exact correlation to the binding+generation authorities is checked
    // through the live execution claim after the full scope is closed below.
    const parsedSessionExpiryMs = Date.parse(parsed.sessionExpiry);
    if (!Number.isFinite(parsedSessionExpiryMs) || !(parsedSessionExpiryMs > actionExpiryMs)) {
      return { ok: false, reason: 'session-expiry-not-after-action-expiry' };
    }

    let repoIdFresh, worktreeIdFresh;
    try {
      repoIdFresh = computeRepoId(projectRoot);
      worktreeIdFresh = computeWorktreeId(projectRoot);
    } catch (err) {
      return { ok: false, reason: 'identity-derivation-failed' };
    }
    const planFresh = discoverPlan(projectRoot);
    if (!planFresh.ok) return { ok: false, reason: 'plan-not-discoverable' };
    const pair = resolvePolicyPair(projectRoot);
    if (!pair.ok) return { ok: false, reason: 'policy-invalid' };
    const currentPolicyDigest = sha256String(canonicalJSONStringify(pair.routing));

    if (action.repo_id !== repoIdFresh) return { ok: false, reason: 'repo-id-mismatch' };
    if (action.worktree_id !== worktreeIdFresh) return { ok: false, reason: 'worktree-id-mismatch' };
    if (action.plan_digest !== planFresh.planDigest) return { ok: false, reason: 'plan-digest-mismatch' };
    // Point E: the action's own policy_digest must match the CURRENT
    // routing.json, never merely an old snapshot from before a routing change.
    if (action.policy_digest !== currentPolicyDigest) return { ok: false, reason: 'policy-digest-drift' };

    const payload = action.payload;
    if (!hasExactKeys(payload, SUPERVISOR_START_PAYLOAD_KEYS)) return { ok: false, reason: 'supervisor-payload-key-set-invalid' };
    if (payload.bridge !== 'codex-app-server') return { ok: false, reason: 'payload-bridge-literal-mismatch' };
    const expectedArgv = payload.bridge_argv;
    if (!Array.isArray(expectedArgv) || expectedArgv.length < 3) return { ok: false, reason: 'action-payload-malformed' };
    // Point 4: bridge_argv[0] is the resolved, realpath-verified node binary
    // (never a bare "node" PATH-dependent literal) -- this process was ITSELF
    // execve'd with that exact executable, so its own resolvedNodePath() must
    // trivially agree; a mismatch means the action was tampered to point at a
    // different binary than the one actually running.
    if (expectedArgv[0] !== resolvedNodePath()) return { ok: false, reason: 'bridge-argv-node-path-mismatch' };
    // realpathOrSelf on BOTH sides -- Node's own module resolution realpaths
    // bridgeFilename (dereferencing e.g. macOS's /tmp -> /private/tmp symlink),
    // while bridge_argv[1] is a plain joined path never realpath'd at mint
    // time; comparing raw path.resolve() on both would false-reject on any
    // host where the project root sits under a symlinked prefix.
    if (realpathOrSelf(expectedArgv[1]) !== realpathOrSelf(bridgeFilename)) return { ok: false, reason: 'bridge-argv-path-mismatch' };
    if (expectedArgv[2] !== 'session-run') return { ok: false, reason: 'bridge-argv-subcommand-mismatch' };
    if (typeof payload.bridge_command !== 'string' || renderPosixDirect(expectedArgv) !== payload.bridge_command) {
      return { ok: false, reason: 'bridge-command-round-trip-failed' };
    }
    const expectedTail = expectedArgv.slice(3);
    const authorityArgv = sessionRunAuthorityArgv(rawArgv, parsed);
    if (!arraysEqual(authorityArgv, expectedTail)) return { ok: false, reason: 'argv-does-not-match-action-payload' };

    if (!sessionGenerationIsLive({ repoId: action.repo_id }, action.session_generation_id)) {
      return { ok: false, reason: 'session-generation-not-live' };
    }
    if (!peekLiveSupervisorExecutionClaim({ repoId: action.repo_id }, action)) {
      return { ok: false, reason: 'execution-claim-or-retained-service-authority-invalid' };
    }

    return { ok: true, projectRoot, action, coordinationRootReal: coordRootReal };
  }

  /**
   * Point C.8's binding-side check: every requested role's binding must
   * currently be STARTING/REHYDRATING with `pending_action_id` equal to
   * THIS action -- proves a live role-binding actually expects this exact
   * action to be the one authorizing its start, closing the gap where an
   * otherwise-valid-but-orphaned action (no binding references it anymore)
   * could still be presented. Read-only.
   * @returns {{ok:true,presencePath:string,record:object}|{ok:false,reason:string}}
   */
  function validateBindingsPendThisAction(repoDescriptor, action, roles) {
    for (const role of roles) {
      const profileDigest = roleProfileDigestFor(role);
      const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
      if (!stateResult.ok) return { ok: false, reason: 'binding-lookup-failed:' + role };
      if (!stateResult.record || !hasOnlyAllowedKeys(stateResult.record, ROLE_BINDING_ALLOWED_KEYS)) {
        return { ok: false, reason: 'binding-shape-invalid:' + role };
      }
      if (
        (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
        || stateResult.record.pending_action_id !== action.action_id
      ) {
        return { ok: false, reason: 'binding-not-pending-this-action:' + role };
      }
    }
    return { ok: true };
  }

  return Object.freeze({ parseSessionRunArgv, isHexActionId, isHexDigest64, sessionRunAuthorityArgv, sessionGenerationIsLive, revalidateSupervisorStartAction, validateBindingsPendThisAction });
}

module.exports = Object.freeze({ createSessionRunAdmission });
