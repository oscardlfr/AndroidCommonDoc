#!/usr/bin/env node
// git-amend-gate.js — PreToolUse hook for Bash
//
// Blocks `git commit --amend` unless CLAUDE_AMEND_AUTHORIZED=1 is set in the
// environment OR the command contains the literal marker [CLAUDE_AMEND_AUTHORIZED].
//
// Detects `--amend` as a STANDALONE TOKEN (split on whitespace, respecting
// quoted segments) — not as a fixed substring — per arch-testing advisory
// (BL-W42 PR3, FIND-15).
//
// Exit codes: 0 = allow, 1 = block. Fail-open on any parse error.

const fs = require('fs');

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
  if (toolName !== 'Bash') process.exit(0);

  const command = (data.tool_input && data.tool_input.command) || '';
  if (!command) process.exit(0);

  // Fast-path: no amend token present at all
  if (!command.includes('--amend')) process.exit(0);

  // Marker bypass: explicit in-command authorization
  if (command.includes('[CLAUDE_AMEND_AUTHORIZED]')) process.exit(0);

  // Env bypass
  if (process.env.CLAUDE_AMEND_AUTHORIZED === '1') process.exit(0);

  // Tokenize: split on whitespace (quoted segments kept together for safety,
  // but --amend will never be inside quotes in practice)
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const hasAmendToken = tokens.some(t => t === '--amend');

  if (!hasAmendToken) process.exit(0);

  process.stderr.write(
    '[git-amend-gate] BLOCKED: git commit --amend requires explicit authorization (FIND-15, BL-W42 PR3).\n' +
    'CI failure recovery MUST use a NEW commit, never --amend.\n' +
    'Bypass options:\n' +
    '  1. Export CLAUDE_AMEND_AUTHORIZED=1 before the git command (user must authorize)\n' +
    '  2. Include [CLAUDE_AMEND_AUTHORIZED] marker in the command\n' +
    'Reference: feedback_amend_requires_explicit_user_request.md\n'
  );
  process.exit(1);
});
