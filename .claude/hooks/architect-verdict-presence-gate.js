#!/usr/bin/env node
// Blocks arch-* agents from sending APPROVE via SendMessage unless a verdict
// file (.planning/wave*/arch-{role}-verdict.md) exists on disk.
// Fail-open: parse errors or fs errors exit 0 so a buggy hook never blocks.

const fs = require('fs');
const path = require('path');

const ARCH_ROLES = ['arch-platform', 'arch-testing', 'arch-integration'];
// Agent match uses startsWith to tolerate suffix-rotated names (e.g. arch-platform-2)

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);

    if (data.tool_name !== 'SendMessage') process.exit(0);

    const agentType = (data.agent_type ?? '').toLowerCase();
    const isArchRole = ARCH_ROLES.some(role => agentType.startsWith(role));
    if (!isArchRole) process.exit(0);
    // Resolve the canonical role for path construction (longest prefix match)
    const matchedRole = ARCH_ROLES.find(role => agentType.startsWith(role));

    const messageRaw = data.tool_input?.message;
    // Structured JSON message form (object) — not an APPROVE string candidate
    if (typeof messageRaw !== 'string') process.exit(0);

    if (!/^\s*APPROVE\b/.test(messageRaw)) process.exit(0);

    // Extract role suffix from matched canonical role (arch-platform → platform)
    const role = matchedRole.replace('arch-', '');

    // Glob .planning/ dirs matching wave* or pr\d+- prefix for verdict lookup
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const planningDir = path.join(projectRoot, '.planning');

    let verdictFound = false;
    try {
      const waveDirs = fs.readdirSync(planningDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && (e.name.startsWith('wave') || /^pr\d+-/.test(e.name)))
        .map(e => e.name);

      for (const waveDir of waveDirs) {
        const verdictPath = path.join(planningDir, waveDir, `arch-${role}-verdict.md`);
        if (fs.existsSync(verdictPath)) {
          verdictFound = true;
          break;
        }
      }
    } catch {
      // .planning dir missing or unreadable — treat as no verdict found
    }

    if (verdictFound) process.exit(0);

    process.stderr.write(
      `[architect-verdict-presence-gate] BLOCKED: ${agentType} attempted to send APPROVE ` +
      `without a verdict file on disk.\n` +
      `Expected: .planning/wave-<slug>/arch-${role}-verdict.md\n\n` +
      `Write the verdict file using the canonical canal script:\n` +
      `  scripts/sh/write-verdict.sh --role ${matchedRole} --phase prep\n` +
      `  # ... review and add verdict content ...\n` +
      `  scripts/sh/write-verdict.sh --role ${matchedRole} --phase verify-final\n\n` +
      `See: docs/agents/agent-verdict-protocol.md\n`
    );
    process.exit(2);
  } catch {
    process.stderr.write('[architect-verdict-presence-gate] parse error — fail-open\n');
    process.exit(0);
  }
});
