'use strict';

// The closed command grammar a consultation target follows, in one place. The persistent role's startup bootstrap
// (lifecycle-action-payloads.cjs) and the one-shot claude-agent bootstrap (claude-agent-spawn-reservation.cjs) both
// embed it, so the two activation paths cannot drift apart: claim, then lease-heartbeat, then publish-result, each as
// one standalone single-quoted command.

const TARGET_COMMAND_LINE = 'Bash=single-quote;no-chain.Pre-read:X+["claim"]+Y+["--role",r];need SUCCESS;'
  + 'Z=["--claim",artifact_ref];60s:X+["lease-heartbeat"]+Y+Z;'
  + 'X+["publish-result"]+Y+Z+["--content",B];B=b64url(result);invalid:stop';

function consultationTargetCommandLine() {
  return TARGET_COMMAND_LINE;
}

/**
 * Deterministic recipe for a one-shot target, built only from host-derived paths (never prompt text). Unlike the
 * persistent role, a one-shot is not handed a COORDINATION_CONSULT message, so the request artifact is named here.
 * @param {{role:string, projectRoot:string, consultationCliPath:string, coordinationRoot:string, requestPath:string}} input
 * @returns {string}
 */
function oneShotConsultationRecipe({ role, projectRoot, consultationCliPath, coordinationRoot, requestPath }) {
  for (const [name, value] of Object.entries({ role, projectRoot, consultationCliPath, coordinationRoot, requestPath })) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('invalid-' + name);
  }
  return [
    JSON.stringify({ n: 'node', p: projectRoot, r: role }),
    'A=' + JSON.stringify(requestPath) + ';C=' + JSON.stringify(consultationCliPath) + ';Q=' + JSON.stringify(coordinationRoot)
      + ';X=[n,C];Y=["--coordination-root",Q,"--request",A].',
    TARGET_COMMAND_LINE,
  ].join('\n');
}

function createConsultationTargetRecipe() {
  return Object.freeze({ consultationTargetCommandLine, oneShotConsultationRecipe });
}

module.exports = { createConsultationTargetRecipe };
