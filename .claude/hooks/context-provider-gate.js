#!/usr/bin/env node
// context-provider-gate.js — PreToolUse hook
// Blocks Grep/Glob/Bash-search unless ANY agent has consulted CP this session.
//
// Session-scoped flag: one CP consultation unblocks all peers in that session.
// The harness assigns a new agent_id per tool invocation for peer agents, so
// per-agent flags (old behavior) never matched between PostToolUse (SendMessage)
// and PreToolUse (Bash/Grep). Session-scoped flag restores dev autonomy.
//
// BL-W35-06 fix tag: per-agent arch-response flag for specialists.
// Specialists require per-agent arch-responded flag (written by consulted.js on arch→specialist).
// Non-specialist non-exempt agents use global session flag as before.
//
// Exempt via agent_type prefix match: context-provider, project-manager, team-lead.
//
// Fail open on any error (never block due to script failure).
// Emergency escape:
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-cp-consulted-*.flag"
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-arch-responded-*.flag"
// Or: CLAUDE_CP_GATE_DISABLED=1 (fail-open).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const coordinationArtifact = require('./coordination-artifact.js');
const { getWaveSlug } = require('./hook-control-plane-utils.js');

// M7/WP4 (P0-2, lifecycle-grant injection, below): lazily-tolerant of either
// sibling module failing to load -- a corrupt/missing file must never turn
// this otherwise fail-open hook into a hard failure for every OTHER tool
// call. Every call site checks for both before use.
let runtimeRoleLifecycle = null;
let runtimeConsultationLib = null;
try {
  runtimeRoleLifecycle = require('../../scripts/lib/runtime-role-lifecycle.cjs');
  runtimeConsultationLib = require('../../scripts/lib/runtime-consultation.cjs');
} catch {
  runtimeRoleLifecycle = null;
  runtimeConsultationLib = null;
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ADDITIVE (Wave 2 / ADR-001 portable disk-consult fallback) — non-specialist ONLY. OR'd in
// alongside the existing SendMessage session-flag at both non-specialist enforcement sites
// (never at the specialist arch-responded branches). slug null -> false immediately, no disk
// attempt (never fail open on a missing/unresolvable wave). Fail-closed: hasValidConsult already
// returns false on malformed/stale/wrong-wave/wrong-role/out-of-confinement — this helper adds no
// additional leniency, it only decides WHETHER to ask.
function diskConsultUnblocks(sessionId, toolName) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const slug = getWaveSlug(projectRoot);
  let diskAllowed = false;
  if (slug) {
    // Local try/catch (defense-in-depth, on top of hasValidConsult's own null-slug/invalid
    // fail-closed returns): an unexpected throw here must degrade to session-flag-only
    // behavior, NEVER bubble to the outer handler and fail the WHOLE gate open.
    try {
      diskAllowed = coordinationArtifact.hasValidConsult(
        path.join(projectRoot, '.planning', 'wave-' + slug, 'inbox', 'context-provider'),
        { slug, projectRoot }
      );
    } catch {
      diskAllowed = false;
    }
  }
  if (diskAllowed) {
    process.stderr.write(`[CP-GATE] session=${sessionId} flag_writer=disk-consult wave_slug=${slug} tool=${toolName}\n`);
  }
  return diskAllowed;
}

// ─────────────────────────────────────────────────────────────────────────
// M6 Block C + M7/WP4 dependency closure: post-PLAN accepted-result
// requirement (PLAN.md ~L5465). Post-PLAN specialist/architect branches
// require a CURRENT ACCEPTED coordination/consult-result/v1, correlated to
// the exact reporting architect role/instance/PLAN/subject -- never a
// coarse session-wide "any consultation happened" flag alone. "Post-PLAN"
// is detected ONLY when CLAUDE_PROJECT_DIR is explicitly set (the standard
// hook-runtime project-root signal) AND a PLAN.md genuinely exists for the
// resolved wave -- deliberately NEVER falls back to process.cwd() the way
// diskConsultUnblocks does, so a bare invocation with no explicit project
// root (this file's own pre-existing F1-F14/CR2-* test convention) can
// never accidentally pick up some OTHER live repo/wave's own real PLAN.md
// and spuriously tighten. Legacy pre-PLAN behavior (no PLAN.md resolvable)
// is a pure passthrough -- `legacyAllowed` governs completely unchanged.
// ─────────────────────────────────────────────────────────────────────────

function resolvePostPlanContext() {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || '';
  if (!projectRoot) return null;
  const waveSlug = getWaveSlug(projectRoot);
  if (!waveSlug) return null;
  const planPath = path.join(projectRoot, '.planning', 'wave-' + waveSlug, 'PLAN.md');
  try {
    const bytes = fs.readFileSync(planPath);
    return { projectRoot, waveSlug, planSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } catch {
    return null; // no PLAN.md for the resolved wave -- pre-PLAN.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// M6 Block C + M7/WP4 dependency closure, M7/WP4 correction pass (pre-fix group
// C, dispatch arch-testing-20260810T074058Z): post-PLAN accepted-result
// requirement (PLAN.md ~L101: "Only a current validated accepted-result.json
// counts"). The PRIOR mechanism here (findAcceptedConsultResult, removed)
// scanned for a self-asserted `coordination/consult-result/v1` record -- a
// parallel artifact with zero binding to any genuine consult/v2 transaction
// (forgeable by construction: nothing tied it to a real request/attempt/
// epoch, subject scope, or content/result digest). This replacement instead
// requires the REAL, durable canonical chain: a `transactions/<request_id>/`
// under this exact PLAN's coordination root whose `request.json`
// (consult/v2) is FROM `role` TO `context-provider` for the current PLAN
// digest, whose `results/<attempt_id>.json` (result/v2) genuinely answers
// it, and whose `accepted-result.json` (accepted-result/v1, terminal,
// exclusive-create) durably accepts that exact result -- every schema/
// correlation/digest checked via this repo's own real validators
// (runtimeConsultationLib.classifyDurableRead/sha256File and the
// `runtime-consultation.cjs validate --kind <consult-v2|result-v2>` CLI,
// mirroring coordination-artifact.js's own established
// isV2InboxRefCandidateValid spawnSync-delegation precedent) rather than a
// second, weaker hook-local parser. Each candidate transaction is validated
// independently in its OWN try/catch (mirrors coordination-artifact.js's own
// isConsultFileValid/hasValidConsult split): classifyDurableRead itself
// THROWS on most structural anomalies (wrong owner/mode, symlink, nlink,
// mid-read tamper) -- caught per-candidate here so one malformed/foreign
// transaction can never abort the whole scan (and, symmetrically, can never
// escape to this otherwise fail-open hook's outer catch-all either).
// ─────────────────────────────────────────────────────────────────────────

const RUNTIME_CONSULTATION_CLI_PATH_FOR_VALIDATE = path.resolve(__dirname, '../../scripts/lib/runtime-consultation.cjs');
const ACCEPTED_RESULT_V1_KEYS = Object.freeze([
  'accepted_at', 'accepted_attempt_id', 'accepted_lease_epoch', 'candidate_result_path',
  'request_digest', 'requester_instance_id', 'result_digest', 'routing_policy_digest',
  'schema', 'schema_version',
].sort());
const MAX_ACCEPTED_CONSULTATION_TRANSACTIONS_SCANNED = 1024;

function hasExactAcceptedResultKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj).sort();
  if (keys.length !== ACCEPTED_RESULT_V1_KEYS.length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] !== ACCEPTED_RESULT_V1_KEYS[i]) return false;
  }
  return true;
}

// Byte-identical semantics to coordination-artifact.js's own isOutside --
// that file's own header note documents small security-critical helpers
// with no shared exported home as inline-replicated precedent in this repo.
function isOutsideConfinement(p) {
  return p === '..' || p.startsWith('..' + path.sep) || path.isAbsolute(p);
}

// M7/WP4 correction pass (pre-fix groups A/B, dispatch
// arch-testing-20260810T142647Z), tightened by the M6+M7 requester-authority
// closure (Group E, 2026-08-10): `validate` is itself grant-gated
// (ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND.validate === 'requester' in
// runtime-consultation.cjs, and main() there consumes/validates the grant
// UNCONDITIONALLY before the handler runs) -- every one of THIS hook's own
// internal `validate` subprocess calls therefore needs a genuine,
// freshly-minted one-use requester grant, exactly mirroring how
// tryInjectRequesterGrant (below) mints one for a CALLER's own
// root-init/root-validate/etc. Bash invocation -- the SAME
// createRequesterBinding + mintRoleCommandGrant primitives are reused, never
// reimplemented. Group E: this internal identity is now the REAL invoking
// hook caller's own {session_id, agent_id, agent_type} -- the EARLIER
// synthetic, coordination-root-derived session key and fixed
// 'context-provider'/'context-provider-gate-internal-validate' constants are
// removed. This is deliberately a SEPARATE identity from the
// reporting-architect identity `hasCurrentAcceptedConsultation` correlates
// the accepted-transaction chain against (see that function's own doc
// comment) -- this one only authenticates the internal `validate` CLI
// subprocess call itself.

/**
 * Mints a fresh one-use `requester`-authority role-command-grant/v1 scoped
 * to the `validate` subcommand, for THIS EXACT `--coordination-root --kind
 * --artifact` triple, backed by the REAL invoking hook caller's own
 * `callerIdentity` ({sessionId, agentType, agentId} -- session_id/agent_id
 * never defaulted/substituted; a genuinely missing value fails closed here,
 * never silently swapped for a placeholder). The argv digest is computed the
 * SAME way tryInjectRequesterGrant computes it (sha256 of the canonical JSON
 * of the exact flag array about to be passed, BEFORE --requester-binding is
 * appended) so it matches what validateAndConsumeRoleCommandGrantForCommand
 * recomputes on the consuming side (it strips exactly the
 * --requester-binding <id> pair and re-hashes the remainder). Returns the
 * grant_id to inject, or null on any failure -- the caller
 * (validateViaConsultationCli) must then fail closed, never fall back to an
 * ungranted call.
 */
function mintInternalValidateGrant(coordRootForValidate, projectRoot, ctx, kind, artifactPath, callerIdentity) {
  if (!runtimeRoleLifecycle || !runtimeConsultationLib) return null;
  if (
    !callerIdentity
    || typeof callerIdentity.sessionId !== 'string' || callerIdentity.sessionId.length === 0
    || typeof callerIdentity.agentType !== 'string' || callerIdentity.agentType.length === 0
    || typeof callerIdentity.agentId !== 'string' || callerIdentity.agentId.length === 0
  ) {
    return null;
  }
  let worktreeId;
  try {
    worktreeId = runtimeRoleLifecycle.computeWorktreeId(projectRoot);
  } catch {
    return null;
  }
  if (typeof worktreeId !== 'string' || worktreeId.length === 0) return null;
  const planDigest = ctx && ctx.planSha256;
  if (typeof planDigest !== 'string' || planDigest.length === 0) return null;

  // M6+M7 FINAL AUTHORITY CORRECTION (Group 1): CLAUDE-ID-01 gating was
  // attempted here and REVERTED after empirical proof it regresses
  // GROUPB-CANONICAL-CHAIN-1/PP1 (context-provider-gate.test.js) -- both
  // drive this exact call site with the SAME "zero live hook trace" shape
  // case 9b's own RED test already documents as unsafe to gate (a genuine,
  // durably-accepted consult/v2->result/v2->accepted-result.json chain,
  // correlated via a synthetic architect identity that never produced a
  // real SubagentStart/PreToolUse trace). Gating this site has the identical
  // blast-radius problem team-lead's own dispatch ruled out for gating
  // createRequesterBinding directly, just at smaller scale (2 tests, not 9
  // files) -- reported to team-lead, not silently reverted.
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: callerIdentity.sessionId };

  let bindingResult;
  try {
    bindingResult = runtimeRoleLifecycle.createRequesterBinding(
      projectRoot, identity, callerIdentity.agentId, callerIdentity.agentType, worktreeId, planDigest, REQUESTER_BINDING_TTL_SECONDS
    );
  } catch {
    bindingResult = { ok: false };
  }
  if (!bindingResult.ok) return null;

  const rest = ['--coordination-root', coordRootForValidate, '--kind', kind, '--artifact', artifactPath];
  const argvDigest = runtimeConsultationLib.sha256String(runtimeConsultationLib.canonicalJSONStringify(rest));

  let mintResult;
  try {
    // requestId/attemptId/leaseEpoch: null -- mirrors tryInjectRequesterGrant's
    // own mint for the non-transaction administrative `validate` subcommand.
    mintResult = runtimeRoleLifecycle.mintRoleCommandGrant(
      projectRoot, bindingResult.binding, 'requester', 'validate', argvDigest, null, null, null
    );
  } catch {
    mintResult = { ok: false };
  }
  if (!mintResult.ok) return null;

  return mintResult.grantId;
}

