#!/usr/bin/env node
// branch-guard.js — PreToolUse hook on Bash
// BL-W35-08: blocks direct write-ops on protected branches (develop, master) locally.
// GitHub branch protection only blocks pushes; this enforces locally.
// Emergency escape: CLAUDE_BRANCH_GUARD_DISABLED=1 (fail-open).
// Fail open on any error.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROTECTED_BRANCHES = ['develop', 'master'];
const BLOCKED_SUBCOMMANDS = ['commit', 'merge', 'rebase', 'cherry-pick', 'revert'];

// Returns the git subcommand and the directory git would run in: a `-C <path>` that exists wins, otherwise the
// session's own working directory (`baseDir`).
function findSubcommand(tokens, baseDir) {
  let workDir = baseDir;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-C') {
      const candidate = tokens[i + 1] ? path.resolve(baseDir, tokens[i + 1]) : null;
      if (candidate && isDirectory(candidate)) workDir = candidate;
      i++; // skip the path argument that follows
      continue;
    }
    if (t === '--work-tree' || t === '--git-dir') {
      i++; // skip the path argument that follows
      continue;
    }
    if (t.startsWith('-')) continue;
    return { subCmd: t, workDir };
  }
  return { subCmd: null, workDir };
}

function isDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
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
    // Split on compound-command separators: &&, ||, ;, single |
    const segments = cmd.split(/&&|\|\||;(?!=)|(?<![|])\|(?![|])/);
    // The branch that matters is the one of the session's own worktree. The hook process cwd is the project
    // directory, which for a desktop managed linked worktree is the MAIN checkout (often on develop).
    const baseDir = typeof data.cwd === 'string' && path.isAbsolute(data.cwd) && isDirectory(data.cwd)
      ? data.cwd : process.cwd();
    let subCmd = null;
    let workDir = baseDir;
    for (const rawSeg of segments) {
      let seg = rawSeg.trim();
      // Strip leading ( for subshells
      seg = seg.replace(/^\(+/, '').trim();
      // Strip env assignments (VAR=value at the start)
      seg = seg.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)+/, '').trim();
      // Strip known command prefixes
      seg = seg.replace(/^rtk\s+/, '').trim();
      seg = seg.replace(/^sudo\s+/, '').trim();
      seg = seg.replace(/^command\s+/, '').trim();
      const tokens = seg.split(/\s+/);
      if (tokens[0] !== 'git') continue;
      const found = findSubcommand(tokens, baseDir);
      if (found.subCmd && BLOCKED_SUBCOMMANDS.includes(found.subCmd)) {
        subCmd = found.subCmd;
        workDir = found.workDir;
        break;
      }
    }
    if (!subCmd) process.exit(0);
    let branch;
    try {
      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workDir, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { process.exit(0); }
    if (!PROTECTED_BRANCHES.includes(branch)) process.exit(0);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `[BL-W35-08] Direct \`git ${subCmd}\` on protected branch \`${branch}\` is forbidden. Create a feature branch: git checkout -b feature/<descriptive-slug>, then re-run.`
    }));
    process.exit(2);
  } catch { process.exit(0); }
});
