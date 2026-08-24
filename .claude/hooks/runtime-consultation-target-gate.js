#!/usr/bin/env node
// runtime-consultation-target-gate.js — PreToolUse/Bash hook
//
// M7/WP4 SECOND-PASS correction (2026-08-09, supersedes the first pass's own
// m7-correction-spec.md §1 design per the user's HARD NO-GO,
// m7-correction-verdict-2026-08-09.md). Owns exactly two independent
// target-authority surfaces, both host-private, never model-visible under
// .planning/:
//
//   (a) Lifecycle target: `ready` only (runtime-role-lifecycle.cjs's CLI).
//       Reuses the already-tested RoleActorBinding + lifecycle-command-grant/
//       v1 machinery (createRoleActorBinding/validateRoleActorBindingFor,
//       mintLifecycleCommandGrant, validateAndConsumeLifecycleCommandGrant --
//       all already exported and proven). Mints+injects `--lifecycle-binding
//       <id>`, mirroring context-provider-gate.js's own
//       tryInjectLifecycleGrant exactly (re-render via renderPosixDirect off
//       the already-parsed tokens, never string concatenation). UNCHANGED by
//       this second pass, apart from one precision fix (see
//       handleReadyOwning's own comment): the RoleActorBinding lookup now
//       additionally requires the binding's own `session_generation_id` to
//       match the target action's.
//   (b) Consultation target: `claim`/`lease-heartbeat`/`publish-result`/
//       `worker-stop-ack` (runtime-consultation.cjs's real subcommands --
//       confirmed via that file's own COMMAND_FLAGS table, NOT
//       `accept-result`/`transaction-ack`, which are requester-owned per
//       PLAN.md §15b). CORRECTED this pass: the first pass's own
//       "mint-only, no injection" design was the exact defect the user's
//       HARD NO-GO named ("the mint step is theater: ... nothing downstream
//       ever checks the grant"). Path-Manifest now authorizes WP4 to extend
//       runtime-consultation.cjs's own COMMAND_FLAGS with a real
//       `--target-binding` slot on these four subcommands, and that file now
//       atomically one-time-consumes+fully-validates it before any read or
//       mutation (PLAN.md ~L604). This hook now mints+INJECTS the grant,
//       mirroring the `ready` surface (and context-provider-gate.js's own
//       requester-side injection) exactly.
//
// Canonical recognition (both surfaces): parsePosixDirect's closed
// single-quoted grammar, exact resolved CLI path (never basename-only,
// never substring matching). A command already carrying
// --target-binding/--lifecycle-binding is rejected outright -- the hook
// mints; the caller/model never supplies one. Once a command is recognized
// as belonging to either owning surface, every subsequent failure (lookup,
// parse, correlation, mint) reaches an explicit block -- never the
// catch-all's fail-open passthrough.
//
// stdin JSON in, official hookSpecificOutput PreToolUse decision out: deny
// via {hookSpecificOutput:{hookEventName:'PreToolUse', permissionDecision:
// 'deny', permissionDecisionReason}} + exit 0, vs allow via the same schema
// with permissionDecision:'allow' + exit 0; fail-open (bare exit 0, no
// stdout) ONLY for a genuinely inapplicable event (unparseable stdin, wrong
// tool_name, non-canonical/unrecognized command). This hook only ever
// analyzes tool_input.command as text -- it never executes it.

const fs = require('fs');
const path = require('path');

const rll = require('../../scripts/lib/runtime-role-lifecycle.cjs');
const rc = require('../../scripts/lib/runtime-consultation.cjs');

const CANONICAL_LIFECYCLE_CLI_PATH = path.resolve(__dirname, '../../scripts/lib/runtime-role-lifecycle.cjs');
const CANONICAL_CONSULTATION_CLI_PATH = path.resolve(__dirname, '../../scripts/lib/runtime-consultation.cjs');
const CONSULTATION_TARGET_SUBCOMMANDS = Object.freeze(['claim', 'lease-heartbeat', 'publish-result', 'worker-stop-ack']);

// Generic `--flag value` linear scan (mirrors context-provider-gate.js's own
// extractFlagValues, minus repeatable-flag support -- none of the four
// target subcommands, nor `ready`, ever repeat a flag). Returns null on
// anything malformed (odd flag count, a bare non-flag token, a duplicate
// flag) so the caller declines to proceed rather than guess.
function extractFlagValues(tokens) {
  const values = {};
  let i = 0;
  while (i < tokens.length) {
    const flag = tokens[i];
    if (typeof flag !== 'string' || !flag.startsWith('--')) return null;
    if (i + 1 >= tokens.length) return null;
    const value = tokens[i + 1];
    if (Object.prototype.hasOwnProperty.call(values, flag)) return null;
    values[flag] = value;
    i += 2;
  }
  return values;
}