// Delegates schema/correlation validation to the real
// `runtime-consultation.cjs validate --kind <kind> --artifact <path>` CLI --
// mirrors coordination-artifact.js's own isV2InboxRefCandidateValid
// spawnSync delegation exactly (that file has nothing require()-able for
// this purpose either). `ctx` ({projectRoot, waveSlug, planSha256}) is the
// SAME post-PLAN context the caller already resolved -- required here to
// mint the one-use requester grant `validate` now needs. `callerIdentity` is
// the REAL invoking hook caller's own {sessionId, agentType, agentId},
// threaded through to mintInternalValidateGrant.
function validateViaConsultationCli(coordRootForValidate, projectRoot, kind, artifactPath, ctx, callerIdentity) {
  // M7/WP4 correction pass: `validate` is grant-gated -- mint a fresh
  // one-use requester grant for THIS exact call before spawning, exactly as
  // production requires for every other caller of this subcommand. Binding
  // or grant-mint failure fails this validation closed, never a plain
  // passthrough allow.
  const grantId = mintInternalValidateGrant(coordRootForValidate, projectRoot, ctx, kind, artifactPath, callerIdentity);
  if (!grantId) return false;
  let result;
  try {
    result = spawnSync(process.execPath, [
      RUNTIME_CONSULTATION_CLI_PATH_FOR_VALIDATE, 'validate',
      '--coordination-root', coordRootForValidate,
      '--kind', kind,
      '--artifact', artifactPath,
      '--requester-binding', grantId,
    ], { cwd: projectRoot, timeout: 3000, encoding: 'utf8' });
  } catch {
    return false;
  }
  if (!result || result.error || result.status !== 0 || typeof result.stdout !== 'string') return false;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    return false;
  }
  return !!(parsed && parsed.schema === 'coordination/cli-result/v1' && parsed.status === 'SUCCESS');
}

// Validates exactly ONE candidate transaction end to end -- never throws
// (every structural/durability throw from classifyDurableRead is caught
// here), so one malformed/foreign candidate never poisons the caller's
// whole scan.
function isAcceptedConsultationTransactionValid(txnDir, requestId, repoId, expectedProfileDigest, ctx, architectIdentity, coordRootForValidate, callerIdentity) {
  const role = architectIdentity.role;
  try {
    const requestPath = path.join(txnDir, 'request.json');
    const reqClassified = runtimeConsultationLib.classifyDurableRead(requestPath, { parse: true });
    if (reqClassified.state !== runtimeConsultationLib.DURABLE_PRESENT || !reqClassified.obj) return false;
    const reqObj = reqClassified.obj;
    if (
      reqObj.schema !== 'coordination/consult/v2'
      || reqObj.request_id !== requestId
      || reqObj.repo_id !== repoId
      || reqObj.wave_slug !== ctx.waveSlug
      || reqObj.plan_digest !== ctx.planSha256
      || reqObj.target_role !== 'context-provider'
      || reqObj.source_role !== role
      || reqObj.subject_repo_id !== repoId
    ) {
      return false;
    }
    if (expectedProfileDigest && reqObj.target_role_profile_digest !== expectedProfileDigest) return false;
    if (!validateViaConsultationCli(coordRootForValidate, ctx.projectRoot, 'consult-v2', requestPath, ctx, callerIdentity)) return false;

    const acceptedClassified = runtimeConsultationLib.classifyDurableRead(path.join(txnDir, 'accepted-result.json'), { parse: true });
    if (acceptedClassified.state !== runtimeConsultationLib.DURABLE_PRESENT || !acceptedClassified.obj) return false;
    const acceptedObj = acceptedClassified.obj;
    if (
      !hasExactAcceptedResultKeys(acceptedObj)
      || acceptedObj.schema !== 'coordination/accepted-result/v1'
      || acceptedObj.schema_version !== 1
      || typeof acceptedObj.accepted_attempt_id !== 'string' || acceptedObj.accepted_attempt_id.length === 0
    ) {
      return false;
    }
    // M6+M7 requester-authority closure (Group D): the request and
    // accepted-result's own requester_instance_id must agree -- the accepted
    // chain must stay bound to the SAME actor throughout, never silently
    // diverge between when the request was opened and when it was accepted.
    if (
      typeof reqObj.requester_instance_id !== 'string' || reqObj.requester_instance_id.length === 0
      || acceptedObj.requester_instance_id !== reqObj.requester_instance_id
    ) {
      return false;
    }

    // M6+M7 requester-authority closure (Group D, Codex-relayed scope
    // decision): the reporting architect's OWN claimed {role,session,agent}
    // must resolve to EXACTLY ONE live host-private RequesterBinding, and
    // that binding's actor_instance_id must agree with BOTH durable
    // artifacts -- never merely a role match, and never trusted from only
    // one side. Applies UNIFORMLY to both the specialist/flag branch and the
    // architect-self branch (which now carries the REAL hook-observed
    // session_id/agent_id, never a role-only/'self' sentinel -- see the
    // hook's own two selfIdentity/identity construction sites).
    if (typeof architectIdentity.sessionId !== 'string' || architectIdentity.sessionId.length === 0) {
      return false;
    }
    const bindingResolution = resolveArchitectRequesterAuthority(
      ctx.projectRoot, role, architectIdentity.instanceId, reqObj.requester_worktree_id, ctx.planSha256, architectIdentity.sessionId
    );
    if (
      !bindingResolution.ok
      || bindingResolution.binding.actor_instance_id !== reqObj.requester_instance_id
      || bindingResolution.binding.actor_instance_id !== acceptedObj.requester_instance_id
    ) {
      return false;
    }

    // request_digest is RECOMPUTED from the durable request bytes on disk --
    // never trusted as merely claimed by the accepted-result record.
    const requestDigest = runtimeConsultationLib.sha256File(requestPath);
    if (acceptedObj.request_digest !== requestDigest) return false;

    const expectedCandidatePath = path.join('results', acceptedObj.accepted_attempt_id + '.json');
    const candidateRelative = String(acceptedObj.candidate_result_path || '');
    if (isOutsideConfinement(candidateRelative) || candidateRelative !== expectedCandidatePath) return false;
    const resultPath = path.join(txnDir, 'results', acceptedObj.accepted_attempt_id + '.json');

    if (!validateViaConsultationCli(coordRootForValidate, ctx.projectRoot, 'result-v2', resultPath, ctx, callerIdentity)) return false;

    const resultClassified = runtimeConsultationLib.classifyDurableRead(resultPath, { parse: true });
    if (resultClassified.state !== runtimeConsultationLib.DURABLE_PRESENT || !resultClassified.obj) return false;
    const resultObj = resultClassified.obj;
    if (
      resultObj.in_reply_to !== requestId
      || resultObj.from_role !== 'context-provider'
      || resultObj.to_role !== role
      || resultObj.status !== 'ANSWERED'
      || resultObj.attempt_id !== acceptedObj.accepted_attempt_id
      || resultObj.lease_epoch !== acceptedObj.accepted_lease_epoch
    ) {
      return false;
    }

    // result_digest is likewise RECOMPUTED from the durable result bytes on
    // disk -- never trusted as merely claimed.
    const resultDigest = runtimeConsultationLib.sha256File(resultPath);
    return acceptedObj.result_digest === resultDigest;
  } catch {
    return false;
  }
}

/**
 * M7 defect 9: the ONE shared identity-construction + classify call used by
 * every M7 authority resolution in this hook -- replaces every per-family
 * local scanner this file used to maintain with the canonical cross-family
 * classifier (runtime-role-lifecycle.cjs section 6): the fence is checked
 * first, and more than one live candidate across ANY family is reported as
 * ambiguous rather than silently resolved by whichever per-family scanner
 * happened to be asked.
 * @returns {{ok:true,repoId:string,classification:object}|{ok:false,reason:string}}
 */
function classifyM7AuthorityForHookIdentity(projectRoot, sessionId, agentId) {
  if (!runtimeRoleLifecycle) return { ok: false, reason: 'runtime-role-lifecycle-unavailable' };
  if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, reason: 'missing-scope' };
  if (typeof agentId !== 'string' || agentId.length === 0) return { ok: false, reason: 'missing-scope' };
  let repoId;
  let classification;
  try {
    repoId = runtimeRoleLifecycle.computeRepoId(projectRoot);
    const observedIdentity = {
      schema: runtimeRoleLifecycle.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
      provider: 'claude-hook',
      repo_id: repoId,
      runtime_session_key: sessionId,
      agent_id: agentId,
    };
    classification = runtimeRoleLifecycle.classifyClaudeAuthorityForIdentity({ repoId }, observedIdentity);
  } catch {
    return { ok: false, reason: 'authority-classify-threw' };
  }
  if (!classification.ok) return { ok: false, reason: classification.reason };
  return { ok: true, repoId, classification };
}

/**
 * M6+M7 requester-authority closure (Group D, Codex-relayed scope
 * decision), M7 defect 9 (2026-08-17): resolves a claimed {role, agent_id,
 * session_id} to EXACTLY ONE live host-private RequesterBinding for this
 * exact worktree/plan -- via the canonical cross-family classifier (never a
 * local per-family scan): a live candidate in ANY OTHER family, or more than
 * one live candidate for this identity at all, is never silently resolved
 * to this one. Applied uniformly to both post-PLAN identity branches (see
 * this file's own two identity/selfIdentity construction sites -- neither
 * carries a role-only/'self' sentinel any more).
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function resolveArchitectRequesterAuthority(projectRoot, role, agentId, worktreeId, planDigest, sessionKey) {
  if (
    !runtimeRoleLifecycle || typeof worktreeId !== 'string' || worktreeId.length === 0
    || typeof planDigest !== 'string' || planDigest.length === 0
    || typeof agentId !== 'string' || agentId.length === 0
    || typeof role !== 'string' || role.length === 0
    || typeof sessionKey !== 'string' || sessionKey.length === 0
  ) {
    return { ok: false, reason: 'missing-scope' };
  }
  const classified = classifyM7AuthorityForHookIdentity(projectRoot, sessionKey, agentId);
  if (!classified.ok) return { ok: false, reason: 'requester-bindings-registry-malformed' };
  const { classification } = classified;
  if (classification.state !== 'ONE' || classification.family !== 'requester') {
    return { ok: false, reason: 'no-live-binding' };
  }
  const binding = classification.binding;
  if (
    binding.role !== role || binding.worktree_id !== worktreeId || binding.plan_digest !== planDigest
    || binding.runtime !== 'claude-hook' || binding.agent_key !== agentId || binding.runtime_session_key !== sessionKey
  ) {
    return { ok: false, reason: 'no-live-binding' };
  }
  return { ok: true, binding };
}

/**
 * Scans this exact PLAN's coordination root for a CURRENT, genuinely
 * accepted consult/v2 -> result/v2 -> accepted-result.json chain FROM
 * `architectIdentity.role` TO `context-provider`, correlated to the exact
 * actor `architectIdentity` resolves to. Bounded
 * (MAX_ACCEPTED_CONSULTATION_TRANSACTIONS_SCANNED) -- fails closed on
 * overflow rather than scanning unboundedly.
 * @param {{projectRoot:string, waveSlug:string, planSha256:string}} ctx
 * @param {{role:string,instanceId:string}} architectIdentity
 * @returns {boolean}
 */
