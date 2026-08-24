#!/usr/bin/env node
// subagent-start-context-bundle.js — SubagentStart hook
//
// When a teammate (peer) starts, checks for a context bundle at:
//   .planning/wave-<slug>/context-bundles/<role>.md
//
// If the bundle exists and its wave_slug frontmatter matches the current
// wave (derived from git branch, NOT env var — env does not persist between
// Bash calls), emits additionalContext so the peer starts with pre-loaded
// knowledge.
//
// Identity resolution: teammates have non-empty agent_type. The role used
// for bundle lookup is agent_type (canonical NAME per OQ3 D8 constraint).
//
// Slug resolution: git branch feature/<slug> → slug. Env var CLAUDE_WAVE_SLUG
// is NOT used — it does not persist between Bash calls in the Claude harness.
//
// Absent or stale bundle → exit 0 silently (fail-open, never blocks spawn).
// Parse errors → exit 0 silently (fail-open).
//
// Wired in .claude/settings.json under SubagentStart matcher.

const fs = require('fs');
const path = require('path');
const { getWaveSlug } = require('./hook-control-plane-utils');
const rll = require('../../scripts/lib/runtime-role-lifecycle.cjs');
const rc = require('../../scripts/lib/runtime-consultation.cjs');

// M67-RS-HARNESS-SUFFIX-IDENTITY-01: mirrors agent-spawn-execution-gate.js's
// own harnessSuffixCandidateRole helper exactly (duplicated rather than
// shared -- this is parsing logic private to each hook, never a new
// cross-file interface). Parses only the shape ("<role>-<N>", N>=2, canonical
// decimal, no Number()/BigInt() conversion so an arbitrarily long digit run
// can never overflow or throw) -- the caller decides whether the parsed
// prefix is ever granted any authority; this function grants none itself.
function harnessSuffixCandidateRole(name) {
  const m = /^(.+)-([1-9][0-9]*)$/.exec(name);
  if (!m) return null;
  const digits = m[2];
  if (digits.length === 1 && digits < '2') return null; // excludes "-1" (N must be >=2)
  return m[1];
}

const STDIN_TIMEOUT_MS = 5000;

// Sequence 30 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822) envelope repair:
// the official Claude Code SubagentStart hook contract (code.claude.com/docs/
// en/hooks) returns additionalContext nested under hookSpecificOutput with
// hookEventName exactly "SubagentStart" -- the same hookSpecificOutput
// convention every other hook in this repo already uses for its own event
// (see agent-spawn-execution-gate.js/context-provider-gate.js's own
// hookEventName:'PreToolUse'). This file's two successful-injection sites
// previously wrote a bare top-level {additionalContext} instead: the hook ran
// and its stdout was recorded (visible in a subagent's own transcript as a
// hook-success attachment), but an unrecognized envelope shape is never
// promoted into the model's actual context. This is the sole shared emitter
// for both sites -- an adapter-envelope fix only, no new authority field.
function emitSubagentStartAdditionalContext(value) {
  if (typeof value !== 'string') throw new TypeError('emitSubagentStartAdditionalContext requires a string');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: value },
  }));
  process.exit(0);
}
// M7 Correction (§5.A): createRoleActorBinding's own internal bound is
// ACTION_TTL_CEILING_SECONDS (120, confirmed by direct read of
// runtime-role-lifecycle.cjs) -- the maximum admitted, chosen here to give
// both `ready` (item 1§C) and the consultation target grants (item 1§D) the
// widest possible window to find this binding.
const ROLE_ACTOR_BINDING_TTL_SECONDS = 120;
// M7 completeness Part C follow-up: createClaudeOneShotBinding's own
// internal ceiling is CLAUDE_ONE_SHOT_BINDING_TTL_CEILING_SECONDS (3600,
// confirmed by direct read of runtime-role-lifecycle.cjs) -- requested at
// the maximum admitted, mirroring ROLE_ACTOR_BINDING_TTL_SECONDS's own
// "widest possible window" rationale immediately above (a live one-shot
// Agent() consultation turn may legitimately run for many minutes).
const CLAUDE_ONE_SHOT_BINDING_TTL_SECONDS = 3600;

// ─────────────────────────────────────────────────────────────────────────
// Third HOLD, Part B, B2/B3/B4: SubagentStart confirmation of B1's atomic
// reservation (agent-spawn-execution-gate.js). Correlates {session_id,
// agent_id, agent_type} against exactly the ONE reservation claim B1 made,
// then validates+atomically-consumes that SAME claim via the exported
// validateAndConsumeRoleSpawnExecutionClaim -- never re-interprets the
// action itself (this file must NOT call interpretRoleLifecycleAction
// directly). Only engages when a role-binding genuinely exists for this
// role (M7-RB-NONOWNING: a role never ensure()'d -- every ad-hoc
// specialist/architect dispatch -- must stay completely inert: no
// quarantine, no mutation, pre-existing bundle-injection behavior
// unaffected).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scans role-bindings for `role`, scoped to the CURRENT worktree/PLAN,
 * across every session generation. Returns TWO independent things:
 *   - `anyExists`: true iff ANY role-binding record exists for this role,
 *     regardless of its current state. This is the M7-RB-NONOWNING
 *     ownership gate -- "no role-binding record at all" is the ONLY
 *     genuinely inert case. A role-binding that has already been
 *     QUARANTINED (e.g. by a PRIOR confirmation attempt against this SAME
 *     fixture) still counts as owning: the bundle must never be
 *     (re-)injected just because nothing is left STARTING/REHYDRATING to
 *     quarantine a second time.
 *   - `liveCandidates`: the STARTING/REHYDRATING-with-pending_action_id
 *     subset -- what the ABSENT/AMBIGUOUS/MISMATCHED/CONFIRM logic reasons
 *     about and may quarantine.
 * @returns {{anyExists:boolean,liveCandidates:Array<{worktreeId:string,planDigest:string,profileDigest:string,generationId:string,role:string,state:string,record:object,actionId:string}>}}
 */
