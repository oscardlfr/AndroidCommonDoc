#!/usr/bin/env node
// kmp-test-runner-gate.js — PreToolUse hook for Bash (PR2 cli-audit-pr2).
//
// Blocks ALL Gradle test task variants across KMP platforms. Agents MUST
// use kmp-test-runner CLI v0.9.0+ instead.
//
// See docs/testing/cli-hub.md for the full 12-doc reference.
//
// Bypass: env KMP_TEST_RUNNER_BYPASS=1 OR inline [KMP_TEST_RUNNER_BYPASS] in command.
// Fail-open on any parse error or stdin timeout (exit 0).

const ALLOWLIST_PATTERNS = [
  // Read-only diagnostic commands (kmp-test-runner v0.9.0)
  /\bkmp-test\s+(info|describe)\b/,
  // Compile-only Android task (no test execution)
  /\bassembleAndroidTest\b/,
  // Coverage report generation (no test execution)
  /\bkoverXmlReport\b/,
  /\bkoverHtmlReport\b/,
  /\bcreateDebugCoverageReport\b/,
  // Dependency reports
  /\bdependencyInsight\b/,
  /\boutgoingVariants\b/,
  // Configuration reference (not a task)
  /\btestRuntimeClasspath\b/,
  // Custom dry-run helpers (e.g., :module:integrationTestPrintCommand)
  /(PrintCommand|DryRun)\b/,
];

const BLOCK_PATTERNS = [
  // gradlew/gradle followed by *Test variants OR bare 'test' task
  /\b(gradlew|gradle)\b.*\b(\w*Test|test)\b/,
  // gradlew/gradle allTests
  /\b(gradlew|gradle)\s+.*\ballTests\b/,
  // gradlew/gradle check (lifecycle task that runs tests)
  /\b(gradlew|gradle)\s+.*\bcheck\b/,
  // module-qualified test tasks like :core:jvmTest OR :core:test
  /:[\w-]+:(\w*Test|test)\b/,
];

const JS_WASM_PATTERN = /\b(js\w*Test|wasm\w*Test)\b/;

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

  // Allowlist FIRST (must precede block check)
  for (const pattern of ALLOWLIST_PATTERNS) {
    if (pattern.test(command)) process.exit(0);
  }

  // Block check
  let blocked = false;
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(command)) {
      blocked = true;
      break;
    }
  }

  if (!blocked) process.exit(0);

  // Special JS/Wasm message
  if (JS_WASM_PATTERN.test(command)) {
    process.stderr.write(
      `[kmp-test-runner-gate] BLOCKED but kmp-test-runner v0.9.0 does NOT yet support JS/Wasm.\n` +
      `Use KMP_TEST_RUNNER_BYPASS=1 ONLY with explicit user authorization. Upstream issue pending.\n` +
      `See: docs/testing/cli-tests-js-wasm.md\n`
    );
    process.exit(2);
  }

  // Standard block message
  process.stderr.write(
    `[kmp-test-runner-gate] BLOCKED: raw Gradle test invocation detected.\n` +
    `Use the /test skill or kmp-test-runner CLI (v0.9.0+) instead.\n` +
    `See: docs/testing/cli-hub.md (full 12-doc CLI reference)\n` +
    `Bypass options:\n` +
    `  1. Export KMP_TEST_RUNNER_BYPASS=1 (authorized contexts only)\n` +
    `  2. Include [KMP_TEST_RUNNER_BYPASS] inline marker in the command\n` +
    `Reference: PR2 cli-audit-pr2 — kmp-test-runner v0.9.0 CLI-only mandate\n`
  );
  process.exit(2);
});