function hasCurrentAcceptedConsultation(ctx, architectIdentity, callerIdentity) {
  if (!architectIdentity || typeof architectIdentity.role !== 'string' || !architectIdentity.role) return false;
  const role = architectIdentity.role;
  if (!runtimeRoleLifecycle || !runtimeConsultationLib) return false; // mechanism itself unavailable.

  let repoId;
  let expectedProfileDigest;
  const coordRootForValidate = path.join(ctx.projectRoot, '.planning', 'coordination');
  let transactionsDirPath;
  try {
    repoId = runtimeRoleLifecycle.computeRepoId(ctx.projectRoot);
    if (typeof repoId !== 'string' || repoId.length === 0) return false;
    expectedProfileDigest = runtimeRoleLifecycle.roleProfileDigestFor('context-provider');
    transactionsDirPath = path.join(coordRootForValidate, repoId, ctx.waveSlug, ctx.planSha256, 'transactions');
  } catch {
    return false;
  }

  let entries;
  try {
    entries = fs.readdirSync(transactionsDirPath, { withFileTypes: true });
  } catch {
    return false; // no transactions materialized yet -- routine, not an error.
  }

  let scanned = 0;
  for (const entry of entries) {
    scanned += 1;
    if (scanned > MAX_ACCEPTED_CONSULTATION_TRANSACTIONS_SCANNED) return false; // DoS guard.
    if (!entry.isDirectory()) continue;
    const requestId = entry.name;
    const txnDir = path.join(transactionsDirPath, requestId);
    if (isAcceptedConsultationTransactionValid(txnDir, requestId, repoId, expectedProfileDigest, ctx, architectIdentity, coordRootForValidate, callerIdentity)) {
      return true;
    }
  }
  return false;
}

// The architect identity a specialist's arch-response flag JSON payload
// carries: role preferentially from `architect_role` (test-fixture shape),
// falling back to `written_by` (the REAL context-provider-consulted.js flag
// shape, where written_by already IS the sending architect's own
// agent_type); instance from `agent_id`, identical field/semantics in both
// shapes. M6+M7 requester-authority closure (Group D): `sessionId` from
// `session_id` -- both shapes already carry it (context-provider-consulted.js
// stamps the architect's own PostToolUse session_id when it writes the
// flag) -- required alongside role/instanceId so the caller can resolve the
// exact host-private RequesterBinding this identity must correlate against.
function architectIdentityFromFlagMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const role = (typeof meta.architect_role === 'string' && meta.architect_role)
    || (typeof meta.written_by === 'string' && meta.written_by) || null;
  const instanceId = typeof meta.agent_id === 'string' ? meta.agent_id : null;
  const sessionId = typeof meta.session_id === 'string' ? meta.session_id : null;
  if (!role || !instanceId || !sessionId) return null;
  return { role, instanceId, sessionId };
}

// Given the LEGACY mechanism's own allow/deny (`legacyAllowed`), decides
// whether the ADDITIONAL post-PLAN accepted-result requirement is ALSO
// satisfied. `identity` is {role, instanceId} to correlate against, or null
// (no identity available -- fails closed once post-PLAN, since there is
// nothing to correlate). M6+M7 requester-authority closure (Group D/E):
// `callerIdentity` ({sessionId, agentType, agentId}) is a SEPARATE identity
// -- the REAL current hook caller, threaded through only to authenticate
// this call's own internal `validate` CLI subprocess invocations (Group E);
// it is never used for accepted-transaction correlation, which stays scoped
// to `identity` (the reporting architect from the durable flag).
function postPlanGateAllows(legacyAllowed, identity, callerIdentity) {
  if (!legacyAllowed) return false;
  const ctx = resolvePostPlanContext();
  if (!ctx) return true; // pre-PLAN: unchanged legacy passthrough.
  if (!identity) return false;
  return hasCurrentAcceptedConsultation(ctx, identity, callerIdentity);
}

// ─────────────────────────────────────────────────────────────────────────
// M7/WP4 (dispatch arch-testing-20260808T142647Z, P0-2): main-orchestrator
// lifecycle-grant injection (PLAN.md ~L5465: "resolves ... main-orchestrator
// lifecycle grants (bootstrap/normal profiles)"). runtime-role-lifecycle.cjs's
// `--lifecycle-binding` flag can only ever be satisfied by a real, hook-minted
// grant (that file's own ~L1363: "The caller/model can never mint one") -- this
// is the WP4 wiring that mints it, for the main orchestrator (empty agent_type)
// ONLY, the moment it issues a direct Bash invocation of the lifecycle CLI with
// no caller-supplied grant already present.
// ─────────────────────────────────────────────────────────────────────────

// A hook-minted MainOrchestratorBinding lives far longer than any single grant
// (GRANT_TTL_SECONDS===30, hard ceiling) -- sized so it is never the limiting
// factor for a subsequently-minted action's own TTL (bounded by
// min(policy.ready_timeout_seconds, 120, bindingRemainingSeconds)); mirrors
// SESSION_GENERATION_TTL_SECONDS elsewhere in this system.
const MAIN_ORCHESTRATOR_BINDING_TTL_SECONDS = 3600;
const MAX_RUNTIME_SESSION_KEY_BYTES = 512;

// HARD NO-GO correction (item 5): a PRESENT-but-wrong-type session_id/
// agent_type/agent_id (e.g. a JSON object/array/number instead of a string)
// must never crash a later string-only operation (e.g. agentType.startsWith
// below) and fall through to this file's own fail-open outer catch, which
// would silently ALLOW instead of denying. Absence (undefined/null) is NOT
// malformed -- it is the legitimate main-orchestrator/no-agent-id shape this
// file already handles explicitly; only a genuinely wrong-shaped PRESENT
// value is rejected.
function isWellFormedOptionalIdentityField(value) {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_RUNTIME_SESSION_KEY_BYTES;
}

// Official PreToolUse deny contract (code.claude.com/docs/en/hooks): exit 0,
// hookSpecificOutput{hookEventName:'PreToolUse', permissionDecision:'deny',
// permissionDecisionReason} -- never the deprecated top-level decision:'block'
// + exit 2 shape. This is the ONE denial constructor for every PreToolUse
// block this hook emits: the M7/WP4 lifecycle-grant (tryInjectLifecycleGrant)
// and requester-grant (tryInjectRequesterGrant) resolvers return it directly;
// the CP-consult-flag mechanism further down this file (self-template denial,
// pattern-discovery denial, and the final general denial -- the last of these
// also reachable through the post-PLAN postPlanGateAllows() branches) emits
// it via emitDeny() below. There is no second PreToolUse denial shape in this
// file.
function m7DenyResult(reason) {
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

// Direct-emission counterpart to m7DenyResult, for call sites that write to
// stdout/exit inline rather than returning a {exitCode,body} pair to a caller
// (the CP-consult-flag mechanism's own three denial sites).
function emitDeny(reason) {
  const result = m7DenyResult(reason);
  process.stdout.write(JSON.stringify(result.body));
  process.exit(result.exitCode);
}

// PLAN.md ~L576's closed profile->admitted-subcommand table (mirrored here --
// not exported by runtime-role-lifecycle.cjs -- for the narrowest-profile
// choice below; a wrong entry is safe: mintLifecycleCommandGrant independently
// re-validates it and mints nothing on a mismatch).
const LIFECYCLE_BOOTSTRAP_ADMITTED_SUBCOMMANDS = Object.freeze(['probe', 'ensure', 'action-failed', 'wait-ready', 'status']);

// Part A defect A2 (Third HOLD): the canonical, exactly-resolved absolute
// path to THIS repo's own runtime-role-lifecycle.cjs -- matching however
// this hook's own top-of-file require() resolves the real script (~L36).
// Recognition below requires an EXACT match against this path, never a
// basename-only match: a same-basename lookalike script living at any other
// (e.g. attacker-controlled) directory must never be recognized as the
// lifecycle CLI.
const CANONICAL_LIFECYCLE_CLI_PATH = path.resolve(__dirname, '../../scripts/lib/runtime-role-lifecycle.cjs');

/**
 * Recognizes ONLY the canonical `node <canonical-absolute-path> <subcommand>
 * ...` token sequence (PLAN.md ~L598: "one direct Node command for the
 * matching surface"). Returns the index of the recognized script token (so
 * the caller can read `tokens[index+1]` as the subcommand), or -1 for
 * anything else -- a different literal for tokens[0] (compound/piped
 * commands are already rejected before this is ever called), a relative or
 * differently-rooted script path, or a same-basename lookalike elsewhere.
 */
// S16-ROOT-SOURCE-E2E finding: handleRootSource's own bootstrap_message embeds
// its host-derived publish_command with argv[0]=resolvedNodePath() (an exact,
// non-PATH-dependent absolute interpreter path -- decodeRootSourceBootstrapIntentFromAction
// requires exactly this, and bash-cli-spawn-gate.js's own validateSupervisorStartLaunch
// already deep-equals bridge_argv the same way for supervisor-start), never
// the literal string 'node'. A toolkit-specialist executing that command
// VERBATIM (as its bootstrap_message explicitly requires) therefore produces
// a Bash tool_input.command whose argv[0] this hook's own literal-'node'-only
// matcher could never recognize -- the real requester grant would never be
// injected, and the entire root-source flow would dead-end on its very first
// CLI call. Every OTHER existing call site (root-init/publish-blob/etc, all
// constructed by a human or ordinary orchestrator prose, never by a
// bootstrap_message) already uses literal 'node' and remains unaffected.
function isRecognizedNodeToken(token) {
  return token === 'node' || token === runtimeRoleLifecycle.resolvedNodePath();
}

function findLifecycleCliInvocation(tokens) {
  if (tokens.length < 2 || !isRecognizedNodeToken(tokens[0])) return -1;
  const candidate = String(tokens[1]).replace(/\\/g, '/');
  const canonical = CANONICAL_LIFECYCLE_CLI_PATH.replace(/\\/g, '/');
  return candidate === canonical ? 1 : -1;
}

// SUBCOMMAND_SPEC's own per-subcommand `repeatable` contract (runtime-role-
// lifecycle.cjs ~L3050) -- `--role` is repeatable ONLY for `ensure` (multi-
// role ensure); every other subcommand's `--role` is a single scalar. A
// blanket "always array" would silently produce a 1-element array where a
// resolver expects a plain string (caught empirically: status/rotate/notify/
// stop-owned all failed to resolve until this was scoped per-subcommand).
const LIFECYCLE_REPEATABLE_FLAGS = Object.freeze({
  probe: [], ensure: ['--role'], notify: [], status: [], rotate: [],
  'stop-owned': [], 'action-failed': [], 'wait-ready': [],
  'consult-root': [], 'consult-root-status': [],
  'root-source': [], 'root-source-status': [],
});

// Generic `--flag value` linear scan (mirrors runtime-role-lifecycle.cjs's own
// parseSubcommandArgv contract). Returns null on anything malformed (odd flag
// count, a bare non-flag token, a duplicate non-repeatable flag) so the
// caller declines to inject rather than guess.
function extractFlagValues(tokens, repeatableFlags) {
  const values = {};
  let i = 0;
  while (i < tokens.length) {
    const flag = tokens[i];
    if (typeof flag !== 'string' || !flag.startsWith('--')) return null;
    if (i + 1 >= tokens.length) return null;
    const value = tokens[i + 1];
    if (repeatableFlags && repeatableFlags.includes(flag)) {
      if (!values[flag]) values[flag] = [];
      values[flag].push(value);
    } else {
      if (Object.prototype.hasOwnProperty.call(values, flag)) return null;
      values[flag] = value;
    }
    i += 2;
  }
  return values;
}

// Resolves {worktreeId, planDigest} for a `--project-root`-bearing
// subcommand, or null if the path is not absolute, not a real git worktree,
// or has no discoverable single-wave PLAN.md yet (pre-PLAN -- this mechanism
// does not apply, mirrors resolvePostPlanContext's own passthrough precedent
// elsewhere in this file).
function resolveProjectRootScope(projectRoot) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return null;
  let worktreeId;
  try {
    worktreeId = runtimeRoleLifecycle.computeWorktreeId(projectRoot);
  } catch {
    return null;
  }
  if (typeof worktreeId !== 'string' || worktreeId.length === 0) return null;
  const planResult = runtimeRoleLifecycle.discoverPlan(projectRoot);
  if (!planResult.ok) return null;
  return { worktreeId, planDigest: planResult.planDigest };
}

