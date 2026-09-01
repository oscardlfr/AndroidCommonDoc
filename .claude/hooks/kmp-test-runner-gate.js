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

const ALLOWLIST_PATTERNS = [
  // Read-only diagnostic commands (kmp-test-runner v0.14.0)
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
  // gradlew/gradle as a COMMAND (not inside a path) followed by *Test variants or bare 'test'.
  // Anchors: start-of-line, whitespace, pipe, semicolon, &&, ||, or (.
  // NOT matched when gradle appears mid-path (e.g., docs/gradle/agp9-kmp-host-test-source-set.md).
  /(?:^|[|&;\s(])\.?\/?(gradlew?)(?![\w./]).*\b(\w*Test|test)\b/,
  // gradlew/gradle allTests
  /(?:^|[|&;\s(])\.?\/?(gradlew?)(?![\w./]).*\ballTests\b/,
  // gradlew/gradle check (lifecycle task that runs tests)
  /(?:^|[|&;\s(])\.?\/?(gradlew?)(?![\w./]).*\bcheck\b/,
  // module-qualified test tasks like :core:jvmTest OR :core:test
  /:[\w-]+:(\w*Test|test)\b/,
];

const JS_WASM_PATTERN = /\b(js\w*Test|wasm\w*Test)\b/;

// ─────────────────────────────────────────────────────────────────────────
// Sequence 68/69 (Defect 4): classify only the EXECUTABLE Bash surface, not
// heredoc BODY bytes. A Bash call that merely WRITES a fixture/doc file via
// heredoc, whose payload happens to CONTAIN Gradle-test-shaped text as
// literal file content (e.g. authoring a bats/doc fixture that itself
// mentions "./gradlew test" as example prose -- exactly the kind of content
// this repo's own test suites legitimately contain), must not be
// misclassified as a live Gradle test invocation. The initiating command
// line and any real executable shell before/after each heredoc payload
// remain fully visible/scanned. Supports <<EOF, <<'EOF', <<"EOF", <<-EOF
// (and their combinations), including multiple heredocs per command. Any
// unterminated, ambiguous or unsupported structure returns the ORIGINAL
// command unchanged -- callers then scan the full raw text exactly as
// before, which can only match a block pattern as-or-more often, never
// less (fail closed).
// ─────────────────────────────────────────────────────────────────────────
const HEREDOC_START = /<<(-)?[ \t]*(?:(['\"])([A-Za-z_]\w*)\2|([A-Za-z_]\w*))/;

function elideHeredocBodies(command) {
  if (typeof command !== 'string' || command.indexOf('<<') === -1) return command;

  const lines = command.split('\n');
  const kept = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const pending = [];
    let searchFrom = 0;

    // Collect every heredoc redirect that starts on this line, left to right.
    for (;;) {
      const rest = line.slice(searchFrom);
      const m = rest.match(HEREDOC_START);
      if (!m) break;
      const matchStart = searchFrom + m.index;
      if (matchStart > 0 && line[matchStart - 1] === '<') {
        // '<<<' here-string (or an unsupported longer run) -- not a
        // heredoc; bail out and let the caller scan the untouched original.
        return command;
      }
      const delim = m[3] || m[4];
      if (!delim) return command; // ambiguous/unsupported delimiter shape
      pending.push({ dash: Boolean(m[1]), delim });
      searchFrom = matchStart + m[0].length;
    }

    kept.push(line);
    i += 1;

    for (const { dash, delim } of pending) {
      let terminated = false;
      while (i < lines.length) {
        const bodyLine = lines[i];
        const compareLine = dash ? bodyLine.replace(/^\t+/, '') : bodyLine;
        i += 1;
        if (compareLine === delim) {
          terminated = true;
          break;
        }
        // heredoc BODY line -- inert data, elided from the scan target.
      }
      if (!terminated) return command; // unterminated heredoc -- fail closed on the ORIGINAL input
    }
  }

  return kept.join('\n');
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

  if (data.tool_name !== 'Bash') process.exit(0);

  const command = (data.tool_input && data.tool_input.command) || '';
  if (!command) process.exit(0);

  // Env bypass
  if (process.env.KMP_TEST_RUNNER_BYPASS === '1') process.exit(0);
  // Inline marker bypass
  if (command.includes('[KMP_TEST_RUNNER_BYPASS]')) process.exit(0);

  // Classification target: heredoc BODY bytes elided (Defect 4) -- the
  // bypass-marker/env checks above deliberately still use the raw command
  // (unrelated pre-existing behavior, unaffected by this fix).
  const scanTarget = elideHeredocBodies(command);

  // Allowlist FIRST (must precede block check)
  for (const pattern of ALLOWLIST_PATTERNS) {
    if (pattern.test(scanTarget)) process.exit(0);
  }

  // Block check
  let blocked = false;
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(scanTarget)) {
      blocked = true;
      break;
    }
  }

  if (!blocked) process.exit(0);

  // Special JS/Wasm message
  if (JS_WASM_PATTERN.test(scanTarget)) {
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
