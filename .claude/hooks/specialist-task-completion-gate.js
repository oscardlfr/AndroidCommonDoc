#!/usr/bin/env node
// specialist-task-completion-gate.js — Block specialists from marking tasks completed
//
// Specialists send READY-FOR-REVIEW: <task-id> to team-lead instead.
// team-lead verifies and marks tasks completed after review.
//
// Subject agents: test-specialist, toolkit-specialist, ui-specialist,
//   domain-model-specialist, data-layer-specialist, doc-updater
// Excluded: arch-*, team-lead, context-provider, project-manager, quality-gater, planner
//
// Block condition: subject agent + tool_name=TaskUpdate + status=completed
//
// Bypasses:
//   SPECIALIST_TASK_COMPLETION_BYPASS=1 env (session-scoped)
//   [SPECIALIST_TASK_COMPLETION_BYPASS] inline marker in tool_input (future use)
//
// Fail-open: any parse error or stdin error -> exit 0

const SPECIALIST_TYPES = new Set([
  'test-specialist',
  'toolkit-specialist',
  'ui-specialist',
  'domain-model-specialist',
  'data-layer-specialist',
  'doc-updater',
]);

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const agentType = data.agent_type || '';

    // Only intercept TaskUpdate
    if (toolName !== 'TaskUpdate') process.exit(0);

    // Only subject specialists are gated
    if (!SPECIALIST_TYPES.has(agentType)) process.exit(0);

    // Only block status=completed
    const status = data.tool_input?.status || '';
    if (status !== 'completed') process.exit(0);

    // Bypass 1: session-scoped env
    if (process.env.SPECIALIST_TASK_COMPLETION_BYPASS === '1') process.exit(0);

    // Block: specialist attempting to mark task completed
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[specialist-task-completion-gate] Specialist "' + agentType + '" may NOT mark '
        + 'tasks completed directly.\n'
        + 'Send `READY-FOR-REVIEW: <task-id>` message to team-lead.\n'
        + 'team-lead verifies and marks completed after review.\n'
        + 'To bypass: set SPECIALIST_TASK_COMPLETION_BYPASS=1.',
    }) + '\n');
    process.exit(2);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