// Per-subcommand scope resolver: {projectRootDescriptor, role, argvDigest,
// actionId, worktreeId, planDigest} or null. Each argvDigest formula is a
// byte-exact mirror of the corresponding handle<Subcommand>'s own
// validateAndConsumeLifecycleCommandGrant call in runtime-role-lifecycle.cjs
// -- a mismatch here is safe (the CLI just rejects the grant with
// IDENTITY_MISMATCH, never a security hole), never authoritative.
const LIFECYCLE_SUBCOMMAND_SCOPE_RESOLVERS = {
  probe(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    if (!rootScope) return null;
    return {
      projectRootDescriptor: values['--project-root'], role: null,
      argvDigest: runtimeConsultationLib.sha256String('probe'), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  ensure(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    if (!rootScope) return null;
    const roles = values['--role'];
    if (!Array.isArray(roles) || roles.length === 0) return null;
    const sortedRoles = roles.slice().sort();
    const role = sortedRoles.length === 1 ? sortedRoles[0] : sortedRoles;
    return {
      projectRootDescriptor: values['--project-root'], role,
      argvDigest: runtimeConsultationLib.sha256String('ensure:' + sortedRoles.join(',')), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  notify(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    if (!rootScope) return null;
    const role = values['--role'];
    const kind = values['--kind'];
    const artifact = values['--artifact'];
    if (typeof role !== 'string' || typeof kind !== 'string' || typeof artifact !== 'string') return null;
    let artifactDigest;
    try {
      artifactDigest = runtimeConsultationLib.sha256File(artifact);
    } catch {
      return null;
    }
    return {
      projectRootDescriptor: values['--project-root'], role,
      argvDigest: runtimeConsultationLib.sha256String('notify:' + role + ':' + kind + ':' + artifactDigest), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  status(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    if (!rootScope) return null;
    const roleValue = values['--role'];
    if (roleValue !== undefined && typeof roleValue !== 'string') return null;
    return {
      projectRootDescriptor: values['--project-root'], role: roleValue === undefined ? null : roleValue,
      argvDigest: runtimeConsultationLib.sha256String('status:' + (roleValue === undefined ? '' : roleValue)), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  rotate(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    if (!rootScope) return null;
    const role = values['--role'];
    if (typeof role !== 'string') return null;
    return {
      projectRootDescriptor: values['--project-root'], role,
      argvDigest: runtimeConsultationLib.sha256String('rotate:' + role), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  'stop-owned'(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    if (!rootScope) return null;
    const role = values['--role'];
    const reason = values['--reason'];
    if (typeof role !== 'string' || typeof reason !== 'string') return null;
    return {
      projectRootDescriptor: values['--project-root'], role,
      argvDigest: runtimeConsultationLib.sha256String('stop-owned:' + role + ':' + reason), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  'action-failed'(values) {
    const actionId = values['--action'];
    const reason = values['--reason'];
    if (typeof actionId !== 'string' || typeof reason !== 'string') return null;
    const found = runtimeRoleLifecycle.findActionAcrossRepos(actionId);
    if (!found.ok || found.absent) return null;
    return {
      projectRootDescriptor: { repoId: found.action.repo_id }, role: found.action.role,
      argvDigest: runtimeConsultationLib.sha256String('action-failed:' + actionId + ':' + reason), actionId,
      worktreeId: found.action.worktree_id, planDigest: found.action.plan_digest,
    };
  },
  'wait-ready'(values) {
    const actionId = values['--action'];
    const timeout = values['--timeout'];
    if (typeof actionId !== 'string' || typeof timeout !== 'string') return null;
    const found = runtimeRoleLifecycle.findActionAcrossRepos(actionId);
    if (!found.ok || found.absent) return null;
    return {
      projectRootDescriptor: { repoId: found.action.repo_id }, role: found.action.role,
      argvDigest: runtimeConsultationLib.sha256String('wait-ready:' + actionId), actionId,
      worktreeId: found.action.worktree_id, planDigest: found.action.plan_digest,
    };
  },
  'consult-root'(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    const encodedIntent = values['--intent'];
    if (!rootScope || typeof encodedIntent !== 'string') return null;
    let intent;
    try {
      intent = runtimeRoleLifecycle.decodeRootConsultIntent(encodedIntent);
    } catch {
      return null;
    }
    if (!intent || !intent.ok || typeof intent.intent?.requester_role !== 'string') return null;
    return {
      projectRootDescriptor: values['--project-root'], role: intent.intent.requester_role,
      argvDigest: runtimeConsultationLib.sha256String('consult-root:' + encodedIntent), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  'consult-root-status'(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    const intentId = values['--intent-id'];
    if (!rootScope || typeof intentId !== 'string') return null;
    let intentResult;
    try {
      intentResult = runtimeRoleLifecycle.readRootConsultIntent(values['--project-root'], intentId);
    } catch {
      return null;
    }
    if (!intentResult || !intentResult.ok || intentResult.absent || typeof intentResult.intent?.requester_role !== 'string') return null;
    return {
      projectRootDescriptor: values['--project-root'], role: intentResult.intent.requester_role,
      argvDigest: runtimeConsultationLib.sha256String('consult-root-status:' + intentId), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  'root-source'(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    const encodedIntent = values['--intent'];
    if (!rootScope || typeof encodedIntent !== 'string') return null;
    let intent;
    try {
      intent = runtimeRoleLifecycle.decodeRootSourceIntent(encodedIntent);
    } catch {
      return null;
    }
    if (!intent || !intent.ok || intent.intent?.source_role !== 'toolkit-specialist') return null;
    return {
      projectRootDescriptor: values['--project-root'], role: 'toolkit-specialist',
      argvDigest: runtimeConsultationLib.sha256String('root-source:' + encodedIntent), actionId: null,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
  'root-source-status'(values) {
    const rootScope = resolveProjectRootScope(values['--project-root']);
    const actionId = values['--action'];
    if (!rootScope || typeof actionId !== 'string') return null;
    let found;
    try {
      found = runtimeRoleLifecycle.findActionAcrossRepos(actionId);
    } catch {
      return null;
    }
    if (!found || !found.ok || found.absent || found.action.kind !== 'root-source-spawn'
      || found.action.runtime !== 'claude-native' || found.action.role !== 'toolkit-specialist'
      || found.action.worktree_id !== rootScope.worktreeId || found.action.plan_digest !== rootScope.planDigest) return null;
    return {
      projectRootDescriptor: values['--project-root'], role: 'toolkit-specialist',
      argvDigest: runtimeConsultationLib.sha256String('root-source-status:' + actionId), actionId,
      worktreeId: rootScope.worktreeId, planDigest: rootScope.planDigest,
    };
  },
};

function isGrantStillLive(projectRootDescriptor, grantId) {
  const rec = runtimeRoleLifecycle.readRegistryRecord(runtimeRoleLifecycle.grantPathFor(projectRootDescriptor, grantId));
  if (!rec.ok || rec.absent || !rec.obj) return false;
  const expiryMs = Date.parse(rec.obj.expiry);
  if (!Number.isFinite(expiryMs) || Date.now() >= expiryMs) return false;
  const consumed = runtimeRoleLifecycle.readRegistryRecord(runtimeRoleLifecycle.grantConsumedMarkerPathFor(projectRootDescriptor, grantId));
  return consumed.ok === true && consumed.absent === true;
}

/**
 * Idempotent mint-or-reuse: a marker keyed by (worktree, plan, subcommand,
 * argvDigest, sessionId) -- Part A defect A3 (Third HOLD) correction: a
 * MainOrchestratorBinding (and any grant derived from it) is scoped to
 * worktree+plan+SESSION together (PLAN.md ~L594) -- two hook invocations for
 * the identical logical request but DIFFERENT session_ids must each get
 * their own genuinely-live grant, never silently share one bound to
 * whichever session minted it first. Caches the most recently minted
 * grant_id so a second call for the SAME logical request FROM THE SAME
 * SESSION reuses it (while still genuinely live) rather than minting a
 * second, simultaneously-live grant for the same scope. Returns the
 * grant_id to inject, or null if minting is impossible (identity/binding/
 * grant mint failure -- caller falls through to the unmodified passthrough).
 */
function resolveOrMintLifecycleGrant(subcommand, scope, sessionId) {
  const cacheKey = runtimeConsultationLib.sha256String(
    ['hook-lifecycle-grant-cache-v1', scope.worktreeId, scope.planDigest, subcommand, scope.argvDigest, sessionId].join(':')
  );
  const cachePath = path.join(
    runtimeRoleLifecycle.registryRepoDir(scope.projectRootDescriptor), 'hook-lifecycle-grant-cache', cacheKey + '.json'
  );

  const cached = runtimeRoleLifecycle.readRegistryRecord(cachePath);
  if (cached.ok && !cached.absent && cached.obj && typeof cached.obj.grant_id === 'string') {
    if (isGrantStillLive(scope.projectRootDescriptor, cached.obj.grant_id)) {
      return cached.obj.grant_id;
    }
  }

  const bindingResult = runtimeRoleLifecycle.getOrCreateMainOrchestratorBindingForSession(
    scope.projectRootDescriptor, sessionId, scope.worktreeId, scope.planDigest, MAIN_ORCHESTRATOR_BINDING_TTL_SECONDS
  );
  if (!bindingResult.ok) return null;

  const profile = LIFECYCLE_BOOTSTRAP_ADMITTED_SUBCOMMANDS.includes(subcommand) ? 'bootstrap' : 'normal';
  const mintResult = runtimeRoleLifecycle.mintLifecycleCommandGrant(
    scope.projectRootDescriptor, bindingResult.binding, scope.argvDigest, scope.role, subcommand,
    'main-orchestrator', 'orchestrator', profile, scope.actionId
  );
  if (!mintResult.ok) return null;

  runtimeRoleLifecycle.writeRegistryRecordReplace(
    cachePath,
    Buffer.from(runtimeConsultationLib.canonicalJSONStringify({ grant_id: mintResult.grantId, cached_at: new Date().toISOString() }), 'utf8')
  );
  return mintResult.grantId;
}

/**
 * Main-orchestrator-only: recognizes a direct Bash invocation of
 * runtime-role-lifecycle.cjs's own frozen CLI (a `runtime-role-lifecycle.cjs
 * <subcommand> ...` token sequence, PLAN.md ~L138-150), mints exactly one real
 * grant, and returns the PreToolUse `hookSpecificOutput.updatedInput` rewrite
 * so the command actually EXECUTED carries it. A caller-supplied
 * `--lifecycle-binding` is never trusted/forwarded -- rejected outright
 * (block). Returns null ONLY for a genuinely NOT-APPLICABLE event (no
 * command, libs unavailable, chaining present, doesn't parse canonically,
 * not the recognized CLI path, or an unrecognized subcommand) -- the caller
 * falls through to the pre-existing unconditional allow for those. M7
 * Correction (§2.B): once the command is RECOGNIZED (canonical CLI path +
 * known subcommand matched), every subsequent failure (missing/invalid
 * session_id, caller-supplied grant flag, malformed argv, scope resolution
 * failure, mint failure) returns an explicit `{exitCode:0,
 * body:{hookSpecificOutput:{hookEventName:'PreToolUse',
 * permissionDecision:'deny',permissionDecisionReason}}}` instead -- never
 * falls back to `null`/plain allow.
 * @returns {null|{exitCode:number, body:object}}
 */
function tryInjectLifecycleGrant(toolInput, sessionId) {
  const command = toolInput && toolInput.command;
  if (typeof command !== 'string' || command.length === 0) return null; // not applicable.
  if (!runtimeRoleLifecycle || !runtimeConsultationLib) return null; // not applicable: mechanism itself unavailable.
  // Only ever touches a single, direct CLI invocation -- a command carrying
  // shell operators (chaining/piping/substitution) is never rewritten, so a
  // naive string-append can never land in the wrong sub-command.
  if (/[;&|`\n]|\$\(/.test(command)) return null; // not applicable.

  // Part A defect A1 (Third HOLD): canonical parser only -- accepts a
  // command ONLY when it round-trips through parsePosixDirect/
  // renderPosixDirect's own closed single-quoted grammar (PLAN.md ~L598-599:
  // "no model reimplements quoting"). A structurally-equivalent but
  // differently-formatted (e.g. unquoted) command is never recognized, even
  // though it would resolve to the identical argv.
  const tokens = runtimeRoleLifecycle.parsePosixDirect(command);
  if (!tokens) return null; // not applicable.
  const cliIdx = findLifecycleCliInvocation(tokens);
  if (cliIdx === -1 || cliIdx + 1 >= tokens.length) return null; // not applicable.
  const subcommand = tokens[cliIdx + 1];
  const resolver = LIFECYCLE_SUBCOMMAND_SCOPE_RESOLVERS[subcommand];
  if (!resolver) return null; // not applicable.

  // ── RECOGNIZED from here on: every path below is an explicit decision. ──

  // M7 Correction (§2.C): session_id validity is checked HERE, after
  // recognition -- never before, and the caller no longer substitutes the
  // literal 'unknown' before calling this function (see the call-site fix
  // below), so a genuinely missing session_id reaches this real check
  // instead of masquerading as the valid-looking string 'unknown'.
  if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
    return m7DenyResult('[M7/WP4] a recognized main-orchestrator role-lifecycle CLI command requires a valid session_id.');
  }

  const rest = tokens.slice(cliIdx + 2);
  if (rest.includes('--lifecycle-binding')) {
    return m7DenyResult('[M7/WP4] a main-orchestrator role-lifecycle CLI command must never carry its own --lifecycle-binding -- only this hook may mint and inject one. Remove the flag and retry.');
  }

  const values = extractFlagValues(rest, LIFECYCLE_REPEATABLE_FLAGS[subcommand]);
  if (!values) {
    return m7DenyResult('[M7/WP4] malformed argv for recognized role-lifecycle CLI subcommand "' + subcommand + '".');
  }

  let scope;
  try {
    scope = resolver(values);
  } catch {
    scope = null;
  }
  if (!scope) {
    return m7DenyResult('[M7/WP4] unable to resolve scope for recognized role-lifecycle CLI subcommand "' + subcommand + '".');
  }

  let grantId;
  try {
    grantId = resolveOrMintLifecycleGrant(subcommand, scope, sessionId);
  } catch {
    grantId = null;
  }
  if (!grantId) {
    return m7DenyResult('[M7/WP4] unable to mint a lifecycle-command-grant for recognized subcommand "' + subcommand + '".');
  }

  // M7 Correction (§2.A): re-render off the already-parsed `tokens` array
  // via the SAME canonical renderer used everywhere else in this hook
  // family -- never string concatenation, which breaks the closed
  // single-quoted grammar the instant the unquoted flag/id is appended.
  const rewritten = runtimeRoleLifecycle.renderPosixDirect(tokens.concat(['--lifecycle-binding', grantId]));

  // Part A defect A4 (Third HOLD): PLAN.md ~L600 -- "Each owning hook
  // returns supported hookSpecificOutput with hookEventName:'PreToolUse',
  // permissionDecision:'allow', and complete updatedInput." updatedInput
  // must be the FULL original tool_input, with only `command` replaced --
  // every other original field (description/timeout/run_in_background/...)
  // is preserved, never dropped.
  return {
    exitCode: 0,
    body: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: Object.assign({}, toolInput, { command: rewritten }),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// M7/WP4 second-pass correction (PLAN.md §15b, ~L592; the user's HARD NO-GO
// verdict, m7-correction-verdict-2026-08-09.md): REQUESTER-side
// role-command-grant/v1 injection. Mints+injects `--requester-binding <id>`
// on a direct Bash invocation of runtime-consultation.cjs's own
// root-init/root-validate admin subcommands (this pass's deliberately
// narrower enforcement scope -- see REQUESTER_ADMIN_SUBCOMMANDS's own
// comment below). UNLIKE tryInjectLifecycleGrant above, this is NOT scoped
// to the main orchestrator: PLAN.md ~L590's RequesterIdentityProvider
// resolves role=agent_type generically for ANY Claude hook context
// (confirmed empirically by this pass's own RCG-ADMIN-NONMAIN/RQ3 tests).
// ─────────────────────────────────────────────────────────────────────────

const CANONICAL_CONSULTATION_CLI_PATH = path.resolve(__dirname, '../../scripts/lib/runtime-consultation.cjs');
const REQUESTER_BINDING_TTL_SECONDS = 3600; // Mirrors MAIN_ORCHESTRATOR_BINDING_TTL_SECONDS's own rationale.

// M7 completeness (2026-08-09): extended to the FULL PLAN.md §15b requester
// matrix -- all 14 requester subcommands. The per-subcommand scope resolver
// concern the first pass flagged turned out unnecessary in practice: every
// one of these 14 carries --coordination-root as its first flag (confirmed
// against runtime-consultation.cjs's own COMMAND_FLAGS table), and this
// function's own argv-digest formula (a generic hash over the raw
// post-subcommand token array) never needed per-subcommand semantic
// understanding beyond that one shared flag. The consume side
// (runtime-consultation.cjs's ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND) is
// extended in the same pass -- see that file's own matching comment.
const REQUESTER_ADMIN_SUBCOMMANDS = Object.freeze([
  'root-init', 'root-validate', 'publish-blob', 'publish-request', 'dispatch',
  'record-delivery', 'takeover', 'await-result', 'accept-result',
  'transaction-ack', 'cancel', 'worker-stop', 'cleanup', 'validate',
]);

/**
 * Recognizes ONLY the canonical `node <canonical-absolute-path>
 * <root-init|root-validate> ...` token sequence for runtime-consultation.cjs
 * -- mirrors findLifecycleCliInvocation exactly (exact resolved-path match,
 * never basename-only).
 */
function findConsultationCliInvocation(tokens) {
  if (tokens.length < 2 || !isRecognizedNodeToken(tokens[0])) return -1;
  const candidate = String(tokens[1]).replace(/\\/g, '/');
  const canonical = CANONICAL_CONSULTATION_CLI_PATH.replace(/\\/g, '/');
  return candidate === canonical ? 1 : -1;
}

// M67-RS-HARNESS-SUFFIX-IDENTITY-01: mirrors agent-spawn-execution-gate.js's
// and subagent-start-context-bundle.js's own harnessSuffixCandidateRole
// helper exactly (duplicated rather than shared -- this is parsing logic
// private to each hook, never a new cross-file interface, per those files'
// own precedent). Parses only the shape ("<role>-<N>", N>=2, canonical
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

/**
 * Requester-authority counterpart to tryInjectLifecycleGrant, mirroring its
 * exact recognized/not-applicable/recognized-but-failed discipline. Returns
 * null ONLY for a genuinely NOT-APPLICABLE event (no command, libs
 * unavailable, chaining present, doesn't parse canonically, not the
 * recognized CLI path, or a subcommand outside REQUESTER_ADMIN_SUBCOMMANDS)
 * -- the caller falls through to whatever else applies for those. Once
 * RECOGNIZED (canonical CLI path + an in-scope admin subcommand), every
 * subsequent failure returns an explicit block, never a fall-through to
 * plain allow.
 * @returns {null|{exitCode:number, body:object}}
 */
function tryInjectRequesterGrant(toolInput, sessionId, agentType, agentId) {
  const command = toolInput && toolInput.command;
  if (typeof command !== 'string' || command.length === 0) return null; // not applicable.
  if (!runtimeRoleLifecycle || !runtimeConsultationLib) return null; // not applicable: mechanism itself unavailable.
  if (/[;&|`\n]|\$\(/.test(command)) return null; // not applicable.

  const tokens = runtimeRoleLifecycle.parsePosixDirect(command);
  if (!tokens) return null; // not applicable.
  const cliIdx = findConsultationCliInvocation(tokens);
  if (cliIdx === -1 || cliIdx + 1 >= tokens.length) return null; // not applicable.
  const subcommand = tokens[cliIdx + 1];
  if (!REQUESTER_ADMIN_SUBCOMMANDS.includes(subcommand)) return null; // not applicable.

  // ── RECOGNIZED from here on: every path below is an explicit decision. ──

  if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
    return m7DenyResult('[M7/WP4] a recognized runtime-consultation admin command requires a valid session_id.');
  }

  const rest = tokens.slice(cliIdx + 2);
  if (rest.includes('--requester-binding') || rest.includes('--target-binding') || rest.includes('--lifecycle-binding')) {
    return m7DenyResult('[M7/WP4] a runtime-consultation admin command must never carry its own grant-binding flag -- only this hook may mint and inject one. Remove the flag and retry.');
  }

  // M7 completeness (2026-08-09): CLAUDE-ID-01 (PLAN.md ~L588) gates Claude's
  // persistent native-hook requester-binding creation. The main orchestrator
  // NEVER receives a SubagentStart event about itself -- PLAN.md ~L594
  // independently defines MainOrchestratorBinding/v1's own derivation as
  // requiring "a non-empty session_id, the pinned main-context agent_type==''
  // predicate, AND NO CORRELATED PENDING SubagentStart", treating "no
  // SubagentStart" as main-orchestrator's own defining characteristic
  // elsewhere in PLAN's own text. CLAUDE-ID-01's own correlation trace
  // REQUIRES a SubagentStart among its 4 event types (SubagentStart, two
  // PreToolUse, a sleep/wake boundary, a final PreToolUse), so an entity that
  // structurally never receives one can never produce a complete trace --
  // persistent native per-instance gating (and therefore requester-binding
  // minting) is UNAVAILABLE for main-orchestrator BY CONSTRUCTION, not merely
  // unproven in any single run; this is not a per-call probe result to
  // evaluate, it is a structural exclusion applied uniformly with how PLAN
  // already treats main-orchestrator elsewhere. Named roles (non-empty
  // agent_type) DO receive a real SubagentStart when spawned and are
  // unaffected -- role resolution below no longer has a null/main-orchestrator
  // case to handle.
  if (typeof agentType !== 'string' || agentType.length === 0) {
    return m7DenyResult('[M7/WP4] the main orchestrator can never satisfy CLAUDE-ID-01 (no SubagentStart is ever observed for it) -- requester-binding minting is unavailable by construction for this caller.');
  }

  const values = extractFlagValues(rest, []);
  if (!values || typeof values['--coordination-root'] !== 'string') {
    return m7DenyResult('[M7/WP4] malformed argv for recognized runtime-consultation admin subcommand "' + subcommand + '".');
  }

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let worktreeId;
  let planResult;
  try {
    worktreeId = runtimeRoleLifecycle.computeWorktreeId(projectRoot);
    planResult = runtimeRoleLifecycle.discoverPlan(projectRoot);
  } catch {
    return m7DenyResult('[M7/WP4] unable to resolve project scope for recognized subcommand "' + subcommand + '".');
  }
  if (!planResult.ok) {
    return m7DenyResult('[M7/WP4] no discoverable PLAN for recognized subcommand "' + subcommand + '".');
  }

  // PLAN.md ~L590: role=agent_type generically. The main-orchestrator/null
  // case is unreachable here now -- excluded above by the CLAUDE-ID-01 check
  // (M7 completeness) -- so `agentType` is always a genuine non-empty
  // canonical role by this point.
  const role = agentType;
  const argvDigest = runtimeConsultationLib.sha256String(runtimeConsultationLib.canonicalJSONStringify(rest));

  // M6+M7 requester-authority closure (Group B): the ONE shared scope
  // resolver -- mirrors exactly what runtime-consultation.cjs's own main()
  // independently re-derives before consuming this grant. `values` carries
  // dash-prefixed keys (extractFlagValues's own convention); resolveRequesterGrantScope
  // expects the SAME bare-flag-name shape parseFlags() produces.
  // S16-RSB-RETIRED-NO-LATER-GRANT-01: computed here but no longer gated
  // here -- a caller whose identity resolves to a KNOWN root-source binding
  // (below) must be denied on THAT binding's own specific state (retired/
  // ambiguous) rather than falling through to this generic scope-resolution
  // error, which is silent about the actual, more authoritative reason (a
  // retired binding backs every subcommand, valid --request or not). The
  // ok-check is applied at each point below that actually consumes
  // scopeResult's fields, so "scopeResult is always ok by the time it is
  // read" is unchanged for every caller with no root-source identity.
  const scopeResult = runtimeConsultationLib.resolveRequesterGrantScope(subcommand, {
    'coordination-root': values['--coordination-root'],
    request: values['--request'],
    kind: values['--kind'],
  });

  // Sixteenth §16b: the ephemeral root-source requester binding is a third,
  // disjoint backing authority.  Resolve it from the exact hook-observed
  // session/agent/type tuple before the persistent CLAUDE-ID-01 path.  This
  // is never selection by role or by absence: malformed/expired/retired/
  // ambiguous root-source state is an explicit deny, and a simultaneously
  // live persistent RequesterBinding is an authority-union ambiguity.
  // M7 defect 9: resolved via the canonical cross-family classifier (never
  // a removed local per-family scanner) -- a live
  // candidate for this identity in ANY other family, or an ambiguous/fenced
  // classification, is never silently treated as "no root-source binding";
  // only a genuine absence of a root-source candidate (or a scope mismatch
  // on the one found) falls through to the stable-requester path below.
  let rootSourceResolution;
  {
    const classified = classifyM7AuthorityForHookIdentity(projectRoot, sessionId, typeof agentId === 'string' ? agentId : '');
    if (!classified.ok) {
      rootSourceResolution = { ok: false, reason: classified.reason };
    } else if (classified.classification.state === 'FENCED') {
      // M7 section 5 point 4: a durably-fenced identity is denied outright,
      // cut-first -- never treated as "absent" (which would wrongly fall
      // through to attempt the stable-requester path instead).
      rootSourceResolution = { ok: false, reason: 'authority-fenced' };
    } else if (classified.classification.state === 'ONE' && classified.classification.family === 'root-source') {
      const rsBinding = classified.classification.binding;
      // M67-RS-HARNESS-SUFFIX-IDENTITY-01: `role` here is the RAW,
      // harness-observed agent_type -- Claude Code's own name-collision
      // avoidance appends "-<N>" (N>=2) whenever the plain canonical name is
      // already taken by another live agent in this session. `rsBinding.role`
      // is always CANONICAL, because subagent-start-context-bundle.js's own
      // tryConsumeRootSourceReservation already normalizes the observed
      // agent_type before ever creating this binding. A suffixed `role` is
      // therefore accepted as a match ONLY when it is a harness-suffix
      // candidate for THIS EXACT already-resolved binding's own canonical
      // role -- never merely CANONICAL_ROLES-shaped (unlike the sibling
      // hook's reservation-consumption check, there is no separate admission
      // pass here to re-validate a same-shaped-but-wrong-role guess against).
      const rootSourceRoleMatches = rsBinding.role === role || harnessSuffixCandidateRole(role) === rsBinding.role;
      if (!rootSourceRoleMatches || rsBinding.worktree_id !== worktreeId || rsBinding.plan_digest !== planResult.planDigest) {
        rootSourceResolution = { ok: false, reason: 'root-source-binding-absent' };
      } else {
        rootSourceResolution = { ok: true, binding: rsBinding };
      }
    } else {
      rootSourceResolution = { ok: false, reason: 'root-source-binding-absent' };
    }
  }
  if (rootSourceResolution.ok) {
    // M67-RS-HARNESS-SUFFIX-IDENTITY-01: use the BINDING's own canonical
    // role (never the raw, possibly-suffixed `role`) so this ambiguity check
    // keeps working correctly for a legitimately-suffixed match.
    const persistent = resolveArchitectRequesterAuthority(
      projectRoot, rootSourceResolution.binding.role, typeof agentId === 'string' ? agentId : '', worktreeId,
      planResult.planDigest, sessionId,
    );
    if (persistent.ok || !['no-live-binding', 'no-bindings-registry'].includes(persistent.reason)) {
      return m7DenyResult('[Sixteenth/root-source] requester authority is ambiguous with a persistent RequesterBinding; refusing to choose by priority.');
    }
    if (!scopeResult.ok) {
      return m7DenyResult('[M7/WP4] unable to resolve requester grant scope for recognized subcommand "' + subcommand + '": ' + scopeResult.reason);
    }
    let rootMint;
    try {
      rootMint = runtimeRoleLifecycle.mintRoleCommandGrant(
        projectRoot, rootSourceResolution.binding, 'requester', subcommand, argvDigest,
        scopeResult.requestId, scopeResult.attemptId, scopeResult.leaseEpoch,
      );
    } catch {
      rootMint = { ok: false, reason: 'root-source-grant-mint-threw' };
    }
    if (!rootMint.ok) {
      return m7DenyResult('[Sixteenth/root-source] unable to mint the exact phase-scoped requester grant: ' + (rootMint.reason || 'unknown'));
    }
    const rootRewritten = runtimeRoleLifecycle.renderPosixDirect(tokens.concat(['--requester-binding', rootMint.grantId]));
    return {
      exitCode: 0,
      body: { hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'allow',
        updatedInput: Object.assign({}, toolInput, { command: rootRewritten }),
      } },
    };
  }
  if (rootSourceResolution.reason !== 'root-source-binding-absent') {
    return m7DenyResult('[Sixteenth/root-source] requester binding is unavailable: ' + rootSourceResolution.reason);
  }
  if (!scopeResult.ok) {
    return m7DenyResult('[M7/WP4] unable to resolve requester grant scope for recognized subcommand "' + subcommand + '": ' + scopeResult.reason);
  }

  // M6+M7 FINAL AUTHORITY CORRECTION (Group 1): CLAUDE-ID-01 full
  // bounded-proof gate -- consult the real, currently-observed attestation
  // for this exact {session,worktree,plan,role} tuple BEFORE ever minting a
  // requester binding. Absent/incomplete proof is UNAVAILABLE -- never call
  // createRequesterBinding at all.
  const claudeId01Result = runtimeRoleLifecycle.checkClaudeId01ProofComplete(
    projectRoot, sessionId, worktreeId, planResult.planDigest, role, typeof agentId === 'string' ? agentId : ''
  );
  if (!claudeId01Result.ok) {
    return m7DenyResult('[CLAUDE-ID-01] persistent native-hook requester-binding minting is UNAVAILABLE for role "' + role + '": ' + claudeId01Result.reason);
  }

  let bindingResult;
  try {
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    bindingResult = runtimeRoleLifecycle.createRequesterBinding(
      projectRoot, identity, typeof agentId === 'string' ? agentId : '', role, worktreeId, planResult.planDigest, REQUESTER_BINDING_TTL_SECONDS
    );
  } catch {
    bindingResult = { ok: false };
  }
  if (!bindingResult.ok) {
    return m7DenyResult('[M7/WP4] unable to mint a requester binding for recognized subcommand "' + subcommand + '".');
  }

  let mintResult;
  try {
    // M6+M7 requester-authority closure (Group B): requestId/attemptId/
    // leaseEpoch now come from the shared scope resolver above -- null only
    // for the non-transaction administrative subcommands and a
    // session-shutdown worker-stop (PLAN.md ~L592); every transactional
    // subcommand binds the exact request and its current authoritative
    // attempt/epoch.
    mintResult = runtimeRoleLifecycle.mintRoleCommandGrant(
      projectRoot, bindingResult.binding, 'requester', subcommand, argvDigest,
      scopeResult.requestId, scopeResult.attemptId, scopeResult.leaseEpoch
    );
  } catch {
    mintResult = { ok: false };
  }
  if (!mintResult.ok) {
    return m7DenyResult('[M7/WP4] unable to mint a role-command-grant for recognized subcommand "' + subcommand + '".');
  }

  const rewritten = runtimeRoleLifecycle.renderPosixDirect(tokens.concat(['--requester-binding', mintResult.grantId]));
  return {
    exitCode: 0,
    body: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: Object.assign({}, toolInput, { command: rewritten }),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// M6-CODEX-SUPERVISOR-ACTIVATION-CLOSURE, GROUP A: this hook is the SOLE
// owning input modifier for the top-level supervisor-start Bash form
// (PLAN.md ~L195, ~L580). Recognizes a genuine, canonical `runtime-bridge-
// codex.cjs session-run` bridge_command issued by the main orchestrator,
// deep-compares it against a real, current, unconsumed supervisor-start
// action's own bridge_argv, and -- through ONE host-private production core
// entrypoint (mintSupervisorExecutionClaimForSession, runtime-role-
// lifecycle.cjs; no CLI surface, no caller-selected binding id, no fake
// capability) -- atomically issues the SupervisorExecutionClaim/v1 exactly
// once, then forces run_in_background:true on the ORIGINAL, byte-identical
// command (never rewriting `command` itself, unlike the two injectors
// above). Mirrors tryInjectLifecycleGrant/tryInjectRequesterGrant's own
// established recognized/not-applicable/recognized-but-failed discipline,
// but recognition here is marker+lookup+deep-equal driven (mirrors bash-
// cli-spawn-gate.js's own validateSupervisorStartLaunch), never a fixed-path
// token comparison -- runtime-bridge-codex.cjs is never a single frozen CLI
// subcommand family the way runtime-role-lifecycle.cjs/runtime-consultation.
// cjs are. Deliberately never gated on run_in_background already being true
// (unlike bash-cli-spawn-gate.js's own separate launch-authorization
// concern, which never sees `updatedInput` from this hook -- PreToolUse
// hooks run in parallel) -- this hook is the one that SETS it. Never
// invoked for a subagent/peer (see the call site inside `agentType === ''`
// below) -- a subagent presenting the exact canonical bridge_command gets
// pure passthrough, identical to today's not-yet-implemented passthrough.
// ─────────────────────────────────────────────────────────────────────────

// URGENT FIX (2026-08-12, team-lead-blocking false positive, root-caused by
// arch-platform): the ORIGINAL marker (`/runtime-bridge-codex\.cjs|session-run/`)
// was a bare substring search anywhere in the raw command -- an ORDINARY
// command that merely mentions the filename as a path argument (e.g. `ls -la
// scripts/lib/runtime-bridge-codex.cjs`, `cat ...`, `git diff -- ...`) was
// wrongly RECOGNIZED (and therefore explicit-denied, per this function's own
// "once recognized, every failure is a deny" discipline). Anchored to the
// START of the (trimmed) string instead: an optional quote, a token
// containing "node" (handles both the literal `node` and a resolved
// absolute node path), optional quote, whitespace, optional quote, a token
// containing the script filename, optional quote, then whitespace-or-end.
// This is a STRUCTURAL prefix check (does this command's own first two
// tokens look like the start of a bridge invocation), never a superficial
// "exclude ls/cat specifically" patch -- that would only move the
// false-positive surface to the next unrelated command mentioning the
// filename. Deliberately still a raw regex over the UNPARSED string (never
// gated on a successful parsePosixDirect) -- CPG-SUPERVISOR-CHAINED/REDIRECT
// still need to be RECOGNIZED (and therefore explicit-denied) even though
// their own trailing `; rm -rf ...`/`> /tmp/out` makes parsePosixDirect fail;
// this anchored prefix check is satisfied regardless of what follows the
// first two tokens. The optional quotes also still match the UNQUOTED/
// space-joined form CPG-SUPERVISOR-NONCANONICAL constructs (no quotes at
// all), which a quote-mandatory pattern would have wrongly missed.
// Empirically verified (2026-08-12) against: the real canonical
// bridge_command, +extraflag, +chained (;), +redirect (>), and the unquoted
// NONCANONICAL rendering (all correctly match/recognized), plus `ls -la`,
// `cat`, `git diff --`, `wc -l`, and `node -c` against the same filename
// (all correctly do NOT match).
const SUPERVISOR_BRIDGE_MARKER_RE = /^'?[^'\s]*\bnode\b[^'\s]*'?\s+'?[^'\s]*runtime-bridge-codex\.cjs[^'\s]*'?(\s|$)/;

/**
 * Simple `--flag value` lookup over an already-parsed argv array -- mirrors
 * bash-cli-spawn-gate.js's own `extractFlagValue`, never this file's own
 * `extractFlagValues`/`LIFECYCLE_SUBCOMMAND_SCOPE_RESOLVERS` machinery
 * (that is for the fixed-path-recognized lifecycle/consultation CLI family
 * this bridge surface is deliberately NOT part of).
 */
function extractSupervisorFlagValue(tokens, flag) {
  const idx = tokens.indexOf(flag);
  if (idx === -1 || idx + 1 >= tokens.length) return null;
  return tokens[idx + 1];
}

function supervisorArgvArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Recognizes a Bash command referencing the sanctioned supervisor-
 * start bridge surface, validates it end to end against a real, current,
 * unconsumed action, and mints exactly one SupervisorExecutionClaim/v1 only
 * for the main orchestrator. A named subagent attempting the same recognized
 * surface is explicitly denied; it never falls through to the ordinary
 * context-provider exemptions.
 * Returns null ONLY for a genuinely NOT-APPLICABLE event (no command, libs
 * unavailable, or the marker never matches the raw trimmed command at all)
 * -- the caller falls through to whatever else applies for those. Once
 * RECOGNIZED (the marker matched), every subsequent failure -- invalid
 * session_id, parse failure, absent/wrong-kind/expired action, argv
 * mismatch, non-canonical round-trip, mint failure -- returns an explicit
 * block, never a fall-through to plain allow.
 * @returns {null|{exitCode:number, body:object}}
 */
function tryInjectSupervisorExecutionClaim(toolInput, sessionId, agentType) {
  const command = toolInput && toolInput.command;
  if (typeof command !== 'string' || command.length === 0) return null; // not applicable.
  if (!runtimeRoleLifecycle || !runtimeConsultationLib) return null; // not applicable: mechanism itself unavailable.
  const trimmed = command.trim();
  if (!SUPERVISOR_BRIDGE_MARKER_RE.test(trimmed)) return null; // not applicable.

  // ── RECOGNIZED from here on: every path below is an explicit decision. ──

  if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
    return m7DenyResult('[M6/GROUP-A] a recognized supervisor-start bridge command requires a valid session_id.');
  }
  if (agentType !== '') {
    return m7DenyResult('[M6/GROUP-A] only the main orchestrator may execute a recognized supervisor-start bridge command.');
  }

  // Part A defect A1 (Third HOLD) precedent, applied here too: canonical
  // parser only -- accepts a command ONLY when it round-trips through
  // parsePosixDirect/renderPosixDirect's own closed single-quoted grammar.
  // A chained/redirected command still matches the marker above (a raw
  // substring test, unaffected by shell metacharacters) -- it is already
  // RECOGNIZED before this parse ever runs, so a parse failure here is an
  // explicit deny, never a `return null` passthrough.
  const tokens = runtimeRoleLifecycle.parsePosixDirect(trimmed);
  if (!tokens) {
    return m7DenyResult('[M6/GROUP-A] command is not the canonical renderPosixDirect(bridge_argv) form -- no assignments, pipes, redirects, substitutions, heredocs, metacharacter variants, or alternate quoting are ever legal here.');
  }

  const actionId = extractSupervisorFlagValue(tokens, '--action');
  if (!actionId) {
    return m7DenyResult('[M6/GROUP-A] no --action <id> found in the parsed argv.');
  }

  let found;
  try {
    found = runtimeRoleLifecycle.findActionAcrossRepos(actionId);
  } catch {
    return m7DenyResult('[M6/GROUP-A] action lookup failed.');
  }
  if (!found.ok || found.absent) {
    return m7DenyResult('[M6/GROUP-A] no current lifecycle action matches this --action id.');
  }
  const action = found.action;
  if (action.kind !== 'supervisor-start' || action.role !== null) {
    return m7DenyResult('[M6/GROUP-A] the referenced action is not a supervisor-start action.');
  }
  if (Date.now() >= Date.parse(action.expires_at)) {
    return m7DenyResult('[M6/GROUP-A] the referenced supervisor-start action has expired.');
  }

  // Two-step: deep-equal (catches an extra/missing/reordered flag) THEN a
  // canonical re-render round-trip against the trimmed original (catches a
  // structurally-equivalent-but-differently-formatted, e.g. unquoted,
  // variant) -- two independent failure modes, mirrors bash-cli-spawn-
  // gate.js's own validateSupervisorStartLaunch exactly.
  const expectedArgv = action.payload && action.payload.bridge_argv;
  if (!supervisorArgvArraysEqual(tokens, expectedArgv)) {
    return m7DenyResult('[M6/GROUP-A] parsed argv does not deep-equal the minted action\'s own bridge_argv.');
  }
  let rerendered;
  try {
    rerendered = runtimeRoleLifecycle.renderPosixDirect(tokens);
  } catch {
    return m7DenyResult('[M6/GROUP-A] argv failed to re-render canonically.');
  }
  if (rerendered !== trimmed) {
    return m7DenyResult('[M6/GROUP-A] command does not round-trip through renderPosixDirect(parsePosixDirect(command)).');
  }

  // Through ONE host-private production core entrypoint -- no CLI surface,
  // no caller-selected binding id, no fake capability. Resolves its own
  // MainOrchestratorBinding from the CURRENT session/environment; a tampered
  // action.plan_digest/worktree_id/session_generation_id is rejected by that
  // entrypoint's own cross-check against the CURRENT environment, never a
  // separate check duplicated here.
  const repoDescriptor = { repoId: action.repo_id };
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let mintResult;
  try {
    mintResult = runtimeRoleLifecycle.mintSupervisorExecutionClaimForSession(repoDescriptor, action, projectRoot, sessionId);
  } catch {
    mintResult = { ok: false };
  }
  if (!mintResult.ok) {
    return m7DenyResult('[M6/GROUP-A] unable to mint a SupervisorExecutionClaim for this action: ' + ((mintResult && mintResult.reason) || 'unknown'));
  }

  // The bridge_command string itself needs no textual rewrite (M6A-POSITIVE-1
  // asserts updatedInput.command equals the original verbatim) -- only
  // run_in_background is overridden, unlike the two injectors above.
  return {
    exitCode: 0,
    body: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: Object.assign({}, toolInput, { run_in_background: true }),
      },
    },
  };
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    if (process.env.CLAUDE_CP_GATE_DISABLED === '1') process.exit(0);

    // M6+M7 RESIDUAL AUTHORITY CORRECTION (Section D, item 6): this
    // well-formedness check now runs BEFORE sanitizeId/session/agentType/
    // agentId are ever derived below -- Section D's own explicit ordering
    // requirement ("validar los campos RAW antes de default, sanitizeId,
    // trim o cualquier conversion"). A crafted agent_id engineered so its
    // own String() conversion throws (e.g. a sufficiently deep nested array
    // -- Array.prototype.toString's recursive stringify overflows the call
    // stack) must never reach sanitizeId first and propagate to this file's
    // own unconditionally fail-open outer catch as a silent ALLOW.
    // isWellFormedOptionalIdentityField itself never calls String()/toString()
    // on a non-string value (its own `typeof value === 'string'` guard
    // short-circuits first), so it is safe to run directly against the RAW
    // parsed fields.
    // HARD NO-GO correction (item 5): checked on the RAW data fields (never
    // the defaulted/sanitized locals below, which already coerce a missing
    // value but not a wrong-TYPE one) -- an explicit deny, never a crash that
    // reaches the outer fail-open catch as an ALLOW. Scoped narrowly to this
    // one shape check; every other failure mode in this file keeps its
    // existing fail-open posture unchanged.
    if (
      !isWellFormedOptionalIdentityField(data.session_id)
      || !isWellFormedOptionalIdentityField(data.agent_type)
      || !isWellFormedOptionalIdentityField(data.agent_id)
    ) {
      emitDeny('[HARD-NO-GO-item-5] malformed session_id/agent_type/agent_id on a recognized PreToolUse event -- explicit deny, never a crash-to-allow.');
    }

    const sessionId = data.session_id || 'unknown';
    const agentType = data.agent_type || '';
    const agentId = sanitizeId(data.agent_id || 'unknown');

    // M6+M7 FINAL AUTHORITY CORRECTION (Group 1): feed this PreToolUse into
    // the CLAUDE-ID-01 bounded-proof trace BEFORE any of this file's own
    // relevant early exits/decisions below -- best-effort, never fatal, and
    // independent of every other branch here. Uses the RAW hook-observed
    // fields (never the 'unknown'-defaulted/sanitized locals above).
    if (runtimeRoleLifecycle) {
      try {
        runtimeRoleLifecycle.recordClaudeId01PreToolUseObservation(
          process.env.CLAUDE_PROJECT_DIR || process.cwd(),
          { sessionId: data.session_id, agentId: data.agent_id, agentType: data.agent_type, toolUseId: data.tool_use_id }
        );
      } catch { /* best-effort -- never fatal to the gate */ }
    }

    // M7/WP4 second-pass correction: REQUESTER role-command-grant/v1
    // injection applies to a direct Bash invocation of
    // runtime-consultation.cjs's root-init/root-validate admin subcommands
    // regardless of agent_type (PLAN.md ~L590 -- role=agent_type
    // generically, NOT main-orchestrator-only, unlike the lifecycle-grant
    // mechanism below). Checked before the main-orchestrator branch so a
    // named role (architect/specialist) issuing one of these commands is
    // covered too.
    if (toolName === 'Bash') {
      let requesterInjectionResult = null;
      try {
        requesterInjectionResult = tryInjectRequesterGrant(data.tool_input, data.session_id, agentType, data.agent_id);
      } catch {
        requesterInjectionResult = null;
      }
      if (requesterInjectionResult) {
        process.stdout.write(JSON.stringify(requesterInjectionResult.body));
        process.exit(requesterInjectionResult.exitCode);
      }
    }

    // Supervisor-start is a host/main-orchestrator authority surface, not a
    // generic Bash exemption. Recognize it for every actor so a named
    // subagent receives an explicit deny rather than silently bypassing this
    // gate; the helper itself mints only for the empty-agent main identity.
    if (toolName === 'Bash') {
      let supervisorInjectionResult = null;
      try {
        supervisorInjectionResult = tryInjectSupervisorExecutionClaim(
          data.tool_input, data.session_id, agentType,
        );
      } catch {
        const rawCommand = data.tool_input && data.tool_input.command;
        if (typeof rawCommand === 'string' && SUPERVISOR_BRIDGE_MARKER_RE.test(rawCommand.trim())) {
          supervisorInjectionResult = m7DenyResult('[M6/GROUP-A] internal validation failed for a recognized supervisor-start bridge command.');
        }
      }
      if (supervisorInjectionResult) {
        process.stdout.write(JSON.stringify(supervisorInjectionResult.body));
        process.exit(supervisorInjectionResult.exitCode);
      }
    }

    // Empty agent_type means main orchestrator — exempt from the CP-consult
    // gate itself, but a direct Bash invocation of the role-lifecycle CLI
    // additionally goes through the M7/WP4 lifecycle-grant-injection path
    // (PLAN.md ~L5465) before falling through to the same unconditional allow.
    if (agentType === '') {
      if (toolName === 'Bash') {
        let injectionResult = null;
        try {
          // M7 Correction (§2.C): pass the raw field, never the
          // 'unknown'-substituted `sessionId` local (that substitution is
          // file-wide for the pre-existing CP-consult-flag mechanism below,
          // out of scope here) -- tryInjectLifecycleGrant's own session_id
          // check must see a genuinely missing session_id as missing, not
          // as the valid-looking literal 'unknown'.
          injectionResult = tryInjectLifecycleGrant(data.tool_input, data.session_id);
        } catch {
          injectionResult = null;
        }
        if (injectionResult) {
          process.stdout.write(JSON.stringify(injectionResult.body));
          process.exit(injectionResult.exitCode);
        }
      }
      process.exit(0);
    }
    const SPECIALIST_NAMES = [
      'test-specialist', 'toolkit-specialist', 'ui-specialist',
      'domain-model-specialist', 'data-layer-specialist'
    ];
    const isSpecialist = SPECIALIST_NAMES.some(s => agentType === s || agentType.startsWith(s));
    const tmpDir = process.env.TMPDIR || process.env.TMP || os.tmpdir();
    // team-lead exemption removed: main is now caught by empty agent_type check above
    const EXEMPT_TYPES = ['context-provider', 'project-manager'];
    if (EXEMPT_TYPES.some(e => agentType === e || agentType.startsWith(e))) process.exit(0);

    // 2a. Read on pattern-discovery paths requires CP consultation (T-BUG-015)
    try {
      if (toolName === 'Read') {
        const filePath = data.tool_input?.file_path ?? '';
        const isExemptPath =
          filePath.includes('/.planning/') ||
          filePath.includes('\\.planning\\') ||
          filePath.includes('/.claude/teams/') ||
          filePath.includes('\\.claude\\teams\\') ||
          filePath.endsWith('team.json') ||
          filePath.endsWith('config.json');
        if (!isExemptPath) {
          // Boundary-anchored path classifier (P1a fix: repo-relative paths like
          // 'docs/guides/foo.md' have no leading sep — regex approach missed them).
          // dir: 'docs' | 'setup/agent-templates' | '.claude/agents'
          // Covers repo-relative (startsWith) and absolute (includes).
          // '.' stays literal — no dynamic regex escape needed.
          function underDir(fp, dir) {
            const p = String(fp).replace(/\\/g, '/');
            return p.startsWith(dir + '/') || p.includes('/' + dir + '/');
          }

          // BL-W35-06 C2: self-template/agent-template read unconditionally blocked for specialists
          // (belt-and-suspenders for template prose ban; A2 unified isPatternDiscovery with flag check
          // so own-template would otherwise be allowed when arch-response flag is set).
          const isSelfTemplatePath =
            (underDir(filePath, 'setup/agent-templates') ||
             underDir(filePath, '.claude/agents')) && filePath.endsWith('.md');
          if (isSpecialist && isSelfTemplatePath) {
            emitDeny('[C2/BL-W35-06] Reading agent templates is FORBIDDEN for specialists regardless of arch-response flag. Use task dispatch context from your architect.');
          }
          const isPatternDiscovery =
            (underDir(filePath, 'docs') && filePath.endsWith('.md')) ||
            (underDir(filePath, 'setup/agent-templates') && filePath.endsWith('.md')) ||
            (underDir(filePath, '.claude/agents') && filePath.endsWith('.md')) ||
            /skills[/\\][^/\\]+[/\\]SKILL\.md$/.test(filePath);
          if (isPatternDiscovery) {
            let allowed = false;
            let identity = null;
            if (isSpecialist) {
              // BL-W35-06: specialists require per-agent arch-response flag
              const agentFlag = path.join(tmpDir,
                'claude-arch-responded-' + sessionId + '-' + sanitizeId(agentType) + '.flag');
              allowed = fs.existsSync(agentFlag);
              if (allowed) {
                try {
                  const raw = fs.readFileSync(agentFlag, 'utf8');
                  const meta = JSON.parse(raw);
                  identity = architectIdentityFromFlagMeta(meta);
                  process.stderr.write(
                    `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
                  );
                } catch { /* legacy ISO string — ignore */ }
              }
            } else {
              const flagPath = path.join(tmpDir, 'claude-cp-consulted-' + sessionId + '.flag');
              // M6+M7 requester-authority closure (Group D, Codex-relayed
              // scope decision): the REAL hook-observed identity for this
              // invocation -- the architect IS the live caller in this
              // branch, so its own session_id/agent_id are used directly,
              // never a role-only/'self' sentinel that could never
              // correlate to a real host-private RequesterBinding.
              identity = { role: agentType, instanceId: data.agent_id, sessionId: data.session_id };
              allowed = fs.existsSync(flagPath);
              if (allowed) {
                try {
                  const raw = fs.readFileSync(flagPath, 'utf8');
                  const meta = JSON.parse(raw);
                  process.stderr.write(
                    `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
                  );
                } catch { /* legacy ISO string — ignore */ }
              }
              // ADDITIVE (Wave 2): SendMessage session-flag checked FIRST, unchanged above —
              // OR in the fail-closed disk-consult fallback (ADR-001 portable path) only if it didn't unblock.
              if (!allowed) allowed = diskConsultUnblocks(sessionId, toolName);
            }
            // M6 Block C + M7/WP4: post-PLAN branches additionally require a
            // correlated, accepted consult-result -- pre-PLAN this is a pure
            // passthrough (see postPlanGateAllows/resolvePostPlanContext above).
            allowed = postPlanGateAllows(allowed, identity, { sessionId: data.session_id, agentType, agentId: data.agent_id });
            if (!allowed) {
              emitDeny('[T-BUG-015/BL-W35-06] CP gate: Read on pattern/doc/template path requires CP consultation first (specialists: requires arch-responded flag).');
            }
          }
        }
        process.exit(0); // Read not blocked — allow
      }
    } catch { process.exit(0); }

    // 2c. Block Grep/Glob tool on docs/** or agent-template paths
    if (toolName === 'Grep' || toolName === 'Glob') {
      const queryPath = data.tool_input?.path ?? data.tool_input?.pattern ?? '';
      // Boundary-anchored: matches docs/ at start, after separator, or as full segment.
      // Prevents bypass via repo-relative paths like "docs" or "docs/guides/..." without leading sep.
      const isDocPath = /(?:^|[/\\])docs(?:[/\\]|$)/.test(queryPath) || /(?:^|[/\\])setup[/\\]agent-templates(?:[/\\]|$)/.test(queryPath);
      if (!isDocPath) process.exit(0); // non-docs Grep/Glob allowed
      // doc-path Grep/Glob: fall through to session-flag check
    }

    // 2b. Bash allow-list: non-search bash commands pass through
    if (toolName === 'Bash') {
      const cmd = data.tool_input?.command || '';
      // Block only if command contains search patterns
      if (!/grep\b|rg\b|find\b|cat\s+.*\.(kt|ts|md)/.test(cmd)) {
        process.exit(0); // build/git/gradlew bash commands — allow
      }
    }

    // 3. Check consultation flag — specialists use per-agent arch-response flag (BL-W35-06)
    if (isSpecialist) {
      const agentFlag = path.join(tmpDir,
        'claude-arch-responded-' + sessionId + '-' + sanitizeId(agentType) + '.flag');
      if (fs.existsSync(agentFlag)) {
        let identity = null;
        try {
          const raw = fs.readFileSync(agentFlag, 'utf8');
          const meta = JSON.parse(raw);
          identity = architectIdentityFromFlagMeta(meta);
          process.stderr.write(
            `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
          );
        } catch { /* legacy ISO string — ignore */ }
        // M6 Block C + M7/WP4: post-PLAN branches additionally require a
        // correlated, accepted consult-result -- pre-PLAN this is a pure
        // passthrough.
        if (postPlanGateAllows(true, identity, { sessionId: data.session_id, agentType, agentId: data.agent_id })) process.exit(0); // arch has responded — allow
        // Post-PLAN accepted-result requirement not met: fall through to block.
      }
      // No arch-response flag: fall through to block
    } else {
      // Non-specialist, non-exempt: use global session flag
      const flagPath = path.join(tmpDir, 'claude-cp-consulted-' + sessionId + '.flag');
      // M6+M7 requester-authority closure (Group D, Codex-relayed scope
      // decision): the REAL hook-observed identity, never a role-only/'self'
      // sentinel -- see the matching Read-branch comment above.
      const selfIdentity = { role: agentType, instanceId: data.agent_id, sessionId: data.session_id };
      if (fs.existsSync(flagPath)) {
        try {
          const raw = fs.readFileSync(flagPath, 'utf8');
          const meta = JSON.parse(raw);
          process.stderr.write(
            `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
          );
        } catch { /* legacy ISO string — ignore */ }
        if (postPlanGateAllows(true, selfIdentity, { sessionId: data.session_id, agentType, agentId: data.agent_id })) process.exit(0);
        // Post-PLAN accepted-result requirement not met: try disk-consult next (same OR semantics as before).
      }
      // ADDITIVE (Wave 2): SendMessage session-flag checked FIRST, unchanged above — OR in the
      // fail-closed disk-consult fallback (ADR-001 portable path) only if the flag didn't unblock.
      if (postPlanGateAllows(diskConsultUnblocks(sessionId, toolName), selfIdentity, { sessionId: data.session_id, agentType, agentId: data.agent_id })) process.exit(0);
    }

    // 4. Block — write per-agent block marker for logger and emit decision
    const blockMarker = path.join(tmpDir, `claude-cp-blocked-${sessionId}-${agentId}.flag`);
    try { fs.writeFileSync(blockMarker, new Date().toISOString()); } catch {}

    emitDeny('No agent in this session has consulted context-provider yet. SendMessage to context-provider first to validate pattern assumptions, then retry.');

  } catch (e) {
    // Fail open — never block due to script error
    process.exit(0);
  }
});
