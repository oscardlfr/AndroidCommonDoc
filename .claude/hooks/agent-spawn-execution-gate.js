#!/usr/bin/env node
'use strict';

// Third HOLD, Part B, B1: PreToolUse hook for the Agent tool, main-orchestrator
// context only. Before the real Agent() call executes, atomically reserves the
// target lifecycle action -- revalidates binding/PLAN/session/role/expiry/
// team-ensure-succeeded fresh (never trusting stale state), requires tool_input
// to exactly match the action's own payload, derives operation fresh via
// resolveHostOperationForAction (Part C -- never assumes any pending action for
// the role is fair game), then mints a new no-clobber execution-claim record
// scoped to action_id (roleSpawnExecutionClaimPathFor/mintRoleSpawnExecutionClaim
// in scripts/lib/runtime-role-lifecycle.cjs).
//
// Owning vs non-owning (Fourth HOLD, team-lead + user, 2026-08-08 -- RB9-RB13):
// this gate only ever renders a decision (allow+reserve, or explicit block) for
// an "owning" call -- one where SOME role-lifecycle action genuinely exists for
// the exact role `tool_input.subagent_type` names (RB6/RB10/RB11). Every other
// Agent() call from the main orchestrator (an ad-hoc specialist/architect
// dispatch, the overwhelming majority in real usage) is "non-owning": silent
// pass-through, zero stdout, zero registry side effects (RB3/RB9/RB13) -- it
// proceeds entirely under whatever OTHER hooks (agent-spawn-validator.js etc.)
// already govern it. This is what keeps ordinary ad-hoc spawning unaffected
// while still unconditionally gating every genuine team-lifecycle role-spawn.
//
// CRITICAL: unlike its SupervisorExecutionClaim sibling (mintSupervisorExecutionClaim,
// hard-gated behind isFakeExecutorCapability()), mintRoleSpawnExecutionClaim is
// NEVER gated behind any test-only flag -- this hook genuinely, unconditionally
// reserve/commit-gates every real, owning Agent-tool spawn.
//
// Registered on the SAME Task|Agent PreToolUse matcher agent-spawn-validator.js
// already uses (.claude/settings.json) -- a separate, additive hook, never
// merged into that file.

const fs = require('fs');
const path = require('path');
const rll = require('../../scripts/lib/runtime-role-lifecycle.cjs');
const rc = require('../../scripts/lib/runtime-consultation.cjs');
const { getWaveSlug } = require('./hook-control-plane-utils');

// Mirrors context-provider-gate.js's own MAIN_ORCHESTRATOR_BINDING_TTL_SECONDS
// constant/rationale: sized so it is never the limiting factor for the claim's
// own min(action.expires_at, binding.expiry, now+readyTimeoutSeconds) bound.
const RESERVATION_BINDING_TTL_SECONDS = 3600;
const MAX_RUNTIME_SESSION_KEY_BYTES = 512;

// Official PreToolUse deny contract (code.claude.com/docs/en/hooks): exit 0,
// hookSpecificOutput{hookEventName:'PreToolUse', permissionDecision:'deny',
// permissionDecisionReason} -- never the deprecated top-level decision:'block'
// + exit 2 shape.
function denyResponse(reason) {
  return {
    exitCode: 0,
    body: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    },
  };
}

function emit(result) {
  process.stdout.write(JSON.stringify(result.body));
  process.exit(result.exitCode);
}

// M67-RS-HARNESS-SUFFIX-IDENTITY-01: Claude Code's own name-collision
// avoidance appends "-<N>" (N>=2, canonical decimal, no leading zero) to an
// addressable name it could not grant verbatim -- observed downstream at
// SubagentStart as a diverged agent_type. That numeric-suffix namespace is
// reserved GLOBALLY for every canonical role, exactly like the bare role
// name already is above: a caller may never supply "<canonical-role>-<N>"
// as tool_input.name itself (only the harness introduces it, AFTER this
// gate runs) -- doing so would let an unrelated spawn pre-claim the exact
// shape subagent-start-context-bundle.js's own promotion logic treats as a
// harness-suffix candidate for a role it does not own. Parsed via a plain
// regex on the last "-<digits>" run (never Number()/BigInt() on the digits
// -- the shape check alone is sufficient and avoids any numeric-overflow
// concern for an arbitrarily long digit run) so this can never itself
// mis-parse or throw on a hostile huge-suffix string.
function harnessSuffixCandidateRole(name) {
  const m = /^(.+)-([1-9][0-9]*)$/.exec(name);
  if (!m) return null;
  const digits = m[2];
  if (digits.length === 1 && digits < '2') return null; // excludes "-1" (N must be >=2)
  return m[1];
}