// Recognizes ONLY the canonical `node <canonical-absolute-path> <subcommand>
// ...` token sequence -- mirrors context-provider-gate.js's own
// findLifecycleCliInvocation exactly (exact string match after backslash
// normalization, never a basename-only/substring match).
function findCliInvocation(tokens, canonicalPath) {
  if (tokens.length < 2 || tokens[0] !== 'node') return -1;
  const candidate = String(tokens[1]).replace(/\\/g, '/');
  const canonical = canonicalPath.replace(/\\/g, '/');
  return candidate === canonical ? 1 : -1;
}

// Collects EVERY genuinely live, correctly-scoped RoleActorBinding for
// {role, worktreeId, planDigest} -- never returns on the first match. Zero
// or more-than-one candidates both fail closed at the call site (mirrors
// this whole pass's own fix for findOwningRoleLifecycleCandidate's sibling
// multiplicity gap in agent-spawn-execution-gate.js -- never repeated here).
function findLiveRoleActorBindings(repoDescriptor, role, worktreeId, planDigest) {
  const dir = path.join(rll.registryRepoDir(repoDescriptor), 'role-actor-bindings');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const bindingId = entry.name.replace(/\.json$/, '');
    const result = rll.validateRoleActorBindingFor(repoDescriptor, bindingId, role, worktreeId, planDigest);
    if (result.ok) matches.push(result.binding);
  }
  return matches;
}

// Official PreToolUse deny contract (code.claude.com/docs/en/hooks): exit 0,
// hookSpecificOutput{hookEventName:'PreToolUse', permissionDecision:'deny',
// permissionDecisionReason} -- never the deprecated top-level decision:'block'
// + exit 2 shape.
function block(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function allowInjected(toolInput, rewrittenCommand) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: Object.assign({}, toolInput, { command: rewrittenCommand }),
    },
  }));
  process.exit(0);
}

/**
 * `ready --action <id>` -- lifecycle target surface. Reuses the already-
 * tested RoleActorBinding + lifecycle-command-grant/v1 machinery only.
 * Never auto-mints a fallback RoleActorBinding here: by the time `ready` is
 * called, SubagentStart (subagent-start-context-bundle.js, item 5 of this
 * same pass) should already have created it after confirming the B1/B2
 * reserve/commit protocol -- minting one on demand here, with no
 * session/agent correlation available at this call site, would bypass that
 * protocol entirely. A missing binding is therefore a genuine lookup
 * failure inside this owning flow, not a fallback-mint opportunity.
 */
function handleReadyOwning(tokens, cliIdx, toolInput) {
  const rest = tokens.slice(cliIdx + 2);
  if (rest.includes('--lifecycle-binding') || rest.includes('--target-binding')) {
    block('[RC-TARGET-GATE] a "ready" command must never carry its own grant-binding flag -- only this hook may mint and inject one.');
    return;
  }
  const values = extractFlagValues(rest);
  if (!values) {
    block('[RC-TARGET-GATE] ready: malformed argv.');
    return;
  }
  const actionId = values['--action'];
  if (typeof actionId !== 'string' || actionId.length === 0) {
    block('[RC-TARGET-GATE] ready: requires --action <id>.');
    return;
  }

  let found;
  try {
    found = rll.findActionAcrossRepos(actionId);
  } catch {
    found = { ok: false };
  }
  if (!found.ok || found.absent) {
    block('[RC-TARGET-GATE] ready: no such action.');
    return;
  }
  const action = found.action;
  if (action.role === null || (action.kind !== 'role-spawn' && action.kind !== 'role-rebind')) {
    block('[RC-TARGET-GATE] ready: action is not an admitted role-spawn/role-rebind target.');
    return;
  }

  const repoDescriptor = { repoId: action.repo_id };
  // P0 (HARD NO-GO finding #4): findLiveRoleActorBindings/validateRoleActorBindingFor
  // scope only by {role, worktree, plan} -- narrowed HERE to this action's
  // own session_generation_id BEFORE the ambiguity check below, not as a
  // post-check on a single survivor. A stale/foreign binding left over from
  // an earlier spawn attempt of the same role must never count toward "how
  // many live candidates exist" for THIS action -- filtering it out first is
  // what lets a genuinely correct, matching-generation binding still resolve
  // to exactly one candidate even while an unrelated wrong-generation
  // binding also happens to still be live for the same {role,worktree,plan}
  // scope (a post-check on `candidates.length===1` alone would instead
  // misreport that coexistence as ambiguity).
  const candidates = findLiveRoleActorBindings(repoDescriptor, action.role, action.worktree_id, action.plan_digest)
    .filter((b) => b.session_generation_id === action.session_generation_id);
  if (candidates.length !== 1) {
    block('[RC-TARGET-GATE] ready: no single live RoleActorBinding for this action\'s exact scope.');
    return;
  }
  const binding = candidates[0];

  const argvDigest = rc.sha256String('ready:' + actionId);
  let mintResult;
  try {
    mintResult = rll.mintLifecycleCommandGrant(repoDescriptor, binding, argvDigest, action.role, 'ready', 'role-actor', 'target', 'target', actionId);
  } catch {
    mintResult = { ok: false };
  }
  if (!mintResult.ok) {
    block('[RC-TARGET-GATE] ready: unable to mint lifecycle-command-grant.');
    return;
  }

  const rewritten = rll.renderPosixDirect(tokens.concat(['--lifecycle-binding', mintResult.grantId]));
  allowInjected(toolInput, rewritten);
}