function scanRoleBindingsForRole(projectRoot, role) {
  let worktreeId;
  let planResult;
  try {
    worktreeId = rll.computeWorktreeId(projectRoot);
    planResult = rll.discoverPlan(projectRoot);
  } catch {
    return { anyExists: false, liveCandidates: [] };
  }
  if (!planResult.ok) return { anyExists: false, liveCandidates: [] };
  const bindingsDir = path.join(rll.registryRepoDir(projectRoot), 'role-bindings');
  let entries;
  try {
    entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch {
    return { anyExists: false, liveCandidates: [] };
  }
  let anyExists = false;
  const liveCandidates = [];
  for (const entry of entries) {
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
    if (rec.worktree_id !== worktreeId || rec.plan_digest !== planResult.planDigest || rec.role !== role) continue;
    const stateResult = rll.readRoleBindingState(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role);
    if (!stateResult.ok) continue;
    anyExists = true;
    if ((stateResult.state === 'STARTING' || stateResult.state === 'REHYDRATING') && stateResult.record.pending_action_id) {
      liveCandidates.push({
        worktreeId: rec.worktree_id, planDigest: rec.plan_digest, profileDigest: rec.profile_digest,
        generationId: rec.session_generation_id, role, state: stateResult.state, record: stateResult.record,
        actionId: stateResult.record.pending_action_id,
      });
    }
  }
  return { anyExists, liveCandidates };
}

/** True when a RoleSpawnExecutionClaim/v1 record exists at this action's claim path (presence only -- full validation happens via validateAndConsumeRoleSpawnExecutionClaim). */
function hasLiveClaimFile(projectRoot, actionId) {
  const read = rll.readRegistryRecord(rll.roleSpawnExecutionClaimPathFor(projectRoot, actionId));
  return read.ok === true && read.absent !== true;
}

/** Best-effort quarantine (STARTING/REHYDRATING -> QUARANTINED, both legal direct edges) -- never fatal to the hook itself. */
function quarantineCandidate(projectRoot, candidate, reason) {
  try {
    rll.transitionRoleBinding(projectRoot, candidate.worktreeId, candidate.planDigest, candidate.profileDigest, candidate.generationId, candidate.role, candidate.state, 'QUARANTINED', candidate.record, { failure_reason: reason });
  } catch { /* best effort -- never fatal to the hook itself */ }
}

/**
 * Mirrors agent-spawn-execution-gate.js's own tool_input_digest formula
 * (`sha256(canonicalJSON({subagent_type, name}))`, computed there from the
 * REAL tool_input at PreToolUse(Agent) time -- confirmed by direct read,
 * agent-spawn-execution-gate.js:365). For the role-lifecycle path (every
 * ad-hoc specialist/architect team dispatch), this system's own convention
 * (buildRoleSpawnPayload) makes teammate_name===subagent_type===role
 * always, so `role` doubles as `name` there too (call site passes the same
 * value twice). For a one-shot claude-agent consultation spawn using the
 * Agent tool's custom `name` param, `role` and `observedName` are genuinely
 * different: `role` is the durably-recorded canonical role the reservation
 * was minted under; `observedName` is whatever this SubagentStart's own
 * `agent_type` field reports (custom or canonical -- Claude Code's own
 * documented behavior is to report the custom name there, never
 * subagent_type, when they diverge; confirmed empirically 2026-08-15).
 */
function reconstructedToolInputDigest(role, observedName) {
  return rc.sha256String(rc.canonicalJSONStringify({ subagent_type: role, name: observedName }));
}

// ─────────────────────────────────────────────────────────────────────────
// M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
// authorization point 3): consumes agent-spawn-execution-gate.js's
// ClaudeAgentSpawnReservation/v1 and creates runtime/claude-one-shot-binding/v1
// ONLY after confirming the correlation -- a genuinely DIFFERENT ownership
// kind from the role-lifecycle B2/B3/B4 confirmation below (mirrors its
// zero/one/ambiguous discipline closely, but is never merged with it: a
// spawn is never both a persistent role-lifecycle spawn AND a one-shot
// consultation spawn). Runs independently of `scanRoleBindingsForRole`'s own
// `anyExists` gate -- a genuine one-shot claude-agent spawn structurally has
// NO role-binding record at all (the exact M7-RB-NONOWNING case), so it
// must never depend on that gate to fire.
// ─────────────────────────────────────────────────────────────────────────

// CIERRE FINAL correction (2026-08-15), SUBAGENTSTART rules 2/3/4: bounded
// entry cap for the reservation scan -- never an unlimited directory walk.
// Mirrors ROOT_SOURCE_SCAN_CAP's own value/rationale (runtime-role-
// lifecycle.cjs) applied to this file's own reservation registry.
const CLAUDE_AGENT_RESERVATION_SCAN_CAP = 1024;

/**
 * Scans this repo's claude-agent-spawn-reservations registry for every LIVE
 * (execution_state==='ISSUED', not expired) reservation matching `filter`,
 * a predicate over the raw, already-shape/path-revalidated record. Mirrors
 * scanRoleBindingsForRole's own path<->tuple re-validation convention (a
 * candidate's claimed scope must hash back to the exact path it was found
 * at) -- shared by both the role-scoped consumption search below and the
 * session-generation-scoped existence probe HARD NO-GO correction
 * (2026-08-15) added alongside it.
 *
 * CIERRE FINAL correction (2026-08-15): returns {ok,candidates,reason} --
 * this scanner's own directory-read error, individual-record read error,
 * malformed shape/schema, and scan-cap-exceeded ALL become an explicit
 * owning-failure the caller must block on, never silently folded into
 * "zero candidates" (mirrors this same correction's own one-shot-binding
 * and root-source scanner hardening exactly -- an individual leaf-record
 * error must never make a genuinely live reservation disappear from the
 * candidate set).
 * @returns {{ok:true,candidates:Array<object>}|{ok:false,reason:string}}
 */
function findLiveClaudeAgentReservations(projectRoot, filter) {
  const dir = path.join(rll.registryRepoDir(projectRoot), 'claude-agent-spawn-reservations');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, candidates: [] };
    return { ok: false, reason: 'claude-agent-spawn-reservation-scan-failed' };
  }
  if (entries.length > CLAUDE_AGENT_RESERVATION_SCAN_CAP) return { ok: false, reason: 'claude-agent-spawn-reservation-scan-cap-exceeded' };
  const nowMs = Date.now();
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidatePath = path.join(dir, entry.name);
    const rawRead = rll.readRegistryRecord(candidatePath);
    if (!rawRead.ok) return { ok: false, reason: 'claude-agent-spawn-reservation-unreadable' };
    if (rawRead.absent) continue;
    const rec = rawRead.obj;
    if (!rll.hasExactKeys(rec, rll.CLAUDE_AGENT_SPAWN_RESERVATION_KEYS) || rec.schema !== rll.CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA) {
      return { ok: false, reason: 'claude-agent-spawn-reservation-malformed' };
    }
    if (rll.claudeAgentSpawnReservationPathFor(projectRoot, rec.native_spawn_action_id) !== candidatePath) {
      return { ok: false, reason: 'claude-agent-spawn-reservation-path-mismatch' };
    }
    if (!rll.isCanonicalIsoUtc(rec.created_at) || !rll.isCanonicalIsoUtc(rec.expiry)) {
      return { ok: false, reason: 'claude-agent-spawn-reservation-timestamp-invalid' };
    }
    if (rec.execution_state !== 'ISSUED') continue;
    if (Date.parse(rec.expiry) <= nowMs) continue;
    if (!filter(rec)) continue;
    found.push(rec);
  }
  return { ok: true, candidates: found };
}

/**
 * Role-scoped consumption search -- RESTORED (2026-08-15, HARD NO-GO
 * correction) as the sole basis for tryConsumeClaudeAgentOneShotReservation
 * below. Safe again specifically because agent-spawn-execution-gate.js now
 * DENIES minting any owning claude-agent reservation whose tool_input.name
 * diverges from tool_input.subagent_type (see that file's own doc comment,
 * ~line 320) -- a genuinely owning spawn's OBSERVED agent_type therefore
 * always equals the real canonical role at SubagentStart time too (Claude
 * Code reports `name` in `agent_type` only when it diverges from
 * `subagent_type`; when they are equal, as ownership now REQUIRES, it
 * reports that same, canonical value either way). `role` here is always the
 * caller's own observed `agentType`, already confirmed CANONICAL_ROLES-
 * member by the caller before this is reached.
 * @returns {{ok:true,candidates:Array<object>}|{ok:false,reason:string}}
 */
function findLiveClaudeAgentReservationsForRole(projectRoot, role) {
  return findLiveClaudeAgentReservations(projectRoot, (rec) => rec.role === role);
}

