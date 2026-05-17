#!/usr/bin/env node
// commit-scope-validation-gate.js — PreToolUse hook for Bash.
//
// Fires on git commit commands. Extracts the scope from the -m flag value,
// reads valid_scopes from .commitlintrc.json, and blocks if the scope is invalid.
//
// Compound module scopes (e.g., core-error-sdk) are matched by first segment
// (core in the example above), matching what the CI workflow allows.
//
// Bypasses:
//   COMMIT_SCOPE_BYPASS=1 env (session-scoped)
//   [COMMIT_SCOPE_BYPASS] inline marker in Bash command
//
// Fail-open: any parse error, missing .commitlintrc.json, no scope in message,
//   interactive commit (no -m), or stdin error -> exit 0

const fs = require('fs');
const path = require('path');

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

    // Only intercept git commit commands
    if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

    // Bypass 1: session env
    if (process.env.COMMIT_SCOPE_BYPASS === '1') process.exit(0);

    // Bypass 2: inline marker
    if (command.includes('[COMMIT_SCOPE_BYPASS]')) process.exit(0);

    // Extract commit message from -m flag (agents always use -m)
    // Matches: -m "msg", -m 'msg', -m$(cat ...) patterns — focus on quoted strings
    const msgMatch = command.match(/-m\s+["']([^"']*)["']/);
    if (!msgMatch) process.exit(0); // interactive commit or heredoc — fail-open

    const msg = msgMatch[1];

    // Parse conventional commit: type(scope): description
    const ccMatch = msg.match(/^[a-z]+\(([^)]+)\)/);
    if (!ccMatch) process.exit(0); // no scope — fail-open (scope is optional)

    const rawScope = ccMatch[1];
    // Extract first segment of compound scope (core-error-sdk -> core)
    const scopeSegment = rawScope.split('-')[0];

    // Read valid_scopes from .commitlintrc.json
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const configPath = path.join(projectRoot, '.commitlintrc.json');

    let validScopes;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      validScopes = config.valid_scopes;
      if (!Array.isArray(validScopes) || validScopes.length === 0) process.exit(0);
    } catch {
      // .commitlintrc.json missing or malformed — fail-open
      process.exit(0);
    }

    // Check both raw scope and first segment
    if (validScopes.includes(rawScope) || validScopes.includes(scopeSegment)) {
      process.exit(0);
    }

    // Block with informative message
    process.stderr.write(
      `[commit-scope-validation-gate] BLOCKED: scope "(${rawScope})" is not in valid_scopes.\n` +
      `Valid scopes (from .commitlintrc.json): ${validScopes.join(', ')}\n` +
      `Compound scopes like "core-error-sdk" are valid when "core" is in the list.\n` +
      `Bypass options:\n` +
      `  1. Export COMMIT_SCOPE_BYPASS=1 (session-scoped)\n` +
      `  2. Include [COMMIT_SCOPE_BYPASS] inline in the command\n`
    );
    process.exit(2);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
