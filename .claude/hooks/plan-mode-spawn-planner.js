#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Resolve project root reliably regardless of process.cwd().
 * Uses execFileSync (no shell, no injection risk) for git rev-parse,
 * then falls back to walking up from cwd.
 */
function resolveProjectRoot(cwd) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).toString().trim();
    if (root && fs.existsSync(root)) return root;
  } catch (_) {}

  // Walk-up fallback: nearest ancestor with .git or mcp-server/package.json
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'mcp-server', 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name || '';
  const hookEvent = data.hook_event_name || '';
  const cwd = data.cwd || process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  const sentinelPath = path.join(projectRoot, '.planning', '.plan-mode-planner-required');

  if (toolName === 'EnterPlanMode') {
    if (process.env.CLAUDE_SKIP_PLANNER === '1') {
      process.exit(0);
    }
    try {
      fs.writeFileSync(sentinelPath, new Date().toISOString(), 'utf8');
    } catch (_) {}
    process.exit(0);
  }

  if (toolName === 'Agent') {
    const subagentType = data.tool_input?.subagent_type;
    if (subagentType === 'planner') {
      const teamName = data.tool_input?.team_name;
      const agentName = data.tool_input?.name;
      if (teamName && agentName === 'planner') {
        try { fs.unlinkSync(sentinelPath); } catch (_) {}
        process.exit(0);
      }
      // Bare or wrong-name spawn: do NOT clear sentinel, block with explanation
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[plan-mode-spawn-planner] planner must be spawned as TeamCreate-peer: Agent(subagent_type="planner", team_name="session-{slug}", name="planner"). Bare Agent(subagent_type="planner") does not satisfy the sentinel.'
      }));
      process.exit(2);
    }
    process.exit(0);
  }

  if (toolName === 'ExitPlanMode') {
    if (hookEvent === 'PostToolUse') {
      try { fs.unlinkSync(sentinelPath); } catch (_) {}
      process.exit(0);
    }

    let sentinelExists = false;
    try {
      sentinelExists = fs.existsSync(sentinelPath);
    } catch (_) {}

    if (sentinelExists) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: [
          '[plan-mode-spawn-planner] ExitPlanMode blocked: planner peer was not spawned during plan mode.',
          'Per docs/agents/main-agent-orchestration-guide.md Phase 1, non-trivial plans require:',
          '  Agent(name="planner", subagent_type="planner", ...)',
          'Spawn the planner first (it will write .planning/PLAN.md), then ExitPlanMode.',
          'For genuinely trivial tasks (1-line typo fix etc.), set CLAUDE_SKIP_PLANNER=1 before EnterPlanMode.',
        ].join('\n')
      }));
      process.exit(2);
    }

    process.exit(0);
  }

  process.exit(0);
});