/**
 * Generation-scoped EXISTENCE probe only -- never used to consume/correlate
 * a reservation (see findLiveClaudeAgentReservationsForRole above for that).
 * HARD NO-GO correction (2026-08-15), defense in depth: if a SubagentStart's
 * own OBSERVED agent_type is genuinely non-canonical (so it can never be a
 * role-scoped consumption match by construction) AND some live reservation
 * still exists anywhere in this exact spawn's own session generation, that
 * state should never occur in a correctly-operating system -- the mint-time
 * gate (agent-spawn-execution-gate.js) already denies any owning attempt
 * whose name diverges from its subagent_type, so a live reservation sharing
 * this generation was never meant for a custom-named spawn. Reaching this
 * combination anyway (a gate bug, a race, a bypass) is refused rather than
 * silently treated as "no ownership, fall through to ordinary non-owning" --
 * fail closed on the anomaly instead of guessing it is benign.
 * @returns {{ok:true,candidates:Array<object>}|{ok:false,reason:string}}
 */
function findLiveClaudeAgentReservationsForSessionGeneration(projectRoot, sessionGenerationId) {
  return findLiveClaudeAgentReservations(projectRoot, (rec) => rec.session_generation_id === sessionGenerationId);
}

/**
 * Attempts to consume a live claude-agent one-shot reservation for THIS
 * session and, on success, creates the ClaudeOneShotBinding/v1 using the
 * NOW-OBSERVED real `sessionId`/`agentId` (user point 3's own "session_id +
 * agent_id + agent_type" correlation -- captured HERE, at SubagentStart
 * time, the only point they are genuinely available).
 *
 * HARD NO-GO correction (2026-08-15), superseding the 2026-08-15 M7
 * SUBAGENTSTOP CUSTOM-NAME pass earlier the same day: that pass restored
 * ownership for a custom-named spawn by searching reservations scoped to
 * this SubagentStart's own session_generation_id alone -- "the sole live
 * reservation in this generation" -- which a rigorous adversarial review
 * correctly named as NOT proof of ownership: a second, differently-ROLED
 * Agent() call sharing the same generation (this codebase's own normal
 * operating mode encourages dispatching several Agent() calls in one
 * message) could consume a reservation genuinely minted for someone else.
 * RULING: custom-named ownership is withdrawn entirely, not selectively
 * fixed. agent-spawn-execution-gate.js now DENIES minting any owning
 * reservation whose tool_input.name diverges from tool_input.subagent_type,
 * so a genuinely owning spawn's OBSERVED agent_type is now ALWAYS the real
 * canonical role (Claude Code reports the custom name only when it diverges
 * from subagent_type; ownership now requires them to be equal). Consumption
 * is therefore role-scoped again (findLiveClaudeAgentReservationsForRole),
 * exactly like every other ownership family in this file
 * (tryConsumeRootSourceReservation, the role-lifecycle B2/B3/B4 path below)
 * -- never by session-generation "sole survivor" alone. A non-canonical
 * agentType can never own anything: if ANY live reservation nonetheless
 * exists in that spawn's own generation, that is an anomaly the mint-time
 * gate should already have prevented (a bug, a race, a bypass) -- refused
 * explicitly (`unsupported-custom-name-owning`) rather than silently
 * falling through as if nothing were wrong.
 * @returns {{owning:false}|{owning:true,ok:true,binding:object}|{owning:true,ok:false,reason:string}}
 */
function tryConsumeClaudeAgentOneShotReservation(projectRoot, agentType, sessionId, agentId) {
  if (!rll.CANONICAL_ROLES.includes(agentType)) {
    const genResult = rll.peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId });
    if (genResult.ok) {
      const anomalous = findLiveClaudeAgentReservationsForSessionGeneration(projectRoot, genResult.generationId);
      // CIERRE FINAL correction (2026-08-15): a scan ERROR here is treated
      // identically to "anomalous reservation found" -- both are owning
      // failures, never silently downgraded to "no ownership, fall through
      // to non-owning" merely because the anomaly probe itself could not be
      // completed.
      if (!anomalous.ok) return { owning: true, ok: false, reason: anomalous.reason };
      if (anomalous.candidates.length > 0) return { owning: true, ok: false, reason: 'unsupported-custom-name-owning' };
    }
    return { owning: false };
  }
  const role = agentType;
  const scanResult = findLiveClaudeAgentReservationsForRole(projectRoot, role);
  if (!scanResult.ok) return { owning: true, ok: false, reason: scanResult.reason };
  const candidates = scanResult.candidates;
  if (candidates.length === 0) return { owning: false };
  if (candidates.length > 1) return { owning: true, ok: false, reason: 'claude-agent-one-shot-ambiguous' };
  const reservation = candidates[0];
  // M7 FINAL IDENTITY CLOSURE point 1 (2026-08-09), preserved across the
  // HARD NO-GO correction's restoration of role-scoped search: role alone
  // is not this SubagentStart's own session. The reservation was minted
  // under the ORCHESTRATOR's session_generation_id (agent-spawn-execution-
  // gate.js, at PreToolUse(Agent) time, before this child session exists) --
  // consumption still requires THIS event's own observed sessionId to
  // re-derive that SAME generation before the reservation is touched at
  // all, or a SubagentStart arriving under a wrong/foreign session (same
  // role, same worktree/plan, different orchestrator instance) could
  // consume a reservation that was never minted for it.
  const genResult = rll.peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId });
  if (!genResult.ok || genResult.generationId !== reservation.session_generation_id) return { owning: false };

  let waveSlug;
  let planResult;
  let worktreeId;
  try {
    waveSlug = getWaveSlug(projectRoot, { useEnv: false, useAlias: false, gitTimeoutMs: 3000 });
    planResult = rll.discoverPlan(projectRoot);
    worktreeId = rll.computeWorktreeId(projectRoot);
  } catch {
    return { owning: true, ok: false, reason: 'claude-agent-one-shot-scope-unresolvable' };
  }
  if (!waveSlug || !planResult.ok) return { owning: true, ok: false, reason: 'claude-agent-one-shot-scope-unresolvable' };

  const coordRoot = rll.coordinationRootPathFor(projectRoot);
  const repoId = rll.computeRepoId(projectRoot);
  // Re-read the LIVE activation record fresh (never trust the reservation's
  // own cached copy of anything beyond its identity key) -- the same scan
  // agent-spawn-execution-gate.js used at mint time, filtered to the exact
  // native_spawn_action_id this reservation names. Scoped by `role` (the
  // reservation's own, never the observed agentType).
  const liveActivations = rc.findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planResult.planDigest, role);
  const liveMatch = liveActivations.find((c) => c.activation.native_spawn_action_id === reservation.native_spawn_action_id);
  if (!liveMatch) return { owning: true, ok: false, reason: 'claude-agent-one-shot-activation-no-longer-live' };

  const repoDescriptor = { repoId };
  // M7 GREEN correction round 2, R1 (admit-before-consume): a single
  // combined RLL operation replaces the old
  // validateAndConsumeClaudeAgentSpawnReservation-then-createClaudeOneShotBinding
  // sequence -- two independent, already-complete operations that let a
  // durable cut (fence/terminal) land in the gap between them and leave the
  // reservation permanently consumed with no binding ever created. The
  // combined function peek-validates the reservation (never consuming it),
  // then runs the SAME full authority admission pass createClaudeOneShotBinding
  // always ran, and only consumes the reservation as part of that admission's
  // own guarded write, immediately before the binding itself. agent_type and
  // role are ALWAYS the reservation's own canonical role here, never the
  // observed (possibly custom) agentType -- preserves today's universal
  // agent_type===role invariant on every stored binding. The custom name,
  // once used above to reconstruct the digest, is never persisted anywhere.
  let bindingResult;
  try {
    bindingResult = rll.consumeClaudeAgentSpawnReservationAndCreateOneShotBinding(
      repoDescriptor, liveMatch.activation, liveMatch.requestId, role, worktreeId, planResult.planDigest,
      reconstructedToolInputDigest(role, agentType), projectRoot, sessionId, agentId, CLAUDE_ONE_SHOT_BINDING_TTL_SECONDS,
    );
  } catch (e) {
    return { owning: true, ok: false, reason: 'claude-one-shot-binding-creation-threw' };
  }
  if (!bindingResult.ok) return { owning: true, ok: false, reason: 'claude-one-shot-binding-creation-failed:' + bindingResult.reason };
  return { owning: true, ok: true, binding: bindingResult.binding };
}