/**
 * `claim`/`lease-heartbeat`/`publish-result`/`worker-stop-ack` --
 * consultation target surface. Resolves identity+scope, mints a real target
 * role-command-grant/v1 via the shared rll.mintRoleCommandGrant (the SAME
 * mint primitive context-provider-gate.js uses for the requester side), and
 * INJECTS it as `--target-binding <id>` -- mirrors handleReadyOwning exactly
 * (re-render via renderPosixDirect off the already-parsed tokens, never
 * string concatenation). runtime-consultation.cjs's own COMMAND_FLAGS now
 * carries a real `--target-binding` slot for these four subcommands and
 * atomically one-time-consumes+validates it before any read or mutation.
 *
 * M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
 * point 4): for `claim`/`lease-heartbeat`/`publish-result` (each carries
 * `--request <path>`), the backing binding is chosen via a DETERMINISTIC
 * branch on the request's CURRENT activation `selected_driver`
 * (arch-integration-prep's own guidance, relayed 2026-08-09: `'claude-agent'`
 * -> ClaudeOneShotBinding, anything else -> RoleActorBinding -- never a
 * fallback/probe-both). `worker-stop-ack` (carries `--stop <path>`, not
 * `--request`) keeps the pre-existing, unchanged RoleActorBinding-only path
 * -- a `session-shutdown`-kind stop carries no `request_id` at all (no
 * activation to resolve a driver from), and a `transaction`-kind stop's own
 * indirect request reference is a genuinely separate undertaking out of
 * this follow-up's own scope (disclosed, not hidden: this branch is
 * unreachable in production today regardless, since cmdDispatch never
 * selects claude-agent -- see findLiveClaudeAgentActivations's own
 * disclosure in runtime-consultation.cjs).
 */
