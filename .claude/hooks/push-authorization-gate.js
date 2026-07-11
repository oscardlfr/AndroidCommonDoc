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
//   - isGitPushCommand() (below) remains a best-effort, string-based detector, not the
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

// Detect git push in a bash command string (P2a deep detector: segment-aware + exec-aware).
// Variable indirection and arbitrary language interpreters (python -c, perl -e) remain
// uncatchable by string parsing; the git-layer pre-push two-stamp is the authoritative backstop.
//
// KNOWN LIMITATION: this detector parses a command STRING and cannot fully model the shell.
// A known-open class remains: backslash-escaping an ORDINARY (non-special) character -- the
// shell strips an unrecognized `\x` down to plain `x` (e.g. git \push, git p\ush, \git push),
// but this detector does not perform that stripping, so those forms reach a real push
// undetected. This detector is best-effort identity defense, not the authoritative push gate;
// the git-layer .git/hooks/pre-push two-stamp hook is authoritative, since it reads real git
// refs rather than re-deriving intent from a command string. Do not add another special-case
// regex for this -- see the CRITICAL redesign item filed to BACKLOG.
// Pass 1: recurse into executed sub-strings (shell -c '...', $'...', eval '...', $(...), `...`).
//   $'...' payloads (genuinely dollar-prefixed AND single-quoted -- captured explicitly, not
//   just optionally matched-and-discarded) are ANSI-C-escape-decoded before recursing, so a
//   LITERAL backslash-n inside $'...' becomes a real newline before Pass 2 ever sees it --
//   otherwise `bash -c $'cd /x\ngit push'` recurses on a payload whose "newline" is just the
//   two printable characters backslash+n, which nothing splits on. $"..." (locale translation)
//   and plain '...'/"..." are NEVER decoded -- decoding them would over-block prose like
//   `bash -c 'echo a\ngit push'`, which bash treats as one literal argument (no push runs) and
//   which must still ALLOW. That distinction is the negative control this fix is checked against.
// Pass 2: strip heredoc bodies + quoted spans FIRST (prose/heredoc false-positive
//   prevention -- this order is load-bearing: heredoc-stripping collapses a heredoc's
//   internal newlines into one placeholder, and quote-stripping neutralizes quoted
//   prose, so splitting BEFORE either would treat their raw, unstripped contents as
//   independent segments). THEN collapse shell line-continuation (a backslash
//   immediately before a newline, which the shell itself removes to JOIN two lines
//   into one logical command) BEFORE splitting on shell control operators INCLUDING
//   (bare, non-continuation) newline and `&` (background) -- a continuation and a
//   separator are opposite operations on the same character, disambiguated only by
//   the preceding backslash: `git -C /tmp \<newline>push` really executes as one
//   `git -C /tmp push` command and must be JOINED, while a genuine multi-line
//   `bash -c $'cmd1\ncmd2'` body or a `sleep 1 & git push` line must still be SPLIT,
//   since both of those sequence commands exactly like `;` does. Per segment: strip
//   env-var assignments, common wrapper prefixes (incl. unquoted eval), and -- once
//   the segment starts with a bare `git` -- git's OWN global options (-C, -c,
//   --git-dir, --work-tree, --namespace, --super-prefix, --config-env, --attr-source,
//   --exec-path, and the valueless flags), so `git -C /tmp push`, `git --git-dir=/x
//   push`, `git -c a=b push` etc. all still reduce to a bare `git push` before the
//   anchor test. Test ^git push per segment last.
// Guards: `sh -c "echo 'git push'"`, `printf 'git push'`, `echo $'git push'`,
//   `bash -c 'echo a\ngit push'` (prose/literal, no push ever runs) all ALLOW.
// decodeAnsiCEscapes: decode the escapes bash itself decodes inside GENUINE $'...' quoting.
// Only ever called when the caller has already confirmed the payload came from a real $'...'
// span (dollar-sign present AND single-quoted) -- never for $"..." (locale translation, a
// different feature) or plain '...'/"..." (no escape processing at all in real bash). A
// single left-to-right pass over /\\(.)/g is enough: an escaped backslash (`\\`) consumes
// both characters as one match, so a literal `\\n` (escaped backslash + bare n) correctly
// decodes to a literal backslash followed by an untouched, un-decoded `n` -- not a newline.
// Unrecognized escapes are left exactly as-is (backslash + char), not guessed at.
function decodeAnsiCEscapes(s) {
  return s.replace(/\\(.)/g, (whole, c) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      default: return whole;
    }
  });
}

