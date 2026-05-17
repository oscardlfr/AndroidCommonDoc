#!/usr/bin/env node
// pre-push-pre-pr-gate.js — PreToolUse hook for Bash.
//
// Intercepts git push commands. Reads .androidcommondoc/pre-pr.stamp JSON.
// Blocks push if stamp is missing, stale (>30 min), verdict != PASS,
// HEAD mismatch, or branch mismatch.
//
// Exempt: pushes targeting develop or master (those go through PR CI gate).
// Exempt: force-push (--force / -f) — those are gated elsewhere.
//
// Bypasses:
//   PRE_PR_BYPASS=1 env (session-scoped)
//
// Fail-open: any parse error or stdin error -> exit 0.
// Missing stamp -> informative block (not hard crash).
//
// Stamp format (written by /pre-pr skill Step 8):
//   { "verdict": "PASS", "timestamp": "ISO8601", "head": "SHA", "branch": "name" }

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_STAMP_AGE_MS = 30 * 60 * 1000; // 30 minutes

function getProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function getStampPath(projectRoot) {
  return path.join(projectRoot, '.androidcommondoc', 'pre-pr.stamp');
}

function readStamp(stampPath) {
  try {
    const content = fs.readFileSync(stampPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function gitOutput(args, projectRoot) {
  try {
    const result = spawnSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.status === 0 ? (result.stdout || '').trim() : null;
  } catch {
    return null;
  }
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
    if (toolName !== 'Bash') process.exit(0);

    const command = (data.tool_input && data.tool_input.command) || '';
    if (!command) process.exit(0);

    // Only intercept git push commands
    if (!/\bgit\s+push\b/.test(command)) process.exit(0);

    // Exempt: force push (--force or -f) — separately gated
    if (/--force\b|-f\b/.test(command)) process.exit(0);

    // Exempt: push targeting develop or master (PR flow handles those)
    if (/\b(develop|master|main)\b/.test(command)) process.exit(0);

    // Bypass: session env
    if (process.env.PRE_PR_BYPASS === '1') process.exit(0);

    const projectRoot = getProjectRoot();
    const stampPath = getStampPath(projectRoot);
    const stamp = readStamp(stampPath);

    const block = (reason) => {
      process.stderr.write(
        `[pre-push-pre-pr-gate] BLOCKED: ${reason}\n` +
        `/pre-pr required for ALL pushes, including intermediate pushes (any push before final PR-open push). Re-run /pre-pr before each push, OR squash to single push at PR-open time.\n` +
        `On PASS it writes the stamp at:\n` +
        `  ${stampPath}\n` +
        `Bypass: export PRE_PR_BYPASS=1\n`
      );
      process.exit(2);
    };

    // Check 1: stamp exists
    if (!stamp) {
      block('No /pre-pr stamp found. Run /pre-pr first.');
      return;
    }

    // Check 2: verdict is PASS
    if (stamp.verdict !== 'PASS') {
      block(`/pre-pr stamp verdict is "${stamp.verdict}", not PASS. Re-run /pre-pr.`);
      return;
    }

    // Check 3: timestamp freshness
    const stampTime = stamp.timestamp ? new Date(stamp.timestamp).getTime() : 0;
    const age = Date.now() - stampTime;
    if (isNaN(age) || age > MAX_STAMP_AGE_MS) {
      const ageMins = isNaN(age) ? '?' : Math.round(age / 60000);
      block(`/pre-pr stamp is stale (${ageMins} min old, max 30). Re-run /pre-pr.`);
      return;
    }

    // Check 4a: reject short SHA in stamp (pre-pr always writes 40-char SHA)
    if (stamp.head && stamp.head.length > 0 && stamp.head.length < 40) {
      block('stamp uses short SHA, expected full SHA — re-run /pre-pr.');
      return;
    }

    // Check 4b: HEAD comparison (only if git available; 4a guarantees stamp.head is 40-char if non-empty)
    const currentHead = gitOutput(['rev-parse', 'HEAD'], projectRoot);
    if (currentHead && stamp.head && currentHead !== stamp.head) {
      block('/pre-pr stamp HEAD (' + stamp.head + ') does not match current HEAD. Re-run /pre-pr.');
      return;
    }

    // Check 5: branch matches
    const currentBranch = gitOutput(['branch', '--show-current'], projectRoot);
    if (currentBranch && stamp.branch && currentBranch !== stamp.branch) {
      block(`/pre-pr stamp branch "${stamp.branch}" does not match current branch "${currentBranch}". Re-run /pre-pr.`);
      return;
    }

    // All checks passed — allow
    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
