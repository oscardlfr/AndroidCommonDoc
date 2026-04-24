#!/usr/bin/env node
// Bash CLI Spawn Gate — PreToolUse hook (T-BUG-031-00)
// Blocks attempts to spawn Claude agents via CLI flags inside Bash tool calls.
// Detection: --agent-id, --team-name, -p "you are, --print "you are
// False-positive guard: `claude --help` must NOT be blocked.

const FORBIDDEN_PATTERNS = [
  /--agent-id/,
  /--team-name/,
  /-p\s+"you are/i,
  /--print\s+"you are/i,
];

const SAFE_COMMANDS = [
  /^claude\s+--help\b/,
  /^claude\s+-h\b/,
];

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Bash') { process.exit(0); }
    const cmd = (data.tool_input && data.tool_input.command) || '';

    // Safe commands always pass
    if (SAFE_COMMANDS.some(re => re.test(cmd.trim()))) { process.exit(0); }

    // Check forbidden patterns
    if (FORBIDDEN_PATTERNS.some(re => re.test(cmd))) {
      const output = {
        decision: 'block',
        reason: 'FORBIDDEN: CLI agent spawn via Bash. Use Agent() with correct subagent_type (T-BUG-031-00).'
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }
  } catch (_) { /* silent */ }
  process.exit(0);
});