/**
 * Sixteenth §16b root-source reservation correlation.  This is deliberately
 * separate from both persistent role-spawn and target-only claude-agent
 * binding flows: exactly one live reservation for toolkit-specialist may be
 * consumed by the exact observed session, then produces one ephemeral
 * requester binding.  Malformed/ambiguous/replayed state never falls through
 * into another ownership family.
 */
function tryConsumeRootSourceReservation(projectRoot, agentType, sessionId, agentId) {
  // M67-RS-HARNESS-SUFFIX-IDENTITY-01: a numeric-suffixed observed agent_type
  // is only ever a CANDIDATE for its canonical role -- it gains no authority
  // by string shape alone. Resolved to that canonical role here (reassigning
  // the local, so every use below -- the reservation lookup key AND the
  // resulting durable binding's own agent_type -- is uniformly the resolved
  // canonical value, indistinguishable from the ordinary unsuffixed case)
  // ONLY as the candidate for admission; the full existing admission pass
  // below (admitAndCreateRootSourceBinding) still independently re-validates
  // the reservation/action/session-generation state from scratch. A bare
  // canonical agentType resolves to itself.
  if (!rll.CANONICAL_ROLES.includes(agentType)) {
    const candidate = harnessSuffixCandidateRole(agentType);
    if (candidate === null || !rll.CANONICAL_ROLES.includes(candidate)) return { owning: false };
    agentType = candidate;
  }
  let lookup;
  try {
    lookup = rll.findLiveRootSourceReservationsForRole(projectRoot, agentType);
  } catch {
    return { owning: true, ok: false, reason: 'root-source-reservation-scan-threw' };
  }
  if (!lookup.ok) return { owning: true, ok: false, reason: lookup.reason };
  if (lookup.reservations.length === 0) return { owning: false };
  if (lookup.reservations.length !== 1) return { owning: true, ok: false, reason: 'root-source-reservation-ambiguous' };
  const reservation = lookup.reservations[0];
  // M7 FINAL REMEDIATION Part A, Stage B (admit-before-consume): a single
  // combined RLL operation replaces the old
  // validateAndConsumeRootSourceReservation-then-createRootSourceBinding
  // sequence -- two independent, already-complete operations that let a
  // durable cut (fence/deadline) land in the gap between them and leave the
  // reservation permanently consumed with no binding ever created. The
  // combined function reads and validates the still-ISSUED reservation
  // (never consuming it), then runs the SAME full authority admission pass
  // createRootSourceBinding always ran, and only consumes the reservation
  // as part of that admission's own guarded write, immediately before the
  // binding itself.
  let binding;
  try {
    binding = rll.admitAndCreateRootSourceBinding(projectRoot, reservation.action_id, {
      runtimeSessionKey: sessionId, agentType, agentId,
    });
  } catch {
    return { owning: true, ok: false, reason: 'root-source-binding-creation-threw' };
  }
  if (!binding.ok) return { owning: true, ok: false, reason: binding.reason };
  return { owning: true, ok: true, binding: binding.binding };
}

// ─────────────────────────────────────────────────────────────────────────
// M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 4
// points 1-2): SubagentStop retirement -- "Agent return". Reuses THIS SAME
// hook file (no new hook file), registered ADDITIONALLY under the
// SubagentStop matcher (.claude/settings.json) -- strictly, structurally
// SEPARATE from the SubagentStart correlation/mint flow above: this branch
// is dispatched first, before hook_event_name is ever checked against
// 'SubagentStart', and returns before any SubagentStart-only code runs.
// Claude Code's SubagentStop event provides session_id/agent_id/agent_type
// -- the SAME three fields SubagentStart provides, never transcript/prose
// content, and this file never reads `last_assistant_message` or any other
// prose field as identity (user's own explicit prohibition).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Real SubagentStop enforcement (M7 FINAL IDENTITY CLOSURE, 2026-08-09):
 * the official SubagentStop contract (code.claude.com/docs/en/hooks) is
 * top-level `{decision:"block", reason}` + exit 0 -- genuinely prevents the
 * subagent from stopping (forces it to continue, reason fed back as
 * instruction) -- this is NOT the same shape as a PreToolUse permission
 * decision (which would need to prevent an action from ever starting), but
 * it is real enforcement, never merely diagnostic stderr that a caller could
 * ignore. Fail-closed holds regardless of `stop_hook_active`: this hook never
 * inspects that field, so a retry signal can never bypass a failed/ambiguous/
 * incomplete durable retirement -- retirement is retried, expires under the
 * existing contract, or is repaired externally, never waved through.
 */
