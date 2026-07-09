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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_AGE_SECS = 1800;   // 30 minutes
const SKEW_TOLERANCE = 120;   // 2 minutes future tolerance

// Detect git push in a bash command string (P2a deep detector: segment-aware + exec-aware).
// Best-effort: ANSI-C $'...' quoting is now covered (optional \$? before quote in Pass 1).
// Escape sequences inside $'...' (e.g. $'\x67it push') and variable indirection remain
// uncatchable by string parsing; the git-layer pre-push two-stamp is the authoritative backstop.
// Language interpreters (python -c, perl -e) and arbitrary obfuscation are also uncatchable.
// Pass 1: recurse into executed sub-strings (shell -c '...', $'...', eval '...', $(...), `...`)
//   so that `sh -c 'git push'` / `sh -c $'git push'` are caught.
// Pass 2: strip heredoc bodies + quoted spans (prose false-positive prevention),
//   split on shell control operators (NOT newline), test ^git push per segment
//   after stripping env-var assignments and common wrapper prefixes (incl. unquoted eval).
// Guards: `sh -c "echo 'git push'"`, `printf 'git push'`, `echo $'git push'` (prose) all ALLOW.
function isGitPushCommand(cmd) {
  // Pass 1: recurse into executed sub-shells / eval bodies (QUOTED and ANSI-C $'...' forms).
  // Applied to the ORIGINAL cmd (before quote-strip) so payloads stay intact.
  // \$? before the quote capture handles $'...' and $"..." (ANSI-C quoting).
  const EXEC = [
    /\b(?:sh|bash|zsh|dash|ksh|ash)\b(?:\s+-\S+)*\s+-[a-z]*c\b\s*\$?(['"])([\s\S]*?)\1/g, // shell -c '...' / $'...'
    /\beval\b\s*\$?(['"])([\s\S]*?)\1/g,                                                     // eval '...' / $'...'
    /\$\(([\s\S]*?)\)/g,                                                                     // $(...)
    /`([^`]*)`/g,                                                                            // `...`
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

    // Resolve projectRoot early — needed for bypass audit log and stamp paths alike.
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Bypass
    if (process.env.PUSH_AUTHORIZATION_BYPASS === '1') {
      // Audit trail: log bypass to push-proof.log (fail-OPEN — never block on log I/O).
      try {
        const bypassLog = path.join(projectRoot, '.androidcommondoc', 'push-proof.log');
        const bypassHead = (() => {
          try {
            const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeout: 3000, encoding: 'utf8' });
            return r.status === 0 ? (r.stdout || '').trim() : 'unknown';
          } catch { return 'unknown'; }
        })();
        const bypassEntry = JSON.stringify({ ts: new Date().toISOString(), event: 'bypass', mechanism: 'PUSH_AUTHORIZATION_BYPASS', head: bypassHead }) + '\n';
        fs.mkdirSync(path.join(projectRoot, '.androidcommondoc'), { recursive: true });
        fs.appendFileSync(bypassLog, bypassEntry, 'utf8');
      } catch { /* fail-OPEN */ }
      process.exit(0);
    }

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

    // Secondary proof check (fallback: no pre-push hook installed).
    // Delegates to the canonical verifier (emit-push-proof.sh verify-proof) when bash
    // is available — single source of truth for all invariants (schema, freshness, head,
    // worktree_id, manifest_version, steps_executed coverage, report_digest recompute).
    // Falls back to in-JS checks only when bash is not on PATH.
    const proofScript = path.join(projectRoot, 'scripts', 'sh', 'emit-push-proof.sh');
    const headShaForProof = getHeadSha(projectRoot);
    let usedCanonical = false;
    try {
      const bash = spawnSync('bash', ['-c', 'command -v bash'], { timeout: 2000 });
      if (bash.status === 0 && fs.existsSync(proofScript) && headShaForProof) {
        const result = spawnSync(
          'bash', [proofScript, '--subcommand', 'verify-proof', '--pushed-sha', headShaForProof],
          { cwd: projectRoot, timeout: 15000, encoding: 'utf8' }
        );
        if (result.status !== 0) {
          block(
            `[push-authorization-gate] BLOCKED: canonical verify-proof failed. ` +
            `Run /quality-gate to re-mint proof. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
          );
        }
        usedCanonical = true;
      }
    } catch { /* bash not available; fall through to in-JS checks */ }

    if (!usedCanonical) {
      // In-JS fallback: fully canonical verify-proof equivalent (8 checks).
      // Byte-for-byte equivalent in rigor to verify-push-proof.ps1 and the
      // canonical emit-push-proof.sh verify-proof subcommand -- all three
      // verifiers now carry equivalent 8-check rigor, including the
      // bats_evidence.head == pushed_sha binding (check 8, below).
      const proofPath = path.join(stampDir, 'push-proof.json');
      let proof;
      try { proof = JSON.parse(fs.readFileSync(proofPath, 'utf8')); }
      catch { block('[push-authorization-gate] BLOCKED: push-proof.json missing or malformed. Run /quality-gate to mint proof. Bypass: PUSH_AUTHORIZATION_BYPASS=1.'); }

      // 1. schema_version
      if (proof.schema_version !== 1) {
        block(`[push-authorization-gate] BLOCKED: push-proof.json schema_version unknown (${proof.schema_version}).`);
      }

      // 2. head binding
      if (headShaForProof && proof.head !== headShaForProof) {
        block(`[push-authorization-gate] BLOCKED: proof head (${proof.head}) != HEAD (${headShaForProof}).`);
      }

      // 3. worktree_id
      if (proof.worktree_id && proof.worktree_id !== projectRoot) {
        block(`[push-authorization-gate] BLOCKED: proof worktree_id (${proof.worktree_id}) != project root (${projectRoot}).`);
      }

      // 4. freshness
      const now2 = Math.floor(Date.now() / 1000);
      const proofEpoch = Math.floor(new Date(proof.generated_at || '').getTime() / 1000);
      if (isNaN(proofEpoch) || (now2 - proofEpoch) > MAX_AGE_SECS || (proofEpoch - now2) > SKEW_TOLERANCE) {
        block('[push-authorization-gate] BLOCKED: push-proof.json stale or invalid timestamp.');
      }

      // 5. manifest_version matches live manifest
      const manifestPath = path.join(projectRoot, 'quality-gate-manifest.json');
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
      catch { block('[push-authorization-gate] BLOCKED: quality-gate-manifest.json missing or malformed.'); }
      if (typeof proof.manifest_version !== 'number') {
        block('[push-authorization-gate] BLOCKED: push-proof.json missing manifest_version.');
      }
      if (proof.manifest_version !== manifest.manifest_version) {
        block(`[push-authorization-gate] BLOCKED: proof manifest_version (${proof.manifest_version}) != live manifest (${manifest.manifest_version}). Re-run /quality-gate.`);
      }

      // 6. required-step COVERAGE: every required step must be present in steps_executed with result=PASS
      const requiredIds = (manifest.required_steps || []).map(s => s.id);
      const executedMap = {};
      for (const s of (proof.steps_executed || [])) { executedMap[s.step] = s; }
      for (const sid of requiredIds) {
        const entry = executedMap[sid];
        if (!entry) {
          block(`[push-authorization-gate] BLOCKED: required step '${sid}' missing from proof.steps_executed. Re-run /quality-gate.`);
        }
        if (entry.result !== 'PASS') {
          block(`[push-authorization-gate] BLOCKED: required step '${sid}' result='${entry.result}' (not PASS) in proof. Re-run /quality-gate.`);
        }
      }

      // 7. report_digest — recompute sha256(CRLF->LF) of quality-gate-report.json
      const reportPath = path.join(stampDir, 'quality-gate-report.json');
      let reportRaw;
      try { reportRaw = fs.readFileSync(reportPath); }
      catch { block('[push-authorization-gate] BLOCKED: quality-gate-report.json missing — cannot verify report_digest.'); }
      // Normalize CRLF -> LF byte-by-byte (same as bash/python hashlib.sha256 + replace)
      const normalized = [];
      for (let i = 0; i < reportRaw.length; i++) {
        if (reportRaw[i] === 0x0D && i + 1 < reportRaw.length && reportRaw[i + 1] === 0x0A) {
          continue; // skip CR in CRLF
        }
        normalized.push(reportRaw[i]);
      }
      const computedDigest = crypto.createHash('sha256').update(Buffer.from(normalized)).digest('hex');
      if (computedDigest !== proof.report_digest) {
        block(`[push-authorization-gate] BLOCKED: report_digest mismatch — proof may be forged or report tampered. Re-run /quality-gate.`);
      }

      // 8. bats_evidence binding: present + head matches pushed_sha
      // Mirrors verify-push-proof.ps1 and the canonical emit-push-proof.sh verify-proof
      // subcommand -- a half-done evidence binding would mint correctly but verify
      // permissively; this closes that gap. absent-means-skip is a bypass, not a
      // default, same rule as every check above.
      if (!proof.bats_evidence) {
        block('[push-authorization-gate] BLOCKED: push-proof.json missing bats_evidence. Re-run /quality-gate.');
        return; // block() may defer exit(2) until stdout drains (backpressure); unlike
                // checks 1-7, which move on to an UNRELATED condition after blocking,
                // the very next line here dereferences .head on the object this branch
                // just proved absent -- falling through would throw TypeError on
                // undefined in that deferred window instead of emitting the clean
                // decision:block JSON. Fail-closed must mean "blocked with a message",
                // not "blocked by crashing".
      }
      if (proof.bats_evidence.head !== headShaForProof) {
        block(`[push-authorization-gate] BLOCKED: bats_evidence.head (${proof.bats_evidence.head}) != HEAD (${headShaForProof}).`);
      }
    }

    // All checks passed
    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
