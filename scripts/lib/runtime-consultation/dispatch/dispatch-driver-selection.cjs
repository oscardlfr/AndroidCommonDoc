'use strict';

// Per-request dispatch driver selection (priority-order candidate loop) and the root-source-narrowed driver allowlist.
// facadeDirname is injected because claudeAgentCapabilityProjectRoot resolves the checkout the FACADE ships in, not this module's own directory.

function createDispatchDriverSelection({
  CliError,
  facadeDirname,
  getRuntimeBridgeCodex,
  getRuntimeRoleLifecycle,
  gitRevParse,
  path,
  sha256String,
}) {
// A root-source requester runs inside the toolkit-specialist subagent, which
// can execute SendMessage but cannot invoke Agent. Keep this private execution
// profile narrower than the public routing registry: prefer the already-live
// canonical Claude peer, otherwise permit only the trusted retained Codex
// worker whose activation needs no caller host action. Never degrade to noop.
const ROOT_SOURCE_DISPATCH_DRIVERS = Object.freeze(['claude-sendmessage', 'codex-app-server']);

/**
 * Derives the project/repo root `checkClaudeAgentCapabilityAvailable` expects
 * (it reads `.claude/settings.json`'s own hook registrations). `.claude/`
 * config is a property of the CHECKOUT this script itself is installed into
 * -- never of an arbitrary `--coordination-root` target, which for a
 * sibling-worktree/cross-project consultation may point at a coordination
 * tree with no `.claude/settings.json` (or a different one) at all. Resolved
 * `__dirname`-relative (this file lives at `scripts/lib/runtime-consultation.cjs`,
 * two levels below the repo root) -- the SAME "find my own repo" convention
 * `context-provider-gate.js`'s own `CANONICAL_LIFECYCLE_CLI_PATH`/
 * `CANONICAL_CONSULTATION_CLI_PATH` already use, never derived from
 * `coordRoot`. Fails soft by construction, never by exception: every caller
 * of this helper is already wrapped in its own try/catch, so a genuinely
 * relocated/vendored copy of this file only ever costs
 * `checkClaudeAgentCapabilityAvailable` a real `{available:false}` -- never a
 * false grant.
 * @returns {string}
 */
function claudeAgentCapabilityProjectRoot() {
  return path.resolve(facadeDirname, '..', '..');
}

function selectDispatchDriver({ allowedDrivers, rootSourceDispatch, requiredDriver, excludedDriver, coordRoot, reqObj }) {
  let selectedDriver = 'noop';
  let selectedClaudePeerBinding = null;
  // P4 Windows native-Claude persistence correction: the bootstrap fallback
  // when no full ClaudePeerBinding exists yet -- see the claude-sendmessage
  // candidate branch below.
  let selectedClaudeResumeHandle = null;
  let rll = null;
  for (const candidate of allowedDrivers) {
    if (rootSourceDispatch && !ROOT_SOURCE_DISPATCH_DRIVERS.includes(candidate)) continue;
    if (requiredDriver !== undefined && candidate !== requiredDriver) continue;
    if (excludedDriver !== null && candidate === excludedDriver) continue;
    if (candidate === 'noop') {
      selectedDriver = 'noop';
      break;
    }
    if (candidate === 'claude-sendmessage') {
      // PLAN §15c: this accelerator is selectable only for exactly one
      // current, live peer in the same Claude session/worktree/PLAN/role.
      // The main-orchestrator binding is the host-observed source of the raw
      // session key; the coordination activation stores only the peer's
      // opaque binding id and the transient action exposes only its exact
      // registered teammate name.
      try {
        rll = rll || getRuntimeRoleLifecycle();
      } catch (err) {
        rll = null;
        continue;
      }
      let projectRoot;
      let mainBinding;
      let peer;
      try {
        projectRoot = gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']);
        // An ordinary caller still needs the generic, short-lived host
        // composition advertisement. A root-source transaction has already
        // authenticated the requester through its grant/binding and can take
        // longer than that two-minute entrypoint composition to reach
        // dispatch. For that path, the exact live MainOrchestratorBinding plus
        // the exact live peer/resume-handle checks below are the current
        // target capability proof; requiring the expired generic advert as a
        // second proof makes valid multi-turn work structurally time out.
        if (!rootSourceDispatch) {
          const manifest = rll.getCapabilityManifest(projectRoot);
          if (!manifest || manifest.ok !== true
              || !Array.isArray(manifest.availableDrivers)
              || !manifest.availableDrivers.includes('claude-sendmessage')) continue;
        }
        mainBinding = rll.findLiveMainOrchestratorBindingForScope(
          projectRoot, reqObj.requester_worktree_id, reqObj.plan_digest,
        );
        if (!mainBinding || mainBinding.ok !== true) continue;
        peer = rll.findUniqueClaudePeerBindingForTarget(projectRoot, {
          sessionDigest: sha256String(mainBinding.binding.runtime_session_key),
          worktreeId: reqObj.requester_worktree_id,
          planDigest: reqObj.plan_digest,
          targetRole: reqObj.target_role,
        });
      } catch (err) {
        continue;
      }
      if (peer && peer.ok === true && peer.record) {
        selectedClaudePeerBinding = peer.record;
        selectedDriver = 'claude-sendmessage';
        break;
      }
      // P4 Windows native-Claude persistence correction: no full
      // ClaudePeerBinding exists yet -- first accept a unique live parked
      // handle for the exact WAITING target. If resume-work already consumed
      // that handle and moved the same binding to BUSY, accept only the
      // immutable consumed marker correlated to that exact BUSY transition.
      // Both paths revalidate session/scope/role/actor/fence; neither invents
      // a peer binding. ClaudePeerBinding remains preferred above.
      let resumeHandle;
      try {
        resumeHandle = rll.findUniqueClaudeResumeHandleForTarget(projectRoot, {
          sessionDigest: sha256String(mainBinding.binding.runtime_session_key),
          worktreeId: reqObj.requester_worktree_id,
          planDigest: reqObj.plan_digest,
          targetRole: reqObj.target_role,
        });
      } catch (err) {
        resumeHandle = null;
      }
      if (resumeHandle && resumeHandle.ok === true && resumeHandle.record) {
        selectedClaudeResumeHandle = resumeHandle.record;
        selectedDriver = 'claude-sendmessage';
        break;
      }
      let consumedBusyHandle;
      try {
        const busyRole = rll.readRoleBindingState(
          projectRoot, reqObj.requester_worktree_id, reqObj.plan_digest,
          rll.roleProfileDigestFor(reqObj.target_role), mainBinding.generation.generationId,
          reqObj.target_role,
        );
        if (busyRole && busyRole.ok === true && busyRole.state === 'BUSY' && busyRole.record) {
          consumedBusyHandle = rll.findUniqueConsumedClaudeResumeHandleForBusyTarget(projectRoot, {
            generationId: mainBinding.generation.generationId,
            sessionDigest: sha256String(mainBinding.binding.runtime_session_key),
            worktreeId: reqObj.requester_worktree_id,
            planDigest: reqObj.plan_digest,
            targetRole: reqObj.target_role,
          }, busyRole.record);
        }
      } catch (err) {
        consumedBusyHandle = null;
      }
      if (consumedBusyHandle && consumedBusyHandle.ok === true && consumedBusyHandle.record) {
        selectedClaudeResumeHandle = consumedBusyHandle.record;
        selectedDriver = 'claude-sendmessage';
        break;
      }
      continue;
    }
    if (candidate === 'claude-agent') {
      // Lazily require()s the sibling module -- runtime-role-lifecycle.cjs
      // requires THIS file at its own top level (WP3: reuse the sibling
      // module's already-proven fd-bound durability primitives), so a
      // top-level require() here would be a load-time cycle. Mirrors
      // resolveSupervisorStartability's own lazy require of
      // runtime-bridge-codex.cjs for the identical reason.
      try {
        rll = getRuntimeRoleLifecycle();
      } catch (err) {
        rll = null;
        continue; // mechanism unavailable -- never select without proof.
      }
      let capabilityResult;
      try {
        capabilityResult = rll.checkClaudeAgentCapabilityAvailable(claudeAgentCapabilityProjectRoot());
      } catch (err) {
        continue;
      }
      if (!capabilityResult || capabilityResult.available !== true) continue;

      // M6+M7 FINAL AUTHORITY CORRECTION (Group 4): mechanism-only readiness
      // (hooks present + registered) is NECESSARY but not SUFFICIENT --
      // PLAN.md §15d additionally requires the requester not be the running
      // planner-bootstrap subagent.
      if (reqObj.source_role === 'planner') continue;

      // PLAN.md §15d also requires "the active top-level host exposes one
      // foreground Agent call" -- i.e. proof that the CURRENT top-level
      // orchestrator session (a different session from this detached
      // cmdDispatch CLI subprocess, and from the requester's own identity --
      // RequesterBinding and MainOrchestratorBinding are explicitly separate
      // primitives, PLAN.md ~L594) is genuinely live right now. Two wrong
      // identities were explicitly ruled out here: findLiveClaudeAgentActivations
      // can only ever match THIS exact request's own activation/v1 record,
      // which this same function does not publish until AFTER this
      // driver-selection loop runs (below) -- a check keyed on this
      // request's own request_id is structurally unsatisfiable for every
      // request, never a genuine proof check; substituting the requester's
      // own CLAUDE-ID-01 attestation would conflate the requester identity
      // with the top-level-host identity. M6-M7-PRODUCTION-REACHABILITY-
      // 20260819 closes this gap with the ONE existing primitive PLAN.md
      // itself defines as modeling "the active top-level orchestrator"
      // (~L240, ~L594): a genuine, current, unexpired
      // MainOrchestratorBinding/v1 scoped to this EXACT request's own
      // requester_worktree_id+plan_digest is real, host-supplied proof that
      // the top-level orchestrator session is live right now -- read-only,
      // no new schema/artifact/driver. Unlike checkClaudeAgentCapabilityAvailable
      // above (a MECHANISM check that is deliberately fixed to the checkout
      // THIS script file itself lives in, never --coordination-root --
      // claudeAgentCapabilityProjectRoot()'s own doc comment), the binding
      // registry is repo-scoped: MainOrchestratorBinding/v1 is minted under
      // the SAME registryRepoDir(<repo the top-level orchestrator's own
      // checkout runs in>) that every other WP3 registry primitive uses.
      // For a same-repo dispatch that repo IS the one `--coordination-root`
      // resolves into, so the project root is derived the identical way the
      // codex-app-server branch below already derives its own (never
      // claudeAgentCapabilityProjectRoot()): gitRevParse(coordRoot,
      // ['rev-parse', '--show-toplevel']).
      let hasLiveBinding = false;
      try {
        const orchestratorProjectRoot = gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']);
        hasLiveBinding = rll.hasLiveMainOrchestratorBindingForScope(
          orchestratorProjectRoot, reqObj.requester_worktree_id, reqObj.plan_digest,
        );
      } catch (err) {
        hasLiveBinding = false; // never let a liveness-check exception select a driver.
      }
      if (!hasLiveBinding) continue; // no live top-level-host proof -- never select without it, zero partial activation.
      selectedDriver = 'claude-agent';
      break;
    }
    if (candidate === 'codex-app-server') {
      // The bridge is required lazily because it imports this module to reuse
      // the canonical state machine.  At dispatch time this module is fully
      // initialized, so the lazy edge is cycle-safe.  Selection requires the
      // bridge's complete retained-worker proof (READY role binding + active
      // lifecycle owner + exact supervisor action + live process owner + one
      // fresh worker-presence record); a file/binary/mechanism check alone is
      // never capability evidence.
      let bridge;
      let projectRoot;
      try {
        bridge = getRuntimeBridgeCodex();
        projectRoot = gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']);
      } catch (err) {
        continue;
      }
      let liveWorker;
      try {
        // The consultation target-profile digest and the lifecycle role-
        // template digest are deliberately different namespaces.  The bridge
        // independently accredits the current canonical lifecycle profile;
        // request<->activation correlation below accredits the consultation
        // profile.  Comparing the two unrelated digests would make this
        // branch structurally unreachable for every valid request.
        liveWorker = bridge.resolveLiveCodexAppServerWorker(projectRoot, reqObj.target_role);
      } catch (err) {
        continue;
      }
      if (liveWorker && liveWorker.ok === true && liveWorker.available === true) {
        selectedDriver = 'codex-app-server';
        break;
      }
      // M6+M7 SIXTEENTH Phase 2D (PLAN.md §16d: "post-intent and post-ingress
      // target loss on both retained-root and toolkit-root paths... dispatch
      // fails closed and neither selects noop nor counts noop as delivery/
      // evidence"; "a lost target falls back to noop" is one of §16d's own
      // named required-RED mutations). `resolveLiveCodexAppServerWorkerUncached`
      // (runtime-bridge-codex.cjs) reaches `supervisor-process-not-live`
      // ONLY after independently confirming the lifecycle owner record is
      // genuinely ACTIVE/RETAINED and exactly scope-matched -- i.e. this
      // target WAS a real, live, retained worker for this exact repo/
      // worktree/plan, and the one remaining reason it is not available now
      // is that its OS process is confirmed dead. That is "lost", never
      // "never available" -- falling through to another candidate (or the
      // routing policy's own noop fallback) would silently launder an
      // already-possible commitment into a fabricated non-delivery success.
      // Every OTHER reason (owner never active, scope mismatch, action
      // absent/mismatched, indeterminate liveness) means this target was
      // never a proven live commitment in the first place, so the ordinary
      // routing-policy fallback below remains correct for those.
      if (liveWorker && liveWorker.ok === true && liveWorker.reason === 'supervisor-process-not-live') {
        throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'retained codex-app-server target for ' + reqObj.target_role + ' was genuinely retained and is now lost -- dispatch fails closed rather than falling back to noop or a lower-priority candidate');
      }
      continue;
    }
    // claude-sendmessage/codex-mcp/runtime-spawn: no wired, non-fabricated
    // per-request capability evidence exists yet -- never select without
    // proof; try the next routing-permitted candidate.
  }

  return { selectedDriver, selectedClaudePeerBinding, selectedClaudeResumeHandle };
}

  return Object.freeze({
    ROOT_SOURCE_DISPATCH_DRIVERS,
    claudeAgentCapabilityProjectRoot,
    selectDispatchDriver,
  });
}

module.exports = { createDispatchDriverSelection };
