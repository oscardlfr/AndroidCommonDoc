#!/usr/bin/env node
// kmp-test-runner-gate.js — PreToolUse hook for Bash (Item 4, BL-W42 PR5).
//
// Blocks raw Gradle test invocations: gradlew test, gradle test, :module:test.
// Agents MUST use the /test skill or kmp-test-runner CLI instead (v0.9.0+).
//
// Bypass: env KMP_TEST_RUNNER_BYPASS=1 OR inline [KMP_TEST_RUNNER_BYPASS] in command.
// Fail-open on any parse error or stdin timeout (exit 0).

const BLOCKED_PATTERNS = ['gradlew test', 'gradle test', ':module:test'];

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

  if (data.tool_name !== 'Bash') process.exit(0);

  const command = (data.tool_input && data.tool_input.command) || '';
  if (!command) process.exit(0);

  // Env bypass
  if (process.env.KMP_TEST_RUNNER_BYPASS === '1') process.exit(0);

  // Inline bypass: set when PR body / commit message references blocked patterns as prose.
  // Inline marker bypass
  if (command.includes('[KMP_TEST_RUNNER_BYPASS]')) process.exit(0);

  const matched = BLOCKED_PATTERNS.find(p => command.includes(p));
  if (!matched) process.exit(0);

  process.stderr.write(
    `[kmp-test-runner-gate] BLOCKED: raw Gradle test invocation detected ("${matched}").\n` +
    `Use the /test skill or kmp-test-runner CLI (v0.9.0+) instead.\n` +
    `Blocked patterns: gradlew test, gradle test, :module:test\n` +
    `Bypass options:\n` +
    `  1. Export KMP_TEST_RUNNER_BYPASS=1 (authorized contexts only)\n` +
    `  2. Include [KMP_TEST_RUNNER_BYPASS] inline marker in the command\n` +
    `Reference: BL-W42 PR5 kmp-test-runner v0.9.0 enforcement\n`
  );
  process.exit(2);
});
