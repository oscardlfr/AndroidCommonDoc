'use strict';

function createClaudeOneShotOperations(deps) {
  const {
    fs,
    path,
    registryRepoDir,
  } = deps;

function claudeOneShotBindingRetiredMarkerPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-one-shot-bindings', bindingId + '.retired');
}

const CLAUDE_ONE_SHOT_BINDING_RETIREMENT_REASON_ENUM = Object.freeze([
  'terminal-result', 'agent-return', 'cancellation', 'expiry',
]);

// M7 section 4/8.5: retireClaudeOneShotBinding (the no-clobber retirement-
// marker writer) is REMOVED. No new retirement artifact is written for
// ClaudeOneShotBinding either -- authority is cut via the fence/generation/
// expiry monotonic cuts (validateClaudeOneShotBindingFor's own fresh-read
// checks), and terminal state is read directly off the transaction's own
// fd-bound artifacts (result/ack/cancel), never a synthesized marker.

/**
 * M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 4
 * point 2): scans this repo's claude-one-shot-bindings registry for every
 * LIVE (correct shape, unexpired, unretired) binding whose OWN OBSERVED
 * identity fields -- `runtime_session_key`/`agent_id`/`agent_type` -- match
 * EXACTLY. This is the SubagentStop-side counterpart to
 * `validateClaudeOneShotBindingFor` (which matches the request/attempt/
 * role/worktree/plan tuple instead, for the target-gate's own use) --
 * intentionally a SEPARATE function rather than overloading one `expected`
 * shape to mean two different kinds of scope-matching, mirroring this
 * file's own established "small logic-identical duplication is safer than
 * an awkward shared parameter shape" convention. Never returns on the first
 * match: collects EVERY genuinely live candidate so the caller applies the
 * SAME "zero -> no-op (an ordinary ad-hoc Agent, not a one-shot spawn),
 * more-than-one -> STOP/deny (ambiguous, never guess), exactly one ->
 * retire" discipline this whole pass's other ownership scans already use.
 * Never matches by role/session/agent_id ALONE -- all three identity fields
 * must agree, and the binding's own full closed-shape/timestamp/retirement
 * validation still applies (a binding failing ANY of those is never a
 * candidate, regardless of identity match).
 * @param {string|{repoId:string}} repoDescriptor
 * @param {string} sessionId
 * @param {string} agentId
 * @param {string} agentType
 * @returns {Array<object>}
 */
// M7 defect 9 (section 6): the per-family, session+agent+agent_type
// identity scanner this codebase used to maintain here is removed -- every
// caller now resolves one-shot authority through the ONE canonical
// cross-family classifier, classifyClaudeAuthorityForIdentity.

/**
 * M7 completeness retirement-triggers pass (point 7, verdict Block 4,
 * team-lead-relayed 2026-08-09): pure, standalone verification that the full
 * claude-agent one-shot consultation-target chain is functionally present --
 * (1) PreToolUse Agent reservation: `agent-spawn-execution-gate.js` exists
 * and is registered under `PreToolUse` in `.claude/settings.json`;
 * (2) SubagentStart mint: `subagent-start-context-bundle.js` exists and is
 * registered under `SubagentStart`; (3) SubagentStop retirement: the SAME
 * file is ALSO registered under `SubagentStop`. Checked via presence +
 * registration, mirroring `mergeHookRegistrations`'s own established
 * per-(event,file) idempotency-check convention (`sync-engine.ts`) -- never
 * a `typeof fn === 'function'` self-check against this file's own primitives
 * (createClaudeOneShotBinding/publishClaudeAuthorityFence etc. always exist
 * once this module loads, which would make the check unable to ever fail --
 * see this file's own `[[feedback_a_check_that_cannot_fail_reads_as_coverage]]`
 * discipline). cmdDispatch consults this as the mechanism-readiness
 * precondition for `claude-agent`; it remains deliberately insufficient on
 * its own because selection also requires the separate active top-level-host
 * correlation frozen by PLAN §15d.
 * @param {string} projectRoot
 * @returns {{available:true}|{available:false,reason:string,missing:'reservation'|'mint'|'retirement'}}
 */
function checkClaudeAgentCapabilityAvailable(projectRoot) {
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return { available: false, reason: 'settings-unreadable:' + ((err && err.code) || 'unknown'), missing: 'reservation' };
  }
  const hooksObj = (settings && typeof settings === 'object' && settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};

  const isRegisteredUnder = (eventName, fileName) => {
    const blocks = Array.isArray(hooksObj[eventName]) ? hooksObj[eventName] : [];
    return blocks.some((block) => (
      block && Array.isArray(block.hooks)
      && block.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(fileName))
    ));
  };

  const RESERVATION_HOOK_FILE = 'agent-spawn-execution-gate.js';
  const MINT_RETIREMENT_HOOK_FILE = 'subagent-start-context-bundle.js';

  const reservationHookPath = path.join(projectRoot, '.claude', 'hooks', RESERVATION_HOOK_FILE);
  if (!fs.existsSync(reservationHookPath) || !isRegisteredUnder('PreToolUse', RESERVATION_HOOK_FILE)) {
    return { available: false, reason: 'reservation-mechanism-absent', missing: 'reservation' };
  }

  const bundleHookPath = path.join(projectRoot, '.claude', 'hooks', MINT_RETIREMENT_HOOK_FILE);
  if (!fs.existsSync(bundleHookPath) || !isRegisteredUnder('SubagentStart', MINT_RETIREMENT_HOOK_FILE)) {
    return { available: false, reason: 'mint-mechanism-absent', missing: 'mint' };
  }

  if (!isRegisteredUnder('SubagentStop', MINT_RETIREMENT_HOOK_FILE)) {
    return { available: false, reason: 'retirement-mechanism-absent', missing: 'retirement' };
  }

  return { available: true };
}

  return Object.freeze({
    claudeOneShotBindingRetiredMarkerPathFor,
    CLAUDE_ONE_SHOT_BINDING_RETIREMENT_REASON_ENUM,
    checkClaudeAgentCapabilityAvailable,
  });
}

module.exports = Object.freeze({ createClaudeOneShotOperations });