function blockStop(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

/**
 * M7 Atomic Revocation Reconciliation (section 6/8.4): one canonical
 * cross-family classifier (runtime-role-lifecycle.cjs's own
 * classifyClaudeAuthorityForIdentity) replaces the two ad-hoc per-family
 * local scans this function used to run directly -- it also closes the
 * gap where the requester family was never scanned by SubagentStop at all
 * (only claude-one-shot and root-source were), so a live RequesterBinding
 * used to produce zero candidates for either scanned family and the stop
 * was a silent no-op. The classifier is by session_id+agent_id ONLY, never
 * agent_type (section 8.4: "a wrong session/agent can only fence its own
 * independently derived identity, never locate or mutate a victim by
 * role" -- agent_type is a claim, not part of actor identity).
 *
 * A canonical owning role, or any current v2 candidate (classifier state
 * ONE) or already-fenced identity (state FENCED) for that exact actor,
 * publishes the identity fence FIRST -- unconditional on whether any
 * binding currently exists (section 8.4 bullet 1). A noncanonical
 * custom-name Agent with no current v2 candidate (state ABSENT) remains
 * the existing non-owning pass-through and writes nothing. Publishing is
 * idempotent no-clobber (runtime-role-lifecycle.cjs's own
 * publishClaudeAuthorityFence): a second stop for the identical actor
 * identity resolves to the SAME immutable fence file, never rewritten.
 *
 * M7 GREEN correction round 2, R6 (resolves GAP-1, disclosed in
 * m7-correction-round-1-final-report-2026-08-18.md section 7): Codex's
 * explicit ruling confirms this fence-before-preflight ordering IS intended
 * -- grounded directly in section 8.4's own text quoted above ("publishes
 * the identity fence first"). The observed `agent_type`-vs-binding-role
 * claim check and the CLAUDE-ID-01 preflight (RED-6/
 * REQUESTER-PREFLIGHT-ZERO-MUTATION) both now run AFTER the fence publish
 * below, not before: once ownership is established (shouldFence true and
 * classification succeeded), the fence is durable no matter what a LATER
 * claim/preflight check finds. RED-6's original "zero mutation" guarantee
 * survives narrowed to what it actually still covers -- a classification
 * FAILURE (ok:false) before ownership is ever established, which still
 * blocks above with zero mutation, including zero fence.
 *
 * Only AFTER the fence (when one is due) is already durable do the
 * agent_type claim check, the CLAUDE-ID-01 preflight, and (only if both
 * pass) the best-effort trace/event cleanup run (section 8.4: "After a
 * durable fence, raw CLAUDE-ID trace/event cleanup may run best-effort").
 * No primary binding is EVER synchronously deleted anywhere in this flow
 * -- section 4/8.5 remove the retirement-artifact writers entirely;
 * authority is cut exclusively via the fence plus the fence/generation/
 * expiry monotonic cuts each family's own validator already applies. A
 * claim-check, preflight, or cleanup failure still blocks the stop (real
 * enforcement, unchanged from the pre-M7 behavior) but can never prevent
 * the fence from having been written, and never converts the durable fence
 * into an allow decision.
 */
function handleSubagentStop(data) {
  const rawAgentType = data && data.agent_type;
  if (rawAgentType === '') { process.exit(0); return; } // main orchestrator
  if (
    typeof rawAgentType !== 'string' || rawAgentType.length === 0
    || typeof data.session_id !== 'string' || data.session_id.length === 0
    || typeof data.agent_id !== 'string' || data.agent_id.length === 0
  ) {
    blockStop('[subagent-start-context-bundle] SubagentStop: missing or malformed session_id/agent_id/agent_type for a subagent stop -- cannot verify identity, refusing to allow the stop.');
    return;
  }
  // agentType may be a genuine custom instance name (the Agent tool's
  // `name` param), never assumed canonical below except via the explicit
  // CANONICAL_ROLES.includes() check that decides fence-unconditionality
  // (section 8.4 bullet 1) -- never a search key into the classifier
  // itself, never compared by string-prefix/substring, never turned into
  // authority on its own.
  const agentType = rawAgentType;
  const sessionId = data.session_id;
  const agentId = data.agent_id;
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let repoDescriptor;
  try {
    repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.exit(0); return; } // genuinely pre-PLAN (a well-defined negative result, never an exception) -- mechanism inapplicable.
  } catch {
    // CIERRE FINAL correction (2026-08-15), SCOPE-ERROR-BLOCKS: a genuine
    // THROW (git/PLAN resolution genuinely failing, as opposed to the
    // well-defined "no PLAN yet" result above) can never be told apart
    // from "a live authority exists in this exact repo but this one call
    // could not confirm it" -- blocks, never a silent exit(0).
    blockStop('[subagent-start-context-bundle] SubagentStop: scope resolution (repo/PLAN) failed -- cannot verify whether a live authority exists, refusing to allow the stop.');
    return;
  }

  // ── READ-ONLY RESOLUTION: the classifier scans every Claude-actor
  // binding family (requester/root-source/one-shot) for this exact
  // session_id+agent_id identity in one bounded pass, ZERO mutation below
  // this point until full validation completes.
  const observedIdentity = {
    schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
    provider: 'claude-hook',
    repo_id: repoDescriptor.repoId,
    runtime_session_key: sessionId,
    agent_id: agentId,
  };
  let classification;
  try {
    classification = rll.classifyClaudeAuthorityForIdentity(repoDescriptor, observedIdentity);
  } catch {
    classification = { ok: false, reason: 'authority-classify-threw' };
  }
  if (!classification.ok) {
    blockStop(`[subagent-start-context-bundle] SubagentStop: authority classification FAILED: ${classification.reason} -- cannot verify whether a live authority exists, refusing to allow the stop.`);
    return;
  }

  // M7 GREEN section 4.9 (R13, M7-SUBAGENTSTOP-PREFLIGHT-BEFORE-SHOULDFENCE):
  // shouldFence is computed IMMEDIATELY after identity classification --
  // section 8.4 bullet 1: a canonical owning role, OR any current v2
  // candidate/already-fenced identity (classification state ONE or FENCED)
  // for that exact actor, is owning; a noncanonical custom-name Agent with
  // NO current v2 candidate (state ABSENT) is the existing non-owning
  // pass-through and must exit HERE, before the agent_type claim check,
  // CLAUDE-ID-01 preflight, or fence below -- none of which may ever run
  // for it. publishClaudeAuthorityFence is idempotent no-clobber, so a
  // repeat stop for the identical actor identity resolves to the SAME
  // immutable fence file, never rewritten.
  const shouldFence = rll.CANONICAL_ROLES.includes(agentType) || classification.state !== 'ABSENT';
  if (!shouldFence) {
    process.exit(0);
    return;
  }

  // ── MUTATION: reached only after full read-only resolution above decided
  // this stop will NOT be blocked at the classification stage, and
  // shouldFence has already confirmed this actor is owning.
  //
  // M7 GREEN correction round 2, R6 (resolves GAP-1): the fence is
  // published FIRST, before the agent_type claim check or the CLAUDE-ID-01
  // preflight -- per section 8.4's own text ("a canonical owning role...
  // publishes the identity fence first"). Once ownership is established,
  // nothing a later claim/preflight check finds may prevent or roll back
  // this fence.
  let fenced;
  try {
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId(repoDescriptor, 'claude-hook', sessionId, agentId);
    fenced = rll.publishClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
  } catch {
    fenced = { ok: false, reason: 'authority-fence-invalid' };
  }
  if (!fenced.ok) {
    blockStop(`[subagent-start-context-bundle] SubagentStop: identity fence publish FAILED: ${fenced.reason} -- refusing to allow the stop.`);
    return;
  }

  // M67-RS-HARNESS-SUFFIX-IDENTITY-01: classification itself remains keyed
  // ONLY by exact session_id+agent_id (unaffected above -- the fence publish
  // never reads agentType at all). Only here, immediately before the
  // observed agent_type is compared as a CLAIM against the durable binding's
  // own role, is a numeric-suffixed claim ever accepted -- and only when the
  // binding is proven root-source (never claude-one-shot/role-lifecycle/
  // requester) AND the safely parsed suffix prefix exactly matches the
  // binding's own role. Once accepted, agentType is normalized to that same
  // canonical role so the unchanged claim check and the fence/preflight path
  // below use it uniformly, exactly like the ordinary unsuffixed case.
  if (
    classification.state === 'ONE' && classification.family === 'root-source'
    && harnessSuffixCandidateRole(agentType) === classification.binding.role
  ) {
    agentType = classification.binding.role;
  }

  // M7 GREEN correction round 2, R6: the observed agent_type is a CLAIM,
  // never a source for locating identity or authority (section 8.4) -- this
  // check runs only AFTER the fence above is already durable. A mismatch
  // still blocks the stop (real enforcement), but the fence already exists.
  if (classification.state === 'ONE' && agentType !== classification.binding.role) {
    blockStop(`[subagent-start-context-bundle] SubagentStop: observed agent_type "${agentType}" does not exactly equal the durable binding's own role "${classification.binding.role}" for this exact session_id/agent_id -- refusing to proceed.`);
    return;
  }

  // M7 GREEN correction round 2, R6 (resolves GAP-1, supersedes the old
  // CIERRE FINAL RED-6/REQUESTER-PREFLIGHT-ZERO-MUTATION blanket reading):
  // read-only preflight of deleteClaudeId01TraceForSession's own mutation
  // phase (trace record + events dir) now runs AFTER the fence above is
  // already durable, never before it. A malformed requester-binding (or an
  // unreadable trace path) still blocks here with zero FURTHER mutation
  // (no trace/event cleanup ever runs), but the fence -- once ownership was
  // established -- is never rolled back or skipped by this later failure.
  // RED-6's original zero-mutation guarantee survives exactly for
  // classification failures before ownership is established (see the
  // `!classification.ok` block above, and
  // COSB-REQUESTER-PREFLIGHT-ZERO-MUTATION-BLOCKS in
  // claude-one-shot-binding-red.bats, which blocks at classification
  // itself and never reaches this point).
  let claudeId01Preflight;
  try {
    claudeId01Preflight = rll.preflightClaudeId01TraceForSession(projectRoot, { sessionId, agentId, agentType });
  } catch {
    claudeId01Preflight = { ok: false, reason: 'claude-id01-preflight-threw' };
  }
  if (!claudeId01Preflight || !claudeId01Preflight.ok) {
    blockStop(`[subagent-start-context-bundle] SubagentStop: CLAUDE-ID-01/requester-binding preflight FAILED: ${(claudeId01Preflight && claudeId01Preflight.reason) || 'unknown'} -- refusing to allow the stop; the identity fence, already durable, is not affected.`);
    return;
  }

  // M7 section 8.4 / defect 10: raw CLAUDE-ID trace/event cleanup runs
  // best-effort, ONLY AFTER the fence is already durable above. No primary
  // binding is EVER synchronously deleted in this flow: section 4/8.5
  // remove the retirement-artifact writers entirely, and authority is cut
  // exclusively via the fence plus each family's own fence/generation/
  // expiry monotonic cuts. A cleanup failure still blocks the stop (real
  // enforcement, unchanged from the pre-M7 behavior) but can never have
  // prevented the fence from already existing, and never converts the
  // durable fence into an allow decision.
  if (rll.deleteClaudeId01TraceForSession) {
    let deleteResult;
    try {
      deleteResult = rll.deleteClaudeId01TraceForSession(projectRoot, { sessionId, agentId, agentType });
    } catch {
      deleteResult = { ok: false, reason: 'claude-id01-delete-threw' };
    }
    if (!deleteResult || !deleteResult.ok) {
      blockStop(`[subagent-start-context-bundle] SubagentStop: CLAUDE-ID-01 trace deletion FAILED: ${(deleteResult && deleteResult.reason) || 'unknown'}`);
      return;
    }
  }

  process.exit(0);
}

