#!/usr/bin/env node
// kmp-test-runner-gate.js — PreToolUse hook for Bash (PR2 cli-audit-pr2).
//
// Blocks ALL Gradle test task variants across KMP platforms. Agents MUST
// use kmp-test-runner CLI v0.14.0+ instead.
//
// See docs/testing/cli-hub.md for the full 12-doc reference.
//
// Bypass: env KMP_TEST_RUNNER_BYPASS=1 OR inline [KMP_TEST_RUNNER_BYPASS] in command.
// Fail-open on any parse error or stdin timeout (exit 0).

const { parseCommandIntent } = require('../../scripts/lib/shell-command-intent.cjs');

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
  // Inline marker bypass
  if (command.includes('[KMP_TEST_RUNNER_BYPASS]')) process.exit(0);

  // Classify executable shell intent. Quoted arguments, PR bodies, verdict
  // evidence and heredoc payloads are data; nested shell commands remain
  // executable and are classified recursively.
  const blocked = parseCommandIntent(command)
    .filter((intent) => intent.kind === 'gradle-test');
  if (!blocked.length) process.exit(0);

  // Special JS/Wasm message
  if (blocked.some((intent) => intent.jsWasm)) {
    process.stderr.write(
      `[kmp-test-runner-gate] BLOCKED but kmp-test-runner v0.14.0 does NOT yet support JS/Wasm.\n` +
      `Use KMP_TEST_RUNNER_BYPASS=1 ONLY with explicit user authorization. Upstream issue pending.\n` +
      `See: docs/testing/cli-tests-js-wasm.md\n`
    );
    process.exit(2);
  }

  // Standard block message
  process.stderr.write(
    `[kmp-test-runner-gate] BLOCKED: raw Gradle test invocation detected.\n` +
    `Use the /test skill or kmp-test-runner CLI (v0.14.0+) instead.\n` +
    `See: docs/testing/cli-hub.md (full 12-doc CLI reference)\n` +
    `Bypass options:\n` +
    `  1. Export KMP_TEST_RUNNER_BYPASS=1 (authorized contexts only)\n` +
    `  2. Include [KMP_TEST_RUNNER_BYPASS] inline marker in the command\n` +
    `Reference: PR2 cli-audit-pr2 — kmp-test-runner v0.14.0 CLI-only mandate\n`
  );
  process.exit(2);
});
