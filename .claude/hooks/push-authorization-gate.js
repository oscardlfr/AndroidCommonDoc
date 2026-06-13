#!/usr/bin/env node
// push-authorization-gate.js — PreToolUse:Bash hook
//
// Identity-aware gate that blocks git push commands from peer/subagent agents.
// Replaces the two legacy gates: quality-gate-pre-push.sh and pre-push-pre-pr-gate.js.
//
// LOGIC:
//   1. If tool_name != Bash: allow
//   2. If command does not contain a git push invocation: allow
//   3. If agent_type is non-empty (peer/subagent): BLOCK with instructive message
//   4. If agent_type is empty (main orchestrator): validate stamps if pre-push hook
//      is NOT installed (fallback-stamps path); if hook IS installed, allow
//
// FALLBACK-STAMPS validation (main, no pre-push hook installed):
//   - Both .androidcommondoc/quality-gate.stamp and pre-pr.stamp must exist
//   - Both must have verdict=PASS
//   - Both must be <=30min old (age <= 1800s)
//   - Both must not be future-stamped (age >= -120s, i.e. not more than 2min ahead)
//   - pre-pr.stamp head must match HEAD sha (40-char)
//
// BYPASS: PUSH_AUTHORIZATION_BYPASS=1 (session-scoped; explicit user authorization only)
//
// Fail-open: parse errors, missing node APIs → exit 0 (never block due to validator bug).
//
// Exit codes:
//   0 = allow
//   2 = block (with { decision: 'block', reason } JSON on stdout)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_AGE_SECS = 1800;   // 30 minutes
const SKEW_TOLERANCE = 120;   // 2 minutes future tolerance