/**
 * Determines ownership: does SOME role-lifecycle action genuinely exist for
 * `role` in this exact worktree (never scoped by the CURRENT plan_digest here
 * -- a PLAN that changed after mint is a validity concern checked separately
 * by the caller, RB12b, not an ownership concern; an owning call whose PLAN
 * has since drifted must still receive an explicit deny, never silently read
 * as non-owning). Two independent sources, mirroring subagent-start-context-
 * bundle.js's own findPendingRoleSpawnActionId scan convention (a candidate's
 * claimed scope must hash back to the exact path it was found at):
 *   (a) the common, authoritative case -- a STARTING/REHYDRATING role-binding
 *       whose own pending_action_id names a real action (role-spawn/
 *       role-rebind flows always go through a role-binding);
 *   (b) a role-lifecycle action naming this role directly, with NO role-
 *       binding at all (role-notify actions never touch a role-binding
 *       record), filtered to Agent-mapped actions only (M7 Correction, Fix 3
 *       second half) -- a pending role-notify (resolveHostOperationForAction
 *       resolves it to 'SendMessage', never 'Agent') must never make an
 *       unrelated ad-hoc Agent() dispatch for the same role "owning" in the
 *       first place; filtered BEFORE it is ever considered a candidate, not
 *       after.
 *
 * M7 Correction (Fix 3, first half): collects EVERY match across both loops
 * (de-duplicated by action_id -- the SAME action can legitimately surface via
 * both loops at once, e.g. loop 1's role-binding-backed find and loop 2's raw
 * actions/ scan both naming the identical pending action) instead of
 * returning on the first match. More than one DISTINCT genuinely-live
 * candidate is ambiguous -- the caller must deny, never silently pick one
 * (mirrors subagent-start-context-bundle.js's own B3 AMBIGUOUS handling).
 * @returns {{candidate:{record:object|null,action:object}|null,ambiguous:boolean}}
 */
