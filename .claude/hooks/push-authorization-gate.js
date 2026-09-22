#!/usr/bin/env node
// push-authorization-gate.js — PreToolUse:Bash hook
//
// Identity-aware gate that blocks git push commands from peer/subagent agents.
// Replaces the two legacy gates: quality-gate-pre-push.sh and pre-push-pre-pr-gate.js.
//
// LOGIC:
//   1. If tool_name != Bash: allow
//   2. Parse executable command intent; if no git-push intent exists: allow
//   3. If agent_type is non-empty (peer/subagent): BLOCK with instructive message
//   4. If agent_type is empty (main orchestrator): delegate to scripts/sh/verify-git-hooks.sh
//      (spawnSync) to confirm the git-layer pre-push hook is installed AND canonical; ALLOW
//      only on that clean pass, BLOCK (fail-closed) otherwise
//
// GIT-HOOK VERIFICATION (main, via verify-git-hooks.sh):
//   - ALLOW only when the authoritative git-layer pre-push hook is installed, executable, and
//     canonical (ACDOC-PRE-PUSH-GATE marker present + sha256 matches the canonical
//     scripts/sh/pre-push-hook.sh source, CRLF-normalized on both sides)
//   - BLOCK (fail-closed, with an install/repair instruction) when the hook is absent or
//     drifted, OR when the verify-git-hooks.sh invocation itself fails to launch, errors, or
//     times out -- post-H1 there is no in-JS fallback validation path left to fall back to
//   - Peers/subagents are still hard-blocked at step 3 above regardless of hook state; this
//     step only ever runs for the main orchestrator
//   - shell-command-intent.cjs is a best-effort parsed-intent advisory, not the
//     authoritative gate -- the git-layer pre-push hook verified here is authoritative
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
const { hasIntent } = require('../../scripts/lib/shell-command-intent.cjs');
const { authorizePushActor } = require('../../scripts/lib/push-peer-policy.cjs');

// Shell intent is parsed centrally by scripts/lib/shell-command-intent.cjs.

// INVARIANT: every block() call in this file is IMMEDIATELY followed by `return`.
// block() only calls process.exit(2) synchronously when stdout.write() returns true; under
// backpressure it defers exit to the 'drain' event. Without `return`, execution continues past a
// decision that has already been made, and BOTH continuations end in an accidental ALLOW:
//   (a) deref-throw — a check that dereferences the value it just proved absent throws a
//       TypeError, which this handler's outer `catch { process.exit(0) }` (a deliberate
//       fail-open on script error) swallows into exit 0.
//   (b) fall-through — execution simply reaches a later unconditional process.exit(0). The
//       peer/subagent block is the live example: without `return`, a drain-deferred block()
//       would fall through into the main-orchestrator verify-git-hooks.sh delegation below,
//       and -- if that hook happens to be installed and canonical -- reach ITS terminal
//       process.exit(0) before the deferred process.exit(2) ever fires, silently allowing the
//       peer's push after all.
// (b) is the more severe: no exception, no trace, just an allow.
// The 5s allow-timer (`t`) is cleared at the top of the 'end' handler and is specifically NOT a
// source of false allows. This is not tidiness — it is the difference between fail-closed and
// fail-open.
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
    if (!hasIntent(cmd, 'git-push')) process.exit(0);

    // Resolve projectRoot early — needed for the bypass audit log and the verify-git-hooks.sh delegation alike.
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

    // Runtime actor policy is defense-in-depth. The installed pre-push hook
    // below remains the sole portable authority over the actual ref update.
    const actorDecision = authorizePushActor({ agentType, operation: 'perform', runtimeBound: false });
    if (!actorDecision.ok) {
      block(
        `[push-authorization-gate] BLOCKED: "${agentType}" attempted git push. ` +
        `Only the main host actor may push. Request the operation through the active ` +
        `orchestration channel. Bypass: PUSH_AUTHORIZATION_BYPASS=1 ` +
        `(explicit user authorization only).`
      );
      return;
    }

    // Main orchestrator (empty agent_type): delegate to verify-git-hooks.sh, the single
    // primitive (also used by emit-push-proof.sh's mint precondition and setup-check.ts's
    // Check 7) that resolves the git-layer pre-push hook via `git rev-parse --git-path`
    // (core.hooksPath- and worktree-aware -- NEVER a hardcoded .git/hooks/pre-push) and
    // confirms it is installed, executable, ACDOC-PRE-PUSH-GATE-marked, and byte-identical
    // (CRLF-normalized on both sides) to the canonical scripts/sh/pre-push-hook.sh source.
    // Shape-only mirror of the spawnSync delegation pattern this file used to run for its
    // own canonical-verifier proof check (now removed) -- deliberately REJECTS that
    // pattern's silent-fall-through-on-spawn-failure resilience: there is no fallback left
    // to fall through to post-H1. Every failure mode below routes to a LOCAL block()+return;
    // none may reach the global `catch { process.exit(0) }` below. Only a clean exit 0 with
    // no spawn error allows.
    const verifyGitHooksPath = path.join(projectRoot, 'scripts', 'sh', 'verify-git-hooks.sh');
    let result;
    try {
      result = spawnSync(
        'bash', [verifyGitHooksPath, '--repo-root', projectRoot],
        { cwd: projectRoot, timeout: 15000, encoding: 'utf8' }
      );
    } catch (spawnErr) {
      block(
        `[push-authorization-gate] BLOCKED: verify-git-hooks.sh invocation threw unexpectedly ` +
        `(${spawnErr && spawnErr.message}). Run bash scripts/sh/install-git-hooks.sh to install ` +
        `the pre-push hook, then re-push. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
      return;
    }

    if (result.error) {
      block(
        `[push-authorization-gate] BLOCKED: verify-git-hooks.sh could not be launched ` +
        `(${result.error.message}). Run bash scripts/sh/install-git-hooks.sh to install ` +
        `the pre-push hook, then re-push. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
      return;
    }

    if (result.status === null) {
      block(
        `[push-authorization-gate] BLOCKED: verify-git-hooks.sh timed out or was terminated ` +
        `by a signal before completing. Run bash scripts/sh/install-git-hooks.sh to install ` +
        `or repair the pre-push hook, then re-push. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
      return;
    }

    if (result.status !== 0) {
      const reasonCode = (result.stdout || '').trim() || 'unknown';
      block(
        `[push-authorization-gate] BLOCKED: pre-push hook verification failed (${reasonCode}). ` +
        `Run bash scripts/sh/install-git-hooks.sh to install or repair the pre-push hook -- this ` +
        `covers both an absent hook and one that has drifted from the canonical source -- then ` +
        `re-push. Bypass: PUSH_AUTHORIZATION_BYPASS=1.`
      );
      return;
    }

    // result.status === 0 and no result.error: hook installed, executable, marker-bearing,
    // and byte-identical (CRLF-normalized) to the canonical source. git-layer hook owns
    // push authority from here.
    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
