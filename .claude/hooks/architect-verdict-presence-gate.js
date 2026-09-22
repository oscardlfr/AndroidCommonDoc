#!/usr/bin/env node
// Blocks arch-* agents from sending APPROVE via SendMessage unless a CURRENT canonical
// verdict/v1 record (arch-{role}-verdict-prep.json or arch-{role}-verdict-verify-final.json,
// authorizes==true) exists on disk for that role (wave structured-verdict-evidence-contract,
// PLAN.md sec 3.1-3.5/3.8). Legacy arch-{role}-verdict.md existence alone no longer satisfies
// this gate -- existence-only was a known weakness (PLAN.md sec 2 item 3).
// Fail-open: parse errors or fs errors exit 0 so a buggy hook never blocks.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ARCH_ROLES = ['arch-platform', 'arch-testing', 'arch-integration'];
// Agent match uses startsWith to tolerate suffix-rotated names (e.g. arch-platform-2)

// verdict/v1 canonical authority (wave structured-verdict-evidence-contract, PLAN.md
// sec 3.1-3.5/3.8) — replaces legacy arch-*-verdict.md existence-only recognition below.
let verdictContractCli = null;
try { verdictContractCli = require('../../scripts/lib/verdict-evidence-contract-cli.cjs'); } catch { verdictContractCli = null; }

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function getGitHead(projectRoot) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeout: 3000, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

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

      if (verdictContractCli) {
        const currentHead = getGitHead(projectRoot);
        const savedCwd = process.cwd();
        try {
          // validateVerdict() confines reads under process.cwd(); align it with
          // projectRoot (which can legitimately differ) for the duration of this
          // check only. Mirrors premature-execution-gate.js.
          process.chdir(projectRoot);
          verdictFound = waveDirs.some(waveDir => {
            const absWaveDir = path.join(planningDir, waveDir);
            const planPath = path.join(absWaveDir, 'PLAN.md');
            if (!fs.existsSync(planPath)) return false;
            const planHash = sha256File(planPath);
            const waveSlug = waveDir.startsWith('wave-') ? waveDir.slice('wave-'.length) : waveDir;
            const candidates = [
              { file: `arch-${role}-verdict-prep.json`, phase: 'prep' },
              { file: `arch-${role}-verdict-verify-final.json`, phase: 'verify-final' },
            ];
            return candidates.some(({ file, phase }) => {
              const verdictPath = path.join(absWaveDir, file);
              if (!fs.existsSync(verdictPath)) return false;
              let result;
              try {
                result = verdictContractCli.validateVerdict({
                  path: verdictPath,
                  expectRole: matchedRole,
                  expectPhase: phase,
                  expectWaveSlug: waveSlug,
                  expectPlanSha256: planHash,
                  expectHead: currentHead,
                });
              } catch { return false; }
              return !!(result && result.authorizes === true);
            });
          });
        } finally {
          try { process.chdir(savedCwd); } catch { /* best-effort */ }
        }
      }
    } catch {
      // .planning dir missing or unreadable — treat as no verdict found
    }

    if (verdictFound) process.exit(0);

    process.stderr.write(
      `[architect-verdict-presence-gate] BLOCKED: ${agentType} attempted to send APPROVE ` +
      `without a current canonical verdict record on disk.\n` +
      `Expected: .planning/wave-<slug>/arch-${role}-verdict-prep.json or arch-${role}-verdict-verify-final.json (verdict/v1, authorizes==true)\n\n` +
      `Write the verdict using the canonical scripts:\n` +
      `  scripts/sh/write-verdict-request.sh --role ${matchedRole} --phase prep ...\n` +
      `  scripts/sh/write-verdict.sh --role ${matchedRole} --phase prep ...\n` +
      `  # ... review ...\n` +
      `  scripts/sh/write-verdict-request.sh --role ${matchedRole} --phase verify-final ...\n` +
      `  scripts/sh/write-verdict.sh --role ${matchedRole} --phase verify-final ...\n\n` +
      `See: docs/agents/agent-verdict-protocol.md\n`
    );
    process.exit(2);
  } catch {
    process.stderr.write('[architect-verdict-presence-gate] parse error — fail-open\n');
    process.exit(0);
  }
});