// Detect git push in a bash command string (P2a deep detector: segment-aware + exec-aware).
// Best-effort: language interpreters (python -c, perl -e) and arbitrary obfuscation remain
// uncatchable by string parsing; the git-layer pre-push two-stamp is the authoritative backstop.
// Pass 1: recurse into executed sub-strings (shell -c '...', eval '...', $(...), `...`)
//   so that `sh -c 'git push'` is caught even though the outer command is sh.
// Pass 2: strip heredoc bodies + quoted spans (prose false-positive prevention),
//   split on shell control operators (NOT newline), test ^git push per segment
//   after stripping env-var assignments and common wrapper prefixes (incl. unquoted eval).
// Guards: `sh -c "echo 'git push'"`, `printf 'git push'`, `echo "$(date) pushed ok"` all ALLOW.
function isGitPushCommand(cmd) {
  // Pass 1: recurse into executed sub-shells / eval bodies (QUOTED forms).
  // Applied to the ORIGINAL cmd (before quote-strip) so payloads stay intact.
  const EXEC = [
    /\b(?:sh|bash|zsh|dash|ksh|ash)\b(?:\s+-\S+)*\s+-[a-z]*c\b\s*(['"])([\s\S]*?)\1/g, // shell -c '...'
    /\beval\b\s*(['"])([\s\S]*?)\1/g,                                                     // eval '...'
    /\$\(([\s\S]*?)\)/g,                                                                   // $(...)
    /`([^`]*)`/g,                                                                          // `...`
  ];
  for (const re of EXEC) {
    let m;
    while ((m = re.exec(cmd)) !== null) {
      if (isGitPushCommand(m[m.length - 1])) return true;
    }
  }
  // Pass 2: strip heredoc bodies + quoted spans, then split and prefix-strip per segment.
  // `eval` in the prefix-strip catches unquoted `eval git push` (quoted form handled in Pass 1).
  const cleaned = cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, ' <<HEREDOC ')
    .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  return cleaned.split(/\s*(?:&&|\|\||;|\|)\s*/).some(seg => {
    let s = seg.trim(), prev;
    do {
      prev = s;
      s = s
        .replace(/^(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)+/, '')  // strip leading VAR=val env
        .replace(/^(?:rtk|sudo|command|env|xargs|time|nice|nohup|stdbuf|setsid|doas|builtin|exec|eval)\s+(?:-\S+\s+)*/, '');
    } while (s !== prev);
    return /^git\s+push\b/.test(s);
  });
}

// Read and validate a stamp file. Returns { ok: true, head, epoch } or { ok: false, reason }.
function validateStamp(stampPath) {
  let raw;
  try {
    raw = fs.readFileSync(stampPath, 'utf8');
  } catch {
    return { ok: false, reason: `missing (${path.basename(stampPath)} not found)` };
  }

  let stamp;
  try {
    stamp = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `malformed JSON in ${path.basename(stampPath)}` };
  }

  if (stamp.verdict !== 'PASS') {
    return { ok: false, reason: `verdict is "${stamp.verdict}", not PASS (${path.basename(stampPath)})` };
  }

  const ts = stamp.timestamp || stamp.ts || '';
  let epoch;
  try {
    epoch = Math.floor(new Date(ts).getTime() / 1000);
    if (isNaN(epoch)) throw new Error('NaN');
  } catch {
    return { ok: false, reason: `unparseable timestamp "${ts}" in ${path.basename(stampPath)}` };
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - epoch;

  if (age < -SKEW_TOLERANCE) {
    return { ok: false, reason: `future timestamp in ${path.basename(stampPath)} (${-age}s ahead of clock)` };
  }
  if (age > MAX_AGE_SECS) {
    return { ok: false, reason: `stale ${path.basename(stampPath)} (${Math.floor(age / 60)} min old, max 30)` };
  }

  const head = stamp.head || null;
  return { ok: true, head, epoch };
}

// Get the current HEAD sha via git rev-parse.
function getHeadSha(projectRoot) {
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status === 0) return (result.stdout || '').trim();
  } catch {}
  return null;
}

function block(reason) {
  // Write decision JSON to stdout, then flush stdout before exit (CR #2).
  // process.stdout.write callback ensures the write is flushed before termination.
  const json = JSON.stringify({ decision: 'block', reason });
  if (process.stdout.write(json)) {
    process.exit(2);
  } else {
    process.stdout.once('drain', () => process.exit(2));
  }
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);

    if (data.tool_name !== 'Bash') process.exit(0);

    const cmd = data.tool_input?.command || '';
    if (!isGitPushCommand(cmd)) process.exit(0);

    // Bypass
    if (process.env.PUSH_AUTHORIZATION_BYPASS === '1') process.exit(0);

    const agentType = (data.agent_type || '').trim();

    // Peers and subagents: BLOCK unconditionally
    if (agentType !== '') {
      block(
        `[push-authorization-gate] BLOCKED: "${agentType}" attempted git push. ` +
        `Only the main orchestrator may push. If you need a push, send a ` +
        `SendMessage to team-lead requesting it. Bypass: PUSH_AUTHORIZATION_BYPASS=1 ` +
        `(explicit user authorization only).`
      );
    }

    // Main orchestrator (empty agent_type): check if pre-push hook is installed
    // P1b fix: verify identity via ACDOC-PRE-PUSH-GATE marker — presence alone is not enough
    // (a foreign stub or bare `exit 0` would otherwise bypass stamp validation).
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const prePushHook = path.join(projectRoot, '.git', 'hooks', 'pre-push');
    let hookIsACDoc = false;
    try {
      if (fs.existsSync(prePushHook))
        hookIsACDoc = /ACDOC-PRE-PUSH-GATE/.test(fs.readFileSync(prePushHook, 'utf8'));
    } catch {}
    if (hookIsACDoc) process.exit(0); // git-layer ACDoc hook owns stamp validation
    // else fall through to stamp fallback below

    // Fallback-stamps validation (pre-push hook NOT installed)
    const stampDir = path.join(projectRoot, '.androidcommondoc');
    const qgStamp = path.join(stampDir, 'quality-gate.stamp');
    const ppStamp = path.join(stampDir, 'pre-pr.stamp');

    const qgResult = validateStamp(qgStamp);
    if (!qgResult.ok) {
      block(
        `[push-authorization-gate] BLOCKED: quality-gate.stamp invalid — ${qgResult.reason}. ` +
        `Run /quality-gate then re-push. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
    }

    const ppResult = validateStamp(ppStamp);
    if (!ppResult.ok) {
      block(
        `[push-authorization-gate] BLOCKED: pre-pr.stamp invalid — ${ppResult.reason}. ` +
        `Run /pre-pr then re-push. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
    }

    // pre-pr.stamp head must match HEAD.
    // Block unconditionally if head field is absent, empty, or not a 40-hex SHA —
    // a stamp without a valid head bypasses commit-binding (CR-3).
    const SHA_RE = /^[0-9a-f]{40}$/i;
    if (!ppResult.head || !SHA_RE.test(ppResult.head)) {
      block(
        `[push-authorization-gate] BLOCKED: pre-pr.stamp has missing or invalid head SHA ` +
        `("${ppResult.head ?? ''}"). Re-run /pre-pr on the final commit then re-push. ` +
        `Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
    }
    const headSha = getHeadSha(projectRoot);
    if (headSha && ppResult.head !== headSha) {
      block(
        `[push-authorization-gate] BLOCKED: pre-pr.stamp head (${ppResult.head}) does not match ` +
        `current HEAD (${headSha}). Re-run /pre-pr on the final commit then re-push. ` +
        `Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
    }

    // All checks passed
    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