function isGitPushCommand(cmd) {
  // Pass 1: recurse into executed sub-shells / eval bodies (QUOTED and ANSI-C $'...' forms).
  // Applied to the ORIGINAL cmd (before quote-strip) so payloads stay intact.
  // Group 1 captures the OPTIONAL `$` itself (not just matched-and-discarded) and group 2
  // captures the quote character, so the two can be checked TOGETHER below: only a captured
  // `$` next to a captured `'` is genuine ANSI-C quoting eligible for escape decoding.
  const EXEC = [
    /\b(?:sh|bash|zsh|dash|ksh|ash)\b(?:\s+-\S+)*\s+-[a-z]*c\b\s*(\$?)(['"])([\s\S]*?)\2/g, // shell -c '...' / $'...'
    /\beval\b\s*(\$?)(['"])([\s\S]*?)\2/g,                                                     // eval '...' / $'...'
    /\$\(([\s\S]*?)\)/g,                                                                     // $(...)
    /`([^`]*)`/g,                                                                            // `...`
  ];
  for (const re of EXEC) {
    let m;
    while ((m = re.exec(cmd)) !== null) {
      let payload = m[m.length - 1];
      // Decode ANSI-C escapes ONLY for the two EXEC forms with a captured ($, quote) pair
      // (m.length===4: whole match + 3 groups), and only when that pair is genuinely ($, ').
      // $(...) and `...` have no quote concept at all and are never eligible.
      if (m.length === 4 && m[1] === '$' && m[2] === "'") {
        payload = decodeAnsiCEscapes(payload);
      }
      if (isGitPushCommand(payload)) return true;
    }
  }
  // Pass 2: strip heredoc bodies + quoted spans FIRST -- this order is load-bearing now
  // that the split includes newline (see header): heredoc-stripping collapses a heredoc's
  // internal newlines into one placeholder, and quote-stripping neutralizes quoted prose,
  // BEFORE either could be misread as independent segments by the split below. THEN, once
  // heredocs/quotes are already neutralized (so a continuation can no longer merge into a
  // heredoc's own closing-tag line or into an already-discarded quoted span), collapse shell
  // LINE-CONTINUATION (backslash immediately before a newline): the shell itself removes this
  // pair and JOINS the two lines into one logical command, so `git -C /tmp \<newline>push`
  // executes as a real `git -C /tmp push` -- but a bare `\r?\n` SEPARATOR split (below) would
  // otherwise cut exactly at that join point, producing two harmless-looking segments where
  // the shell sees one. This must NOT be confused with the separator split itself: a
  // continuation is REMOVED (it never becomes a boundary), a bare newline is SPLIT (it always
  // is one) -- the two are opposite operations on the same character, disambiguated only by
  // the immediately-preceding backslash. Then split and prefix-strip per segment. `eval` in
  // the prefix-strip catches unquoted `eval git push` (quoted form handled in Pass 1).
  const cleaned = cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, ' <<HEREDOC ')
    .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    .replace(/\\\r?\n/g, '');
  // `&&` MUST stay listed before the bare `&` alternative -- alternation tries left-to-
  // right and stops at the first match, so if `&` were tried first it would consume only
  // one character of `&&`, leaving a dangling second `&` unsplit. `\r?\n` closes the
  // newline gap (a multi-line command body was previously one un-splittable segment);
  // bare `&` closes the same class of gap for backgrounding (`cmd1 & cmd2` sequences
  // exactly like `cmd1 ; cmd2` from the shell's point of view). By this point any
  // backslash-newline PAIR has already been removed above, so every remaining `\r?\n` here
  // really is a separator, never a continuation.
  // Git's own global options, consumed between a bare `git` and its subcommand. Two shapes:
  //   - value-taking (-C, -c, --git-dir, --work-tree, --namespace, --super-prefix,
  //     --config-env, --attr-source): value is EITHER glued via `=` OR a separate next token
  //     -- `\s+\S+` deliberately consumes ANY next token as the value (including one that
  //     happens to read "push", per the `git -C push push` sanity case: the FIRST push is -C's
  //     value, only the SECOND is the real subcommand, and this still reduces to `git push`).
  //   - --exec-path takes an OPTIONAL value via `=` ONLY (GNU convention for optional-argument
  //     long options) -- never a separate-arg value, so it must NOT consume a following token.
  //   - the rest are valueless flags, consumed alone.
  // Anchored to `^git\s+`, so this is a no-op until a wrapper/VAR=val strip (below) has
  // already exposed a bare `git` at the front of the segment.
  const GIT_GLOBAL_OPT_RE = /^(git\s+)(?:(?:(?:-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env|--attr-source)(?:=\S+|\s+\S+)|--exec-path(?:=\S+)?|-p|-P|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks|--no-lazy-fetch|-v|--version|-h|--help|--html-path|--man-path|--info-path)\s+)+/;
  return cleaned.split(/\s*(?:&&|\|\||;|\||\r?\n|&)\s*/).some(seg => {
    let s = seg.trim(), prev;
    do {
      prev = s;
      s = s
        .replace(/^(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)+/, '')  // strip leading VAR=val env
        .replace(/^(?:rtk|sudo|command|env|xargs|time|nice|nohup|stdbuf|setsid|doas|builtin|exec|eval)\s+(?:-\S+\s+)*/, '')
        .replace(GIT_GLOBAL_OPT_RE, '$1');  // strip git's own global options -> bare `git <subcommand>`
    } while (s !== prev);
    return /^git\s+push\b/.test(s);
  });
}

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
    if (!isGitPushCommand(cmd)) process.exit(0);

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

    // Peers and subagents: BLOCK unconditionally
    if (agentType !== '') {
      block(
        `[push-authorization-gate] BLOCKED: "${agentType}" attempted git push. ` +
        `Only the main orchestrator may push. If you need a push, send a ` +
        `SendMessage to team-lead requesting it. Bypass: PUSH_AUTHORIZATION_BYPASS=1 ` +
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