function findOwningRoleLifecycleCandidate(projectRoot, worktreeId, role) {
  const foundByActionId = new Map();

  const bindingsDir = path.join(rll.registryRepoDir(projectRoot), 'role-bindings');
  let bindingEntries;
  try {
    bindingEntries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch {
    bindingEntries = [];
  }
  for (const entry of bindingEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidatePath = path.join(bindingsDir, entry.name);
    const rawRead = rll.readRegistryRecord(candidatePath);
    if (!rawRead.ok || rawRead.absent || !rawRead.obj) continue;
    const rec = rawRead.obj;
    if (
      typeof rec.worktree_id !== 'string' || typeof rec.plan_digest !== 'string'
      || typeof rec.profile_digest !== 'string' || typeof rec.session_generation_id !== 'string'
      || typeof rec.role !== 'string'
    ) continue;
    if (rll.roleBindingPathFor(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role) !== candidatePath) continue;
    if (rec.worktree_id !== worktreeId || rec.role !== role) continue;
    const stateResult = rll.readRoleBindingState(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role);
    if (!stateResult.ok) continue;
    if ((stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING') || !stateResult.record.pending_action_id) continue;
    const actionRead = rll.findActionAcrossRepos(stateResult.record.pending_action_id);
    if (!actionRead.ok || actionRead.absent) continue;
    if (actionRead.action.worktree_id !== worktreeId || actionRead.action.role !== role) continue;
    if (!foundByActionId.has(actionRead.action.action_id)) {
      foundByActionId.set(actionRead.action.action_id, { record: stateResult.record, action: actionRead.action });
    }
  }

  const actionsDir = path.join(rll.registryRepoDir(projectRoot), 'actions');
  let actionEntries;
  try {
    actionEntries = fs.readdirSync(actionsDir, { withFileTypes: true });
  } catch {
    actionEntries = [];
  }
  for (const entry of actionEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const actionRead = rll.readRegistryRecord(path.join(actionsDir, entry.name));
    if (!actionRead.ok || actionRead.absent || !actionRead.obj) continue;
    const action = actionRead.obj;
    if (action.schema !== 'coordination/role-lifecycle-action/v1') continue;
    // Sixteenth root-source is resolved by its own closed scanner above.
    // Excluding that disjoint arm here prevents the same immutable action
    // from being counted once in each ownership family and falsely reported
    // as cross-family ambiguity.
    if (action.kind === 'root-source-spawn') continue;
    if (action.role !== role || action.worktree_id !== worktreeId) continue;
    if (rll.resolveHostOperationForAction(action.kind, action.runtime) !== 'Agent') continue;
    const actionExpiryMs = Date.parse(action.expires_at);
    if (!Number.isFinite(actionExpiryMs) || actionExpiryMs <= Date.now()) continue;
    if (!foundByActionId.has(action.action_id)) {
      foundByActionId.set(action.action_id, { record: null, action });
    }
  }

  if (foundByActionId.size === 0) return { candidate: null, ambiguous: false };
  if (foundByActionId.size > 1) return { candidate: null, ambiguous: true };
  return { candidate: foundByActionId.values().next().value, ambiguous: false };
}

// ─────────────────────────────────────────────────────────────────────────
// M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
// authorization point 2): recognizes a CURRENT, consultation-dispatch-
// originated `claude-agent` ActivationAction for `role` -- a genuinely
// DIFFERENT ownership kind from findOwningRoleLifecycleCandidate above
// (coordination/role-lifecycle-action/v1, ensure()-driven persistent
// spawns): scans runtime-consultation.cjs's own coordination_root
// transaction tree for a live `activation/v1` record with
// `selected_driver:'claude-agent'` via the shared
// rc.findLiveClaudeAgentActivations scan. Deliberately does NOT filter out
// an already-reserved candidate (empirically corrected during this pass's
// own fixture testing -- an earlier draft filtered them out, which let a
// REPLAYED Agent() call for the SAME activation silently fall through to
// non-owning pass-through instead of being explicitly denied): mirrors
// findOwningRoleLifecycleCandidate above exactly -- when exactly one live
// candidate exists, the mint attempt below either succeeds (genuinely new)
// or collides EEXIST on mintClaudeAgentSpawnReservation's own no-clobber
// publish (a replay), and EITHER way the caller gets an explicit
// allow/deny, never a silent skip. Zero selection by elimination or mere
// role coincidence (user point 2): a candidate is recognized ONLY via a
// REAL, durable activation/v1 record whose own selected_driver/request_id/
// target_role fields positively match -- never inferred from "no
// role-lifecycle candidate exists" (the exact bug class this pass's own
// already-completed architect review rejected for
// subagent-start-context-bundle.js's original COSB fixture).
// ─────────────────────────────────────────────────────────────────────────

function findOwningClaudeAgentActivationCandidates(coordRoot, repoId, waveSlug, planDigest, role) {
  return rc.findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planDigest, role);
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);

    if (data.tool_name !== 'Agent') process.exit(0);
    const agentType = data.agent_type || '';
    if (agentType !== '') process.exit(0); // RB4: main-orchestrator only.

    const toolInput = (data.tool_input && typeof data.tool_input === 'object') ? data.tool_input : {};
    const subagentType = toolInput.subagent_type;
    if (typeof subagentType !== 'string' || subagentType.length === 0) {
      process.exit(0); // no resolvable role -- non-owning by construction.
    }
    // CIERRE FINAL correction (2026-08-15), GATE RULE 2: an omitted/empty
    // `name` is canonicalized INTERNALLY to subagentType for every
    // correlation/digest purpose below -- PLAN.md's own documented
    // invocation style (Agent(subagent_type=<canonical-role>)) never sets
    // `name` at all, so treating that as automatic non-owning pass-through
    // (the prior behavior) silently exempted the PLAN-prescribed call shape
    // from this whole reservation mechanism. Only a genuinely PRESENT,
    // non-empty name can ever diverge from subagentType from here on.
    const rawName = toolInput.name;
    const name = (typeof rawName === 'string' && rawName.length > 0) ? rawName : subagentType;
    // CIERRE FINAL correction (2026-08-15), GATE RULE 1:
    // CANONICAL-NAME-RESERVATION-STEAL. The canonical-role namespace is
    // reserved GLOBALLY -- independent of whether subagentType itself owns
    // anything at all. Without this, an unrelated, genuinely non-owning
    // Agent() call (e.g. subagent_type='verifier', zero live activations of
    // its own) could freely set name to some OTHER role's canonical string
    // (e.g. 'test-specialist') purely to be misattributed at SubagentStart
    // time: Claude Code reports the custom `name` in `agent_type` whenever it
    // diverges from subagent_type, and SubagentStart has no OTHER field
    // carrying the real subagent_type to catch the mismatch with -- the
    // digest-reconstruction check there is provably circular against this
    // exact attack (reconstructs {subagent_type:role, name:observedName}
    // from the FOUND reservation's own role, never the adversary's real
    // subagent_type). The only sound fix is removing the adversary's ability
    // to choose a canonical-role string as `name` in the first place, checked
    // BEFORE any ownership-family lookup runs (root-source, claude-agent,
    // role-lifecycle) -- a role-lifecycle/root-source owning spawn's own
    // per-branch check below (name must equal ITS OWN expected value) closes
    // the same-role case; this closes the CROSS-role case those checks
    // cannot see, since they only ever run once subagentType itself is
    // already known to own something.
    if (rll.CANONICAL_ROLES.includes(name) && name !== subagentType) {
      emit(denyResponse('[agent-spawn-execution-gate] tool_input.name "' + name + '" is a reserved canonical role name that diverges from tool_input.subagent_type "' + subagentType + '" -- the canonical-role namespace is reserved globally, regardless of ownership.'));
      return;
    }
    // M67-RS-HARNESS-SUFFIX-IDENTITY-01 (see harnessSuffixCandidateRole doc
    // comment): the same global reservation, extended to the harness's own
    // numeric-suffix namespace. name can never legitimately equal this shape
    // here -- the harness introduces it only AFTER this gate runs -- so any
    // caller-supplied match is denied unconditionally, independent of
    // whether the suffixed role itself is CANONICAL_ROLES-valid.
    const suffixRole = harnessSuffixCandidateRole(name);
    if (suffixRole !== null && rll.CANONICAL_ROLES.includes(suffixRole)) {
      emit(denyResponse('[agent-spawn-execution-gate] tool_input.name "' + name + '" matches the reserved harness numeric-suffix namespace for canonical role "' + suffixRole + '" -- that namespace is reserved globally for the harness itself, never a caller-supplied name.'));
      return;
    }

    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    let worktreeId;
    let planResult;
    try {
      worktreeId = rll.computeWorktreeId(projectRoot);
      planResult = rll.discoverPlan(projectRoot);
    } catch {
      process.exit(0); // unresolvable scope (e.g. pre-PLAN) -- mechanism inapplicable, mirrors this hook family's own pre-PLAN passthrough convention.
    }
    if (!planResult.ok) process.exit(0);

    // Sixteenth §16b: root-source is a third, disjoint owning action kind.
    // Resolve it before either pre-existing ownership family, but never by
    // elimination: zero exact candidates falls through unchanged; malformed,
    // expired or ambiguous owning state is an explicit deny.  The shared
    // lifecycle scanner revalidates every closed action/path and intentionally
    // retains an already-reserved action so a replay reaches the strict
    // no-clobber mint below and is denied rather than becoming pass-through.
    let rootSourceLookup;
    try {
      rootSourceLookup = rll.findLiveRootSourceActionsForRole(
        projectRoot, subagentType, worktreeId, planResult.planDigest,
      );
    } catch {
      rootSourceLookup = { ok: false, reason: 'root-source-action-scan-threw' };
    }
    if (!rootSourceLookup.ok) {
      emit(denyResponse('[agent-spawn-execution-gate] root-source owning-state validation failed for "' + subagentType + '": ' + rootSourceLookup.reason));
      return;
    }

    // Resolve the other two ownership families before selecting any one of
    // them.  This is a union ambiguity check, not priority ordering: a role
    // can never be selected merely because root-source happened to be tested
    // before claude-agent or role-spawn.
    const lifecycleLookup = findOwningRoleLifecycleCandidate(projectRoot, worktreeId, subagentType);
    let claudeAgentCandidates = [];
    try {
      const coordRoot = rll.coordinationRootPathFor(projectRoot);
      const repoId = rll.computeRepoId(projectRoot);
      const waveSlug = getWaveSlug(projectRoot, { useEnv: false, useAlias: false, gitTimeoutMs: 3000 });
      if (waveSlug) {
        claudeAgentCandidates = findOwningClaudeAgentActivationCandidates(
          coordRoot, repoId, waveSlug, planResult.planDigest, subagentType,
        );
      }
    } catch {
      claudeAgentCandidates = [];
    }
    const ownershipCount = rootSourceLookup.actions.length
      + claudeAgentCandidates.length
      + (lifecycleLookup.candidate ? 1 : 0);
    if (rootSourceLookup.actions.length > 1 || claudeAgentCandidates.length > 1
      || lifecycleLookup.ambiguous) {
      emit(denyResponse('[agent-spawn-execution-gate] owning action union is ambiguous for "' + subagentType + '" -- root-source, claude-agent and role-spawn are disjoint and may never be selected by priority.'));
      return;
    }
    // Multiple ownership families may retain concurrently-live diagnostic
    // records for the same role. They are disjoint, but the Agent call is
    // not ambiguous when exactly one immutable action payload matches all
    // supplied fields. Resolve by full accredited-input correlation, never
    // family priority or role coincidence. Zero or multiple exact matches
    // remain an explicit fail-closed ambiguity.
    let selectedOwnership = null;
    if (ownershipCount > 1) {
      const exact = [];
      if (rootSourceLookup.actions.length === 1) {
        const expected = rootSourceLookup.actions[0].payload || {};
        if (subagentType === expected.agent_type && name === expected.name && toolInput.prompt === expected.bootstrap_message) {
          exact.push('root-source');
        }
      }
      if (claudeAgentCandidates.length === 1) {
        const { activation, requestId } = claudeAgentCandidates[0];
        const expectedPrompt = rll.claudeAgentBootstrapMessageFor(subagentType, requestId, activation.attempt_id);
        if (name === subagentType && toolInput.prompt === expectedPrompt) exact.push('claude-agent');
      }
      if (lifecycleLookup.candidate) {
        const expected = lifecycleLookup.candidate.action.payload || {};
        if (name === expected.teammate_name && toolInput.prompt === expected.bootstrap_message) exact.push('role-lifecycle');
      }
      if (exact.length !== 1) {
        emit(denyResponse('[agent-spawn-execution-gate] owning action union is ambiguous for "' + subagentType + '" -- exact action-payload correlation did not select one unique owner.'));
        return;
      }
      selectedOwnership = exact[0];
    } else if (rootSourceLookup.actions.length === 1) {
      selectedOwnership = 'root-source';
    } else if (claudeAgentCandidates.length === 1) {
      selectedOwnership = 'claude-agent';
    } else if (lifecycleLookup.candidate) {
      selectedOwnership = 'role-lifecycle';
    }
    if (selectedOwnership === 'root-source') {
      const action = rootSourceLookup.actions[0];
      const sessionId = data.session_id;
      if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
        emit(denyResponse('[agent-spawn-execution-gate] missing or invalid session_id while a genuine root-source action exists.'));
        return;
      }
      const expected = action.payload || {};
      if (subagentType !== expected.agent_type || name !== expected.name || toolInput.prompt !== expected.bootstrap_message) {
        emit(denyResponse('[agent-spawn-execution-gate] Agent input does not exactly match the reserved root-source action payload.'));
        return;
      }
      const bindingResult = rll.getOrCreateMainOrchestratorBindingForSession(
        projectRoot, sessionId, worktreeId, planResult.planDigest, RESERVATION_BINDING_TTL_SECONDS,
      );
      const generationResult = rll.peekSessionGeneration(
        projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId },
      );
      if (!bindingResult.ok || !generationResult.ok || generationResult.generationId !== action.session_generation_id) {
        emit(denyResponse('[agent-spawn-execution-gate] root-source main binding/session generation does not match the owning action.'));
        return;
      }
      const reservation = rll.mintRootSourceReservation(projectRoot, action, {
        mainBindingId: bindingResult.binding.binding_id,
        sessionGenerationId: generationResult.generationId,
        runtimeSessionKey: sessionId,
        toolUseId: data.tool_use_id,
        toolInput,
      });
      if (!reservation.ok) {
        emit(denyResponse('[agent-spawn-execution-gate] root-source reservation denied: ' + reservation.reason));
        return;
      }
      emit({
        exitCode: 0,
        body: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: Object.assign({}, toolInput) } },
      });
      return;
    }

    // M7 completeness Part C follow-up: recognize a CURRENT claude-agent
    // ActivationAction BEFORE the existing role-lifecycle-action check below
    // -- these are two DISJOINT ownership kinds (a spawn is never both).
    // This new check runs first only because it needs its own coordRoot/
    // waveSlug resolution the role-lifecycle path never required; on zero
    // matches (the case in ALL current production -- see
    // findLiveClaudeAgentActivations's own disclosure) this falls straight
    // through to the UNCHANGED role-lifecycle logic below, never altering
    // its behavior in any way.
    if (selectedOwnership === 'claude-agent') {
      const sessionIdForClaudeAgent = data.session_id;
      if (typeof sessionIdForClaudeAgent !== 'string' || sessionIdForClaudeAgent.length === 0 || Buffer.byteLength(sessionIdForClaudeAgent, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
        emit(denyResponse('[agent-spawn-execution-gate] missing or invalid session_id while a genuine claude-agent activation candidate exists for "' + subagentType + '".'));
        return;
      }
      // HARD NO-GO correction (2026-08-15): an owning claude-agent one-shot
      // spawn's tool_input.name must be EXACTLY tool_input.subagent_type --
      // custom-named ownership is withdrawn, not merely softened. Checked
      // BEFORE the bootstrap-message validation below (and before ANY
      // reservation is minted): the prior gate never compared name against
      // subagentType at all here, so a genuinely divergent name (Agent tool's
      // free-text `name` param) reserved this activation exactly like an
      // ordinary role-lifecycle spawn -- SubagentStart then had to recover
      // the true role from context it could not always resolve safely across
      // concurrent same-generation spawns (a second, differently-typed
      // Agent() call sharing this reservation's session_generation could
      // otherwise be mistaken for its owner). Root-source (name checked
      // exactly against the action's own recorded expected.name, line ~279)
      // and role-lifecycle (name checked exactly against the action's own
      // teammate_name, line ~442) already enforce an equivalent exact match
      // -- this closes the ONE ownership family that did not.
      //
      // CIERRE FINAL correction (2026-08-15): kept alongside the new global
      // GATE RULE 1 above (canonical-role namespace reserved unconditionally)
      // -- deliberately NOT redundant. RULE 1 only fires when `name` is
      // itself a member of CANONICAL_ROLES; this check ALSO denies a
      // NON-canonical custom name (e.g. 'partb-example') on a subagentType
      // that DOES genuinely own this activation, which RULE 1 cannot see
      // (subagentType is owning here, but `name` never matched any canonical
      // role at all).
      if (name !== subagentType) {
        emit(denyResponse('[agent-spawn-execution-gate] tool_input.name "' + name + '" diverges from tool_input.subagent_type "' + subagentType + '" for an owning claude-agent activation -- custom-named ownership is not supported.'));
        return;
      }
      const { activation, requestId } = claudeAgentCandidates[0];
      // Bootstrap message is verified against the SAME deterministic formula
      // this hook is about to store on the reservation -- never accepted
      // from tool_input.prompt as ground truth (user point 2: "Ningun campo
      // se deriva de prompt/prosa/model output").
      const expectedBootstrapMessage = rll.claudeAgentBootstrapMessageFor(subagentType, requestId, activation.attempt_id);
      if (toolInput.prompt !== expectedBootstrapMessage) {
        emit(denyResponse('[agent-spawn-execution-gate] tool_input.prompt does not match the deterministic bootstrap message for the claude-agent activation targeting "' + subagentType + '".'));
        return;
      }
      const pairForClaudeAgent = rll.resolvePolicyPair(projectRoot);
      if (!pairForClaudeAgent.ok) {
        emit(denyResponse('[agent-spawn-execution-gate] policy/routing pair invalid.'));
        return;
      }
      const repoDescriptorForClaudeAgent = { repoId: rll.computeRepoId(projectRoot) };
      let mainBindingIdForClaudeAgent;
      let sessionGenerationIdForClaudeAgent;
      try {
        // Fresh revalidation every time -- never trust stale state, mirrors
        // the role-lifecycle path's own MainOrchestratorBinding discipline
        // below exactly.
        const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionIdForClaudeAgent };
        const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, RESERVATION_BINDING_TTL_SECONDS);
        if (!bindingResult.ok) {
          emit(denyResponse('[agent-spawn-execution-gate] unable to mint an authorizing main-orchestrator binding for the claude-agent activation.'));
          return;
        }
        mainBindingIdForClaudeAgent = bindingResult.binding.binding_id;
        const genResult = rll.peekSessionGeneration(projectRoot, identity);
        if (!genResult.ok) {
          emit(denyResponse('[agent-spawn-execution-gate] unable to resolve the current session generation for the claude-agent activation.'));
          return;
        }
        sessionGenerationIdForClaudeAgent = genResult.generationId;
      } catch {
        emit(denyResponse('[agent-spawn-execution-gate] unable to mint an authorizing main-orchestrator binding for the claude-agent activation.'));
        return;
      }
      const toolInputDigestForClaudeAgent = rc.sha256String(rc.canonicalJSONStringify({ subagent_type: subagentType, name }));
      let mintResultForClaudeAgent;
      try {
        mintResultForClaudeAgent = rll.mintClaudeAgentSpawnReservation(
          repoDescriptorForClaudeAgent, activation, requestId, subagentType, worktreeId, planResult.planDigest,
          sessionGenerationIdForClaudeAgent, mainBindingIdForClaudeAgent, toolInputDigestForClaudeAgent,
          pairForClaudeAgent.policy.ready_timeout_seconds,
        );
      } catch {
        mintResultForClaudeAgent = { ok: false, reason: 'internal-error' };
      }
      if (!mintResultForClaudeAgent.ok) {
        // Mirrors RB2: a second/replayed reservation attempt for the SAME
        // native_spawn_action_id collides on mintClaudeAgentSpawnReservation's
        // own no-clobber publish.
        emit(denyResponse('[agent-spawn-execution-gate] reservation denied for the claude-agent activation targeting "' + subagentType + '": ' + mintResultForClaudeAgent.reason));
        return;
      }
      emit({
        exitCode: 0,
        body: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: Object.assign({}, toolInput),
          },
        },
      });
      return;
    }

    // RB3/RB9/RB13: no role-lifecycle action exists for this exact role at
    // all -- non-owning, silent pass-through, genuinely ZERO registry side
    // effects (never even a session-generation lookup-or-create).
    // M7 Correction (Fix 4): candidate lookup runs BEFORE the session_id
    // check -- it is scoped by worktreeId/role only and needs no session
    // identity. This is what lets a genuinely owning call (candidate found)
    // with a missing session_id reach an explicit deny below, instead of
    // looking identical to "no owning action exists" the way the OLD
    // ordering did.
    if (selectedOwnership !== 'role-lifecycle') process.exit(0);
    const candidate = lifecycleLookup.candidate;
    const action = candidate.action;

    // M7 Correction (Fix 4): a MISSING/invalid session_id must never
    // silently bypass an owning check -- checked HERE, after ownership is
    // established, so a genuinely owning call always reaches an explicit
    // deny. RB13's own "extra/unrecognized input never flips non-owning"
    // principle still holds for the NON-owning case above (no candidate ->
    // exit 0 regardless of session_id, already handled by the early return).
    const sessionId = data.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
      emit(denyResponse('[agent-spawn-execution-gate] missing or invalid session_id while a genuine owning candidate exists for "' + subagentType + '".'));
      return;
    }

    // RB12b: an owning call whose target action was minted against a
    // DIFFERENT PLAN than the one currently resolved must be explicitly
    // denied, never silently reclassified as non-owning.
    if (action.plan_digest !== planResult.planDigest) {
      emit(denyResponse('[agent-spawn-execution-gate] the pending action for "' + subagentType + '" was minted against a different PLAN than the current one.'));
      return;
    }

    // Part C: operation derived FRESH via the pure, closed lookup table --
    // never assumes any pending action found for this role is an Agent-tool
    // spawn just because it exists (RB6).
    const operation = rll.resolveHostOperationForAction(action.kind, action.runtime);
    if (operation !== 'Agent') {
      emit(denyResponse('[agent-spawn-execution-gate] the pending action for "' + subagentType + '" does not resolve to an Agent-tool operation.'));
      return;
    }

    // RB11: an owning-scope call whose tool_input does not match the
    // action's own payload must be explicitly denied, never silently
    // reclassified as non-owning.
    const expectedTeammateName = action.payload && action.payload.teammate_name;
    if (name !== expectedTeammateName) {
      emit(denyResponse('[agent-spawn-execution-gate] tool_input.name does not match the reserved action\'s own payload for "' + subagentType + '".'));
      return;
    }

    // M7 Correction (Fix 1): tool_input.prompt must exactly match the
    // reserved action's own accredited bootstrap_message. PLAN.md describes
    // bootstrap_message as "fixed/bounded" (~L177, ~L614) -- a
    // deterministically-constructed instruction string, not free model
    // prose -- so an exact-match check is well-founded, not a guess about
    // model behavior.
    const expectedBootstrapMessage = action.payload && action.payload.bootstrap_message;
    if (toolInput.prompt !== expectedBootstrapMessage) {
      emit(denyResponse('[agent-spawn-execution-gate] tool_input.prompt does not match the reserved action\'s own bootstrap message for "' + subagentType + '".'));
      return;
    }

    // RB5: team-ensure must be genuinely SUCCEEDED, not merely PENDING.
    // Only meaningful when the candidate came from a role-binding at all
    // (role-notify actions, found with record:null, never carry one).
    if (candidate.record && candidate.record.team_ensure_action_id) {
      const teamState = rll.readTeamEnsureState(projectRoot, action.session_generation_id, action.worktree_id, action.plan_digest);
      if (!teamState.ok || teamState.state !== 'SUCCEEDED') {
        emit(denyResponse('[agent-spawn-execution-gate] dependent team-ensure has not yet SUCCEEDED for "' + subagentType + '".'));
        return;
      }
    }

    const pair = rll.resolvePolicyPair(projectRoot);
    if (!pair.ok) {
      emit(denyResponse('[agent-spawn-execution-gate] policy/routing pair invalid.'));
      return;
    }

    // Fresh revalidation every time -- never trust stale state. The
    // lifecycle session owns exactly one live MainOrchestratorBinding for
    // {session,worktree,plan}; reuse that canonical singleton instead of
    // minting one sibling per Agent call. RB12a remains fail-closed because
    // a different observed session resolves a different binding/generation,
    // and mintRoleSpawnExecutionClaim cross-correlates that generation with
    // the action. RB7 remains bounded by the action's own expiry.
    let mainBindingId;
    try {
      const bindingResult = rll.getOrCreateMainOrchestratorBindingForSession(
        projectRoot, sessionId, worktreeId, planResult.planDigest, RESERVATION_BINDING_TTL_SECONDS,
      );
      if (!bindingResult.ok) {
        emit(denyResponse('[agent-spawn-execution-gate] unable to resolve an authorizing main-orchestrator binding.'));
        return;
      }
      mainBindingId = bindingResult.binding.binding_id;
    } catch {
      emit(denyResponse('[agent-spawn-execution-gate] unable to resolve an authorizing main-orchestrator binding.'));
      return;
    }

    const toolInputDigest = rc.sha256String(rc.canonicalJSONStringify({ subagent_type: subagentType, name }));
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    let mintResult;
    try {
      mintResult = rll.mintRoleSpawnExecutionClaim(repoDescriptor, action, mainBindingId, toolInputDigest, pair.policy.ready_timeout_seconds);
    } catch {
      mintResult = { ok: false, reason: 'internal-error' };
    }
    if (!mintResult.ok) {
      // RB2: a second/replayed reservation attempt for the SAME action_id
      // collides on mintRoleSpawnExecutionClaim's own no-clobber publish.
      emit(denyResponse('[agent-spawn-execution-gate] reservation denied for "' + subagentType + '": ' + mintResult.reason));
      return;
    }

    // Part A defect A4 parity: permissionDecision:'allow' + the FULL
    // original tool_input preserved (nothing to rewrite here -- this hook
    // only decides allow/deny, it never mutates the Agent() call itself).
    emit({
      exitCode: 0,
      body: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: Object.assign({}, toolInput),
        },
      },
    });
  } catch {
    // Fail open on a malformed/unparseable stdin envelope only -- every
    // business-logic denial above is an explicit block, never this catch-all.
    process.exit(0);
  }
});