function extractWaveSlugFromFrontmatter(content) {
  // Extract wave_slug from YAML frontmatter block between --- markers.
  // Accepts both `wave_slug: "value"` and `wave_slug: value` forms.
  // No /m flag — ^ must anchor to the very start of the file, not any line start.
  // \r?\n tolerates CRLF line endings (Windows checkouts) — without it a CRLF
  // bundle would never match and additionalContext would be silently skipped (CR-R2-A).
  const match = /^---\r?\n[\s\S]*?wave_slug:\s*["']?([^"'\r\n]+)["']?\s*\r?\n[\s\S]*?---/.exec(content);
  if (!match) return null;
  return match[1].trim();
}

// Sequence 35 correction 2 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822):
// ONE deterministic validation+render helper shared by BOTH root-source
// authenticated-dispatch paths -- the newly consumed reservation binding
// (first start) and the canonical classifier's live root-source binding
// (repeat start). Factored out so the two paths can never drift in either
// the correlation checks or the emitted shape. Validates the live PLAN
// path/digest, complete non-empty correlations, and the exact canonical role
// claim (with only the already-supported numeric harness-suffix
// normalization). Any validation failure writes a concise stderr reason and
// exits with NO generic-bundle fallback. Emits/exits on success; returns only
// on the failure path after having already exited, so callers never continue.
function renderRootSourceAuthenticatedDispatchOrExit(projectRoot, agentType, binding, isResume) {
  let planResult;
  try {
    planResult = rll.discoverPlan(projectRoot);
  } catch {
    planResult = { ok: false };
  }
  const planOk = planResult.ok
    && typeof planResult.planPath === 'string' && path.isAbsolute(planResult.planPath)
    && planResult.planPath.startsWith(path.join(projectRoot, '.planning') + path.sep)
    && planResult.planDigest === binding.plan_digest;
  // M67-RS-HARNESS-SUFFIX-IDENTITY-01: exact canonical equality, or a
  // canonical numeric-suffix candidate that resolves to binding.role --
  // never any other prefix/suffix shape, and never on string shape alone.
  const normalizedAgentType = rll.CANONICAL_ROLES.includes(agentType)
    ? agentType
    : (harnessSuffixCandidateRole(agentType) || agentType);
  const correlationOk = typeof binding.action_id === 'string' && binding.action_id.length > 0
    && typeof binding.reporting_architect === 'string' && binding.reporting_architect.length > 0
    && typeof binding.worktree_id === 'string' && binding.worktree_id.length > 0
    && typeof binding.plan_digest === 'string' && binding.plan_digest.length > 0
    && typeof binding.session_generation_id === 'string' && binding.session_generation_id.length > 0
    && typeof binding.subject_bundle_ref === 'string' && binding.subject_bundle_ref.length > 0
    && typeof binding.subject_scope_digest === 'string' && binding.subject_scope_digest.length > 0
    && typeof binding.role === 'string' && binding.role === normalizedAgentType;
  if (!planOk || !correlationOk) {
    process.stderr.write(`[subagent-start-context-bundle] root-source ${isResume ? 'resumed ' : ''}binding for "${agentType}" failed authenticated-dispatch-context validation (plan/correlation mismatch) -- STOP, no additionalContext, no generic-bundle fallback\n`);
    process.exit(0);
    return false;
  }
  const dispatchContext = [
    'AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1',
    `action_id=${binding.action_id}`,
    `role=${binding.role}`,
    `reporting_architect=${binding.reporting_architect}`,
    `worktree_id=${binding.worktree_id}`,
    `plan_digest=${binding.plan_digest}`,
    `session_generation_id=${binding.session_generation_id}`,
    `subject_bundle_ref=${binding.subject_bundle_ref}`,
    `subject_scope_digest=${binding.subject_scope_digest}`,
    `scope_doc_path=${planResult.planPath}`,
    'This block was generated by the host SubagentStart hook from a durably admitted root-source binding (action_id above), independent of any inline prompt text. It authenticates that the accompanying ROOT_SOURCE_BOOTSTRAP/v1 message attached to this exact spawn already passed the PreToolUse root-source reservation gate. It does not authorize arbitrary inline text, arbitrary shell commands, repository edits, or any command outside the existing root-source binding and lifecycle gates -- every lifecycle CLI command in that bootstrap is still independently re-authenticated and rewritten by the existing PreToolUse root-source command gate before it can run.',
  ].join('\n');
  emitSubagentStartAdditionalContext(dispatchContext);
  return true;
}

