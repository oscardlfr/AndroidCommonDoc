'use strict';

function createRoleCapabilityRouting(deps) {
  const { fs, path, process, ROUTING_DRIVER_ENUM, computeCoordinationRootId, isTestCapability, readRegistryRecord, readRoleBindingState, readSupervisorLifecycleOwnerState, registryRepoDir, resolvePolicyPair, roleBindingPathFor, loadBridge, loadClaudeHost, loadProjectContext } = deps;

function scanRegistryForReadyDriver(projectRoot, driverName) {
  const bindingsDir = path.join(registryRepoDir(projectRoot), 'role-bindings');
  let entries;
  try {
    entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch (err) {
    return false; // no registry yet -- honestly nothing proven available.
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidatePath = path.join(bindingsDir, entry.name);
    const rawRead = readRegistryRecord(candidatePath);
    if (!rawRead.ok || rawRead.absent || !rawRead.obj) continue;
    const rec = rawRead.obj;
    if (
      typeof rec.worktree_id !== 'string' || typeof rec.plan_digest !== 'string'
      || typeof rec.profile_digest !== 'string' || typeof rec.session_generation_id !== 'string'
      || typeof rec.role !== 'string'
    ) continue;
    if (roleBindingPathFor(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role) !== candidatePath) continue;
    const stateResult = readRoleBindingState(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role);
    if (stateResult.ok && stateResult.state === 'READY' && stateResult.record.driver === driverName) return true;
  }
  return false;
}

function hasCurrentClaudeHostCompositionCapability(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  try {
    const admission = loadClaudeHost().findCurrentProductionAdmission(projectRoot);
    return Boolean(
      admission
      && admission.supported_operations.includes('Agent')
      && admission.supported_operations.includes('Bash')
      && admission.supported_operations.includes('SendMessage')
      && admission.supported_operations.includes('TaskOutput')
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} [projectRoot] - required for real production evidence;
 * a caller with no project scope available (a bare unit-test call, or a
 * pre-M6 call site nobody has updated yet) degrades to honestly empty,
 * never guesses a scope.
 * @returns {{ok:true,availableDrivers:string[]}|{ok:false}}
 */
function getCapabilityManifest(projectRoot) {
  if (!isTestCapability()) {
    // Production (M6): real registry-derived evidence -- a genuinely
    // RETAINED+READY codex-app-server supervisor already proven by THIS
    // repo's OWN registry (via the SAME public transition primitive
    // production itself uses) counts as available. Binary presence, an
    // environment variable, prose, or a self-asserted boolean never proves
    // a driver is available. External Claude Agent Teams / retained-Codex
    // probing beyond this repo's own registry remains a documented WP4
    // concern, out of scope here.
    //
    // M6 CORRECTION PASS (P0-1): a READY role-binding ALONE is a later
    // lifecycle RESULT, never the capability SOURCE -- a stale/hand-written
    // READY record must never be indistinguishable from a genuine one. A
    // READY binding must ALSO be corroborated by a genuinely ACTIVE
    // SupervisorLifecycleOwner record for this SAME project's coordination
    // root (produced only via mintSupervisorBatchUnderTransaction, the SAME
    // primitive production ensure() itself uses) -- once that owner is
    // terminalized (terminalizeSupervisorLifecycleOwnerIfCurrent, the same
    // primitive action-failed itself uses), capability is revoked
    // immediately even if a stale role-binding record still claims READY.
    let available = [];
    if (hasCurrentClaudeHostCompositionCapability(projectRoot)) available.push('claude-sendmessage');
    if (typeof projectRoot === 'string' && projectRoot.length > 0 && scanRegistryForReadyDriver(projectRoot, 'codex-app-server')) {
      const coordinationRootId = computeCoordinationRootId(projectRoot);
      const ownerState = readSupervisorLifecycleOwnerState(projectRoot, coordinationRootId);
      if (ownerState.ok && ownerState.state === 'ACTIVE') {
        available.push('codex-app-server');
      }
    }
    return { ok: true, availableDrivers: [...new Set(available)] };
  }
  const raw = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  if (typeof raw !== 'string' || raw.length === 0) return { ok: true, availableDrivers: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: true, availableDrivers: [] };
  }
  if (!Array.isArray(parsed) || !parsed.every((d) => typeof d === 'string' && ROUTING_DRIVER_ENUM.includes(d))) {
    return { ok: true, availableDrivers: [] };
  }
  // This branch is reachable only through the existing double-gated test
  // capability seam.  Its explicit driver list is the fixture's capability
  // source; production never consults it.  Requiring a historical v1
  // generation-wide CLAUDE-ID-01 record here kept obsolete authority alive
  // and made unrelated renderer/gate fixtures manufacture fake native peers.
  return { ok: true, availableDrivers: parsed };
}

/**
 * M6 CORRECTION PASS (P0-1): "can a FIRST codex-app-server supervisor be
 * started" -- answerable WITHOUT any already-RETAINED/READY supervisor,
 * unlike getCapabilityManifest (which only ever reports an ALREADY-live
 * one). Deliberately never consults role-binding/READY state at all --
 * capability-to-START is derived from pin/profile accreditation + host
 * ability to start the supervisor, never from "does anything already say
 * READY" (that circularity is exactly the P0-1 bug this correction pass
 * fixes elsewhere). `runtime-bridge-codex.cjs` is required LAZILY (inside
 * this function, never at this file's own top level) so the two sibling
 * modules' existing require() direction (bridge -> role-lifecycle) never
 * becomes a load-time cycle; by the time this function is actually called,
 * both modules have already finished their own top-level initialization.
 * @param {string} projectRoot
 * @param {string} driverName
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function resolveSupervisorStartability(projectRoot, driverName) {
  if (driverName !== 'codex-app-server') {
    return { ok: false, reason: 'unsupported-driver' };
  }
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { ok: false, reason: 'project-root-required' };
  }
  // Pin/profile accreditation: the policy/routing pair this project would
  // actually use to route to codex-app-server must itself resolve.
  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    return { ok: false, reason: 'policy-invalid' };
  }
  // W07b private deterministic backend: lifecycle still mints the genuine
  // supervisor-start action, but no installed Codex binary or user credential
  // is needed because session-run will consume that action using the sealed
  // in-process test backend. Both the general test capability and the exact
  // closed literal are required; production cannot select this path.
  if (
    isTestCapability()
    && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BACKEND === 'deterministic-app-server-v1'
  ) {
    return { ok: true };
  }
  // Enabled consumers are executable only from the exact installed toolkit
  // source and exact hook/role matrix.  Legacy hermetic fixtures without any
  // manifest remain covered by their dedicated host-capability tests.
  if (fs.existsSync(path.join(projectRoot, 'l0-manifest.json'))) {
    let installation;
    try {
      installation = loadProjectContext()
        .verifyRuntimeConsumerInstallation(projectRoot, { verifyContent: false });
    } catch {
      return { ok: false, reason: 'runtime-consumer-check-failed' };
    }
    if (!installation.ok) return { ok: false, reason: installation.reason || 'runtime-consumer-invalid' };
  }
  let bridge;
  try {
    bridge = loadBridge();
  } catch (err) {
    return { ok: false, reason: 'host-check-unavailable' };
  }
  // Host ability to start: the production CODEX_CLI_PATH pin (P0-3) must
  // resolve to a real, absolute, existing executable -- never merely
  // "codex is on PATH somewhere".
  let spawnCommand;
  try {
    spawnCommand = bridge.resolveAppServerSpawnCommand();
  } catch (err) {
    return { ok: false, reason: 'host-check-failed' };
  }
  if (!spawnCommand || typeof spawnCommand.command !== 'string' || spawnCommand.command.length === 0) {
    return { ok: false, reason: 'codex-cli-path-unresolved' };
  }
  // IsolationProvider/credential-source prerequisites: production's own
  // credential source provider must report a genuinely configured, usable
  // source -- never fabricated/assumed available.
  let credentialSource;
  try {
    credentialSource = bridge.createCredentialSourceProvider().read();
  } catch (err) {
    return { ok: false, reason: 'credential-source-check-failed' };
  }
  if (!credentialSource || credentialSource.ok !== true) {
    return { ok: false, reason: 'credential-source-not-configured' };
  }
  return { ok: true };
}

/**
 * Selects the FIRST driver from `routing.routes[role]` (already policy-ordered,
 * most-preferred first) that the capability manifest reports available. `noop`
 * is always structurally available (it claims no live capability at all) but is
 * only selected when it is genuinely the routing table's own entry for this role
 * AND no higher-preference driver proved available -- never a silent override of
 * routing order.
 * @returns {string|null} the selected driver, or null if none of the role's
 * routed drivers is available (including noop, if routing omits it for this role).
 */
/**
 * @param {object} routing
 * @param {string} role
 * @param {{availableDrivers:string[]}} capabilityManifest
 * @param {string[]} [excludedDrivers] - WP3 item C correction pass R2 (point
 *   5): driver NAMES to skip regardless of capability/noop status. Unlike
 *   filtering `capabilityManifest.availableDrivers` (which a caller might be
 *   tempted to do instead), this does NOT make `noop` spuriously reachable
 *   -- `noop` is unconditionally selectable once the routing list reaches
 *   it, so hiding a driver from the manifest alone can skip past every OTHER
 *   real driver still later in the list and land on noop by accident.
 *   Optional; omitted/empty is byte-identical to prior behavior for every
 *   existing caller.
 */
function selectDriverForRole(routing, role, capabilityManifest, excludedDrivers) {
  const allowed = routing.routes[role];
  if (!Array.isArray(allowed)) return null;
  for (const driver of allowed) {
    if (excludedDrivers && excludedDrivers.includes(driver)) continue;
    if (driver === 'noop' || capabilityManifest.availableDrivers.includes(driver)) return driver;
  }
  return null;
}

// Point 3.2 (R4): claude-agent/codex-mcp/runtime-spawn are capability-proven,
// routing-permitted drivers with NO ensure()-mintable persistent
// role-lifecycle-action at all (PLAN.md's closed action kind/runtime union,
// ~L154-163, has no member for any of the three).
const LIFECYCLE_INELIGIBLE_DRIVERS = Object.freeze(['claude-agent', 'codex-mcp', 'runtime-spawn']);

/**
 * A persistent ensure() variant of `selectDriverForRole` that unconditionally
 * treats `LIFECYCLE_INELIGIBLE_DRIVERS` as excluded, IN ADDITION to any
 * caller-supplied `excludedDrivers` -- so persistent ensure() genuinely
 * iterates PAST a capability-proven-but-lifecycle-ineligible driver to the
 * next routing-permitted one (including `noop`) rather than stopping short
 * the moment routing/capability lands on one of the three. Per-request
 * dispatch (a DIFFERENT subsystem, runtime-consultation.cjs) is unaffected --
 * it calls `selectDriverForRole` directly and may still select any of them.
 * @returns {string|null}
 */
function selectLifecycleEligibleDriverForRole(routing, role, capabilityManifest, excludedDrivers) {
  return selectDriverForRole(routing, role, capabilityManifest, LIFECYCLE_INELIGIBLE_DRIVERS.concat(excludedDrivers || []));
}

// ─────────────────────────────────────────────────────────────────────────────
// M6 Block C + M7/WP4 dependency closure: DiskConsumerRegistration/v1 -- the
// real production mechanism `hasRegisteredValidatedDiskConsumer` (below)
// consults instead of its prior unconditional-false stub. Mutable-replace
// record (a consumer legitimately re-registers/refreshes its own TTL),
// keyed by the exact (worktree, plan, session-generation, role) tuple --
// mirrors `roleBindingPathFor`'s own tuple-digest path convention, never a
// caller-suppliable id. Host-private evidence only: liveness is
// re-verified against the registration's OWN embedded consumer_pid via a
// real `process.kill(pid, 0)` probe, never inferred from mere file/PID/text
// presence or process ancestry.
// ─────────────────────────────────────────────────────────────────────────────

  return Object.freeze({ scanRegistryForReadyDriver, hasCurrentClaudeHostCompositionCapability, getCapabilityManifest, resolveSupervisorStartability, selectDriverForRole, LIFECYCLE_INELIGIBLE_DRIVERS, selectLifecycleEligibleDriverForRole });
}

module.exports = { createRoleCapabilityRouting };