function handleConsultationTargetOwning(tokens, cliIdx, toolInput, data) {
  const subcommand = tokens[cliIdx + 1];
  const rest = tokens.slice(cliIdx + 2);
  if (rest.includes('--lifecycle-binding') || rest.includes('--target-binding')) {
    block('[RC-TARGET-GATE] a "' + subcommand + '" command must never carry its own grant-binding flag -- only this hook may mint one.');
    return;
  }
  const values = extractFlagValues(rest);
  if (!values) {
    block('[RC-TARGET-GATE] ' + subcommand + ': malformed argv.');
    return;
  }

  const agentType = data.agent_type;
  if (typeof agentType !== 'string' || agentType.length === 0) {
    block('[RC-TARGET-GATE] ' + subcommand + ': requires a resolvable calling role.');
    return;
  }
  const sessionId = data.session_id;
  const agentId = data.agent_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof agentId !== 'string' || agentId.length === 0) {
    block('[RC-TARGET-GATE] ' + subcommand + ': requires a resolvable session_id/agent_id.');
    return;
  }

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let worktreeId;
  let planResult;
  try {
    worktreeId = rll.computeWorktreeId(projectRoot);
    planResult = rll.discoverPlan(projectRoot);
  } catch {
    block('[RC-TARGET-GATE] ' + subcommand + ': unresolvable project scope.');
    return;
  }
  if (!planResult.ok) {
    block('[RC-TARGET-GATE] ' + subcommand + ': no discoverable PLAN.');
    return;
  }

  let requestId = null;
  let requestPathForSubcommand = null;
  if (subcommand === 'worker-stop-ack') {
    const stopId = values['--stop'];
    if (typeof stopId !== 'string' || stopId.length === 0) {
      block('[RC-TARGET-GATE] worker-stop-ack: requires --stop.');
      return;
    }
  } else {
    requestId = values['--request'];
    if (typeof requestId !== 'string' || requestId.length === 0) {
      block('[RC-TARGET-GATE] ' + subcommand + ': requires --request.');
      return;
    }
    requestPathForSubcommand = requestId;
  }

  // M7 GREEN correction round 2, R5 (supersedes the prior "absence allowed,
  // fall through to RoleActor" design for claim/lease-heartbeat/
  // publish-result -- worker-stop-ack is unaffected, see below): these three
  // commands now REQUIRE resolved.ok===true && resolved.activation to
  // exist. resolveActivationForRequestPath itself (runtime-consultation.cjs)
  // now distinguishes DURABLE_PENDING, malformed/unsafe, decorrelated
  // (present but wrong request/attempt), and expired -- every one of those
  // already returns ok:false, so `!resolved.ok` below already blocks all of
  // them; the ADDITIONAL check here closes the ONE remaining case
  // resolveActivationForRequestPath still legitimately returns
  // {ok:true, activation:null} for: genuine ABSENCE. Per this ruling, even
  // genuine absence must block these three commands with zero grant --
  // never a silent fallback to RoleActorBinding merely because no
  // claude-agent activation happens to exist yet for this exact request.
  // worker-stop-ack never sets requestPathForSubcommand at all (it carries
  // --stop, not --request), so it is structurally exempt and keeps its
  // pre-existing, unchanged RoleActorBinding-only path.
  let resolvedActivation = null;
  if (requestPathForSubcommand) {
    let resolved;
    try {
      resolved = rc.resolveActivationForRequestPath(requestPathForSubcommand);
    } catch {
      resolved = { ok: false };
    }
    if (!resolved.ok) {
      block('[RC-TARGET-GATE] ' + subcommand + ': request activation is not resolvable.');
      return;
    }
    if (!resolved.activation) {
      block('[RC-TARGET-GATE] ' + subcommand + ': no live activation exists for this request -- claim/lease-heartbeat/publish-result require a resolvable activation, never a silent RoleActorBinding fallback on absence.');
      return;
    }
    resolvedActivation = resolved;

    // Stage C (M7-FINAL-REMEDIATION-20260818, activation_resolution
    // ruling): universal scope gate -- immediately after resolution and
    // before any classifier/binding lookup below, for EITHER driver
    // branch. Without this, findLiveRoleActorBindings (queried by the
    // CALLING agentType/current worktree/current plan, never by what the
    // request itself claims) still finds and grants a live RoleActorBinding
    // for the caller's own real identity even when the request being acted
    // on claims a DIFFERENT role/worktree/plan scope entirely.
    if (
      resolvedActivation.targetRole !== agentType
      || resolvedActivation.worktreeId !== worktreeId
      || resolvedActivation.planDigest !== planResult.planDigest
    ) {
      block('[RC-TARGET-GATE] ' + subcommand + ': request-resolved target_role/worktree_id/plan_digest does not match the calling identity/current project scope.');
      return;
    }
  }

  let binding;
  let grantRequestId = requestId;
  let grantAttemptId = null;
  let grantLeaseEpoch = null;
  if (resolvedActivation && resolvedActivation.activation && resolvedActivation.activation.selected_driver === 'claude-agent') {
    // M7 defect 9: resolved via the canonical cross-family classifier (never
    // a removed local per-family scanner) -- an
    // indeterminate/errored classification for this exact observed
    // session_id/agent_id identity blocks outright here, it NEVER falls
    // back to the RoleActorBinding resolver below (that resolver remains
    // exactly as-is, but only for non-Claude drivers).
    const repoDescriptorForClaudeAgent = { repoId: rll.computeRepoId(projectRoot) };
    const observedIdentity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
      provider: 'claude-hook',
      repo_id: repoDescriptorForClaudeAgent.repoId,
      runtime_session_key: sessionId,
      agent_id: agentId,
    };
    let claudeAgentClassification;
    try {
      claudeAgentClassification = rll.classifyClaudeAuthorityForIdentity(repoDescriptorForClaudeAgent, observedIdentity);
    } catch {
      claudeAgentClassification = { ok: false, reason: 'authority-classify-threw' };
    }
    if (!claudeAgentClassification.ok || claudeAgentClassification.state !== 'ONE' || claudeAgentClassification.family !== 'one-shot') {
      block('[RC-TARGET-GATE] ' + subcommand + ': no single live ClaudeOneShotBinding for the calling session/agent identity.');
      return;
    }
    binding = claudeAgentClassification.binding;
    // M7 FINAL IDENTITY CLOSURE (2026-08-09): the classifier itself already
    // scoped the scan to this EXACT observed session_id/agent_id identity --
    // kept as an explicit, defense-in-depth assertion against
    // agent_type/role divergence rather than assumed silently.
    if (binding.runtime_session_key !== sessionId || binding.agent_id !== agentId || binding.agent_type !== agentType) {
      block('[RC-TARGET-GATE] ' + subcommand + ': ClaudeOneShotBinding does not match the calling session/agent identity.');
      return;
    }
    // The classifier proves identity+liveness only (session+agent, expiry,
    // generation, fence) -- the exact transaction-scope tuple
    // (request/attempt/lease-epoch/role/worktree/plan) this activation
    // itself expects is checked explicitly here, never assumed.
    if (
      binding.request_id !== resolvedActivation.requestId || binding.attempt_id !== resolvedActivation.attemptId
      || binding.lease_epoch !== resolvedActivation.leaseEpoch || binding.role !== agentType
      || binding.worktree_id !== worktreeId || binding.plan_digest !== planResult.planDigest
    ) {
      block('[RC-TARGET-GATE] ' + subcommand + ': no single live ClaudeOneShotBinding for the calling session/agent identity at this claude-agent activation scope.');
      return;
    }
    // Real request_id/attempt_id/lease_epoch (not the raw --request path) --
    // required so the CLI-side consumer's own ClaudeOneShotBinding scope
    // cross-check (request_id/attempt_id/lease_epoch) is meaningful; the
    // pre-existing RoleActorBinding path below never populated these
    // (unaffected, unchanged).
    grantRequestId = resolvedActivation.requestId;
    grantAttemptId = resolvedActivation.attemptId;
    grantLeaseEpoch = resolvedActivation.leaseEpoch;
  } else {
    const candidates = findLiveRoleActorBindings(projectRoot, agentType, worktreeId, planResult.planDigest);
    if (candidates.length !== 1) {
      block('[RC-TARGET-GATE] ' + subcommand + ': no single live RoleActorBinding for the calling role.');
      return;
    }
    binding = candidates[0];
  }

  // PLAN.md ~L604: the core "recomputes the exact pre-injection argv
  // digest" -- computed here, BEFORE injection, over the ordered raw
  // flag-token array (`rest`, no --target-binding present yet). The
  // CLI-side consumer strips only its own injected --target-binding pair
  // from the argv it actually received and recomputes the identical digest
  // (never a hand-picked subset like --stop/--request alone, which would
  // leave every OTHER flag -- e.g. --coordination-root -- unauthorized by
  // the grant at all).
  const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));

  let mintResult;
  try {
    mintResult = rll.mintRoleCommandGrant(projectRoot, binding, 'target', subcommand, argvDigest, grantRequestId, grantAttemptId, grantLeaseEpoch);
  } catch {
    mintResult = { ok: false };
  }
  if (!mintResult.ok) {
    block('[RC-TARGET-GATE] ' + subcommand + ': unable to mint role-command-grant.');
    return;
  }

  const rewritten = rll.renderPosixDirect(tokens.concat(['--target-binding', mintResult.grantId]));
  allowInjected(toolInput, rewritten);
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Bash') process.exit(0);
    const toolInput = (data.tool_input && typeof data.tool_input === 'object') ? data.tool_input : {};
    const command = toolInput.command;
    if (typeof command !== 'string' || command.length === 0) process.exit(0);
    // Only ever touches a single, direct CLI invocation -- a command
    // carrying shell operators (chaining/piping/substitution) is never
    // recognized, mirroring context-provider-gate.js's own
    // tryInjectLifecycleGrant pre-check exactly.
    if (/[;&|`\n]|\$\(/.test(command)) process.exit(0);

    const tokens = rll.parsePosixDirect(command);
    if (!tokens) process.exit(0); // non-canonical -- never owning.

    const readyIdx = findCliInvocation(tokens, CANONICAL_LIFECYCLE_CLI_PATH);
    if (readyIdx !== -1 && tokens[readyIdx + 1] === 'ready') {
      handleReadyOwning(tokens, readyIdx, toolInput);
      return;
    }

    const consultIdx = findCliInvocation(tokens, CANONICAL_CONSULTATION_CLI_PATH);
    if (consultIdx !== -1 && CONSULTATION_TARGET_SUBCOMMANDS.includes(tokens[consultIdx + 1])) {
      handleConsultationTargetOwning(tokens, consultIdx, toolInput, data);
      return;
    }

    process.exit(0); // not owning -- zero side effects.
  } catch (e) {
    // Fail open -- never block due to script/parse error on a genuinely
    // inapplicable event.
    process.exit(0);
  }
});