let input = '';
const t = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);

    // M7 completeness Part C follow-up: SubagentStop is handled FIRST, by a
    // structurally SEPARATE branch (handleSubagentStop), and returns before
    // ANY SubagentStart-only code below ever runs -- the two flows share
    // this file only for registration convenience (user point 1: "no new
    // hook file"), never any control-flow state.
    if (data.hook_event_name === 'SubagentStop') {
      handleSubagentStop(data);
      return;
    }

    // Only fire for SubagentStart events
    if (data.hook_event_name !== 'SubagentStart') process.exit(0);

    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Resume-only CLAUDE-ID-01 observation. Without an exact action id the
    // recorder may continue one already-in-progress exact-identity trace, but
    // can never start a new trace by role/order/elimination.
    if (rll.recordClaudeId01SubagentStartObservation) {
      try {
        rll.recordClaudeId01SubagentStartObservation(projectRoot, {
          sessionId: data.session_id, agentId: data.agent_id, agentType: data.agent_type,
        });
      } catch { /* best-effort -- never fatal to the spawn */ }
    }

    // Only for teammates (non-empty agent_type = peer)
    const agentType = (data.agent_type || '').trim();
    if (!agentType) process.exit(0); // main orchestrator — skip

    // Resolve wave slug from git branch
    const waveSlug = getWaveSlug(projectRoot, {
      useEnv: false,
      useAlias: false,
      gitTimeoutMs: 3000,
    });
    if (!waveSlug) process.exit(0); // no active wave — skip silently

    // Third HOLD, Part B, B2/B3/B4: confirm/consume B1's reservation before
    // ever letting this spawn proceed as a genuine role-lifecycle owner.
    // Gated on session_id being genuinely present -- older/unrelated
    // callers (this hook's own pre-existing SubagentStart payload shape
    // never carried session_id/agent_id at all) are structurally excluded,
    // never touched by this block.
    const sessionId = data.session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      const rootSourceAgentId = data.agent_id;
      const rootSourceResult = (typeof rootSourceAgentId === 'string' && rootSourceAgentId.length > 0)
        ? tryConsumeRootSourceReservation(projectRoot, agentType, sessionId, rootSourceAgentId)
        : { owning: false };
      if (rootSourceResult.owning && !rootSourceResult.ok) {
        process.stderr.write(`[subagent-start-context-bundle] root-source reservation invalid for "${agentType}": ${rootSourceResult.reason} -- STOP, bundle injection skipped\n`);
        process.exit(0);
      }

      // Sequence 35 correction 2 RS-RESUME-ISOLATION fail-closed classifier:
      // when NO live root-source reservation exists (repeat SubagentStart for
      // an already-consumed reservation), resolve the durable authority for
      // this EXACT observed identity via the canonical read-only classifier.
      // Observed identity is built ONLY from repo id plus the exact hook
      // session_id/agent_id -- never prompt text, transcript, bundle content,
      // action history, or the agent_type string alone.
      //
      // Fail-closed contract (audit correction 2): a classifier THROW, an
      // ok:false result, or a FENCED identity all mean root-source ownership
      // cannot be safely excluded -- each exits with a concise stderr reason
      // and NO generic-bundle fallback, rather than silently falling through
      // to generic content. ONE+root-source renders via the shared helper.
      // ONE from another family and ABSENT preserve existing behavior below.
      let resumedRootSourceBinding = null;
      if (!rootSourceResult.owning && typeof rootSourceAgentId === 'string' && rootSourceAgentId.length > 0) {
        // Sequence 36 correction: a computeRepoId THROW is an identity-setup
        // failure, not evidence of absence -- root-source authority cannot be
        // safely excluded without a valid repo descriptor, so this fails
        // closed exactly like a classifier failure. There is no null-descriptor
        // fallthrough: ABSENT / ONE-other-family behavior below is reached only
        // after a valid descriptor AND a successful ok:true classification.
        let repoDescriptor;
        try {
          repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
        } catch {
          process.stderr.write(`[subagent-start-context-bundle] root-source resume classifier FAILED for "${agentType}": repo-descriptor-setup-threw -- STOP, no additionalContext, no generic-bundle fallback\n`);
          process.exit(0);
        }
        let classification;
        try {
          classification = rll.classifyClaudeAuthorityForIdentity(repoDescriptor, {
            schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
            provider: 'claude-hook',
            repo_id: repoDescriptor.repoId,
            runtime_session_key: sessionId,
            agent_id: rootSourceAgentId,
          });
        } catch {
          classification = { ok: false, reason: 'authority-classify-threw' };
        }
        if (!classification || classification.ok !== true) {
          process.stderr.write(`[subagent-start-context-bundle] root-source resume classifier FAILED for "${agentType}": ${(classification && classification.reason) || 'unknown'} -- STOP, no additionalContext, no generic-bundle fallback\n`);
          process.exit(0);
        }
        if (classification.state === 'FENCED') {
          process.stderr.write(`[subagent-start-context-bundle] root-source resume identity is FENCED for "${agentType}" -- STOP, no additionalContext, no generic-bundle fallback\n`);
          process.exit(0);
        }
        if (classification.state === 'ONE' && classification.family === 'root-source') {
          resumedRootSourceBinding = classification.binding;
        }
        // ONE from another family, or ABSENT: fall through unchanged to the
        // one-shot / role-lifecycle / generic-bundle handling below.
      }

      // Sequence 28 RS-CONTEXT repair: a successfully admitted root-source
      // spawn must never fall through to the ordinary generic context-bundle
      // loader (which validates only wave_slug). Authority comes entirely
      // from the durable binding already admitted above (re-validated from
      // scratch against the real registry) -- never from the inline prompt.
      // Both this first-start path and the resume path above go through the
      // SAME shared validation/render helper, which exits on success and
      // fails closed with no generic fallback on any validation failure.
      if (rootSourceResult.owning && rootSourceResult.ok) {
        renderRootSourceAuthenticatedDispatchOrExit(projectRoot, agentType, rootSourceResult.binding, false);
      } else if (resumedRootSourceBinding) {
        renderRootSourceAuthenticatedDispatchOrExit(projectRoot, agentType, resumedRootSourceBinding, true);
      }

      // M7 completeness Part C follow-up: consult the claude-agent one-shot
      // reservation FIRST, independently of scan.anyExists below -- a
      // genuine one-shot spawn structurally has NO role-binding record at
      // all, so it must never depend on that gate. Zero candidates (the
      // case for every ordinary ad-hoc/role-lifecycle spawn) falls straight
      // through, unaffected, to the UNCHANGED role-lifecycle logic below.
      const agentIdForClaudeAgent = data.agent_id;
      const oneShotResult = (typeof agentIdForClaudeAgent === 'string' && agentIdForClaudeAgent.length > 0)
        ? tryConsumeClaudeAgentOneShotReservation(projectRoot, agentType, sessionId, agentIdForClaudeAgent)
        : { owning: false };
      if (oneShotResult.owning) {
        if (!oneShotResult.ok) {
          // Failure/absence/ambiguity => UNAVAILABLE/STOP, never
          // RoleActorBinding (user point 3) -- this hook cannot literally
          // block the already-started spawn, so "STOP" means never
          // completing the trust chain: bundle injection is skipped
          // entirely below, mirroring the role-lifecycle path's own FATAL
          // discipline exactly.
          process.stderr.write(`[subagent-start-context-bundle] claude-agent one-shot reservation invalid for "${agentType}": ${oneShotResult.reason} -- STOP, bundle injection skipped\n`);
          process.exit(0);
        }
        if (rll.recordClaudeId01SubagentStartObservation) {
          try {
            rll.recordClaudeId01SubagentStartObservation(projectRoot, {
              sessionId, agentId: agentIdForClaudeAgent, agentType,
              actionId: oneShotResult.binding.native_spawn_action_id,
            });
          } catch { /* best-effort observation; authority remains unavailable on failure */ }
        }
        // Binding created -- fall through to the pre-existing bundle-
        // injection logic below, unaffected (a one-shot consultation spawn
        // typically has no context-bundles/<role>.md at all; injection is
        // harmless either way since it is itself gated on the bundle's own
        // existence+freshness).
      }

      const scan = scanRoleBindingsForRole(projectRoot, agentType);
      // M7-RB-NONOWNING: no role-binding record exists for this role AT ALL
      // (in ANY state) -- a genuinely ad-hoc, lifecycle-unrelated spawn
      // (every ad-hoc specialist/architect dispatch looks exactly like
      // this). Completely inert: no quarantine, no mutation, falls through
      // to the UNCHANGED bundle-injection logic below. A role-binding that
      // already exists (even already-QUARANTINED, e.g. from an earlier
      // confirmation attempt against this SAME fixture) is NEVER treated
      // this way -- see scanRoleBindingsForRole's own doc comment.
      if (scan.anyExists) {
        const candidates = scan.liveCandidates;
        const agentId = data.agent_id;
        if (typeof agentId !== 'string' || agentId.length === 0) {
          // B3 STOP: an unidentifiable spawn hard-stops the SAME way
          // ABSENT/AMBIGUOUS/MISMATCHED do -- never a silent skip/degrade.
          for (const c of candidates) quarantineCandidate(projectRoot, c, 'role-spawn-reservation-unidentifiable-spawn');
          process.stderr.write(`[subagent-start-context-bundle] role-spawn reservation stop for "${agentType}": unidentifiable spawn (empty agent_id) -- quarantining\n`);
          process.exit(0);
        }
        const withClaim = candidates.filter((c) => hasLiveClaimFile(projectRoot, c.actionId));
        if (withClaim.length === 0) {
          // B3 ABSENT: no live B1 claim exists for this role right now --
          // either genuinely never reserved, or already resolved/
          // quarantined by an earlier confirmation attempt (nothing left
          // to quarantine in that case; the loop below is then a no-op).
          // Either way, the bundle must never be (re-)injected.
          for (const c of candidates) quarantineCandidate(projectRoot, c, 'role-spawn-reservation-absent');
          process.stderr.write(`[subagent-start-context-bundle] role-spawn reservation absent for "${agentType}": no live B1 claim found for any pending role-spawn action -- quarantining\n`);
          process.exit(0);
        }
        if (withClaim.length > 1) {
          // B3 AMBIGUOUS: more than one live candidate (independent session generations).
          for (const c of withClaim) quarantineCandidate(projectRoot, c, 'role-spawn-reservation-ambiguous');
          process.stderr.write(`[subagent-start-context-bundle] role-spawn reservation ambiguous for "${agentType}": ${withClaim.length} live B1 claims found across independent session generations -- quarantining\n`);
          process.exit(0);
        }
        const candidate = withClaim[0];
        let action = null;
        try {
          const actionRead = rll.findActionAcrossRepos(candidate.actionId);
          if (actionRead.ok && !actionRead.absent) action = actionRead.action;
        } catch { /* action stays null -- handled as a validation failure below */ }
        const consumeResult = action
          ? rll.validateAndConsumeRoleSpawnExecutionClaim(projectRoot, action, reconstructedToolInputDigest(agentType, agentType), projectRoot)
          : { ok: false, reason: 'role-spawn-action-unreadable' };
        if (!consumeResult.ok) {
          // B3 MISMATCHED (or any other validation failure): distinguishable
          // reason surfaced verbatim -- e.g.
          // 'role-spawn-execution-claim-session-mismatch' for a scoped-wrong
          // claim, matching this bats file's own "mismatch"/"MISMATCH" check.
          quarantineCandidate(projectRoot, candidate, 'role-spawn-reservation-' + consumeResult.reason);
          process.stderr.write(`[subagent-start-context-bundle] role-spawn reservation invalid for "${agentType}": ${consumeResult.reason} -- quarantining\n`);
          process.exit(0);
        }
        if (rll.recordClaudeId01SubagentStartObservation) {
          try {
            rll.recordClaudeId01SubagentStartObservation(projectRoot, {
              sessionId, agentId, agentType, actionId: action.action_id,
            });
          } catch { /* best-effort observation; authority remains unavailable on failure */ }
        }
        // B2 CONFIRMED -- fall through to the pre-existing bundle-injection
        // logic below, unaffected (M7-RB2-CONFIRM's own regression anchor).
        //
        // M7/WP4 second-pass correction (supersedes the first pass's own
        // best-effort/non-fatal treatment -- the user's HARD NO-GO named it
        // WRONG explicitly: "if the binding doesn't exist, nothing downstream
        // has anything real to authorize against; this should be a hard
        // failure, not a soft one"): create the RoleActorBinding -- the
        // durable tie proving "the role-lifecycle machinery decided a
        // specific actor now legitimately holds this role" -- scoped
        // EXACTLY from the just-confirmed `action` object's own fields
        // (worktree_id/plan_digest/session_generation_id, agentType for
        // role), never re-derived or guessed. Downstream consumers
        // (`ready`, the consultation target grants) resolve this binding by
        // role/worktree/plan scope. A creation failure is now FATAL: this
        // SubagentStart hook cannot literally block the already-started
        // spawn, so "fatal" means never completing the trust chain -- the
        // confirmed candidate is quarantined (mirrors this file's own
        // established B3 ABSENT/AMBIGUOUS/MISMATCHED hard-failure pattern
        // exactly) and bundle injection below is skipped entirely, never a
        // silent "log to stderr but proceed as if nothing happened".
        try {
          const actorBindingResult = rll.createRoleActorBinding(
            projectRoot, agentType, action.worktree_id, action.plan_digest, action.session_generation_id, ROLE_ACTOR_BINDING_TTL_SECONDS
          );
          if (!actorBindingResult.ok) {
            quarantineCandidate(projectRoot, candidate, 'role-actor-binding-creation-failed');
            process.stderr.write(`[subagent-start-context-bundle] role-actor-binding creation failed for "${agentType}": ${actorBindingResult.reason} -- FATAL, quarantining, bundle injection skipped\n`);
            process.exit(0);
          }
        } catch (e) {
          quarantineCandidate(projectRoot, candidate, 'role-actor-binding-creation-threw');
          process.stderr.write(`[subagent-start-context-bundle] role-actor-binding creation threw for "${agentType}": ${(e && e.message) || e} -- FATAL, quarantining, bundle injection skipped\n`);
          process.exit(0);
        }
      }
    }

    // Bundle path: .planning/wave-<slug>/context-bundles/<role>.md
    const bundlePath = path.join(
      projectRoot,
      '.planning',
      `wave-${waveSlug}`,
      'context-bundles',
      `${agentType}.md`
    );

    if (!fs.existsSync(bundlePath)) process.exit(0); // absent — skip silently

    let bundleContent;
    try {
      bundleContent = fs.readFileSync(bundlePath, 'utf8');
    } catch {
      process.exit(0); // unreadable — fail-open
    }

    // Validate wave_slug freshness: bundle frontmatter must match current slug
    const bundleSlug = extractWaveSlugFromFrontmatter(bundleContent);
    if (!bundleSlug || bundleSlug !== waveSlug) {
      // Stale or unmatched bundle — skip silently (do not inject stale context)
      process.stderr.write(
        `[subagent-start-context-bundle] stale bundle for "${agentType}": ` +
        `bundle wave_slug="${bundleSlug}" vs current="${waveSlug}" — skipping\n`
      );
      process.exit(0);
    }

    // Bundle is fresh — emit additionalContext
    emitSubagentStartAdditionalContext(bundleContent);

  } catch {
    // Fail-open on any parse error
    process.exit(0);
  }
});
