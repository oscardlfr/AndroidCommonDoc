#!/usr/bin/env node
// branch-guard.js — PreToolUse hook on Bash
// BL-W35-08: blocks direct write-ops on protected branches (develop, master) locally.
// GitHub branch protection only blocks pushes; this enforces locally.
// Emergency escape: CLAUDE_BRANCH_GUARD_DISABLED=1 (fail-open).
// Fail open on any error.

const { execSync } = require('child_process');

const PROTECTED_BRANCHES = ['develop', 'master'];
const BLOCKED_SUBCOMMANDS = ['commit', 'merge', 'rebase', 'cherry-pick', 'revert'];

function findSubcommand(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-C' || t === '--work-tree' || t === '--git-dir') {
      i++; // skip the path argument that follows
      continue;
    }
    if (t.startsWith('-')) continue;
    return t;
  }
  return null;
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    if (process.env.CLAUDE_BRANCH_GUARD_DISABLED === '1') process.exit(0);
    const data = JSON.parse(input);
    if (data.tool_name !== 'Bash') process.exit(0);
    const cmd = data.tool_input?.command || '';
    const tokens = cmd.trim().split(/\s+/);
    if (tokens[0] !== 'git') process.exit(0);
    const subCmd = findSubcommand(tokens);
    if (!subCmd || !BLOCKED_SUBCOMMANDS.includes(subCmd)) process.exit(0);
    let branch;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', timeout: 2000 }).trim();
    } catch { process.exit(0); }
    if (!PROTECTED_BRANCHES.includes(branch)) process.exit(0);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `[BL-W35-08] Direct \`git ${subCmd}\` on protected branch \`${branch}\` is forbidden. Create a feature branch: git checkout -b feature/<descriptive-slug>, then re-run.`
    }));
    process.exit(2);
  } catch { process.exit(0); }
});
